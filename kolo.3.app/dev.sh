#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
MODE="web"

usage() {
  cat <<'EOF'
Usage: ./dev.sh [--web|--desktop]

  --web       Start the Vite development server (default)
  --desktop   Start Kolo in the Tauri desktop shell
  -h, --help  Show this help
EOF
}

case "${1:-}" in
  ""|--web) MODE="web" ;;
  --desktop) MODE="desktop" ;;
  -h|--help) usage; exit 0 ;;
  *) printf 'Unknown option: %s\n\n' "$1" >&2; usage >&2; exit 2 ;;
esac

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
  printf 'Starting Kolo desktop app...\n'
  exec npm run tauri dev
fi

printf 'Starting Kolo web app...\n'
exec npm run dev
