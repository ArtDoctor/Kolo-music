#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
CHECK_DESKTOP=false

usage() {
  cat <<'EOF'
Usage: ./check.sh [--desktop]

Builds and type-checks the frontend. Pass --desktop to also check Rust format
and compile the Tauri crate.
EOF
}

case "${1:-}" in
  "") ;;
  --desktop) CHECK_DESKTOP=true ;;
  -h|--help) usage; exit 0 ;;
  *) printf 'Unknown option: %s\n\n' "$1" >&2; usage >&2; exit 2 ;;
esac

cd "${SCRIPT_DIR}"
if [[ ! -d node_modules ]]; then
  npm ci
fi

printf 'Checking frontend formatting...\n'
npm run format:check

printf '\nBuilding frontend...\n'
npm run build

if [[ "${CHECK_DESKTOP}" == true ]]; then
  if ! command -v cargo >/dev/null 2>&1; then
    printf 'Error: Cargo is required for --desktop.\n' >&2
    exit 1
  fi
  printf '\nChecking Rust formatting...\n'
  cargo fmt --manifest-path src-tauri/Cargo.toml -- --check
  printf 'Checking Tauri crate...\n'
  cargo check --manifest-path src-tauri/Cargo.toml
fi

printf '\nPlayer checks passed.\n'
