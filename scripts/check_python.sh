#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd -- "${SCRIPT_DIR}/.." && pwd)"
VENV_BIN="${ROOT_DIR}/.venv/bin"

if [[ -x "${VENV_BIN}/flake8" && -x "${VENV_BIN}/mypy" ]]; then
  FLAKE8="${VENV_BIN}/flake8"
  MYPY="${VENV_BIN}/mypy"
else
  FLAKE8="$(command -v flake8 || true)"
  MYPY="$(command -v mypy || true)"
  if [[ -z "${FLAKE8}" || -z "${MYPY}" ]]; then
    printf 'Error: flake8 and mypy are required. Install requirements.txt in .venv.\n' >&2
    exit 1
  fi
fi

cd "${ROOT_DIR}"
TARGETS=("kolo.1.eda" "kolo.2.ml" "kolo_rating_model.py")

printf 'Running flake8...\n'
"${FLAKE8}" "${TARGETS[@]}"

printf 'Running mypy...\n'
"${MYPY}" "${TARGETS[@]}"

printf 'Python checks passed.\n'
