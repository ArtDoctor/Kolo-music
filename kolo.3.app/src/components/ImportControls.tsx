import { Download, ExternalLink, Upload } from "lucide-react";
import {
  isSpotifyLink,
  isYouTubeLink,
  type SpotifyDownloadStatus,
} from "../library";

const DISCOVER_WEEKLY_URL =
  "https://open.spotify.com/playlist/37i9dQZEVXcOour5t7D6qU";

interface ImportControlsProps {
  selectedPlaylist: string;
  linkOpen: boolean;
  linkInput: string;
  downloading: boolean;
  spotifyStatus: SpotifyDownloadStatus | null;
  onLinkInput: (value: string) => void;
  onOpenLink: () => void;
  onSpotifyDownload: () => void;
  onYouTubeDownload: () => void;
  onImportLocal: () => void;
}

function SpotifyProgress({ status }: { status: SpotifyDownloadStatus }) {
  return (
    <div className="spotify-progress-card">
      <div className="spotify-progress-header">
        <strong>{status.playlistName || "Spotify Playlist"}</strong>
        <span>
          {status.downloaded ?? 0} of {status.total ?? 0} (
          {Math.round(status.percent ?? 0)}%)
        </span>
      </div>
      <div className="spotify-progress-track">
        <div
          className="spotify-progress-fill"
          style={{ width: `${Math.max(status.percent ?? 0, 5)}%` }}
        />
      </div>
      <small className="spotify-progress-song">
        {status.currentTrack || "Preparing download..."}
      </small>
    </div>
  );
}

export function ImportControls({
  selectedPlaylist,
  linkOpen,
  linkInput,
  downloading,
  spotifyStatus,
  onLinkInput,
  onOpenLink,
  onSpotifyDownload,
  onYouTubeDownload,
  onImportLocal,
}: ImportControlsProps) {
  const spotifyLink = isSpotifyLink(linkInput);
  const youtubeLink = isYouTubeLink(linkInput);

  function submitInput() {
    if (spotifyLink) onSpotifyDownload();
    else if (youtubeLink) onYouTubeDownload();
    else onOpenLink();
  }

  if (selectedPlaylist === "imported") {
    return (
      <div className="imports-hero">
        <div className="imports-hero-title">
          <Download />
          <span>Import Audio from YouTube, Spotify, or Local Files</span>
        </div>
        <div className="imports-hero-input-row">
          <input
            className="imports-hero-input"
            value={linkInput}
            onChange={(event) => onLinkInput(event.target.value)}
            placeholder="Paste a YouTube video URL, Spotify link, or song name..."
            aria-label="Import URL or search"
            onKeyDown={(event) => {
              if (event.key === "Enter") submitInput();
            }}
          />
          {spotifyLink ? (
            <button
              className="btn-primary"
              disabled={downloading}
              onClick={onSpotifyDownload}
            >
              <Download size={16} />
              {downloading ? "Importing Spotify…" : "Download from Spotify"}
            </button>
          ) : (
            <button
              className="btn-primary"
              disabled={downloading || !youtubeLink}
              onClick={onYouTubeDownload}
            >
              <Download size={16} />
              {downloading ? "Downloading…" : "Download YouTube Audio"}
            </button>
          )}
        </div>
        <div className="imports-hero-actions">
          <button className="btn-secondary" onClick={onImportLocal}>
            <Upload size={16} /> Choose Local Audio Files
          </button>
          <button
            className="btn-secondary"
            onClick={() => onLinkInput(DISCOVER_WEEKLY_URL)}
          >
            Load Discover Weekly URL
          </button>
        </div>
        {spotifyStatus?.active && <SpotifyProgress status={spotifyStatus} />}
      </div>
    );
  }

  if (!linkOpen) return null;

  return (
    <div className="link-panel-box">
      <div className="link-panel">
        <input
          value={linkInput}
          onChange={(event) => onLinkInput(event.target.value)}
          placeholder="YouTube/Spotify link or song to search"
          aria-label="Music link or search"
          onKeyDown={(event) => {
            if (event.key === "Enter") submitInput();
          }}
        />
        <button onClick={onOpenLink}>
          <ExternalLink size={16} /> Open / search
        </button>
        {spotifyLink ? (
          <button
            disabled={downloading}
            onClick={onSpotifyDownload}
            title="Download all songs from this Spotify playlist or album into Kolo"
            className="spotify-download-button"
          >
            <Download size={16} />
            {downloading ? "Importing Spotify…" : "Download from Spotify"}
          </button>
        ) : (
          <button
            disabled={downloading || !youtubeLink}
            onClick={onYouTubeDownload}
            title="Paste an HTTPS YouTube video link to download"
          >
            <Download size={16} />
            {downloading ? "Downloading…" : "Download YouTube"}
          </button>
        )}
      </div>
      <div className="link-suggestions">
        <span>Quick import:</span>
        <button
          type="button"
          onClick={() => onLinkInput(DISCOVER_WEEKLY_URL)}
          title="Load your Discover Weekly URL"
        >
          Discover Weekly
        </button>
      </div>
      {spotifyStatus?.active && <SpotifyProgress status={spotifyStatus} />}
    </div>
  );
}
