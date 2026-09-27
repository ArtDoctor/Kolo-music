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

export interface PlayerSettings {
  accent: string;
  volume: number;
  vibeFilter: number;
  loudnessLimiter?: boolean;
}
