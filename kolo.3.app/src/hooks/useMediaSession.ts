import { useCallback, useEffect, useRef, type RefObject } from "react";
import type { Track } from "../types";

interface MediaSessionOptions {
  track: Track | null;
  queueName: string;
  isPlaying: boolean;
  duration: number;
  progress: number;
  audioRef: RefObject<HTMLAudioElement | null>;
  play: () => void;
  pause: () => void;
  previous: () => void;
  next: () => void;
  seek: (position: number) => void;
}

export function useMediaSession(options: MediaSessionOptions) {
  const latest = useRef(options);
  latest.current = options;
  const lastPosition = useRef(-Infinity);
  const previousPosition = useRef<{
    trackId?: string;
    duration: number;
    isPlaying: boolean;
  } | null>(null);
  const { track, queueName, isPlaying, duration, progress, audioRef } = options;

  const updatePosition = useCallback((force = false, position?: number) => {
    if (!("mediaSession" in navigator)) return;
    const current = latest.current;
    if (!current.track) return;
    const length = current.duration;
    if (!Number.isFinite(length) || length <= 0) return;
    const now = performance.now();
    if (!force && now - lastPosition.current < 1000) return;
    const value = position ?? current.progress;
    lastPosition.current = now;
    try {
      navigator.mediaSession.setPositionState({
        duration: length,
        position: Math.max(
          0,
          Math.min(Number.isFinite(value) ? value : 0, length),
        ),
        playbackRate: 1,
      });
    } catch {
      // Position reporting is not supported by every media-session platform.
    }
  }, []);

  useEffect(() => {
    document.title = track ? `${track.title} · ${track.artist}` : "Kolo";
  }, [track?.id, track?.title, track?.artist]);

  useEffect(() => {
    if (!("mediaSession" in navigator)) return;
    const session = navigator.mediaSession;
    if (!track || typeof MediaMetadata === "undefined") {
      session.metadata = null;
      return;
    }
    let artwork: MediaImage[] = [];
    if (track.artworkUrl) {
      try {
        artwork = [{ src: new URL(track.artworkUrl, location.href).href }];
      } catch {
        // A bad artwork URL should not prevent transport controls from working.
      }
    }
    session.metadata = new MediaMetadata({
      title: track.title,
      artist: track.artist,
      album: queueName,
      artwork,
    });
  }, [track?.id, track?.title, track?.artist, track?.artworkUrl, queueName]);

  useEffect(() => {
    if (!("mediaSession" in navigator)) return;
    navigator.mediaSession.playbackState = !track
      ? "none"
      : isPlaying
        ? "playing"
        : "paused";
  }, [track?.id, isPlaying]);

  useEffect(() => {
    const previous = previousPosition.current;
    const trackChanged = previous?.trackId !== track?.id;
    const force =
      trackChanged ||
      previous?.duration !== duration ||
      previous?.isPlaying !== isPlaying;
    previousPosition.current = { trackId: track?.id, duration, isPlaying };
    if (!track) {
      lastPosition.current = -Infinity;
      if ("mediaSession" in navigator) {
        try {
          navigator.mediaSession.setPositionState();
        } catch {
          // Clearing position state is optional on older implementations.
        }
      }
      return;
    }
    updatePosition(force, trackChanged ? 0 : progress);
  }, [track?.id, duration, progress, isPlaying, updatePosition]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    const onSeeking = () => updatePosition(true, audio.currentTime);
    audio.addEventListener("seeking", onSeeking);
    return () => audio.removeEventListener("seeking", onSeeking);
  }, [audioRef, track?.id, updatePosition]);

  useEffect(() => {
    if (!("mediaSession" in navigator)) return;
    const session = navigator.mediaSession;
    const seekTo = (value: number) => {
      const current = latest.current;
      if (!current.track || !Number.isFinite(value)) return;
      const length = current.duration;
      const target = Math.max(
        0,
        Number.isFinite(length) && length > 0 ? Math.min(value, length) : value,
      );
      current.seek(target);
      updatePosition(true, target);
    };
    const handlers: Partial<
      Record<MediaSessionAction, MediaSessionActionHandler>
    > = {
      play: () => latest.current.play(),
      pause: () => latest.current.pause(),
      stop: () => latest.current.pause(),
      previoustrack: () => latest.current.previous(),
      nexttrack: () => latest.current.next(),
      seekbackward: (details) =>
        seekTo(latest.current.progress - (details.seekOffset ?? 10)),
      seekforward: (details) =>
        seekTo(latest.current.progress + (details.seekOffset ?? 10)),
      seekto: (details) => {
        if (details.seekTime !== undefined) seekTo(details.seekTime);
      },
    };
    const actions = Object.keys(handlers) as MediaSessionAction[];
    for (const action of actions) {
      try {
        session.setActionHandler(action, (details) => {
          if (latest.current.track) handlers[action]?.(details);
        });
      } catch {
        // Unsupported actions are independent: keep registering the others.
      }
    }
    return () => {
      for (const action of actions) {
        try {
          session.setActionHandler(action, null);
        } catch {
          // This action may not have been supported at registration time.
        }
      }
      session.metadata = null;
      session.playbackState = "none";
      try {
        session.setPositionState();
      } catch {
        // Position reporting may be unsupported.
      }
    };
  }, [updatePosition]);

  useEffect(
    () => () => {
      document.title = "Kolo";
    },
    [],
  );
}
