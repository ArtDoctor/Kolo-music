import { convertFileSrc, invoke, isTauri } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { openUrl } from "@tauri-apps/plugin-opener";
import type { LibrarySnapshot, Playlist, Track } from "./types";

function artworkFor(id: string) {
  let hash = 0;
  for (const character of id)
    hash = ((hash << 5) - hash + character.charCodeAt(0)) | 0;
  const hue = Math.abs(hash) % 360;
  const second = (hue + 38 + (Math.abs(hash >> 5) % 50)) % 360;
  return `linear-gradient(145deg, hsl(${hue} 68% 59%), hsl(${second} 48% 27%) 58%, #111 100%)`;
}

function normalize(snapshot: LibrarySnapshot): LibrarySnapshot {
  return {
    ...snapshot,
    tracks: snapshot.tracks.map((track): Track => ({
      ...track,
      rating: track.rating ?? null,
      aiRating: track.aiRating ?? null,
      liked: track.liked ?? false,
      vibeScore: track.vibeScore ?? null,
      artwork: track.artwork || artworkFor(track.id),
      artworkUrl: track.artworkUrl ?? null,
      audioUrl:
        track.audioUrl ||
        (isTauri()
          ? convertFileSrc(track.sourcePath)
          : `/@kolo-data/${encodeURIComponent(track.id)}`),
      mtime: track.mtime || 0,
      cluster: track.cluster ?? null,
      genre: track.genre ?? null,
    })),
  };
}

export async function loadLibrary() {
  const snapshot = isTauri()
    ? await invoke<LibrarySnapshot>("scan_library")
    : await fetch("/api/library").then(async (response) => {
        if (!response.ok) throw new Error("Could not scan kolo.0.data");
        return response.json() as Promise<LibrarySnapshot>;
      });
  return normalize(snapshot);
}

export async function saveRating(trackId: string, rating: number | null) {
  if (isTauri()) {
    await invoke("set_track_rating", { trackId, rating });
    return;
  }

  const response = await fetch("/api/ratings", {
    method: "POST",
    keepalive: true,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ trackId, rating }),
  });
  if (!response.ok) throw new Error("Could not save rating");
}

export async function saveLike(trackId: string, liked: boolean) {
  if (isTauri()) return invoke<void>("set_track_liked", { trackId, liked });
  const response = await fetch("/api/likes", {
    method: "POST",
    keepalive: true,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ trackId, liked }),
  });
  if (!response.ok) throw new Error("Could not save like");
}

export async function createPlaylist(name: string): Promise<Playlist> {
  if (isTauri()) return invoke<Playlist>("create_playlist", { name });
  const response = await fetch("/api/playlists", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name }),
  });
  if (!response.ok)
    throw new Error(
      ((await response.json()) as { error: string }).error ||
        "Could not create playlist",
    );
  return response.json() as Promise<Playlist>;
}

export async function openExternal(url: string) {
  const parsed = new URL(url);
  if (
    parsed.protocol !== "https:" ||
    ![
      "youtube.com",
      "www.youtube.com",
      "music.youtube.com",
      "youtu.be",
      "www.youtu.be",
      "open.spotify.com",
    ].includes(parsed.hostname)
  )
    throw new Error("Unsupported link");
  if (isTauri()) {
    await openUrl(url);
  } else {
    const popup = window.open(url, "_blank");
    if (!popup) throw new Error("The browser blocked the new tab");
    popup.opener = null;
  }
}

export function isSpotifyLink(value: string) {
  try {
    const url = new URL(value.trim());
    return url.protocol === "https:" && url.hostname === "open.spotify.com";
  } catch {
    return false;
  }
}

export function isYouTubeLink(value: string) {
  try {
    const url = new URL(value.trim());
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

// The links in a pasted line, or nothing if any part of it is not a
// downloadable link (the text is then a search phrase).
export function parseDownloadLinks(value: string): string[] {
  const parts = value.trim().split(/\s+/).filter(Boolean);
  if (!parts.every((part) => isYouTubeLink(part) || isSpotifyLink(part)))
    return [];
  return [...new Set(parts)];
}

export function youtubeSearchUrl(query: string) {
  return `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`;
}

export function getTrackSearchQuery(track: {
  title: string;
  artist?: string;
}): string {
  const title = track.title?.trim() || "";
  const artist = track.artist?.trim();
  const hasArtist = Boolean(
    artist &&
    artist.toLowerCase() !== "unknown artist" &&
    artist.toLowerCase() !== "unknown",
  );
  return hasArtist ? `${title} ${artist}`.trim() : title;
}

export async function searchTrackOnYouTube(track: {
  title: string;
  artist?: string;
}) {
  const query = getTrackSearchQuery(track);
  if (!query) return;
  await openExternal(youtubeSearchUrl(query));
}

export async function importTracks(playlistId: string, browserFiles?: File[]) {
  if (isTauri()) {
    const selected = await open({
      multiple: true,
      directory: false,
      filters: [
        {
          name: "Audio",
          extensions: [
            "mp3",
            "m4a",
            "flac",
            "wav",
            "ogg",
            "aac",
            "opus",
            "webm",
          ],
        },
      ],
    });
    if (!selected) return 0;
    const paths = Array.isArray(selected) ? selected : [selected];
    return invoke<number>("import_tracks", { paths, playlistId });
  }

  if (!browserFiles?.length) return 0;
  for (const file of browserFiles) {
    const response = await fetch(
      `/api/import?name=${encodeURIComponent(file.name)}&playlistId=${encodeURIComponent(playlistId)}`,
      { method: "POST", body: file },
    );
    if (!response.ok) throw new Error(`Could not import ${file.name}`);
  }
  return browserFiles.length;
}
