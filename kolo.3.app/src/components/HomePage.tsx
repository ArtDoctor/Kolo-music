import { Check, Globe, Heart, Shuffle, Sparkles, Star } from "lucide-react";
import { useMemo, type CSSProperties } from "react";
import {
  GENRE_CLUSTERS,
  type GenreCluster,
  type RatingFilterType,
} from "../appConfig";
import type { LibrarySnapshot, Track } from "../types";
import { Artwork } from "./Artwork";

export function HomePage({
  library,
  onPlayRated,
  onViewRated,
  onPlayGenre,
  onViewGenre,
  onSelectPlaylist,
  onOpenVisualization,
  onPlayTrack,
}: {
  library: LibrarySnapshot;
  onPlayRated: (minStars: number) => void;
  onViewRated: (filterKey: RatingFilterType) => void;
  onPlayGenre: (genre: GenreCluster) => void;
  onViewGenre: (genre: GenreCluster) => void;
  onSelectPlaylist: (playlist: { id: string; name?: string }) => void;
  onOpenVisualization: () => void;
  onPlayTrack: (track: Track) => void;
}) {
  const allTracks = library.tracks;
  const fiveStarsCount = useMemo(
    () => allTracks.filter((t) => t.rating === 5).length,
    [allTracks],
  );
  const fourHalfCount = useMemo(
    () => allTracks.filter((t) => (t.rating ?? 0) >= 4.5).length,
    [allTracks],
  );
  const fourStarsCount = useMemo(
    () => allTracks.filter((t) => (t.rating ?? 0) >= 4).length,
    [allTracks],
  );
  const threeHalfCount = useMemo(
    () => allTracks.filter((t) => (t.rating ?? 0) >= 3.5).length,
    [allTracks],
  );
  const ratedCount = useMemo(
    () => allTracks.filter((t) => t.rating !== null && t.rating > 0).length,
    [allTracks],
  );
  const unratedCount = useMemo(
    () =>
      allTracks.filter(
        (t) =>
          t.rating === null &&
          t.playlistId !== "negative" &&
          !t.id.startsWith("neg/"),
      ).length,
    [allTracks],
  );
  const shelfTracks = useMemo(
    () =>
      [...allTracks]
        .sort((a, b) => (b.rating ?? -1) - (a.rating ?? -1))
        .slice(0, 8),
    [allTracks],
  );

  return (
    <div
      className="home-page-content"
      style={{ display: "flex", flexDirection: "column", gap: "28px" }}
    >
      <div className="home-hero">
        <div>
          <span className="page-kicker">Personal Music Manifold</span>
          <h1>Welcome to Kolo</h1>
        </div>
      </div>

      {/* Spotify-like quick picks shelf */}
      <section>
        <div className="section-title">
          <span>QUICK PICKS</span>
        </div>
        <div className="shelf-grid">
          {shelfTracks.map((track) => (
            <button
              key={track.id}
              type="button"
              className="shelf-tile"
              onClick={() => onPlayTrack(track)}
              title={`Play ${track.title}`}
            >
              <Artwork track={track} size="large" />
              <strong>{track.title}</strong>
              <small>{track.artist}</small>
            </button>
          ))}
        </div>
      </section>

      {/* 3D Visualization Hero Card */}
      <section className="explorer-card">
        <div>
          <h3 style={{ margin: 0 }}>3D Latent Space Explorer</h3>
        </div>
        <button className="explorer-btn" onClick={onOpenVisualization}>
          <Globe size={18} /> Open 3D Space
        </button>
      </section>

      {/* Play by Rating */}
      <section>
        <div className="section-title">
          <span>LISTEN BY RATING</span>
        </div>
        <div className="rating-cards-grid">
          <div className="rating-card" onClick={() => onViewRated("5")}>
            <div className="rating-card-header">
              <div className="rating-stars-badge">
                <Star /> 5.0 Stars
              </div>
              <span className="rating-count-pill">{fiveStarsCount} songs</span>
            </div>
            <div
              className="rating-card-actions"
              onClick={(e) => e.stopPropagation()}
            >
              <button className="btn-primary" onClick={() => onPlayRated(5)}>
                <Shuffle size={14} /> Play
              </button>
              <button
                className="btn-secondary"
                onClick={() => onViewRated("5")}
              >
                View
              </button>
            </div>
          </div>

          <div className="rating-card" onClick={() => onViewRated("4.5")}>
            <div className="rating-card-header">
              <div className="rating-stars-badge">
                <Star /> 4.5+ Stars
              </div>
              <span className="rating-count-pill">{fourHalfCount} songs</span>
            </div>
            <div
              className="rating-card-actions"
              onClick={(e) => e.stopPropagation()}
            >
              <button className="btn-primary" onClick={() => onPlayRated(4.5)}>
                <Shuffle size={14} /> Play
              </button>
              <button
                className="btn-secondary"
                onClick={() => onViewRated("4.5")}
              >
                View
              </button>
            </div>
          </div>

          <div className="rating-card" onClick={() => onViewRated("4")}>
            <div className="rating-card-header">
              <div className="rating-stars-badge">
                <Star /> 4.0+ Stars
              </div>
              <span className="rating-count-pill">{fourStarsCount} songs</span>
            </div>
            <div
              className="rating-card-actions"
              onClick={(e) => e.stopPropagation()}
            >
              <button className="btn-primary" onClick={() => onPlayRated(4.0)}>
                <Shuffle size={14} /> Play
              </button>
              <button
                className="btn-secondary"
                onClick={() => onViewRated("4")}
              >
                View
              </button>
            </div>
          </div>

          <div className="rating-card" onClick={() => onViewRated("3.5")}>
            <div className="rating-card-header">
              <div className="rating-stars-badge">
                <Star /> 3.5+ Stars
              </div>
              <span className="rating-count-pill">{threeHalfCount} songs</span>
            </div>
            <div
              className="rating-card-actions"
              onClick={(e) => e.stopPropagation()}
            >
              <button className="btn-primary" onClick={() => onPlayRated(3.5)}>
                <Shuffle size={14} /> Play
              </button>
              <button
                className="btn-secondary"
                onClick={() => onViewRated("3.5")}
              >
                View
              </button>
            </div>
          </div>

          <div className="rating-card" onClick={() => onViewRated("rated")}>
            <div className="rating-card-header">
              <div className="rating-stars-badge">
                <Check size={16} /> All Rated
              </div>
              <span className="rating-count-pill">{ratedCount} songs</span>
            </div>
            <div
              className="rating-card-actions"
              onClick={(e) => e.stopPropagation()}
            >
              <button
                className="btn-secondary"
                style={{ flex: 1 }}
                onClick={() => onViewRated("rated")}
              >
                View Rated
              </button>
            </div>
          </div>

          <div className="rating-card" onClick={() => onViewRated("unrated")}>
            <div className="rating-card-header">
              <div className="rating-stars-badge" style={{ color: "#aaa" }}>
                <Sparkles size={16} /> Non-Rated
              </div>
              <span className="rating-count-pill">{unratedCount} songs</span>
            </div>
            <div
              className="rating-card-actions"
              onClick={(e) => e.stopPropagation()}
            >
              <button
                className="btn-secondary"
                style={{ flex: 1 }}
                onClick={() => onViewRated("unrated")}
              >
                View Non-Rated
              </button>
            </div>
          </div>
        </div>
      </section>

      {/* Play by Genre */}
      <section>
        <div className="section-title">
          <span>PLAY BY GENRE</span>
        </div>
        <div className="genres-grid">
          {GENRE_CLUSTERS.map((genre) => {
            const count = allTracks.filter(
              (t) => t.cluster === genre.id,
            ).length;
            return (
              <div
                key={genre.id}
                className="genre-card"
                style={{ "--genre-color": genre.color } as CSSProperties}
                onClick={() => onViewGenre(genre)}
              >
                <div className="genre-card-header">
                  <strong>{genre.name}</strong>
                  <span>{count} tracks</span>
                </div>
                <p>{genre.desc}</p>
                <div className="genre-preview">
                  {allTracks
                    .filter((t) => t.cluster === genre.id)
                    .slice(0, 4)
                    .map((t) => (
                      <Artwork key={t.id} track={t} size="small" />
                    ))}
                </div>
                <div
                  className="genre-card-actions"
                  onClick={(e) => e.stopPropagation()}
                >
                  <button
                    className="btn-primary"
                    onClick={() => onPlayGenre(genre)}
                  >
                    <Shuffle size={14} /> Play Genre
                  </button>
                  <button
                    className="btn-secondary"
                    onClick={() => onViewGenre(genre)}
                  >
                    View All
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {/* Quick Playlists Access */}
      <section>
        <div className="section-title">
          <span>LIBRARY FOLDERS</span>
          <span>Local storage partitions</span>
        </div>
        <div className="rating-cards-grid">
          <div
            className="rating-card"
            onClick={() => onSelectPlaylist({ id: "pos", name: "Phone music" })}
          >
            <div className="rating-card-header">
              <strong>Phone music</strong>
              <span className="rating-count-pill">
                {library.playlists.find((p) => p.id === "pos")?.count ?? 0}
              </span>
            </div>
            <p style={{ margin: 0, fontSize: "12px", color: "#888" }}>
              Your main mobile collection and primary training positive dataset.
            </p>
            <div
              className="rating-card-actions"
              onClick={(e) => e.stopPropagation()}
            >
              <button
                className="btn-primary"
                onClick={() =>
                  onSelectPlaylist({ id: "pos", name: "Phone music" })
                }
              >
                Open Folder
              </button>
            </div>
          </div>

          <div
            className="rating-card"
            onClick={() =>
              onSelectPlaylist({ id: "imported", name: "Imports" })
            }
          >
            <div className="rating-card-header">
              <strong>Imports</strong>
              <span className="rating-count-pill">
                {library.playlists.find((p) => p.id === "imported")?.count ?? 0}
              </span>
            </div>
            <p style={{ margin: 0, fontSize: "12px", color: "#888" }}>
              Downloads from YouTube links, Spotify tracks, and drag-and-drop
              files.
            </p>
            <div
              className="rating-card-actions"
              onClick={(e) => e.stopPropagation()}
            >
              <button
                className="btn-primary"
                onClick={() =>
                  onSelectPlaylist({ id: "imported", name: "Imports" })
                }
              >
                Open Imports
              </button>
            </div>
          </div>

          <div
            className="rating-card"
            onClick={() =>
              onSelectPlaylist({ id: "liked", name: "Liked songs" })
            }
          >
            <div className="rating-card-header">
              <strong
                style={{ display: "flex", alignItems: "center", gap: "6px" }}
              >
                <Heart size={15} fill="currentColor" color="var(--accent)" />{" "}
                Liked songs
              </strong>
              <span className="rating-count-pill">
                {library.playlists.find((p) => p.id === "liked")?.count ?? 0}
              </span>
            </div>
            <p style={{ margin: 0, fontSize: "12px", color: "#888" }}>
              All songs marked with a heart across any collection.
            </p>
            <div
              className="rating-card-actions"
              onClick={(e) => e.stopPropagation()}
            >
              <button
                className="btn-primary"
                onClick={() =>
                  onSelectPlaylist({ id: "liked", name: "Liked songs" })
                }
              >
                Open Liked
              </button>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
