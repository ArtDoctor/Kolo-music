#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
MODE="web"
DO_BUILD=true

usage() {
  cat <<'EOF'
Usage: ./start.sh [options]

Starts Kolo in a static snapshot mode with hot-reloading disabled.
This allows you to listen to music and use the app continuously while
the codebase is actively being edited, without interruptions or page reloads.

Options:
  --web         Build and serve the web app snapshot (default)
  --desktop     Build and start the desktop app (Tauri)
  --no-build    Skip rebuilding and serve the existing dist/ snapshot
  -h, --help    Show this help
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --web) MODE="web"; shift ;;
    --desktop) MODE="desktop"; shift ;;
    --no-build) DO_BUILD=false; shift ;;
    -h|--help) usage; exit 0 ;;
    *) printf 'Unknown option: %s\n\n' "$1" >&2; usage >&2; exit 2 ;;
  esac
done

if ! command -v npm >/dev/null 2>&1; then
  printf 'Error: npm is required. Install Node.js 18 or newer first.\n' >&2
  exit 1
fi

cd "$SCRIPT_DIR"

if [[ ! -d node_modules ]]; then
  printf 'Dependencies are not installed; running npm ci...\n'
  npm ci
fi

if [[ "$MODE" == "desktop" ]]; then
  if ! command -v cargo >/dev/null 2>&1; then
    printf 'Error: Cargo is required for desktop mode. Install Rust from https://rustup.rs/.\n' >&2
    exit 1
  fi
  if [[ "$DO_BUILD" == true ]]; then
    printf 'Building Kolo desktop snapshot...\n'
    npm run build
  fi
  printf 'Starting Kolo desktop app (static snapshot, no HMR)...\n'
  exec npm run tauri dev -- --no-watch
fi

if [[ "$DO_BUILD" == true ]] || [[ ! -d dist ]]; then
  printf 'Building Kolo snapshot at current code state...\n'
  npm run build
fi

printf '\nKolo preview: http://127.0.0.1:1420/ (no hot reloading)\n\n'

exec npm run preview
