# Synapse Installation & Testing Guide

Synapse has 4 deployment targets. Pick the one that fits your setup.

| Target | Best For | Dashboard Access | Requires |
|--------|----------|-----------------|----------|
| **npm CLI** | Quick local use, per-project monitoring | `http://localhost:4000` | Node 20+ |
| **Single-process server** | Headless/production, shared machines | `http://localhost:4000` | Node 20+ |
| **VS Code extension** | In-editor dashboard, zero config | VS Code webview | VS Code |
| **OpenClaw plugin** | Multi-vendor AI monitoring | `http://localhost:4000` | OpenClaw |

Prerequisites for all targets: **Node.js 20+** and **npm 10+**.

---

## 1. npm CLI

The simplest way to run Synapse. One command starts the server, another configures hooks.

### Install

<!-- tabs:start -->
#### **Windows (PowerShell)**
```powershell
cd C:\Workspace\Coding\Prototypes\Synapse
npm install
npm run build
```

#### **Linux / macOS**
```bash
cd ~/Synapse
npm install
npm run build
```
<!-- tabs:end -->

### Start

<!-- tabs:start -->
#### **Windows (PowerShell)**
```powershell
node bin/synapse.mjs start
# Custom port:
node bin/synapse.mjs start --port 4010
```

#### **Linux / macOS**
```bash
node bin/synapse.mjs start
# Custom port:
node bin/synapse.mjs start --port 4010
```
<!-- tabs:end -->

### Configure hooks for a project

<!-- tabs:start -->
#### **Windows (PowerShell)**
```powershell
# Hook the current directory:
node bin/synapse.mjs hook

# Hook a specific project:
node bin/synapse.mjs hook C:\path\to\your\project
```

#### **Linux / macOS**
```bash
node bin/synapse.mjs hook
node bin/synapse.mjs hook /path/to/your/project
```
<!-- tabs:end -->

This writes `.claude/settings.local.json` in the target project with all 12 Claude Code hook events pointing to Synapse.

### Remove hooks

```
node bin/synapse.mjs unhook
```

### Test

1. Open **http://localhost:4000** in a browser
2. Run the simulator in another terminal:

```
npx tsx scripts/simulate_session.ts
```

You should see a session node with agents and tool calls appear in the graph.

### Verify

```
curl http://localhost:4000/api/health
# → {"ok":true,"clients":0,"mode":"standalone"}
```

---

## 2. Single-Process Server

The prebuilt server serves both the API and the dashboard on a single port. No separate frontend dev server needed.

### Build

<!-- tabs:start -->
#### **Windows (PowerShell)**
```powershell
cd C:\Workspace\Coding\Prototypes\Synapse
npm install
npm run build          # builds frontend → dist/
```

#### **Linux / macOS**
```bash
cd ~/Synapse
npm install
npm run build
```
<!-- tabs:end -->

### Start

<!-- tabs:start -->
#### **Windows (PowerShell)**
```powershell
.\start-server.ps1
# or directly:
npx tsx server/index.ts
```

#### **Linux / macOS**
```bash
./start-server.sh
# or directly:
npx tsx server/index.ts
```
<!-- tabs:end -->

The server starts on port **4000** by default. Both the REST API and the React dashboard are served from this single process. Set `PORT=4010` to change.

### Configure hooks

Manually create `.claude/settings.local.json` in your project:

```json
{
  "hooks": {
    "SessionStart": [{ "hooks": [{ "type": "command", "command": "node C:/path/to/Synapse/hooks/send_event.cjs" }] }],
    "UserPromptSubmit": [{ "hooks": [{ "type": "command", "command": "node C:/path/to/Synapse/hooks/send_event.cjs" }] }],
    "PreToolUse": [{ "hooks": [{ "type": "command", "command": "node C:/path/to/Synapse/hooks/send_event.cjs", "async": true }] }],
    "PostToolUse": [{ "hooks": [{ "type": "command", "command": "node C:/path/to/Synapse/hooks/send_event.cjs", "async": true }] }],
    "SubagentStart": [{ "hooks": [{ "type": "command", "command": "node C:/path/to/Synapse/hooks/send_event.cjs" }] }],
    "SubagentStop": [{ "hooks": [{ "type": "command", "command": "node C:/path/to/Synapse/hooks/send_event.cjs" }] }],
    "Stop": [{ "hooks": [{ "type": "command", "command": "node C:/path/to/Synapse/hooks/send_event.cjs" }] }],
    "SessionEnd": [{ "hooks": [{ "type": "command", "command": "node C:/path/to/Synapse/hooks/send_event.cjs" }] }]
  }
}
```

Or use the CLI shortcut: `node bin/synapse.mjs hook /path/to/project`

### Test

1. Open **http://localhost:4000**
2. Run `npx tsx scripts/simulate_session.ts` to inject test data
3. Or start a Claude Code session in a hooked project — events appear in real-time

### Environment variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `4000` | Server port |
| `SYNAPSE_URL` | `http://localhost:4000/api/events` | Hook target URL |
| `SYNAPSE_DB_PATH` | `server/synapse.db` | SQLite database path |
| `CLIENT_ORIGIN` | `http://localhost:5173` | CORS allowed origins |
| `SYNAPSE_MODE` | `standalone` | Mode identifier (standalone/openclaw) |

---

## 3. VS Code Extension

Dashboard runs as a VS Code webview panel. The server starts automatically inside the extension.

### Build

<!-- tabs:start -->
#### **Windows (PowerShell)**
```powershell
cd C:\Workspace\Coding\Prototypes\Synapse
.\scripts\build-extension.ps1
```

#### **Linux / macOS**
```bash
cd ~/Synapse
./scripts/build-extension.sh
```
<!-- tabs:end -->

This produces a `.vsix` file in `distribution/`.

### Install

<!-- tabs:start -->
#### **Windows (PowerShell)**
```powershell
code --install-extension distribution/synapse-monitor-0.1.0.vsix
```

#### **Linux / macOS**
```bash
code --install-extension distribution/synapse-monitor-0.1.0.vsix
```
<!-- tabs:end -->

### Use

1. Open a project in VS Code that has a `.claude/` directory
2. The extension activates automatically
3. Run **Synapse: Open Dashboard** from the command palette (`Ctrl+Shift+P`)
4. Or click the Synapse icon in the status bar

### Available commands (Command Palette)

| Command | Action |
|---------|--------|
| `Synapse: Open Dashboard` | Opens the monitoring webview |
| `Synapse: Start Server` | Starts the bundled server |
| `Synapse: Stop Server` | Stops the server |
| `Synapse: Configure Hooks` | Adds Claude Code hooks to the current project |
| `Synapse: Remove Hooks` | Removes hooks from the current project |

### Test

1. Open a project with Claude Code hooks configured
2. Open the Synapse dashboard via command palette
3. Start a Claude Code session — events stream into the webview in real-time
4. Or run `npx tsx scripts/simulate_session.ts` from the Synapse directory

---

## 4. OpenClaw Plugin

Multi-vendor AI monitoring dashboard for OpenClaw. Supports Anthropic, OpenAI, Google, Groq, and custom models. Three configurable layers:

- **Layer 1** — JSONL transcript watcher (passive, always on)
- **Layer 2** — Agent tools (`synapse_query`, `synapse_metrics`, `synapse_dashboard`)
- **Layer 3** — Provider wrapper (opt-in per-call monitoring)

### Build

<!-- tabs:start -->
#### **Windows (PowerShell)**
```powershell
cd C:\Workspace\Coding\Prototypes\Synapse
.\scripts\build-openclaw.ps1
```

#### **Linux / macOS**
```bash
cd ~/Synapse
./scripts/build-openclaw.sh
```
<!-- tabs:end -->

Output: `distribution/synapse-openclaw/`

### Install

<!-- tabs:start -->
#### **Windows (PowerShell)**
```powershell
Copy-Item -Recurse distribution\synapse-openclaw "$HOME\.openclaw\extensions\synapse-monitor"
```

#### **Linux / macOS**
```bash
cp -r distribution/synapse-openclaw ~/.openclaw/extensions/synapse-monitor
```
<!-- tabs:end -->

### Configure

Add to `~/.openclaw/openclaw.json`:

```json
{
  "plugins": {
    "synapse-monitor": {
      "port": 4000,
      "layers": {
        "transcriptWatcher": true,
        "agentTools": true,
        "providerWrapper": false
      },
      "wrappedProviders": [],
      "watchPaths": []
    }
  },
  "tools": {
    "allow": ["synapse_query", "synapse_metrics", "synapse_dashboard"]
  }
}
```

| Setting | Default | Description |
|---------|---------|-------------|
| `port` | `4000` | Dashboard + API port |
| `dbPath` | auto | SQLite database path |
| `layers.transcriptWatcher` | `true` | Watch JSONL transcripts |
| `layers.agentTools` | `true` | Register query/metrics tools |
| `layers.providerWrapper` | `false` | Wrap providers for per-call metrics |
| `wrappedProviders` | `[]` | Provider IDs to wrap (Layer 3 only) |
| `watchPaths` | `[]` | Extra watch dirs (empty = auto-discover) |

### Enable provider wrapping (optional)

```json
{
  "layers": { "providerWrapper": true },
  "wrappedProviders": ["anthropic", "openai"]
}
```

### Test without OpenClaw

You can test the event pipeline without a running OpenClaw instance:

<!-- tabs:start -->
#### **Windows (PowerShell)**
```powershell
# Terminal 1: Start the server
.\start-server.ps1

# Terminal 2: Run the multi-vendor simulator
npx tsx openclaw-plugin/scripts/simulate_openclaw.ts --post
```

#### **Linux / macOS**
```bash
# Terminal 1
./start-server.sh

# Terminal 2
npx tsx openclaw-plugin/scripts/simulate_openclaw.ts --post
```
<!-- tabs:end -->

Open **http://localhost:4000** — you should see 3 sessions with vendor-colored nodes:
- **Anthropic/Claude** (orange) — code review with Read, Grep, Edit tools
- **OpenAI/GPT-4o** (green) — data analysis with Bash, Read tools
- **Google/Gemini** (blue) — research with WebSearch, WebFetch tools

### Test JSONL file watcher (Layer 1)

```bash
npx tsx openclaw-plugin/scripts/simulate_openclaw.ts --jsonl
```

This writes JSONL transcript files to a temp directory. Point `watchPaths` at the output directory to test the watcher.

### Test with live OpenClaw

1. Build and install the plugin (see above)
2. Start OpenClaw: `openclaw`
3. Open **http://localhost:4000**
4. Send messages through OpenClaw using different models
5. Events appear in real-time with vendor-specific colors

### Test agent tools

Once the plugin is active, any OpenClaw agent can call:

```
synapse_metrics(groupBy: "vendor", timeRange: "24h")
synapse_query(vendor: "openai", limit: 10)
synapse_dashboard()
```

---

## Troubleshooting

### Port already in use

<!-- tabs:start -->
#### **Windows (PowerShell)**
```powershell
# Find what's using port 4000
netstat -ano | findstr :4000
# Kill the process
taskkill /F /PID <pid>
```

#### **Linux / macOS**
```bash
lsof -i :4000
kill -9 <pid>
```
<!-- tabs:end -->

### Server starts but no events appear

1. Check the hook script path is correct (absolute path, forward slashes)
2. Verify `SYNAPSE_URL` points to the right server
3. Test manually: `curl -X POST http://localhost:4000/api/events -H "Content-Type: application/json" -d '{"hook_event_name":"SessionStart","session_id":"test"}'`

### SQLite errors on startup

Delete the database file and restart:

<!-- tabs:start -->
#### **Windows (PowerShell)**
```powershell
Remove-Item server\synapse.db, server\synapse.db-wal, server\synapse.db-shm -ErrorAction SilentlyContinue
```

#### **Linux / macOS**
```bash
rm -f server/synapse.db server/synapse.db-wal server/synapse.db-shm
```
<!-- tabs:end -->

### VS Code extension doesn't activate

- Ensure the project has a `.claude/` directory
- Check **Output > Synapse** panel for error logs
- Try manually running **Synapse: Start Server** from the command palette
