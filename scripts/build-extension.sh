#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
EXT_DIR="$ROOT/extension"
RES_DIR="$EXT_DIR/resources/synapse-server"

echo ""
echo "  Building Synapse VS Code Extension"
echo ""

# Step 1: Build frontend
echo "[1/5] Building frontend..."
(cd "$ROOT" && npm run build)

# Step 2: Copy server package into resources
echo "[2/5] Bundling server into extension resources..."
rm -rf "$RES_DIR"
mkdir -p "$RES_DIR"

for item in dist server hooks tsconfig.server.json .env.example; do
  src="$ROOT/$item"
  if [ -e "$src" ]; then
    cp -r "$src" "$RES_DIR/$item"
  fi
done

# Create trimmed package.json
cat > "$RES_DIR/package.json" <<'EOF'
{
  "name": "synapse-server",
  "version": "0.1.0",
  "type": "module",
  "scripts": { "start": "tsx server/index.ts" },
  "dependencies": {
    "@anthropic-ai/claude-agent-sdk": "latest",
    "better-sqlite3": "^11.8.0",
    "express": "^5.1.0",
    "express-rate-limit": "^8.2.1",
    "nanoid": "^5.1.0",
    "tsx": "^4.19.0",
    "ws": "^8.18.0"
  }
}
EOF

# Remove DB files
find "$RES_DIR/server" -name '*.db' -o -name '*.db-wal' -o -name '*.db-shm' | xargs rm -f 2>/dev/null || true

# Step 3: Install server deps
echo "[3/5] Installing server dependencies..."
(cd "$RES_DIR" && npm install --production 2>/dev/null)

# Step 4: Build extension
echo "[4/5] Building extension..."
(cd "$EXT_DIR" && npm install 2>/dev/null && npm run build)

# Step 5: Package .vsix
echo "[5/5] Packaging .vsix..."
(cd "$EXT_DIR" && npx @vscode/vsce package --no-dependencies)

VSIX=$(ls -t "$EXT_DIR"/*.vsix 2>/dev/null | head -1)
if [ -n "$VSIX" ]; then
  DIST_DIR="$ROOT/distribution"
  mkdir -p "$DIST_DIR"
  cp "$VSIX" "$DIST_DIR/"
  echo ""
  echo "  Extension built: $VSIX"
  echo "  Install with: code --install-extension $(basename "$VSIX")"
  echo ""
else
  echo "  WARNING: .vsix file not found!"
fi
