#!/usr/bin/env sh
set -eu

PROJECT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
cd "$PROJECT_DIR"

PYTHON_BIN="${PYTHON_BIN:-.venv/bin/python}"
APP_MODULE="${ADBCC_APP_MODULE:-app.main:app}"
HOST="${ADBCC_HOST:-0.0.0.0}"
PORT="${ADBCC_PORT:-8001}"

if [ ! -x "$PYTHON_BIN" ]; then
  echo "Python executable not found: $PYTHON_BIN" >&2
  echo "Create the virtual environment first:" >&2
  echo "  uv venv .venv --python 3.11" >&2
  echo "  uv pip install -r requirements.txt --python .venv/bin/python" >&2
  exit 1
fi

echo "Starting ADB Charge Control on ${HOST}:${PORT}"
exec "$PYTHON_BIN" -m uvicorn "$APP_MODULE" --host "$HOST" --port "$PORT" "$@"
