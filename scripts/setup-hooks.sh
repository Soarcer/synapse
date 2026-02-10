#!/usr/bin/env bash
set -euo pipefail

TARGET_PROJECT="${1:-$(pwd)}"
SYNAPSE_HOME="${SYNAPSE_HOME:-}"

# Resolve Synapse home
if [ -z "$SYNAPSE_HOME" ]; then
  if [ -d "$HOME/.synapse" ]; then
    SYNAPSE_HOME="$HOME/.synapse"
  else
    SYNAPSE_HOME="$(cd "$(dirname "$0")/.." && pwd)"
  fi
fi

HOOK_SCRIPT="$SYNAPSE_HOME/hooks/send_event.cjs"
if [ ! -f "$HOOK_SCRIPT" ]; then
  echo "ERROR: Hook script not found at: $HOOK_SCRIPT"
  echo "Set SYNAPSE_HOME to the Synapse install directory."
  exit 1
fi

HOOK_CMD="node \"$HOOK_SCRIPT\""

CLAUDE_DIR="$TARGET_PROJECT/.claude"
SETTINGS_FILE="$CLAUDE_DIR/settings.local.json"

mkdir -p "$CLAUDE_DIR"

# All Claude Code hook events
SYNC_EVENTS='["SessionStart","UserPromptSubmit","SubagentStart","SubagentStop","Stop","SessionEnd"]'
ASYNC_EVENTS='["PreToolUse","PostToolUse","PostToolUseFailure","PermissionRequest","Notification","PreCompact"]'

# Build the hooks JSON
HOOKS_JSON="{"
FIRST=true

for event in SessionStart UserPromptSubmit SubagentStart SubagentStop Stop SessionEnd; do
  $FIRST || HOOKS_JSON+=","
  FIRST=false
  HOOKS_JSON+="\"$event\":[{\"hooks\":[{\"type\":\"command\",\"command\":$HOOK_CMD}]}]"
done

for event in PreToolUse PostToolUse PostToolUseFailure PermissionRequest Notification PreCompact; do
  HOOKS_JSON+=",\"$event\":[{\"hooks\":[{\"type\":\"command\",\"command\":$HOOK_CMD,\"async\":true}]}]"
done

HOOKS_JSON+="}"

# If settings file exists, merge; otherwise create
if [ -f "$SETTINGS_FILE" ]; then
  # Use node to merge (handles JSON properly)
  node -e "
    const fs = require('fs');
    const existing = JSON.parse(fs.readFileSync('$SETTINGS_FILE', 'utf-8'));
    const newHooks = JSON.parse(process.argv[1]);
    existing.hooks = { ...(existing.hooks || {}), ...newHooks };
    fs.writeFileSync('$SETTINGS_FILE', JSON.stringify(existing, null, 2));
  " "$HOOKS_JSON"
else
  node -e "
    const fs = require('fs');
    const hooks = JSON.parse(process.argv[1]);
    fs.writeFileSync('$SETTINGS_FILE', JSON.stringify({ hooks }, null, 2));
  " "$HOOKS_JSON"
fi

echo "Synapse hooks configured in: $SETTINGS_FILE"
echo "Hook script: $HOOK_SCRIPT"
echo ""
echo "Start Synapse with: synapse start"
