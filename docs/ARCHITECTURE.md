# AgentViz Architecture

## System Overview

```
┌─────────────────────────────────────────────────────────┐
│                   FRONTEND (React + Vite)                │
│  ┌──────────────┐  ┌──────────────┐  ┌───────────────┐  │
│  │  React Flow   │  │  Agent Panel  │  │  Tool Log     │  │
│  │  Node Graph   │  │  Details/Ctrl │  │  Timeline     │  │
│  └──────┬───────┘  └──────┬───────┘  └───────┬───────┘  │
│         └──────────────────┴──────────────────┘          │
│                         │ WebSocket                      │
└─────────────────────────┼───────────────────────────────┘
                          │
┌─────────────────────────┼───────────────────────────────┐
│                   BACKEND (Node.js/Express)               │
│  ┌──────────────┐  ┌──────────────┐  ┌───────────────┐  │
│  │ Hook Receiver │  │ Agent SDK    │  │  WebSocket    │  │
│  │ POST /events  │  │ Manager      │  │  Broadcaster  │  │
│  └──────┬───────┘  └──────┬───────┘  └───────┬───────┘  │
│         │                  │                   │          │
│  ┌──────┴──────────────────┴───────────────────┴───────┐ │
│  │              Event Store (SQLite)                    │ │
│  └─────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────┘
          ▲                          │
          │ HTTP POST                │ Agent SDK query()
          │                          ▼
┌─────────┴──────────┐    ┌─────────────────────┐
│  Claude Code Hooks  │    │  Spawned Agents      │
│  (existing sessions)│    │  (custom, on-demand)  │
└────────────────────┘    └─────────────────────┘
```

---

## File Structure

```
AgentViz/
├── package.json
├── tsconfig.json
├── tsconfig.server.json          # Separate config for server (Node target)
├── vite.config.ts
├── tailwind.config.ts
├── index.html
├── .env                          # ANTHROPIC_API_KEY
├── .gitignore
├── CLAUDE.md
│
├── server/
│   ├── index.ts                  # Express + WebSocket server (port 4000)
│   ├── db.ts                     # SQLite schema, migrations, query helpers
│   ├── routes/
│   │   ├── events.ts             # POST /api/events — hook receiver
│   │   └── agents.ts             # Agent CRUD REST API
│   ├── services/
│   │   ├── agentManager.ts       # Agent SDK wrapper — spawn/stop/query
│   │   ├── eventStore.ts         # Store & retrieve events from SQLite
│   │   └── broadcaster.ts        # WebSocket broadcast to all clients
│   └── types.ts                  # Server-only types
│
├── src/
│   ├── main.tsx                  # React entry
│   ├── App.tsx                   # Layout: sidebar + graph + panels
│   │
│   ├── store/
│   │   ├── agentStore.ts         # Zustand: agents, edges, events, selected node
│   │   └── wsClient.ts           # WebSocket client singleton + reconnect
│   │
│   ├── components/
│   │   ├── graph/
│   │   │   ├── AgentGraph.tsx          # React Flow canvas wrapper
│   │   │   ├── nodes/
│   │   │   │   ├── SessionNode.tsx     # Root session (blue)
│   │   │   │   ├── AgentNode.tsx       # Agent/subagent (green/gray/red)
│   │   │   │   ├── ToolCallNode.tsx    # Tool invocation (purple/teal/red)
│   │   │   │   └── SpawnAgentNode.tsx  # "+" button to spawn new agent
│   │   │   ├── edges/
│   │   │   │   └── AnimatedEdge.tsx    # Animated data-flow edge
│   │   │   └── nodeTypes.ts           # Registry of custom node types
│   │   │
│   │   ├── panels/
│   │   │   ├── AgentDetailPanel.tsx    # Selected agent: status, tokens, tools, streaming text
│   │   │   ├── ToolLogPanel.tsx        # Chronological tool call log with filters
│   │   │   ├── SpawnAgentDialog.tsx    # Form: prompt, model, tools, permissions
│   │   │   └── TimelinePanel.tsx       # Horizontal gantt-chart timeline
│   │   │
│   │   └── layout/
│   │       ├── Header.tsx              # App title, session selector, connection status
│   │       └── Sidebar.tsx             # Agent list, filters, controls
│   │
│   ├── hooks/
│   │   ├── useAgentStream.ts           # Subscribe to WS events, update store
│   │   └── useAutoLayout.ts            # Custom tree layout for the graph
│   │
│   └── types/
│       └── agent.ts                    # Shared type definitions
│
├── hooks/                              # Claude Code hook scripts
│   └── send_event.js                   # Reads stdin JSON, POSTs to server
│
├── .claude/
│   └── settings.json                   # Hook configuration
│
└── docs/
    ├── ARCHITECTURE.md                 # This file
    └── RESEARCH.md                     # Research findings
```

---

## Type Definitions

### AgentEvent (shared between frontend and backend)
```typescript
interface AgentEvent {
  id: string;                    // nanoid
  type: AgentEventType;
  sessionId: string;
  agentId?: string;
  agentType?: string;            // "Explore", "Plan", "Bash", custom names
  parentAgentId?: string;        // For subagent → parent tracking
  toolName?: string;
  toolInput?: Record<string, unknown>;
  toolResponse?: Record<string, unknown>;
  toolUseId?: string;
  text?: string;                 // Streaming text content
  status?: 'running' | 'success' | 'error' | 'stopped';
  error?: string;
  tokenUsage?: { input: number; output: number };
  duration?: number;             // milliseconds
  timestamp: number;             // Unix ms
}

type AgentEventType =
  | 'session_start' | 'session_end'
  | 'agent_start' | 'agent_stop'
  | 'tool_start' | 'tool_end' | 'tool_error'
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
  streamingText?: string;        // Live text being generated
}

interface ToolCallSummary {
  toolUseId: string;
  toolName: string;
  status: 'running' | 'success' | 'error';
  startTime: number;
  endTime?: number;
  inputPreview?: string;         // First 100 chars of input
}
```

### SpawnAgentRequest (API payload)
```typescript
interface SpawnAgentRequest {
  prompt: string;
  model?: 'opus' | 'sonnet' | 'haiku';
  tools?: string[];              // ["Read", "Edit", "Bash", ...]
  permissionMode?: 'acceptEdits' | 'bypassPermissions' | 'default';
  systemPrompt?: string;
  mcpServers?: Record<string, McpServerConfig>;
  cwd?: string;                  // Working directory for the agent
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

| Type | Visual | Data | Interactions |
|------|--------|------|-------------|
| **SessionNode** | Large rounded rect, blue gradient, 200x80px | Session ID (truncated), model name, start time, agent count badge | Click to select, double-click to filter |
| **AgentNode** | Rounded rect, 180x100px. Green border = running, gray = done, red = error. Pulse animation while active | Agent type, status icon, tool count badge, elapsed time, mini progress bar | Click for detail panel, right-click → stop/transcript |
| **ToolCallNode** | Small pill 140x40px. Purple = running, teal = success, red = error | Tool name, duration | Click for input/output detail |
| **SpawnAgentNode** | 50x50 circle, dashed border, "+" icon | (none) | Click to open SpawnAgentDialog |

### Edge Types

| Type | Visual | When |
|------|--------|------|
| **Spawn edge** | Solid line, animated dash pattern, 2px | Session → Agent, Agent → Subagent |
| **Tool edge** | Dotted line, 1px, appears/fades | Agent → ToolCall (while tool is active) |
| **Data edge** | Animated particles flowing along path | Active communication between agents |

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
3. Script POSTs to http://localhost:4000/api/events
4. Express route stores in SQLite, normalizes to AgentEvent
5. Broadcaster sends AgentEvent via WebSocket to all clients
6. wsClient.ts receives, calls agentStore.addEvent()
7. Zustand store creates new React Flow node + edge
8. React Flow renders new AgentNode connected to parent
9. Custom tree layout re-computes, node animates in
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

File: `.claude/settings.json`
```json
{
  "hooks": {
    "SessionStart": [{
      "hooks": [{
        "type": "command",
        "command": "node \"$CLAUDE_PROJECT_DIR/hooks/send_event.js\""
      }]
    }],
    "SubagentStart": [{
      "hooks": [{
        "type": "command",
        "command": "node \"$CLAUDE_PROJECT_DIR/hooks/send_event.js\""
      }]
    }],
    "SubagentStop": [{
      "hooks": [{
        "type": "command",
        "command": "node \"$CLAUDE_PROJECT_DIR/hooks/send_event.js\""
      }]
    }],
    "PreToolUse": [{
      "hooks": [{
        "type": "command",
        "command": "node \"$CLAUDE_PROJECT_DIR/hooks/send_event.js\"",
        "async": true
      }]
    }],
    "PostToolUse": [{
      "hooks": [{
        "type": "command",
        "command": "node \"$CLAUDE_PROJECT_DIR/hooks/send_event.js\"",
        "async": true
      }]
    }],
    "PostToolUseFailure": [{
      "hooks": [{
        "type": "command",
        "command": "node \"$CLAUDE_PROJECT_DIR/hooks/send_event.js\"",
        "async": true
      }]
    }],
    "Stop": [{
      "hooks": [{
        "type": "command",
        "command": "node \"$CLAUDE_PROJECT_DIR/hooks/send_event.js\""
      }]
    }],
    "SessionEnd": [{
      "hooks": [{
        "type": "command",
        "command": "node \"$CLAUDE_PROJECT_DIR/hooks/send_event.js\""
      }]
    }]
  }
}
```

---

## Dependencies

### Production
| Package | Version | Purpose |
|---------|---------|---------|
| `@anthropic-ai/claude-agent-sdk` | latest | Spawn/control agents programmatically |
| `@xyflow/react` | ^12 | Node-based graph UI |
| `react` | ^19 | UI framework |
| `react-dom` | ^19 | React DOM renderer |
| `zustand` | ^5 | Lightweight state management |
| `express` | ^5 | HTTP server |
| `ws` | ^8 | WebSocket server |
| `better-sqlite3` | ^11 | SQLite database |
| `nanoid` | ^5 | ID generation |
| ~~`dagre`~~ | — | Removed — replaced by custom tree layout in `useAutoLayout.ts` |

### Development
| Package | Version | Purpose |
|---------|---------|---------|
| `typescript` | ^5.7 | Type checking |
| `vite` | ^6 | Frontend build tool |
| `@vitejs/plugin-react` | ^4 | React HMR for Vite |
| `tailwindcss` | ^4 | Utility CSS |
| `tsx` | ^4 | Run TypeScript server directly |
| `concurrently` | ^9 | Run client + server together |
| `@types/express` | ^5 | Express type defs |
| `@types/ws` | ^8 | WebSocket type defs |
| `@types/better-sqlite3` | ^7 | SQLite type defs |
| ~~`@types/dagre`~~ | — | Removed with dagre |
