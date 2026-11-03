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
import {
  memo,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import {
  formatTime,
  playlistIcon,
  splitArtists,
  type SortByType,
  type SortOrderType,
} from "../appConfig";
import type { Job, Playlist, Track } from "../types";
import { Artwork } from "./Artwork";
import { StarRating } from "./StarRating";

export function PlaylistHeader({
  playlist,
  totalDuration = "",
  unratedCount = 0,
  ratingJob,
  canImport = true,
  onPlay,
  onShuffle,
  onImport,
  onLink,
  onRateUnrated,
}: {
  playlist: Playlist | null;
  totalDuration?: string;
  // Songs here with neither a personal rating nor a model estimate.
  unratedCount?: number;
  // The rating run that is working through this playlist, if any.
  ratingJob?: Job;
  // Folder playlists accept files and links; filtered views do not.
  canImport?: boolean;
  onPlay: () => void;
  onShuffle: () => void;
  onImport: () => void;
  onLink: () => void;
  onRateUnrated?: () => void;
}) {
  const Icon = playlist ? playlistIcon(playlist.id) : Music2;
  const count = playlist?.count ?? 0;
  return (
    <section className="playlist-header">
      <div className="playlist-cover">
        <Icon fill={playlist?.id === "liked" ? "currentColor" : "none"} />
      </div>
      <div className="playlist-heading">
        <h1 title={playlist?.name}>{playlist?.name ?? "Playlist"}</h1>
        <p>
          {count} {count === 1 ? "song" : "songs"}
          {totalDuration && <> · {totalDuration}</>}
        </p>
      </div>
      <div className="playlist-actions">
        <button
          className="playlist-play"
          onClick={onPlay}
          disabled={!count}
          aria-label="Play all songs"
        >
          <Play fill="currentColor" /> Play
        </button>
        <button onClick={onShuffle} disabled={!count}>
          <Shuffle /> Shuffle play
        </button>
        {onRateUnrated && (ratingJob || unratedCount > 0) && (
          <button
            onClick={onRateUnrated}
            disabled={Boolean(ratingJob)}
            title="Estimate stars for the songs here that have no rating yet, using your rating model"
          >
            <Sparkles />{" "}
            {ratingJob
              ? `Rating ${ratingJob.completed + ratingJob.failed} of ${ratingJob.total}…`
              : `Rate ${unratedCount} unrated`}
          </button>
        )}
        {canImport && (
          <>
            <button onClick={onImport}>
              <Upload /> Import songs
            </button>
            <button
              onClick={onLink}
              aria-label="Add link or search"
              title="Add a YouTube or Spotify link"
            >
              <Link2 />
            </button>
          </>
        )}
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
  revealRequest = null,
  emptyHint = "Import music or change your search and filter.",
  onSort,
  onPlay,
  onRate,
  onLike,
  onSelectArtist,
  onRevealed,
}: {
  tracks: Track[];
  currentId: string | null;
  isPlaying: boolean;
  sortBy?: SortByType;
  sortOrder?: SortOrderType;
  // A song to scroll to and briefly highlight.
  revealRequest?: { id: string; key: number } | null;
  emptyHint?: string;
  onSort?: (field: SortByType) => void;
  onPlay: (track: Track) => void;
  onRate: (track: Track, rating: number | null) => void;
  onLike: (track: Track) => void;
  onSelectArtist: (artist: string) => void;
  onRevealed?: () => void;
}) {
  const [visibleCount, setVisibleCount] = useState(60);
  const [flashId, setFlashId] = useState<string | null>(null);
  const loadMoreRef = useRef<HTMLDivElement>(null);
  const tableRef = useRef<HTMLDivElement>(null);

  // Rows render progressively, so a song far down the list is rendered first
  // and scrolled to on the next pass.
  useEffect(() => {
    if (!revealRequest) return;
    const index = tracks.findIndex((track) => track.id === revealRequest.id);
    if (index === -1) {
      onRevealed?.();
      return;
    }
    if (index >= visibleCount) {
      setVisibleCount(Math.min(tracks.length, index + 20));
      return;
    }
    const row = tableRef.current?.querySelector(
      `[data-track-id="${CSS.escape(revealRequest.id)}"]`,
    );
    row?.scrollIntoView({ block: "center", behavior: "smooth" });
    setFlashId(revealRequest.id);
    onRevealed?.();
  }, [revealRequest, tracks, visibleCount, onRevealed]);

  useEffect(() => {
    if (!flashId) return;
    const timeout = window.setTimeout(() => setFlashId(null), 1600);
    return () => window.clearTimeout(timeout);
  }, [flashId]);

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
        <p>{emptyHint}</p>
      </div>
    );
  return (
    <div className="track-table" ref={tableRef}>
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
          flash={track.id === flashId}
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
  flash,
  onPlay,
  onRate,
  onLike,
  onSelectArtist,
}: {
  track: Track;
  index: number;
  active: boolean;
  playing: boolean;
  flash: boolean;
  onPlay: (track: Track) => void;
  onRate: (track: Track, rating: number | null) => void;
  onLike: (track: Track) => void;
  onSelectArtist: (artist: string) => void;
}) {
  const artists = useMemo(() => splitArtists(track.artist), [track.artist]);

  return (
    <div
      className={`track-row ${active ? "active" : ""} ${flash ? "revealed" : ""}`}
      onClick={() => onPlay(track)}
      data-testid="track-row"
      data-track-id={track.id}
    >
      <button
        type="button"
        className="track-index"
        onClick={(event) => {
          event.stopPropagation();
          onPlay(track);
        }}
        aria-label={`${playing ? "Pause" : "Play"} ${track.title}`}
      >
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
      </button>
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
      {track.vibeScore === null ? (
        <span className="vibe-value empty" title="Not scored yet">
          —
        </span>
      ) : (
        <span
          className={`vibe-value ${track.vibeScore >= 0.6 ? "high" : ""}`}
          style={{ "--vibe": track.vibeScore } as CSSProperties}
          title="How well this song matches your taste, according to the model"
        >
          {Math.round(track.vibeScore * 100)}%
        </span>
      )}
      <span className="track-time">{formatTime(track.duration)}</span>
    </div>
  );
});
