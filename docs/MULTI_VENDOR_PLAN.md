# Multi-Vendor Integration Plan — Synapse

## Date: 2026-02-10

## Executive Summary

Extend Synapse to monitor Gemini CLI and OpenAI Codex CLI alongside Claude Code, using a plugin-per-tool architecture. Each tool gets its own package under `packages/` containing hook scripts, file watchers, and normalizers. The universal `AgentEvent` type remains the single source of truth.

---

## Integration Pattern Taxonomy

Synapse uses three fundamentally different integration patterns depending on the tool being monitored. Understanding these patterns is critical for deciding how to add new tools.

### Pattern 1: Hook-Based (Push — Real-Time)

**Used for**: Claude Code, Gemini CLI

```
┌──────────────┐   hook fires    ┌──────────────┐   stdin JSON    ┌──────────────┐   HTTP POST    ┌──────────────┐
│   AI Tool     │ ─────────────→ │  Hook Script  │ ─────────────→ │  Synapse      │ ─────────────→ │  Dashboard    │
│  (has hooks)  │                │  (send_event) │                │  Server       │   WebSocket    │              │
└──────────────┘                └──────────────┘                └──────────────┘               └──────────────┘
```

**How it works**: The AI tool has a built-in hook system. On lifecycle events (session start, tool call, etc.), it executes a configured shell command, passing event data as JSON on stdin. Our hook script reads stdin and POSTs to the Synapse server. Fire-and-forget with a 3-second timeout — never blocks the AI tool.

**Synapse is PASSIVE** — it receives events pushed to it. Lowest latency (<100ms).

**Applicable when**: The tool has a hook/plugin system that fires commands on lifecycle events with structured JSON payloads. Both Claude Code and Gemini CLI have nearly identical hook systems (JSON on stdin, command hooks in settings files).

### Pattern 2: File-Based (Pull — Near Real-Time)

**Used for**: Codex CLI, Aider (future)

```
┌──────────────┐   writes JSONL   ┌──────────────┐   fs.watch     ┌──────────────┐   HTTP POST    ┌──────────────┐
│   AI Tool     │ ─────────────→  │  Session File │ ←───────────── │  File Watcher │ ─────────────→ │  Synapse      │
│  (no hooks)   │                 │  (.jsonl)     │   + polling    │  (adapter)    │                │  Server       │
└──────────────┘                 └──────────────┘               └──────────────┘               └──────────────┘
```

**How it works**: The AI tool writes session transcripts to JSONL files but has no hook system (or only a limited one). Synapse runs a file watcher that monitors known directories, incrementally tails new lines, normalizes them to `AgentEvent`, and POSTs them to the server. Uses `fs.watch` for near-real-time detection with a polling fallback (every 5s) for reliability on Windows.

**Synapse is ACTIVE** — it watches for new data. Slightly higher latency (100-500ms typical, up to 5s if fs.watch misses an event).

**Applicable when**: The tool produces structured transcript files (JSONL, JSON, Markdown) but doesn't have a hook system. Codex CLI writes to `~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl`. Aider writes to `.aider.chat.history.md` and `.aider.llm.history`.

### Pattern 3: Plugin/Framework Embedding (Deep Integration)

**Used for**: OpenClaw

```
┌─────────────────────────────────────────────────────────────────┐
│                       OpenClaw Runtime                           │
│                                                                   │
│  ┌─────────┐    ┌─────────┐    ┌─────────┐                      │
│  │ Agent A  │    │ Agent B │    │ Agent C │  (any model/provider) │
│  │ (Claude) │    │ (GPT-4o)│    │(Gemini) │                      │
│  └────┬─────┘    └────┬────┘    └────┬────┘                      │
│       │               │              │                            │
│       ▼               ▼              ▼                            │
│  ┌────────────────────────────────────────────────┐              │
│  │         Provider Layer (direct / OpenRouter)     │              │
│  └──────────────────────┬─────────────────────────┘              │
│                         │                                         │
│  ═══════════════════════╪═════════════════════════════            │
│  SYNAPSE PLUGIN (embedded inside OpenClaw)                        │
│  ┌──────────────────────┼────────────────────────────┐           │
│  │                      │                             │           │
│  │  Layer 3: Provider Wrapper                         │           │
│  │  Intercepts every LLM API call. Captures:          │           │
│  │  model, tokens, latency, cost, vendor.             │           │
│  │  Works regardless of provider (direct API,         │           │
│  │  OpenRouter, LiteLLM, etc.)                        │           │
│  │                      │                             │           │
│  │  Layer 1: JSONL Bridge                             │           │
│  │  Watches agent transcript files as they're         │           │
│  │  written. Captures user prompts, tool calls,       │           │
│  │  assistant responses.                              │           │
│  │                      │                             │           │
│  │  Layer 2: Agent Tools                              │           │
│  │  Registers tools that OpenClaw agents can call     │           │
│  │  to interact with the Synapse dashboard.           │           │
│  │                      │                             │           │
│  │                      ▼                             │           │
│  │         POST to Synapse Server (:4000)             │           │
│  └────────────────────────────────────────────────────┘           │
└─────────────────────────────────────────────────────────────────┘
```

**How it works**: The AI framework has a plugin API. Synapse registers as a plugin and gets injected directly into the framework's runtime. It can wrap provider calls (intercepting every LLM inference at the API boundary), watch transcript files from inside the process, and even register tools that agents can call back into Synapse. This is the deepest integration — Synapse lives inside the tool, not outside it.

**Synapse is EMBEDDED** — it runs as part of the tool's process. Zero latency for intercepted calls.

**Applicable when**: The tool is a framework with a plugin/extension API that allows middleware injection. OpenClaw provides this via its plugin system. Other frameworks like LangChain, CrewAI, or AutoGen could potentially support this pattern too, though they're not in scope.

### Where API Proxies Fit (OpenRouter, LiteLLM, etc.)

API proxies like OpenRouter and LiteLLM are NOT coding assistants — they're infrastructure. They sit between a tool and the LLM provider:

```
                    ┌─ Claude Code ──→ Anthropic API (direct)
                    │
User's machine ─────┼─ Gemini CLI ───→ Google API (direct)
                    │
                    ├─ Codex CLI ────→ OpenAI API (direct)
                    │
                    └─ Aider ────────→ OpenRouter ──→ any model
                      custom agent ──→ LiteLLM ────→ any model
```

**API proxies do NOT need separate adapters.** They're covered by two existing mechanisms:

1. **Tool-level adapters** (Patterns 1 & 2) capture activity regardless of which API backend the tool uses. If Aider uses OpenRouter, the file watcher still captures the same transcript data.

2. **OpenClaw's provider wrapper** (Pattern 3) intercepts at the API boundary, so it captures the actual model, tokens, and cost regardless of whether the call went through OpenRouter, LiteLLM, or a direct API.

3. **`inferVendor()` in the normalizer** already detects `openrouter/`, `groq/`, and other prefixes from model names in transcripts and tags them with the correct vendor.

The one optional enhancement would be an **OpenRouter spend poller** — a simple periodic fetch to `https://openrouter.ai/api/v1/auth/key` that pulls account-level usage stats for the Cost lens. But this is a nice-to-have, not a core integration.

### Pattern Applicability Matrix

| Tool | Pattern 1 (Hooks) | Pattern 2 (Files) | Pattern 3 (Plugin) | Recommended |
|------|:-:|:-:|:-:|---|
| **Claude Code** | Yes (12 events) | Yes (JSONL transcripts) | No | Hooks (primary) + files (retrospective) |
| **Gemini CLI** | Yes (6 events) | Yes (session JSONL) | No | Hooks (primary) + files (retrospective) |
| **Codex CLI** | Limited (notify only) | Yes (session JSONL) | No | Files (primary) + notify hook |
| **OpenClaw** | No | Yes (agent JSONL) | Yes (plugin API) | Plugin (all 3 layers) |
| **Aider** | No | Yes (Markdown + LLM log) | No | Files only |
| **Cursor** | Yes (6 hook types) | Yes (SQLite chat) | No | Hooks (future) |
| **Windsurf** | Yes (6 Cascade hooks) | Unknown | No | Hooks (future) |
| **Copilot** | No | Fragile (IDE-internal) | No | Not recommended |
| **OpenRouter** | N/A (proxy, not a tool) | N/A | Covered by Pattern 3 | No adapter needed |
| **LiteLLM** | N/A (proxy) | N/A | Covered by Pattern 3 | No adapter needed |

---

## STEP 2 — Current State Analysis

### Architecture Overview

```
┌──────────────┐   stdin JSON    ┌──────────────┐   HTTP POST    ┌──────────────┐   WebSocket    ┌──────────────┐
│  Claude Code  │ ─────────────→ │ send_event.cjs│ ─────────────→ │ Express 4000  │ ─────────────→ │  React Flow   │
│  (12 hooks)   │                └──────────────┘                │ SQLite + WS   │               │  Dashboard    │
└──────────────┘                                                  └──────────────┘               └──────────────┘
                                                                        ↑
┌──────────────┐   fs.watch + polling                                   │
│  OpenClaw     │ ─────────────→ JsonlBridge ─── POST /api/events ──────┘
│  JSONL files  │
└──────────────┘
```

### Strengths

1. **Clean event pipeline**: Hook → POST → normalize → SQLite → WebSocket → React. Well-separated concerns.
2. **Universal AgentEvent type**: Already has `vendor`, `eventSource`, `costUsd` fields. Multi-vendor ready.
3. **OpenClaw plugin proves the pattern**: JSONL file watching → normalize → POST is battle-tested.
4. **Pricing tables pre-populated**: GPT-4o, Gemini 2.0 Flash/Pro already in the pricing map.
5. **Fire-and-forget hooks**: 3-second timeout, exit 0 regardless. Never blocks the AI tool.
6. **Zod validation**: `AgentEventSchema` validates all incoming events at the API boundary.

### Weaknesses

| Issue | Severity | Impact |
|-------|----------|--------|
| **Hook script is Claude-specific** | High | `send_event.cjs` only understands Claude's field names (`hook_event_name`, `session_id`). Can't be reused for Gemini or Codex. |
| **Normalizer hardcoded to Claude** | High | `HOOK_EVENT_MAP` in eventStore.ts maps only Claude event names. Adding Gemini requires a parallel map. |
| **No plugin discovery** | Medium | OpenClaw is manually imported. No registry, no dynamic loading. Adding tools means editing server code. |
| **Fragile source detection** | Medium | `/api/events` distinguishes sources by checking `eventSource === 'openclaw'` — magic string matching. |
| **No event deduplication** | Medium | If both hooks and file watchers capture the same event (e.g., after a Claude Code session also produces a JSONL transcript), duplicates appear. |
| **Process-per-hook overhead** | Low | Each hook spawns `node hooks/send_event.cjs` — a new Node.js process. Acceptable for single-tool, but 3 tools × 12 events = 36 process spawns per session. |
| **No session correlation** | Low | No way to link a Claude session and Gemini session working on the same project directory. |
| **fs.watch unreliable on Windows** | Low | Mitigated by polling fallback (5s interval), but adds latency for file-based integrations. |

### Bottlenecks

- **SQLite single-writer**: Concurrent POSTs from multiple tools could contend. SQLite's WAL mode (already enabled in db.ts) handles this, but under heavy load (3+ tools, 10+ events/sec) write latency may spike.
- **No batching**: Each event = 1 HTTP request. With 3 tools running concurrently, the server may receive 30-50 requests per minute.

### Technical Debt

- Duplicate pricing tables in `openclawJsonl.ts` and `providerWrapper.ts`.
- `AgentEvent` interface mixed with React Flow concerns (it should be pure data).
- `rowToAgentEvent` re-parses `raw_payload` JSON to recover fields that should have been stored in dedicated columns.

---

## STEP 3 — Three Implementation Plans

### Plan A: Lightweight Plugin Adapters (RECOMMENDED)

#### Architecture

```
packages/
├── core/                    # Shared types, schemas, pricing (exists)
├── server/                  # Express + WS backend (exists)
├── openclaw/                # OpenClaw integration (exists)
├── adapter-claude/          # NEW — Claude Code hook script + normalizer
├── adapter-gemini/          # NEW — Gemini CLI hook script + normalizer
├── adapter-codex/           # NEW — Codex CLI file watcher + normalizer
└── adapter-common/          # NEW — Shared hook script runtime, file watcher base
```

Each adapter package contains:

```
packages/adapter-gemini/
├── package.json
├── src/
│   ├── index.ts             # Exports normalizer + setup instructions
│   ├── normalizer.ts        # Maps Gemini events → AgentEvent
│   └── fileWatcher.ts       # Watches ~/.gemini/tmp/*/chats/*.jsonl (optional)
├── hooks/
│   └── send_event.cjs       # Hook script for .gemini/settings.json
└── README.md                # Setup instructions for users
```

#### How It Works

**Real-time (Hook-based):**

1. User copies hook script into their Gemini CLI project or references it from `.gemini/settings.json`
2. Gemini fires hook → JSON on stdin → `hooks/send_event.cjs` → POST `localhost:4000/api/events`
3. Server detects source from payload shape (Gemini sends `hook_event_name` + `tool_name` like Claude, but with different event names like `BeforeTool` vs `PreToolUse`)
4. Server routes to the correct normalizer based on payload heuristics
5. Normalizer maps to `AgentEvent` → SQLite → WebSocket → Dashboard

**Retrospective (File-based):**

1. Server-side file watcher monitors known locations (`~/.gemini/tmp/`, `~/.codex/sessions/`)
2. Incrementally reads new JSONL lines (same pattern as JsonlBridge)
3. Normalizer converts transcript lines → `AgentEvent[]`
4. Events stored and broadcast

**Source Detection Logic (replaces magic string matching):**

```typescript
function detectSource(raw: Record<string, unknown>): 'claude' | 'gemini' | 'codex' | 'openclaw' | 'unknown' {
  // Pre-normalized OpenClaw events
  if (raw.eventSource === 'openclaw') return 'openclaw';

  const hookName = raw.hook_event_name as string;

  // Claude Code uses: SessionStart, PreToolUse, SubagentStart, etc.
  if (hookName && CLAUDE_EVENT_NAMES.has(hookName)) return 'claude';

  // Gemini CLI uses: SessionStart, BeforeTool, AfterTool, BeforeModel, etc.
  if (hookName && GEMINI_EVENT_NAMES.has(hookName)) return 'gemini';

  // Codex CLI notify events
  if (raw.type === 'agent-turn-complete') return 'codex';

  return 'unknown';
}
```

#### Reasoning

- Mirrors the proven Claude Code pattern (hook script → POST → normalize)
- Gemini CLI's hook system is nearly identical to Claude's — same stdin JSON, same command hooks
- Each adapter is independently testable and deployable
- Adding a new tool = adding a new package, not editing server code
- File watchers provide coverage for tools without hooks (Codex CLI)
- Users opt-in per tool (copy hook config, enable file watcher)

#### Tradeoffs

| Pro | Con |
|-----|-----|
| Simple, proven pattern | Each tool needs its own setup steps |
| Independent packages, easy to add tools | Source detection heuristics can have edge cases |
| Real-time + retrospective | File watchers add some latency (100-500ms) |
| No new dependencies | Multiple hook scripts to maintain |
| Works on Windows (HTTP POST, no Unix-specific IPC) | |

#### Complexity: LOW-MEDIUM

#### Performance

- Hook scripts: <100ms per invocation (same as current Claude hooks)
- File watchers: 100-500ms latency depending on fs.watch reliability
- Server: Handles 50+ events/sec easily (SQLite WAL mode + simple inserts)
- WebSocket: Broadcast is O(clients), typically 1-3

#### Failure Modes

- Hook script fails → event lost (fire-and-forget, same as current behavior)
- File watcher misses an fs.watch event → polling fallback catches it within 5s
- Server down → hooks silently fail (3s timeout), events recoverable from JSONL files later
- Malformed event → Zod validation rejects at API boundary

#### Operational Concerns

- Users must configure hooks per-tool manually (mitigated by setup scripts/README)
- File watcher paths are platform-specific (need Windows/Mac/Linux defaults)
- Hook scripts must not block the AI tool (enforced by 3s timeout)

#### Best Choice When

This is the right plan when you want to ship incrementally, starting with one tool at a time, with minimal architectural changes.

---

### Plan B: Universal Adapter with Schema Mapping

#### Architecture

Instead of per-tool normalizer code, use declarative JSON mapping files:

```
packages/adapter-universal/
├── mappings/
│   ├── claude.json          # Declarative field mapping for Claude events
│   ├── gemini.json          # Declarative field mapping for Gemini events
│   └── codex.json           # Declarative field mapping for Codex events
├── src/
│   ├── mapper.ts            # Generic event mapper driven by JSON configs
│   ├── fileWatcher.ts       # Generic file watcher with configurable paths
│   └── detector.ts          # Source detection using mapping configs
└── hooks/
    └── universal_hook.cjs   # Single hook script that self-configures from env
```

Example mapping file:

```json
{
  "vendor": "google",
  "eventSource": "gemini",
  "eventMap": {
    "SessionStart": "session_start",
    "SessionEnd": "session_end",
    "BeforeTool": "tool_start",
    "AfterTool": "tool_end"
  },
  "fieldMap": {
    "sessionId": ["session_id"],
    "toolName": ["tool_name"],
    "toolInput": ["tool_input"],
    "toolResponse": ["tool_response.llmContent"],
    "model": ["llm_request.model"],
    "text": ["tool_response.returnDisplay", "content"]
  },
  "sessionFilePaths": [
    "~/.gemini/tmp/*/chats/*.jsonl"
  ]
}
```

#### Reasoning

- Adding a new tool = adding a JSON mapping file, no code changes
- Single hook script configures itself based on which tool is calling it
- Centralized source detection driven by mapping configs

#### Tradeoffs

| Pro | Con |
|-----|-----|
| Zero-code tool additions | Complex field mapping logic (nested paths, arrays, conditionals) |
| Single hook script to maintain | Mapping language must handle edge cases (cumulative tokens, status inference) |
| Self-documenting mappings | Harder to debug than imperative normalizer code |
| | Over-engineering for 3 tools |

#### Complexity: MEDIUM-HIGH

#### Performance

Same as Plan A — the mapping layer adds negligible overhead.

#### Failure Modes

Same as Plan A, plus: malformed mapping files cause silent data loss if a field path doesn't resolve.

#### Best Choice When

You expect to add 5+ tools and want contributors to add tools without writing TypeScript. Not justified for 3 tools.

---

### Plan C: Sidecar Processes Per Tool

#### Architecture

Each tool integration runs as its own long-lived process:

```
┌──────────────┐         ┌─────────────────┐
│  Claude Code  │ ──hook──→ claude-sidecar   │──┐
└──────────────┘         └─────────────────┘  │
                                               │  WebSocket
┌──────────────┐         ┌─────────────────┐  │  or gRPC
│  Gemini CLI   │ ──hook──→ gemini-sidecar   │──┼──→ Synapse Server
└──────────────┘         └─────────────────┘  │
                                               │
┌──────────────┐         ┌─────────────────┐  │
│  Codex CLI    │ ──file──→ codex-sidecar    │──┘
└──────────────┘         └─────────────────┘
```

Each sidecar:
- Runs as a persistent Node.js process
- Handles hook reception OR file watching for its tool
- Normalizes events locally
- Pushes normalized `AgentEvent` objects to the Synapse server via WebSocket

#### Reasoning

- Maximum isolation — a bug in the Gemini normalizer can't crash the Claude pipeline
- Each sidecar can buffer events during server downtime and replay when reconnected
- Sidecars can be started/stopped independently

#### Tradeoffs

| Pro | Con |
|-----|-----|
| Process isolation | 4+ processes to manage (server + 3 sidecars) |
| Independent lifecycle | Complex startup orchestration |
| Event buffering on disconnect | Memory overhead per process |
| | Overkill for a personal dev tool |

#### Complexity: HIGH

#### Performance

Better than Plan A under load (sidecars can batch events), worse for startup (multiple processes).

#### Failure Modes

- Sidecar crashes → events for that tool stop until restart
- Server goes down → sidecars buffer (if implemented), but memory grows
- Sidecar-server protocol mismatch → silent data loss

#### Best Choice When

You're building for a team/enterprise deployment with strict isolation requirements. Not justified for a personal developer tool.

---

## STEP 4 — Recommendation

### Selected: Plan A — Lightweight Plugin Adapters

**Why Plan A wins:**

1. **Lowest complexity** for the value delivered. Adding Gemini CLI is nearly copy-paste of the Claude hook pattern.
2. **Proven pattern** — the Claude Code integration has been running in production. Same architecture, different normalizer.
3. **Incremental** — ship Gemini first, then Codex, without touching Claude's integration.
4. **No new infrastructure** — same Express server, same SQLite, same WebSocket broadcast.
5. **Personal dev tool scale** — no need for process isolation or declarative mapping languages.

### Implementation Order

#### Phase 1: Shared Infrastructure (1 session)

**Goal**: Extract Claude-specific code from the server into an adapter, create shared utilities.

1. **Create `packages/adapter-common/`**
   - Shared hook script runtime (HTTP POST with timeout, debug logging)
   - Shared file watcher base class (extracted from JsonlBridge)
   - Shared pricing table (deduplicate from openclaw)
   - Platform-aware default paths (`~/.gemini/`, `~/.codex/`, etc.)

2. **Create `packages/adapter-claude/`**
   - Move `HOOK_EVENT_MAP` and `normalizeHookPayload()` from `eventStore.ts` into this package
   - Move `hooks/send_event.cjs` into this package
   - Export: `normalizeClaudeHook(raw) → AgentEvent`

3. **Refactor server event routing**
   - Replace hardcoded Claude normalization with a registry pattern:
   ```typescript
   // packages/server/src/services/adapterRegistry.ts
   interface Adapter {
     id: string;
     vendor: string;
     detect(raw: Record<string, unknown>): boolean;
     normalize(raw: Record<string, unknown>): AgentEvent;
   }

   class AdapterRegistry {
     private adapters: Adapter[] = [];
     register(adapter: Adapter): void { ... }
     resolve(raw: Record<string, unknown>): Adapter | null { ... }
   }
   ```
   - Register Claude adapter at startup
   - `POST /api/events` uses `registry.resolve(raw)` instead of hardcoded logic

4. **Tests**
   - Unit tests for Claude normalizer (extract existing behavior into test fixtures)
   - Unit test for adapter registry (detect + normalize)

#### Phase 2: Gemini CLI Integration (1 session)

**Goal**: Full Gemini CLI monitoring via hooks + optional file watcher.

1. **Create `packages/adapter-gemini/`**

   **Hook script** (`hooks/send_event.cjs`):
   - Reads JSON from Gemini CLI stdin
   - Maps Gemini fields to a normalized payload
   - POST to `localhost:4000/api/events`
   - Fire-and-forget with 3s timeout

   **Normalizer** (`src/normalizer.ts`):
   ```typescript
   const GEMINI_EVENT_MAP: Record<string, AgentEventType> = {
     SessionStart: 'session_start',
     SessionEnd: 'session_end',
     BeforeModel: 'user_prompt',      // Contains the full LLM request
     BeforeTool: 'tool_start',
     AfterTool: 'tool_end',
     BeforeToolSelection: 'notification',  // Informational only
   };
   ```

   **Field mapping (Gemini → AgentEvent)**:

   | Gemini Field | AgentEvent Field | Notes |
   |---|---|---|
   | `session_id` | `sessionId` | Direct map |
   | `hook_event_name` | → type lookup | Via GEMINI_EVENT_MAP |
   | `tool_name` | `toolName` | Direct map |
   | `tool_input` | `toolInput` | Direct map |
   | `tool_response.llmContent` | `toolResponse` | Nested extraction |
   | `tool_response.error` | `error` | On AfterTool |
   | `llm_request.model` | `model` | On BeforeModel |
   | `llm_request.messages` | `text` | Last user message text |
   | `cwd` | `cwd` | Direct map |
   | `timestamp` | `timestamp` | ISO → Unix ms |

   **File watcher** (`src/fileWatcher.ts`):
   - Watches `~/.gemini/tmp/*/chats/*.jsonl`
   - Platform-aware path resolution
   - Reuses `adapter-common` base class

   **Detection logic**:
   ```typescript
   detect(raw: Record<string, unknown>): boolean {
     const hookName = raw.hook_event_name as string;
     return GEMINI_EVENT_NAMES.has(hookName)
       && !CLAUDE_ONLY_EVENTS.has(hookName);  // e.g., SubagentStart, PreToolUse
   }
   ```

   Gemini and Claude share `SessionStart`/`SessionEnd` event names. Disambiguation:
   - Claude sends `SubagentStart`/`SubagentStop` (Gemini doesn't have subagents)
   - Claude sends `PreToolUse`/`PostToolUse` (Gemini uses `BeforeTool`/`AfterTool`)
   - Claude sends `agent_id` field (Gemini doesn't)
   - Fallback: check for `llm_request` field (Gemini-only on BeforeModel)

2. **Setup automation**

   A script or CLI command that:
   - Detects if Gemini CLI is installed (`which gemini` / `where gemini`)
   - Generates the correct `.gemini/settings.json` hook configuration
   - Points hook commands to the adapter's `send_event.cjs`
   - Validates the configuration

3. **Tests**
   - Fixture-based tests: sample Gemini hook payloads → expected AgentEvents
   - Integration test: simulate Gemini hook → verify event appears in SQLite

#### Phase 3: Codex CLI Integration (1 session)

**Goal**: Codex CLI monitoring via file watching + notify hook.

1. **Create `packages/adapter-codex/`**

   **Notify hook** (limited — only `agent-turn-complete`):
   - Codex passes JSON as a CLI argument, not stdin
   - Hook script extracts the argument, POSTs to Synapse
   - Configured in `~/.codex/config.toml`:
     ```toml
     notify = ["node", "path/to/send_event.cjs"]
     ```

   **File watcher** (primary integration):
   - Watches `~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl`
   - Discovers new date directories dynamically
   - Incrementally tails JSONL files (same offset-tracking pattern as JsonlBridge)

   **Normalizer** (`src/normalizer.ts`):

   Codex JSONL has multiple event schemas:

   ```typescript
   function normalizeCodexLine(line: Record<string, unknown>): AgentEvent[] {
     // Variant 1: event_msg wrapper
     if (line.type === 'event_msg' && line.payload) {
       const payload = line.payload as Record<string, unknown>;
       switch (payload.type) {
         case 'user_message':
           return [{ type: 'user_prompt', text: payload.message, ... }];
         case 'token_count':
           // IMPORTANT: Codex token counts are CUMULATIVE
           // Must subtract previous count to get delta
           return [{ type: 'result', tokenUsage: computeDelta(payload), ... }];
         case 'turn_context':
           return [{ type: 'session_start', model: payload.model, ... }];
       }
     }

     // Variant 2: direct role-based messages
     if (line.role === 'user') {
       return [{ type: 'user_prompt', text: line.content, ... }];
     }
     if (line.role === 'assistant') {
       // May contain tool_use blocks (same as Anthropic format)
       return normalizeAssistantMessage(line);
     }

     return [];
   }
   ```

   **Key Codex quirks**:
   - Token counts are cumulative (must diff against previous to get per-turn)
   - Session files are organized by date (`YYYY/MM/DD/`)
   - Session ID comes from filename (`rollout-<uuid>.jsonl`)
   - No subagent concept — flat session model
   - `approval_policy` in turn_context maps to permissionMode

   **Detection logic**:
   ```typescript
   detect(raw: Record<string, unknown>): boolean {
     // Codex notify hook events
     if (raw.type === 'agent-turn-complete') return true;
     // File-watcher pre-normalized events
     if (raw.eventSource === 'codex') return true;
     return false;
   }
   ```

2. **Setup automation**

   A script that:
   - Detects Codex CLI installation
   - Adds notify configuration to `~/.codex/config.toml`
   - Configures file watcher paths in Synapse

3. **Tests**
   - Sample Codex JSONL lines → expected AgentEvents
   - Cumulative token count delta computation
   - Date-hierarchical directory discovery

#### Phase 4: Dashboard Enhancements (1 session)

**Goal**: UI updates to surface multi-vendor data.

1. **Vendor badge on nodes** — small colored icon showing which tool produced each node (Claude=orange, Gemini=blue, Codex=green)
2. **Session filtering by vendor** — filter sidebar to show only sessions from a specific tool
3. **Cross-tool timeline** — unified timeline showing events from all tools interleaved by timestamp
4. **Vendor in Cost lens** — break down costs by tool in the cost waterfall
5. **Setup status indicator** — header badge showing which adapters are active (detecting hooks/file watchers)

---

## Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Gemini CLI hook format changes | Medium | High | Pin to specific Gemini CLI version in docs. Normalizer handles unknown fields gracefully. |
| Codex CLI JSONL format changes | Medium | Medium | File watcher skips unparseable lines. Normalizer has fallback paths for multiple schemas. |
| Event deduplication (hooks + file watcher both fire) | Low | Low | Dedup by `toolUseId` + `timestamp` within a 1-second window. |
| Colliding session IDs across tools | Low | High | Prefix session IDs with vendor: `claude-<id>`, `gemini-<id>`, `codex-<id>`. |
| fs.watch misses events on Windows | Medium | Low | Polling fallback (5s interval) already implemented. |
| User doesn't configure hooks correctly | Medium | Medium | Provide `synapse setup gemini` CLI command. Validate config on startup. |

---

## Testing Strategy

1. **Unit tests per adapter**: Fixture-based. Sample raw payloads → expected `AgentEvent[]`. Test edge cases (missing fields, unknown event types, malformed JSON).
2. **Integration tests**: Spawn Synapse server → POST sample events → verify SQLite rows and WebSocket messages.
3. **End-to-end simulation**: Like the existing `simulate_session.ts`, but with multi-vendor payloads interleaved.
4. **Manual validation**: Run Gemini CLI and Claude Code side-by-side, verify both appear in the dashboard.

---

## Monitoring & Observability

- **Adapter health endpoint**: `GET /api/adapters` returns `{ claude: { lastEvent: timestamp }, gemini: { lastEvent: timestamp }, codex: { lastEvent: timestamp } }`
- **Event rate logging**: Log events/sec per vendor (already have pino logger)
- **Validation error counter**: Track how many events fail Zod validation (indicates format changes)
- **File watcher lag metric**: Time between file modification and event broadcast

---

## Migration Strategy

1. Phase 1 is a pure refactor — no behavior change. Claude integration continues working identically.
2. Phase 2 adds Gemini without affecting Claude. Users opt-in by configuring Gemini hooks.
3. Phase 3 adds Codex without affecting Claude or Gemini.
4. Phase 4 is additive UI work.

Each phase is independently shippable. No breaking changes between phases.

---

## File Changes Summary

### Phase 1 (Shared Infrastructure)

| Action | Path | Description |
|--------|------|-------------|
| CREATE | `packages/adapter-common/package.json` | Shared utilities package |
| CREATE | `packages/adapter-common/src/hookRuntime.ts` | HTTP POST with timeout, debug logging |
| CREATE | `packages/adapter-common/src/fileWatcherBase.ts` | Base class for JSONL file watching |
| CREATE | `packages/adapter-common/src/pricing.ts` | Consolidated pricing table |
| CREATE | `packages/adapter-common/src/platforms.ts` | Platform-aware default paths |
| CREATE | `packages/adapter-claude/package.json` | Claude adapter package |
| CREATE | `packages/adapter-claude/src/normalizer.ts` | Extracted from eventStore.ts |
| CREATE | `packages/adapter-claude/src/index.ts` | Exports normalizer + detection |
| MOVE | `hooks/send_event.cjs` → `packages/adapter-claude/hooks/send_event.cjs` | (keep symlink/copy at root for backwards compat) |
| CREATE | `packages/server/src/services/adapterRegistry.ts` | Plugin registry |
| MODIFY | `packages/server/src/services/eventStore.ts` | Remove hardcoded normalization, use registry |
| MODIFY | `packages/server/src/routes/events.ts` | Use registry.resolve() |
| MODIFY | `pnpm-workspace.yaml` | Add new packages |

### Phase 2 (Gemini CLI)

| Action | Path | Description |
|--------|------|-------------|
| CREATE | `packages/adapter-gemini/package.json` | Gemini adapter package |
| CREATE | `packages/adapter-gemini/src/normalizer.ts` | Gemini event → AgentEvent |
| CREATE | `packages/adapter-gemini/src/detector.ts` | Gemini payload detection |
| CREATE | `packages/adapter-gemini/src/fileWatcher.ts` | Watch ~/.gemini/tmp/*/chats/ |
| CREATE | `packages/adapter-gemini/src/index.ts` | Exports |
| CREATE | `packages/adapter-gemini/hooks/send_event.cjs` | Hook script for .gemini/settings.json |
| MODIFY | `packages/server/src/index.ts` | Register Gemini adapter |

### Phase 3 (Codex CLI)

| Action | Path | Description |
|--------|------|-------------|
| CREATE | `packages/adapter-codex/package.json` | Codex adapter package |
| CREATE | `packages/adapter-codex/src/normalizer.ts` | Codex JSONL → AgentEvent |
| CREATE | `packages/adapter-codex/src/detector.ts` | Codex payload detection |
| CREATE | `packages/adapter-codex/src/fileWatcher.ts` | Watch ~/.codex/sessions/ |
| CREATE | `packages/adapter-codex/src/tokenTracker.ts` | Cumulative → delta token conversion |
| CREATE | `packages/adapter-codex/src/index.ts` | Exports |
| CREATE | `packages/adapter-codex/hooks/send_event.cjs` | Notify hook script |
| MODIFY | `packages/server/src/index.ts` | Register Codex adapter |

### Phase 4 (Dashboard)

| Action | Path | Description |
|--------|------|-------------|
| CREATE | `apps/dashboard/src/components/graph/VendorBadge.tsx` | Vendor icon component |
| MODIFY | `apps/dashboard/src/components/graph/nodes/*.tsx` | Add vendor badges |
| MODIFY | `apps/dashboard/src/store/agentStore.ts` | Add vendor filter state |
| MODIFY | `apps/dashboard/src/components/layout/Sidebar.tsx` | Add vendor filter controls |
| CREATE | `apps/dashboard/src/components/panels/AdapterStatus.tsx` | Active adapter indicator |
