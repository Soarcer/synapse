# Phase 4 Completion — Performance + UX

> Design doc for the remaining 5 items to complete Phase 4.
> Date: 2026-02-22

## Problem

Phase 4 is 70% done. The analytics UI, coaching, replay, export, search, and notifications are all complete. What remains are backend performance bottlenecks, frontend rendering performance, and URL-based deep linking.

### What's left

| #   | Item                        | Category           | Impact                                          |
| --- | --------------------------- | ------------------ | ----------------------------------------------- |
| 1   | Async transcript I/O        | Backend perf       | Unblocks event loop during transcript reads     |
| 2   | Materialized sessions table | Backend perf       | O(1) session list instead of full GROUP BY scan |
| 3   | Transcript fetch batching   | Backend + frontend | N requests → 1 request on page load             |
| 4   | Virtualization              | Frontend perf      | Smooth scrolling with 500+ items                |
| 5   | Deep linking                | Frontend UX        | Shareable/bookmarkable URLs                     |

---

## 1. Async Transcript I/O

**Current state:** `transcriptReader.ts` uses `fs.readFileSync` (line 491) and `fs.readdirSync` (lines 66-75). Every transcript request blocks the Node.js event loop for the entire parse duration.

**Design:**

- Replace `fs.readFileSync` → `fs.promises.readFile` in `readFullTranscript()`
- Replace `fs.readdirSync` → `fs.promises.readdir` in `findTranscriptPathUncached()`
- Replace `fs.existsSync` → `fs.promises.access` with try/catch
- Make `readTranscript()`, `readFullTranscript()`, and `findTranscriptPath()` async
- Update all route handlers in `transcript.ts` (already async, just need `await`)
- The 5-minute path cache stays as-is (Map with TTL)

**Files changed:**

- `packages/server/src/services/transcriptReader.ts` — all sync fs calls → async
- `packages/server/src/routes/transcript.ts` — add `await` to read calls
- `packages/server/src/services/transcriptScanner.ts` — if it calls sync reader functions

**Risk:** Low. Route handlers are already async. This is mechanical find-and-replace.

---

## 2. Materialized Sessions Summary Table

**Current state:** `listSessions()` in `db.ts` (lines 521-533) runs `SELECT ... GROUP BY session_id` over the entire events table on every call.

**Design:**

- Add `session_summary` table:
  ```sql
  CREATE TABLE IF NOT EXISTS session_summary (
    session_id TEXT PRIMARY KEY,
    first_event TEXT NOT NULL,
    last_event TEXT NOT NULL,
    event_count INTEGER DEFAULT 0,
    tool_count INTEGER DEFAULT 0,
    total_tokens INTEGER DEFAULT 0,
    model TEXT,
    cwd TEXT,
    has_ended INTEGER DEFAULT 0
  )
  ```
- Add `upsertSessionSummary(event)` function called inside `storeEvent()` — same transaction
- The upsert uses `INSERT ... ON CONFLICT(session_id) DO UPDATE SET ...` to increment counters
- `listSessions()` becomes: `SELECT * FROM session_summary ORDER BY last_event DESC`
- Optional: backfill on startup if table is empty (one-time GROUP BY migration)

**Files changed:**

- `packages/server/src/db.ts` — new table DDL, `upsertSessionSummary()`, simplified `listSessions()`
- `packages/server/src/services/eventStore.ts` — call upsert in `storeEvent()`

**Risk:** Low. The summary table is purely additive. If it gets out of sync, the old GROUP BY query is still available as a fallback/recalculator.

---

## 3. Transcript Fetch Batching

**Current state:** `LensAdapter.tsx` (lines 336-351) fires one `GET /api/transcript/:sessionId` per session on mount. With 10 sessions, that's 10 HTTP requests.

**Design:**

- Add `POST /api/transcript/batch` endpoint:
  ```typescript
  // Body: { sessionIds: string[] }  (max 20)
  // Response: { [sessionId]: TranscriptSummary | null }
  ```
- Server loops through sessionIds, calls `readTranscript()` for each (now async), collects results
- Frontend: replace the per-session loop in `LensAdapter.tsx` with a single batch fetch
- Collect all unfetched sessionIds, POST once, then call `setTranscript()` for each result

**Files changed:**

- `packages/server/src/routes/transcript.ts` — new batch route
- `apps/dashboard/src/components/lens/LensAdapter.tsx` — batch fetch logic (or extract to a hook)

**Risk:** Low. The individual endpoint stays for single-session use cases.

---

## 4. Virtualization (react-virtuoso)

**Current state:** TreeView (line 225: "plain render, no virtualization") and ToolLogPanel (lines 88-99) render all items in the DOM. With 500+ tool events or tree nodes, this causes jank.

**Design:**

- Install `react-virtuoso` in `apps/dashboard`
- **TreeView:** Replace `flatList.map(...)` with `<Virtuoso data={flatList} itemContent={(idx, node) => <TreeRow ... />} />`
  - TreeView rows have variable height (collapsed vs expanded) — Virtuoso handles this natively
  - Need to set a container height (use flex-1 with parent height)
- **ToolLogPanel:** Replace `toolEvents.map(...)` with `<Virtuoso data={toolEvents} itemContent={(idx, event) => <ToolEventRow ... />} />`
  - Rows are roughly uniform height (~60px)
  - Auto-scroll to bottom for live events (Virtuoso has `followOutput` prop)

**Files changed:**

- `apps/dashboard/package.json` — add `react-virtuoso`
- `apps/dashboard/src/components/lens/tree/TreeView.tsx` — Virtuoso wrapper
- `apps/dashboard/src/components/panels/ToolLogPanel.tsx` — Virtuoso wrapper

**Risk:** Low-medium. Need to ensure row click handlers, selection state, and scroll-to-selected still work with virtualized lists.

---

## 5. Deep Linking

**Current state:** URL only carries `?view=` and `?cwd=`. No session, node, tab, or search state in the URL. No router library — just vanilla `URLSearchParams`.

**Design:**

- New hook: `useUrlSync()` in `apps/dashboard/src/hooks/`
- **URL params synced:**
  | Param | Store field | Example |
  |-------|-----------|---------|
  | `session` | `filter.sessionId` | `?session=abc123` |
  | `node` | `selectedNodeId` | `?node=agent-opus-7f3` |
  | `tab` | `activeLensTab` | `?tab=cost` |
  | `q` | `graphSearchQuery` | `?q=Bash` |
- **Read on mount:** Parse URL params → call store setters (after existing `?view=` and `?cwd=` logic)
- **Write on change:** Subscribe to store via `useAgentStore.subscribe()`, debounce 300ms, call `history.replaceState()` (not pushState — avoids polluting back button)
- **Back/forward:** Listen to `popstate` event → restore state from URL
- No router library needed. Vanilla `URLSearchParams` + `history.replaceState`.

**Files changed:**

- `apps/dashboard/src/hooks/useUrlSync.ts` — new hook
- `apps/dashboard/src/App.tsx` — mount `useUrlSync()` in the main app

**Risk:** Low. `replaceState` doesn't trigger navigation. The debounce prevents rapid URL updates during drag/pan interactions.

---

## Parallelization

Items 1-3 are backend-only. Items 4-5 are frontend-only. No dependencies between them.

```
Backend (items 1-3):  async I/O → materialized sessions → batch endpoint
Frontend (items 4-5): virtualization + deep linking (parallel)
```

All 5 can be done in 2 parallel streams (backend + frontend), or 3 agents if we split frontend into virtualization vs deep linking.

---

## Deferred

- **Command palette (cmdk)** — deferred to a future phase
- **Agent templates** — not critical for Phase 4 completion
- **Empty state spawn button** — trivial fix, can be done as a drive-by

---

## Verification

Phase 4 is complete when:

1. Transcript reads don't block the event loop (`readFile` is async)
2. Session list loads in O(1) from summary table
3. Dashboard loads with 1 HTTP request for transcripts (not N)
4. TreeView and ToolLogPanel scroll smoothly with 500+ items
5. Opening `?session=abc&node=xyz&tab=cost` restores full state
6. All existing tests pass + new tests for batch endpoint and summary table
