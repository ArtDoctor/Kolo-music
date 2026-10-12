import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react";
import {
  cancelJob,
  clearFinishedJobs,
  dismissJob,
  isActiveJob,
  listJobs,
  retryJob,
  startDownload,
  startRating,
  type DownloadRequest,
  type RatingRequest,
} from "../jobs";
import type { Job, LibrarySnapshot } from "../types";

const POLL_INTERVAL_MS = 700;
// Jobs report every finished song; reloading the library that often would
// make a long import sluggish.
const REFRESH_INTERVAL_MS = 1500;

interface JobsOptions {
  refreshLibrary: () => Promise<LibrarySnapshot | undefined>;
  setNotice: Dispatch<SetStateAction<string | null>>;
}

function message(reason: unknown, fallback: string) {
  return reason instanceof Error ? reason.message : fallback;
}

function finishedNotice(job: Job) {
  if (job.status === "error")
    return `${job.title} failed: ${job.error ?? "unknown error"}`.slice(0, 160);
  if (job.kind === "youtube")
    return `Added “${job.title}” to ${job.playlistName ?? "your library"}.`;
  if (job.kind === "spotify") return `${job.title}: ${job.detail}`;
  return `${job.detail}.`;
}

export function useJobs({ refreshLibrary, setNotice }: JobsOptions) {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [activityOpen, setActivityOpen] = useState(false);
  const seenRef = useRef(new Map<string, Pick<Job, "status" | "revision">>());
  const lastRefreshRef = useRef(0);
  const refreshTimerRef = useRef<number | null>(null);

  const syncJobs = useCallback(async () => {
    try {
      setJobs(await listJobs());
    } catch {
      // The next poll tries again.
    }
  }, []);

  // Jobs outlive the page, so a reload picks up whatever is still running.
  useEffect(() => {
    void syncJobs();
  }, [syncJobs]);

  useEffect(
    () => () => {
      if (refreshTimerRef.current !== null)
        window.clearTimeout(refreshTimerRef.current);
    },
    [],
  );

  const hasActiveJobs = jobs.some(isActiveJob);
  useEffect(() => {
    if (!hasActiveJobs) return;
    const timer = window.setInterval(() => void syncJobs(), POLL_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [hasActiveJobs, syncJobs]);

  useEffect(() => {
    if (!jobs.length) setActivityOpen(false);
  }, [jobs.length]);

  useEffect(() => {
    const seen = seenRef.current;
    let libraryChanged = false;
    for (const job of jobs) {
      const previous = seen.get(job.id);
      if (job.revision > (previous?.revision ?? 0)) libraryChanged = true;
      if (
        previous &&
        (previous.status === "queued" || previous.status === "running") &&
        (job.status === "done" || job.status === "error")
      )
        setNotice(finishedNotice(job));
      seen.set(job.id, { status: job.status, revision: job.revision });
    }
    for (const id of seen.keys()) {
      if (!jobs.some((job) => job.id === id)) seen.delete(id);
    }
    if (!libraryChanged || refreshTimerRef.current !== null) return;
    const wait = Math.max(
      0,
      REFRESH_INTERVAL_MS - (Date.now() - lastRefreshRef.current),
    );
    refreshTimerRef.current = window.setTimeout(() => {
      refreshTimerRef.current = null;
      lastRefreshRef.current = Date.now();
      void refreshLibrary();
    }, wait);
  }, [jobs, refreshLibrary, setNotice]);

  // A job can finish before the first poll sees it; remembering it as started
  // keeps its completion notice.
  const remember = useCallback((job: Job) => {
    if (!seenRef.current.has(job.id))
      seenRef.current.set(job.id, { status: "queued", revision: 0 });
  }, []);

  const download = useCallback(
    async (requests: DownloadRequest[]) => {
      const results = await Promise.allSettled(requests.map(startDownload));
      let started = 0;
      for (const result of results) {
        if (result.status === "fulfilled") {
          remember(result.value);
          started += 1;
        } else {
          setNotice(message(result.reason, "Could not start the download."));
        }
      }
      await syncJobs();
      return started;
    },
    [remember, setNotice, syncJobs],
  );

  const rate = useCallback(
    async (request: RatingRequest) => {
      try {
        remember(await startRating(request));
      } catch (reason) {
        setNotice(message(reason, "Could not start rating."));
      }
      await syncJobs();
    },
    [remember, setNotice, syncJobs],
  );

  const act = useCallback(
    async (action: () => Promise<void>) => {
      try {
        await action();
      } catch (reason) {
        setNotice(message(reason, "That did not work."));
      }
      await syncJobs();
    },
    [setNotice, syncJobs],
  );

  const cancel = useCallback((id: string) => act(() => cancelJob(id)), [act]);
  const retry = useCallback((id: string) => act(() => retryJob(id)), [act]);
  const dismiss = useCallback((id: string) => act(() => dismissJob(id)), [act]);
  const clearFinished = useCallback(() => act(clearFinishedJobs), [act]);

  return {
    jobs,
    activityOpen,
    setActivityOpen,
    download,
    rate,
    cancel,
    retry,
    dismiss,
    clearFinished,
  };
}
