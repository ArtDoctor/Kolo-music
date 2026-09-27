import {
  ChevronDown,
  ChevronUp,
  Heart,
  Link2,
  Music2,
  Play,
  Shuffle,
  Sparkles,
  Upload,
} from "lucide-react";
import { memo, useEffect, useMemo, useRef, useState } from "react";
import {
  formatTime,
  playlistIcon,
  splitArtists,
  type SortByType,
  type SortOrderType,
} from "../appConfig";
import type { Playlist, Track } from "../types";
import { Artwork } from "./Artwork";
import { StarRating } from "./StarRating";

export function PlaylistHeader({
  playlist,
  onImport,
  onShuffle,
  onLink,
}: {
  playlist: Playlist | null;
  onImport: () => void;
  onShuffle: () => void;
  onLink: () => void;
}) {
  const Icon = playlist ? playlistIcon(playlist.id) : Music2;
  return (
    <section className="playlist-header">
      <div className="playlist-cover">
        <Icon fill={playlist?.id === "liked" ? "currentColor" : "none"} />
      </div>
      <div>
        <h1>{playlist?.name ?? "Playlist"}</h1>
        <p>{playlist?.count ?? 0} songs</p>
      </div>
      <div className="playlist-actions">
        <button onClick={onShuffle}>
          <Shuffle /> Shuffle play
        </button>
        <button onClick={onImport}>
          <Upload /> Import songs
        </button>
        <button onClick={onLink} aria-label="Add link or search">
          <Link2 />
        </button>
      </div>
    </section>
  );
}

function formatDate(mtime?: number) {
  if (!mtime || !Number.isFinite(mtime)) return "—";
  return new Date(mtime).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

export const TrackList = memo(function TrackList({
  tracks,
  currentId,
  isPlaying,
  sortBy = "date",
  sortOrder = "desc",
  onSort,
  onPlay,
  onRate,
  onLike,
  onSelectArtist,
}: {
  tracks: Track[];
  currentId: string | null;
  isPlaying: boolean;
  sortBy?: SortByType;
  sortOrder?: SortOrderType;
  onSort?: (field: SortByType) => void;
  onPlay: (track: Track) => void;
  onRate: (track: Track, rating: number | null) => void;
  onLike: (track: Track) => void;
  onSelectArtist: (artist: string) => void;
}) {
  const [visibleCount, setVisibleCount] = useState(60);
  const loadMoreRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const target = loadMoreRef.current;
    if (!target || visibleCount >= tracks.length) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting)
          setVisibleCount((count) => Math.min(count + 80, tracks.length));
      },
      { rootMargin: "500px 0px" },
    );
    observer.observe(target);
    return () => observer.disconnect();
  }, [tracks.length, visibleCount]);

  if (!tracks.length)
    return (
      <div className="empty-state">
        <Music2 />
        <h2>No songs here yet</h2>
        <p>Import music or change your search and filter.</p>
      </div>
    );
  return (
    <div className="track-table">
      <div className="track-head">
        <button
          type="button"
          className={`track-col-btn track-col-idx ${sortBy === "index" ? "active" : ""}`}
          onClick={() => onSort?.("index")}
          title="Reset to default order"
        >
          #
        </button>
        <button
          type="button"
          className={`track-col-btn track-col-title ${sortBy === "title" ? "active" : ""}`}
          onClick={() => onSort?.("title")}
          title="Sort by Title"
        >
          <span>Title</span>
          {sortBy === "title" &&
            (sortOrder === "asc" ? (
              <ChevronUp size={13} />
            ) : (
              <ChevronDown size={13} />
            ))}
        </button>
        <button
          type="button"
          className={`track-col-btn track-col-date ${sortBy === "date" ? "active" : ""}`}
          onClick={() => onSort?.("date")}
          title="Sort by Date"
        >
          <span>Date</span>
          {sortBy === "date" &&
            (sortOrder === "asc" ? (
              <ChevronUp size={13} />
            ) : (
              <ChevronDown size={13} />
            ))}
        </button>
        <button
          type="button"
          className={`track-col-btn track-col-rating ${sortBy === "rating" ? "active" : ""}`}
          onClick={() => onSort?.("rating")}
          title="Sort by Your rating"
        >
          <span>Your rating</span>
          {sortBy === "rating" &&
            (sortOrder === "asc" ? (
              <ChevronUp size={13} />
            ) : (
              <ChevronDown size={13} />
            ))}
        </button>
        <button
          type="button"
          className={`track-col-btn track-col-vibe ${sortBy === "vibe" ? "active" : ""}`}
          onClick={() => onSort?.("vibe")}
          title="Sort by Vibe"
        >
          <span>Vibe</span>
          {sortBy === "vibe" &&
            (sortOrder === "asc" ? (
              <ChevronUp size={13} />
            ) : (
              <ChevronDown size={13} />
            ))}
        </button>
        <button
          type="button"
          className={`track-col-btn track-col-time ${sortBy === "duration" ? "active" : ""}`}
          onClick={() => onSort?.("duration")}
          title="Sort by Time"
        >
          <span>Time</span>
          {sortBy === "duration" &&
            (sortOrder === "asc" ? (
              <ChevronUp size={13} />
            ) : (
              <ChevronDown size={13} />
            ))}
        </button>
      </div>
      {tracks.slice(0, visibleCount).map((track, index) => (
        <TrackRow
          key={track.id}
          track={track}
          index={index}
          active={track.id === currentId}
          playing={track.id === currentId && isPlaying}
          onPlay={onPlay}
          onRate={onRate}
          onLike={onLike}
          onSelectArtist={onSelectArtist}
        />
      ))}
      {visibleCount < tracks.length && (
        <div ref={loadMoreRef} className="list-sentinel" aria-hidden="true" />
      )}
    </div>
  );
});

const TrackRow = memo(function TrackRow({
  track,
  index,
  active,
  playing,
  onPlay,
  onRate,
  onLike,
  onSelectArtist,
}: {
  track: Track;
  index: number;
  active: boolean;
  playing: boolean;
  onPlay: (track: Track) => void;
  onRate: (track: Track, rating: number | null) => void;
  onLike: (track: Track) => void;
  onSelectArtist: (artist: string) => void;
}) {
  const artists = useMemo(() => splitArtists(track.artist), [track.artist]);

  return (
    <div
      className={`track-row ${active ? "active" : ""}`}
      onClick={() => onPlay(track)}
      data-testid="track-row"
      data-track-id={track.id}
    >
      <span className="track-index">
        {playing ? (
          <span className="playing-bars">
            <i />
            <i />
            <i />
          </span>
        ) : (
          <>
            <span>{index + 1}</span>
            <Play className="row-play" fill="currentColor" />
          </>
        )}
      </span>
      <span className="track-title">
        <Artwork track={track} size="small" />
        <span>
          <div className="track-title-heading">
            <strong>{track.title}</strong>
          </div>
          <small onClick={(e) => e.stopPropagation()}>
            {artists.map((artist, idx) => (
              <span key={idx}>
                <button
                  type="button"
                  className="artist-link"
                  onClick={() => onSelectArtist(artist)}
                  title={`View songs by ${artist}`}
                >
                  {artist}
                </button>
                {idx < artists.length - 1 && (
                  <span className="artist-separator">•</span>
                )}
              </span>
            ))}
          </small>
        </span>
      </span>
      <span className="track-date">{formatDate(track.mtime)}</span>
      <span
        className="track-preferences"
        onClick={(event) => event.stopPropagation()}
      >
        <button
          className={`heart-button ${track.liked ? "liked" : ""}`}
          onClick={() => onLike(track)}
          aria-label={track.liked ? "Unlike song" : "Like song"}
        >
          <Heart fill={track.liked ? "currentColor" : "none"} />
        </button>
        <StarRating
          compact
          value={track.rating}
          aiValue={track.aiRating}
          onChange={(rating) => onRate(track, rating)}
        />
      </span>
      <span className="vibe-value">
        {track.vibeScore === null ? (
          <Sparkles />
        ) : (
          `${Math.round(track.vibeScore * 100)}%`
        )}
      </span>
      <span className="track-time">{formatTime(track.duration)}</span>
    </div>
  );
});
