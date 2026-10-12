import { spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import type { Job, JobKind } from "./src/types";

// Each download already runs its own FFmpeg conversions, and a Spotify import
// uses four workers, so a few jobs at once is as much as a laptop handles well.
const DOWNLOAD_SLOTS = 3;
// The embedding model fills most of a GPU; rating runs take turns.
const RATING_SLOTS = 1;
const MAX_FINISHED_JOBS = 30;
const MAX_LISTED_FAILURES = 50;

const repoRoot = resolve(import.meta.dirname, "..");

type Lane = "download" | "rating";

interface JobRecord {
  job: Job;
  lane: Lane;
  // Two requests with the same key are the same piece of work.
  key: string;
  run: (record: JobRecord) => Promise<void>;
  retry?: () => Job;
  child: ChildProcess | null;
  // Cancellation changes the visible status before the helper has exited.
  executing?: boolean;
  trackIds?: string[];
}

interface HelperOptions {
  env?: NodeJS.ProcessEnv;
  stdin?: string;
  onLine: (line: string) => void;
}

const records = new Map<string, JobRecord>();

function killHelper(child: ChildProcess, signal: NodeJS.Signals = "SIGTERM") {
  // Helpers launch FFmpeg and other descendants. Stop the whole process group
  // on Unix so a cancelled conversion cannot keep writing files in the background.
  try {
    if (process.platform !== "win32" && child.pid)
      process.kill(-child.pid, signal);
    else child.kill(signal);
  } catch {
    // The process may already have exited.
  }
}

process.once("exit", () => {
  for (const record of records.values()) {
    if (record.child) killHelper(record.child);
  }
});

export function pythonBinary() {
  if (process.env.KOLO_PYTHON) return process.env.KOLO_PYTHON;
  const candidate = join(repoRoot, ".venv", "bin", "python");
  return existsSync(candidate) ? candidate : "python3";
}

function ytDlpBinary() {
  const binary =
    process.env.KOLO_YT_DLP ?? join(repoRoot, ".venv", "bin", "yt-dlp");
  return existsSync(binary) ? binary : "yt-dlp";
}

function helperScript(name: string) {
  return join(repoRoot, "kolo.2.ml", name);
}

export function youtubeUrl(value: string) {
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

export function spotifyUrl(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.hostname === "open.spotify.com";
  } catch {
    return false;
  }
}

// Measures tracks that have no loudness entry yet. Resolves when the scan
// ends, whether or not it succeeded.
export function triggerLoudnessScan(
  root: string,
  targetPath?: string,
  record?: JobRecord,
): Promise<void> {
  const scriptPath = helperScript("scan_loudness.py");
  if (!existsSync(scriptPath)) return Promise.resolve();
  const args = [scriptPath, "--data-root", root];
  if (targetPath) args.push(targetPath);
  if (record)
    return runHelper(record, pythonBinary(), args, { onLine() {} }).catch(
      () => {},
    );
  return new Promise<void>((done) => {
    try {
      const child = spawn(pythonBinary(), args, { stdio: "ignore" });
      child.on("error", () => done());
      child.on("close", () => done());
    } catch {
      done();
    }
  });
}

function isActive(job: Job) {
  return job.status === "queued" || job.status === "running";
}

function count(value: number, noun: string) {
  return `${value} ${noun}${value === 1 ? "" : "s"}`;
}

function megabytes(bytes: number) {
  return (bytes / 1_048_576).toFixed(1);
}

// Helpers print tracebacks and warnings; the last error line is the cause.
function errorSummary(stderr: string) {
  const lines = stderr
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  const line =
    lines.filter((item) => item.startsWith("ERROR:")).at(-1) ??
    lines.at(-1) ??
    "";
  return line.replace(/^ERROR:\s*/, "").slice(0, 300);
}

function runHelper(
  record: JobRecord,
  command: string,
  args: string[],
  options: HelperOptions,
) {
  return new Promise<void>((done, fail) => {
    const child = spawn(command, args, {
      env: options.env ?? process.env,
      detached: process.platform !== "win32",
      stdio: [options.stdin === undefined ? "ignore" : "pipe", "pipe", "pipe"],
    });
    record.child = child;
    let buffered = "";
    let errors = "";
    child.stdout?.on("data", (chunk: Buffer) => {
      buffered += chunk.toString("utf8");
      const lines = buffered.split("\n");
      buffered = lines.pop() ?? "";
      for (const line of lines) options.onLine(line.trim());
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      errors = (errors + chunk.toString("utf8")).slice(-4000);
    });
    child.on("error", (error: NodeJS.ErrnoException) => {
      record.child = null;
      fail(
        error.code === "ENOENT"
          ? new Error(`${basename(command)} is not installed`)
          : error,
      );
    });
    child.on("close", (code) => {
      record.child = null;
      if (buffered.trim()) options.onLine(buffered.trim());
      if (code === 0) done();
      else
        fail(
          new Error(
            errorSummary(errors) ||
              `${basename(command)} exited with code ${code}`,
          ),
        );
    });
    // A helper that exits early closes its stdin; that is reported by "close".
    child.stdin?.on("error", () => {});
    if (options.stdin !== undefined) child.stdin?.end(options.stdin);
  });
}

function newJob(
  kind: JobKind,
  title: string,
  playlistId: string | null,
  playlistName: string | null,
): Job {
  return {
    id: randomUUID(),
    kind,
    status: "queued",
    title,
    detail: "Waiting for a free slot…",
    playlistId,
    playlistName,
    total: 0,
    completed: 0,
    failed: 0,
    skipped: 0,
    percent: null,
    active: [],
    failures: [],
    error: null,
    cancellable: true,
    retryable: false,
    revision: 0,
    createdAt: Date.now(),
    finishedAt: null,
  };
}

function enqueue(record: JobRecord): Job {
  for (const existing of records.values()) {
    if (existing.key === record.key && isActive(existing.job))
      return existing.job;
  }
  records.set(record.job.id, record);
  const finished = [...records.values()].filter(
    (item) => !isActive(item.job) && !item.executing,
  );
  for (const stale of finished.slice(0, -MAX_FINISHED_JOBS))
    records.delete(stale.job.id);
  pump();
  return record.job;
}

function pump() {
  const lanes: Array<[Lane, number]> = [
    ["download", DOWNLOAD_SLOTS],
    ["rating", RATING_SLOTS],
  ];
  for (const [lane, slots] of lanes) {
    const inLane = [...records.values()].filter((item) => item.lane === lane);
    let running = inLane.filter((item) => item.executing).length;
    for (const record of inLane) {
      if (running >= slots) break;
      if (record.job.status !== "queued") continue;
      running += 1;
      void execute(record);
    }
  }
}

async function execute(record: JobRecord) {
  const { job } = record;
  job.status = "running";
  record.executing = true;
  job.detail = "Starting…";
  try {
    await record.run(record);
    if (job.status === "running") {
      job.status = "done";
      job.percent = 100;
    }
  } catch (error) {
    // A cancelled helper also exits with an error; that is not a failure.
    if (job.status === "running") {
      job.status = "error";
      job.error = error instanceof Error ? error.message : String(error);
      job.percent = null;
    }
  } finally {
    record.child = null;
    record.executing = false;
    job.active = [];
    job.cancellable = false;
    job.retryable =
      Boolean(record.retry) && (job.status !== "done" || job.failed > 0);
    job.finishedAt ??= Date.now();
    pump();
  }
}

export function listJobs(): Job[] {
  return [...records.values()].map((record) => record.job);
}

export function cancelJob(id: string): Job {
  const record = records.get(id);
  if (!record) throw new Error("Unknown job");
  const { job } = record;
  if (!isActive(job)) return job;
  job.status = "cancelled";
  job.detail = "Cancelled";
  job.percent = null;
  job.active = [];
  job.cancellable = false;
  job.retryable = Boolean(record.retry);
  job.finishedAt = Date.now();
  const child = record.child;
  if (child) {
    killHelper(child);
    const forceKill = setTimeout(() => killHelper(child, "SIGKILL"), 5000);
    child.once("close", () => clearTimeout(forceKill));
  }
  pump();
  return job;
}

export function retryJob(id: string): Job {
  const record = records.get(id);
  if (!record) throw new Error("Unknown job");
  if (!record.retry || isActive(record.job))
    throw new Error("This job cannot be retried");
  if (record.executing)
    throw new Error(
      "The cancelled helper is still stopping. Try again shortly.",
    );
  records.delete(id);
  return record.retry();
}

export function dismissJob(id: string) {
  const record = records.get(id);
  if (record && (isActive(record.job) || record.executing))
    throw new Error("Cancel the job before dismissing it");
  records.delete(id);
}

export function clearFinishedJobs() {
  for (const [id, record] of records) {
    if (!isActive(record.job) && !record.executing) records.delete(id);
  }
}

interface YoutubeInput {
  root: string;
  url: string;
  playlistId: string;
  playlistName: string;
  folder: string;
}

export function startYoutubeDownload(input: YoutubeInput): Job {
  if (!youtubeUrl(input.url))
    throw new Error("Only HTTPS YouTube links can be downloaded");
  // The link stands in for the title until yt-dlp reports the real one.
  const job = newJob(
    "youtube",
    input.url.replace(/^https:\/\/(www\.)?/, ""),
    input.playlistId,
    input.playlistName,
  );
  job.total = 1;
  return enqueue({
    job,
    lane: "download",
    key: `youtube:${input.url}:${input.playlistId}`,
    child: null,
    run: (record) => runYoutube(record, input),
    retry: () => startYoutubeDownload(input),
  });
}

async function runYoutube(record: JobRecord, input: YoutubeInput) {
  const { job } = record;
  const staging = join(input.root, ".kolo", "tmp", job.id);
  mkdirSync(input.folder, { recursive: true });
  mkdirSync(staging, { recursive: true });
  let savedPath = "";
  job.detail = "Looking up the video…";
  try {
    await runHelper(
      record,
      ytDlpBinary(),
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
        // Partial and unconverted files stay out of the playlist folder, so
        // a library scan never lists them.
        "-P",
        `home:${input.folder}`,
        "-P",
        `temp:${staging}`,
        "-o",
        "%(title)s-%(id)s.%(ext)s",
        "--newline",
        "--progress",
        "--progress-template",
        "download:KOLO_PROGRESS %(progress.downloaded_bytes)s %(progress.total_bytes)s %(progress.total_bytes_estimate)s",
        "--print",
        "before_dl:KOLO_TITLE %(title)s",
        "--print",
        "post_process:KOLO_CONVERT %(id)s",
        "--print",
        "after_move:KOLO_FILE %(filepath)s",
        input.url,
      ],
      {
        onLine(line) {
          if (job.status !== "running") return;
          if (line.startsWith("KOLO_TITLE ")) {
            job.title = line.slice("KOLO_TITLE ".length);
            job.detail = "Starting download…";
          } else if (line.startsWith("KOLO_PROGRESS ")) {
            // yt-dlp prints "NA" for sizes it does not know.
            const [downloaded, total, estimate] = line
              .slice("KOLO_PROGRESS ".length)
              .split(" ")
              .map(Number);
            const size = Number.isFinite(total) ? total : estimate;
            if (!Number.isFinite(downloaded)) return;
            if (Number.isFinite(size) && size > 0) {
              job.percent = Math.min(100, (downloaded / size) * 100);
              job.detail = `Downloading · ${megabytes(downloaded)} of ${megabytes(size)} MB`;
            } else {
              job.percent = null;
              job.detail = `Downloading · ${megabytes(downloaded)} MB`;
            }
          } else if (line.startsWith("KOLO_CONVERT ")) {
            job.percent = null;
            job.detail = "Converting to MP3…";
          } else if (line.startsWith("KOLO_FILE ")) {
            savedPath = line.slice("KOLO_FILE ".length);
          }
        },
      },
    );
    if (job.status !== "running") return;
    job.percent = null;
    job.detail = "Measuring loudness…";
    await triggerLoudnessScan(input.root, savedPath || input.folder, record);
    if (job.status !== "running") return;
    job.completed = 1;
    job.revision += 1;
    job.detail = `Added to ${input.playlistName}`;
  } finally {
    rmSync(staging, { recursive: true, force: true });
  }
}

interface SpotifyInput {
  root: string;
  url: string;
  // Without a target, the import creates a playlist named after the collection.
  playlistId?: string;
  playlistName?: string;
  createPlaylist: boolean;
}

export function startSpotifyImport(input: SpotifyInput): Job {
  if (!spotifyUrl(input.url))
    throw new Error("Only HTTPS open.spotify.com links can be imported");
  const job = newJob(
    "spotify",
    "Spotify import",
    input.playlistId ?? null,
    input.playlistName ?? null,
  );
  return enqueue({
    job,
    lane: "download",
    key: `spotify:${input.url}:${input.playlistId ?? "new"}`,
    child: null,
    run: (record) => runSpotify(record, input),
    // The downloader skips songs that are already there, so a retry into the
    // same playlist only fetches what is missing.
    retry: () =>
      startSpotifyImport({
        ...input,
        playlistId: job.playlistId ?? undefined,
        playlistName: job.playlistName ?? undefined,
        createPlaylist: job.playlistId ? false : input.createPlaylist,
      }),
  });
}

function importSummary(job: Job) {
  if (!job.completed && !job.failed && job.skipped)
    return `Already up to date · ${count(job.skipped, "song")}`;
  const parts = [`Added ${count(job.completed, "song")}`];
  if (job.skipped) parts.push(`${job.skipped} already there`);
  if (job.failed) parts.push(`${job.failed} not found`);
  return parts.join(" · ");
}

async function runSpotify(record: JobRecord, input: SpotifyInput) {
  const { job } = record;
  const args = [
    helperScript("download_playlist_latest.py"),
    "--url",
    input.url,
    "--json",
    "--all",
  ];
  if (input.playlistId) args.push("--playlist-id", input.playlistId);
  if (input.createPlaylist) args.push("--create-playlist");

  let targetDir = "";
  let scriptError = "";
  job.detail = "Reading the Spotify link…";
  try {
    await runHelper(record, pythonBinary(), args, {
      env: { ...process.env, KOLO_DATA_DIR: input.root },
      onLine(line) {
        if (job.status !== "running" || !line.startsWith("{")) return;
        let event: Record<string, any>;
        try {
          event = JSON.parse(line);
        } catch {
          return;
        }
        if (event.type === "init") {
          job.title = event.title || event.playlistName || job.title;
          job.playlistId = event.playlistId || job.playlistId;
          // A playlist the user picked keeps the name the app shows for it.
          if (!input.playlistName)
            job.playlistName = event.playlistName || job.playlistName;
          targetDir = event.targetDir || "";
          job.total = event.toDownload || 0;
          job.skipped = event.alreadyPresent || 0;
          job.percent = 0;
          job.detail = "Finding matching audio…";
          // A new playlist folder exists now; let the sidebar show it.
          job.revision += 1;
        } else if (event.type === "start") {
          job.active.push(String(event.track));
          job.detail = "";
        } else if (event.type === "progress") {
          const track = String(event.track);
          const index = job.active.indexOf(track);
          if (index !== -1) job.active.splice(index, 1);
          job.completed = event.downloaded || 0;
          job.failed = event.failed || 0;
          job.percent = event.percent || 0;
          if (event.success) job.revision += 1;
          else if (job.failures.length < MAX_LISTED_FAILURES)
            job.failures.push(track);
        } else if (event.type === "done") {
          job.completed = event.downloaded || 0;
          job.failed = event.failed || 0;
          job.skipped = event.existing || 0;
        } else if (event.type === "error") {
          scriptError = String(event.error);
        }
      },
    });
  } catch (error) {
    throw scriptError ? new Error(scriptError) : error;
  }
  if (scriptError) throw new Error(scriptError);
  if (job.status !== "running") return;
  job.active = [];
  job.percent = null;
  job.detail = "Measuring loudness…";
  // Finish only once the new tracks have gains, so the client's final
  // library refresh picks them up.
  await triggerLoudnessScan(input.root, targetDir || undefined, record);
  if (job.status !== "running") return;
  job.revision += 1;
  job.detail = importSummary(job);
}

interface RatingInput {
  root: string;
  trackIds: string[];
  playlistId: string | null;
  playlistName: string | null;
}

export function startRating(input: RatingInput): Job {
  // Songs an earlier request is still working through are not rated twice.
  const claimed = new Set<string>();
  let lastActive: Job | null = null;
  for (const record of records.values()) {
    if (record.lane !== "rating" || !isActive(record.job)) continue;
    lastActive = record.job;
    for (const id of record.trackIds ?? []) claimed.add(id);
  }
  const trackIds = input.trackIds.filter((id) => !claimed.has(id));
  if (!trackIds.length) {
    if (lastActive) return lastActive;
    throw new Error("There are no songs to rate");
  }
  const job = newJob(
    "rating",
    "Rate unrated songs",
    input.playlistId,
    input.playlistName,
  );
  job.total = trackIds.length;
  return enqueue({
    job,
    lane: "rating",
    key: `rating:${job.id}`,
    child: null,
    trackIds,
    run: (record) => runRating(record, input.root, trackIds),
  });
}

async function runRating(record: JobRecord, root: string, trackIds: string[]) {
  const { job } = record;
  let scriptError = "";
  job.detail = "Preparing…";
  try {
    await runHelper(
      record,
      pythonBinary(),
      [
        helperScript("rate_tracks.py"),
        "--data-root",
        root,
        "--ids-stdin",
        "--json",
      ],
      {
        stdin: JSON.stringify(trackIds),
        onLine(line) {
          if (job.status !== "running" || !line.startsWith("{")) return;
          let event: Record<string, any>;
          try {
            event = JSON.parse(line);
          } catch {
            return;
          }
          if (event.type === "init") {
            job.total = event.total || 0;
            job.skipped = event.skipped || 0;
            job.percent = 0;
            job.detail = "";
          } else if (event.type === "start") {
            job.active = [String(event.track)];
          } else if (event.type === "stage") {
            job.detail = "Loading the audio model…";
          } else if (event.type === "progress") {
            job.active = [];
            job.detail = "";
            job.completed = event.rated || 0;
            job.failed = event.failed || 0;
            job.percent = job.total ? (event.current / job.total) * 100 : 0;
            // Each estimate is on disk already; the list can show it.
            if (event.success) job.revision += 1;
            else if (job.failures.length < MAX_LISTED_FAILURES)
              job.failures.push(String(event.track));
          } else if (event.type === "done") {
            job.completed = event.rated || 0;
            job.failed = event.failed || 0;
            job.skipped = event.skipped || 0;
          } else if (event.type === "error") {
            scriptError = String(event.error);
          }
        },
      },
    );
  } catch (error) {
    throw scriptError ? new Error(scriptError) : error;
  }
  if (scriptError) throw new Error(scriptError);
  if (job.status !== "running") return;
  job.revision += 1;
  if (!job.completed && !job.failed) {
    job.detail = "Every song here already has a rating";
    return;
  }
  job.detail = `Rated ${count(job.completed, "song")}`;
  if (job.failed) job.detail += ` · ${job.failed} could not be read`;
}
