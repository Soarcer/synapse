# Synapse — Implementation Plan

> Based on [REVIEW_FINDINGS.md](./REVIEW_FINDINGS.md)
> Scope: All issues (critical + major + minor + architecture), full test suite, UX (a11y + responsive + onboarding)
> Deploy target: VS Code extension + local dev

---

## Phase 1: Foundation — CI Pipeline & Testing Infrastructure

**Goal**: Before changing any behavior, establish a safety net so subsequent changes can be verified.

### 1.1 — GitHub Actions CI Pipeline (M21)

**File**: `.github/workflows/ci.yml`

```yaml
# Triggers: push to main, all PRs
# Steps: install (pnpm), lint, typecheck, test, build
# Matrix: Node 20 on ubuntu-latest
```

- `pnpm install --frozen-lockfile`
- `pnpm -r build` (all packages)
- `pnpm lint` (eslint)
- `pnpm test` (vitest)
- `pnpm typecheck` (tsc --noEmit across all packages)

**Verification**: Push a branch, confirm all steps pass green.

### 1.2 — Vitest Coverage Configuration (m12)

**File**: `vitest.config.ts`

Add coverage configuration:
- Provider: `v8`
- Thresholds: statements 60%, branches 50%, functions 60%, lines 60% (will ratchet up as tests are added)
- Report formats: `text`, `lcov` (for CI), `html` (for local dev)

**Verification**: `pnpm test -- --coverage` produces a report.

### 1.3 — Dependency Audit Script (m13)

**File**: `package.json` (root)

Add script: `"audit": "pnpm audit --audit-level=high"`

Add to CI pipeline as a non-blocking warning step.

**Verification**: `pnpm audit` runs without error.

---

## Phase 2: Server Hardening

**Goal**: Fix all server-side issues — security, performance, correctness.

### 2.1 — Fix CORS to Reject Non-Matching Origins (C1)

**File**: `packages/server/src/index.ts` lines 38-54

**Change**: Remove the fallback `else if (allowedOrigins.length > 0)` branch. If the request origin isn't in the whitelist, don't set any `Access-Control-Allow-Origin` header. The browser will block the request naturally.

```typescript
// BEFORE (line 44-45):
} else if (allowedOrigins.length > 0) {
  res.header('Access-Control-Allow-Origin', allowedOrigins[0]);
}

// AFTER:
// No else — non-matching origins get no CORS header
```

**Test**: Unit test that non-matching origins get no CORS header.
**Verification**: `curl -H "Origin: http://evil.com" http://localhost:4000/api/health` — no `Access-Control-Allow-Origin` in response.

### 2.2 — WebSocket Authentication (C2)

**File**: `packages/server/src/index.ts` lines 147-160

**Change**: If `SYNAPSE_API_KEY` is set, validate a `token` query parameter on the WS upgrade URL (`/ws?token=<key>`). Reject with 401 if missing/invalid.

```typescript
wss.on('connection', (ws: WebSocket, req: IncomingMessage) => {
  const apiKey = process.env.SYNAPSE_API_KEY;
  if (apiKey) {
    const url = new URL(req.url ?? '', `http://${req.headers.host}`);
    const token = url.searchParams.get('token');
    if (token !== apiKey) {
      ws.close(4001, 'Unauthorized');
      return;
    }
  }
  // ... existing logic
});
```

**Also update**: `apps/dashboard/src/store/wsClient.ts` to append `?token=` if `VITE_API_KEY` is set. And `apps/vscode/src/wsClient.ts` similarly.

**Test**: Unit test that WS connections without valid token are rejected when API key is configured.
**Verification**: `wscat -c ws://localhost:4000/ws` fails with 4001 when API key is set.

### 2.3 — Per-Endpoint Body Size Limits (C3)

**File**: `packages/server/src/index.ts`

**Change**: Remove the global `express.json({ limit: '50mb' })`. Instead, apply per-router:

| Endpoint | Limit | Rationale |
|----------|-------|-----------|
| `POST /api/events` | 1MB | Hook payloads are small (< 100KB typically) |
| `POST /api/agents/spawn` | 256KB | Prompt + config |
| `POST /api/agents/:id/message` | 256KB | Single message |
| `POST /api/snapshot/import` | 50MB | Can contain thousands of events |
| Default | 1MB | Safety net |

Implementation: Use `express.json({ limit: '...' })` as middleware on each router, not globally.

**Test**: Integration test that oversized payloads are rejected with 413.
**Verification**: `curl` with a 2MB payload to `/api/events` returns 413.

### 2.4 — Timing-Safe Auth Comparison (M7)

**File**: `packages/server/src/lib/auth.ts`

**Change**:
```typescript
import { timingSafeEqual } from 'crypto';

// Replace: if (provided !== key)
// With:
const a = Buffer.from(provided ?? '');
const b = Buffer.from(key);
if (a.length !== b.length || !timingSafeEqual(a, b)) {
  res.status(401).json({ error: 'Unauthorized' });
  return;
}
```

**Test**: Unit test that auth rejects invalid keys and accepts valid ones.

### 2.5 — Database Event Retention / Pruning (M1)

**File**: `packages/server/src/db.ts`

**Add**:
- `pruneOldEvents(maxAgeDays: number)` — deletes events older than N days
- `pruneExcessEvents(maxCount: number)` — keeps only the most recent N events
- A periodic timer (every hour) that calls prune with configurable limits

**Env vars**:
- `SYNAPSE_MAX_EVENT_AGE_DAYS` (default: 30)
- `SYNAPSE_MAX_EVENTS` (default: 100000)

**Test**: Unit test that old events are deleted and count is respected.
**Verification**: Insert 200K events, run prune, verify only 100K remain.

### 2.6 — Paginate All Queries (M2)

**File**: `packages/server/src/db.ts` — `queryEvents()`

**Change**: Add `LIMIT ? OFFSET ?` to the `sessionId` and `agentId` branches (currently unbounded). Default limit: 1000.

**Also update**: `getEventsBySession()` to accept optional limit/offset.

**Test**: Unit test that queries respect pagination.

### 2.7 — Fix Snapshot Export N+1 (M3)

**File**: `packages/server/src/routes/snapshot.ts`

**Change**: Replace the per-session loop with a single query:
```sql
SELECT * FROM events WHERE session_id IN (?, ?, ...) ORDER BY session_id, created_at ASC
```
Then group results by `session_id` in code.

**Test**: Integration test comparing single-query vs N+1 output.

### 2.8 — Rate Limiting on All Endpoints (M4)

**File**: `packages/server/src/index.ts`

**Change**: Add a general API limiter (300 req/min) applied to `/api` as a whole, in addition to the existing tighter limiters on `/api/events` and `/api/agents/spawn`.

```typescript
const apiLimiter = rateLimit({ windowMs: 60_000, max: 300, message: { error: 'Too many requests' } });
app.use('/api', apiLimiter);
```

**Test**: Integration test that 301st request in a window gets 429.

### 2.9 — Request ID Middleware (M8)

**File**: `packages/server/src/lib/requestId.ts` (new)

**Change**: Middleware that generates a `x-request-id` (nanoid) and attaches it to `req` and response header. Pino logger includes it automatically.

```typescript
app.use((req, res, next) => {
  const id = req.headers['x-request-id'] as string ?? nanoid(12);
  (req as any).requestId = id;
  res.setHeader('x-request-id', id);
  next();
});
```

**Also**: Update pino logger to include `requestId` in log context.

**Test**: Integration test that response includes `x-request-id`.

### 2.10 — Fix Silent Error Swallowing (M5, m1)

**Files**:
- `packages/server/src/routes/snapshot.ts` line 130 — Log skipped events with reason, return skip count in response.
- `packages/server/src/index.ts` lines 207-208 — `unhandledRejection` should call `shutdown()` after logging.

**Test**: Import with duplicate event_ids, verify response includes `skipped` count.

### 2.11 — Transcript Reader Optimization (M6)

**File**: `packages/server/src/services/transcriptReader.ts`

**Change**:
- Convert `findTranscriptPath()` to async using `fs.promises`
- Add a simple in-memory cache (Map with 5-min TTL) for resolved paths
- Update route handlers to `await` the async version

**Test**: Unit test for cache hit/miss behavior.

### 2.12 — Hook Debug Logging Gate (m3)

**File**: `hooks/send_event.cjs`

**Change**: Only write to `hook_debug.log` if `SYNAPSE_DEBUG=1` is set:
```javascript
const DEBUG = process.env.SYNAPSE_DEBUG === '1';
function debugLog(msg) {
  if (!DEBUG) return;
  // ...existing
}
```

**Verification**: Run a hook without SYNAPSE_DEBUG, verify no log file writes.

### 2.13 — Clean Up `as any` in AgentManager (m2)

**File**: `packages/server/src/services/agentManager.ts`

**Change**: Replace 5 `as any` casts with proper types from the Agent SDK, or use `unknown` with runtime checks.

### 2.14 — `Retry-After` Header on 429 (m4)

**File**: `packages/server/src/index.ts`

**Change**: Configure `express-rate-limit` with `standardHeaders: 'draft-8'` to include `Retry-After` automatically.

### 2.15 — Type-Safe Analytics Helpers (m5)

**File**: `packages/server/src/db.ts`

**Change**: Replace `analyticsQueryAll` / `analyticsExecute` raw escape hatches with typed wrapper functions for each specific analytics query used by costService and routes.

---

## Phase 3: Client Reliability & Data Flow

**Goal**: Fix state management, WS handling, and data flow correctness.

### 3.1 — Queue Events While Paused (C4)

**File**: `apps/dashboard/src/store/agentStore.ts`

**Change**: Instead of `if (state.paused) return state;`, push events to a `pauseQueue: AgentEvent[]` in the store. On unpause, process queued events in order, then clear queue. Remove the `reloadAllEvents()` call on unpause — it's no longer needed.

```typescript
// In addEvent:
if (state.paused) {
  return { ...state, pauseQueue: [...state.pauseQueue, event] };
}

// In setPaused:
if (!paused) {
  const queued = get().pauseQueue;
  // Process queued events in order...
  set({ paused: false, pauseQueue: [] });
}
```

**Test**: Store test that events are queued while paused and replayed on unpause.

### 3.2 — Debounce Graph Search (M10)

**File**: `apps/dashboard/src/components/graph/GraphSearchBox.tsx`

**Change**: Add a 250ms debounce between the input `onChange` and the store's `setGraphSearchQuery`. Use a local state for the input value and `setTimeout` / `clearTimeout` for the debounce.

**Test**: Component test that rapid typing only triggers one store update after 250ms.

### 3.3 — Manual WS Reconnect Button (M11)

**File**: `apps/dashboard/src/components/layout/Header.tsx`

**Change**: When `connectionStatus === 'failed'`, show a "Reconnect" button that calls `wsClient.connect()` (after resetting the retry counter). Add a `resetAndReconnect()` method to `WSClient`.

```typescript
// In WSClient:
resetAndReconnect() {
  this.reconnectCount = 0;
  this.reconnectDelay = 1000;
  this.connect();
}
```

**Test**: Unit test that `resetAndReconnect()` resets state and initiates connection.

### 3.4 — Fix text_delta Missing sessionId (M12)

**File**: `apps/dashboard/src/store/agentStore.ts` lines 465-473

**Change**: Look up the agent's sessionId from the agents map before creating the text_delta event:

```typescript
const agentData = useAgentStore.getState().agents.get(msg.data.agentId);
const sessionId = agentData?.sessionId ?? '';
```

**Test**: Store test that text_delta events carry the correct sessionId.

### 3.5 — WS Backpressure Recovery Signal (M17)

**File**: `packages/server/src/services/broadcaster.ts`

**Change**: When events are dropped due to backpressure, set a per-client `stale` flag. On the next successful send, include a `{ type: 'stale' }` message that tells the client to do a full reload.

**File**: `apps/dashboard/src/store/wsClient.ts` — Handle `'stale'` message type by calling `onReconnect()`.

**Test**: Broadcaster test that stale flag is set and cleared correctly.

### 3.6 — Event Ordering Safety (M15)

**File**: `apps/dashboard/src/store/agentStore.ts`

**Change**: In `addEvent`, insert the event at the correct position by timestamp instead of always prepending. Use binary search for O(log n) insertion:

```typescript
// Find insertion point by timestamp
const idx = events.findIndex(e => e.timestamp <= event.timestamp);
const newEvents = [...events.slice(0, idx >= 0 ? idx : events.length), event, ...events.slice(idx >= 0 ? idx : events.length)].slice(0, 1000);
```

**Test**: Store test with out-of-order events.

### 3.7 — Unpause Race Condition Fix (M16)

Already addressed by 3.1 (queue approach eliminates the reload race).

### 3.8 — User Warning on Event Cap (M9)

**File**: `apps/dashboard/src/store/agentStore.ts`

**Change**: When events array hits 1000, call `toast('Event limit reached — oldest events are being dropped', 'warning')` once (use a flag to avoid repeated toasts).

**Test**: Store test that toast fires when cap is reached.

### 3.9 — Move cwdFilter into Store (m9)

**File**: `apps/dashboard/src/store/agentStore.ts`

**Change**: Move `cwdFilter` from module-level into the Zustand store so it's visible in devtools and snapshotable.

### 3.10 — Clean Up Dead WS Methods (dead code)

**File**: `apps/dashboard/src/store/wsClient.ts` lines 102-108

**Remove**: `subscribe()` and `unsubscribe()` methods — the server has no handler for these messages.

---

## Phase 4: Architecture & Code Quality

**Goal**: Deduplicate code, clean up types, improve maintainability.

### 4.1 — Extract Shared GraphLayout Component

**File**: `apps/dashboard/src/components/layout/GraphLayout.tsx` (new)

**Change**: Extract the shared JSX between `viewMode === 'graph'` and `viewMode === 'full'` in `App.tsx` (~80% overlap) into a reusable `GraphLayout` component. The "full" view wraps it with the `LensAdapter`.

### 4.2 — Remove Duplicated `normalizeCwd` in Extension (M20)

**File**: `apps/vscode/src/extension.ts`

**Change**: Remove the inline `normalizeCwd` function and import from `@synapse-ai/core`. Ensure the esbuild config bundles core utilities into the extension.

### 4.3 — Proper Database Migration System

**File**: `packages/server/src/db.ts`

**Change**: Replace `try { db.run('ALTER TABLE...') } catch {}` blocks with a proper migration table:

```sql
CREATE TABLE IF NOT EXISTS migrations (
  id INTEGER PRIMARY KEY,
  name TEXT UNIQUE NOT NULL,
  applied_at INTEGER NOT NULL
);
```

Each migration is a named function. On startup, check which migrations have been applied and run the missing ones in order.

### 4.4 — Fix removeHooks to Not Delete Entire File (M18)

**File**: `apps/vscode/src/hookManager.ts`

**Change**: Instead of `fs.unlinkSync(settingsFile)`, read the JSON, delete only the Synapse hook keys, and write it back. If the resulting object is empty, then delete the file.

```typescript
const settings = JSON.parse(fs.readFileSync(settingsFile, 'utf-8'));
if (settings.hooks) {
  for (const event of [...SYNC_EVENTS, ...ASYNC_EVENTS]) {
    delete settings.hooks[event];
  }
  if (Object.keys(settings.hooks).length === 0) delete settings.hooks;
}
if (Object.keys(settings).length === 0) {
  fs.unlinkSync(settingsFile);
} else {
  fs.writeFileSync(settingsFile, JSON.stringify(settings, null, 2));
}
```

**Test**: Unit test that only Synapse hooks are removed, other settings preserved.

### 4.5 — Fix deactivate Hook Cleanup (m11)

**File**: `apps/vscode/src/extension.ts` line 204

**Change**: Don't call `hookManager.removeHooks()` on deactivate. Only remove on explicit `synapse.removeHooks` command or extension uninstall. The current behavior destroys hook config on every VS Code restart.

### 4.6 — Add CSP to Webviews (M19)

**Files**: `apps/vscode/src/webviewPanel.ts`, `apps/vscode/src/sidebarProvider.ts`

**Change**: Set Content Security Policy on webview options:

```typescript
webview.options = {
  enableScripts: true,
  localResourceRoots: [...],
};
// In the HTML template:
// <meta http-equiv="Content-Security-Policy" content="default-src 'none'; frame-src http://localhost:*; script-src 'nonce-${nonce}';">
```

### 4.7 — Document Undocumented Keyboard Shortcuts (m7)

**File**: `CLAUDE.md`

**Add** to keyboard shortcuts table: `C` (auto-close prompts), `V` (lock viewport), `F` (show all tools), `E` (export), `I` (import), `/` (focus search), `1-6` (lens tabs).

### 4.8 — Fix Number Keys Hijacking (m8)

**File**: `apps/dashboard/src/App.tsx` lines 196-199

**Change**: Only switch lens tabs on number keys when no modifier is held AND the lens panel is visible:

```typescript
if (!e.ctrlKey && !e.metaKey && !e.altKey && viewMode === 'full') {
  const tabIdx = parseInt(e.key, 10) - 1;
  // ...
}
```

### 4.9 — Fix `postMessage` Target Origin (m6)

**File**: `apps/dashboard/src/App.tsx` line 117

**Change**: Use `window.location.origin` instead of `'*'` when not in VS Code mode. In VS Code webview context, `'*'` is required (cross-origin iframe).

---

## Phase 5: Full Test Suite

**Goal**: Reach 70%+ coverage with meaningful tests.

### 5.1 — Route Integration Tests (HIGH PRIORITY)

**File**: `packages/server/src/__tests__/routes.test.ts` (new)

**Framework**: Supertest + Vitest

**Tests** (~20):
- `POST /api/events` — valid hook event → 200, malformed → 400, oversized → 413
- `GET /api/events` — with/without filters, pagination, cwd filter
- `GET /api/events/sessions` — returns session list
- `DELETE /api/events` — clears all
- `DELETE /api/events/session/:id` — clears specific session
- `POST /api/agents/spawn` — valid → 201, invalid → 400, max concurrent → 429
- `POST /api/agents/:id/message` — valid → 200, not found → 404
- `DELETE /api/agents/:id` — found → 200, not found → 404
- `GET /api/agents` — returns list
- `GET /api/health` — returns health status
- `GET /api/snapshot/export` — returns valid snapshot JSON
- `POST /api/snapshot/import` — valid → 200, duplicates → partial success with skip count
- Auth: requests without token → 401 when `SYNAPSE_API_KEY` is set

### 5.2 — Database Tests (HIGH PRIORITY)

**File**: `packages/server/src/__tests__/db.test.ts` (new)

**Tests** (~15):
- `insertEvent` — inserts and can be queried back
- `queryEvents` — all filter combinations (sessionId, agentId, type, cwd)
- `queryEvents` — pagination (limit, offset)
- `deleteEventsBySession` — only deletes matching events
- `deleteAllEvents` — clears everything
- `listSessions` — correct aggregation
- `updateDailyRollup` — increments counters correctly
- `insertPriceHistory` / `getAllPriceHistory` / `deletePriceHistory` — CRUD
- `getDbStats` — returns correct counts
- Migration tests — columns added correctly
- Retention — `pruneOldEvents` removes old events, keeps new ones

### 5.3 — WebSocket Integration Tests

**File**: `packages/server/src/__tests__/ws.test.ts` (new)

**Tests** (~8):
- Client connects → receives `connected` message with active agents
- Event broadcast → all clients receive it
- Heartbeat → client that doesn't respond to ping is terminated
- Max clients → 51st client rejected with 1013
- Backpressure → event dropped when buffer > 1MB, stale flag set
- Auth → connection rejected without token when API key is set
- Client disconnect → client removed from set

### 5.4 — Cost Service Tests

**File**: `packages/server/src/__tests__/costService.test.ts` (new)

**Tests** (~8):
- `getPrice` — exact model match
- `getPrice` — prefix match (dated model ID)
- `getPrice` — fallback pricing for unknown model
- `computeCostUsd` — calculation accuracy
- `addUserPrice` — override takes precedence
- `loadUserPrices` — sorted correctly
- `inferVendorFromModel` — all vendor patterns

### 5.5 — React Component Tests

**File**: `apps/dashboard/src/components/__tests__/` (new directory)

**Framework**: Vitest + React Testing Library

**Tests** (~12):
- `Header` — renders connection status, session count, pause button
- `AgentDetailPanel` — shows agent details when selected
- `ToolLogPanel` — renders tool call list, filters work
- `SpawnAgentDialog` — form validation, submit disabled when empty
- `SessionNode` — renders session data, correct colors
- `AgentNode` — status-based coloring (running/success/error)
- `ToolCallNode` — shows tool name and status
- `Toast` — appears and auto-dismisses
- `ErrorBoundary` — catches errors, shows fallback
- `GraphSearchBox` — debounce behavior
- Empty/loading/error states in key components

### 5.6 — E2E Smoke Test

**File**: `tests/e2e/smoke.test.ts` (new)

**Framework**: Playwright

**Tests** (~3):
- Start server → dashboard loads → shows empty state
- POST hook event → node appears in graph
- Export snapshot → import on fresh server → same nodes appear

---

## Phase 6: UX — Onboarding, Empty States, Loading States

### 6.1 — Empty State Component

**File**: `apps/dashboard/src/components/EmptyState.tsx` (new)

A reusable empty state component with:
- Icon (customizable)
- Title
- Description
- Optional CTA button

### 6.2 — Graph Empty State

**File**: `apps/dashboard/src/components/graph/AgentGraph.tsx`

**Change**: When `nodes.length <= 1` (only spawn node), overlay an `EmptyState` with:
- Title: "No active sessions"
- Description: "Start a Claude Code session in this project, or run a simulation script to see the graph in action."
- CTA: "Run Simulation" (if in dev mode)

### 6.3 — Loading Skeleton

**File**: `apps/dashboard/src/components/SkeletonLoader.tsx` (new)

Simple CSS-animated skeleton bars for:
- Header (during initial load)
- Panel content (during transcript fetch)
- Tool log rows

### 6.4 — Server-Down Banner

**File**: `apps/dashboard/src/components/layout/Header.tsx`

**Change**: When `connectionStatus === 'disconnected'` or `'failed'`, show a persistent warning banner below the header:
- "Server connection lost. Retrying..." (with spinner)
- "Connection failed. [Reconnect] button" (after max retries)
- "Server not running. Start the server and refresh." (on initial load failure)

### 6.5 — Loading States in Panels

**Files**: `AgentDetailPanel.tsx`, `ToolLogPanel.tsx`, `LensPanel.tsx`

**Change**: When `isLoading`, show skeleton placeholders instead of empty content.

### 6.6 — Event Cap Warning Banner

**File**: `apps/dashboard/src/components/layout/Header.tsx`

**Change**: When events array is at 1000, show a subtle info banner: "Showing last 1,000 events. Older events are available in the database."

---

## Phase 7: UX — Accessibility (a11y)

### 7.1 — ARIA Landmarks

**File**: `apps/dashboard/src/App.tsx`

**Change**: Add semantic landmarks:
- `<header role="banner">` for Header
- `<nav role="navigation">` for lens tabs
- `<main role="main">` for graph area
- `<aside role="complementary">` for panels

### 7.2 — Keyboard Navigation in Panels

**Files**: `ToolLogPanel.tsx`, `AgentDetailPanel.tsx`, `LensPanel.tsx`

**Change**:
- Arrow keys to navigate list items
- Enter to select/expand
- Escape to close panel
- `tabindex` on interactive elements
- Focus ring styles (visible on `:focus-visible`)

### 7.3 — ARIA Labels on Interactive Elements

**Files**: All node components, Header, panels

**Change**:
- `aria-label` on icon-only buttons (close, toggle, filter)
- `aria-expanded` on collapsible sections
- `aria-selected` on selected nodes
- `aria-live="polite"` on toast container
- `aria-busy="true"` on loading sections
- `role="status"` on connection status indicator

### 7.4 — Color Contrast & Non-Color Indicators

**Files**: Node components (`SessionNode.tsx`, `AgentNode.tsx`, `ToolCallNode.tsx`)

**Change**:
- Add text status labels alongside color indicators ("Running", "Error", "Complete")
- Ensure text meets WCAG 2.1 AA contrast ratio (4.5:1 for normal text)
- Add pattern/icon differentiation for colorblind users (checkmark for success, X for error, spinner for running)

### 7.5 — Skip-to-Content Link

**File**: `apps/dashboard/src/App.tsx`

**Add**: A visually hidden skip link as the first focusable element:
```html
<a href="#main-graph" class="sr-only focus:not-sr-only ...">Skip to main content</a>
```

### 7.6 — Focus Management

**Files**: `SpawnAgentDialog.tsx`, `AgentDetailPanel.tsx`

**Change**:
- When dialog opens, focus first input
- When dialog closes, return focus to trigger element
- Trap focus within modal dialogs (tab cycle)

---

## Phase 8: UX — Responsive Design

### 8.1 — Breakpoint System

**File**: `apps/dashboard/src/hooks/useBreakpoint.ts` (new)

Custom hook that returns current breakpoint:
- `sm`: < 768px (mobile)
- `md`: 768-1024px (tablet)
- `lg`: > 1024px (desktop)

### 8.2 — Responsive Layout

**File**: `apps/dashboard/src/App.tsx`

**Changes**:
- **< 768px**: Stack layout — lens panel hidden by default (toggle button), graph fills width, detail panel slides up from bottom as a sheet
- **768-1024px**: Side-by-side with collapsible lens panel, narrower detail panel
- **> 1024px**: Current layout (unchanged)

### 8.3 — Responsive Header

**File**: `apps/dashboard/src/components/layout/Header.tsx`

**Change**:
- **< 768px**: Hamburger menu for secondary actions (export, import, clear, settings)
- **768-1024px**: Compact mode — icon-only buttons with tooltips
- **> 1024px**: Full layout (unchanged)

### 8.4 — Responsive Panels

**Files**: `AgentDetailPanel.tsx`, `ToolLogPanel.tsx`, `LensPanel.tsx`

**Change**:
- On small screens, panels are full-width bottom sheets (slide up)
- On medium screens, panels are narrower (240px instead of 320px)
- Touch-friendly tap targets (min 44px)

### 8.5 — Responsive Graph

**File**: `apps/dashboard/src/components/graph/AgentGraph.tsx`

**Change**:
- On small screens, enable React Flow's `panOnScroll` and increase `minZoom`
- Node sizes slightly smaller on mobile
- Touch gestures for pan/zoom already supported by React Flow

---

## Execution Order (Dependency-Aware)

```
Phase 1 (Foundation)     ████ ~1 day
  1.1 CI pipeline
  1.2 Coverage config
  1.3 Audit script

Phase 2 (Server)         ████████ ~2-3 days
  2.1 CORS fix
  2.2 WS auth
  2.3 Body limits
  2.4 Timing-safe auth
  2.5 DB retention
  2.6 Paginate queries
  2.7 Snapshot N+1
  2.8 Rate limiting
  2.9 Request ID
  2.10 Error swallowing
  2.11 Transcript optimization
  2.12 Hook debug gate
  2.13 Clean up `as any`
  2.14 Retry-After
  2.15 Type-safe analytics

Phase 3 (Client)         ████████ ~2-3 days
  3.1 Pause queue
  3.2 Search debounce
  3.3 Reconnect button
  3.4 text_delta sessionId
  3.5 Backpressure recovery
  3.6 Event ordering
  3.8 Event cap warning
  3.9 cwdFilter in store
  3.10 Dead code cleanup

Phase 4 (Architecture)   ██████ ~1-2 days
  4.1 GraphLayout component
  4.2 normalizeCwd dedup
  4.3 Migration system
  4.4 removeHooks fix
  4.5 deactivate fix
  4.6 Webview CSP
  4.7 Docs update
  4.8 Number keys fix
  4.9 postMessage origin

Phase 5 (Tests)          ████████████ ~3-4 days
  5.1 Route tests
  5.2 DB tests
  5.3 WS tests
  5.4 Cost service tests
  5.5 Component tests
  5.6 E2E smoke test

Phase 6 (Onboarding/UX)  ██████ ~1-2 days
  6.1-6.6 Empty/loading/error states

Phase 7 (Accessibility)  ██████ ~1-2 days
  7.1-7.6 ARIA, keyboard nav, contrast, focus

Phase 8 (Responsive)     ██████ ~1-2 days
  8.1-8.5 Breakpoints, layout, header, panels, graph
```

**Total: ~50-60 discrete tasks across 8 phases**

---

## Verification Checklist (per phase)

After each phase:
- [ ] `pnpm test` passes (all existing + new tests)
- [ ] `pnpm lint` passes
- [ ] `pnpm -r build` succeeds
- [ ] Manual smoke test: start server, open dashboard, run simulation, verify events appear
- [ ] No regressions in VS Code extension packaging (`cd apps/vscode && node esbuild.mjs && npx @vscode/vsce package`)
