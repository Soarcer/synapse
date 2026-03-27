# Synapse Architecture

## System Overview

```
┌─────────────────────────────────────────────────────────┐
│                   FRONTEND (React + Vite)                │
│  ┌──────────────┐  ┌──────────────┐  ┌───────────────┐  │
│  │  React Flow   │  │  Inspector   │  │  Timeline     │  │
│  │  Node Graph   │  │  Panel       │  │  Panel        │  │
│  └──────┬───────┘  └──────┬───────┘  └───────┬───────┘  │
│         └──────────────────┴──────────────────┘          │
│                         │ WebSocket                      │
└─────────────────────────┼───────────────────────────────┘
                          │
┌─────────────────────────┼───────────────────────────────┐
│                   BACKEND (Node.js/Express 5)             │
│  ┌──────────────┐  ┌──────────────┐  ┌───────────────┐  │
│  │ File Relay   │  │ Agent SDK    │  │  WebSocket    │  │
│  │ + HTTP POST  │  │ Manager      │  │  Broadcaster  │  │
│  └──────┬───────┘  └──────┬───────┘  └───────┬───────┘  │
│         │                  │                   │          │
│  ┌──────┴──────────────────┴───────────────────┴───────┐ │
│  │              Event Store (sql.js / SQLite)          │ │
│  └─────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────┘
          ▲                          │
          │ appendFileSync           │ Agent SDK query()
          │ (relay file)             ▼
┌─────────┴──────────┐    ┌─────────────────────┐
│  Claude Code Hooks  │    │  Spawned Agents      │
│  (existing sessions)│    │  (custom, on-demand)  │
└────────────────────┘    └─────────────────────┘
```

---

## Server Topology

The Synapse server binds **3 ports** that shift together based on `SYNAPSE_PORT` (default 27246):

| Port               | Default | Role          | Purpose                                   |
| ------------------ | ------- | ------------- | ----------------------------------------- |
| `SYNAPSE_PORT`     | 27246   | Main server   | HTTP(S) + WebSocket + dashboard           |
| `SYNAPSE_PORT + 1` | 27247   | Hook server   | Bidirectional hooks (permission requests) |
| `SYNAPSE_PORT + 2` | 27248   | HTTP fallback | Mobile Safari, Vite dev proxy             |

To use a different port: `SYNAPSE_PORT=27346` → hooks on 27347, fallback on 27348.

The main port serves HTTP (or HTTPS if TLS certs are configured) and the WebSocket endpoint at `/ws`. The HTTP fallback always runs plain HTTP for clients that can't do TLS (hook scripts, Vite dev proxy, mobile Safari over LAN).

---

## Usage Modes

Synapse runs in one of three modes depending on how it's started:

|                        | VS Code Extension                                          | `synapse start` CLI                                               | Dev Mode (`start-server.ps1`)                     |
| ---------------------- | ---------------------------------------------------------- | ----------------------------------------------------------------- | ------------------------------------------------- |
| **Server lifecycle**   | Child process of VS Code, lazy-started on first panel open | Foreground or background daemon (`-d`)                            | Manual via `npx tsx packages/server/src/index.ts` |
| **PID tracking**       | None (tied to VS Code process tree)                        | `~/.synapse/synapse.pid`                                          | None                                              |
| **Hook configuration** | Auto by `HookManager` on server start                      | Auto by `synapse start` (writes to `.claude/settings.local.json`) | Must be pre-configured in `.claude/settings.json` |
| **Hook removal**       | Auto on extension deactivate                               | Manual via `synapse unhook`                                       | Manual                                            |
| **Stop**               | VS Code window close / `synapse.stop` command              | `synapse stop` (reads PID, sends SIGTERM)                         | Ctrl+C                                            |
| **DB location**        | VS Code workspace storage (isolated per window)            | `~/.synapse/synapse.db`                                           | `packages/server/synapse.db`                      |
| **Relay file**         | `$TEMP/synapse_relay_<port>.jsonl`                         | Same                                                              | Same                                              |
| **Multiple instances** | One per VS Code window (different ports)                   | One global daemon                                                 | One manual instance                               |

### VS Code Extension

The extension uses lazy activation — server starts only when the user opens a Synapse panel (sidebar or graph). On startup:

1. `ServerManager.start()` spawns `node resources/synapse-server/server.mjs`
2. Waits for `/api/health` to return 200
3. `HookManager.configureHooks(port)` writes hooks to `.claude/settings.local.json`
4. `WsClient` connects to `ws://localhost:<port>/ws`
5. Status bar shows green indicator

On VS Code close, hooks are removed and the child process is killed (taskkill on Windows).

### CLI (`synapse start`)

```bash
synapse start -d          # Start background daemon, hook current project
synapse status            # Show URL, PID, hook status
synapse open              # Reopen dashboard in browser
cd ~/other-project && synapse hook   # Hook another project to the running daemon
synapse stop              # Stop daemon, clean up relay files
```

### Dev Mode

```powershell
.\start-server.ps1        # Backend on port 27246
.\start-client.ps1        # Frontend on port 5173 (Vite dev server with HMR)
```

Hooks must already be configured in `.claude/settings.json` (checked into the repo). The Vite dev server proxies `/api/*` and `/ws` to port 27248 (HTTP fallback).

---

## Event Transport: File Relay

Hook scripts deliver events via a shared JSONL relay file instead of HTTP POST. This eliminates per-event network overhead (~30-50ms → ~2ms).

### How it works

```
Hook fires → node send_event.cjs → fs.appendFileSync(relay.jsonl, JSON + "\n")
                                         ↓
Server polls relay.jsonl every 50ms → reads new bytes from offset → ingestRawEvent()
```

### File locations (all in `$TEMP`, port-scoped)

| File                               | Purpose                                  |
| ---------------------------------- | ---------------------------------------- |
| `synapse_relay_<port>.jsonl`       | Append-only event log                    |
| `synapse_relay_offset_<port>.json` | Byte offset of last read position        |
| `synapse_cb_<port>.json`           | Circuit breaker state (written by hooks) |

### Lifecycle

- **Startup**: Server restores persisted offset, reads any backlog, starts `fs.watch` + 50ms poll
- **Steady state**: Hook appends ~2.3KB/event via `appendFileSync` (atomic for small writes). Server reads new bytes, parses JSON lines, ingests events
- **Compaction**: When read offset exceeds 2 MB, the server discards already-processed bytes and rewrites the file with just the unread tail. This prevents unbounded growth
- **Hard cap**: If the file exceeds 10 MB (shouldn't happen with compaction), the server reads remaining data then truncates
- **Shutdown**: `synapse stop` deletes relay, offset, and circuit breaker files. Server graceful shutdown persists final offset (events written after stop accumulate and replay on next start)
- **External deletion**: If `$TEMP` is cleaned by the OS, the watcher detects the rename event and recreates the file with offset reset

### Circuit breaker

Hook scripts track consecutive failures. After 3 failures in 30 seconds, the breaker opens permanently — no more attempts until the server starts and deletes the breaker file (`synapse_cb_<port>.json`). This prevents wasted process spawns when Synapse isn't running.

### HTTP fallback

If the relay file can't be written (permissions, disk full), hooks fall back to `POST /api/events` on the HTTP fallback port. The circuit breaker applies to both transports independently.

---

## Project Structure (pnpm monorepo)

```
Synapse/
├── pnpm-workspace.yaml
├── tsconfig.base.json
├── CLAUDE.md
│
├── packages/
│   ├── core/                            # @synapse-ai/core
│   │   └── src/
│   │       ├── schemas.ts               # Zod schemas for events
│   │       ├── types/agent.ts           # AgentEvent, node types
│   │       ├── config.ts                # Port constants, feature flags
│   │       └── utils/format.ts          # Formatting helpers
│   │
│   ├── server/                          # @synapse-ai/server
│   │   └── src/
│   │       ├── index.ts                 # Express + WS + 3-port bind
│   │       ├── db.ts                    # sql.js init, migrations, queries
│   │       ├── hookServer.ts            # Bidirectional hook server (port+1)
│   │       ├── routes/
│   │       │   ├── events.ts            # POST /api/events — HTTP hook receiver
│   │       │   ├── analytics.ts         # Coaching, cost, prompt analysis
│   │       │   └── settings.ts          # Hook config management
│   │       └── services/
│   │           ├── broadcaster.ts       # WebSocket broadcast + heartbeat
│   │           ├── eventStore.ts        # SQLite event persistence
│   │           ├── eventIngestion.ts    # Raw event → normalized AgentEvent
│   │           ├── fileEventRelay.ts    # JSONL relay file reader
│   │           └── agentManager.ts      # Agent SDK spawn/stop/query
│   │
│   ├── cli/                             # @synapse-ai/cli
│   │   └── src/
│   │       ├── cli.ts                   # synapse start|stop|status|hook|unhook|open
│   │       ├── daemon.ts                # Process lifecycle, PID file
│   │       └── hookSetup.ts             # Hook configuration for CLI mode
│   │
│   └── openclaw/                        # @synapse-ai/openclaw (uses better-sqlite3)
│
├── apps/
│   ├── dashboard/                       # React frontend (Vite, not published)
│   │   └── src/
│   │       ├── App.tsx                  # Layout: graph + panels + settings
│   │       ├── store/agentStore.ts      # Zustand store
│   │       └── components/
│   │           ├── graph/               # React Flow graph + custom nodes
│   │           ├── panels/              # Inspector, Timeline, ToolDetail
│   │           ├── permissions/         # Remote approval cards
│   │           └── settings/            # Hook controls, push setup
│   │
│   └── vscode/                          # @synapse-ai/vscode — VS Code extension
│       └── src/
│           ├── extension.ts             # Activation, lazy start, event pipeline
│           ├── serverManager.ts         # Server process lifecycle
│           ├── hookManager.ts           # Auto hook configuration
│           ├── wsClient.ts              # WebSocket client + heartbeat
│           ├── webviewPanel.ts          # Graph panel webview
│           └── sidebarProvider.ts       # Sidebar webview
│
├── hooks/                               # Claude Code hook scripts (plain Node.js)
│   ├── send_event.cjs                   # Reads stdin, appends to relay file
│   ├── send_response.cjs               # Bidirectional hook (permission responses)
│   ├── send_codex_event.cjs            # OpenAI Codex hook adapter
│   └── send_gemini_event.cjs           # Gemini hook adapter
│
├── scripts/                             # Build and simulation scripts
│   ├── simulate_session.ts              # Basic 8-event simulation
│   └── simulate_all_nodes.ts            # Comprehensive 31-event demo
│
├── .claude/
│   ├── settings.json                    # Hook configuration (checked in)
│   └── settings.local.json              # Local overrides (gitignored)
│
└── docs/
    ├── ARCHITECTURE.md                  # This file
    ├── RESEARCH.md                      # Research findings
    └── DEPLOYMENT.md                    # Packaging and deployment
```

---

## Type Definitions

### AgentEvent (shared between frontend and backend)

```typescript
interface AgentEvent {
  id: string; // nanoid
  type: AgentEventType;
  sessionId: string;
  agentId?: string;
  agentType?: string; // "Explore", "Plan", "Bash", custom names
  parentAgentId?: string; // For subagent → parent tracking
  toolName?: string;
  toolInput?: Record<string, unknown>;
  toolResponse?: Record<string, unknown>;
  toolUseId?: string;
  text?: string; // Streaming text content
  status?: 'running' | 'success' | 'error' | 'stopped';
  error?: string;
  tokenUsage?: { input: number; output: number };
  duration?: number; // milliseconds
  timestamp: number; // Unix ms
}

type AgentEventType =
  | 'session_start'
  | 'session_end'
  | 'agent_start'
  | 'agent_stop'
  | 'tool_start'
  | 'tool_end'
  | 'tool_error'
  | 'text_delta'
  | 'result';
```

### AgentNodeData (React Flow node data)

```typescript
interface AgentNodeData {
  agentId: string;
  agentType: string;
  sessionId: string;
  status: 'running' | 'success' | 'error' | 'stopped';
  prompt?: string;
  toolCalls: ToolCallSummary[];
  tokenUsage: { input: number; output: number };
  startTime: number;
  endTime?: number;
  streamingText?: string; // Live text being generated
}

interface ToolCallSummary {
  toolUseId: string;
  toolName: string;
  status: 'running' | 'success' | 'error';
  startTime: number;
  endTime?: number;
  inputPreview?: string; // First 100 chars of input
}
```

### SpawnAgentRequest (API payload)

```typescript
interface SpawnAgentRequest {
  prompt: string;
  model?: 'opus' | 'sonnet' | 'haiku';
  tools?: string[]; // ["Read", "Edit", "Bash", ...]
  permissionMode?: 'acceptEdits' | 'bypassPermissions' | 'default';
  systemPrompt?: string;
  mcpServers?: Record<string, McpServerConfig>;
  cwd?: string; // Working directory for the agent
}

interface McpServerConfig {
  command: string;
  args: string[];
  env?: Record<string, string>;
}
```

---

## API Endpoints

### Hook Event Receiver

```
POST /api/events
Content-Type: application/json
Body: <raw hook JSON from stdin>

Response: 200 OK
```

The server normalizes the raw hook payload into an `AgentEvent` and broadcasts it via WebSocket.

### Agent Management

```
GET    /api/agents                    → List active agents
POST   /api/agents/spawn              → Spawn new agent (body: SpawnAgentRequest)
POST   /api/agents/:id/message        → Send message to running agent (body: { message: string })
DELETE /api/agents/:id                → Stop agent
GET    /api/agents/:id/transcript     → Get agent transcript
```

### Event History

```
GET /api/events?sessionId=X&agentId=Y&type=Z&limit=100&offset=0
```

### WebSocket Protocol

```
WS /ws

Server → Client messages:
{ type: "event", data: AgentEvent }
{ type: "connected", data: { activeAgents: [...] } }
{ type: "agent_text", data: { agentId, text, isPartial } }

Client → Server messages:
{ type: "subscribe", sessionId: string }
{ type: "unsubscribe", sessionId: string }
```

---

## Node Graph Design

### Node Types

| Type               | Visual                                                                                                  | Data                                                                       | Interactions                                          |
| ------------------ | ------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- | ----------------------------------------------------- |
| **SessionNode**    | Large rounded rect, blue gradient, 200x80px                                                             | Session ID (truncated), model name, start time, agent count badge          | Click to select, double-click to filter               |
| **AgentNode**      | Rounded rect, 180x100px. Green border = running, gray = done, red = error. Pulse animation while active | Agent type, status icon, tool count badge, elapsed time, mini progress bar | Click for detail panel, right-click → stop/transcript |
| **ToolCallNode**   | Small pill 140x40px. Purple = running, teal = success, red = error                                      | Tool name, duration                                                        | Click for input/output detail                         |
| **SpawnAgentNode** | 50x50 circle, dashed border, "+" icon                                                                   | (none)                                                                     | Click to open SpawnAgentDialog                        |

### Edge Types

| Type           | Visual                                 | When                                    |
| -------------- | -------------------------------------- | --------------------------------------- |
| **Spawn edge** | Solid line, animated dash pattern, 2px | Session → Agent, Agent → Subagent       |
| **Tool edge**  | Dotted line, 1px, appears/fades        | Agent → ToolCall (while tool is active) |
| **Data edge**  | Animated particles flowing along path  | Active communication between agents     |

### Auto-Layout (`useAutoLayout.ts`)

Custom tree layout algorithm (LR, left-to-right) purpose-built for agent hierarchies. Replaced dagre — no rank detection bugs, no edge routing inflation, no compaction passes needed.

**Algorithm (two phases):**

1. **Bottom-up** — recursively compute subtree heights (memoized). A node's subtree height = `max(own height, sum of children subtree heights + gaps)`.
2. **Top-down** — assign positions. Each parent is vertically centered relative to its children. Children stacked to the right, centered as a group within the parent's subtree band.

**Spacing constants:**
| Constant | Value | Purpose |
|----------|-------|---------|
| `GAP_X` | 50px | Horizontal gap between parent right edge and child left edge |
| `GAP_Y` | 14px | Vertical gap between sibling nodes |
| `GAP_Y_TOOL` | 10px | Tighter vertical gap between tool call nodes |
| `ROOT_GAP` | 40px | Vertical gap between independent root trees (sessions) |
| `MARGIN` | 30px | Canvas margin |

**Edge style:** Smoothstep (orthogonal with 8px rounded corners) — clearer than bezier for hierarchical trees.

**Measured dimensions:** Uses `node.measured.width/height` from ReactFlow DOM when available, falls back to `NODE_DEFAULTS`. Layout key includes a measurement flag to trigger re-layout after first render.

---

## Data Flows

### Hook Event → Graph Node

```
1. Claude Code fires SubagentStart hook
2. Hook script reads JSON from stdin: { session_id, agent_id, agent_type }
3. Script appends JSON line to $TEMP/synapse_relay_<port>.jsonl
   (fallback: POSTs to http://localhost:<port+2>/api/events)
4. FileEventRelay polls relay file every 50ms, reads new bytes from offset
5. ingestRawEvent() normalizes and stores in SQLite
6. Broadcaster sends AgentEvent via WebSocket to all clients
7. wsClient.ts receives, calls agentStore.addEvent()
8. Zustand store creates new React Flow node + edge
9. React Flow renders new AgentNode connected to parent
10. Custom tree layout re-computes, node animates in
```

### Spawn Agent from Dashboard

```
1. User clicks SpawnAgentNode "+"
2. SpawnAgentDialog opens
3. User fills prompt, picks tools, clicks "Spawn"
4. POST /api/agents/spawn { prompt, tools, model, ... }
5. agentManager.spawn() calls Agent SDK query() with includePartialMessages: true
6. Assigns agentId, adds to activeAgents map
7. Broadcasts { type: "agent_start", agentId, agentType: "custom", ... }
8. For each StreamEvent from SDK:
   - content_block_start (tool_use) → broadcast tool_start
   - content_block_delta (text_delta) → broadcast text_delta
   - content_block_stop → broadcast tool_end
9. On ResultMessage → broadcast agent_stop with token usage
10. Frontend updates nodes in real-time throughout
```

---

## SQLite Schema

```sql
CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id TEXT UNIQUE NOT NULL,        -- nanoid
  session_id TEXT NOT NULL,
  hook_event_name TEXT NOT NULL,         -- Original hook event name
  event_type TEXT NOT NULL,              -- Normalized AgentEventType
  agent_id TEXT,
  agent_type TEXT,
  parent_agent_id TEXT,
  tool_name TEXT,
  tool_use_id TEXT,
  tool_input TEXT,                       -- JSON string
  tool_response TEXT,                    -- JSON string
  status TEXT,
  error TEXT,
  token_input INTEGER,
  token_output INTEGER,
  duration_ms INTEGER,
  raw_payload TEXT NOT NULL,             -- Full original JSON
  created_at INTEGER NOT NULL            -- Unix timestamp ms
);

CREATE INDEX IF NOT EXISTS idx_events_session ON events(session_id);
CREATE INDEX IF NOT EXISTS idx_events_agent ON events(agent_id);
CREATE INDEX IF NOT EXISTS idx_events_type ON events(event_type);
CREATE INDEX IF NOT EXISTS idx_events_time ON events(created_at);
```

---

## Hook Configuration

All 12 hook events use `async: true` — hooks are fire-and-forget telemetry that must never block Claude Code.

**Events:** SessionStart, UserPromptSubmit, SubagentStart, SubagentStop, Stop, SessionEnd, PreToolUse, PostToolUse, PostToolUseFailure, PermissionRequest, Notification, PreCompact

### Dev mode (`.claude/settings.json`, checked in)

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "node hooks/send_event.cjs",
            "async": true
          }
        ]
      }
    ]
  }
}
```

All events follow the same pattern. The script reads hook JSON from stdin and appends it to the relay file.

### VS Code extension (auto-configured)

`HookManager.configureHooks(port)` writes to `.claude/settings.local.json` with the port baked into the command:

```
SET "SYNAPSE_PORT=27246" && node "C:/.../resources/synapse-server/hooks/send_event.cjs"
```

### CLI (`synapse start`)

`synapse start` calls `configureHooks(cwd, port)` which writes the same structure to `.claude/settings.local.json`.

### PermissionRequest (bidirectional)

The `PermissionRequest` hook uses `send_response.cjs` instead of `send_event.cjs`. This script POSTs to the hook server (port+1) and blocks until the dashboard user approves/denies the permission. It returns `hookSpecificOutput` with the decision to Claude Code.

---

## Dependencies

### Production

| Package                          | Version | Purpose                                                              |
| -------------------------------- | ------- | -------------------------------------------------------------------- |
| `@anthropic-ai/claude-agent-sdk` | latest  | Spawn/control agents programmatically                                |
| `@xyflow/react`                  | ^12     | Node-based graph UI                                                  |
| `react`                          | ^19     | UI framework                                                         |
| `react-dom`                      | ^19     | React DOM renderer                                                   |
| `zustand`                        | ^5      | Lightweight state management                                         |
| `express`                        | ^5      | HTTP server                                                          |
| `ws`                             | ^8      | WebSocket server                                                     |
| `sql.js`                         | latest  | SQLite (pure JS/asm.js — no native deps, works in VS Code extension) |
| `nanoid`                         | ^5      | ID generation                                                        |
| `pino`                           | latest  | Structured server logging                                            |
| `zod`                            | ^4      | Runtime validation at system boundaries                              |

### Development

| Package                | Version | Purpose                        |
| ---------------------- | ------- | ------------------------------ |
| `typescript`           | ^5.7    | Type checking                  |
| `vite`                 | ^6      | Frontend build tool            |
| `@vitejs/plugin-react` | ^4      | React HMR for Vite             |
| `tailwindcss`          | ^4      | Utility CSS                    |
| `tsx`                  | ^4      | Run TypeScript server directly |
| `vitest`               | latest  | Test runner                    |
| `esbuild`              | latest  | VS Code extension bundler      |

> **Note:** `better-sqlite3` is only used by `@synapse-ai/openclaw` (excluded from the main workspace). All other packages use `sql.js`.
