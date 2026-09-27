import {
  createReadStream,
  createWriteStream,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { dirname, extname, join, relative, resolve, sep } from "node:path";
import type { Plugin } from "vite";

const AUDIO_EXTENSIONS = new Set([
  ".mp3",
  ".m4a",
  ".flac",
  ".wav",
  ".ogg",
  ".aac",
  ".opus",
  ".webm",
]);
const MIME_TYPES: Record<string, string> = {
  ".mp3": "audio/mpeg",
  ".m4a": "audio/mp4",
  ".flac": "audio/flac",
  ".wav": "audio/wav",
  ".ogg": "audio/ogg",
  ".aac": "audio/aac",
  ".opus": "audio/ogg",
  ".webm": "audio/webm",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".svg": "image/svg+xml",
};

interface RatingStore {
  ratings: Record<string, number>;
}

function dataRoot() {
  return resolve(
    process.env.KOLO_DATA_DIR ?? join(import.meta.dirname, "..", "kolo.0.data"),
  );
}

function statePath(root: string) {
  return join(root, ".kolo", "ratings.json");
}

function readRatings(root: string): RatingStore {
  try {
    return JSON.parse(readFileSync(statePath(root), "utf8")) as RatingStore;
  } catch {
    return { ratings: {} };
  }
}

function writeJson(path: string, value: unknown) {
  mkdirSync(dirname(path), { recursive: true });
  const temporary = `${path}.${randomUUID()}.tmp`;
  writeFileSync(temporary, JSON.stringify(value, null, 2));
  renameSync(temporary, path);
}

function readLikes(root: string): string[] {
  try {
    const value: unknown = JSON.parse(
      readFileSync(join(root, ".kolo", "likes.json"), "utf8"),
    );
    return Array.isArray(value)
      ? value.filter((id): id is string => typeof id === "string")
      : [];
  } catch {
    return [];
  }
}

function playlistDefinitions(root: string): Array<[string, string, string]> {
  const definitions: Array<[string, string, string]> = [
    ["pos", "Phone music", join(root, "pos")],
    ["old", "Old playlist", join(root, "downloads", "OLD")],
    ["discovery", "Discovery", join(root, "discovery")],
    ["imported", "Imports", join(root, "imported")],
    ["negative", "Not my vibe", join(root, "neg")],
  ];
  const customRoot = join(root, "playlists");
  if (existsSync(customRoot)) {
    for (const entry of readdirSync(customRoot, { withFileTypes: true })) {
      if (entry.isDirectory() && /^[a-z0-9][a-z0-9-]*$/.test(entry.name)) {
        definitions.push([
          `custom:${entry.name}`,
          entry.name.replace(/-/g, " "),
          join(customRoot, entry.name),
        ]);
      }
    }
  }
  return definitions;
}

function playlistFolder(root: string, playlistId: string) {
  const folder = playlistDefinitions(root).find(
    ([id]) => id === playlistId,
  )?.[2];
  if (!folder) throw new Error("Unknown playlist");
  return folder;
}

function youtubeUrl(value: string) {
  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      [
        "youtube.com",
        "www.youtube.com",
        "music.youtube.com",
        "youtu.be",
        "www.youtu.be",
      ].includes(url.hostname)
    );
  } catch {
    return false;
  }
}

function spotifyUrl(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.hostname === "open.spotify.com";
  } catch {
    return false;
  }
}

interface SpotifyJob {
  id: string;
  url: string;
  playlistId: string;
  playlistName: string;
  targetDir: string;
  total: number;
  downloaded: number;
  existing: number;
  failed: number;
  currentTrack: string;
  percent: number;
  status: "starting" | "downloading" | "done" | "error";
  error?: string;
}

let activeSpotifyJob: SpotifyJob | null = null;

function startSpotifyDownload(
  root: string,
  url: string,
  playlistId?: string,
  playlistName?: string,
  createPlaylist?: boolean,
): SpotifyJob {
  if (!spotifyUrl(url))
    throw new Error("Only HTTPS open.spotify.com links can be imported");

  const pythonCandidate = resolve(
    import.meta.dirname,
    "..",
    ".venv",
    "bin",
    "python",
  );
  const pythonBinary = existsSync(pythonCandidate)
    ? pythonCandidate
    : (process.env.KOLO_PYTHON ?? "python3");
  const scriptPath = resolve(
    import.meta.dirname,
    "..",
    "kolo.2.ml",
    "download_playlist_latest.py",
  );

  const jobId = randomUUID();
  const job: SpotifyJob = {
    id: jobId,
    url,
    playlistId: playlistId ?? "custom:discover-weekly",
    playlistName: playlistName ?? "Discover Weekly",
    targetDir: "",
    total: 0,
    downloaded: 0,
    existing: 0,
    failed: 0,
    currentTrack: "",
    percent: 0,
    status: "starting",
  };
  activeSpotifyJob = job;

  const args = [scriptPath, "--url", url, "--json", "--all"];
  if (playlistId) args.push("--playlist-id", playlistId);
  if (playlistName) args.push("--playlist-name", playlistName);
  if (createPlaylist !== false) args.push("--create-playlist");

  const child = spawn(pythonBinary, args, {
    env: { ...process.env, KOLO_DATA_DIR: root },
    stdio: ["ignore", "pipe", "pipe"],
  });

  let lineBuffer = "";
  let errorBuffer = "";

  child.stdout?.on("data", (chunk: Buffer) => {
    lineBuffer += chunk.toString("utf8");
    const lines = lineBuffer.split("\n");
    lineBuffer = lines.pop() ?? "";

    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (!line.startsWith("{")) continue;
      try {
        const event = JSON.parse(line);
        if (event.type === "init") {
          job.playlistName = event.playlistName || job.playlistName;
          job.playlistId = event.playlistId || job.playlistId;
          job.targetDir = event.targetDir || "";
          job.total = event.total || 0;
          job.existing = event.alreadyPresent || 0;
          job.status = "downloading";
        } else if (event.type === "progress") {
          job.downloaded = event.downloaded || 0;
          job.failed = event.failed || 0;
          job.currentTrack = event.track || "";
          job.percent = event.percent || 0;
          job.status = "downloading";
        } else if (event.type === "done") {
          job.playlistName = event.playlistName || job.playlistName;
          job.playlistId = event.playlistId || job.playlistId;
          job.targetDir = event.targetDir || "";
          job.total = event.total || job.total;
          job.downloaded = event.downloaded || 0;
          job.existing = event.existing || 0;
          job.failed = event.failed || 0;
          job.percent = 100;
          job.status = "done";
        } else if (event.type === "error") {
          job.status = "error";
          job.error = event.error;
        }
      } catch {
        // ignore
      }
    }
  });

  child.stderr?.on("data", (chunk: Buffer) => {
    errorBuffer = (errorBuffer + chunk.toString()).slice(-1500);
  });

  child.on("error", (err) => {
    job.status = "error";
    job.error = err.message;
  });

  child.on("close", (code) => {
    if (job.status !== "done" && code !== 0) {
      job.status = "error";
      job.error = errorBuffer || `Downloader exited with code ${code}`;
    } else if (job.status !== "error") {
      job.status = "done";
      job.percent = 100;
    }
  });

  return job;
}

function triggerLoudnessScan(root: string, targetPath?: string) {
  const pythonCandidate = resolve(
    import.meta.dirname,
    "..",
    ".venv",
    "bin",
    "python",
  );
  const pythonBinary = existsSync(pythonCandidate)
    ? pythonCandidate
    : (process.env.KOLO_PYTHON ?? "python3");
  const scriptPath = resolve(
    import.meta.dirname,
    "..",
    "kolo.2.ml",
    "scan_loudness.py",
  );
  if (!existsSync(scriptPath)) return;
  const args = [scriptPath];
  if (targetPath) args.push(targetPath);
  try {
    const child = spawn(pythonBinary, args, {
      env: { ...process.env, KOLO_DATA_DIR: root },
      stdio: "ignore",
    });
    child.on("error", () => {});
  } catch {}
}

async function downloadYoutube(root: string, playlistId: string, url: string) {
  if (!youtubeUrl(url))
    throw new Error("Only HTTPS YouTube links can be downloaded");
  const folder = playlistFolder(root, playlistId);
  mkdirSync(folder, { recursive: true });
  const binary =
    process.env.KOLO_YT_DLP ??
    resolve(import.meta.dirname, "..", ".venv", "bin", "yt-dlp");
  const executable = existsSync(binary) ? binary : "yt-dlp";
  await new Promise<void>((done, fail) => {
    const child = spawn(
      executable,
      [
        "--no-playlist",
        "--restrict-filenames",
        "-x",
        "--audio-format",
        "mp3",
        "--audio-quality",
        "0",
        "--postprocessor-args",
        "ExtractAudio:-af loudnorm=I=-16:TP=-1.5:LRA=11",
        "-o",
        join(folder, "%(title)s-%(id)s.%(ext)s"),
        url,
      ],
      { stdio: ["ignore", "ignore", "pipe"] },
    );
    let errors = "";
    child.stderr.on("data", (chunk: Buffer) => {
      errors = (errors + chunk.toString()).slice(-1200);
    });
    child.on("error", fail);
    child.on("close", (code) => {
      if (code === 0) {
        triggerLoudnessScan(root, folder);
        done();
      } else {
        fail(new Error(errors || `yt-dlp exited with code ${code}`));
      }
    });
  });
}

function metadata(filename: string) {
  const clean = filename
    .replace(/\.[^/.]+$/, "")
    .replace(/_/g, " ")
    .trim();
  const separator = clean.indexOf(" - ");
  if (separator === -1) return { title: clean, artist: "Unknown artist" };
  return {
    artist: clean.slice(0, separator).trim(),
    title: clean.slice(separator + 3).trim(),
  };
}

function scanLibrary(root: string) {
  const ratings = readRatings(root);
  const likes = new Set(readLikes(root));
  const definitions = playlistDefinitions(root);
  let names: Record<string, string> = {};
  try {
    names = JSON.parse(
      readFileSync(join(root, ".kolo", "playlists.json"), "utf8"),
    ) as Record<string, string>;
  } catch {
    /* no custom names */
  }

  let clusterData: {
    tracks?: Record<string, { cluster: number; genre: string }>;
  } = {};
  try {
    clusterData = JSON.parse(
      readFileSync(join(root, ".kolo", "clusters.json"), "utf8"),
    ) as typeof clusterData;
  } catch {
    /* no clusters */
  }
  let loudnessData: Record<string, { lufs?: number; gain?: number }> = {};
  try {
    loudnessData = JSON.parse(
      readFileSync(join(root, ".kolo", "loudness.json"), "utf8"),
    ) as typeof loudnessData;
  } catch {
    /* no loudness */
  }
  let aiRatingsData: {
    ratings?: Record<string, { rating?: number; vibeScore?: number }>;
  } = {};
  try {
    aiRatingsData = JSON.parse(
      readFileSync(join(root, ".kolo", "ai_ratings.json"), "utf8"),
    ) as typeof aiRatingsData;
  } catch {
    /* no ai ratings */
  }
  const artDir = join(root, ".kolo", "artwork");

  mkdirSync(join(root, "imported"), { recursive: true });
  const tracks = definitions.flatMap(([playlistId, label, folder]) => {
    const name = playlistId.startsWith("custom:")
      ? (names[playlistId.slice(7)] ?? label)
      : label;
    if (!existsSync(folder)) return [];
    return readdirSync(folder, { withFileTypes: true })
      .filter(
        (entry) =>
          entry.isFile() &&
          AUDIO_EXTENSIONS.has(extname(entry.name).toLowerCase()),
      )
      .sort((left, right) => left.name.localeCompare(right.name))
      .map((entry) => {
        const sourcePath = join(folder, entry.name);
        const id = relative(root, sourcePath).split(sep).join("/");
        const stats = statSync(sourcePath);
        const idHash = createHash("sha1").update(id).digest("hex");
        const artFile = `${idHash}.jpg`;
        const hasArt = existsSync(join(artDir, artFile));
        const clusterInfo = clusterData.tracks?.[id];
        const loudnessInfo = loudnessData[id];
        const aiInfo = aiRatingsData.ratings?.[id];

        return {
          id,
          ...metadata(entry.name),
          album: name,
          duration: 0,
          sourcePath,
          playlistId,
          rating: ratings.ratings[id] ?? null,
          aiRating: typeof aiInfo?.rating === "number" ? aiInfo.rating : null,
          liked: likes.has(id),
          vibeScore:
            typeof aiInfo?.vibeScore === "number" ? aiInfo.vibeScore : null,
          audioUrl: `/@kolo-data/${encodeURIComponent(id)}`,
          artworkUrl: hasArt ? `/@kolo-data/.kolo/artwork/${artFile}` : null,
          mtime: stats.mtimeMs,
          cluster: clusterInfo?.cluster ?? null,
          genre: clusterInfo?.genre ?? null,
          gain:
            typeof loudnessInfo?.gain === "number" ? loudnessInfo.gain : 1.0,
          lufs:
            typeof loudnessInfo?.lufs === "number" ? loudnessInfo.lufs : null,
        };
      });
  });

  const playlists: Array<{ id: string; name: string; count: number }> =
    definitions.map(([id, label]) => ({
      id,
      name: id.startsWith("custom:") ? (names[id.slice(7)] ?? label) : label,
      count: tracks.filter((track) => track.playlistId === id).length,
    }));
  playlists.unshift({
    id: "liked",
    name: "Liked songs",
    count: tracks.filter((track) => track.liked).length,
  });

  return { dataRoot: root, playlists, tracks };
}

function readBody(request: NodeJS.ReadableStream): Promise<Buffer> {
  return new Promise((resolveBody, reject) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
    request.on("end", () => resolveBody(Buffer.concat(chunks)));
    request.on("error", reject);
  });
}

function uniqueTarget(folder: string, filename: string) {
  const safeName = filename.replace(/[\\/]/g, "_") || "imported-track.mp3";
  const extension = extname(safeName);
  const stem = safeName.slice(0, -extension.length) || "imported-track";
  let target = join(folder, safeName);
  let suffix = 2;
  while (existsSync(target))
    target = join(folder, `${stem} (${suffix++})${extension}`);
  return target;
}

function createLibraryMiddleware() {
  return async (request: any, response: any, next: any) => {
    if (!request.url) return next();
    response.setHeader("Access-Control-Allow-Origin", "*");
    response.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    response.setHeader("Access-Control-Allow-Headers", "Content-Type, Range");
    if (request.method === "OPTIONS") {
      response.statusCode = 204;
      response.end();
      return;
    }

    const url = new URL(request.url, "http://kolo.local");
    const root = dataRoot();

    try {
      if (
        request.method === "GET" &&
        (url.pathname === "/cluster-visualization" ||
          url.pathname === "/cluster_visualization.html")
      ) {
        const vizPath = resolve(
          import.meta.dirname,
          "public",
          "cluster_visualization.html",
        );
        if (existsSync(vizPath)) {
          response.setHeader("Content-Type", "text/html; charset=utf-8");
          createReadStream(vizPath).pipe(response);
          return;
        }
      }

      if (request.method === "GET" && url.pathname === "/api/library") {
        response.setHeader("Content-Type", "application/json");
        response.end(JSON.stringify(scanLibrary(root)));
        return;
      }

      if (request.method === "POST" && url.pathname === "/api/ratings") {
        const body = JSON.parse((await readBody(request)).toString("utf8")) as {
          trackId: string;
          rating: number | null;
        };
        const store = readRatings(root);
        if (body.rating === null) delete store.ratings[body.trackId];
        else if (body.rating >= 0.5 && body.rating <= 5)
          store.ratings[body.trackId] = Math.round(body.rating * 2) / 2;
        else throw new Error("Rating must be between 0.5 and 5");
        writeJson(statePath(root), store);
        response.statusCode = 204;
        response.end();
        return;
      }

      if (request.method === "POST" && url.pathname === "/api/likes") {
        const body = JSON.parse((await readBody(request)).toString("utf8")) as {
          trackId: string;
          liked: boolean;
        };
        if (
          !scanLibrary(root).tracks.some((track) => track.id === body.trackId)
        )
          throw new Error("Unknown track");
        const likes = new Set(readLikes(root));
        if (body.liked) likes.add(body.trackId);
        else likes.delete(body.trackId);
        writeJson(join(root, ".kolo", "likes.json"), [...likes]);
        response.statusCode = 204;
        response.end();
        return;
      }

      if (request.method === "POST" && url.pathname === "/api/playlists") {
        const body = JSON.parse((await readBody(request)).toString("utf8")) as {
          name: string;
        };
        const name = body.name?.trim();
        if (!name || name.length > 60 || !/^[\p{L}\p{N} _-]+$/u.test(name))
          throw new Error(
            "Use a short playlist name with letters, numbers, spaces or hyphens",
          );
        const slug =
          name
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, "-")
            .replace(/^-|-$/g, "") || "playlist";
        const id = `${slug}-${randomUUID().slice(0, 8)}`;
        mkdirSync(join(root, "playlists", id), { recursive: true });
        const namesPath = join(root, ".kolo", "playlists.json");
        let names: Record<string, string> = {};
        try {
          names = JSON.parse(readFileSync(namesPath, "utf8")) as Record<
            string,
            string
          >;
        } catch {
          /* no playlists yet */
        }
        names[id] = name;
        writeJson(namesPath, names);
        response.setHeader("Content-Type", "application/json");
        response.end(JSON.stringify({ id: `custom:${id}`, name, count: 0 }));
        return;
      }

      if (request.method === "POST" && url.pathname === "/api/youtube") {
        const body = JSON.parse((await readBody(request)).toString("utf8")) as {
          playlistId: string;
          url: string;
        };
        await downloadYoutube(root, body.playlistId, body.url);
        response.statusCode = 204;
        response.end();
        return;
      }

      if (request.method === "POST" && url.pathname === "/api/spotify") {
        const body = JSON.parse((await readBody(request)).toString("utf8")) as {
          url: string;
          playlistId?: string;
          playlistName?: string;
          createPlaylist?: boolean;
        };
        const job = startSpotifyDownload(
          root,
          body.url,
          body.playlistId,
          body.playlistName,
          body.createPlaylist,
        );
        response.statusCode = 202;
        response.setHeader("Content-Type", "application/json");
        response.end(JSON.stringify(job));
        return;
      }

      if (request.method === "GET" && url.pathname === "/api/spotify/status") {
        response.setHeader("Content-Type", "application/json");
        response.end(
          JSON.stringify(
            activeSpotifyJob
              ? { active: true, ...activeSpotifyJob }
              : { active: false },
          ),
        );
        return;
      }

      if (request.method === "POST" && url.pathname === "/api/import") {
        const filename = url.searchParams.get("name") ?? "imported-track.mp3";
        if (!AUDIO_EXTENSIONS.has(extname(filename).toLowerCase()))
          throw new Error("Unsupported audio format");
        const folder = playlistFolder(
          root,
          url.searchParams.get("playlistId") ?? "imported",
        );
        mkdirSync(folder, { recursive: true });
        const target = uniqueTarget(folder, filename);
        const output = createWriteStream(target);
        request.pipe(output);
        await new Promise<void>((resolveWrite, reject) => {
          output.on("finish", resolveWrite);
          output.on("error", reject);
          request.on("error", reject);
        });
        triggerLoudnessScan(root, target);
        response.setHeader("Content-Type", "application/json");
        response.end(JSON.stringify({ imported: 1 }));
        return;
      }

      if (request.method === "GET" && url.pathname.startsWith("/@kolo-data/")) {
        const id = decodeURIComponent(
          url.pathname.slice("/@kolo-data/".length),
        );
        const filePath = resolve(root, id);
        if (filePath !== root && !filePath.startsWith(`${root}${sep}`)) {
          response.statusCode = 403;
          response.end("Forbidden");
          return;
        }

        const stats = statSync(filePath);
        const range = request.headers.range;
        response.setHeader("Accept-Ranges", "bytes");
        response.setHeader(
          "Content-Type",
          MIME_TYPES[extname(filePath).toLowerCase()] ??
            "application/octet-stream",
        );

        if (range) {
          const [startValue, endValue] = range.replace("bytes=", "").split("-");
          const start = Number.parseInt(startValue, 10);
          const end = endValue ? Number.parseInt(endValue, 10) : stats.size - 1;
          if (isNaN(start) || start < 0 || start >= stats.size) {
            response.statusCode = 416;
            response.setHeader("Content-Range", `bytes */${stats.size}`);
            response.end();
            return;
          }
          const safeEnd = Math.min(end, stats.size - 1);
          response.statusCode = 206;
          response.setHeader(
            "Content-Range",
            `bytes ${start}-${safeEnd}/${stats.size}`,
          );
          response.setHeader("Content-Length", safeEnd - start + 1);
          const stream = createReadStream(filePath, { start, end: safeEnd });
          response.on("close", () => stream.destroy());
          stream.on("error", () => {
            if (!response.headersSent) response.statusCode = 500;
            response.end();
          });
          stream.pipe(response);
        } else {
          response.setHeader("Content-Length", stats.size);
          const stream = createReadStream(filePath);
          response.on("close", () => stream.destroy());
          stream.on("error", () => {
            if (!response.headersSent) response.statusCode = 500;
            response.end();
          });
          stream.pipe(response);
        }
        return;
      }
    } catch (error) {
      response.statusCode = 500;
      response.setHeader("Content-Type", "application/json");
      response.end(
        JSON.stringify({
          error: error instanceof Error ? error.message : String(error),
        }),
      );
      return;
    }

    next();
  };
}

export function koloLibraryPlugin(): Plugin {
  const middleware = createLibraryMiddleware();
  return {
    name: "kolo-local-library",
    configureServer(server) {
      server.middlewares.use(middleware);
    },
    configurePreviewServer(server) {
      server.middlewares.use(middleware);
    },
  };
}
