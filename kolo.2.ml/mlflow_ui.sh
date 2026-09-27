#!/usr/bin/env bash
# Open the MLflow tracking UI for all Kolo rating experiments (SQLite backend).
# Usage: ./kolo.2.ml/mlflow_ui.sh [port]
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"

PYTHON="${ROOT_DIR}/.venv/bin/python"
if [ ! -f "${PYTHON}" ]; then
  PYTHON="python3"
fi

PORT="${1:-5000}"

cd "${ROOT_DIR}"
echo "==> MLflow UI: http://localhost:${PORT}"
echo "==> Backend: sqlite:///mlruns.db | Artifacts: ./mlartifacts"
echo "==> Experiments: kolo-star-rating, kolo-rating-challengers, kolo-mlp-iterations"
exec "${PYTHON}" -m mlflow ui \
  --backend-store-uri "sqlite:///${ROOT_DIR}/mlruns.db" \
  --artifacts-destination "${ROOT_DIR}/mlartifacts" \
  --host 127.0.0.1 \
  --port "${PORT}"
