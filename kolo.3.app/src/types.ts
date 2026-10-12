export type RepeatMode = "off" | "all" | "one";

export interface Playlist {
  id: string;
  name: string;
  count: number;
}

export interface Track {
  id: string;
  title: string;
  artist: string;
  album: string;
  duration: number;
  sourcePath: string;
  playlistId: string;
  artwork: string;
  artworkUrl?: string | null;
  audioUrl: string;
  vibeScore: number | null;
  rating: number | null;
  aiRating?: number | null;
  liked: boolean;
  mtime?: number;
  cluster?: number | null;
  genre?: string | null;
  gain?: number | null;
  lufs?: number | null;
}

export interface LibrarySnapshot {
  dataRoot: string;
  playlists: Playlist[];
  tracks: Track[];
}

export type JobKind = "youtube" | "spotify" | "rating";
export type JobStatus = "queued" | "running" | "done" | "error" | "cancelled";

// A background download or rating run. Both backends report jobs in this shape.
export interface Job {
  id: string;
  kind: JobKind;
  status: JobStatus;
  title: string;
  // Plain-language description of the current step or the outcome.
  detail: string;
  playlistId: string | null;
  playlistName: string | null;
  total: number;
  completed: number;
  failed: number;
  skipped: number;
  // 0–100, or null while the amount of remaining work is unknown.
  percent: number | null;
  // Songs being worked on right now.
  active: string[];
  failures: string[];
  error: string | null;
  cancellable: boolean;
  retryable: boolean;
  // Increases whenever the job changes the library on disk.
  revision: number;
  createdAt: number;
  finishedAt: number | null;
}

export interface PlayerSettings {
  accent: string;
  volume: number;
  vibeFilter: number;
  loudnessLimiter?: boolean;
}
