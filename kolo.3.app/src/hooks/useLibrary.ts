import { useCallback, useEffect, useRef, useState } from "react";
import { loadLibrary, saveLike, saveRating } from "../library";
import type { LibrarySnapshot, Notify } from "../types";
import { useLocalStorage } from "./useLocalStorage";

export function useLibrary(setNotice: Notify) {
  const [library, setLibrary] = useState<LibrarySnapshot | null>(null);
  const [currentId, setCurrentId] = useLocalStorage<string | null>(
    "kolo.currentId",
    null,
  );
  // The remembered song may have been deleted since the last session; only
  // check on the first load so a refresh never swaps out a playing song.
  const validatedRef = useRef(false);
  const [error, setError] = useState<string | null>(null);

  const refreshLibrary = useCallback(async () => {
    try {
      const snapshot = await loadLibrary();
      setLibrary((current) => {
        if (!current) return snapshot;
        const durations = new Map(
          current.tracks.map((track) => [track.id, track.duration]),
        );
        return {
          ...snapshot,
          tracks: snapshot.tracks.map((track) => ({
            ...track,
            duration: durations.get(track.id) || track.duration,
          })),
        };
      });
      setError(null);
      const validate = !validatedRef.current;
      validatedRef.current = true;
      setCurrentId((current) => {
        if (
          current &&
          (!validate || snapshot.tracks.some((track) => track.id === current))
        )
          return current;
        return (
          snapshot.tracks.find((track) => track.playlistId === "pos")?.id ??
          snapshot.tracks[0]?.id ??
          null
        );
      });
      return snapshot;
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    }
  }, []);

  useEffect(() => {
    void refreshLibrary();
  }, [refreshLibrary]);

  const updateRating = useCallback(
    async (trackId: string, rating: number | null) => {
      setLibrary((current) => {
        if (!current) return current;
        return {
          ...current,
          tracks: current.tracks.map((track) =>
            track.id === trackId ? { ...track, rating } : track,
          ),
        };
      });
      try {
        await saveRating(trackId, rating);
      } catch {
        setNotice("The rating could not be saved.", "error");
        await refreshLibrary();
      }
    },
    [refreshLibrary, setNotice],
  );

  const updateLike = useCallback(
    async (trackId: string, liked: boolean) => {
      setLibrary((current) => {
        if (!current) return current;
        const tracks = current.tracks.map((track) =>
          track.id === trackId ? { ...track, liked } : track,
        );
        return {
          ...current,
          tracks,
          playlists: current.playlists.map((playlist) =>
            playlist.id === "liked"
              ? {
                  ...playlist,
                  count: tracks.filter((track) => track.liked).length,
                }
              : playlist,
          ),
        };
      });
      try {
        await saveLike(trackId, liked);
      } catch {
        setNotice("Like could not be saved.", "error");
        await refreshLibrary();
      }
    },
    [refreshLibrary, setNotice],
  );

  return {
    library,
    setLibrary,
    currentId,
    setCurrentId,
    error,
    refreshLibrary,
    updateRating,
    updateLike,
  };
}
