import { X } from "lucide-react";
import { Fragment, useEffect, useRef, useState } from "react";
import type { Track } from "../types";
import { Artwork } from "./Artwork";

export function QueuePanel({
  tracks,
  name,
  currentId,
  onPlay,
  onClose,
}: {
  tracks: Track[];
  name: string;
  currentId: string | null;
  onPlay: (track: Track) => void;
  onClose: () => void;
}) {
  const [visibleCount, setVisibleCount] = useState(60);
  const sentinel = useRef<HTMLDivElement>(null);
  const playingIndex = tracks.findIndex((track) => track.id === currentId);
  const currentIndex = Math.max(0, playingIndex);
  // The song playing may not be in this queue; then every row is upcoming.
  const upNextFrom = playingIndex === -1 ? 0 : 1;
  const ordered = [
    ...tracks.slice(currentIndex),
    ...tracks.slice(0, currentIndex),
  ];

  useEffect(() => {
    const target = sentinel.current;
    if (!target || visibleCount >= ordered.length) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting)
          setVisibleCount((count) => Math.min(count + 80, ordered.length));
      },
      { rootMargin: "400px 0px" },
    );
    observer.observe(target);
    return () => observer.disconnect();
  }, [visibleCount, ordered.length]);

  return (
    <aside className="queue-panel queue-enter">
      <header>
        <div>
          <span>Playing from {name}</span>
          <h2>Play queue</h2>
        </div>
        <button onClick={onClose} aria-label="Close queue">
          <X />
        </button>
      </header>
      <div className="queue-list">
        {ordered.slice(0, visibleCount).map((track, index) => (
          <Fragment key={track.id}>
            {index === 0 && upNextFrom === 1 && (
              <h3 className="queue-section">Now playing</h3>
            )}
            {index === upNextFrom && (
              <h3 className="queue-section">
                Next up <small>{ordered.length - upNextFrom}</small>
              </h3>
            )}
            <button
              className={track.id === currentId ? "active" : ""}
              onClick={() => onPlay(track)}
            >
              <span>{index < upNextFrom ? "" : index + 1 - upNextFrom}</span>
              <Artwork track={track} size="small" />
              <span>
                <strong>{track.title}</strong>
                <small>{track.artist}</small>
              </span>
            </button>
          </Fragment>
        ))}
        {visibleCount < ordered.length && (
          <div ref={sentinel} className="list-sentinel" aria-hidden="true" />
        )}
      </div>
    </aside>
  );
}
