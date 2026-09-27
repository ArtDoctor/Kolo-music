import {
  Heart,
  ListMusic,
  Pause,
  Play,
  Repeat,
  Repeat1,
  Shuffle,
  SkipBack,
  SkipForward,
  Volume2,
  VolumeX,
  Youtube,
} from "lucide-react";
import {
  useMemo,
  useState,
  type CSSProperties,
  type PointerEvent,
} from "react";
import { formatTime, splitArtists } from "../appConfig";
import { getTrackSearchQuery } from "../library";
import type { RepeatMode, Track } from "../types";
import { Artwork } from "./Artwork";
import { StarRating } from "./StarRating";

export function PlayerBar({
  track,
  isPlaying,
  progress,
  duration,
  volume,
  shuffle,
  repeatMode,
  onPlay,
  onPrevious,
  onNext,
  onSeek,
  onVolume,
  onMute,
  onShuffle,
  onRepeat,
  onQueue,
  onRate,
  onLike,
  onSelectArtist,
  onSearchYouTube,
}: {
  track: Track;
  isPlaying: boolean;
  progress: number;
  duration: number;
  volume: number;
  shuffle: boolean;
  repeatMode: RepeatMode;
  onPlay: () => void;
  onPrevious: () => void;
  onNext: () => void;
  onSeek: (value: number) => void;
  onVolume: (value: number) => void;
  onMute: () => void;
  onShuffle: () => void;
  onRepeat: () => void;
  onQueue: () => void;
  onRate: (rating: number | null) => void;
  onLike: () => void;
  onSelectArtist: (artist: string) => void;
  onSearchYouTube: (track: Track) => void;
}) {
  const RepeatIcon = repeatMode === "one" ? Repeat1 : Repeat;
  const artists = useMemo(() => splitArtists(track.artist), [track.artist]);
  const searchQuery = useMemo(
    () => getTrackSearchQuery(track),
    [track.title, track.artist],
  );
  const [isScrubbing, setIsScrubbing] = useState(false);
  const [scrubValue, setScrubValue] = useState(0);

  const displayProgress = isScrubbing ? scrubValue : progress;

  const handlePointerDown = (event: PointerEvent<HTMLInputElement>) => {
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      // ignore
    }
    setIsScrubbing(true);
    setScrubValue(Number(event.currentTarget.value));
  };

  const handlePointerUp = (event: PointerEvent<HTMLInputElement>) => {
    try {
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
    } catch {
      // ignore
    }
    setIsScrubbing(false);
    onSeek(Number(event.currentTarget.value));
  };

  const handlePointerCancel = (event: PointerEvent<HTMLInputElement>) => {
    try {
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
    } catch {
      // ignore
    }
    setIsScrubbing(false);
  };

  return (
    <footer className="player-bar">
      <div className="now-playing">
        <Artwork track={track} size="medium" />
        <div>
          <div className="track-title-heading">
            <strong>{track.title}</strong>
            <button
              type="button"
              className="youtube-search-btn"
              onClick={(e) => {
                e.stopPropagation();
                onSearchYouTube(track);
              }}
              title={`Search "${searchQuery}" on YouTube`}
              aria-label="Search on YouTube"
              data-testid="youtube-search-btn"
            >
              <Youtube size={14} />
            </button>
          </div>
          <span onClick={(e) => e.stopPropagation()}>
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
          </span>
        </div>
        <button
          className={`heart-button ${track.liked ? "liked" : ""}`}
          onClick={onLike}
          aria-label={track.liked ? "Unlike current song" : "Like current song"}
        >
          <Heart fill={track.liked ? "currentColor" : "none"} />
        </button>
        <StarRating
          value={track.rating}
          aiValue={track.aiRating}
          onChange={onRate}
        />
      </div>
      <div className="transport">
        <div className="transport-buttons">
          <button
            className={shuffle ? "enabled" : ""}
            onClick={onShuffle}
            aria-label="Shuffle"
          >
            <Shuffle />
          </button>
          <button onClick={onPrevious} aria-label="Previous song">
            <SkipBack fill="currentColor" />
          </button>
          <button
            className="play-button"
            onClick={onPlay}
            aria-label={isPlaying ? "Pause" : "Play"}
          >
            {isPlaying ? (
              <Pause fill="currentColor" />
            ) : (
              <Play fill="currentColor" />
            )}
          </button>
          <button onClick={onNext} aria-label="Next song">
            <SkipForward fill="currentColor" />
          </button>
          <button
            className={repeatMode !== "off" ? "enabled" : ""}
            onClick={onRepeat}
            aria-label={`Repeat ${repeatMode}`}
          >
            <RepeatIcon />
          </button>
        </div>
        <div className="progress-row">
          <span>{formatTime(displayProgress)}</span>
          <input
            className="range"
            aria-label="Song progress"
            type="range"
            min="0"
            max={Math.max(duration, 1)}
            step=".1"
            value={Math.min(displayProgress, duration || 0)}
            onPointerDown={handlePointerDown}
            onPointerUp={handlePointerUp}
            onPointerCancel={handlePointerCancel}
            onChange={(event) => {
              const val = Number(event.target.value);
              if (isScrubbing) {
                setScrubValue(val);
              } else {
                onSeek(val);
              }
            }}
            style={
              {
                "--range-progress": `${duration ? (displayProgress / duration) * 100 : 0}%`,
              } as CSSProperties
            }
          />
          <span>{formatTime(duration)}</span>
        </div>
      </div>
      <div
        className="player-tools"
        onWheel={(event) => {
          event.preventDefault();
          onVolume(volume + (event.deltaY < 0 ? 0.03 : -0.03));
        }}
      >
        <button onClick={onQueue} aria-label="Open queue">
          <ListMusic />
        </button>
        <button onClick={onMute} aria-label={volume ? "Mute" : "Unmute"}>
          {volume ? <Volume2 /> : <VolumeX />}
        </button>
        <input
          className="range volume-range"
          aria-label="Volume"
          type="range"
          min="0"
          max="1"
          step=".01"
          value={volume}
          onChange={(event) => onVolume(Number(event.target.value))}
          style={{ "--range-progress": `${volume * 100}%` } as CSSProperties}
        />
      </div>
    </footer>
  );
}
