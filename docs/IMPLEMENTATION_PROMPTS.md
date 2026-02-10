# Implementation Prompts for Synapse

Use these prompts in separate Claude Code sessions. Run them in order.
Each prompt is self-contained — paste it as-is into a new session opened at
`c:\Workspace\Coding\Prototypes\Synapse`.

---

## Session 1: Project Scaffold + Backend

```
Read CLAUDE.md and docs/ARCHITECTURE.md thoroughly first.

Implement the complete project scaffold and backend server for Synapse.

### Step 1: Project Setup
Create these config files:
- package.json with all dependencies listed in ARCHITECTURE.md (both production and dev)
- tsconfig.json for frontend (ES2022, JSX react-jsx, strict)
- tsconfig.server.json for backend (ES2022, Node target, strict)
- vite.config.ts with React plugin, server proxy /api and /ws to port 4000
- tailwind.config.ts
- index.html with root div
- .gitignore (node_modules, dist, server/synapse.db, .env)
- .env.example with ANTHROPIC_API_KEY=your-key-here

Run npm install after creating package.json.

### Step 2: Shared Types
Create src/types/agent.ts with all type definitions from ARCHITECTURE.md:
AgentEvent, AgentEventType, AgentNodeData, ToolCallSummary, SpawnAgentRequest, McpServerConfig, and WebSocket message types.

### Step 3: SQLite Database
Create server/db.ts:
- Initialize SQLite with better-sqlite3
- Create the events table and indexes from the schema in ARCHITECTURE.md
- Export helper functions: insertEvent, queryEvents, getEventsBySession, getEventsByAgent

### Step 4: Services
Create server/services/broadcaster.ts:
- Manages a Set of WebSocket clients
- broadcast(event: AgentEvent) sends to all connected clients
- addClient/removeClient methods
- Sends initial state (active agents list) on new client connection

Create server/services/eventStore.ts:
- Wraps db.ts with higher-level operations
- normalizeHookPayload(raw: any): AgentEvent — converts raw hook JSON into our AgentEvent type
  - Map hook_event_name to our event_type (SubagentStart→agent_start, PreToolUse→tool_start, PostToolUse→tool_end, etc.)
  - Extract agent_id, tool_name, tool_input from the raw payload
  - Generate nanoid for event id
- storeAndBroadcast(raw: any, broadcaster): stores + broadcasts

Create server/services/agentManager.ts:
- import { query } from "@anthropic-ai/claude-agent-sdk"
- Maintains Map<string, RunningAgent> of active agents
- spawn(request: SpawnAgentRequest, broadcaster):
  - Calls query() with includePartialMessages: true
  - Iterates the async stream, converting StreamEvents to AgentEvents
  - Broadcasts each event in real-time
  - Tracks token usage from ResultMessage
  - Returns agentId
- stop(agentId): cancels the running agent
- getActive(): returns list of active agents
- sendMessage(agentId, message): resumes session with new prompt

### Step 5: Routes
Create server/routes/events.ts:
- POST /api/events — receives raw hook JSON body, calls eventStore.normalizeHookPayload and storeAndBroadcast
- GET /api/events — query params: sessionId, agentId, type, limit, offset. Returns stored events.

Create server/routes/agents.ts:
- GET /api/agents — list active agents from agentManager
- POST /api/agents/spawn — body is SpawnAgentRequest, calls agentManager.spawn
- POST /api/agents/:id/message — body { message }, calls agentManager.sendMessage
- DELETE /api/agents/:id — calls agentManager.stop

### Step 6: Server Entry
Create server/index.ts:
- Express app on port 4000
- JSON body parser
- CORS for localhost:5173
- Mount routes: /api/events, /api/agents
- Create WebSocket server on same HTTP server at path /ws
- On WS connection: add to broadcaster, send initial state
- On WS close: remove from broadcaster
- Log startup message

### Step 7: Scripts
Add to package.json scripts:
- "dev": "concurrently \"npm run dev:server\" \"npm run dev:client\""
- "dev:client": "vite"
- "dev:server": "tsx watch server/index.ts"
- "build": "tsc && vite build"

### Step 8: Hook Scripts
Create hooks/send_event.js:
- Read all stdin into a buffer
- Parse as JSON
- POST to http://localhost:4000/api/events with Content-Type: application/json
- Exit 0 regardless of success/failure (fire and forget)
- Use only Node.js built-in fetch (no dependencies)

Create .claude/settings.json with the complete hook configuration from ARCHITECTURE.md.

### Step 9: Verify
- Run `npm run dev:server` and confirm it starts on port 4000
- Test POST /api/events with a mock SubagentStart payload using curl
- Test GET /api/events returns the stored event
- Test GET /api/agents returns empty array
- Stop the server

Do NOT create any frontend React components yet — only index.html with a root div and an empty src/main.tsx that renders "Synapse loading...". The frontend will be built in Session 2.
```

---

## Session 2: React Flow Frontend

```
Read CLAUDE.md and docs/ARCHITECTURE.md thoroughly first.
Read src/types/agent.ts to understand the shared types.
Read server/index.ts to understand the WebSocket and API contract.

Implement the complete React frontend for Synapse.

### Step 1: WebSocket Client
Create src/store/wsClient.ts:
- Singleton WebSocket client connecting to ws://localhost:4000/ws
- Auto-reconnect with exponential backoff (1s, 2s, 4s, max 30s)
- onEvent callback for incoming AgentEvents
- connection status tracking (connected/disconnected/reconnecting)
- subscribe/unsubscribe by sessionId

### Step 2: Zustand Store
Create src/store/agentStore.ts using Zustand:

State:
- sessions: Map<string, SessionData>
- agents: Map<string, AgentNodeData>
- toolCalls: Map<string, ToolCallSummary[]>
- events: AgentEvent[] (recent events, capped at 1000)
- nodes: ReactFlow Node[] (computed from agents)
- edges: ReactFlow Edge[] (computed from parent relationships)
- selectedNodeId: string | null
- connectionStatus: 'connected' | 'disconnected' | 'reconnecting'
- filter: { sessionId?: string; agentType?: string }

Actions:
- addEvent(event: AgentEvent): handles all event types, updates agents/sessions/toolCalls
  - agent_start: create new agent entry + React Flow node + edge to parent
  - agent_stop: update agent status, set endTime
  - tool_start: add tool call to agent's toolCalls, create ToolCallNode
  - tool_end: update tool call status and duration
  - tool_error: mark tool call as error
  - text_delta: append to agent's streamingText
  - session_start: create session entry + SessionNode
  - session_end: update session
- selectNode(id): set selectedNodeId
- setFilter(filter): update filter
- clearEvents(): reset state

Wire wsClient to call addEvent on every incoming event.

### Step 3: Custom Nodes
Create src/components/graph/nodes/SessionNode.tsx:
- Displays: session ID (first 8 chars), model name, start time (relative), agent count badge
- Blue gradient background, rounded corners
- Has a single output Handle at the bottom
- Subtle shadow, slightly larger than other nodes

Create src/components/graph/nodes/AgentNode.tsx:
- Displays: agent type as title, status icon (spinner/checkmark/X), elapsed time
- Tool count badge in corner
- Green left border when running (with pulse animation via CSS), gray when done, red on error
- Progress bar at bottom (indeterminate while running)
- Input Handle at top, output Handle at bottom
- Streaming text preview (last 50 chars, truncated)

Create src/components/graph/nodes/ToolCallNode.tsx:
- Small pill shape
- Displays: tool name, duration (when complete)
- Purple background when running, teal when success, red on error
- Input Handle at top only (leaf node)
- Minimal — just tool name and status icon

Create src/components/graph/nodes/SpawnAgentNode.tsx:
- 50x50 circle with "+" icon
- Dashed gray border, hover turns blue
- onClick opens SpawnAgentDialog
- Always positioned to the right of the graph

Create src/components/graph/edges/AnimatedEdge.tsx:
- Bezier curve with animated dash pattern for active connections
- Solid gray for completed connections
- Uses React Flow's getBezierPath

Create src/components/graph/nodeTypes.ts:
- Export nodeTypes and edgeTypes registries for React Flow

### Step 4: Graph Canvas
Create src/components/graph/AgentGraph.tsx:
- React Flow component with custom nodeTypes and edgeTypes
- MiniMap in bottom-right
- Controls (zoom buttons) in bottom-left
- Background with dots pattern
- fitView on initial load and when new nodes are added
- onNodeClick → selectNode in store
- Dark theme colors

### Step 5: Auto-Layout Hook
Create src/hooks/useAutoLayout.ts:
- Uses dagre to compute node positions
- rankdir: 'TB', ranksep: 80, nodesep: 50
- Runs when nodes/edges change
- Animates node positions with requestAnimationFrame
- Returns positioned nodes

### Step 6: Panels
Create src/components/panels/AgentDetailPanel.tsx:
- Shows when a node is selected (from store.selectedNodeId)
- Agent type, status, session ID
- Token usage display (input/output tokens)
- Tool call history as a scrollable list
- Live streaming text area (monospace, auto-scroll)
- "Send Message" input + button (calls POST /api/agents/:id/message)
- "Stop Agent" button (calls DELETE /api/agents/:id)
- Close button

Create src/components/panels/ToolLogPanel.tsx:
- Chronological list of all tool calls across all agents
- Each row: timestamp, agent type, tool name, status badge, duration
- Expandable rows showing tool_input and tool_response as formatted JSON
- Filter chips: by tool name, by agent, by status
- Auto-scroll to bottom (with pause on scroll-up)

Create src/components/panels/SpawnAgentDialog.tsx:
- Modal overlay
- Prompt textarea (required)
- Model selector: dropdown with opus, sonnet, haiku
- Tool checkboxes: Read, Write, Edit, Bash, Glob, Grep, WebSearch, WebFetch, Task
- Permission mode selector: acceptEdits (default), bypassPermissions
- System prompt textarea (optional, collapsible)
- Working directory input (optional, defaults to project root)
- "Spawn Agent" button → POST /api/agents/spawn, closes dialog
- Cancel button

Create src/components/panels/TimelinePanel.tsx:
- Horizontal timeline at the bottom of the screen (collapsible)
- Each agent as a horizontal bar (color-coded by type)
- Tool calls as small markers within agent bars
- Time axis with relative timestamps
- Click on a bar to select that agent in the graph
- Zoom with scroll wheel, pan with drag

### Step 7: Layout
Create src/components/layout/Header.tsx:
- "Synapse" title
- Connection status dot (green/red/yellow)
- Session selector dropdown (from store.sessions)
- Dark mode toggle
- "Clear" button to reset view

Create src/components/layout/Sidebar.tsx:
- Active agents list with status indicators
- Quick spawn button
- Filter controls (by agent type, session)
- Event counter

### Step 8: App Shell
Create src/App.tsx:
- Layout: Header at top, Sidebar on left, AgentGraph in center, AgentDetailPanel on right (when selected), ToolLogPanel as bottom drawer, TimelinePanel as collapsible bottom panel
- Uses CSS Grid or flexbox
- Dark background (#0d1117 or similar dark theme)
- Initialize WebSocket connection on mount
- Load existing events from GET /api/events on mount

Create src/main.tsx:
- Render App into root div
- Import Tailwind CSS

### Step 9: Styling
- Dark theme throughout (GitHub dark-style colors)
- Tailwind utilities for all styling
- CSS animations: pulse for active nodes, fade-in for new nodes
- Responsive: minimum 1200px width, sidebar collapsible on smaller screens

### Step 10: Verify
- Run `npm run dev` (both server and client)
- Verify React Flow canvas renders with a SpawnAgentNode
- Open browser console, verify WebSocket connects
- Use curl to POST a mock session_start event to /api/events
- Verify a SessionNode appears in the graph
- POST a mock agent_start event, verify AgentNode appears connected to session
- Click an agent node, verify detail panel opens
- Click SpawnAgentNode, verify dialog opens
- Test spawning an agent (if ANTHROPIC_API_KEY is set)
```

---

## Session 3: Integration Testing & Polish

```
Read CLAUDE.md and docs/ARCHITECTURE.md first.
Read the existing code in server/ and src/ to understand what's been built.

This session focuses on integration testing, bug fixes, and polish.

### Step 1: End-to-End Smoke Test
Start the app with `npm run dev`.
Using curl or a test script, simulate a complete Claude Code session by POSTing events in order:
1. POST session_start event
2. POST agent_start (SubagentStart) event with a parent session_id
3. POST tool_start (PreToolUse for Bash) event
4. POST tool_end (PostToolUse for Bash) event
5. POST another tool_start/tool_end pair (Read)
6. POST agent_stop (SubagentStop) event
7. POST session_end event

Verify each step updates the graph correctly in the browser.
Create this as a test script at scripts/simulate_session.ts that can be run with `npx tsx scripts/simulate_session.ts`.

### Step 2: Agent SDK Integration Test
If ANTHROPIC_API_KEY is available:
- Test spawning an agent from the dashboard with a simple prompt like "What files are in this directory?"
- Verify the agent node appears, tool calls stream in, and the result displays
- Test stopping an agent mid-execution
- Test sending a follow-up message to a running agent

### Step 3: Hook Integration Test
- Verify the .claude/settings.json hooks configuration is correct
- Test that hooks/send_event.js correctly reads stdin and POSTs
- If possible, run a quick Claude Code command in a separate terminal and verify events appear in the dashboard

### Step 4: Fix Issues
Fix any bugs found during testing. Common issues to check:
- WebSocket reconnection after server restart
- Node layout not updating after new nodes
- Race conditions between events arriving out of order
- Agent detail panel not updating for streaming text
- Memory leaks from unclosed WebSocket connections or intervals

### Step 5: Polish
- Add toast notifications for agent start/stop events (simple CSS-only toasts)
- Add keyboard shortcuts: Space = pause live updates, F = fit view, Escape = close panels
- Add connection status recovery (re-fetch events after reconnect)
- Ensure error states display gracefully (API down, agent crash, etc.)
- Add loading states for agent spawning

### Step 6: Verify Everything Works
Run through the complete flow:
1. Start app with `npm run dev`
2. Spawn an agent from the dashboard
3. Watch it execute in the graph
4. Click nodes, view details
5. Check the tool log
6. Check the timeline
7. Stop the agent
8. Run the simulation script
9. Verify all nodes render correctly
```

---

## Notes

- Sessions 1 and 2 can be run in parallel since they don't overlap (backend vs frontend)
- Session 3 must run after both 1 and 2 are complete
- Each session should read CLAUDE.md and docs/ARCHITECTURE.md first for full context
- The .env file with ANTHROPIC_API_KEY is needed for Session 3's agent spawning tests
- VSCode webview extension (Phase 6 in the original plan) is deferred to a future session
