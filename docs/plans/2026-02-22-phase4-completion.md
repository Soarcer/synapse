# Phase 4 Completion — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Complete the remaining 5 items of Phase 4 (Performance + UX) to bring it from 70% to 100%.

**Architecture:** Backend stream (tasks 1-3) converts sync I/O to async, adds a materialized sessions table, and adds a batch transcript endpoint. Frontend stream (tasks 4-5) adds react-virtuoso for list virtualization and URL-based deep linking. Both streams are independent and can run in parallel.

**Tech Stack:** Node.js fs.promises, sql.js, react-virtuoso, vanilla URLSearchParams + history.replaceState

**Design doc:** `docs/plans/2026-02-22-phase4-completion-design.md`

---

## Task 1: Async Transcript I/O

**Files:**

- Modify: `packages/server/src/services/transcriptReader.ts`
- Modify: `packages/server/src/services/transcriptScanner.ts`
- Modify: `packages/server/src/routes/transcript.ts`
- Test: `packages/server/src/__tests__/transcriptReader.test.ts`

### Step 1: Update tests to expect async functions

In `packages/server/src/__tests__/transcriptReader.test.ts`, the existing tests call `readFullTranscript()` synchronously. Update the imports and add `async/await`:

```typescript
// Change existing tests from:
const result = readFullTranscript(fp, 'sess1');
// To:
const result = await readFullTranscript(fp, 'sess1');
```

Also update `readTranscript` calls if any. Make every `it()` callback `async`.

Add one new test:

```typescript
it('readFullTranscript returns a promise', async () => {
  const fp = writeFixture('async-check.jsonl', [
    { type: 'summary', sessionId: 'sess1', timestamp: '2026-02-22T00:00:00Z' },
  ]);
  const result = readFullTranscript(fp, 'sess1');
  expect(result).toBeInstanceOf(Promise);
  await result; // should resolve without error
});
```

### Step 2: Run tests to verify they fail

Run: `pnpm test -- --run packages/server/src/__tests__/transcriptReader.test.ts`

Expected: FAIL — `readFullTranscript` returns a plain object, not a Promise.

### Step 3: Convert transcriptReader.ts to async

In `packages/server/src/services/transcriptReader.ts`:

**a)** Add `fs.promises` import at top:

```typescript
import fs from 'fs';
import fsp from 'fs/promises';
```

**b)** Convert `findTranscriptPathUncached` to async:

```typescript
async function findTranscriptPathUncached(
  sessionId: string,
  projectDir?: string,
): Promise<string | null> {
  if (!SESSION_ID_PATTERN.test(sessionId)) return null;

  const claudeDir = path.join(os.homedir(), '.claude', 'projects');

  if (projectDir) {
    const hash = projectHash(projectDir);
    const direct = path.join(claudeDir, hash, `${sessionId}.jsonl`);
    if (!path.resolve(direct).startsWith(path.resolve(claudeDir))) return null;
    try {
      await fsp.access(direct);
      return direct;
    } catch {
      /* not found */
    }
  }

  try {
    await fsp.access(claudeDir);
  } catch {
    return null;
  }

  const dirs = await fsp.readdir(claudeDir);
  for (const dir of dirs) {
    const candidate = path.join(claudeDir, dir, `${sessionId}.jsonl`);
    if (!path.resolve(candidate).startsWith(path.resolve(claudeDir))) return null;
    try {
      await fsp.access(candidate);
      return candidate;
    } catch {
      /* continue */
    }

    const sub = path.join(claudeDir, dir, sessionId, `${sessionId}.jsonl`);
    if (!path.resolve(sub).startsWith(path.resolve(claudeDir))) return null;
    try {
      await fsp.access(sub);
      return sub;
    } catch {
      /* continue */
    }
  }

  return null;
}
```

**c)** Convert `findTranscriptPath` to async (cache logic preserved):

```typescript
export async function findTranscriptPath(
  sessionId: string,
  projectDir?: string,
): Promise<string | null> {
  const cacheKey = `${sessionId}:${projectDir ?? ''}`;
  const cached = pathCache.get(cacheKey);
  if (cached && Date.now() < cached.expiry) return cached.path;

  const result = await findTranscriptPathUncached(sessionId, projectDir);
  pathCache.set(cacheKey, { path: result, expiry: Date.now() + PATH_CACHE_TTL_MS });
  return result;
}
```

**d)** Convert `readFullTranscript` to async:

```typescript
export async function readFullTranscript(
  filePath: string,
  sessionId: string,
): Promise<FullTranscript> {
  const raw = await fsp.readFile(filePath, 'utf-8');
  const lines = raw.split('\n').filter((l) => l.trim());
  // ... rest stays the same (pure computation, no I/O)
```

**e)** Convert `readTranscript` to async:

```typescript
export async function readTranscript(
  filePath: string,
  sessionId: string,
): Promise<TranscriptSummary> {
  return (await readFullTranscript(filePath, sessionId)).summary;
}
```

### Step 4: Update route handlers in transcript.ts

All route handlers already use `try/catch` blocks. Add `async` to each handler callback and `await` the reader calls:

```typescript
// GET /:sessionId/full
router.get('/:sessionId/full', async (req: Request, res: Response) => {
  try {
    const sessionId = req.params.sessionId as string;
    const transcriptPath = await resolveTranscriptPath(sessionId); // make this async too
    // ...
    const fullTranscript = await readFullTranscript(transcriptPath, sessionId);
    res.json(fullTranscript);
```

Update `resolveTranscriptPath` helper (if it's a wrapper around `findTranscriptPath`) to be async.

Repeat for `/:sessionId`, `/:sessionId/reasoning`, and any other handler calling the reader.

### Step 5: Update transcriptScanner.ts

`transcriptScanner.ts` imports `readTranscript` (line 8). Find all call sites and add `await`. The scanner functions that call it need to become async (they likely already are for the scan loop).

### Step 6: Run tests to verify they pass

Run: `pnpm test -- --run packages/server/src/__tests__/transcriptReader.test.ts`

Expected: All existing tests PASS (now async). New async-check test PASSES.

### Step 7: Run full test suite

Run: `pnpm test`

Expected: All tests pass. Any callers of the now-async functions that forgot `await` will fail here.

### Step 8: Commit

```bash
git add packages/server/src/services/transcriptReader.ts packages/server/src/services/transcriptScanner.ts packages/server/src/routes/transcript.ts packages/server/src/__tests__/transcriptReader.test.ts
git commit -m "perf(server): convert transcript I/O from sync to async fs.promises"
```

---

## Task 2: Materialized Sessions Summary Table

**Files:**

- Modify: `packages/server/src/db.ts`
- Modify: `packages/server/src/services/eventStore.ts`
- Test: `packages/server/src/__tests__/db.test.ts`

### Step 1: Write failing tests for session summary

Add to `packages/server/src/__tests__/db.test.ts`:

```typescript
describe('session_summary materialization', () => {
  it('listSessions returns summary after insertEvent', () => {
    insertEvent(makeEvent({ session_id: 'mat-1', event_type: 'session_start', cwd: '/proj' }));
    const sessions = listSessions();
    expect(sessions).toHaveLength(1);
    expect(sessions[0].session_id).toBe('mat-1');
    expect(sessions[0].event_count).toBe(1);
    expect(sessions[0].cwd).toBe('/proj');
  });

  it('accumulates tool_count for tool events', () => {
    insertEvent(makeEvent({ session_id: 'mat-2', event_type: 'session_start' }));
    insertEvent(makeEvent({ session_id: 'mat-2', event_type: 'tool_start', tool_name: 'Read' }));
    insertEvent(makeEvent({ session_id: 'mat-2', event_type: 'tool_end', tool_name: 'Read' }));
    const sessions = listSessions();
    const s = sessions.find((s) => s.session_id === 'mat-2')!;
    expect(s.event_count).toBe(3);
    expect(s.tool_count).toBe(2); // tool_start + tool_end
  });

  it('accumulates total_tokens from token fields', () => {
    insertEvent(
      makeEvent({ session_id: 'mat-3', event_type: 'result', token_input: 100, token_output: 50 }),
    );
    insertEvent(
      makeEvent({ session_id: 'mat-3', event_type: 'result', token_input: 200, token_output: 75 }),
    );
    const sessions = listSessions();
    const s = sessions.find((s) => s.session_id === 'mat-3')!;
    expect(s.total_tokens).toBe(425); // 100+50+200+75
  });

  it('marks has_ended when session_end event arrives', () => {
    insertEvent(makeEvent({ session_id: 'mat-4', event_type: 'session_start' }));
    let sessions = listSessions();
    expect(sessions.find((s) => s.session_id === 'mat-4')!.has_ended).toBe(0);

    insertEvent(makeEvent({ session_id: 'mat-4', event_type: 'session_end' }));
    sessions = listSessions();
    expect(sessions.find((s) => s.session_id === 'mat-4')!.has_ended).toBe(1);
  });

  it('filters by cwd', () => {
    insertEvent(makeEvent({ session_id: 'mat-5a', cwd: '/alpha' }));
    insertEvent(makeEvent({ session_id: 'mat-5b', cwd: '/beta' }));
    const filtered = listSessions(500, '/alpha');
    expect(filtered).toHaveLength(1);
    expect(filtered[0].session_id).toBe('mat-5a');
  });
});
```

### Step 2: Run tests to verify they fail

Run: `pnpm test -- --run packages/server/src/__tests__/db.test.ts`

Expected: Tests should actually PASS with the current GROUP BY implementation (same behavior). This is a **refactor** — same contract, different implementation. The tests validate the contract continues to hold.

### Step 3: Add session_summary table to db.ts

In the `initDb()` function in `packages/server/src/db.ts`, after the events table creation (around line 149), add:

```typescript
// Materialized session summary for O(1) listSessions
db.run(`
  CREATE TABLE IF NOT EXISTS session_summary (
    session_id TEXT PRIMARY KEY,
    first_event INTEGER NOT NULL,
    last_event INTEGER NOT NULL,
    event_count INTEGER NOT NULL DEFAULT 0,
    tool_count INTEGER NOT NULL DEFAULT 0,
    total_tokens INTEGER NOT NULL DEFAULT 0,
    model TEXT,
    cwd TEXT,
    has_ended INTEGER NOT NULL DEFAULT 0
  )
`);
```

### Step 4: Add upsertSessionSummary function

In `packages/server/src/db.ts`, add after `insertEvent`:

```typescript
export function upsertSessionSummary(params: {
  session_id: string;
  created_at: number;
  event_type: string;
  token_input?: number | null;
  token_output?: number | null;
  model?: string | null;
  cwd?: string | null;
}): void {
  const isTool = ['tool_start', 'tool_end', 'tool_error'].includes(params.event_type);
  const tokens = (params.token_input ?? 0) + (params.token_output ?? 0);
  const isEnd = params.event_type === 'session_end' ? 1 : 0;

  execute(
    `
    INSERT INTO session_summary (session_id, first_event, last_event, event_count, tool_count, total_tokens, model, cwd, has_ended)
    VALUES (?, ?, ?, 1, ?, ?, ?, ?, ?)
    ON CONFLICT(session_id) DO UPDATE SET
      first_event = MIN(session_summary.first_event, excluded.first_event),
      last_event = MAX(session_summary.last_event, excluded.last_event),
      event_count = session_summary.event_count + 1,
      tool_count = session_summary.tool_count + excluded.tool_count,
      total_tokens = session_summary.total_tokens + excluded.total_tokens,
      model = COALESCE(excluded.model, session_summary.model),
      cwd = COALESCE(excluded.cwd, session_summary.cwd),
      has_ended = MAX(session_summary.has_ended, excluded.has_ended)
  `,
    [
      params.session_id,
      params.created_at,
      params.created_at,
      isTool ? 1 : 0,
      tokens,
      params.model ?? null,
      params.cwd ?? null,
      isEnd,
    ],
  );
  scheduleSave();
}
```

### Step 5: Rewrite listSessions to query summary table

Replace the existing `listSessions` function body:

```typescript
export function listSessions(limit = 500, cwd?: string): SessionSummary[] {
  const clauses: string[] = [];
  const values: unknown[] = [];

  if (cwd) {
    clauses.push('cwd = ?');
    values.push(cwd);
  }

  const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';
  values.push(limit);

  // Try materialized summary first; fall back to GROUP BY if empty (pre-migration)
  const summaries = queryAll(
    `SELECT session_id, first_event, last_event, event_count, tool_count, total_tokens, model, cwd, has_ended
     FROM session_summary ${where} ORDER BY last_event DESC LIMIT ?`,
    values,
  ) as unknown as SessionSummary[];

  if (summaries.length > 0) return summaries;

  // Fallback: legacy GROUP BY for databases that haven't been backfilled
  return queryAll(
    `SELECT session_id,
      MIN(created_at) as first_event,
      MAX(created_at) as last_event,
      COUNT(*) as event_count,
      SUM(CASE WHEN event_type IN ('tool_start','tool_end','tool_error') THEN 1 ELSE 0 END) as tool_count,
      COALESCE(SUM(COALESCE(token_input,0) + COALESCE(token_output,0)), 0) as total_tokens,
      MAX(model) as model,
      MAX(cwd) as cwd,
      MAX(CASE WHEN event_type = 'session_end' THEN 1 ELSE 0 END) as has_ended
     FROM events ${where} GROUP BY session_id ORDER BY last_event DESC LIMIT ?`,
    values,
  ) as unknown as SessionSummary[];
}
```

### Step 6: Wire upsert into eventStore.ts

In `packages/server/src/services/eventStore.ts`, in the `storeAndBroadcast` function, right after the `insertEvent(...)` call (around line 215), add:

```typescript
import { insertEvent, upsertSessionSummary } from '../db.js';

// Inside storeAndBroadcast, after insertEvent(...):
upsertSessionSummary({
  session_id: event.sessionId,
  created_at: event.timestamp,
  event_type: event.type,
  token_input: event.tokenUsage?.input,
  token_output: event.tokenUsage?.output,
  model: event.model,
  cwd: normalizedCwd,
});
```

### Step 7: Export upsertSessionSummary from db.ts

Ensure the function is exported and add it to the import in `eventStore.ts`.

### Step 8: Also handle deleteAllEvents and deleteEventsBySession

In `deleteAllEvents()`, add: `execute('DELETE FROM session_summary')`.
In `deleteEventsBySession()`, add: `execute('DELETE FROM session_summary WHERE session_id = ?', [sessionId])`.

This keeps test cleanup working.

### Step 9: Run tests

Run: `pnpm test -- --run packages/server/src/__tests__/db.test.ts`

Expected: All tests PASS, including the new materialization tests.

### Step 10: Run full suite

Run: `pnpm test`

Expected: All pass.

### Step 11: Commit

```bash
git add packages/server/src/db.ts packages/server/src/services/eventStore.ts packages/server/src/__tests__/db.test.ts
git commit -m "perf(server): materialized session_summary table for O(1) listSessions"
```

---

## Task 3: Transcript Fetch Batching

**Files:**

- Modify: `packages/server/src/routes/transcript.ts`
- Modify: `apps/dashboard/src/components/lens/LensAdapter.tsx`
- Test: `packages/server/src/__tests__/transcriptRoutes.test.ts`

### Step 1: Write failing test for batch endpoint

In `packages/server/src/__tests__/transcriptRoutes.test.ts`, add a new test (or create the file following the existing route test pattern):

```typescript
describe('POST /api/transcript/batch', () => {
  it('returns transcript summaries for multiple session IDs', async () => {
    // This test requires the full app setup with supertest.
    // Follow the pattern in routes.test.ts for app initialization.
    const res = await request(app)
      .post('/api/transcript/batch')
      .send({ sessionIds: ['sess-1', 'sess-2'] });

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('sess-1');
    expect(res.body).toHaveProperty('sess-2');
  });

  it('rejects more than 20 session IDs', async () => {
    const ids = Array.from({ length: 21 }, (_, i) => `sess-${i}`);
    const res = await request(app).post('/api/transcript/batch').send({ sessionIds: ids });

    expect(res.status).toBe(400);
  });

  it('returns null for sessions without transcripts', async () => {
    const res = await request(app)
      .post('/api/transcript/batch')
      .send({ sessionIds: ['nonexistent'] });

    expect(res.status).toBe(200);
    expect(res.body.nonexistent).toBeNull();
  });
});
```

### Step 2: Run tests to verify they fail

Run: `pnpm test -- --run packages/server/src/__tests__/transcriptRoutes.test.ts`

Expected: FAIL — route doesn't exist yet.

### Step 3: Add batch endpoint to transcript.ts

In `packages/server/src/routes/transcript.ts`, add before the `/:sessionId` routes:

```typescript
// POST /api/transcript/batch — fetch summaries for multiple sessions
router.post('/batch', async (req: Request, res: Response) => {
  try {
    const { sessionIds } = req.body as { sessionIds?: string[] };

    if (!Array.isArray(sessionIds) || sessionIds.length === 0) {
      res.status(400).json({ error: 'sessionIds array required' });
      return;
    }
    if (sessionIds.length > 20) {
      res.status(400).json({ error: 'Maximum 20 session IDs per batch' });
      return;
    }

    const results: Record<string, TranscriptSummary | null> = {};

    await Promise.all(
      sessionIds.map(async (sessionId) => {
        try {
          const transcriptPath = await resolveTranscriptPath(sessionId);
          if (!transcriptPath) {
            results[sessionId] = null;
            return;
          }
          results[sessionId] = await readTranscript(transcriptPath, sessionId);
        } catch {
          results[sessionId] = null;
        }
      }),
    );

    res.json(results);
  } catch (err: unknown) {
    logger.error({ err }, 'Batch transcript error');
    res.status(500).json({ error: 'Batch transcript read failed' });
  }
});
```

### Step 4: Run backend tests

Run: `pnpm test -- --run packages/server/src/__tests__/transcriptRoutes.test.ts`

Expected: PASS.

### Step 5: Update frontend LensAdapter to use batch fetch

In `apps/dashboard/src/components/lens/LensAdapter.tsx`, replace the per-session fetch loop (lines 336-352):

```typescript
useEffect(() => {
  const unfetched: string[] = [];
  for (const sessionId of sessions.keys()) {
    if (fetchedRef.current.has(sessionId)) continue;
    fetchedRef.current.add(sessionId);
    unfetched.push(sessionId);
  }

  if (unfetched.length === 0) return;

  fetch(apiUrl('/api/transcript/batch'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sessionIds: unfetched }),
  })
    .then((r) => (r.ok ? r.json() : null))
    .then((data: Record<string, TranscriptSummary | null> | null) => {
      if (!data) return;
      const store = useAgentStore.getState();
      for (const [sessionId, summary] of Object.entries(data)) {
        if (summary && summary.turns.length > 0) {
          store.setTranscript(sessionId, summary);
        }
      }
    })
    .catch(() => {
      // Transcripts not available
    });
}, [sessions]);
```

### Step 6: Run full suite

Run: `pnpm test`

Expected: All pass.

### Step 7: Commit

```bash
git add packages/server/src/routes/transcript.ts apps/dashboard/src/components/lens/LensAdapter.tsx packages/server/src/__tests__/transcriptRoutes.test.ts
git commit -m "perf: batch transcript fetching — N requests reduced to 1"
```

---

## Task 4: Virtualization with react-virtuoso

**Files:**

- Modify: `apps/dashboard/package.json` (add dep)
- Modify: `apps/dashboard/src/components/lens/tree/TreeView.tsx`
- Modify: `apps/dashboard/src/components/panels/ToolLogPanel.tsx`

### Step 1: Install react-virtuoso

Run: `cd apps/dashboard && pnpm add react-virtuoso`

### Step 2: Virtualize TreeView

In `apps/dashboard/src/components/lens/tree/TreeView.tsx`:

**a)** Add import:

```typescript
import { Virtuoso } from 'react-virtuoso';
```

**b)** Replace the `flatList.map(...)` block (lines 225-244) with:

```tsx
{
  /* Tree list — virtualized */
}
<div
  ref={containerRef}
  className="flex-1 min-h-0 overflow-hidden focus:outline-none"
  onKeyDown={handleKeyDown}
  tabIndex={0}
>
  <Virtuoso
    data={flatList}
    overscan={200}
    itemContent={(idx, node) => (
      <TreeRow
        key={node.id}
        node={node}
        zoom={zoom}
        isExpanded={expanded.has(node.id)}
        isSelected={
          selectedId === node.id || (node.groupedIds?.includes(selectedId ?? '') ?? false)
        }
        isFocused={idx === focusIndex}
        onToggle={() => toggleExpand(node.id)}
        onClick={() => onSelect(node.id)}
      />
    )}
  />
</div>;
```

Note: Change `overflow-auto` to `overflow-hidden` on the container — Virtuoso manages its own scroll.

### Step 3: Virtualize ToolLogPanel

In `apps/dashboard/src/components/panels/ToolLogPanel.tsx`:

**a)** Add import:

```typescript
import { Virtuoso, type VirtuosoHandle } from 'react-virtuoso';
```

**b)** Add a ref for auto-scroll:

```typescript
const virtuosoRef = useRef<VirtuosoHandle>(null);
```

**c)** Replace the `toolEvents.map(...)` block (lines 88-100) with:

```tsx
<Virtuoso
  ref={virtuosoRef}
  data={toolEvents}
  followOutput="smooth"
  overscan={200}
  itemContent={(idx, event) => (
    <div className="border-b border-gray-800/50">
      <ToolEventRow
        key={event.id}
        event={event}
        agentType={agents.get(event.agentId ?? '')?.agentType}
        isExpanded={expanded.has(event.id)}
        onToggle={() => toggleExpand(event.id)}
      />
    </div>
  )}
/>
```

Note: `followOutput="smooth"` auto-scrolls to new items as they arrive (live mode). The wrapping `<div className="divide-y">` is replaced by per-item `border-b` since Virtuoso renders items individually.

Remove the old `listRef` and `handleScroll` if they existed only for manual scroll tracking — Virtuoso handles this.

### Step 4: Verify manually

Start the dev server (`pnpm dev`) and run a simulation (`npx tsx scripts/simulate_all_nodes.ts`). Verify:

- TreeView scrolls smoothly
- ToolLogPanel auto-scrolls to new events
- Selection highlighting works in both lists
- Keyboard navigation in TreeView still works

### Step 5: Run tests

Run: `pnpm test`

Expected: All pass. TreeView tests should still work since they test data logic, not DOM rendering.

### Step 6: Commit

```bash
git add apps/dashboard/package.json apps/dashboard/src/components/lens/tree/TreeView.tsx apps/dashboard/src/components/panels/ToolLogPanel.tsx pnpm-lock.yaml
git commit -m "perf(dashboard): virtualize TreeView and ToolLogPanel with react-virtuoso"
```

---

## Task 5: Deep Linking via URL Sync

**Files:**

- Create: `apps/dashboard/src/hooks/useUrlSync.ts`
- Modify: `apps/dashboard/src/App.tsx`
- Test: `apps/dashboard/src/hooks/__tests__/useUrlSync.test.ts`

### Step 1: Write test for URL sync logic

Create `apps/dashboard/src/hooks/__tests__/useUrlSync.test.ts`:

```typescript
// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Synapse Contributors

// @vitest-environment jsdom

import { parseUrlState, buildUrlParams } from '../useUrlSync';

describe('parseUrlState', () => {
  it('parses session param', () => {
    const result = parseUrlState(new URLSearchParams('?session=abc'));
    expect(result.sessionId).toBe('abc');
  });

  it('parses node param', () => {
    const result = parseUrlState(new URLSearchParams('?node=agent-1'));
    expect(result.nodeId).toBe('agent-1');
  });

  it('parses tab param', () => {
    const result = parseUrlState(new URLSearchParams('?tab=cost'));
    expect(result.tab).toBe('cost');
  });

  it('parses q param with URI decoding', () => {
    const result = parseUrlState(new URLSearchParams('?q=Read%20file'));
    expect(result.query).toBe('Read file');
  });

  it('returns undefined for missing params', () => {
    const result = parseUrlState(new URLSearchParams(''));
    expect(result.sessionId).toBeUndefined();
    expect(result.nodeId).toBeUndefined();
    expect(result.tab).toBeUndefined();
    expect(result.query).toBeUndefined();
  });
});

describe('buildUrlParams', () => {
  it('builds params from state', () => {
    const params = buildUrlParams({
      sessionId: 'abc',
      nodeId: 'agent-1',
      tab: 'cost',
      query: 'Read',
    });
    expect(params.get('session')).toBe('abc');
    expect(params.get('node')).toBe('agent-1');
    expect(params.get('tab')).toBe('cost');
    expect(params.get('q')).toBe('Read');
  });

  it('omits null/undefined/empty values', () => {
    const params = buildUrlParams({
      sessionId: undefined,
      nodeId: null,
      tab: '',
      query: undefined,
    });
    expect(params.toString()).toBe('');
  });

  it('preserves existing view and cwd params', () => {
    // buildUrlParams should merge with existing non-synced params
    const params = buildUrlParams(
      { sessionId: 'abc' },
      new URLSearchParams('?view=full&cwd=/proj'),
    );
    expect(params.get('view')).toBe('full');
    expect(params.get('cwd')).toBe('/proj');
    expect(params.get('session')).toBe('abc');
  });
});
```

### Step 2: Run tests to verify they fail

Run: `pnpm test -- --run apps/dashboard/src/hooks/__tests__/useUrlSync.test.ts`

Expected: FAIL — module doesn't exist.

### Step 3: Implement useUrlSync hook

Create `apps/dashboard/src/hooks/useUrlSync.ts`:

```typescript
// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Synapse Contributors

import { useEffect, useRef } from 'react';
import { useAgentStore } from '../store/agentStore';

// ── URL param names ──────────────────────────────────────────
const PARAM_SESSION = 'session';
const PARAM_NODE = 'node';
const PARAM_TAB = 'tab';
const PARAM_QUERY = 'q';

// Params we manage — don't touch others (view, cwd)
const MANAGED_PARAMS = [PARAM_SESSION, PARAM_NODE, PARAM_TAB, PARAM_QUERY];

// ── Pure functions (exported for testing) ────────────────────

export interface UrlState {
  sessionId?: string;
  nodeId?: string | null;
  tab?: string;
  query?: string;
}

export function parseUrlState(params: URLSearchParams): UrlState {
  return {
    sessionId: params.get(PARAM_SESSION) ?? undefined,
    nodeId: params.get(PARAM_NODE) ?? undefined,
    tab: params.get(PARAM_TAB) ?? undefined,
    query: params.get(PARAM_QUERY) ?? undefined,
  };
}

export function buildUrlParams(state: UrlState, existing?: URLSearchParams): URLSearchParams {
  const params = new URLSearchParams();

  // Preserve non-managed params (view, cwd, etc.)
  if (existing) {
    existing.forEach((value, key) => {
      if (!MANAGED_PARAMS.includes(key)) {
        params.set(key, value);
      }
    });
  }

  // Set managed params (only if non-empty)
  if (state.sessionId) params.set(PARAM_SESSION, state.sessionId);
  if (state.nodeId) params.set(PARAM_NODE, state.nodeId);
  if (state.tab) params.set(PARAM_TAB, state.tab);
  if (state.query) params.set(PARAM_QUERY, state.query);

  return params;
}

// ── React hook ───────────────────────────────────────────────

export function useUrlSync(): void {
  const isInitialized = useRef(false);

  // Read URL → store on mount
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const state = parseUrlState(params);
    const store = useAgentStore.getState();

    if (state.sessionId) store.setFilter({ sessionId: state.sessionId });
    if (state.nodeId) store.selectNode(state.nodeId);
    if (state.tab) store.setActiveLensTab(state.tab);
    if (state.query) store.setGraphSearchQuery(state.query);

    isInitialized.current = true;
  }, []);

  // Store → URL on change (debounced replaceState)
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;

    const unsub = useAgentStore.subscribe((curr, prev) => {
      if (!isInitialized.current) return;

      const changed =
        curr.filter?.sessionId !== prev.filter?.sessionId ||
        curr.selectedNodeId !== prev.selectedNodeId ||
        curr.activeLensTab !== prev.activeLensTab ||
        curr.graphSearchQuery !== prev.graphSearchQuery;

      if (!changed) return;

      clearTimeout(timer);
      timer = setTimeout(() => {
        const existing = new URLSearchParams(window.location.search);
        const params = buildUrlParams(
          {
            sessionId: curr.filter?.sessionId,
            nodeId: curr.selectedNodeId,
            tab: curr.activeLensTab,
            query: curr.graphSearchQuery,
          },
          existing,
        );
        const newUrl = params.toString()
          ? `${window.location.pathname}?${params.toString()}`
          : window.location.pathname;
        history.replaceState(null, '', newUrl);
      }, 300);
    });

    return () => {
      unsub();
      clearTimeout(timer);
    };
  }, []);

  // Handle back/forward navigation
  useEffect(() => {
    const onPopState = () => {
      const params = new URLSearchParams(window.location.search);
      const state = parseUrlState(params);
      const store = useAgentStore.getState();

      store.setFilter({ sessionId: state.sessionId });
      if (state.nodeId) store.selectNode(state.nodeId);
      else store.selectNode(null);
      if (state.tab) store.setActiveLensTab(state.tab);
      store.setGraphSearchQuery(state.query ?? '');
    };

    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);
}
```

### Step 4: Run URL sync tests

Run: `pnpm test -- --run apps/dashboard/src/hooks/__tests__/useUrlSync.test.ts`

Expected: PASS — the pure functions (`parseUrlState`, `buildUrlParams`) pass.

### Step 5: Mount the hook in App.tsx

In `apps/dashboard/src/App.tsx`, add the import and call inside the main `App` component (before the return):

```typescript
import { useUrlSync } from './hooks/useUrlSync';

function App() {
  // ... existing code ...
  useUrlSync();
  // ... rest of component ...
}
```

### Step 6: Run full suite

Run: `pnpm test`

Expected: All pass.

### Step 7: Commit

```bash
git add apps/dashboard/src/hooks/useUrlSync.ts apps/dashboard/src/hooks/__tests__/useUrlSync.test.ts apps/dashboard/src/App.tsx
git commit -m "feat(dashboard): deep linking — session, node, tab, search synced to URL"
```

---

## Final Verification

### Step 1: Run full test suite

Run: `pnpm test`

Expected: All tests pass.

### Step 2: Build all packages

Run: `pnpm -r build`

Expected: Clean build, no type errors.

### Step 3: Manual verification checklist

- [ ] Start server + client (`pnpm dev`)
- [ ] Run simulation (`npx tsx scripts/simulate_all_nodes.ts`)
- [ ] Open TreeView lens tab — scroll should be smooth with virtualized list
- [ ] Open ToolLogPanel (T key) — events scroll smoothly, auto-scroll on new events
- [ ] Click a session in SessionSelector — URL updates with `?session=...`
- [ ] Click a node — URL updates with `?node=...`
- [ ] Copy URL, open in new tab — same session/node/tab selected
- [ ] Check Network tab — one `/api/transcript/batch` call instead of N individual calls
- [ ] Session list loads instantly (no GROUP BY delay)

### Step 4: Update roadmap

In `docs/ROADMAP.md`, update Phase 4 status:

```
| 4 | Performance + UX | ✅ **DONE** | All items complete |
```

### Step 5: Final commit

```bash
git add docs/ROADMAP.md
git commit -m "docs: mark Phase 4 complete"
```
