# Multi-Instance VS Code Architecture

How Synapse isolates each VS Code workspace so multiple instances run simultaneously without interference.

---

## Problem

A developer often has several VS Code windows open (one per project). Each project runs its own Claude Code session. Without isolation, all projects would share a single Synapse server, mixing events from unrelated workspaces into the same dashboard.

## Solution

Each VS Code instance spawns **its own** Synapse server process on a unique port, with a workspace-specific database. Hook scripts discover the correct port at runtime via a port file, ensuring events always reach the right server.

```
VS Code Instance A (Project Foo)        VS Code Instance B (Project Bar)
┌──────────────────────────────┐        ┌──────────────────────────────┐
│ Synapse Extension            │        │ Synapse Extension            │
│  ↓ spawns                   │        │  ↓ spawns                   │
│ Node.js server:4000          │        │ Node.js server:4001          │
│  DB: .../storageA/synapse.db │        │  DB: .../storageB/synapse.db │
│  WS: ws://localhost:4000/ws  │        │  WS: ws://localhost:4001/ws  │
│                              │        │                              │
│ Foo/.claude/.synapse-port    │        │ Bar/.claude/.synapse-port    │
│  → "4000"                   │        │  → "4001"                   │
│                              │        │                              │
│ Sidebar iframe               │        │ Sidebar iframe               │
│  http://localhost:4000       │        │  http://localhost:4001       │
└──────────────────────────────┘        └──────────────────────────────┘

Claude Code (Foo)                        Claude Code (Bar)
  hook fires →                             hook fires →
  send_event.cjs reads                     send_event.cjs reads
  .synapse-port → 4000                    .synapse-port → 4001
  POST localhost:4000/api/events           POST localhost:4001/api/events
```

---

## Component Walkthrough

### 1. Extension Activation (`apps/vscode/src/extension.ts`)

On `activate()`, the extension:

1. Resolves the workspace's **storage path** from `context.storageUri` (VS Code manages this per-workspace — unique on disk).
2. Creates a `ServerManager` with that storage path.
3. Creates a `HookManager` for the workspace's `.claude/` directory.
4. When the server reports its port, **always** configures hooks — even if another instance already started a server. Each workspace must point its hooks at its own server.

```typescript
const storagePath = context.storageUri?.fsPath;
if (storagePath) fs.mkdirSync(storagePath, { recursive: true });

serverManager = new ServerManager(resourcesPath, outputChannel, storagePath);
hookManager = new HookManager(resourcesPath);

serverManager.onStarted(() => {
  const port = serverManager!.port;
  if (hookManager!.needsConfiguration(port)) {
    hookManager!.configureHooks(port);
  }
});
```

**Key decision:** An earlier version checked `if (!isExternalServer)` before configuring hooks. This caused a bug where the second VS Code instance would detect the first's server on port 4000, skip hook configuration, and never send events. Removing this guard fixed it.

### 2. Server Spawn & Port Allocation (`apps/vscode/src/serverManager.ts`)

`ServerManager.start()` always spawns a **new** server process. It never reuses another instance's server.

**Database isolation:** The DB path uses the workspace storage directory:

```typescript
const dbPath = this.storagePath
  ? path.join(this.storagePath, 'synapse.db') // Per-workspace
  : path.join(serverDir, 'synapse.db'); // Fallback
```

**Environment passed to the server process:**

| Variable                | Source                                       | Purpose                     |
| ----------------------- | -------------------------------------------- | --------------------------- |
| `PORT`                  | `synapse.port` setting (default 4000)        | Preferred port              |
| `HOST`                  | `synapse.host` setting (default `localhost`) | Bind address                |
| `SYNAPSE_DB_PATH`       | `context.storageUri`                         | Workspace-specific database |
| `SYNAPSE_DASHBOARD_DIR` | Extension resources                          | Path to bundled dashboard   |

**Port discovery:** The server writes `SYNAPSE_PORT=<actual>` to stdout. The extension reads this to learn the real port (which may differ from the preferred port if it was busy).

```typescript
// In stdout handler:
const match = text.match(/SYNAPSE_PORT=(\d+)/);
if (match) {
  this._port = parseInt(match[1], 10);
}
```

### 3. Server Port Binding (`packages/server/src/index.ts`)

The server reads `PORT` from its environment and attempts to bind. If `EADDRINUSE`, it auto-increments up to 10 times:

```
Preferred port 4000 busy → try 4001 → try 4002 → ... → bind on 4003
Write "SYNAPSE_PORT=4003\n" to stdout
```

This means opening four VS Code instances gets ports 4000, 4001, 4002, 4003 automatically — no manual configuration needed.

### 4. Hook Configuration (`apps/vscode/src/hookManager.ts`)

The hook manager writes Claude Code hook entries to `<workspace>/.claude/settings.local.json`. This file is workspace-scoped — Claude Code merges it with global and project settings.

**Hook events registered** (PascalCase, matching Claude Code's hook API):

| Event           | Purpose                             |
| --------------- | ----------------------------------- |
| `SessionStart`  | Session lifecycle                   |
| `Stop`          | Session end                         |
| `PreToolUse`    | Tool invocation start               |
| `PostToolUse`   | Tool invocation end                 |
| `SubagentStart` | Child agent spawned (via Task tool) |
| `SubagentEnd`   | Child agent completed               |

**Port file approach:** Rather than embedding `--port 4003` in the hook command string (which would go stale), the hook manager:

1. Writes a **static** hook command: `node "<path>/send_event.cjs"`
2. Writes the port to a **runtime file**: `<workspace>/.claude/.synapse-port`

```typescript
writePortFile(claudeDir: string, port: number): void {
  fs.writeFileSync(path.join(claudeDir, '.synapse-port'), String(port), 'utf-8');
}
```

The port file is updated every time the extension starts, so if the port changes across restarts, the hook script always reads the current value.

**`needsConfiguration()` check:** Compares the hook script path in `settings.local.json` against the current extension's resources path. If they match, only the port file is refreshed. If the extension was reinstalled at a new path, hooks are fully reconfigured.

### 5. Hook Script (`hooks/send_event.cjs`)

The hook script runs as a child process of Claude Code. It:

1. Reads JSON from **stdin** (Claude Code pipes hook event data).
2. Discovers the target port using this priority:
   - `SYNAPSE_URL` env var (override)
   - `.claude/.synapse-port` file (primary — runtime port discovery)
   - `--port` CLI arg (legacy/fallback)
   - Default `4000`
3. POSTs the event JSON to `http://localhost:<port>/api/events`.
4. Exits 0 always (fire-and-forget — hook failures must never block Claude Code).

```javascript
function getPortFromFile() {
  const portFile = path.join(process.cwd(), '.claude', '.synapse-port');
  const content = fs.readFileSync(portFile, 'utf-8').trim();
  const port = parseInt(content, 10);
  if (port > 0 && port < 65536) return port;
  return null;
}
```

**Debug mode:** Set `SYNAPSE_DEBUG=1` to write hook execution details to `hook_debug.log` in the workspace root.

### 6. Dashboard Port Resolution

The dashboard (React app) runs inside a VS Code webview iframe. The iframe's `src` is set to `http://localhost:<port>`, so `window.location.host` naturally contains the correct port.

**Sidebar** (`apps/vscode/src/sidebarProvider.ts`):

```typescript
const url = `http://localhost:${this._port}?view=lens`;
// → iframe src="http://localhost:4001?view=lens"
```

**Graph panel** (`apps/vscode/src/webviewPanel.ts`):

```typescript
const url = `http://localhost:${this.port}?view=graph`;
// → iframe src="http://localhost:4001?view=graph"
```

Both use a Content Security Policy that allows `frame-src http://localhost:*` so any port works.

**WebSocket URL** (`apps/dashboard/src/store/wsClient.ts`):

```typescript
// Production mode: derive from page location
`ws://${window.location.host}/ws`;
// In iframe at localhost:4001 → ws://localhost:4001/ws
```

**API calls** (`apps/dashboard/src/utils/api.ts`):

```typescript
// VITE_API_ORIGIN is empty in production → relative paths
apiUrl('/api/events'); // → /api/events → http://localhost:4001/api/events
```

No hardcoded ports anywhere in the dashboard code.

### 7. Extension WebSocket Client (`apps/vscode/src/wsClient.ts`)

The extension itself also maintains a WebSocket connection to its server for features like the tree view and notification system:

```typescript
connect(): void {
  const url = `ws://localhost:${this.port}/ws`;
  this.ws = new WebSocket(url);
}
```

This is separate from the dashboard's WebSocket (which runs inside the iframe).

---

## Data Flow Summary

```
Claude Code (in workspace Foo)
  ↓ hook fires on PreToolUse
  ↓ spawns: node send_event.cjs
     ↓ reads Foo/.claude/.synapse-port → "4001"
     ↓ reads JSON from stdin
     ↓ POST http://localhost:4001/api/events
        ↓
  Synapse Server (port 4001)
     ↓ validates event (Zod schema)
     ↓ stores in Foo's synapse.db
     ↓ broadcasts via WebSocket
        ↓
  Dashboard (iframe at localhost:4001)
     ↓ receives WS message
     ↓ updates Zustand store
     ↓ renders in React Flow graph
```

---

## Settings File Hierarchy

Claude Code merges hook settings from three levels:

| File                                      | Scope                      | Who writes it       |
| ----------------------------------------- | -------------------------- | ------------------- |
| `~/.claude/settings.json`                 | Global (all workspaces)    | User / other tools  |
| `<workspace>/.claude/settings.json`       | Project (committed to git) | Project maintainers |
| `<workspace>/.claude/settings.local.json` | Workspace (gitignored)     | Synapse extension   |

Synapse only writes to `settings.local.json` to avoid polluting committed project config or global settings.

**Important:** Global hooks (in `~/.claude/settings.json`) run in **every** workspace. Misbehaving global hooks (e.g., hooks from other tools that error or hang) can interfere with Synapse's hooks even though they're unrelated. If events aren't arriving, check global hooks first.

---

## Troubleshooting

### Events not appearing in dashboard

1. **Check the port file exists:**

   ```
   cat <workspace>/.claude/.synapse-port
   ```

   Should contain a port number (e.g., `4001`).

2. **Check hooks are loaded in Claude Code:**
   Type `/hooks` in the Claude Code session. You should see Synapse entries for `PreToolUse`, `PostToolUse`, etc.

3. **Test the hook script manually:**

   ```bash
   echo '{"hook_event_name":"test"}' | SYNAPSE_DEBUG=1 node hooks/send_event.cjs
   cat hook_debug.log
   ```

4. **Test the server directly:**

   ```bash
   curl -X POST http://localhost:<port>/api/events \
     -H "Content-Type: application/json" \
     -d '{"hook_event_name":"test","session_id":"manual-test"}'
   ```

   Should return `{"ok":true,"eventId":"..."}`.

5. **Check for interfering global hooks:**

   ```bash
   cat ~/.claude/settings.json | grep -A5 hooks
   ```

   Remove any hooks from other tools that may be erroring.

6. **Claude Code session was started before hooks were configured:**
   Close and reopen the Claude Code session. Hooks are read at session start.

### Multiple instances sharing a port

Each extension instance spawns its own server. If the preferred port (default 4000) is busy, the server auto-increments. Check the Synapse output channel in VS Code (View → Output → select "Synapse") to see which port was allocated.

### Port file is stale after extension crash

If the extension crashes without cleaning up, the port file may point to a dead port. The next extension activation overwrites it with the new port. If Claude Code was already running, restart the Claude Code session to pick up the new port.

---

## Design Decisions

| Decision                                 | Rationale                                                                                            |
| ---------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| **Own server per instance** (not shared) | Prevents event crosstalk between workspaces. Each dashboard shows only its project's events.         |
| **Port file instead of CLI arg**         | Survives extension reinstalls and port changes without reconfiguring hooks.                          |
| **Auto-increment ports**                 | Zero configuration — just open VS Code and it works.                                                 |
| **`context.storageUri` for DB**          | VS Code manages per-workspace storage automatically. No path collisions.                             |
| **Always configure hooks**               | Removed the `isExternalServer` guard that caused a bug where the second instance skipped hook setup. |
| **Fire-and-forget hooks**                | Hook script always exits 0. A crashed server or network error must never block Claude Code.          |
| **`settings.local.json` only**           | Avoids modifying committed project config or global user settings.                                   |
