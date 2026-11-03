import {
  Check,
  Clock,
  Globe,
  Heart,
  Music2,
  Play,
  Sparkles,
  Star,
} from "lucide-react";
import { useMemo } from "react";
import "../home.css";
import {
  formatTotalDuration,
  GENRE_CLUSTERS,
  RATING_FILTERS,
  type GenreCluster,
  type RatingFilterType,
} from "../appConfig";
import type { LibrarySnapshot, Track } from "../types";
import { Artwork } from "./Artwork";

export interface HomePageProps {
  library: LibrarySnapshot;
  onPlayRated: (minStars: number) => void;
  onViewRated: (filterKey: RatingFilterType) => void;
  onPlayGenre: (genre: GenreCluster) => void;
  onViewGenre: (genre: GenreCluster) => void;
  onOpenVisualization: () => void;
  onPlayTrack: (track: Track) => void;
}

export function HomePage({
  library,
  onPlayRated,
  onViewRated,
  onPlayGenre,
  onViewGenre,
  onOpenVisualization,
  onPlayTrack,
}: HomePageProps) {
  const allTracks = library.tracks;

  const greeting = useMemo(() => {
    const hour = new Date().getHours();
    if (hour < 12) return "Good morning";
    if (hour < 18) return "Good afternoon";
    return "Good evening";
  }, []);

  const ratingCounts = useMemo(() => {
    const counts = {} as Record<keyof typeof RATING_FILTERS, number>;
    for (const [key, matches] of Object.entries(RATING_FILTERS))
      counts[key as keyof typeof RATING_FILTERS] =
        allTracks.filter(matches).length;
    return counts;
  }, [allTracks]);
  const ratedCount = ratingCounts.rated;
  const likedCount = useMemo(
    () => allTracks.filter((t) => t.liked).length,
    [allTracks],
  );

  const ratedPercent = useMemo(
    () =>
      allTracks.length ? Math.round((ratedCount / allTracks.length) * 100) : 0,
    [allTracks.length, ratedCount],
  );

  // Durations are probed lazily, so a sum over a mostly unprobed library
  // would understate it badly.
  const totalListeningTime = useMemo(() => {
    const known = allTracks.filter((track) => track.duration > 0);
    if (!known.length || known.length < allTracks.length * 0.9) return null;
    return formatTotalDuration(
      known.reduce((sum, track) => sum + track.duration, 0),
    );
  }, [allTracks]);

  // Stable random sample of songs rated >= 4, keyed on library track count
  const favoriteTracks = useMemo(() => {
    const candidates = allTracks.filter((t) => (t.rating ?? 0) >= 4);
    if (!candidates.length) return [];
    let seed = allTracks.length * 1664525 + 1013904223;
    const rand = () => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed / 4294967296;
    };
    const shuffled = [...candidates];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      const tmp = shuffled[i];
      shuffled[i] = shuffled[j];
      shuffled[j] = tmp;
    }
    return shuffled.slice(0, 12);
  }, [allTracks.length, allTracks]);

  // Top 12 by mtime
  const recentTracks = useMemo(() => {
    return [...allTracks]
      .sort((a, b) => (b.mtime ?? 0) - (a.mtime ?? 0))
      .slice(0, 12);
  }, [allTracks]);

  // Preview tracks per genre cluster
  const genreTracksMap = useMemo(() => {
    const map = new Map<number, Track[]>();
    for (const genre of GENRE_CLUSTERS) {
      map.set(genre.id, []);
    }
    for (const track of allTracks) {
      if (track.cluster !== null && track.cluster !== undefined) {
        const list = map.get(track.cluster);
        if (list && list.length < 5) {
          list.push(track);
        }
      }
    }
    return map;
  }, [allTracks]);

  const genreCounts = useMemo(() => {
    const counts = new Map<number, number>();
    for (const genre of GENRE_CLUSTERS) {
      counts.set(genre.id, 0);
    }
    for (const track of allTracks) {
      if (track.cluster !== null && track.cluster !== undefined) {
        const c = counts.get(track.cluster);
        if (c !== undefined) {
          counts.set(track.cluster, c + 1);
        }
      }
    }
    return counts;
  }, [allTracks]);

  const ratingTiles: {
    filter: keyof typeof RATING_FILTERS;
    label: string;
    // Lowest rating played by the tile's play button; none for unrated.
    minStars?: number;
  }[] = [
    { filter: "5", label: "5.0 Stars", minStars: 5 },
    { filter: "4.5", label: "4.5+ Stars", minStars: 4.5 },
    { filter: "4", label: "4.0+ Stars", minStars: 4 },
    { filter: "3.5", label: "3.5+ Stars", minStars: 3.5 },
    { filter: "rated", label: "All Rated", minStars: 0.5 },
    { filter: "unrated", label: "Non-Rated" },
  ];

  return (
    <div className="home-root">
      {/* 1. Hero */}
      <header className="home-hero">
        <div className="home-hero-text">
          <span className="home-hero-kicker">{greeting}</span>
          <h1 className="home-hero-title">Welcome to Kolo</h1>
        </div>
        <div className="home-hero-stats">
          <div className="home-hero-chip">
            <Music2 className="home-chip-icon" size={13} aria-hidden="true" />
            <span>{allTracks.length.toLocaleString()} songs</span>
          </div>
          <div className="home-hero-chip">
            <Star className="home-chip-icon" size={13} aria-hidden="true" />
            <span>{ratedPercent}% rated</span>
          </div>
          <div className="home-hero-chip">
            <Heart className="home-chip-icon" size={13} aria-hidden="true" />
            <span>{likedCount.toLocaleString()} liked</span>
          </div>
          {totalListeningTime && (
            <div className="home-hero-chip">
              <Clock className="home-chip-icon" size={13} aria-hidden="true" />
              <span>{totalListeningTime} of music</span>
            </div>
          )}
        </div>
      </header>

      {/* 2. From your favorites shelf */}
      {favoriteTracks.length > 0 && (
        <section className="home-section">
          <div className="home-section-header">
            <h2 className="home-section-title">From your favorites</h2>
            <span className="home-section-meta">
              {favoriteTracks.length} picks
            </span>
          </div>
          <div className="home-shelf-scroll">
            {favoriteTracks.map((track) => (
              <button
                key={track.id}
                type="button"
                className="home-shelf-tile"
                onClick={() => onPlayTrack(track)}
                aria-label={`Play ${track.title} by ${track.artist}`}
              >
                <div className="home-shelf-art-wrap">
                  <Artwork track={track} size="large" />
                  <span className="home-shelf-play-badge" aria-hidden="true">
                    <Play size={20} fill="currentColor" />
                  </span>
                </div>
                <span className="home-shelf-title">{track.title}</span>
                <span className="home-shelf-artist">{track.artist}</span>
              </button>
            ))}
          </div>
        </section>
      )}

      {/* 3. Recently added shelf */}
      {recentTracks.length > 0 && (
        <section className="home-section">
          <div className="home-section-header">
            <h2 className="home-section-title">Recently added</h2>
            <span className="home-section-meta">
              {recentTracks.length} tracks
            </span>
          </div>
          <div className="home-shelf-scroll">
            {recentTracks.map((track) => (
              <button
                key={track.id}
                type="button"
                className="home-shelf-tile"
                onClick={() => onPlayTrack(track)}
                aria-label={`Play ${track.title} by ${track.artist}`}
              >
                <div className="home-shelf-art-wrap">
                  <Artwork track={track} size="large" />
                  <span className="home-shelf-play-badge" aria-hidden="true">
                    <Play size={20} fill="currentColor" />
                  </span>
                </div>
                <span className="home-shelf-title">{track.title}</span>
                <span className="home-shelf-artist">{track.artist}</span>
              </button>
            ))}
          </div>
        </section>
      )}

      {/* 4. 3D Latent Space Explorer */}
      <div className="home-explorer-banner">
        <div className="home-explorer-info">
          <div className="home-explorer-icon-wrap" aria-hidden="true">
            <Globe size={18} />
          </div>
          <div className="home-explorer-text">
            <h3 className="home-explorer-title">3D Latent Space Explorer</h3>
            <p className="home-explorer-desc">
              See your whole library as a 3D map of sound — similar songs sit
              together.
            </p>
          </div>
        </div>
        <button
          type="button"
          className="home-explorer-btn"
          onClick={onOpenVisualization}
          aria-label="Open 3D Space"
        >
          <Globe size={15} aria-hidden="true" />
          <span>Open 3D Space</span>
        </button>
      </div>

      {/* 5. Listen by rating */}
      <section className="home-section">
        <div className="home-section-header">
          <h2 className="home-section-title">Listen by rating</h2>
          <span className="home-section-meta">
            {ratedCount.toLocaleString()} of {allTracks.length.toLocaleString()}{" "}
            rated
          </span>
        </div>
        <div className="home-rating-grid">
          {ratingTiles.map(({ filter, label, minStars }) => (
            <div key={filter} className="home-rating-tile-wrap">
              <button
                type="button"
                className="home-rating-tile-btn"
                onClick={() => onViewRated(filter)}
                aria-label={`View ${label}`}
              >
                <span className="home-rating-count">
                  {ratingCounts[filter].toLocaleString()}
                </span>
                <span className="home-rating-label">
                  {filter === "unrated" ? (
                    <Sparkles size={13} aria-hidden="true" />
                  ) : filter === "rated" ? (
                    <Check size={13} aria-hidden="true" />
                  ) : (
                    <Star
                      size={13}
                      fill="currentColor"
                      className="home-rating-star-icon"
                      aria-hidden="true"
                    />
                  )}
                  <span>{label}</span>
                </span>
              </button>
              {minStars !== undefined && ratingCounts[filter] > 0 && (
                <button
                  type="button"
                  className="home-rating-play-btn"
                  onClick={() => onPlayRated(minStars)}
                  aria-label={`Play ${label.toLowerCase()} songs`}
                >
                  <Play size={13} fill="currentColor" />
                </button>
              )}
            </div>
          ))}
        </div>
      </section>

      {/* 6. Play by genre */}
      <section className="home-section">
        <div className="home-section-header">
          <h2 className="home-section-title">Play by genre</h2>
          <span className="home-section-meta">
            {GENRE_CLUSTERS.length} clusters
          </span>
        </div>
        <div className="home-genres-grid">
          {GENRE_CLUSTERS.map((genre) => {
            const count = genreCounts.get(genre.id) ?? 0;
            const previewTracks = genreTracksMap.get(genre.id) ?? [];
            return (
              <div key={genre.id} className="home-genre-card-wrap">
                <button
                  type="button"
                  className="home-genre-card-btn"
                  onClick={() => onViewGenre(genre)}
                  aria-label={`View ${genre.name} genre`}
                >
                  <div className="home-genre-header">
                    <span className="home-genre-name">{genre.name}</span>
                    <span className="home-genre-pill">{count} tracks</span>
                  </div>
                  <p className="home-genre-desc">{genre.desc}</p>
                  <div className="home-genre-artworks" aria-hidden="true">
                    {previewTracks.map((t) => (
                      <div key={t.id} className="home-genre-art-item">
                        <Artwork track={t} size="small" />
                      </div>
                    ))}
                  </div>
                </button>
                <button
                  type="button"
                  className="home-genre-play-btn"
                  onClick={() => onPlayGenre(genre)}
                  aria-label={`Play ${genre.name}`}
                >
                  <Play size={16} fill="currentColor" />
                </button>
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}
