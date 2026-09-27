#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd -- "${SCRIPT_DIR}/.." && pwd)"

printf 'Checking Python code...\n'
"${SCRIPT_DIR}/check_python.sh"

printf '\nChecking the player...\n'
cd "${ROOT_DIR}/kolo.3.app"
./check.sh "$@"

printf '\nAll checks passed.\n'
