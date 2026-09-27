# Kolo player

The player is a React 19 and Vite application with an optional Tauri 2 shell. It reads a local audio library, plays files through the browser audio element, and stores ratings and likes in `kolo.0.data/.kolo`.

## Features

- local playback with seek, volume, shuffle, repeat, and queue controls
- half-star ratings and a separate like flag
- model estimates shown as muted stars when a track has no personal rating
- title, artist, rating, date, duration, and model-score sorting
- rating and model-score filters
- custom playlists and local file import
- YouTube URL download and Spotify metadata import through local helper processes
- optional loudness attenuation from precomputed EBU R128 measurements
- embedded 3D t-SNE/UMAP library visualization
- persisted player and interface settings

The browser and Tauri builds use separate local-library adapters. See [the technical notes](docs/technical_spec.md) for the differences.

## Setup

```bash
./setup.sh
```

Node.js 18 or newer is required. Tauri development also requires Rust and the platform packages listed by the setup script.

## Development

```bash
./dev.sh             # Vite development server
./dev.sh --desktop   # Tauri development build
```

`./start.sh` builds and serves a static preview. It is useful when the player should keep running while source files are edited.

## Checks and tests

```bash
./check.sh            # TypeScript project build
./check.sh --desktop  # frontend build, cargo fmt, and cargo check
./test.sh             # Playwright integration and end-to-end tests
./test.sh headed      # visible Chromium window
```

The Playwright fixture creates a temporary audio library under `.playwright-data`; it does not read the personal library.

## Documentation

- [Feature behavior](docs/app_features.md)
- [Implementation and data flow](docs/technical_spec.md)
- [Design notes](docs/design.md)
