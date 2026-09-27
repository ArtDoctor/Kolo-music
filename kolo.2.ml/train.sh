#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"

PYTHON="${ROOT_DIR}/.venv/bin/python"
if [ ! -f "${PYTHON}" ]; then
  PYTHON="python3"
fi

cd "${ROOT_DIR}"

echo "==> [1/2] Training preference classifier benchmark with MLflow tracking..."
"${PYTHON}" "${SCRIPT_DIR}/train_classifier.py"

echo "==> [2/2] Training star-rating model ensemble with MLflow tracking..."
"${PYTHON}" "${SCRIPT_DIR}/train_rating_model.py"

echo "==> ML training complete. Check reports in kolo.2.ml/docs/ and tracking in mlruns/."
