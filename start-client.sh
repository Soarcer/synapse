#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")"

# Load .env if present
if [ -f .env ]; then
  set -a
  source .env
  set +a
fi

PORT="${VITE_DEV_PORT:-5173}"
npx vite --port "$PORT" --strictPort
