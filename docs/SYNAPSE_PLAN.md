# Synapse — Universal Agent Visualization Platform

## Context

**Problem**: AI coding agents (Claude Code, OpenClaw, and others) are black boxes. Users can't see what agents are doing in real-time, how tokens are being spent, or how sub-agents orchestrate. OpenClaw (145k+ GitHub stars) has an open feature request (#6467) for real-time agent visualization. ClawWatch exists for cost monitoring but lacks workflow-level debugging. The prototype already solves this for Claude Code — the goal is to generalize it into **Synapse**: a universal agent visualization platform.

**Outcome**: A provider-agnostic agent visualization platform delivered as:
1. **Synapse Dashboard** — standalone web app (full-featured, replaces prototype)
2. **Synapse for VSCode** — embedded WebView extension (sidebar widget + editor panel)
3. **ClawBrain** — OpenClaw plugin (Synapse-powered hooks + dashboard + cost tracking)

All three share a common visualization library (`@synapse-viz/core`) and a high-performance Canvas2D widget engine (`@synapse-viz/widget`) for embedded/lightweight contexts.

---

## Comparison: Synapse vs ClawWatch vs Prototype (v0.1)

| Capability | Prototype (v0.1) | ClawWatch | Synapse (planned) |
|---|---|---|---|
| Real-time node graph | Yes (React Flow) | Topology only ("X-Ray") | Yes (React Flow + Canvas2D widget) |
| Tool-level tracing | Yes (per-tool timing, I/O) | No (agent-level only) | Yes |
| Streaming text preview | Yes | No | Nice-to-have (v2) |
| Token analytics | Yes (sparklines, rollups) | Yes (Recharts) | Yes |
| Cost/budget management | No | Yes (core feature) | Yes (full replacement) |
| Alerting | No | Yes (Discord, email, webhook) | Yes (dashboard + chat + webhooks) |
| Lens views (7) | Yes | No | Yes |
| Timeline panel | Yes | Activity feed only | Yes |
| Provider support | Claude Code only | OpenClaw only | Any provider (adapter pattern) |
| Database | SQLite (local) | Convex (SaaS) | SQLite WAL (local, zero latency) |
| VSCode integration | No | No | Yes (WebView extension) |
| Embeddable widget | No | No | Yes (Canvas2D, ~20KB) |
| OpenClaw plugin | No | No (external tool) | Yes (ClawBrain — single install) |

---

## Architecture

### Monorepo Structure

```
Synapse/ (monorepo root)
├── packages/
│   ├── core/                    # @synapse-viz/core — shared visualization library (Synapse Core)
│   │   ├── types/
│   │   │   ├── agent.ts         # Provider-agnostic event/node types
│   │   │   ├── provider.ts      # ProviderAdapter, AgentTypeRegistry, Theme
│   │   │   └── lens.ts          # LensNode, LensData interfaces
│   │   ├── store/
│   │   │   ├── graphStore.ts    # Event → node/edge processing engine
│   │   │   └── createStore.ts   # Factory: createGraphStore(adapter)
│   │   ├── components/
│   │   │   ├── graph/           # React Flow canvas, nodes, edges
│   │   │   ├── panels/          # Detail panel, timeline, tool log
│   │   │   └── lens/            # All 7 lens view components
│   │   ├── hooks/               # useAutoLayout, useHandlePositions
│   │   ├── utils/
│   │   │   ├── format.ts        # formatTokens, formatElapsed, etc.
│   │   │   └── theme.ts         # Dynamic palette + type registry
│   │   └── server/              # Broadcaster, DB schema, generic routes
│   │
│   └── widget/                  # @synapse-viz/widget — Canvas2D engine (Synapse Widget)
│       ├── engine/
│       │   ├── Scene.ts         # Mini scene graph (nodes, hit testing, pan/zoom)
│       │   ├── Renderer.ts      # Canvas2D draw loop (dirty rect tracking)
│       │   └── Layout.ts        # Tree layout algorithm
│       ├── views/
│       │   ├── GraphView.ts     # Node graph (session→agent→tool tree)
│       │   ├── TreeView.ts      # Collapsible tree list
│       │   ├── HeatmapView.ts   # Grid: actions × time buckets
│       │   ├── TreemapView.ts   # Squarified rectangles by metric
│       │   ├── CompactionView.ts# Context growth + compaction bars
│       │   └── CostView.ts      # Waterfall per-turn token bars
│       ├── Widget.tsx           # React wrapper around Canvas2D engine
│       ├── embed.ts             # iframe/postMessage bridge
│       └── index.html           # Self-contained embeddable page
│
├── apps/
│   ├── dashboard/               # Synapse Dashboard (standalone web app, refactored from prototype)
│   │   ├── src/
│   │   │   ├── adapters/        # ClaudeHookAdapter, ClaudeSdkAdapter
│   │   │   ├── components/      # Claude-specific: SpawnDialog, etc.
│   │   │   └── main.tsx
│   │   └── server/              # Express + Claude hook receiver + Agent SDK
│   │
│   ├── clawbrain/               # OpenClaw plugin + dashboard
│   │   ├── plugin/
│   │   │   ├── openclaw.plugin.json
│   │   │   ├── index.ts         # register(api) — hooks, services, commands
│   │   │   ├── hooks/           # Direct OpenClaw hook handlers
│   │   │   └── skills/          # SKILL.md for /brain command
│   │   ├── src/
│   │   │   ├── adapters/        # OpenClawEventAdapter, GatewayAdapter
│   │   │   ├── components/      # OpenClaw-specific UI
│   │   │   └── main.tsx
│   │   └── server/              # Express + gateway WS + OTLP receiver
│   │
│   └── vscode/                  # Synapse for VSCode extension
│       ├── extension/
│       │   ├── extension.ts     # VSCode activation, WebView provider
│       │   ├── sidebarProvider.ts # Sidebar WebView (widget mode)
│       │   └── panelProvider.ts # Editor panel WebView (full mode)
│       ├── webview/
│       │   ├── main.tsx         # React app for full panel view
│       │   └── sidebar.tsx      # Widget-only for sidebar
│       └── package.json         # VSCode extension manifest
│
├── pnpm-workspace.yaml
├── tsconfig.base.json
└── package.json
```

---

## Dynamic Agent Type Registry

### Problem
The current prototype hardcodes 4 Claude Code agent types: `Explore`, `Plan`, `Bash`, `general-purpose`. This doesn't scale to OpenClaw (which has `main`, `subagent`, `cron`, custom skill agents) or other providers.

### Solution: Provider-Configurable Type Registry

```typescript
// packages/core/types/provider.ts

interface AgentTypeEntry {
  name: string;           // 'Explore', 'subagent', 'researcher'
  color: string;          // hex color
  icon?: string;          // emoji or icon class
  category?: string;      // 'builtin' | 'custom' | 'skill'
}

interface ProviderAdapter {
  id: string;
  displayName: string;

  /** Dynamic agent type registry — replaces hardcoded TYPE_COLORS */
  agentTypes: AgentTypeEntry[];

  /** Dynamic tool registry — replaces hardcoded TOOL_ICONS */
  tools: { name: string; icon: string; category?: string }[];

  /** Normalize raw event → AgentEvent */
  normalizeEvent(raw: Record<string, unknown>): AgentEvent;

  /** Resolve tool → agent mapping when not in event payload */
  resolveToolAgent?(
    event: AgentEvent,
    activeAgents: Map<string, string[]>,
    toolAgentMap: Map<string, string>
  ): string | null;

  /** Check if tool name = sub-agent spawn */
  isSubagentTool?(toolName: string): boolean;

  /** 3 palette variants (user can pick) */
  palettes: ColorPalette[];

  /** Cost model: provider pricing per model */
  pricing?: Record<string, { inputPer1k: number; outputPer1k: number }>;
}
```

### Provider Implementations

**Claude Code adapter** (stays in `apps/dashboard/`):
```typescript
const claudeAdapter: ProviderAdapter = {
  id: 'claude-code',
  displayName: 'Claude Code',
  agentTypes: [
    { name: 'Explore', color: '#00b0ff', icon: '🔍' },
    { name: 'Plan', color: '#b388ff', icon: '📋' },
    { name: 'Bash', color: '#ff9f1a', icon: '▸' },
    { name: 'general-purpose', color: '#00e676', icon: '🤖' },
    { name: 'code-reviewer', color: '#ff5252', icon: '👁' },
    { name: 'code-simplifier', color: '#64ffda', icon: '✂' },
    // ... all Claude Code subagent_types
  ],
  tools: [
    { name: 'Read', icon: '❐' }, { name: 'Write', icon: '✎' },
    { name: 'Edit', icon: '✎' }, { name: 'Bash', icon: '▸' },
    { name: 'Glob', icon: '⌕' }, { name: 'Grep', icon: '⌕' },
    { name: 'Task', icon: '🤖' }, { name: 'WebFetch', icon: '⇣' },
    { name: 'WebSearch', icon: '⌕' }, { name: 'NotebookEdit', icon: '⎕' },
    { name: 'TodoWrite', icon: '☑' },
  ],
  isSubagentTool: (name) => name === 'Task',
  // ... rest of adapter
};
```

**OpenClaw adapter** (in `apps/clawbrain/`):
```typescript
const openclawAdapter: ProviderAdapter = {
  id: 'openclaw',
  displayName: 'OpenClaw',
  agentTypes: [
    { name: 'main', color: '#ef4444', icon: '🦞' },
    { name: 'subagent', color: '#8b5cf6', icon: '🔗' },
    { name: 'cron', color: '#f59e0b', icon: '⏰' },
    { name: 'skill', color: '#10b981', icon: '⚡' },
  ],
  tools: [
    { name: 'web_search', icon: '🔍' }, { name: 'file_read', icon: '📄' },
    { name: 'shell', icon: '💻' }, { name: 'browser', icon: '🌐' },
    { name: 'email', icon: '📧' }, { name: 'calendar', icon: '📅' },
    // Dynamic: loaded from OpenClaw's registered tools at runtime
  ],
  isSubagentTool: (name) => name === 'spawn_subagent' || name === 'delegate',
  pricing: {
    'claude-sonnet-4-5': { inputPer1k: 0.003, outputPer1k: 0.015 },
    'gpt-4o': { inputPer1k: 0.0025, outputPer1k: 0.01 },
    'gemini-2.5-pro': { inputPer1k: 0.00125, outputPer1k: 0.01 },
    // ... all LLM models OpenClaw supports
  },
  // ... rest of adapter
};
```

**Unknown types auto-assigned**: When an event arrives with an agent type not in the registry, the core store auto-assigns a color from a rotating palette and adds it to the runtime registry. No hardcoded limits.

---

## Data Capture: ClawBrain Multi-Layer Strategy

### Layer 1: Direct Hooks (Real-time, <100ms latency)
Our own plugin hooks — the only way to get tool START events for "running..." animations.

```typescript
// apps/clawbrain/plugin/index.ts
export default function register(api) {
  // Hooks that fire reliably
  api.on('message_received', { priority: 100 }, handleMessageReceived);
  api.on('before_agent_start', { priority: 90 }, handleAgentStart);
  api.on('tool_result_persist', { priority: -100 }, handleToolResult);
  api.on('agent_end', { priority: -100 }, handleAgentEnd);

  // Hooks that MAY fire (Issue #6535 — defined but no call sites)
  api.on('session_start', { priority: 100 }, handleSessionStart);
  api.on('session_end', { priority: -100 }, handleSessionEnd);
  api.on('before_tool_call', { priority: 90 }, handleToolStart);  // tool START!
  api.on('after_tool_call', { priority: -100 }, handleToolEnd);

  // Commands for UI
  api.registerCommand({ name: 'brain', handler: openDashboard });
  api.registerCommand({ name: 'brain-status', handler: showStatus });

  // Background service: dashboard server
  api.registerService({
    id: 'clawbrain',
    start: () => startServer(api.getConfig()),
    stop: () => stopServer()
  });
}
```

### Layer 2: Gateway WebSocket (Cost data, 1-2s latency)
Connect to OpenClaw gateway port 18789 for pre-calculated cost events (like ClawWatch does). Cross-referenced with hook-derived token data for accuracy.

### Layer 3: OTLP Receiver (Optional enrichment)
If user has `openclaw-observability-plugin` installed, ClawBrain accepts its OTLP traces on port 4318. Enriches hook data with precise span timing and token breakdowns. Zero config if plugin points to `localhost:4318`.

### Layer 4: File/Log Parsing (Historical data)
On dashboard load, parse OpenClaw session logs to reconstruct history. Watch for file changes for near-real-time updates when hooks don't fire.

### Graceful Degradation
| Hooks available | Tool start animation | Tool completion | Token data | Cost data |
|---|---|---|---|---|
| All 4 working hooks | Yes (via before_tool_call) | Yes | Yes | Via gateway WS |
| Only reliable hooks (no before_tool_call) | No — show after completion | Yes | Yes | Via gateway WS |
| No hooks (worst case) | Via OTLP or polling | Via OTLP or polling | Via OTLP | Via gateway WS |

---

## Canvas2D Widget Engine (`packages/widget`)

### Why Canvas2D
- **~20KB bundle** vs 150KB+ for React Flow
- **~10x faster** rendering in constrained iframe/WebView contexts
- Supports ALL lens views with the same engine
- No React dependency in the widget itself (React wrapper optional)

### Engine Architecture

```typescript
// packages/widget/engine/Scene.ts
class Scene {
  nodes: SceneNode[];           // Positioned rectangles with data
  edges: SceneEdge[];           // Lines between nodes
  camera: { x, y, zoom };      // Pan/zoom state
  dirty: Set<SceneNode>;        // Only redraw changed nodes

  hitTest(x: number, y: number): SceneNode | null;
  panBy(dx: number, dy: number): void;
  zoomTo(level: number, cx: number, cy: number): void;
  render(ctx: CanvasRenderingContext2D): void;
}

// packages/widget/engine/Renderer.ts
class Renderer {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private scene: Scene;
  private textCache: Map<string, TextMetrics>;  // Cache text measurements

  drawNode(node: SceneNode): void;    // Rounded rect + label + badges
  drawEdge(edge: SceneEdge): void;    // Bezier curve with arrow
  drawHeatCell(x, y, w, h, intensity): void;
  drawTreemapRect(x, y, w, h, label, color, depth): void;
  drawBar(x, y, w, h, color): void;  // For cost waterfall
}
```

### View Renderers (one per lens)

| View | Canvas2D Approach | Lines (est.) |
|---|---|---|
| **Graph** | Tree layout → draw node rects + bezier edges + badges | ~200 |
| **Tree** | Indented list with expand/collapse triangles, text labels | ~120 |
| **Heatmap** | Grid of colored cells, axis labels, intensity legend | ~80 |
| **Treemap** | Squarify algorithm → nested colored rects with labels | ~130 |
| **Compaction** | Horizontal stacked bars + line chart overlay | ~90 |
| **Cost** | Vertical waterfall bars + context area fill | ~100 |
| **Total engine** | Scene + Renderer + Layout + 6 views + interactions | **~800 lines, ~20KB** |

### Interactions (all views)
- **Pan**: Click-drag on empty space
- **Zoom**: Mouse wheel / pinch
- **Select**: Click node → highlight + postMessage to parent
- **Hover**: Tooltip with details (name, tokens, duration)
- **Resize**: Canvas auto-resizes to container

---

## Cost & Budget System (ClawWatch Replacement)

### Data Sources
1. **Hook-derived tokens**: From `agent_end` hook payload (input/output token counts)
2. **Gateway WebSocket**: Pre-calculated costs from OpenClaw's cost tracking
3. **Provider pricing table**: Configurable per-model rates in adapter

### Features
- **Real-time cost tracking**: Per-session, per-agent, per-model cost accumulation
- **Budget management**: Configurable limits (hourly/daily/weekly/monthly) with hard-stop option
- **Cost sparklines**: Per-turn token cost visualization (in SessionNode + Cost lens)
- **Model comparison**: Side-by-side cost comparison across models used in session
- **Alert rules**: Budget exceeded, error spike, agent offline, high token usage
- **Cache stats**: Input cache hit ratio, cost savings from caching

### Alert Delivery
- **Dashboard**: Toast notifications + alert panel with history
- **OpenClaw chat**: Send alert as message in active channel via `api.sendMessage()`
- **Webhooks**: Configurable endpoints (Discord, Slack, email via SMTP, custom HTTP)

### Schema additions to `core/server/db.ts`
```sql
CREATE TABLE IF NOT EXISTS cost_records (
  id INTEGER PRIMARY KEY,
  session_id TEXT NOT NULL,
  agent_id TEXT,
  model TEXT,
  input_tokens INTEGER DEFAULT 0,
  output_tokens INTEGER DEFAULT 0,
  cache_read_tokens INTEGER DEFAULT 0,
  estimated_cost REAL DEFAULT 0,
  timestamp INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS budgets (
  id INTEGER PRIMARY KEY,
  scope TEXT NOT NULL,          -- 'global' | 'session' | 'agent'
  scope_id TEXT,
  period TEXT NOT NULL,         -- 'hourly' | 'daily' | 'weekly' | 'monthly'
  limit_usd REAL NOT NULL,
  hard_stop INTEGER DEFAULT 0,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS alerts (
  id INTEGER PRIMARY KEY,
  rule_type TEXT NOT NULL,      -- 'budget' | 'error_spike' | 'offline' | 'token_spike'
  severity TEXT NOT NULL,       -- 'info' | 'warning' | 'critical'
  message TEXT NOT NULL,
  acknowledged INTEGER DEFAULT 0,
  timestamp INTEGER NOT NULL
);
```

---

## VSCode Extension (`apps/vscode/`)

### Two Modes
1. **Sidebar widget**: Canvas2D widget in the sidebar panel (compact graph + metrics)
2. **Editor panel**: Full React dashboard in a WebView editor tab

### Extension Manifest
```json
{
  "contributes": {
    "viewsContainers": {
      "activitybar": [{
        "id": "synapse",
        "title": "Synapse",
        "icon": "media/icon.svg"
      }]
    },
    "views": {
      "synapse": [{
        "type": "webview",
        "id": "synapse.sidebar",
        "name": "Agent Graph"
      }]
    },
    "commands": [
      { "command": "synapse.openPanel", "title": "Synapse: Open Full Dashboard" },
      { "command": "synapse.switchLens", "title": "Synapse: Switch Lens View" }
    ]
  }
}
```

### Data Flow
VSCode extension connects to the same Express backend (port 4000) via WebSocket. The extension auto-detects whether the Synapse server is running and shows connection status in the sidebar.

---

## Files to Extract from Prototype → `packages/core` (Synapse Core)

| Current Location | Destination | Changes |
|---|---|---|
| `src/types/agent.ts` | `core/types/agent.ts` | Generalize `eventSource` to `string`, add `providerMetadata` |
| `src/store/agentStore.ts` | `core/store/graphStore.ts` | Extract processing engine, accept `ProviderAdapter`, remove Claude-specific inference |
| `src/components/graph/AgentGraph.tsx` | `core/components/graph/GraphCanvas.tsx` | Decouple from store, accept props |
| `src/components/graph/nodes/*` | `core/components/graph/nodes/*` | Decouple from store, accept data props |
| `src/components/graph/edges/*` | `core/components/graph/edges/*` | As-is |
| `src/components/lens/*` | `core/components/lens/*` | As-is (already generic via LensNode) |
| `src/components/panels/AgentDetailPanel.tsx` | `core/components/panels/DetailPanel.tsx` | Accept `AgentActions` callbacks for provider buttons |
| `src/components/panels/TimelinePanel.tsx` | `core/components/panels/TimelinePanel.tsx` | As-is |
| `src/components/Toast.tsx` | `core/components/Toast.tsx` | As-is |
| `src/hooks/useAutoLayout.ts` | `core/hooks/useAutoLayout.ts` | As-is |
| `src/utils/format.ts` | `core/utils/format.ts` | Replace hardcoded PALETTES with registry-based lookup |
| `server/services/broadcaster.ts` | `core/server/broadcaster.ts` | As-is |
| `server/db.ts` | `core/server/db.ts` | Rename `hook_event_name` → `source_event_name`, add cost/budget/alert tables |

### Files That Stay Provider-Specific

**In `apps/dashboard/` (Claude Code):**
- `server/services/agentManager.ts` — Claude Agent SDK wrapper
- `server/services/eventStore.ts` → becomes `claudeHookAdapter.ts`
- `src/components/panels/SpawnAgentDialog.tsx` — Claude spawn form
- `hooks/send_event.cjs` — Claude Code hook script

**In `apps/clawbrain/` (OpenClaw):**
- `plugin/index.ts` — OpenClaw plugin registration
- `plugin/hooks/` — Direct hook handlers
- `src/adapters/openclawAdapter.ts` — Event normalization
- `src/adapters/gatewayAdapter.ts` — Gateway WebSocket connection
- `src/components/SpawnDialog.tsx` — OpenClaw agent spawn UI

---

## Implementation Roadmap

### Phase 1: Foundation (Steps 1-3)
**Goal**: Monorepo + shared library with provider adapter pattern

**Step 1: Monorepo Setup**
- Convert to pnpm workspace monorepo
- Create `packages/core/`, `packages/widget/`, `apps/dashboard/`, `apps/clawbrain/`, `apps/vscode/`
- Shared tsconfig, Vite configs, build pipeline
- Files: `pnpm-workspace.yaml`, `tsconfig.base.json`, per-package `package.json`

**Step 2: Extract Core Types + Utilities + Dynamic Type Registry**
- Move types to `core/types/`, add `ProviderAdapter` + `AgentTypeRegistry`
- Move format utils, replace hardcoded PALETTES with registry-driven `getTypeColor()`
- Move format.ts as-is (all functions are generic), update theme.ts for dynamic palettes
- Files: `core/types/agent.ts`, `core/types/provider.ts`, `core/utils/format.ts`, `core/utils/theme.ts`

**Step 3: Extract Store Engine + React Flow Components**
- Move event processing pipeline to `core/store/graphStore.ts`
- Create `createGraphStore(adapter)` factory
- Move all node/edge/lens components, decouple from direct store access
- Files: `core/store/`, `core/components/`, `core/hooks/`

### Phase 2: Refactor + ClawBrain (Steps 4-6) — parallel tracks

**Step 4: Refactor into Synapse Dashboard** (Track A)
- Wire Synapse Dashboard, wire `apps/dashboard/` to import from `@synapse-viz/core`
- Create `claudeAdapter` with all Claude Code agent types + tools
- Verify existing functionality: simulation script, all 7 lenses, detail panels
- Verification: `npx tsx scripts/simulate_session.ts` → graph renders correctly

**Step 5: Build ClawBrain Plugin + Data Capture** (Track B)
- Create OpenClaw plugin with direct hooks (4 reliable + 4 hopeful)
- Gateway WebSocket connection for cost data
- Optional OTLP receiver on port 4318
- `openclawAdapter` with dynamic tool/type loading
- Files: `apps/clawbrain/plugin/`, `apps/clawbrain/src/adapters/`

**Step 6: Build ClawBrain Dashboard** (Track B continued)
- Wire to `@synapse-viz/core` with `openclawAdapter`
- Add cost/budget management UI and alert system
- OpenClaw branding + `/brain` command
- Verification: Install in local OpenClaw, run agents, verify graph + costs

### Phase 3: Widget + VSCode (Steps 7-8) — parallel tracks

**Step 7: Canvas2D Widget Engine**
- Build `packages/widget/` with Scene, Renderer, Layout
- Implement 6 view renderers (Graph, Tree, Heatmap, Treemap, Compaction, Cost)
- React wrapper + iframe embed bridge
- Verification: Embed in test HTML page, verify all 6 views render with real-time updates

**Step 8: Synapse for VSCode Extension**
- Build `apps/vscode/` with sidebar (widget) + panel (full dashboard) modes
- Auto-detect Synapse server, connect via WebSocket
- Commands: open panel, switch lens, connect/disconnect
- Verification: Install extension, open sidebar, verify graph appears from running session

### Phase 4: Cost System + Alerts (Step 9)

**Step 9: Full Cost/Budget/Alert System**
- Cost tracking tables in SQLite + aggregation queries
- Budget management API (CRUD budgets, check thresholds)
- Alert engine (rules → evaluation → delivery)
- Alert delivery: dashboard toast + OpenClaw chat message + webhooks
- ClawWatch feature parity: cost dashboards, health heatmaps, model comparison

### Phase 5: Integration + Polish (Step 10)

**Step 10: End-to-End Testing + Polish**
- Test all 3 deployment targets simultaneously
- Test ClawBrain in OpenClaw with real agent workloads
- Test widget embed in OpenClaw `/brain widget` command
- Test VSCode extension with Claude Code session
- Performance profiling: ensure <16ms frame time for Canvas2D widget

---

## Verification Plan

1. **Synapse Core**: `apps/dashboard/` renders all existing visualization features using `@synapse-viz/core` — run simulation script, verify all 7 lenses, detail panels, timeline
2. **ClawBrain**: Install plugin in local OpenClaw, run `/brain`, verify Synapse-powered dashboard shows live agent graph + cost tracking
3. **Synapse Widget**: Embed `<iframe src="/widget">` in test page, verify all 6 Canvas2D views render with real-time updates, pan/zoom/select work
4. **Synapse for VSCode**: Install extension, open sidebar, verify widget shows live graph from running session
5. **Cost System**: Set budget limit, trigger alert, verify it appears in dashboard + OpenClaw chat + webhook endpoint
6. **Multi-provider**: Run Synapse Dashboard (Claude Code) and ClawBrain (OpenClaw) simultaneously on different ports, verify independent operation
7. **Performance**: Widget renders 50+ nodes at 60fps; full dashboard handles 1000+ events without lag

---

## Open Questions / Risks

1. **OpenClaw hook gaps (Issue #6535)**: `before_tool_call` may not fire — graceful degradation shows tools only on completion. Monitor issue for upstream fix.

2. **OpenClaw session file format**: Need to identify where OpenClaw stores session logs for the file-parsing layer (Layer 4). Research during Step 5.

3. **VSCode WebView limitations**: WebViews have restricted network access. May need the extension host to proxy WebSocket connections to the Synapse server.

4. **ClawHub distribution**: Publishing ClawBrain to ClawHub (OpenClaw's skill marketplace) would increase discoverability. Research packaging requirements during Step 6.

5. **Canvas2D text rendering**: Text measurement is expensive. The widget engine caches `TextMetrics` and uses a fixed font to avoid layout thrashing.

6. **Multi-model pricing accuracy**: LLM pricing changes frequently. The adapter's `pricing` table needs a mechanism for updates (fetch from API or config file).

---

## New Session Prompt

Create folder `c:\Workspace\Coding\Prototypes\Synapse`, open it in VSCode, then paste:

```
I'm building **Synapse** — a universal agent visualization platform. The full plan is at:
c:\Workspace\Coding\Prototypes\Synapse\docs\SYNAPSE_PLAN.md

Read that plan file first. It contains the complete architecture, monorepo structure, implementation roadmap, and all decisions.

**Reference codebase**: The existing prototype is the working codebase. Extract and generalize its code into the Synapse monorepo according to the plan's extraction table.

**Summary of what Synapse is:**
- Provider-agnostic agent visualization platform (React Flow node graph, 7 lens views, timeline, token analytics, cost tracking)
- 3 deployment targets: Synapse Dashboard (standalone web), ClawBrain (OpenClaw plugin), Synapse for VSCode (extension)
- Monorepo with pnpm workspaces: `packages/core` (shared lib), `packages/widget` (Canvas2D engine), `apps/dashboard`, `apps/clawbrain`, `apps/vscode`
- Dynamic agent type registry (no hardcoded types — providers register via adapter pattern)
- Canvas2D widget engine (~20KB) with 6 lens views for embedding in iframes/WebViews
- Full ClawWatch replacement: cost tracking, budget management, alerts (dashboard + chat + webhooks)
- Data capture via direct OpenClaw hooks + gateway WebSocket + optional OTLP from observability plugin
- SQLite WAL mode for storage

**Tech stack**: TypeScript, React 19, @xyflow/react v12, Zustand 5, Tailwind CSS 4, Vite 6, Express 5, better-sqlite3, pnpm workspaces

**Start with Phase 1 from the plan:**
1. Initialize pnpm monorepo structure
2. Extract core types + utilities + dynamic type registry from prototype
3. Extract store engine + React Flow components

Build incrementally — get `packages/core` compiling first, then wire `apps/dashboard` to consume it and verify functionality still works with the simulation script.
```
