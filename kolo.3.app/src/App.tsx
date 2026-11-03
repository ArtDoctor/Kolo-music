import { isTauri } from "@tauri-apps/api/core";
import { AlertTriangle, Info, LoaderCircle, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  defaultSettings,
  formatTotalDuration,
  GENRE_CLUSTERS,
  hexToRgb,
  RATING_FILTERS,
  tracksInPlaylist,
  type RatingFilterType,
  type SortByType,
  type SortOrderType,
} from "./appConfig";
import { Activity, Downloads, type JobActions } from "./components/Activity";
import { HomePage } from "./components/HomePage";
import { ImportControls } from "./components/ImportControls";
import { Sidebar, TopBar } from "./components/Navigation";
import { PlayerBar } from "./components/PlayerBar";
import { QueuePanel } from "./components/QueuePanel";
import { SettingsPage } from "./components/SettingsPage";
import { ShortcutsDialog } from "./components/ShortcutsDialog";
import { PlaylistHeader, TrackList } from "./components/TrackList";
import { ArtistBanner, TrackFilters } from "./components/TrackToolbar";
import { useImports } from "./hooks/useImports";
import { useJobs } from "./hooks/useJobs";
import { useKeyboardShortcuts } from "./hooks/useKeyboardShortcuts";
import { useLibrary } from "./hooks/useLibrary";
import { useLocalStorage } from "./hooks/useLocalStorage";
import { useMediaSession } from "./hooks/useMediaSession";
import { usePlayer } from "./hooks/usePlayer";
import { isActiveJob } from "./jobs";
import { searchTrackOnYouTube } from "./library";
import type {
  NoticeTone,
  Notify,
  PlayerSettings,
  Playlist,
  Track,
} from "./types";

// Views that only filter the library; songs cannot be imported into them.
function isVirtualView(id: string) {
  return id.startsWith("rating:") || id.startsWith("genre:");
}

function shortcutNotice(track: Track, action: number | null | "like") {
  if (action === "like") {
    return track.liked ? "Removed from Liked songs" : "Added to Liked songs";
  }
  return action === null
    ? `Cleared rating for “${track.title}”`
    : `Rated “${track.title}” ${action} ${action === 1 ? "star" : "stars"}`;
}

export default function App() {
  const [selectedPlaylist, setSelectedPlaylist] = useLocalStorage(
    "kolo.selectedPlaylist",
    "home",
  );
  const [settingsPage, setSettingsPage] = useState(false);
  const [query, setQuery] = useState("");
  const [sidebarCollapsed, setSidebarCollapsed] = useLocalStorage(
    "kolo.sidebarCollapsed",
    false,
  );
  const [profileOpen, setProfileOpen] = useState(false);
  const [queueOpen, setQueueOpen] = useLocalStorage("kolo.queueOpen", false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [notice, setNoticeState] = useState<{
    message: string;
    tone: NoticeTone;
    key: number;
  } | null>(null);
  const setNotice = useCallback<Notify>(
    (message, tone = "info") =>
      setNoticeState({ message, tone, key: Date.now() }),
    [],
  );
  const [settings, setSettings] = useLocalStorage<PlayerSettings>(
    "kolo.settings",
    defaultSettings,
  );
  const {
    library,
    setLibrary,
    currentId,
    setCurrentId,
    error,
    refreshLibrary,
    updateRating,
    updateLike,
  } = useLibrary(setNotice);

  const [ratingFilter, setRatingFilter] = useLocalStorage<RatingFilterType>(
    "kolo.ratingFilter",
    "all",
  );
  const [sortBy, setSortBy] = useLocalStorage<SortByType>(
    "kolo.sortBy",
    "date",
  );
  const [sortOrder, setSortOrder] = useLocalStorage<SortOrderType>(
    "kolo.sortOrder",
    "desc",
  );
  const [activeArtist, setActiveArtist] = useLocalStorage<string | null>(
    "kolo.activeArtist",
    null,
  );
  const [showHiddenPlaylists, setShowHiddenPlaylists] = useLocalStorage(
    "kolo.showHiddenPlaylists",
    false,
  );
  const [vizOpen, setVizOpen] = useState(false);

  const viewScrollRef = useRef<HTMLDivElement>(null);
  const {
    jobs,
    activityOpen,
    setActivityOpen,
    download: startDownloads,
    rate: startRating,
    cancel: cancelJob,
    retry: retryJob,
    dismiss: dismissJob,
    clearFinished: clearFinishedJobs,
  } = useJobs({ refreshLibrary, setNotice });
  const {
    linkOpen,
    setLinkOpen,
    linkInput,
    setLinkInput,
    fileInputRef,
    createNewPlaylist,
    handleLink,
    downloadLinks,
    beginImport,
    openImport,
  } = useImports({
    library,
    selectedPlaylist,
    setSelectedPlaylist,
    setSettingsPage,
    setNotice,
    refreshLibrary,
    startDownloads,
  });

  useEffect(() => {
    if (localStorage.getItem("kolo.settings.v4")) return;
    setSettings((previous) => ({
      ...previous,
      accent:
        previous.accent === "#168e9c" || previous.accent === "#d6ff3f"
          ? "#0d8275"
          : previous.accent,
      volume: previous.volume >= 0.24 ? 0.15 : previous.volume,
      loudnessLimiter: true,
    }));
    localStorage.setItem("kolo.settings.v4", "1");
  }, [setSettings]);

  useEffect(() => {
    document.documentElement.style.setProperty("--accent", settings.accent);
    document.documentElement.style.setProperty(
      "--accent-rgb",
      hexToRgb(settings.accent),
    );
  }, [settings.accent]);

  useEffect(() => {
    if (!notice) return;
    const timeout = window.setTimeout(
      () => setNoticeState(null),
      notice.tone === "error" ? 6000 : 3000,
    );
    return () => window.clearTimeout(timeout);
  }, [notice]);

  const currentGenreCluster = useMemo(() => {
    if (selectedPlaylist.startsWith("genre:")) {
      const cid = Number(selectedPlaylist.slice(6));
      return GENRE_CLUSTERS.find((g) => g.id === cid) ?? null;
    }
    return null;
  }, [selectedPlaylist]);

  const isSearching = Boolean(query.trim());

  const searchableTracks = useMemo(() => {
    if (!library) return [];
    return library.tracks.filter(
      (track) =>
        track.playlistId !== "negative" && !track.id.startsWith("neg/"),
    );
  }, [library]);

  const basePlaylistTracks = useMemo(() => {
    if (!library) return [];
    if (isSearching) {
      return searchableTracks;
    }
    return tracksInPlaylist(library.tracks, selectedPlaylist);
  }, [library, isSearching, searchableTracks, selectedPlaylist]);

  // Everything the view shows before the rating chip is applied; the chips
  // count against this so their numbers match what a click will show.
  const scopedTracks = useMemo(() => {
    let base = basePlaylistTracks;

    if (activeArtist) {
      const lower = activeArtist.toLowerCase();
      base = base.filter((t) => t.artist.toLowerCase().includes(lower));
    }

    const normalized = query.trim().toLowerCase();
    if (normalized) {
      base = base.filter((track) =>
        `${track.title} ${track.artist} ${track.album}`
          .toLowerCase()
          .includes(normalized),
      );
    }

    if (settings.vibeFilter > 0) {
      base = base.filter(
        (track) =>
          track.vibeScore === null || track.vibeScore >= settings.vibeFilter,
      );
    }
    return base;
  }, [basePlaylistTracks, activeArtist, query, settings.vibeFilter]);

  const filterCounts = useMemo(() => {
    const counts = { all: scopedTracks.length } as Record<
      RatingFilterType,
      number
    >;
    for (const [key, matches] of Object.entries(RATING_FILTERS))
      counts[key as RatingFilterType] = scopedTracks.filter(matches).length;
    return counts;
  }, [scopedTracks]);

  const playlistTracks = useMemo(() => {
    const base =
      ratingFilter === "all"
        ? scopedTracks
        : scopedTracks.filter(RATING_FILTERS[ratingFilter]);

    if (sortBy === "index") {
      return base;
    }

    return [...base].sort((a, b) => {
      let diff = 0;
      if (sortBy === "date") {
        diff = (a.mtime || 0) - (b.mtime || 0);
      } else if (sortBy === "rating") {
        diff = (a.rating ?? -1) - (b.rating ?? -1);
      } else if (sortBy === "title") {
        diff = a.title.localeCompare(b.title);
      } else if (sortBy === "artist") {
        diff = a.artist.localeCompare(b.artist);
      } else if (sortBy === "duration") {
        diff = (a.duration || 0) - (b.duration || 0);
      } else if (sortBy === "vibe") {
        diff = (a.vibeScore ?? -1) - (b.vibeScore ?? -1);
      }
      return sortOrder === "asc" ? diff : -diff;
    });
  }, [scopedTracks, ratingFilter, sortBy, sortOrder]);

  // Only shown when nearly every length is known; durations are probed
  // lazily, so a partial sum would understate the playlist.
  const totalDuration = useMemo(() => {
    const known = basePlaylistTracks.filter((track) => track.duration > 0);
    if (known.length < basePlaylistTracks.length * 0.9) return "";
    return formatTotalDuration(
      known.reduce((sum, track) => sum + track.duration, 0),
    );
  }, [basePlaylistTracks]);

  const playlist: Playlist | null = useMemo(() => {
    if (isSearching) {
      return {
        id: "search",
        name: `Search: “${query.trim()}”`,
        count: scopedTracks.length,
      };
    }
    if (selectedPlaylist === "home")
      return { id: "home", name: "Home", count: library?.tracks.length ?? 0 };
    if (selectedPlaylist === "all")
      return {
        id: "all",
        name: activeArtist ? `Artist: ${activeArtist}` : "All Songs",
        count: library?.tracks.length ?? 0,
      };
    if (currentGenreCluster)
      return {
        id: selectedPlaylist,
        name: currentGenreCluster.name,
        count:
          library?.tracks.filter((t) => t.cluster === currentGenreCluster.id)
            .length ?? 0,
      };
    if (selectedPlaylist === "rating:all")
      return {
        id: "rating:all",
        name: "Rated songs",
        count:
          library?.tracks.filter((t) => t.rating !== null && t.rating > 0)
            .length ?? 0,
      };
    if (selectedPlaylist === "rating:unrated")
      return {
        id: "rating:unrated",
        name: "Non-rated songs",
        count:
          library?.tracks.filter(
            (t) =>
              t.rating === null &&
              t.playlistId !== "negative" &&
              !t.id.startsWith("neg/"),
          ).length ?? 0,
      };
    if (selectedPlaylist === "rating:5")
      return {
        id: "rating:5",
        name: "Five stars",
        count: library?.tracks.filter((t) => t.rating === 5).length ?? 0,
      };
    if (selectedPlaylist === "rating:4.5")
      return {
        id: "rating:4.5",
        name: "4.5 stars & up",
        count:
          library?.tracks.filter((t) => (t.rating ?? 0) >= 4.5).length ?? 0,
      };
    if (selectedPlaylist === "rating:4")
      return {
        id: "rating:4",
        name: "Four stars & up",
        count: library?.tracks.filter((t) => (t.rating ?? 0) >= 4).length ?? 0,
      };
    if (selectedPlaylist === "rating:3.5")
      return {
        id: "rating:3.5",
        name: "3.5 stars & up",
        count:
          library?.tracks.filter((t) => (t.rating ?? 0) >= 3.5).length ?? 0,
      };
    return (
      library?.playlists.find((item) => item.id === selectedPlaylist) ?? null
    );
  }, [
    isSearching,
    query,
    scopedTracks.length,
    selectedPlaylist,
    currentGenreCluster,
    library,
    activeArtist,
  ]);

  // A remembered playlist may have been deleted since the last session.
  useEffect(() => {
    if (library && !isSearching && !playlist) setSelectedPlaylist("home");
  }, [isSearching, library, playlist, setSelectedPlaylist]);

  // "Unrated" means no stars of any kind: neither the user's nor the model's.
  const unratedIds = useMemo(
    () =>
      basePlaylistTracks
        .filter((track) => track.rating === null && track.aiRating == null)
        .map((track) => track.id),
    [basePlaylistTracks],
  );
  const ratingJob = jobs.find(
    (job) =>
      job.kind === "rating" &&
      isActiveJob(job) &&
      job.playlistId === selectedPlaylist,
  );

  const {
    audioRef,
    currentTrack,
    isPlaying,
    setIsPlaying,
    progress,
    setProgress,
    duration,
    shuffle,
    queueName,
    queueSource,
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
  } = usePlayer({
    library,
    setLibrary,
    selectedPlaylist,
    playlistName: playlist?.name ?? "Phone music",
    settings,
    setSettings,
    setNotice,
    currentId,
    setCurrentId,
  });

  // Safe sequential duration probe: ONE audio element at a time, only for the
  // currently visible playlist (max 60), released properly after each file.
  // The previous parallel version (24x Audio at once across the whole library)
  // could flood RAM when the server sends full files instead of ranges.
  const probedDurationsRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    const pending = playlistTracks
      .filter((t) => !(t.duration > 0) && !probedDurationsRef.current.has(t.id))
      .slice(0, 60);
    if (!pending.length) return;
    let cancelled = false;
    const audio = new Audio();
    audio.preload = "metadata";
    let index = 0;
    let timer = 0;
    const release = () => {
      audio.pause();
      audio.removeAttribute("src");
      audio.load();
    };
    const step = () => {
      if (cancelled || index >= pending.length) {
        release();
        return;
      }
      const item = pending[index++];
      probedDurationsRef.current.add(item.id);
      const advance = () => {
        if (cancelled) return;
        timer = window.setTimeout(step, 150);
      };
      const onDone = () => {
        const d = audio.duration;
        if (!cancelled && Number.isFinite(d) && d > 0) {
          setLibrary((cur) =>
            cur
              ? {
                  ...cur,
                  tracks: cur.tracks.map((x) =>
                    x.id === item.id ? { ...x, duration: d } : x,
                  ),
                }
              : cur,
          );
        }
        release();
        advance();
      };
      const onFail = () => {
        release();
        advance();
      };
      audio.addEventListener("loadedmetadata", onDone, { once: true });
      audio.addEventListener("error", onFail, { once: true });
      audio.src = item.audioUrl;
    };
    timer = window.setTimeout(step, 400);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      release();
    };
  }, [playlistTracks]);

  function selectPlaylist(item: { id: string; name?: string; count?: number }) {
    viewScrollRef.current?.scrollTo(0, 0);
    setSelectedPlaylist(item.id);
    setSettingsPage(false);
    setProfileOpen(false);
    setQuery("");
    setLinkOpen(false);
    setRatingFilter("all");
    setActiveArtist(null);
  }

  function handleSelectArtist(artist: string) {
    setSelectedPlaylist("all");
    setRatingFilter("all");
    setQuery("");
    setActiveArtist(artist);
  }

  const handleColumnSort = useCallback(
    (field: SortByType) => {
      if (field === "index") {
        setSortBy("index");
        setSortOrder("asc");
        return;
      }
      if (sortBy === field) {
        setSortOrder((prev) => (prev === "asc" ? "desc" : "asc"));
      } else {
        setSortBy(field);
        setSortOrder(field === "title" ? "asc" : "desc");
      }
    },
    [sortBy],
  );

  function rateUnrated() {
    if (!unratedIds.length) return;
    void startRating({
      trackIds: unratedIds,
      playlistId: selectedPlaylist,
      playlistName: playlist?.name ?? "Playlist",
    });
  }

  // Asks the track list to scroll to a song; cleared once it has.
  const [revealRequest, setRevealRequest] = useState<{
    id: string;
    key: number;
  } | null>(null);

  const clearRevealRequest = useCallback(() => setRevealRequest(null), []);

  // Opens the list the song is playing from (or its folder) and scrolls to it.
  function revealCurrentTrack() {
    if (!library || !currentTrack) return;
    const inView =
      !settingsPage &&
      selectedPlaylist !== "home" &&
      playlistTracks.some((track) => track.id === currentTrack.id);
    if (!inView) {
      const fromQueue =
        queueSource !== "home" &&
        tracksInPlaylist(library.tracks, queueSource).some(
          (track) => track.id === currentTrack.id,
        );
      selectPlaylist({ id: fromQueue ? queueSource : currentTrack.playlistId });
    }
    setRevealRequest({ id: currentTrack.id, key: Date.now() });
  }

  // Escape closes the topmost overlay. Popovers and dialogs handle their own
  // Escape first and mark the event handled.
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      if (vizOpen) setVizOpen(false);
      else if (queueOpen) setQueueOpen(false);
      else return;
      event.preventDefault();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [vizOpen, queueOpen]);

  function playPlaylistInOrder() {
    if (!playlistTracks.length) return;
    startQueue(playlistTracks, playlist?.name ?? "Playlist", playlistTracks[0]);
  }

  function playPlaylistShuffled() {
    if (!playlistTracks.length) return;
    startQueue(
      playlistTracks,
      playlist?.name ?? "Playlist",
      playlistTracks[Math.floor(Math.random() * playlistTracks.length)],
      true,
    );
  }

  const likeTrack = useCallback(
    (track: Track) => {
      void updateLike(track.id, !track.liked);
    },
    [updateLike],
  );
  const rateTrack = useCallback(
    (track: Track, rating: number | null) => {
      void updateRating(track.id, rating);
    },
    [updateRating],
  );
  const handleSearchYouTube = useCallback(
    async (track: Track) => {
      try {
        await searchTrackOnYouTube(track);
      } catch (reason) {
        setNotice(
          reason instanceof Error
            ? reason.message
            : "Could not open YouTube search.",
          "error",
        );
      }
    },
    [setNotice],
  );

  function cycleRepeat() {
    if (!currentTrack) return;
    setRepeatMode((mode) =>
      mode === "off" ? "all" : mode === "all" ? "one" : "off",
    );
  }

  function seekCurrent(position: number) {
    if (!currentTrack) return;
    const length = duration || currentTrack.duration;
    seek(
      Math.max(
        0,
        Number.isFinite(length) && length > 0
          ? Math.min(position, length)
          : position,
      ),
    );
  }

  useKeyboardShortcuts({
    togglePlayback: () => {
      if (currentTrack) void togglePlayback();
    },
    next: () => {
      if (currentTrack) adjacentTrack(1);
    },
    previous: () => {
      if (currentTrack) adjacentTrack(-1);
    },
    seekBy: (delta) => seekCurrent(progress + delta),
    volumeBy: (delta) => {
      if (currentTrack) setVolume(settings.volume + delta);
    },
    toggleMute: () => {
      if (currentTrack) toggleMute();
    },
    toggleShuffle: () => {
      if (currentTrack) toggleShuffle();
    },
    cycleRepeat,
    toggleLike: () => {
      if (!currentTrack) return;
      likeTrack(currentTrack);
      setNotice(shortcutNotice(currentTrack, "like"));
    },
    rate: (rating) => {
      if (!currentTrack) return;
      void updateRating(currentTrack.id, rating);
      setNotice(shortcutNotice(currentTrack, rating));
    },
    focusSearch: () => {
      const search = document.getElementById(
        "kolo-search",
      ) as HTMLInputElement | null;
      search?.focus();
      search?.select();
    },
    toggleQueue: () => {
      if (currentTrack) setQueueOpen((value) => !value);
    },
    openShortcuts: () => setShortcutsOpen(true),
  });

  useMediaSession({
    track: currentTrack,
    queueName,
    isPlaying,
    duration: duration || currentTrack?.duration || 0,
    progress,
    audioRef,
    play: () => {
      if (currentTrack && audioRef.current?.paused) void togglePlayback();
    },
    pause: () => {
      if (currentTrack) audioRef.current?.pause();
    },
    previous: () => {
      if (currentTrack) adjacentTrack(-1);
    },
    next: () => {
      if (currentTrack) adjacentTrack(1);
    },
    seek: seekCurrent,
  });

  if (!library) {
    return (
      <div className="loading-screen">
        <img className="brand-mark" src="/icon.svg" alt="Kolo" />
        {error ? (
          <>
            <h2>Library unavailable</h2>
            <p>{error}</p>
            <button onClick={() => void refreshLibrary()}>Try again</button>
          </>
        ) : (
          <>
            <LoaderCircle className="spinner" />
            <p>Loading your music…</p>
          </>
        )}
      </div>
    );
  }

  const jobActions: JobActions = {
    onCancel: (id) => void cancelJob(id),
    onRetry: (id) => void retryJob(id),
    onDismiss: (id) => void dismissJob(id),
    onClearFinished: () => void clearFinishedJobs(),
    onOpenPlaylist: (id) => {
      selectPlaylist({ id });
      setActivityOpen(false);
    },
  };

  const visiblePlaylists = library.playlists.filter((p) => p.id !== "negative");
  const negativePlaylist = library.playlists.find((p) => p.id === "negative");

  return (
    <div
      className={`app-shell ${sidebarCollapsed ? "sidebar-collapsed" : ""} ${queueOpen ? "queue-visible" : ""}`}
    >
      <audio
        ref={audioRef}
        preload="auto"
        onPlay={() => setIsPlaying(true)}
        onPause={() => setIsPlaying(false)}
        onTimeUpdate={(event) => {
          if (!audioRef.current?.seeking) {
            setProgress(event.currentTarget.currentTime);
          }
        }}
        onLoadedMetadata={(event) => handleLoadedMetadata(event.currentTarget)}
        onEnded={handleEnded}
        onError={() =>
          setNotice(
            "Could not play this file. Check the file format and path.",
            "error",
          )
        }
      />

      <Sidebar
        playlists={visiblePlaylists}
        negativePlaylist={negativePlaylist}
        selectedPlaylist={selectedPlaylist}
        settingsPage={settingsPage}
        collapsed={sidebarCollapsed}
        showHiddenPlaylists={showHiddenPlaylists}
        onSelectPlaylist={selectPlaylist}
        onCreatePlaylist={() => void createNewPlaylist()}
        onToggleCollapsed={() => setSidebarCollapsed((value) => !value)}
        onToggleHidden={() => setShowHiddenPlaylists((value) => !value)}
      />

      <main className="main-content">
        <TopBar
          selectedPlaylist={selectedPlaylist}
          settingsPage={settingsPage}
          query={query}
          profileOpen={profileOpen}
          activity={
            <Activity
              jobs={jobs}
              currentPlaylistId={selectedPlaylist}
              open={activityOpen}
              onToggle={() => setActivityOpen((value) => !value)}
              onClose={() => setActivityOpen(false)}
              {...jobActions}
            />
          }
          onHome={() => selectPlaylist({ id: "home", name: "Home" })}
          onQueryChange={(text) => {
            setQuery(text);
            if (text) setSettingsPage(false);
            viewScrollRef.current?.scrollTo(0, 0);
          }}
          onClearQuery={() => setQuery("")}
          onToggleProfile={() => setProfileOpen((value) => !value)}
          onCloseProfile={() => setProfileOpen(false)}
          onOpenShortcuts={() => {
            setShortcutsOpen(true);
            setProfileOpen(false);
          }}
          onOpenSettings={() => {
            setSettingsPage(true);
            setProfileOpen(false);
            setQuery("");
          }}
        />

        <div className="view-scroll" ref={viewScrollRef}>
          {settingsPage && !isSearching ? (
            <div key="settings" className="page settings-page page-enter">
              <SettingsPage
                settings={settings}
                onChange={setSettings}
                dataRoot={library.dataRoot}
              />
            </div>
          ) : selectedPlaylist === "home" && !isSearching ? (
            <div key="home" className="page home-page page-enter">
              <HomePage
                library={library}
                onPlayRated={(minStars) => {
                  const tracks = library.tracks.filter(
                    (t) => (t.rating ?? 0) >= minStars,
                  );
                  if (!tracks.length) {
                    setNotice("No songs with this rating yet.");
                    return;
                  }
                  startQueue(
                    tracks,
                    minStars <= 0.5 ? "Rated songs" : `${minStars}★ songs`,
                    tracks[Math.floor(Math.random() * tracks.length)],
                    true,
                    "home",
                  );
                }}
                onViewRated={(filterKey) => {
                  setSelectedPlaylist(
                    filterKey === "all" ? "all" : `rating:${filterKey}`,
                  );
                  setRatingFilter("all");
                  setQuery("");
                  setActiveArtist(null);
                }}
                onPlayGenre={(genreCluster) => {
                  const tracks = library.tracks.filter(
                    (t) => t.cluster === genreCluster.id,
                  );
                  if (!tracks.length) {
                    setNotice("No songs found in this genre.");
                    return;
                  }
                  startQueue(
                    tracks,
                    genreCluster.name,
                    tracks[Math.floor(Math.random() * tracks.length)],
                    true,
                    `genre:${genreCluster.id}`,
                  );
                }}
                onViewGenre={(genreCluster) => {
                  setSelectedPlaylist(`genre:${genreCluster.id}`);
                  setQuery("");
                  setActiveArtist(null);
                }}
                onOpenVisualization={() => setVizOpen(true)}
                onPlayTrack={(track) => playTrack(track, library.tracks)}
              />
            </div>
          ) : (
            <div
              key={isSearching ? "search" : selectedPlaylist}
              className="page playlist-page page-enter"
            >
              <PlaylistHeader
                playlist={playlist}
                totalDuration={isSearching ? "" : totalDuration}
                unratedCount={isSearching ? 0 : unratedIds.length}
                ratingJob={isSearching ? undefined : ratingJob}
                canImport={!isSearching && !isVirtualView(selectedPlaylist)}
                onPlay={playPlaylistInOrder}
                onShuffle={playPlaylistShuffled}
                onImport={openImport}
                onLink={() => setLinkOpen((value) => !value)}
                onRateUnrated={isSearching ? undefined : rateUnrated}
              />

              {!isSearching && (
                <ImportControls
                  selectedPlaylist={selectedPlaylist}
                  linkOpen={linkOpen}
                  linkInput={linkInput}
                  downloads={
                    <Downloads
                      jobs={jobs.filter((job) => job.kind !== "rating")}
                      currentPlaylistId={selectedPlaylist}
                      {...jobActions}
                    />
                  }
                  onLinkInput={setLinkInput}
                  onOpenLink={() => void handleLink()}
                  onDownload={() => void downloadLinks()}
                  onImportLocal={openImport}
                />
              )}

              <TrackFilters
                value={ratingFilter}
                counts={filterCounts}
                onChange={setRatingFilter}
              />

              {activeArtist && (
                <ArtistBanner
                  artist={activeArtist}
                  trackCount={playlistTracks.length}
                  onPlay={() => {
                    if (playlistTracks.length) {
                      startQueue(
                        playlistTracks,
                        activeArtist,
                        playlistTracks[0],
                        true,
                      );
                    }
                  }}
                  onClear={() => setActiveArtist(null)}
                />
              )}

              <TrackList
                key={`${isSearching ? "search" : selectedPlaylist}:${ratingFilter}:${sortBy}:${sortOrder}:${query}:${activeArtist ?? ""}:${settings.vibeFilter}`}
                tracks={playlistTracks}
                currentId={currentId}
                isPlaying={isPlaying}
                sortBy={sortBy}
                sortOrder={sortOrder}
                revealRequest={revealRequest}
                emptyHint={
                  isSearching
                    ? "Try a different spelling, or search by artist."
                    : ratingFilter !== "all" || activeArtist
                      ? "Clear the filter to see every song here."
                      : undefined
                }
                onSort={handleColumnSort}
                onPlay={(track) => playTrack(track, playlistTracks)}
                onRate={rateTrack}
                onLike={likeTrack}
                onSelectArtist={handleSelectArtist}
                onRevealed={clearRevealRequest}
              />
            </div>
          )}
        </div>
      </main>

      {currentTrack && (
        <PlayerBar
          track={currentTrack}
          isPlaying={isPlaying}
          progress={progress}
          duration={duration || currentTrack.duration}
          volume={settings.volume}
          shuffle={shuffle}
          repeatMode={repeatMode}
          onPlay={() => void togglePlayback()}
          onPrevious={() => adjacentTrack(-1)}
          onNext={() => adjacentTrack(1)}
          onSeek={seek}
          onVolume={setVolume}
          onMute={toggleMute}
          onShuffle={toggleShuffle}
          onRepeat={cycleRepeat}
          onQueue={() => setQueueOpen((value) => !value)}
          onRate={(rating) => void updateRating(currentTrack.id, rating)}
          onLike={() => likeTrack(currentTrack)}
          onSelectArtist={handleSelectArtist}
          onSearchYouTube={handleSearchYouTube}
          onReveal={revealCurrentTrack}
        />
      )}

      <input
        ref={fileInputRef}
        hidden
        type="file"
        multiple
        accept="audio/*,.mp3,.m4a,.flac,.wav,.ogg,.aac,.opus,.webm"
        onChange={(event) =>
          void beginImport(Array.from(event.target.files ?? []))
        }
      />

      {queueOpen && (
        <QueuePanel
          tracks={queueTracks}
          name={queueName}
          currentId={currentId}
          onPlay={playQueuedTrack}
          onClose={() => setQueueOpen(false)}
        />
      )}

      {vizOpen && (
        <div
          className="viz-modal-overlay"
          role="dialog"
          aria-modal="true"
          aria-labelledby="viz-title"
        >
          <div className="viz-modal-header">
            <h3 id="viz-title">
              3D Latent Space Explorer <small>MuQ-MuLan · 512D</small>
            </h3>
            <button
              className="viz-modal-close"
              onClick={() => setVizOpen(false)}
              autoFocus
            >
              <X size={16} /> Close <kbd>Esc</kbd>
            </button>
          </div>
          <iframe
            src="/cluster_visualization.html"
            className="viz-iframe"
            title="3D Latent Space Explorer"
          />
        </div>
      )}

      <ShortcutsDialog
        open={shortcutsOpen}
        onClose={() => setShortcutsOpen(false)}
      />

      <div className="toast-region" role="status" aria-live="polite">
        {notice && (
          <div
            key={notice.key}
            className={`toast toast-enter ${notice.tone === "error" ? "toast-error" : ""}`}
          >
            {notice.tone === "error" ? <AlertTriangle /> : <Info />}
            <span>{notice.message}</span>
            <button
              onClick={() => setNoticeState(null)}
              aria-label="Dismiss message"
            >
              <X />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
