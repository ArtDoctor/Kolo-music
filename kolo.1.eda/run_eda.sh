#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"

PYTHON="${ROOT_DIR}/.venv/bin/python"
if [ ! -f "${PYTHON}" ]; then
  PYTHON="python3"
fi

cd "${ROOT_DIR}"

echo "==> [1/2] Extracting any missing audio embeddings..."
"${PYTHON}" "${SCRIPT_DIR}/extract_all_missing_embeddings.py"

echo "==> [2/2] Generating latent space clusters and visualizations..."
"${PYTHON}" "${SCRIPT_DIR}/regenerate_clusters_and_viz.py"

echo "==> EDA workflow complete. Visualizations updated in kolo.1.eda/res/ and kolo.3.app/public/."
