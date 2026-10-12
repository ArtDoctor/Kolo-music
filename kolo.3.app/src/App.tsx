import { isTauri } from "@tauri-apps/api/core";
import { Check, LoaderCircle, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  defaultSettings,
  GENRE_CLUSTERS,
  hexToRgb,
  tracksInPlaylist,
  type RatingFilterType,
  type SortByType,
  type SortOrderType,
} from "./appConfig";
import { HomePage } from "./components/HomePage";
import { ImportControls } from "./components/ImportControls";
import { Sidebar, TopBar } from "./components/Navigation";
import { PlayerBar } from "./components/PlayerBar";
import { QueuePanel } from "./components/QueuePanel";
import { SettingsPage } from "./components/SettingsPage";
import { PlaylistHeader, TrackList } from "./components/TrackList";
import { ArtistBanner, TrackFilters } from "./components/TrackToolbar";
import { useImports } from "./hooks/useImports";
import { useLibrary } from "./hooks/useLibrary";
import { useLocalStorage } from "./hooks/useLocalStorage";
import { usePlayer } from "./hooks/usePlayer";
import { searchTrackOnYouTube } from "./library";
import type { PlayerSettings, Playlist, Track } from "./types";

export default function App() {
  const [selectedPlaylist, setSelectedPlaylist] = useState("home");
  const [settingsPage, setSettingsPage] = useState(false);
  const [query, setQuery] = useState("");
  const [sidebarCollapsed, setSidebarCollapsed] = useLocalStorage(
    "kolo.sidebarCollapsed",
    false,
  );
  const [profileOpen, setProfileOpen] = useState(false);
  const [queueOpen, setQueueOpen] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
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

  const [ratingFilter, setRatingFilter] = useState<RatingFilterType>("all");
  const [sortBy, setSortBy] = useState<SortByType>("date");
  const [sortOrder, setSortOrder] = useState<SortOrderType>("desc");
  const [activeArtist, setActiveArtist] = useState<string | null>(null);
  const [showHiddenPlaylists, setShowHiddenPlaylists] = useState(false);
  const [vizOpen, setVizOpen] = useState(false);

  const viewScrollRef = useRef<HTMLDivElement>(null);
  const {
    linkOpen,
    setLinkOpen,
    linkInput,
    setLinkInput,
    downloading,
    spotifyStatus,
    fileInputRef,
    createNewPlaylist,
    handleLink,
    downloadSpotifyLink,
    downloadLink,
    beginImport,
    openImport,
  } = useImports({
    library,
    selectedPlaylist,
    setSelectedPlaylist,
    setSettingsPage,
    setNotice,
    refreshLibrary,
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
    const timeout = window.setTimeout(() => setNotice(null), 3000);
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

  const playlistTracks = useMemo(() => {
    if (!library) return [];
    let base = basePlaylistTracks;

    if (activeArtist) {
      const lower = activeArtist.toLowerCase();
      base = base.filter((t) => t.artist.toLowerCase().includes(lower));
    }

    if (ratingFilter === "5") {
      base = base.filter((t) => t.rating === 5);
    } else if (ratingFilter === "4.5") {
      base = base.filter((t) => (t.rating ?? 0) >= 4.5);
    } else if (ratingFilter === "4") {
      base = base.filter((t) => (t.rating ?? 0) >= 4);
    } else if (ratingFilter === "3.5") {
      base = base.filter((t) => (t.rating ?? 0) >= 3.5);
    } else if (ratingFilter === "rated") {
      base = base.filter((t) => t.rating !== null && t.rating > 0);
    } else if (ratingFilter === "unrated") {
      base = base.filter(
        (t) =>
          t.rating === null &&
          t.playlistId !== "negative" &&
          !t.id.startsWith("neg/"),
      );
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
  }, [
    basePlaylistTracks,
    activeArtist,
    ratingFilter,
    query,
    settings.vibeFilter,
    sortBy,
    sortOrder,
    library,
  ]);

  const playlist: Playlist | null = useMemo(() => {
    if (isSearching) {
      return {
        id: "search",
        name: `Search: "${query.trim()}"`,
        count: playlistTracks.length,
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
    playlistTracks.length,
    selectedPlaylist,
    currentGenreCluster,
    library,
    activeArtist,
  ]);

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
  const handleSearchYouTube = useCallback(async (track: Track) => {
    try {
      await searchTrackOnYouTube(track);
    } catch (reason) {
      setNotice(
        reason instanceof Error
          ? reason.message
          : "Could not open YouTube search.",
      );
    }
  }, []);

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
          setNotice("Could not play this file. Check the file format and path.")
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
          onHome={() => selectPlaylist({ id: "home", name: "Home" })}
          onQueryChange={(text) => {
            setQuery(text);
            if (text) setSettingsPage(false);
          }}
          onClearQuery={() => setQuery("")}
          onToggleProfile={() => setProfileOpen((value) => !value)}
          onOpenSettings={() => {
            setSettingsPage(true);
            setProfileOpen(false);
            setQuery("");
          }}
        />

        <div className="view-scroll" ref={viewScrollRef}>
          {isSearching ? (
            <div key="search" className="page playlist-page page-enter">
              <PlaylistHeader
                playlist={playlist}
                onImport={openImport}
                onShuffle={playPlaylistShuffled}
                onLink={() => setLinkOpen((value) => !value)}
              />

              <TrackFilters
                value={ratingFilter}
                totalTracks={basePlaylistTracks.length}
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
                key={`search:${ratingFilter}:${sortBy}:${sortOrder}:${query}:${activeArtist ?? ""}:${settings.vibeFilter}`}
                tracks={playlistTracks}
                currentId={currentId}
                isPlaying={isPlaying}
                sortBy={sortBy}
                sortOrder={sortOrder}
                onSort={handleColumnSort}
                onPlay={(track) => playTrack(track, playlistTracks)}
                onRate={rateTrack}
                onLike={likeTrack}
                onSelectArtist={handleSelectArtist}
              />
            </div>
          ) : settingsPage ? (
            <div key="settings" className="page settings-page page-enter">
              <SettingsPage
                settings={settings}
                onChange={setSettings}
                dataRoot={library.dataRoot}
              />
            </div>
          ) : selectedPlaylist === "home" ? (
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
                    `${minStars}★ Songs`,
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
                onSelectPlaylist={(p) => selectPlaylist(p)}
                onOpenVisualization={() => setVizOpen(true)}
                onPlayTrack={(track) => playTrack(track, library.tracks)}
              />
            </div>
          ) : (
            <div
              key={selectedPlaylist}
              className="page playlist-page page-enter"
            >
              <PlaylistHeader
                playlist={playlist}
                onImport={openImport}
                onShuffle={playPlaylistShuffled}
                onLink={() => setLinkOpen((value) => !value)}
              />

              <ImportControls
                selectedPlaylist={selectedPlaylist}
                linkOpen={linkOpen}
                linkInput={linkInput}
                downloading={downloading}
                spotifyStatus={spotifyStatus}
                onLinkInput={setLinkInput}
                onOpenLink={() => void handleLink()}
                onSpotifyDownload={() => void downloadSpotifyLink()}
                onYouTubeDownload={() => void downloadLink()}
                onImportLocal={openImport}
              />

              <TrackFilters
                value={ratingFilter}
                totalTracks={basePlaylistTracks.length}
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
                key={`${selectedPlaylist}:${ratingFilter}:${sortBy}:${sortOrder}:${query}:${activeArtist ?? ""}:${settings.vibeFilter}`}
                tracks={playlistTracks}
                currentId={currentId}
                isPlaying={isPlaying}
                sortBy={sortBy}
                sortOrder={sortOrder}
                onSort={handleColumnSort}
                onPlay={(track) => playTrack(track, playlistTracks)}
                onRate={rateTrack}
                onLike={likeTrack}
                onSelectArtist={handleSelectArtist}
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
          onRepeat={() =>
            setRepeatMode((mode) =>
              mode === "off" ? "all" : mode === "all" ? "one" : "off",
            )
          }
          onQueue={() => setQueueOpen((value) => !value)}
          onRate={(rating) => void updateRating(currentTrack.id, rating)}
          onLike={() => likeTrack(currentTrack)}
          onSelectArtist={handleSelectArtist}
          onSearchYouTube={handleSearchYouTube}
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
        <div className="viz-modal-overlay">
          <div className="viz-modal-header">
            <h3>Kolo: 3D Latent Space Explorer (MuQ-MuLan 512D)</h3>
            <button
              className="viz-modal-close"
              onClick={() => setVizOpen(false)}
            >
              <X size={16} /> Close Explorer
            </button>
          </div>
          <iframe
            src="/cluster_visualization.html"
            className="viz-iframe"
            title="3D Latent Space Explorer"
          />
        </div>
      )}

      {notice && (
        <div className="toast toast-enter">
          <Check />
          {notice}
        </div>
      )}
    </div>
  );
}
