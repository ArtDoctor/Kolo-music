import { Download, ExternalLink, Upload } from "lucide-react";
import type { ClipboardEvent, ReactNode } from "react";
import { isSpotifyLink, parseDownloadLinks } from "../library";

const DISCOVER_WEEKLY_URL =
  "https://open.spotify.com/playlist/37i9dQZEVXcOour5t7D6qU";

interface ImportControlsProps {
  selectedPlaylist: string;
  linkOpen: boolean;
  linkInput: string;
  // The running and finished downloads, shown under the link box.
  downloads?: ReactNode;
  onLinkInput: (value: string) => void;
  onOpenLink: () => void;
  onDownload: () => void;
  onImportLocal: () => void;
}

export function ImportControls({
  selectedPlaylist,
  linkOpen,
  linkInput,
  downloads,
  onLinkInput,
  onOpenLink,
  onDownload,
  onImportLocal,
}: ImportControlsProps) {
  const links = parseDownloadLinks(linkInput);
  const spotifyOnly = links.length === 1 && isSpotifyLink(links[0]);

  function submitInput() {
    if (links.length) onDownload();
    else onOpenLink();
  }

  // A text field drops line breaks, which would glue a pasted list of links
  // into one unusable string.
  function pasteLinks(event: ClipboardEvent<HTMLInputElement>) {
    const text = event.clipboardData.getData("text");
    if (!/[\r\n]/.test(text)) return;
    event.preventDefault();
    onLinkInput(`${linkInput} ${text}`.split(/\s+/).filter(Boolean).join(" "));
  }

  function downloadLabel(youtubeLabel: string) {
    if (links.length > 1) return `Download ${links.length} links`;
    return spotifyOnly ? "Download from Spotify" : youtubeLabel;
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
            onPaste={pasteLinks}
            placeholder="Paste YouTube or Spotify links, or a song name..."
            aria-label="Import URL or search"
            onKeyDown={(event) => {
              if (event.key === "Enter") submitInput();
            }}
          />
          <button
            className="btn-primary"
            disabled={!links.length}
            onClick={onDownload}
          >
            <Download size={16} />
            {downloadLabel("Download YouTube Audio")}
          </button>
        </div>
        <small className="imports-hero-hint">
          Paste several links at once. Downloads keep running while you browse.
        </small>
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
        {downloads}
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
          onPaste={pasteLinks}
          placeholder="YouTube/Spotify links or song to search"
          aria-label="Music link or search"
          onKeyDown={(event) => {
            if (event.key === "Enter") submitInput();
          }}
        />
        <button onClick={onOpenLink}>
          <ExternalLink size={16} /> Open / search
        </button>
        <button
          disabled={!links.length}
          onClick={onDownload}
          title={
            spotifyOnly
              ? "Download all songs from this Spotify playlist or album into Kolo"
              : "Paste HTTPS YouTube or Spotify links to download"
          }
          className={spotifyOnly ? "spotify-download-button" : undefined}
        >
          <Download size={16} />
          {downloadLabel("Download YouTube")}
        </button>
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
      {downloads}
    </div>
  );
}
