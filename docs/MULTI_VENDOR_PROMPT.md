# Multi-Vendor Adapter Implementation Prompt

> Copy-paste this into a fresh Claude Code session in the Synapse project directory.
> Reference: `docs/MULTI_VENDOR_PLAN.md`, `docs/GEMINI_INTEGRATION.md`, `docs/CODEX_INTEGRATION.md`

---

## System Context

You are implementing a multi-vendor adapter system for **Synapse**, an interactive agent orchestration dashboard. Synapse currently monitors only Claude Code sessions. You will extend it to also monitor **Gemini CLI** and **OpenAI Codex CLI** sessions.

**Working directory**: `c:\Workspace\Coding\Prototypes\Synapse`
**Branch**: `feat/monorepo-v3` (already checked out)

**Read these documents first** (in order):
1. `CLAUDE.md` — Project conventions
2. `docs/MULTI_VENDOR_PLAN.md` — Full plan with phases, architecture, file changes, risk assessment
3. `docs/GEMINI_INTEGRATION.md` — Gemini CLI hook format, JSON schemas, normalizer pseudocode
4. `docs/CODEX_INTEGRATION.md` — Codex CLI JSONL format, schemas, token tracking quirks
5. `docs/CODEX_FORMATS.md` — Detailed Codex file format reference (all event types, MCP wire protocol)
6. `docs/ARCHITECTURE.md` — Existing system design

---

## Key Conventions

- TypeScript strict mode everywhere
- Zod for runtime validation at system boundaries
- No `any` types — use `unknown` and narrow
- `pino` for server logging
- Hook scripts are `.cjs` (CommonJS, zero dependencies)
- Hook scripts MUST exit within 3 seconds, NEVER block the AI tool
- Session IDs MUST be prefixed with vendor: `claude-<id>`, `gemini-<id>`, `codex-<id>`
- npm scope is `@synapse-ai`
- Tests use Vitest

---

## What Already Exists

The project is a pnpm monorepo:

```
packages/
├── core/           # @synapse-ai/core — AgentEvent type, Zod schemas, pricing
├── server/         # @synapse-ai/server — Express + SQLite + WebSocket (port 4000)
├── openclaw/       # @synapse-ai/openclaw — OpenClaw plugin (JSONL file watcher, reference impl)
apps/
├── dashboard/      # React frontend (Vite, port 5173)
hooks/
├── send_event.cjs  # Claude Code hook script
```

Current event pipeline: Claude Code hook → `send_event.cjs` → POST `/api/events` → `normalizeHookPayload()` in `eventStore.ts` → SQLite → WebSocket → React Flow

The `AgentEvent` type already has: `vendor`, `eventSource`, `costUsd` fields. Pricing tables already include GPT-4o and Gemini models. No changes needed to the core type.

---

## Execution Order

Execute phases sequentially. Each phase has a verification gate.

### Phase 1: Shared Infrastructure + Claude Adapter Extraction

**Goal**: Extract Claude-specific code from the server into a dedicated adapter. Create shared utilities. Introduce the adapter registry pattern.

#### Step 1.1: Create `packages/adapter-common/`

```
packages/adapter-common/
├── package.json        # @synapse-ai/adapter-common
├── tsconfig.json
├── src/
│   ├── index.ts
│   ├── hookRuntime.ts  # HTTP POST with timeout + debug logging
│   ├── fileWatcherBase.ts  # Base class for JSONL file watchers
│   ├── pricing.ts      # Consolidated pricing table (deduplicate from openclaw)
│   └── platforms.ts    # Platform-aware paths (~/.gemini/, ~/.codex/, etc.)
```

- `hookRuntime.ts`: Extract the POST-with-timeout logic from `hooks/send_event.cjs` into a reusable function. This is for the TypeScript side (file watchers posting events), not for the CJS hook scripts themselves.
- `fileWatcherBase.ts`: Extract common patterns from `packages/openclaw/src/layers/jsonlBridge.ts` — offset tracking, JSONL line parsing, debounced file watching with polling fallback. Make it a base class that tool-specific watchers extend.
- `pricing.ts`: Merge the duplicate pricing tables from `packages/openclaw/src/normalizers/openclawJsonl.ts` and `packages/openclaw/src/layers/providerWrapper.ts`. Export a single `estimateCost(model, inputTokens, outputTokens)` function. Include: claude-opus-4-6, claude-sonnet-4-5, claude-haiku-4-5, gpt-4o, gpt-4o-mini, gpt-4-turbo, o3, o3-mini, o4-mini, gemini-2.5-pro, gemini-2.0-flash, gemini-2.0-pro.
- `platforms.ts`: Export functions like `geminiSessionsDir()`, `codexSessionsDir()`, `claudeTranscriptsDir()` that return platform-correct paths.

#### Step 1.2: Create `packages/adapter-claude/`

```
packages/adapter-claude/
├── package.json        # @synapse-ai/adapter-claude
├── tsconfig.json
├── src/
│   ├── index.ts
│   ├── normalizer.ts   # MOVED from packages/server/src/services/eventStore.ts
│   └── detector.ts     # Detects Claude-specific event payloads
├── hooks/
│   └── send_event.cjs  # COPIED from hooks/send_event.cjs
└── __tests__/
    └── normalizer.test.ts
```

- Move `HOOK_EVENT_MAP` and `normalizeHookPayload()` from `packages/server/src/services/eventStore.ts` into `normalizer.ts`
- Create `detector.ts` with a `detect(raw): boolean` that returns true for Claude-specific hook payloads
- Write unit tests: at least 5 fixture-based tests covering SessionStart, PreToolUse, PostToolUse, SubagentStart, UserPromptSubmit
- Keep `hooks/send_event.cjs` at the root too (backwards compat)

#### Step 1.3: Create adapter registry

Create `packages/server/src/services/adapterRegistry.ts`:

```typescript
import type { AgentEvent } from '@synapse-ai/core';

export interface Adapter {
  id: string;           // 'claude', 'gemini', 'codex'
  vendor: string;       // 'anthropic', 'google', 'openai'
  detect(raw: Record<string, unknown>): boolean;
  normalize(raw: Record<string, unknown>): AgentEvent;
}

export class AdapterRegistry {
  private adapters: Adapter[] = [];

  register(adapter: Adapter): void {
    this.adapters.push(adapter);
  }

  resolve(raw: Record<string, unknown>): Adapter | null {
    // Pre-normalized events (openclaw, file-watcher sourced) bypass detection
    if (raw.eventSource && raw.id && raw.type && raw.sessionId) return null;

    for (const adapter of this.adapters) {
      if (adapter.detect(raw)) return adapter;
    }
    return null;
  }
}
```

#### Step 1.4: Refactor eventStore.ts

In `packages/server/src/services/eventStore.ts`:
- Remove `HOOK_EVENT_MAP`, `HOOK_EVENT_NAMES`, and `normalizeHookPayload()` (moved to adapter-claude)
- Modify `storeAndBroadcast()` to accept an `AdapterRegistry` parameter
- Use `registry.resolve(raw)` to find the right normalizer
- If `resolve()` returns null, treat as pre-normalized event (call `storePreNormalized`)
- If `resolve()` returns an adapter, call `adapter.normalize(raw)` then store and broadcast

#### Step 1.5: Update server startup

In `packages/server/src/index.ts`:
- Import `AdapterRegistry` and Claude adapter
- Create registry instance, register Claude adapter
- Pass registry to event store / routes

#### Step 1.6: Update pnpm-workspace.yaml

Add `packages/adapter-common` and `packages/adapter-claude` to the workspace.

**GATE**: Run `npx tsx scripts/simulate_session.ts` → events appear correctly in SQLite with `vendor: 'anthropic'`. The refactoring is transparent — no behavior change.

---

### Phase 2: Gemini CLI Adapter

**Goal**: Full Gemini CLI monitoring via hook scripts + file watcher.

#### Step 2.1: Create `packages/adapter-gemini/`

```
packages/adapter-gemini/
├── package.json        # @synapse-ai/adapter-gemini
├── tsconfig.json
├── src/
│   ├── index.ts
│   ├── normalizer.ts
│   ├── detector.ts
│   └── fileWatcher.ts
├── hooks/
│   └── send_event.cjs
└── __tests__/
    └── normalizer.test.ts
```

#### Step 2.2: Implement normalizer

See `docs/GEMINI_INTEGRATION.md` for the full mapping table and pseudocode. Key points:

- Gemini event map: `{ SessionStart: 'session_start', SessionEnd: 'session_end', BeforeModel: 'user_prompt', BeforeTool: 'tool_start', AfterTool: 'tool_end', BeforeToolSelection: 'notification' }`
- Session ID: `gemini-${raw.session_id}`
- Vendor: `'google'`
- BeforeModel events contain `llm_request.model` — extract model name
- BeforeModel events contain `llm_request.messages` — extract last user message as `text`
- AfterTool events contain `tool_response.llmContent` — map to `toolResponse`
- AfterTool events with `tool_response.error` — map to `tool_error` type
- Timestamp: ISO 8601 string → Unix ms

#### Step 2.3: Implement detector

```typescript
const GEMINI_ONLY_EVENTS = new Set(['BeforeModel', 'BeforeTool', 'AfterTool', 'BeforeToolSelection']);

export function detect(raw: Record<string, unknown>): boolean {
  const hookName = raw.hook_event_name as string;
  if (!hookName) return false;
  if (GEMINI_ONLY_EVENTS.has(hookName)) return true;
  // Shared events: check transcript_path for .gemini
  if (hookName === 'SessionStart' || hookName === 'SessionEnd') {
    const tp = raw.transcript_path as string;
    return !!tp && tp.includes('.gemini');
  }
  return false;
}
```

#### Step 2.4: Implement hook script

`hooks/send_event.cjs` — reads JSON from stdin (same as Claude), POSTs to Synapse. Nearly identical to Claude's hook script. The server-side adapter registry handles normalization.

#### Step 2.5: Implement file watcher

Extend `FileWatcherBase` from adapter-common. Watch `~/.gemini/tmp/*/chats/*.jsonl`. Parse session metadata, user messages, model messages, tool results.

#### Step 2.6: Register adapter and write simulation

- Register in `packages/server/src/index.ts`
- Create `scripts/simulate_gemini.ts` that POSTs sample events: SessionStart → BeforeModel → BeforeTool (read_file) → AfterTool → BeforeTool (write_file) → AfterTool → SessionEnd

#### Step 2.7: Tests

- 6+ fixture tests: SessionStart, SessionEnd, BeforeModel, BeforeTool, AfterTool (success), AfterTool (error)
- Detection test: verify detector correctly identifies Gemini vs Claude events

**GATE**: Run `npx tsx scripts/simulate_gemini.ts` → events appear in SQLite with `vendor: 'google'`. Run alongside Claude simulation → both vendors visible in the same query.

---

### Phase 3: Codex CLI Adapter

**Goal**: Codex CLI monitoring via file watching + limited notify hook.

#### Step 3.1: Create `packages/adapter-codex/`

```
packages/adapter-codex/
├── package.json        # @synapse-ai/adapter-codex
├── tsconfig.json
├── src/
│   ├── index.ts
│   ├── normalizer.ts
│   ├── detector.ts
│   ├── tokenTracker.ts
│   └── fileWatcher.ts
├── hooks/
│   └── send_event.cjs   # Notify hook (reads argv, NOT stdin!)
└── __tests__/
    ├── normalizer.test.ts
    └── tokenTracker.test.ts
```

#### Step 3.2: Implement tokenTracker

**CRITICAL**: Codex reports CUMULATIVE token counts, not per-turn deltas.

```typescript
export class TokenTracker {
  private lastCounts = new Map<string, { input: number; output: number }>();

  computeDelta(sessionId: string, cumulative: { input: number; output: number }): { input: number; output: number } {
    const prev = this.lastCounts.get(sessionId) ?? { input: 0, output: 0 };
    const delta = {
      input: Math.max(0, cumulative.input - prev.input),
      output: Math.max(0, cumulative.output - prev.output),
    };
    this.lastCounts.set(sessionId, { ...cumulative });
    return delta;
  }

  reset(sessionId: string): void {
    this.lastCounts.delete(sessionId);
  }
}
```

#### Step 3.3: Implement normalizer

See `docs/CODEX_INTEGRATION.md` and `docs/CODEX_FORMATS.md` for full schemas. Key points:

- Handle BOTH `event_msg` wrapper format AND direct `role`-based messages
- Session ID: `codex-${uuid}` extracted from filename
- Vendor: `'openai'`
- `turn_context` payload → `session_start` with model name
- `user_message` payload → `user_prompt`
- `token_count` payload → `result` with DELTA token usage (via TokenTracker)
- Direct `role: assistant` with `tool_use` content blocks → `tool_start`
- Direct `role: tool` → `tool_end`

#### Step 3.4: Implement file watcher

Extend `FileWatcherBase`. Key differences from Gemini:
- Date-hierarchical directory: `~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl`
- Must discover new date directories as they're created
- Watch today's directory actively, poll older directories less frequently
- Session ID from filename: `rollout-<uuid>.jsonl` → `codex-<uuid-prefix>`

#### Step 3.5: Implement notify hook

**DIFFERENT from Claude/Gemini**: Codex passes JSON as a CLI argument, not stdin.

```javascript
#!/usr/bin/env node
const SERVER_URL = process.env.SYNAPSE_URL || 'http://localhost:4000/api/events';
async function main() {
  const jsonArg = process.argv[process.argv.length - 1];
  if (!jsonArg) return;
  try {
    const payload = JSON.parse(jsonArg);
    const event = {
      eventSource: 'codex',
      vendor: 'openai',
      type: 'result',
      sessionId: `codex-${payload['thread-id']}`,
      text: payload['last-assistant-message']?.slice(0, 2000),
      timestamp: Date.now(),
    };
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 3000);
    await fetch(SERVER_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(event),
      signal: controller.signal,
    });
  } catch { /* fire and forget */ }
}
main().then(() => process.exit(0));
```

#### Step 3.6: Register adapter and write simulation

- Register in `packages/server/src/index.ts`
- Create `scripts/simulate_codex.ts` that writes sample JSONL to a temp file and triggers the file watcher

#### Step 3.7: Tests

- 8+ normalizer tests: event_msg user_message, event_msg token_count (verify delta not cumulative), event_msg turn_context, direct role:user, direct role:assistant with tool_use, direct role:tool, mixed formats
- TokenTracker tests: single session, multiple sessions, reset, zero delta

**GATE**: Run simulation → events appear with `vendor: 'openai'`. Token usage shows correct deltas. All three vendors coexist in the database.

---

## Do NOT

- Modify `AgentEvent` type in `packages/core/src/types/agent.ts` (it already has all needed fields)
- Modify the React frontend (dashboard changes are Phase 4, not in this prompt)
- Use `any` type anywhere
- Use `console.log` in server code (use pino)
- Add unnecessary dependencies
- Create adapters for tools not specified (Cursor, Windsurf, Aider — those come later)
- Break backwards compatibility with existing Claude Code hooks
