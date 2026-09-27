import { Archive, Ban, Compass, Download, Heart, Music2 } from "lucide-react";
import type { PlayerSettings, Track } from "./types";

export const defaultSettings: PlayerSettings = {
  accent: "#0d8275",
  volume: 0.15,
  vibeFilter: 0,
  loudnessLimiter: true,
};

export const GENRE_CLUSTERS = [
  {
    id: 0,
    name: "Cinematic Ambient & Neoclassical OST",
    color: "var(--accent)",
    desc: "Atmospheric strings, reflective piano, dramatic soundscapes and OSTs",
  },
  {
    id: 1,
    name: "Atmospheric Indie & Dream Pop",
    color: "var(--accent)",
    desc: "Dreamy guitars, introspective vocals, warm melancholic indie vibes",
  },
  {
    id: 2,
    name: "Indie Dance & Synth-Rock",
    color: "var(--accent)",
    desc: "Punchy synth hooks, danceable grooves, upbeat indie-pop & synthwave",
  },
  {
    id: 3,
    name: "Dark Alt-Pop & Trap-Rock",
    color: "var(--accent)",
    desc: "Gritty electro-rock, heavy 808 bass, dark alternative pop anthems",
  },
  {
    id: 4,
    name: "British Garage Indie & Alt-Rock (Lovejoy / Wilbur)",
    color: "var(--accent)",
    desc: "Overdriven telecasters, punchy British indie rock, Lovejoy, Wilbur & Arctic Monkeys energy",
  },
  {
    id: 5,
    name: "Drift Phonk & Bass House",
    color: "var(--accent)",
    desc: "Aggressive cowbells, distorted drift 808s, high-octane club & phonk",
  },
] as const;

export type GenreCluster = (typeof GENRE_CLUSTERS)[number];
export type RatingFilterType =
  "all" | "5" | "4.5" | "4" | "3.5" | "rated" | "unrated";
export type SortByType =
  "date" | "rating" | "title" | "artist" | "duration" | "vibe" | "index";
export type SortOrderType = "desc" | "asc";

export function mapVolume(sliderValue: number): number {
  return Math.max(0, Math.min(1, sliderValue ** 2 * 0.65));
}

export function splitArtists(artistString: string): string[] {
  if (!artistString || artistString === "Unknown artist") {
    return [artistString || "Unknown artist"];
  }
  return artistString
    .split(/,|\s+feat\.?\s+|\s+ft\.?\s+|\s+&\s+|\s+vs\.?\s+|\s+x\s+/i)
    .map((artist) => artist.trim())
    .filter(Boolean);
}

export function tracksInPlaylist(tracks: Track[], id: string): Track[] {
  if (id === "home" || id === "all") return tracks;
  if (id === "liked") return tracks.filter((track) => track.liked);
  if (id === "rating:all") {
    return tracks
      .filter((track) => track.rating !== null && track.rating > 0)
      .sort((left, right) => (right.rating ?? 0) - (left.rating ?? 0));
  }
  if (id === "rating:unrated") {
    return tracks.filter(
      (track) =>
        track.rating === null &&
        track.playlistId !== "negative" &&
        !track.id.startsWith("neg/"),
    );
  }
  if (id === "rating:5") return tracks.filter((track) => track.rating === 5);
  if (id === "rating:4.5") {
    return tracks.filter((track) => (track.rating ?? 0) >= 4.5);
  }
  if (id === "rating:4") {
    return tracks.filter((track) => (track.rating ?? 0) >= 4);
  }
  if (id === "rating:3.5") {
    return tracks.filter((track) => (track.rating ?? 0) >= 3.5);
  }
  if (id.startsWith("genre:")) {
    const clusterId = Number(id.slice(6));
    return tracks.filter((track) => track.cluster === clusterId);
  }
  return tracks.filter((track) => track.playlistId === id);
}

export function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return "—";
  return `${Math.floor(seconds / 60)}:${Math.floor(seconds % 60)
    .toString()
    .padStart(2, "0")}`;
}

export function playlistIcon(id: string) {
  if (id === "liked") return Heart;
  if (id === "old") return Archive;
  if (id === "discovery") return Compass;
  if (id === "imported") return Download;
  if (id === "negative") return Ban;
  return Music2;
}

export function hexToRgb(hex: string): string {
  const normalized = hex.replace("#", "");
  const value = Number.parseInt(
    normalized.length === 3
      ? normalized
          .split("")
          .map((character) => character + character)
          .join("")
      : normalized,
    16,
  );
  return `${(value >> 16) & 255}, ${(value >> 8) & 255}, ${value & 255}`;
}
