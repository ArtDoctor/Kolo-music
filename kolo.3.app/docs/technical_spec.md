# Player implementation

## Components

```text
React UI and HTMLAudioElement
        │
        ├── browser build: Vite local-library middleware
        │       ├── scans kolo.0.data
        │       ├── serves audio with HTTP byte ranges
        │       └── launches Python/yt-dlp helpers for imports
        │
        └── desktop build: Tauri commands in Rust
                ├── scans and updates kolo.0.data
                ├── exposes local files through Tauri asset URLs
                └── launches Python/yt-dlp helpers for imports
```

The two backends return the same `LibrarySnapshot` shape to `src/library.ts`. React code chooses the backend with Tauri's `isTauri()` check.

## Frontend

`src/App.tsx` coordinates navigation, filtering, and imports. View components live under `src/components` (`Navigation`, `TrackList`, `TrackToolbar`, `PlayerBar`, `QueuePanel`, `HomePage`, `SettingsPage`, `ImportControls`); `usePlayer` owns playback and queue state, `useLibrary` owns library loading and optimistic rating/like updates, `useImports` owns link/YouTube/Spotify/file imports, and `useLocalStorage` handles persisted settings. `src/library.ts` is the backend adapter, while `src/types.ts` defines the shared frontend data shapes.

Audio is played by an `HTMLAudioElement`. The source is either a Vite middleware URL (`/@kolo-data/<track-id>`) or a Tauri asset URL produced by `convertFileSrc`. Browser byte-range support allows seeking without reading an entire file into memory.

## Browser backend

`viteLibraryPlugin.ts` installs Connect middleware in both the Vite development and preview servers. It provides endpoints for:

- library scans;
- rating and like updates;
- playlist creation;
- local uploads;
- YouTube and Spotify imports;
- Spotify import progress;
- audio, artwork, and generated visualization files.

Writes use a temporary file followed by rename. Served paths are resolved under the configured data root to reject directory traversal.

## Tauri backend

`src-tauri/src/lib.rs` implements equivalent commands for scanning, ratings, likes, playlist creation, file copies, and imports. JSON state is written atomically on Unix. On Windows, the implementation writes the destination directly because replacing an existing file has different semantics.

The Tauri layer is intentionally small: playback remains in the webview, and model inference remains in the offline Python tools.

## External helpers

YouTube imports launch `yt-dlp` and normalize downloaded audio with FFmpeg. Spotify imports launch `kolo.2.ml/download_playlist_latest.py`, which obtains track metadata and searches for matching audio. The following environment variables are supported for development and tests:

| Variable | Purpose |
| --- | --- |
| `KOLO_DATA_DIR` | Override the default `kolo.0.data` directory |
| `KOLO_PYTHON` | Override the Python executable used by the import helper |
| `KOLO_YT_DLP` | Override the yt-dlp executable |
| `PORT` | Override the Vite development-server port |
| `TAURI_DEV_HOST` | Configure a Tauri development host and HMR |

Defaults work with the repository layout; none of these variables is required for a normal local run.

## State and generated files

Ratings, likes, playlist display names, model predictions, clusters, loudness values, and artwork are stored in `.kolo`. The model is trained offline; the app only reads exported predictions. This keeps model dependencies out of the frontend and Tauri binary.

## Tests

Playwright starts Vite with `KOLO_DATA_DIR` pointed at `.playwright-data`. Integration tests cover the local HTTP API and byte ranges. End-to-end tests cover library navigation, playback controls, ratings, likes, filters, playlist creation, imports, and persisted settings.
