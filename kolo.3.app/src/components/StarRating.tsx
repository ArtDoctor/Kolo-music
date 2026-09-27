import { Star } from "lucide-react";
import { useState, type MouseEvent } from "react";

interface StarRatingProps {
  value: number | null;
  aiValue?: number | null;
  onChange: (rating: number | null) => void;
  compact?: boolean;
}

export function StarRating({
  value,
  aiValue = null,
  onChange,
  compact = false,
}: StarRatingProps) {
  const [preview, setPreview] = useState<number | null>(null);
  const [bouncingIndex, setBouncingIndex] = useState<number | null>(null);
  const shown = preview ?? value ?? 0;
  const aiShown =
    value === null && typeof aiValue === "number"
      ? Math.max(0, Math.min(5, aiValue))
      : 0;

  function candidate(event: MouseEvent<HTMLButtonElement>, index: number) {
    const bounds = event.currentTarget.getBoundingClientRect();
    return index + (event.clientX - bounds.left < bounds.width / 2 ? 0.5 : 1);
  }

  return (
    <div
      className={`star-rating ${compact ? "star-rating--compact" : ""} ${aiShown > 0 ? "has-ai-prediction" : ""}`}
      onMouseLeave={() => setPreview(null)}
      aria-label="Personal rating"
      data-testid="star-rating"
      data-rating={value ?? ""}
      data-ai-rating={aiShown > 0 ? aiShown : ""}
      title={
        aiShown > 0
          ? `AI estimate: ${aiShown.toFixed(1)} stars (gray)`
          : undefined
      }
    >
      {[0, 1, 2, 3, 4].map((index) => {
        const fill = Math.max(0, Math.min(1, shown - index));
        const aiFill = Math.max(0, Math.min(1, aiShown - index));
        const isBouncing = bouncingIndex !== null && index <= bouncingIndex;
        return (
          <button
            key={index}
            type="button"
            className={isBouncing ? "star-bouncing" : ""}
            onAnimationEnd={() => setBouncingIndex(null)}
            onMouseMove={(event) => setPreview(candidate(event, index))}
            onClick={(event) => {
              event.stopPropagation();
              const next = candidate(event, index);
              setBouncingIndex(index);
              onChange(value === next ? null : next);
            }}
            aria-label={`Rate ${index + 1} star${index ? "s" : ""}`}
          >
            <Star className="star-empty" />
            <span
              className="star-ai-fill"
              style={{ clipPath: `inset(0 ${(1 - aiFill) * 100}% 0 0)` }}
              aria-hidden="true"
            >
              <Star />
            </span>
            <span
              className="star-fill"
              style={{ clipPath: `inset(0 ${(1 - fill) * 100}% 0 0)` }}
              aria-hidden="true"
            >
              <Star />
            </span>
          </button>
        );
      })}
    </div>
  );
}
