import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react";
import { playbackVolume, tracksInPlaylist } from "../appConfig";
import type {
  LibrarySnapshot,
  PlayerSettings,
  RepeatMode,
  Track,
} from "../types";

interface PlayerOptions {
  library: LibrarySnapshot | null;
  setLibrary: Dispatch<SetStateAction<LibrarySnapshot | null>>;
  selectedPlaylist: string;
  playlistName: string;
  settings: PlayerSettings;
  setSettings: Dispatch<SetStateAction<PlayerSettings>>;
  setNotice: Dispatch<SetStateAction<string | null>>;
  currentId: string | null;
  setCurrentId: Dispatch<SetStateAction<string | null>>;
}

export function usePlayer({
  library,
  setLibrary,
  selectedPlaylist,
  playlistName,
  settings,
  setSettings,
  setNotice,
  currentId,
  setCurrentId,
}: PlayerOptions) {
  const [isPlaying, setIsPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [duration, setDuration] = useState(0);
  const [shuffle, setShuffle] = useState(false);
  const [queueIds, setQueueIds] = useState<string[]>([]);
  const [queueName, setQueueName] = useState("Phone music");
  const [queueSource, setQueueSource] = useState("home");
  const [repeatMode, setRepeatMode] = useState<RepeatMode>("off");

  const audioRef = useRef<HTMLAudioElement>(null);
  const shouldAutoplayRef = useRef(false);
  const originalQueueIdsRef = useRef<string[]>([]);
  const lastVolumeRef = useRef(settings.volume > 0 ? settings.volume : 0.15);

  const currentTrack = useMemo(
    () => library?.tracks.find((track) => track.id === currentId) ?? null,
    [currentId, library],
  );

  const queueTracks = useMemo(() => {
    const byId = new Map(library?.tracks.map((track) => [track.id, track]));
    return queueIds
      .map((id) => byId.get(id))
      .filter((track): track is Track => Boolean(track));
  }, [library, queueIds]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.volume = playbackVolume(settings, currentTrack);
    if (settings.volume > 0) lastVolumeRef.current = settings.volume;
  }, [currentTrack?.gain, settings.loudnessLimiter, settings.volume]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio || !currentTrack) return;
    setProgress(0);
    setDuration(currentTrack.duration);
    if (!audio.paused) audio.pause();

    audio.src = currentTrack.audioUrl;
    audio.volume = playbackVolume(settings, currentTrack);

    if (shouldAutoplayRef.current) {
      void audio
        .play()
        .catch(() => setNotice("This audio format could not be played."));
    }
    shouldAutoplayRef.current = false;
  }, [currentTrack?.audioUrl, currentTrack?.id]);

  const seek = useCallback(
    (value: number) => {
      const audio = audioRef.current;
      if (!audio) return;
      const target = Math.max(
        0,
        Math.min(value, duration || audio.duration || value),
      );
      setProgress(target);

      if (!audio.paused && !audio.muted) {
        const targetVolume = audio.volume;
        audio.muted = true;
        audio.currentTime = target;
        const onSeeked = () => {
          audio.removeEventListener("seeked", onSeeked);
          audio.muted = false;
          audio.volume = targetVolume;
        };
        audio.addEventListener("seeked", onSeeked, { once: true });
        window.setTimeout(() => {
          audio.removeEventListener("seeked", onSeeked);
          audio.muted = false;
        }, 150);
      } else {
        audio.currentTime = target;
      }
    },
    [duration],
  );

  const startQueue = useCallback(
    (
      tracks: Track[],
      name: string,
      first: Track,
      shuffled = false,
      source = selectedPlaylist,
    ) => {
      if (!tracks.length) return;
      originalQueueIdsRef.current = tracks.map((track) => track.id);
      if (shuffled && tracks.length > 1) {
        const rest = tracks
          .filter((track) => track.id !== first.id)
          .map((track) => track.id);
        for (let index = rest.length - 1; index > 0; index--) {
          const swapIndex = Math.floor(Math.random() * (index + 1));
          [rest[index], rest[swapIndex]] = [rest[swapIndex], rest[index]];
        }
        setQueueIds([first.id, ...rest]);
      } else {
        setQueueIds(tracks.map((track) => track.id));
      }
      setQueueName(name);
      setQueueSource(source);
      setShuffle(shuffled);
      shouldAutoplayRef.current = true;
      if (first.id === currentId && audioRef.current) {
        seek(0);
        void audioRef.current.play();
      } else {
        setCurrentId(first.id);
      }
    },
    [currentId, seek, selectedPlaylist, setCurrentId],
  );

  const toggleShuffle = useCallback(() => {
    setShuffle((enabled) => {
      const next = !enabled;
      if (next) {
        const rest = queueIds.filter((id) => id !== currentId);
        for (let index = rest.length - 1; index > 0; index--) {
          const swapIndex = Math.floor(Math.random() * (index + 1));
          [rest[index], rest[swapIndex]] = [rest[swapIndex], rest[index]];
        }
        setQueueIds(currentId ? [currentId, ...rest] : rest);
      } else if (originalQueueIdsRef.current.length) {
        setQueueIds([...originalQueueIdsRef.current]);
      }
      return next;
    });
  }, [currentId, queueIds]);

  const playTrack = useCallback(
    (track: Track, contextTracks?: Track[], contextName?: string) => {
      const source =
        contextTracks ??
        tracksInPlaylist(library?.tracks ?? [], selectedPlaylist);
      const name = contextName ?? playlistName;

      if (track.id === currentId) {
        if (!queueIds.length || queueSource !== selectedPlaylist) {
          originalQueueIdsRef.current = source.map((item) => item.id);
          setQueueIds(source.map((item) => item.id));
          setQueueSource(selectedPlaylist);
          setQueueName(name);
        }
        const audio = audioRef.current;
        if (!audio) return;
        if (audio.paused) void audio.play();
        else audio.pause();
        return;
      }

      originalQueueIdsRef.current = source.map((item) => item.id);
      setQueueIds(source.map((item) => item.id));
      setQueueName(name);
      setQueueSource(selectedPlaylist);
      setShuffle(false);
      shouldAutoplayRef.current = true;
      setCurrentId(track.id);
    },
    [
      currentId,
      library,
      playlistName,
      queueIds.length,
      queueSource,
      selectedPlaylist,
      setCurrentId,
    ],
  );

  const togglePlayback = useCallback(async () => {
    const audio = audioRef.current;
    if (!audio || !currentTrack) return;
    if (audio.paused) {
      if (!queueIds.length) {
        const source = tracksInPlaylist(
          library?.tracks ?? [],
          selectedPlaylist,
        );
        originalQueueIdsRef.current = source.map((track) => track.id);
        setQueueIds(source.map((track) => track.id));
        setQueueSource(selectedPlaylist);
        setQueueName(playlistName);
      }
      await audio.play();
    } else {
      audio.pause();
    }
  }, [currentTrack, library, playlistName, queueIds.length, selectedPlaylist]);

  const adjacentTrack = useCallback(
    (direction: 1 | -1, autoplay = true) => {
      if (!queueTracks.length) return;
      const index = Math.max(
        0,
        queueTracks.findIndex((track) => track.id === currentId),
      );
      const next =
        queueTracks[
          (index + direction + queueTracks.length) % queueTracks.length
        ];
      shouldAutoplayRef.current = autoplay;
      setCurrentId(next.id);
    },
    [currentId, queueTracks, setCurrentId],
  );

  const handleEnded = useCallback(() => {
    if (repeatMode === "one" && audioRef.current) {
      seek(0);
      void audioRef.current.play();
      return;
    }
    const index = queueTracks.findIndex((track) => track.id === currentId);
    if (repeatMode === "all" || index < queueTracks.length - 1) {
      adjacentTrack(1);
    } else {
      setIsPlaying(false);
    }
  }, [adjacentTrack, currentId, queueTracks, repeatMode, seek]);

  function setVolume(value: number) {
    const volume = Math.min(1, Math.max(0, value));
    if (volume > 0) lastVolumeRef.current = volume;
    setSettings((current) => ({ ...current, volume }));
  }

  function toggleMute() {
    setVolume(settings.volume > 0 ? 0 : lastVolumeRef.current);
  }

  function playQueuedTrack(track: Track) {
    shouldAutoplayRef.current = true;
    setCurrentId(track.id);
  }

  function handleLoadedMetadata(audio: HTMLAudioElement) {
    const value = audio.duration;
    setDuration(value);
    if (!currentId) return;
    setLibrary((current) =>
      current
        ? {
            ...current,
            tracks: current.tracks.map((track) =>
              track.id === currentId ? { ...track, duration: value } : track,
            ),
          }
        : current,
    );
  }

  return {
    audioRef,
    currentTrack,
    isPlaying,
    setIsPlaying,
    progress,
    setProgress,
    duration,
    shuffle,
    queueName,
    queueTracks,
    repeatMode,
    setRepeatMode,
    seek,
    startQueue,
    toggleShuffle,
    playTrack,
    togglePlayback,
    adjacentTrack,
    handleEnded,
    setVolume,
    toggleMute,
    playQueuedTrack,
    handleLoadedMetadata,
  };
}
