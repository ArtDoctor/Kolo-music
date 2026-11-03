import { Shuffle, Star, X } from "lucide-react";
import type { RatingFilterType } from "../appConfig";

interface TrackFiltersProps {
  value: RatingFilterType;
  // Songs each chip would show, given the current search and artist.
  counts: Record<RatingFilterType, number>;
  onChange: (value: RatingFilterType) => void;
}

const ratingFilters: Array<{
  value: RatingFilterType;
  label: string;
  star?: boolean;
}> = [
  { value: "5", label: "5 stars", star: true },
  { value: "4.5", label: "4.5+", star: true },
  { value: "4", label: "4+", star: true },
  { value: "3.5", label: "3.5+", star: true },
  { value: "rated", label: "Rated" },
  { value: "unrated", label: "Non-rated" },
];

export function TrackFilters({ value, counts, onChange }: TrackFiltersProps) {
  function toggle(filter: RatingFilterType) {
    onChange(value === filter ? "all" : filter);
  }

  return (
    <div className="filter-sort-bar">
      <div className="filter-chips" role="group" aria-label="Filter by rating">
        <button
          className={`filter-chip ${value === "all" ? "active" : ""}`}
          onClick={() => onChange("all")}
          aria-pressed={value === "all"}
        >
          All <span className="filter-count">{counts.all}</span>
        </button>
        {ratingFilters.map((filter) => (
          <button
            key={filter.value}
            className={`filter-chip ${value === filter.value ? "active" : ""} ${counts[filter.value] ? "" : "empty"}`}
            onClick={() => toggle(filter.value)}
            aria-pressed={value === filter.value}
          >
            {filter.star && <Star size={13} fill="currentColor" />}
            {filter.label}{" "}
            <span className="filter-count">{counts[filter.value]}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

interface ArtistBannerProps {
  artist: string;
  trackCount: number;
  onPlay: () => void;
  onClear: () => void;
}

export function ArtistBanner({
  artist,
  trackCount,
  onPlay,
  onClear,
}: ArtistBannerProps) {
  return (
    <div className="artist-active-banner">
      <span>
        Showing songs featuring: <strong>{artist}</strong>
        <span className="filter-count">{trackCount}</span>
      </span>
      <div className="artist-active-actions">
        <button type="button" onClick={onPlay}>
          <Shuffle size={14} /> Shuffle artist
        </button>
        <button type="button" onClick={onClear}>
          <X size={14} /> Clear
        </button>
      </div>
    </div>
  );
}
