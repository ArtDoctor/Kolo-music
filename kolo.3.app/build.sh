#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
MODE="web"

usage() {
  cat <<'EOF'
Usage: ./build.sh [--web|--desktop]

  --web       Type-check and build the frontend into dist/ (default)
  --desktop   Build the Tauri desktop executable
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
  printf 'Error: npm is required.\n' >&2
  exit 1
fi

cd "$SCRIPT_DIR"
if [[ ! -d node_modules ]]; then
  printf 'Dependencies are not installed; running npm ci...\n'
  npm ci
fi

if [[ "$MODE" == "desktop" ]]; then
  if ! command -v cargo >/dev/null 2>&1; then
    printf 'Error: Cargo is required for desktop builds.\n' >&2
    exit 1
  fi
  printf 'Building Kolo desktop executable...\n'
  exec npm run tauri build
fi

printf 'Building Kolo frontend...\n'
npm run build
printf '\nBuild complete: %s/dist\n' "$SCRIPT_DIR"
