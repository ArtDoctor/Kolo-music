import { Star } from "lucide-react";
import { useState, type KeyboardEvent, type MouseEvent } from "react";

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

  // The stars share one tab stop; arrow keys step the rating by half a star.
  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const step =
      event.key === "ArrowRight" || event.key === "ArrowUp"
        ? 0.5
        : event.key === "ArrowLeft" || event.key === "ArrowDown"
          ? -0.5
          : 0;
    if (!step) return;
    event.preventDefault();
    event.stopPropagation();
    const next = Math.max(0, Math.min(5, (value ?? 0) + step));
    onChange(next === 0 ? null : next);
    const buttons = event.currentTarget.querySelectorAll("button");
    buttons[Math.max(0, Math.ceil(next) - 1)]?.focus();
  }

  const focusIndex = Math.max(0, Math.ceil(value ?? 0) - 1);

  return (
    <div
      className={`star-rating ${compact ? "star-rating--compact" : ""} ${aiShown > 0 ? "has-ai-prediction" : ""}`}
      onMouseLeave={() => setPreview(null)}
      onKeyDown={onKeyDown}
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
            tabIndex={index === focusIndex ? 0 : -1}
            onAnimationEnd={() => setBouncingIndex(null)}
            onMouseMove={(event) => setPreview(candidate(event, index))}
            onClick={(event) => {
              event.stopPropagation();
              // A keyboard click has no pointer position (detail is 0, which
              // is also true of every mousemove); it rates the whole star.
              const next =
                event.detail === 0 ? index + 1 : candidate(event, index);
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
