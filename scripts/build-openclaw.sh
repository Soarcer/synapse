#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
PLUGIN_DIR="$ROOT/openclaw-plugin"
OUT_DIR="$ROOT/distribution/synapse-openclaw"

echo ""
echo "  Building Synapse OpenClaw Plugin"
echo ""

# Step 1: Build frontend (dashboard)
echo "[1/5] Building frontend..."
(cd "$ROOT" && npm run build)

# Step 2: Bundle plugin via esbuild
echo "[2/5] Building plugin bundle..."
(cd "$PLUGIN_DIR" && [ -d node_modules ] || npm install 2>/dev/null && node esbuild.mjs)

# Step 3: Assemble output directory
echo "[3/5] Assembling distribution package..."
rm -rf "$OUT_DIR"
mkdir -p "$OUT_DIR"

# Copy dashboard assets
for item in dist server hooks tsconfig.server.json .env.example; do
  src="$ROOT/$item"
  if [ -e "$src" ]; then
    cp -r "$src" "$OUT_DIR/$item"
  fi
done

# Copy plugin bundle + manifest
mkdir -p "$OUT_DIR/openclaw-plugin"
cp -r "$PLUGIN_DIR/dist" "$OUT_DIR/openclaw-plugin/dist"
cp "$PLUGIN_DIR/package.json" "$OUT_DIR/openclaw-plugin/package.json"

# Remove DB files from server copy
find "$OUT_DIR/server" -name '*.db' -o -name '*.db-wal' -o -name '*.db-shm' | xargs rm -f 2>/dev/null || true

# Create trimmed server package.json
cat > "$OUT_DIR/package.json" <<'EOF'
{
  "name": "synapse-server",
  "version": "0.1.0",
  "type": "module",
  "scripts": { "start": "tsx server/index.ts" },
  "dependencies": {
    "better-sqlite3": "^11.8.0",
    "express": "^5.1.0",
    "express-rate-limit": "^8.2.1",
    "nanoid": "^5.1.0",
    "tsx": "^4.19.0",
    "ws": "^8.18.0"
  }
}
EOF

# Step 4: Install runtime dependencies
echo "[4/5] Installing runtime dependencies..."
(cd "$OUT_DIR" && npm install --production 2>/dev/null)
(cd "$OUT_DIR/openclaw-plugin" && npm install --production 2>/dev/null)

# Step 5: Summary
SIZE=$(du -sh "$OUT_DIR" 2>/dev/null | cut -f1)
echo ""
echo "[5/5] Done!"
echo ""
echo "  Output: $OUT_DIR"
echo "  Size:   $SIZE"
echo ""
echo "  Install:"
echo "    cp -r $OUT_DIR ~/.openclaw/extensions/synapse-monitor"
echo ""
echo "  Then add to ~/.openclaw/openclaw.json:"
echo '    "plugins": { "synapse-monitor": { "port": 4000 } }'
echo ""
