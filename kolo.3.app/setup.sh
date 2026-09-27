#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"

command_required() {
  if ! command -v "$1" >/dev/null 2>&1; then
    printf 'Error: %s is required but was not found in PATH.\n' "$1" >&2
    exit 1
  fi
}

command_required node
command_required npm

node_major="$(node --version | sed -E 's/^v([0-9]+).*/\1/')"
if (( node_major < 18 )); then
  printf 'Error: Node.js 18 or newer is required (found %s).\n' "$(node --version)" >&2
  exit 1
fi

printf 'Setting up Kolo in %s\n' "$SCRIPT_DIR"
cd "$SCRIPT_DIR"
npm ci

printf '\nFrontend dependencies installed successfully.\n'

if [[ "${OSTYPE:-}" == linux* ]]; then
  missing=()
  if command -v pkg-config >/dev/null 2>&1; then
    for package in dbus-1 glib-2.0 gtk+-3.0 webkit2gtk-4.1; do
      pkg-config --exists "$package" || missing+=("$package")
    done
  else
    missing+=("pkg-config")
  fi

  if (( ${#missing[@]} > 0 )); then
    printf '\nNote: Tauri desktop development is missing Linux system packages: %s\n' "${missing[*]}"
    printf 'On Debian/Ubuntu, install the Tauri prerequisites with:\n'
    printf '  sudo apt update && sudo apt install libdbus-1-dev libwebkit2gtk-4.1-dev build-essential curl wget file libxdo-dev libssl-dev libayatana-appindicator3-dev librsvg2-dev\n'
    printf 'The web app can still be run with ./dev.sh.\n'
  fi
fi

printf '\nSetup complete. Start Kolo with:\n'
printf '  ./dev.sh             # web\n'
printf '  ./dev.sh --desktop   # Tauri\n'
