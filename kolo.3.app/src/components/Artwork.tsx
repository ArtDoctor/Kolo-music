import { useEffect, useState } from "react";
import type { Track } from "../types";

export function Artwork({
  track,
  size = "medium",
}: {
  track: Track;
  size?: "small" | "medium" | "large";
}) {
  const [imageFailed, setImageFailed] = useState(false);

  useEffect(() => setImageFailed(false), [track.artworkUrl]);

  return (
    <div
      className={`artwork artwork--${size}`}
      style={{ background: track.artwork }}
    >
      {track.artworkUrl && !imageFailed ? (
        <img
          src={track.artworkUrl}
          alt=""
          className="artwork-img"
          onError={() => setImageFailed(true)}
          loading="lazy"
        />
      ) : (
        <span>{track.title.slice(0, 1).toUpperCase()}</span>
      )}
    </div>
  );
}
