import { Shuffle, Star, X } from "lucide-react";
import type { RatingFilterType } from "../appConfig";

interface TrackFiltersProps {
  value: RatingFilterType;
  totalTracks: number;
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

export function TrackFilters({
  value,
  totalTracks,
  onChange,
}: TrackFiltersProps) {
  function toggle(filter: RatingFilterType) {
    onChange(value === filter ? "all" : filter);
  }

  return (
    <div className="filter-sort-bar">
      <div className="filter-chips">
        <button
          className={`filter-chip ${value === "all" ? "active" : ""}`}
          onClick={() => onChange("all")}
        >
          All ({totalTracks})
        </button>
        {ratingFilters.map((filter) => (
          <button
            key={filter.value}
            className={`filter-chip ${value === filter.value ? "active" : ""}`}
            onClick={() => toggle(filter.value)}
          >
            {filter.star && <Star size={13} fill="currentColor" />}{" "}
            {filter.label}
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
        Showing songs featuring: <strong>{artist}</strong> ({trackCount})
      </span>
      <div style={{ display: "flex", gap: "10px", alignItems: "center" }}>
        <button type="button" onClick={onPlay}>
          <Shuffle size={14} /> Play Artist
        </button>
        <button type="button" onClick={onClear}>
          <X size={14} /> Clear
        </button>
      </div>
    </div>
  );
}
