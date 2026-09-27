#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
SUITE="${1:-all}"

usage() {
  cat <<'EOF'
Usage: ./test.sh [all|integration|e2e|headed|install]

  all          Run every Playwright test (default)
  integration  Run local-library API integration tests
  e2e          Run browser end-to-end tests
  headed       Run all tests in a visible browser
  install      Install the Playwright Chromium browser
EOF
}

cd "$SCRIPT_DIR"
if [[ ! -d node_modules ]]; then
  npm ci
fi

case "$SUITE" in
  all) exec npm test ;;
  integration) exec npm run test:integration ;;
  e2e) exec npm run test:e2e ;;
  headed) exec npm run test:headed ;;
  install) exec npx playwright install chromium ;;
  -h|--help) usage ;;
  *) printf 'Unknown suite: %s\n\n' "$SUITE" >&2; usage >&2; exit 2 ;;
esac
