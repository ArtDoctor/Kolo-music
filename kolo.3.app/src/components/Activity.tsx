import {
  AlertTriangle,
  Ban,
  Check,
  Download,
  LoaderCircle,
  RotateCcw,
  Sparkles,
  X,
} from "lucide-react";
import { isActiveJob } from "../jobs";
import type { Job, JobKind } from "../types";

const SOURCE_LABELS: Record<JobKind, string> = {
  youtube: "YouTube",
  spotify: "Spotify",
  rating: "Rating model",
};

export interface JobActions {
  onCancel: (id: string) => void;
  onRetry: (id: string) => void;
  onDismiss: (id: string) => void;
  onOpenPlaylist: (playlistId: string) => void;
  onClearFinished: () => void;
}

interface JobListProps extends JobActions {
  jobs: Job[];
  // The playlist on screen; a job that fills it needs no link to it.
  currentPlaylistId?: string;
}

interface ActivityProps extends JobListProps {
  open: boolean;
  onToggle: () => void;
}

function jobIcon(job: Job) {
  if (job.status === "done") return Check;
  if (job.status === "error") return AlertTriangle;
  if (job.status === "cancelled") return Ban;
  return job.kind === "rating" ? Sparkles : Download;
}

function statusLine(job: Job) {
  if (job.status === "error") return job.error ?? "Something went wrong";
  if (job.detail || !job.active.length) return job.detail;
  const shown = job.active.slice(0, 2).join(" · ");
  const more = job.active.length > 2 ? ` · +${job.active.length - 2} more` : "";
  return `${job.kind === "rating" ? "Rating" : "Downloading"} ${shown}${more}`;
}

// Collections count songs; a single file shows how much of it has arrived.
function amountLabel(job: Job) {
  if (job.total > 1) return `${job.completed + job.failed} of ${job.total}`;
  return job.percent === null ? "" : `${Math.round(job.percent)}%`;
}

function JobCard({
  job,
  currentPlaylistId,
  onCancel,
  onRetry,
  onDismiss,
  onOpenPlaylist,
}: Omit<JobListProps, "jobs" | "onClearFinished"> & { job: Job }) {
  const active = isActiveJob(job);
  const Icon = jobIcon(job);
  const status = statusLine(job);
  const amount = amountLabel(job);
  const playlistId = job.playlistId;
  const elsewhere = playlistId !== null && playlistId !== currentPlaylistId;

  return (
    <li
      className={`job-card job-${job.status}`}
      data-testid="job-card"
      data-job-kind={job.kind}
      data-job-status={job.status}
    >
      <div className="job-heading">
        <span className="job-icon">
          <Icon />
        </span>
        <div className="job-title">
          <strong title={job.title}>{job.title}</strong>
          <small>
            {SOURCE_LABELS[job.kind]}
            {job.playlistName ? ` → ${job.playlistName}` : ""}
          </small>
        </div>
        <div className="job-actions">
          {active && job.cancellable && (
            <button
              onClick={() => onCancel(job.id)}
              aria-label={`Cancel ${job.title}`}
              title="Cancel"
            >
              <X />
            </button>
          )}
          {!active && job.retryable && (
            <button
              onClick={() => onRetry(job.id)}
              aria-label={`Retry ${job.title}`}
              title={job.failed ? "Retry the songs that failed" : "Retry"}
            >
              <RotateCcw />
            </button>
          )}
          {!active && (
            <button
              onClick={() => onDismiss(job.id)}
              aria-label={`Dismiss ${job.title}`}
              title="Dismiss"
            >
              <X />
            </button>
          )}
        </div>
      </div>

      {job.status === "running" && (
        <div
          className="job-progress"
          role="progressbar"
          aria-label={`${job.title} progress`}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={
            job.percent === null ? undefined : Math.round(job.percent)
          }
        >
          <div
            className={`job-progress-fill ${job.percent === null ? "indeterminate" : ""}`}
            style={
              job.percent === null ? undefined : { width: `${job.percent}%` }
            }
          />
        </div>
      )}

      <div className="job-status">
        <span title={status}>{status}</span>
        {job.status === "running" && amount && (
          <span className="job-amount">{amount}</span>
        )}
      </div>

      {job.failures.length > 0 && (
        <details className="job-failures">
          <summary>
            {job.failures.length}{" "}
            {job.kind === "rating" ? "could not be read" : "not found"}
          </summary>
          <ul>
            {job.failures.map((name) => (
              <li key={name}>{name}</li>
            ))}
          </ul>
        </details>
      )}

      {!active && elsewhere && job.status !== "cancelled" && (
        <button className="job-open" onClick={() => onOpenPlaylist(playlistId)}>
          Open {job.playlistName ?? "playlist"}
        </button>
      )}
    </li>
  );
}

function JobList({ jobs, onClearFinished, ...card }: JobListProps) {
  return (
    <ul className="job-list">
      {/* Newest first: what was just started is what gets looked for. */}
      {[...jobs].reverse().map((job) => (
        <JobCard key={job.id} job={job} {...card} />
      ))}
    </ul>
  );
}

function ClearFinished({ jobs, onClearFinished }: JobListProps) {
  if (jobs.every(isActiveJob)) return null;
  return (
    <button className="activity-clear" onClick={onClearFinished}>
      Clear finished
    </button>
  );
}

// Downloads listed next to the link box, where they were started.
export function Downloads(props: JobListProps) {
  if (!props.jobs.length) return null;
  return (
    <section className="downloads" aria-label="Downloads">
      <header>
        <h2>Downloads</h2>
        <ClearFinished {...props} />
      </header>
      <JobList {...props} />
    </section>
  );
}

// Top-bar summary of every job, with the full list one click away.
export function Activity({ open, onToggle, ...list }: ActivityProps) {
  const { jobs } = list;
  if (!jobs.length) return null;

  const activeCount = jobs.filter(isActiveJob).length;
  const failedCount = jobs.filter((job) => job.status === "error").length;
  const label = activeCount
    ? `${activeCount} active`
    : failedCount
      ? `${failedCount} failed`
      : "Done";
  const Icon = activeCount ? LoaderCircle : failedCount ? AlertTriangle : Check;

  return (
    <div className="activity-wrap">
      <button
        className="activity-button"
        onClick={onToggle}
        aria-expanded={open}
        aria-label={`Activity: ${label}`}
        title="Downloads and rating runs"
      >
        <Icon className={activeCount ? "spinner" : ""} />
        <span>{label}</span>
      </button>
      {open && (
        <section className="activity-panel popover-enter" aria-label="Activity">
          <header>
            <h2>Activity</h2>
            <ClearFinished {...list} />
            <button
              className="activity-close"
              onClick={onToggle}
              aria-label="Close activity"
            >
              <X />
            </button>
          </header>
          <JobList {...list} />
        </section>
      )}
    </div>
  );
}
