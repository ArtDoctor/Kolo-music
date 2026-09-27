import {
  useCallback,
  useEffect,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react";
import { loadLibrary, saveLike, saveRating } from "../library";
import type { LibrarySnapshot } from "../types";

export function useLibrary(setNotice: Dispatch<SetStateAction<string | null>>) {
  const [library, setLibrary] = useState<LibrarySnapshot | null>(null);
  const [currentId, setCurrentId] = useState<string | null>(null);
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
      setCurrentId(
        (current) =>
          current ??
          snapshot.tracks.find((track) => track.playlistId === "pos")?.id ??
          snapshot.tracks[0]?.id ??
          null,
      );
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
        setNotice("The rating could not be saved.");
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
        setNotice("Like could not be saved.");
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
