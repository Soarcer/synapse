# OpenClaw Reasoning Visualizer — Design Document

**Date:** 2026-02-19
**Package:** `@openclaw/reasoning-viz`
**Status:** Draft — awaiting review

---

## 1. Problem Statement

OpenClaw is a powerful autonomous AI agent, but its internal reasoning is opaque to users. When an agent processes a prompt, it silently:
- Assembles context from workspace files, memory, and skills
- Invokes the LLM with configurable thinking levels (off → xhigh)
- Plans multi-step actions via chain-of-thought reasoning
- Selects and executes tools based on that reasoning
- Handles errors, retries, and context compaction

Users see only the final output. They cannot observe **why** the agent chose a particular tool, **what** alternatives it considered, **how** confident it was, or **where** time and tokens were spent. This makes debugging, optimization, and trust-building difficult.

## 2. Solution: Glass-Box Reasoning Plugin

A standalone OpenClaw plugin (`@openclaw/reasoning-viz`) that exposes the agent's internal reasoning as an interactive web UI. Three synchronized views:

| View | Purpose | Primary Data Source |
|------|---------|-------------------|
| **Reasoning Panel** | Chain-of-thought traces, thinking blocks, decision rationale | `content[].type == "thinking"` blocks in transcripts |
| **Tool Decision Tree** | Interactive graph of tool selection → execution → result flow | `tool_use` / `tool` role entries in JSONL |
| **Agent Timeline** | Waterfall view of the full session execution | All transcript entries + timing data |

All three views share a synchronized cursor — clicking a node in the tool tree highlights the corresponding reasoning block and timeline segment.

## 3. OpenClaw Architecture (Relevant Internals)

### 3.1 How OpenClaw Processes Prompts

```
User Message
    ↓
┌─────────────────────────┐
│ Gateway (Control Plane)  │  src/gateway/server.ts
│ ws://127.0.0.1:18789    │  Session routing, access control
└────────┬────────────────┘
         ↓
┌─────────────────────────┐
│ Session Resolution       │  Determines agent + session context
│                         │  Queue mode: steer / followup / collect
└────────┬────────────────┘
         ↓
┌─────────────────────────┐
│ Context Assembly         │  buildAgentSystemPrompt()
│ • AGENTS.md, SOUL.md    │  Workspace files, memory, skills
│ • Memory (SQLite+vec)   │  Hybrid vector + BM25 search
│ • Skills discovery      │
└────────┬────────────────┘
         ↓
┌─────────────────────────┐
│ Pi Agent SDK Runtime     │  @mariozechner/pi-agent-core
│ runEmbeddedPiAgent()    │  src/agents/piembeddedrunner.ts
│                         │
│ ┌─ createAgentSession() │  Model, tools, thinking level
│ ├─ Stream LLM response  │  Token-by-token with tool intercept
│ ├─ Execute tool calls   │  Tool → result → feed back to model
│ └─ Multi-turn loop      │  Until no more tool calls
└────────┬────────────────┘
         ↓
┌─────────────────────────┐
│ State Persistence        │  Append-only JSONL transcripts
│ ~/.openclaw/agents/     │  Per-session files with tree structure
│   <agentId>/sessions/   │  Compaction on context overflow
└─────────────────────────┘
```

### 3.2 Interceptable Data Structures

| Data | Location | Format | What It Reveals |
|------|----------|--------|-----------------|
| **Thinking traces** | JSONL `content[].type == "thinking"` | Text blocks | Chain-of-thought reasoning, planning steps, confidence signals |
| **Tool calls** | JSONL `content[].type == "tool_use"` | `{name, id, input}` | Which tool was selected and with what parameters |
| **Tool results** | JSONL entries with `role: "tool"` | `{tool_use_id, content}` | What the tool returned, success/failure |
| **Token usage** | JSONL `message.usage` | `{input, output, cache_read, cache_creation}` | Cost, efficiency, cache hit rates |
| **Model info** | JSONL `message.model` | String | Which model handled each turn |
| **Telemetry events** | openclaw-telemetry JSONL | 7 event types with hash chains | Timing, tool duration, session lifecycle |
| **Gateway WS events** | `ws://127.0.0.1:18789` | Request/Response/Event frames | Real-time session state, message routing |
| **Memory queries** | SQLite + memory files | Vector embeddings + markdown | What context the agent retrieved |
| **Session tree** | JSONL `id`/`parentId` fields | Tree structure | Sub-session spawning, compaction history |
| **Error classification** | `classifyEmbeddedPiError()` | Enum categories | Why a turn failed, what fallback was chosen |

### 3.3 Thinking Levels

OpenClaw configures thinking depth per-session:

| Level | Description | Visualization Impact |
|-------|-------------|---------------------|
| `off` | No thinking blocks | Only tool calls visible |
| `minimal` | Brief reasoning | Short decision summaries |
| `low` | Standard reasoning | Planning steps visible |
| `medium` | Detailed reasoning | Full chain-of-thought |
| `high` | Extended thinking | Deep analysis traces |
| `xhigh` | Maximum depth | Complete reasoning chains (GPT-5.2/Codex only) |

The plugin should gracefully degrade — when thinking is `off`, the reasoning panel shows inferred intent from tool call patterns instead.

## 4. Plugin Architecture

### 4.1 High-Level Design

```
┌──────────────────────────────────────────────────────┐
│                    OpenClaw Gateway                    │
│              ws://127.0.0.1:18789                     │
└──────┬────────────────────────────────────┬───────────┘
       │ WS subscribe (real-time)           │
       ↓                                    │
┌──────────────────┐                        │
│  reasoning-viz   │                        │
│  Plugin Core     │←── JSONL file watch ───┘
│                  │    (post-hoc replay)
│  ┌────────────┐  │
│  │ Normalizer │  │    Transforms raw data into
│  │ Pipeline   │  │    ReasoningTrace objects
│  └─────┬──────┘  │
│        ↓         │
│  ┌────────────┐  │
│  │ Trace Store│  │    In-memory indexed store
│  │ (per sess) │  │    with time-series queries
│  └─────┬──────┘  │
│        ↓         │
│  ┌────────────┐  │
│  │ Web Server │  │    Express on configurable port
│  │ :8787      │  │    Static SPA + WS relay
│  └─────┬──────┘  │
└────────┼─────────┘
         ↓
┌──────────────────┐
│  Browser UI      │
│  React SPA       │
│  ┌──────────────┐│
│  │ Timeline     ││    Waterfall execution view
│  ├──────────────┤│
│  │ Reasoning    ││    Thinking block inspector
│  ├──────────────┤│
│  │ Tool Tree    ││    Decision graph
│  └──────────────┘│
└──────────────────┘
```

### 4.2 Core Data Model

```typescript
/** A single reasoning step extracted from thinking blocks */
interface ReasoningStep {
  id: string;
  sessionId: string;
  turnIndex: number;
  timestamp: number;
  thinkingLevel: 'off' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh';

  // Raw thinking text (may be absent if thinking is off)
  rawThinking: string | null;

  // Structured extraction from thinking text
  parsed: {
    intent: string;           // What the agent wants to accomplish
    plan: string[];           // Planned steps (if articulated)
    considerations: string[]; // Alternatives considered
    decision: string;         // Final decision rationale
    confidence: number | null;// Extracted confidence signal (0-1)
  };

  // What happened after this reasoning
  outcome: {
    toolCalls: ToolCallRef[];
    textResponse: string | null;
  };
}

/** A tool call with full context */
interface ToolCallTrace {
  id: string;             // tool_use_id from JSONL
  sessionId: string;
  turnIndex: number;
  name: string;           // Tool name (e.g., "bash", "read", "edit")
  input: Record<string, unknown>;

  // Timing
  startedAt: number;
  completedAt: number | null;
  durationMs: number | null;

  // Result
  status: 'running' | 'success' | 'error';
  output: string | null;
  error: string | null;

  // Context
  precedingReasoning: string | null;  // Thinking that led to this call
  model: string;
  provider: string;
}

/** A complete session trace */
interface SessionTrace {
  sessionId: string;
  agentId: string;
  model: string;
  provider: string;
  thinkingLevel: string;
  startedAt: number;

  // Ordered sequence of all events
  events: TraceEvent[];

  // Indexed views (computed from events)
  reasoning: ReasoningStep[];
  toolCalls: ToolCallTrace[];

  // Aggregates
  totalTokens: { input: number; output: number; cache: number };
  totalCost: number;
  totalDuration: number;
  turnCount: number;
}
```

### 4.3 Normalizer Pipeline

The normalizer transforms raw JSONL transcript lines into `TraceEvent` objects:

```
Raw JSONL line
    ↓
┌─────────────────────┐
│ 1. Parse & validate  │  JSON.parse + type guard
└────────┬────────────┘
         ↓
┌─────────────────────┐
│ 2. Extract blocks    │  Split content[] into thinking, text, tool_use
└────────┬────────────┘
         ↓
┌─────────────────────┐
│ 3. Parse thinking    │  Regex/heuristic extraction of:
│                      │  - Intent statements ("I need to...")
│                      │  - Plan lists ("1. First... 2. Then...")
│                      │  - Decision markers ("I'll use X because...")
│                      │  - Confidence signals ("I'm confident/unsure")
└────────┬────────────┘
         ↓
┌─────────────────────┐
│ 4. Link tool calls   │  Match tool_use → tool result by tool_use_id
│                      │  Associate preceding thinking with each call
└────────┬────────────┘
         ↓
┌─────────────────────┐
│ 5. Compute metrics   │  Duration, token counts, cost estimation
└────────┬────────────┘
         ↓
TraceEvent (typed, indexed, linked)
```

### 4.4 Real-Time vs Post-Hoc Modes

| Mode | Data Source | Latency | Use Case |
|------|-----------|---------|----------|
| **Live** | Gateway WS subscription → event stream | <100ms | Watch agent think in real-time |
| **Replay** | Load JSONL file → parse all lines | Instant (file I/O) | Debug completed sessions |
| **Tail** | Watch JSONL directory → new lines | ~1-5s (fs polling) | Passive monitoring |

The plugin supports all three simultaneously. The UI shows a "LIVE" badge when streaming.

## 5. Visualization Design

### 5.1 View: Agent Timeline (Primary)

A horizontal waterfall/Gantt chart showing the full session execution:

```
Time →  0s        5s        10s       15s       20s       25s
        ┃         ┃         ┃         ┃         ┃         ┃
 Turn 1 ┃█████████████████████████████████████████████████▏┃
        ┃ ┌─Think─┐┌──bash──┐┌─Think─┐┌──read──┐┌─Reply─┐┃
        ┃ │ Plan  ││ ls -la ││Analyze││main.ts ││ Done  │┃
        ┃ │ 2.1s  ││ 0.3s   ││ 1.8s  ││ 0.1s   ││ 3.2s  │┃
        ┃ └───────┘└────────┘└───────┘└────────┘└───────┘┃
        ┃         ┃         ┃         ┃         ┃         ┃
 Turn 2 ┃                    ███████████████████████████████
        ┃                    ┌─Think─┐┌──edit──┐┌─Reply──┐
        ┃                    │Decide ││fix.ts  ││Summary │
        ┃                    │ 1.5s  ││ 0.2s   ││ 2.8s   │
        ┃                    └───────┘└────────┘└────────┘
```

**Interactions:**
- Click a segment → detail panel shows full content
- Hover → tooltip with duration, tokens, cost
- Drag to zoom into time range
- Color coding: blue=thinking, green=tool success, red=tool error, gray=text

### 5.2 View: Reasoning Panel

A structured view of the agent's chain-of-thought:

```
┌─────────────────────────────────────────────────────────┐
│ 🧠 Reasoning Trace — Turn 1                              │
├─────────────────────────────────────────────────────────┤
│                                                          │
│  INTENT                                                  │
│  ┌──────────────────────────────────────────────────┐   │
│  │ The user wants to fix the authentication bug in   │   │
│  │ the login handler. I need to find the relevant    │   │
│  │ file and understand the current implementation.   │   │
│  └──────────────────────────────────────────────────┘   │
│                                                          │
│  PLAN                                                    │
│  1. ☑ Find the login handler file                       │
│  2. ☐ Read the authentication logic                     │
│  3. ☐ Identify the bug                                  │
│  4. ☐ Apply the fix                                     │
│                                                          │
│  DECISION                                                │
│  ┌──────────────────────────────────────────────────┐   │
│  │ I'll start with `bash` to search for auth-related │   │
│  │ files, since I don't know the project structure   │   │
│  │ yet. Using grep is faster than reading all files. │   │
│  │                                                    │   │
│  │ Confidence: ████████░░ 80%                        │   │
│  └──────────────────────────────────────────────────┘   │
│                                                          │
│  → TOOL CALL: bash                                       │
│    grep -r "authenticate" --include="*.ts" src/         │
│    Duration: 0.3s | Status: ✓ Success                    │
│                                                          │
│  ─────────────────────────────────────────────────────   │
│                                                          │
│  ANALYSIS (post-tool)                                    │
│  ┌──────────────────────────────────────────────────┐   │
│  │ Found auth handler in src/auth/login.ts. The      │   │
│  │ token validation is checking expiry with `<`      │   │
│  │ instead of `<=`, causing off-by-one on exact      │   │
│  │ expiry timestamps.                                │   │
│  └──────────────────────────────────────────────────┘   │
│                                                          │
│  → TOOL CALL: edit                                       │
│    src/auth/login.ts line 42: < → <=                    │
│    Duration: 0.1s | Status: ✓ Success                    │
└─────────────────────────────────────────────────────────┘
```

**Features:**
- Collapsible thinking blocks (expand/collapse raw text)
- Plan step tracking with checkbox states
- Confidence meter extracted from language signals
- Tool call cards inline with reasoning flow
- "No thinking data" graceful fallback when level is `off`

### 5.3 View: Tool Decision Tree

An interactive directed graph showing the tool selection and execution flow:

```
                    ┌──────────────┐
                    │  User Prompt │
                    │ "Fix auth    │
                    │  bug"        │
                    └──────┬───────┘
                           │
                    ┌──────▼───────┐
                    │   Think #1   │
                    │ "Find files" │
                    │   2.1s       │
                    └──────┬───────┘
                           │
                    ┌──────▼───────┐
                    │  bash: grep  │───→ 3 matches found
                    │    0.3s ✓    │
                    └──────┬───────┘
                           │
                    ┌──────▼───────┐
                    │   Think #2   │
                    │ "Analyze"    │
                    │   1.8s       │
                    └──────┬───────┘
                           │
                ┌──────────┼──────────┐
                │                     │
         ┌──────▼───────┐     ┌──────▼───────┐
         │  read: main  │     │  read: login │
         │    0.1s ✓    │     │    0.1s ✓    │
         └──────┬───────┘     └──────┬───────┘
                │                     │
                └──────────┬──────────┘
                           │
                    ┌──────▼───────┐
                    │   Think #3   │
                    │ "Found bug"  │
                    │   1.5s       │
                    └──────┬───────┘
                           │
                    ┌──────▼───────┐
                    │  edit: fix   │
                    │    0.2s ✓    │
                    └──────────────┘
```

**Interactions:**
- Zoom/pan (React Flow or similar)
- Click node → shows full content in side panel
- Parallel tool calls shown as branching paths
- Failed tools highlighted in red with error tooltip
- Edge labels show data flow (e.g., "3 matches → read decision")

### 5.4 Session Selector

A sidebar listing available sessions for analysis:

```
┌─────────────────────────┐
│ Sessions                 │
├─────────────────────────┤
│ 🔴 LIVE — claude-opus   │  ← Currently streaming
│   3 turns, 12s, $0.04   │
├─────────────────────────┤
│ ○ 2026-02-19 14:30      │
│   gpt-4o — 8 turns      │
│   45s, $0.12             │
├─────────────────────────┤
│ ○ 2026-02-19 13:15      │
│   claude-sonnet — 3 turns│
│   18s, $0.02             │
├─────────────────────────┤
│ [Load JSONL file...]     │
└─────────────────────────┘
```

### 5.5 Metrics Bar

A persistent bottom bar showing aggregate stats:

```
┌──────────────────────────────────────────────────────────────┐
│ Tokens: 12,450 in / 3,200 out │ Cost: $0.04 │ Cache: 68%   │
│ Duration: 12.3s │ Tools: 4 calls │ Thinking: 5.4s (44%)     │
└──────────────────────────────────────────────────────────────┘
```

## 6. Files to Hook Into (OpenClaw Codebase)

The plugin intercepts data at **three levels**, all non-invasive:

### Level 1: JSONL Transcript Watching (Zero modification)
- **Source:** `~/.openclaw/agents/<agentId>/sessions/*.jsonl`
- **Method:** `fs.watch()` + tail new lines
- **No OpenClaw code changes required**

### Level 2: Gateway WebSocket Subscription (Zero modification)
- **Source:** `ws://127.0.0.1:18789`
- **Method:** Connect as WS client, subscribe to session events
- **Events:** `message.in`, `message.out`, `tool.start`, `tool.end`
- **No OpenClaw code changes required** — Gateway already exposes these

### Level 3: Plugin-Registered Tools (Plugin API)
- **Source:** Plugin's `register()` callback
- **Method:** Register custom tools the agent can call to self-report
- **Tools:** `reasoning_viz_annotate` — allows the agent to explicitly tag decisions
- **Uses standard OpenClaw plugin API** — no core modification

### Key OpenClaw Source Files (Reference Only — Not Modified)

| File | Why It Matters |
|------|---------------|
| `src/gateway/server.ts` | Gateway WS protocol — subscribe to events here |
| `src/agents/piembeddedrunner.ts` | Agent loop — where thinking/tool execution happens |
| `src/agents/piembeddedrunner.ts:subscribeEmbeddedPiSession()` | Event subscription API |
| `src/agents/prompt.ts:buildAgentSystemPrompt()` | Context assembly — understand what the agent sees |
| `src/config/schema.ts` | Plugin config schema patterns to follow |
| `src/extensions/loader.ts` | How plugins are discovered and loaded |

## 7. Tech Stack

| Component | Technology | Rationale |
|-----------|-----------|-----------|
| Plugin core | TypeScript | Matches OpenClaw ecosystem |
| Schema validation | TypeBox | OpenClaw standard (not Zod) |
| Web server | Express 5 | Lightweight, serves SPA + WS relay |
| WebSocket | `ws` | Same as OpenClaw Gateway |
| Frontend framework | React 19 | Community standard, rich ecosystem |
| Timeline view | Custom SVG + CSS | No heavy deps, precise control |
| Tool tree | `@xyflow/react` v12 | Best React graph library, interactive |
| Reasoning panel | Custom React | Structured markdown rendering |
| State management | Zustand 5 | Minimal, performant, React 19 compatible |
| Styling | Tailwind CSS 4 | Utility-first, fast iteration |
| Build (plugin) | tsdown | OpenClaw standard |
| Build (frontend) | Vite 6 | Fast dev server, optimized builds |
| Testing | Vitest | OpenClaw standard |

## 8. Implementation Roadmap

### Phase 1: Core Plugin Skeleton (Week 1)

**Goal:** Plugin installs, starts web server, shows empty UI.

```
@openclaw/reasoning-viz/
├── package.json              # OpenClaw plugin manifest
├── tsconfig.json
├── tsdown.config.ts
├── src/
│   ├── plugin.ts             # Main plugin entry (register, start, stop)
│   ├── config.ts             # TypeBox config schema (port, options)
│   ├── server.ts             # Express + WS server
│   └── types.ts              # ReasoningStep, ToolCallTrace, SessionTrace
└── ui/
    ├── index.html
    ├── vite.config.ts
    └── src/
        ├── App.tsx
        ├── main.tsx
        └── store/
            └── traceStore.ts # Zustand store for session traces
```

**Tasks:**
1. Initialize npm package with `openclaw.extensions` manifest
2. Implement config schema (port, watch paths, thinking parse depth)
3. Create Express server with health check + static SPA serving
4. Set up WebSocket relay (Gateway → browser)
5. Scaffold React app with Vite, Tailwind, Zustand
6. Implement session list sidebar (loads from directory scan)

### Phase 2: JSONL Normalizer + Reasoning Extraction (Week 2)

**Goal:** Parse transcripts into structured reasoning traces.

**Tasks:**
1. JSONL parser with streaming line-by-line processing
2. Thinking block extractor (regex patterns for intent, plan, decision)
3. Tool call linker (match `tool_use` → `tool` result by ID)
4. Token/cost aggregation per turn and session
5. Unit tests for all 6 thinking levels + edge cases
6. File watcher for live tailing of active sessions

### Phase 3: Timeline View (Week 3)

**Goal:** Interactive waterfall timeline of session execution.

**Tasks:**
1. SVG-based timeline renderer with turn lanes
2. Segment types: thinking (blue), tool call (green/red), text response (gray)
3. Zoom/pan controls with time axis
4. Click-to-select with detail panel
5. Hover tooltips (duration, tokens, cost)
6. Live mode: auto-scroll as new events arrive

### Phase 4: Reasoning Panel (Week 3-4)

**Goal:** Structured chain-of-thought inspector.

**Tasks:**
1. Turn-by-turn reasoning card layout
2. Parsed thinking display (intent, plan steps, decision, confidence)
3. Collapsible raw thinking text toggle
4. Inline tool call cards with status badges
5. Plan step tracking (checkbox progression)
6. Graceful fallback for `thinking: off` sessions

### Phase 5: Tool Decision Tree (Week 4)

**Goal:** Interactive graph of tool selection flow.

**Tasks:**
1. React Flow graph with custom node types (prompt, thinking, tool, result)
2. Edge routing (sequential, parallel branches)
3. Node click → side panel with full content
4. Color coding by status (success, error, running)
5. Auto-layout (dagre) with manual repositioning
6. Synchronized selection with timeline and reasoning views

### Phase 6: Real-Time Gateway Integration (Week 5)

**Goal:** Live streaming from OpenClaw Gateway WebSocket.

**Tasks:**
1. Gateway WS client with reconnection logic
2. Event transformer (Gateway frames → TraceEvents)
3. Live session indicator in UI
4. Streaming thinking text (progressive reveal)
5. Tool call status transitions (pending → running → complete)
6. Multi-session support (parallel agent monitoring)

### Phase 7: Polish + Distribution (Week 6)

**Goal:** Production-ready npm package.

**Tasks:**
1. Error handling and edge cases
2. Dark/light theme support
3. Keyboard shortcuts (←/→ navigate turns, space pause live, etc.)
4. Export session trace as JSON/HTML report
5. README with screenshots, installation guide, configuration reference
6. Publish to npm as `@openclaw/reasoning-viz`
7. Submit to OpenClaw community extensions directory

## 9. Plugin Manifest

```json
{
  "name": "@openclaw/reasoning-viz",
  "version": "0.1.0",
  "description": "Interactive visualization of OpenClaw agent reasoning, tool decisions, and execution flow",
  "license": "MIT",
  "type": "module",
  "main": "dist/plugin.js",
  "types": "dist/plugin.d.ts",
  "openclaw": {
    "extensions": ["./dist/plugin.js"],
    "configSchema": "./dist/config-schema.json",
    "slots": ["tool"],
    "catalog": {
      "category": "developer-tools",
      "tags": ["visualization", "debugging", "reasoning", "transparency"],
      "icon": "🔬",
      "screenshots": ["./docs/screenshots/timeline.png"]
    }
  },
  "scripts": {
    "build": "tsdown src/plugin.ts && vite build ui/",
    "dev": "concurrently 'tsdown --watch' 'vite dev ui/'",
    "test": "vitest"
  },
  "peerDependencies": {
    "openclaw": ">=2026.2.0"
  }
}
```

## 10. Configuration

```json5
// In openclaw.json → plugins section
{
  "plugins": {
    "@openclaw/reasoning-viz": {
      "port": 8787,
      "openBrowser": true,
      "thinkingParseDepth": "full",  // "full" | "summary" | "raw"
      "watchPaths": [],               // Additional JSONL directories
      "maxSessionHistory": 50,        // Sessions to keep in memory
      "gatewaySubscribe": true,       // Connect to Gateway WS for live data
      "theme": "auto"                 // "light" | "dark" | "auto"
    }
  }
}
```

## 11. Risk Mitigation

| Risk | Mitigation |
|------|-----------|
| Large JSONL files (100MB+) | Stream-parse, never load full file; use offset tracking |
| Thinking blocks absent (`off` level) | Infer intent from tool patterns; show "No reasoning data" gracefully |
| Gateway WS not available | Fall back to file watching only; show connection status |
| Private/sensitive data in thinking | Inherit OpenClaw's redaction pipeline; add configurable filters |
| OpenClaw API changes | Pin to minimum version; use stable JSONL format (append-only) |
| Performance with many sessions | Virtual scroll, lazy loading, configurable history limit |

## 12. Success Criteria

1. **Install in <30 seconds:** `openclaw plugins install @openclaw/reasoning-viz` just works
2. **Zero core modifications:** No patches, forks, or monkey-patches to OpenClaw
3. **Sub-second latency:** Live events appear in UI within 500ms of Gateway emission
4. **All thinking levels:** Graceful visualization from `off` to `xhigh`
5. **Community adoption:** Clear docs, MIT license, contribution guide
