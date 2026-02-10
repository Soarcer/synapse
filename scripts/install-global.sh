#!/usr/bin/env bash
set -euo pipefail

INSTALL_DIR="${1:-$HOME/.synapse}"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

echo ""
echo "  Synapse Installer"
echo "  Installing to: $INSTALL_DIR"
echo ""

# Step 1: Build prebuilt package
echo "[1/4] Building package..."
TEMP_PKG=$(mktemp -d)
bash "$SCRIPT_DIR/make-package.sh" --prebuilt --outdir "$TEMP_PKG"

PKG_SOURCE="$TEMP_PKG/Synapse"

# Step 2: Copy to install dir
echo "[2/4] Copying to $INSTALL_DIR..."
ENV_BACKUP=""
if [ -d "$INSTALL_DIR" ]; then
  # Preserve .env
  if [ -f "$INSTALL_DIR/.env" ]; then
    ENV_BACKUP=$(mktemp)
    cp "$INSTALL_DIR/.env" "$ENV_BACKUP"
  fi
  rm -rf "$INSTALL_DIR"
fi

cp -r "$PKG_SOURCE" "$INSTALL_DIR"

# Restore preserved files
if [ -n "$ENV_BACKUP" ] && [ -f "$ENV_BACKUP" ]; then
  cp "$ENV_BACKUP" "$INSTALL_DIR/.env"
  rm -f "$ENV_BACKUP"
fi

# Step 3: Install dependencies
echo "[3/4] Installing dependencies..."
(cd "$INSTALL_DIR" && npm install --production 2>/dev/null)

# Create .env from example if it doesn't exist
if [ ! -f "$INSTALL_DIR/.env" ] && [ -f "$INSTALL_DIR/.env.example" ]; then
  cp "$INSTALL_DIR/.env.example" "$INSTALL_DIR/.env"
fi

# Step 4: Create CLI shim
echo "[4/4] Creating CLI shim..."

# Copy CLI scripts into install dir
cp "$SCRIPT_DIR/synapse.ps1" "$INSTALL_DIR/synapse.ps1"
cp "$SCRIPT_DIR/synapse.sh" "$INSTALL_DIR/synapse.sh"

# Create bin directory with executable shim
mkdir -p "$INSTALL_DIR/bin"
cat > "$INSTALL_DIR/bin/synapse" <<'SHIM'
#!/usr/bin/env bash
exec bash "$(dirname "$0")/../synapse.sh" "$@"
SHIM
chmod +x "$INSTALL_DIR/bin/synapse"
chmod +x "$INSTALL_DIR/synapse.sh"
chmod +x "$INSTALL_DIR/start-server.sh" 2>/dev/null || true

# Clean up
rm -rf "$TEMP_PKG"

echo ""
echo "  Synapse installed successfully!"
echo ""
echo "  Add to your shell profile (~/.bashrc or ~/.zshrc):"
echo "    export SYNAPSE_HOME=\"$INSTALL_DIR\""
echo "    export PATH=\"\$SYNAPSE_HOME/bin:\$PATH\""
echo ""
echo "  Then restart your terminal and use:"
echo "    synapse start           Start the dashboard server"
echo "    synapse hook <project>  Configure hooks for a project"
echo "    synapse open            Open dashboard in browser"
echo "    synapse help            Show all commands"
echo ""
