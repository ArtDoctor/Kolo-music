import { invoke, isTauri } from "@tauri-apps/api/core";
import { isSpotifyLink } from "./library";
import type { Job, JobKind } from "./types";

export interface DownloadRequest {
  url: string;
  playlistId?: string;
  playlistName?: string;
  createPlaylist?: boolean;
}

export interface RatingRequest {
  trackIds: string[];
  playlistId: string;
  playlistName: string;
}

export function isActiveJob(job: Job) {
  return job.status === "queued" || job.status === "running";
}

async function post<T>(path: string, body?: unknown): Promise<T> {
  const response = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!response.ok) {
    const data = (await response.json().catch(() => ({}))) as {
      error?: string;
    };
    throw new Error(data.error || "The request failed");
  }
  return (response.status === 204 ? undefined : await response.json()) as T;
}

// The Tauri commands run a helper to completion and report nothing in
// between, so the desktop shell tracks its jobs here: they run in parallel
// and show how they ended, but have no progress figures and cannot be stopped.
const desktopJobs = new Map<string, { job: Job; retry?: () => Job }>();

function runDesktopJob(
  kind: JobKind,
  title: string,
  playlistId: string | null,
  playlistName: string | null,
  task: (job: Job) => Promise<void>,
  retry?: () => Job,
): Job {
  const job: Job = {
    id: crypto.randomUUID(),
    kind,
    status: "running",
    title,
    detail: "Working…",
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
    cancellable: false,
    retryable: false,
    revision: 0,
    createdAt: Date.now(),
    finishedAt: null,
  };
  desktopJobs.set(job.id, { job, retry });
  void task(job)
    .then(() => {
      job.status = "done";
      job.percent = 100;
    })
    .catch((reason) => {
      job.status = "error";
      job.error = reason instanceof Error ? reason.message : String(reason);
      job.retryable = Boolean(retry);
    })
    .finally(() => {
      job.revision += 1;
      job.finishedAt = Date.now();
    });
  return job;
}

function startDesktopDownload(request: DownloadRequest): Job {
  const retry = () => startDesktopDownload(request);
  if (isSpotifyLink(request.url)) {
    return runDesktopJob(
      "spotify",
      "Spotify import",
      request.playlistId ?? null,
      request.playlistName ?? null,
      async (job) => {
        const summary = await invoke<string>("download_spotify", {
          url: request.url,
          playlistId: request.playlistId ?? null,
          playlistName: null,
          createPlaylist: request.createPlaylist ?? true,
        });
        // The command returns the downloader's closing progress event.
        const result = JSON.parse(summary || "{}") as {
          playlistId?: string;
          playlistName?: string;
          downloaded?: number;
          existing?: number;
          failed?: number;
        };
        job.playlistId = result.playlistId ?? job.playlistId;
        job.playlistName = job.playlistName ?? result.playlistName ?? null;
        job.completed = result.downloaded ?? 0;
        job.skipped = result.existing ?? 0;
        job.failed = result.failed ?? 0;
        job.detail = `Added ${job.completed} ${job.completed === 1 ? "song" : "songs"}`;
        if (job.failed) job.detail += ` · ${job.failed} not found`;
      },
      retry,
    );
  }
  const playlistId = request.playlistId ?? "imported";
  return runDesktopJob(
    "youtube",
    request.url.replace(/^https:\/\/(www\.)?/, ""),
    playlistId,
    request.playlistName ?? null,
    async (job) => {
      await invoke<void>("download_youtube", { playlistId, url: request.url });
      job.completed = 1;
      job.detail = request.playlistName
        ? `Added to ${request.playlistName}`
        : "Added";
    },
    retry,
  );
}

export async function listJobs(): Promise<Job[]> {
  if (isTauri())
    return [...desktopJobs.values()].map(({ job }) => ({ ...job }));
  const response = await fetch("/api/jobs");
  if (!response.ok) throw new Error("Could not load activity");
  return ((await response.json()) as { jobs: Job[] }).jobs;
}

export async function startDownload(request: DownloadRequest): Promise<Job> {
  if (isTauri()) return startDesktopDownload(request);
  return post<Job>("/api/jobs/download", {
    url: request.url,
    playlistId: request.playlistId,
    createPlaylist: request.createPlaylist,
  });
}

export async function startRating(request: RatingRequest): Promise<Job> {
  if (isTauri()) {
    return runDesktopJob(
      "rating",
      "Rate unrated songs",
      request.playlistId,
      request.playlistName,
      async (job) => {
        const summary = await invoke<string>("rate_tracks", {
          trackIds: request.trackIds,
        });
        const result = JSON.parse(summary || "{}") as {
          rated?: number;
          failed?: number;
        };
        job.completed = result.rated ?? 0;
        job.failed = result.failed ?? 0;
        job.detail = `Rated ${job.completed} ${job.completed === 1 ? "song" : "songs"}`;
        if (job.failed) job.detail += ` · ${job.failed} could not be read`;
      },
    );
  }
  return post<Job>("/api/jobs/rating", request);
}

export async function cancelJob(id: string) {
  if (!isTauri()) await post(`/api/jobs/${encodeURIComponent(id)}/cancel`);
}

export async function retryJob(id: string) {
  if (isTauri()) {
    const entry = desktopJobs.get(id);
    desktopJobs.delete(id);
    entry?.retry?.();
    return;
  }
  await post(`/api/jobs/${encodeURIComponent(id)}/retry`);
}

export async function dismissJob(id: string) {
  if (isTauri()) desktopJobs.delete(id);
  else await post(`/api/jobs/${encodeURIComponent(id)}/dismiss`);
}

export async function clearFinishedJobs() {
  if (isTauri()) {
    for (const [id, { job }] of desktopJobs) {
      if (!isActiveJob(job)) desktopJobs.delete(id);
    }
    return;
  }
  await post("/api/jobs/clear");
}
