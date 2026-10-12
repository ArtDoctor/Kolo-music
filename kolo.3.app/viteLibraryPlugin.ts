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
import { dirname, extname, join, relative, resolve, sep } from "node:path";
import type { Plugin } from "vite";
import {
  cancelJob,
  clearFinishedJobs,
  dismissJob,
  listJobs,
  retryJob,
  spotifyUrl,
  startRating,
  startSpotifyImport,
  startYoutubeDownload,
  triggerLoudnessScan,
  youtubeUrl,
} from "./viteJobs";

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

function playlistLabel(root: string, playlistId: string) {
  const label = playlistDefinitions(root).find(
    ([id]) => id === playlistId,
  )?.[1];
  if (!label) throw new Error("Unknown playlist");
  if (!playlistId.startsWith("custom:")) return label;
  try {
    const names = JSON.parse(
      readFileSync(join(root, ".kolo", "playlists.json"), "utf8"),
    ) as Record<string, string>;
    return names[playlistId.slice(7)] ?? label;
  } catch {
    return label;
  }
}

function isLibraryAudio(root: string, trackId: string) {
  const filePath = resolve(root, trackId);
  return (
    filePath.startsWith(`${root}${sep}`) &&
    AUDIO_EXTENSIONS.has(extname(filePath).toLowerCase()) &&
    existsSync(filePath)
  );
}

function sendJson(response: any, statusCode: number, value: unknown) {
  response.statusCode = statusCode;
  response.setHeader("Content-Type", "application/json");
  response.end(JSON.stringify(value));
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
  // Tracks the scanner has not measured yet get the library's typical gain
  // instead of playing at their raw level.
  const knownGains = Object.values(loudnessData)
    .map((entry) => entry?.gain)
    .filter((gain): gain is number => typeof gain === "number")
    .sort((left, right) => left - right);
  const fallbackGain = knownGains.length
    ? knownGains[Math.floor(knownGains.length / 2)]
    : 1.0;
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
            typeof loudnessInfo?.gain === "number"
              ? loudnessInfo.gain
              : fallbackGain,
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

      if (request.method === "GET" && url.pathname === "/api/jobs") {
        sendJson(response, 200, { jobs: listJobs() });
        return;
      }

      if (request.method === "POST" && url.pathname === "/api/jobs/download") {
        const body = JSON.parse((await readBody(request)).toString("utf8")) as {
          url: string;
          playlistId?: string;
          createPlaylist?: boolean;
        };
        if (youtubeUrl(body.url)) {
          const playlistId = body.playlistId ?? "imported";
          sendJson(
            response,
            202,
            startYoutubeDownload({
              root,
              url: body.url,
              playlistId,
              playlistName: playlistLabel(root, playlistId),
              folder: playlistFolder(root, playlistId),
            }),
          );
        } else if (spotifyUrl(body.url)) {
          sendJson(
            response,
            202,
            startSpotifyImport({
              root,
              url: body.url,
              playlistId: body.playlistId,
              playlistName: body.playlistId
                ? playlistLabel(root, body.playlistId)
                : undefined,
              createPlaylist: body.createPlaylist !== false,
            }),
          );
        } else {
          throw new Error(
            "Only HTTPS YouTube and open.spotify.com links can be downloaded",
          );
        }
        return;
      }

      if (request.method === "POST" && url.pathname === "/api/jobs/rating") {
        const body = JSON.parse((await readBody(request)).toString("utf8")) as {
          trackIds: unknown;
          playlistId?: string;
          playlistName?: string;
        };
        const requested = Array.isArray(body.trackIds) ? body.trackIds : [];
        const trackIds = [...new Set(requested)].filter(
          (id): id is string =>
            typeof id === "string" && isLibraryAudio(root, id),
        );
        sendJson(
          response,
          202,
          startRating({
            root,
            trackIds,
            playlistId:
              typeof body.playlistId === "string" ? body.playlistId : null,
            playlistName:
              typeof body.playlistName === "string"
                ? body.playlistName.slice(0, 80)
                : null,
          }),
        );
        return;
      }

      if (request.method === "POST" && url.pathname === "/api/jobs/clear") {
        clearFinishedJobs();
        response.statusCode = 204;
        response.end();
        return;
      }

      const jobAction =
        request.method === "POST"
          ? /^\/api\/jobs\/([^/]+)\/(cancel|retry|dismiss)$/.exec(url.pathname)
          : null;
      if (jobAction) {
        const [, id, action] = jobAction;
        if (action === "cancel") sendJson(response, 200, cancelJob(id));
        else if (action === "retry") sendJson(response, 202, retryJob(id));
        else {
          dismissJob(id);
          response.statusCode = 204;
          response.end();
        }
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
        await triggerLoudnessScan(root, target);
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
  // Catch up on tracks added outside the app (download scripts, manual
  // copies). Only when serving: a build must not start a scan.
  const scanOnStart = () => void triggerLoudnessScan(dataRoot());
  return {
    name: "kolo-local-library",
    configureServer(server) {
      server.middlewares.use(middleware);
      scanOnStart();
    },
    configurePreviewServer(server) {
      server.middlewares.use(middleware);
      scanOnStart();
    },
  };
}
