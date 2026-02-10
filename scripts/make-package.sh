#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
PREBUILT=false

while [[ $# -gt 0 ]]; do
  case "$1" in
    --prebuilt) PREBUILT=true; shift ;;
    --outdir) OUT_DIR="$2"; shift 2 ;;
    *) echo "Unknown option: $1"; exit 1 ;;
  esac
done

OUT_DIR="${OUT_DIR:-$ROOT/_package}"
PKG_ROOT="$OUT_DIR/Synapse"

rm -rf "$PKG_ROOT"
mkdir -p "$PKG_ROOT"

# Build frontend if prebuilt mode
if $PREBUILT; then
  echo "Building frontend..."
  (cd "$ROOT" && npm run build)
fi

# Common items
COMMON=(
  package.json
  tsconfig.server.json
  hooks
  .claude
  start-server.ps1
  start-server.sh
  .env.example
  .nvmrc
)

# Mode-specific items
if $PREBUILT; then
  EXTRAS=(dist)
else
  EXTRAS=(
    vite.config.ts
    tsconfig.json
    index.html
    src
    start-client.ps1
    start-client.sh
  )
fi

# Copy common + mode-specific items
for item in "${COMMON[@]}" "${EXTRAS[@]}"; do
  src="$ROOT/$item"
  if [ -e "$src" ]; then
    dest="$PKG_ROOT/$item"
    dest_dir="$(dirname "$dest")"
    mkdir -p "$dest_dir"
    cp -r "$src" "$dest"
  fi
done

# Copy server/ excluding DB files
mkdir -p "$PKG_ROOT/server"
rsync -a --exclude='*.db' --exclude='*.db-wal' --exclude='*.db-shm' \
  "$ROOT/server/" "$PKG_ROOT/server/"

# Copy docs
mkdir -p "$PKG_ROOT/docs"
for doc in DEPLOYMENT.md PACKAGE.md; do
  [ -f "$ROOT/docs/$doc" ] && cp "$ROOT/docs/$doc" "$PKG_ROOT/docs/"
done

# Copy simulation script
mkdir -p "$PKG_ROOT/scripts"
[ -f "$ROOT/scripts/simulate_session.ts" ] && cp "$ROOT/scripts/simulate_session.ts" "$PKG_ROOT/scripts/"

# Remove junk
rm -rf "$PKG_ROOT/node_modules" "$PKG_ROOT/hook_debug.log"

echo "Package created at: $PKG_ROOT"

# Zip
DIST_DIR="$ROOT/distribution"
mkdir -p "$DIST_DIR"
ZIP_PATH="$DIST_DIR/Synapse.zip"
rm -f "$ZIP_PATH"
(cd "$OUT_DIR" && zip -r "$ZIP_PATH" Synapse)
echo "Zip created at: $ZIP_PATH"
