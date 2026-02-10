#!/usr/bin/env bash
set -euo pipefail

SYNAPSE_HOME="${SYNAPSE_HOME:-$HOME/.synapse}"
PID_FILE="$SYNAPSE_HOME/synapse.pid"

load_env() {
  if [ -f "$SYNAPSE_HOME/.env" ]; then
    set -a
    source "$SYNAPSE_HOME/.env"
    set +a
  fi
}

cmd_start() {
  if [ ! -d "$SYNAPSE_HOME" ]; then
    echo "Synapse not installed at $SYNAPSE_HOME"
    echo "Run: bash scripts/install-global.sh"
    exit 1
  fi

  load_env
  local port="${PORT:-4000}"

  if [[ "${1:-}" == "--background" || "${1:-}" == "-b" ]]; then
    cd "$SYNAPSE_HOME"
    nohup npx tsx server/index.ts > "$SYNAPSE_HOME/synapse.log" 2>&1 &
    echo $! > "$PID_FILE"
    echo "Synapse started in background (PID: $!)"
    echo "Dashboard: http://localhost:$port"
  else
    cd "$SYNAPSE_HOME"
    exec npx tsx server/index.ts
  fi
}

cmd_stop() {
  if [ -f "$PID_FILE" ]; then
    local pid
    pid=$(cat "$PID_FILE")
    if kill -0 "$pid" 2>/dev/null; then
      kill "$pid"
      echo "Synapse stopped (PID: $pid)"
    else
      echo "Process $pid not found (already stopped?)"
    fi
    rm -f "$PID_FILE"
  else
    echo "No PID file found. Synapse may not be running in background mode."
  fi
}

cmd_status() {
  load_env
  local port="${PORT:-4000}"
  if curl -sf "http://localhost:$port/api/health" > /dev/null 2>&1; then
    local data
    data=$(curl -sf "http://localhost:$port/api/health")
    local clients
    clients=$(echo "$data" | node -e "process.stdin.on('data',d=>console.log(JSON.parse(d).clients))" 2>/dev/null || echo "?")
    echo "Synapse is RUNNING on port $port"
    echo "  Connected clients: $clients"
    echo "  Dashboard: http://localhost:$port"
  else
    echo "Synapse is NOT RUNNING on port $port"
  fi
}

cmd_hook() {
  local target="${1:-$(pwd)}"
  bash "$SYNAPSE_HOME/scripts/setup-hooks.sh" "$target"
}

cmd_unhook() {
  local target="${1:-$(pwd)}"
  local settings="$target/.claude/settings.local.json"
  if [ -f "$settings" ]; then
    rm -f "$settings"
    echo "Removed Synapse hooks from: $settings"
  else
    echo "No .claude/settings.local.json found in: $target"
  fi
}

cmd_open() {
  load_env
  local port="${PORT:-4000}"
  local url="http://localhost:$port"

  if command -v xdg-open &>/dev/null; then
    xdg-open "$url"
  elif command -v open &>/dev/null; then
    open "$url"
  elif command -v start &>/dev/null; then
    start "$url"
  else
    echo "Open in your browser: $url"
  fi
}

cmd_help() {
  cat <<EOF

  Synapse - Claude Agent Monitor

  Usage: synapse <command> [options]

  Commands:
    start [--background]  Start the Synapse server
    stop                  Stop a background Synapse server
    status                Check if Synapse is running
    hook [path]           Configure hooks for a project (default: cwd)
    unhook [path]         Remove hooks from a project (default: cwd)
    open                  Open dashboard in browser
    help                  Show this help

  Home: $SYNAPSE_HOME

EOF
}

COMMAND="${1:-help}"
shift || true

case "$COMMAND" in
  start)   cmd_start "$@" ;;
  stop)    cmd_stop ;;
  status)  cmd_status ;;
  hook)    cmd_hook "$@" ;;
  unhook)  cmd_unhook "$@" ;;
  open)    cmd_open ;;
  help)    cmd_help ;;
  *)       cmd_help ;;
esac
