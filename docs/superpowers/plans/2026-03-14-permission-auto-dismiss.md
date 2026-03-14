# Permission Auto-Dismiss Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When a permission/question is answered locally in VSCode (not via the dashboard), the dashboard card auto-dismisses reliably and quickly — within 2 seconds or less.

**Architecture:** Three independent detection layers ensure no permission card ever gets stuck: (1) server-side event detection resolves on ANY subsequent event from the same session, (2) server-side connection monitor detects when Claude Code's held HTTP response closes, (3) dashboard-side adaptive polling syncs pending state every 5s when cards are visible. Each layer works independently so failures in one don't affect the others.

**Tech Stack:** Express 5, Node.js `res.socket` API, Zustand, Vitest

<!-- revised: added acceptance criteria per PM review -->

### Acceptance Criteria

- **Layer 1+2:** Auto-dismiss latency < 2s from local answer to card removal
- **Layer 3 (worst-case):** Auto-dismiss latency < 7s (one 5s poll cycle + network round-trip)
- Verified via simulation scripts (`--event-type Stop`, `UserPromptSubmit`, `PreToolUse`, `PostToolUse`)
- Verified via manual test with a real Claude Code session answering locally in VS Code
- All existing tests pass (`pnpm test`)

---

## File Map

| File                                                        | Action | Responsibility                                                                  |
| ----------------------------------------------------------- | ------ | ------------------------------------------------------------------------------- |
| `packages/server/src/routes/events.ts`                      | Modify | Layer 1: expand event matching to all types                                     |
| `packages/server/src/state/permissionState.ts`              | Modify | Layer 2: add connection monitor (start/stop/check)                              |
| `packages/server/src/hookServer.ts`                         | Modify | Layer 2: start monitor when permission created                                  |
| `packages/server/src/index.ts`                              | Modify | <!-- revised: call stopConnectionMonitor on SIGTERM --> Layer 2: clean shutdown |
| `apps/dashboard/src/store/permissionStore.ts`               | Modify | Layer 3: adaptive sync interval logic                                           |
| `apps/dashboard/src/App.tsx`                                | Modify | Layer 3: replace fixed 30s interval with adaptive                               |
| `packages/server/src/__tests__/autoResolve.test.ts`         | Create | Tests for layers 1 + 2                                                          |
| `apps/dashboard/src/store/__tests__/permissionSync.test.ts` | Create | Tests for layer 3                                                               |
| `scripts/simulate_permission_autodismiss.ts`                | Modify | Add `--event-type` flag to test non-PostToolUse resolution                      |

---

## Chunk 1: Layer 1 — Resolve on Any Session Event

### Task 1: Write failing tests for expanded event matching

**Files:**

- Create: `packages/server/src/__tests__/autoResolve.test.ts`

- [ ] **Step 1: Write the test file**

```typescript
// packages/server/src/__tests__/autoResolve.test.ts
import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest';
import type { Express } from 'express';
import request from 'supertest';
import { initDb } from '../db.js';
import { pending } from '../state/permissionState.js';
import type { Broadcaster } from '../services/broadcaster.js';

process.env.SYNAPSE_DB_PATH = ':memory:';

let app: Express;
let broadcaster: Broadcaster;
let broadcastSpy: ReturnType<typeof vi.fn>;

let destroyBroadcaster: () => void;

beforeAll(async () => {
  await initDb();
  const { Broadcaster: B } = await import('../services/broadcaster.js');
  broadcaster = new B();
  destroyBroadcaster = () => broadcaster.destroy();
  broadcastSpy = vi.fn();
  broadcaster.broadcastRaw = broadcastSpy;

  // Build a minimal Express app with the events router
  const express = (await import('express')).default;
  const { createEventsRouter } = await import('../routes/events.js');
  app = express();
  app.use(express.json());
  app.use('/api/events', createEventsRouter(broadcaster));
});

afterAll(() => {
  destroyBroadcaster();
});

afterEach(() => {
  for (const [, entry] of pending.entries()) clearTimeout(entry.timer);
  pending.clear();
  broadcastSpy.mockClear();
});

function seedPending(sessionId: string): string {
  const id = `perm-${Math.random().toString(36).slice(2)}`;
  const mockRes = {
    json: vi.fn(),
    socket: { destroyed: false },
    writableEnded: false,
  };
  pending.set(id, {
    res: mockRes as any,
    event: { session_id: sessionId, tool_name: 'Bash', hook_event_name: 'PermissionRequest' },
    timer: setTimeout(() => {}, 999999),
    createdAt: Date.now(),
  });
  return id;
}

describe('resolveIfSessionAdvanced', () => {
  it('resolves on PostToolUse (existing behavior)', async () => {
    const permId = seedPending('sess-1');
    await request(app).post('/api/events').send({
      hook_event_name: 'PostToolUse',
      session_id: 'sess-1',
      tool_name: 'Bash',
      tool_use_id: 'toolu_1',
      cwd: '/tmp',
    });
    expect(pending.has(permId)).toBe(false);
    expect(broadcastSpy).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'permissionResolved' }),
    );
  });

  it('resolves on Stop event (NEW behavior)', async () => {
    const permId = seedPending('sess-2');
    await request(app).post('/api/events').send({
      hook_event_name: 'Stop',
      session_id: 'sess-2',
      cwd: '/tmp',
    });
    expect(pending.has(permId)).toBe(false);
  });

  it('resolves on UserPromptSubmit event (NEW behavior)', async () => {
    const permId = seedPending('sess-3');
    await request(app).post('/api/events').send({
      hook_event_name: 'UserPromptSubmit',
      session_id: 'sess-3',
      cwd: '/tmp',
      prompt: 'next prompt',
    });
    expect(pending.has(permId)).toBe(false);
  });

  it('resolves on PreToolUse for a DIFFERENT tool (NEW behavior)', async () => {
    const permId = seedPending('sess-4');
    await request(app).post('/api/events').send({
      hook_event_name: 'PreToolUse',
      session_id: 'sess-4',
      tool_name: 'Edit',
      tool_use_id: 'toolu_different',
      cwd: '/tmp',
    });
    expect(pending.has(permId)).toBe(false);
  });

  it('does NOT resolve for a different session', async () => {
    const permId = seedPending('sess-5');
    await request(app).post('/api/events').send({
      hook_event_name: 'PostToolUse',
      session_id: 'sess-OTHER',
      tool_name: 'Bash',
      tool_use_id: 'toolu_other',
      cwd: '/tmp',
    });
    expect(pending.has(permId)).toBe(true);
  });

  it('does NOT resolve on PermissionRequest event (self-loop guard)', async () => {
    const permId = seedPending('sess-self');
    await request(app).post('/api/events').send({
      hook_event_name: 'PermissionRequest',
      session_id: 'sess-self',
      tool_name: 'Bash',
      cwd: '/tmp',
    });
    expect(pending.has(permId)).toBe(true);
  });

  // <!-- revised: added test for multiple pending permissions in same session -->
  it('resolves ALL pending permissions for the same session', async () => {
    const id1 = seedPending('sess-multi');
    const id2 = seedPending('sess-multi');
    await request(app).post('/api/events').send({
      hook_event_name: 'PostToolUse',
      session_id: 'sess-multi',
      tool_name: 'Bash',
      tool_use_id: 'toolu_multi',
      cwd: '/tmp',
    });
    expect(pending.has(id1)).toBe(false);
    expect(pending.has(id2)).toBe(false);
  });

  // <!-- revised: fixed misleading test name — PostToolUseFailure maps to deny, not allow -->
  it('maps PostToolUse→allow, PostToolUseFailure→deny, Stop→allow', async () => {
    // PostToolUse → allow
    const id1 = seedPending('sess-6a');
    await request(app).post('/api/events').send({
      hook_event_name: 'PostToolUse',
      session_id: 'sess-6a',
      tool_name: 'Bash',
      tool_use_id: 'toolu_x',
      cwd: '/tmp',
    });
    const call1 = broadcastSpy.mock.calls.find(
      (c: unknown[]) =>
        (c[0] as Record<string, unknown>).type === 'permissionResolved' &&
        (c[0] as Record<string, Record<string, unknown>>).data.id === id1,
    );
    expect((call1![0] as Record<string, Record<string, unknown>>).data.behavior).toBe('allow');

    broadcastSpy.mockClear();

    // PostToolUseFailure → deny
    const id2 = seedPending('sess-6b');
    await request(app).post('/api/events').send({
      hook_event_name: 'PostToolUseFailure',
      session_id: 'sess-6b',
      tool_name: 'Bash',
      tool_use_id: 'toolu_y',
      cwd: '/tmp',
    });
    const call2 = broadcastSpy.mock.calls.find(
      (c: unknown[]) =>
        (c[0] as Record<string, unknown>).type === 'permissionResolved' &&
        (c[0] as Record<string, Record<string, unknown>>).data.id === id2,
    );
    expect((call2![0] as Record<string, Record<string, unknown>>).data.behavior).toBe('deny');

    broadcastSpy.mockClear();

    // Stop → allow (session ended normally)
    const id3 = seedPending('sess-6c');
    await request(app).post('/api/events').send({
      hook_event_name: 'Stop',
      session_id: 'sess-6c',
      cwd: '/tmp',
    });
    const call3 = broadcastSpy.mock.calls.find(
      (c: unknown[]) =>
        (c[0] as Record<string, unknown>).type === 'permissionResolved' &&
        (c[0] as Record<string, Record<string, unknown>>).data.id === id3,
    );
    expect((call3![0] as Record<string, Record<string, unknown>>).data.behavior).toBe('allow');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/server && npx vitest run src/__tests__/autoResolve.test.ts`
Expected: Tests for Stop, UserPromptSubmit, PreToolUse FAIL (existing code only matches PostToolUse/PostToolUseFailure)

---

### Task 2: Implement expanded event matching

**Files:**

- Modify: `packages/server/src/routes/events.ts:35-69` (rename + expand function)

- [ ] **Step 3: Rename and expand `resolveIfToolCompleted`**

Replace the function at lines 25-69 with:

```typescript
/**
 * When ANY hook event arrives for a session that has a pending permission,
 * the user answered locally — the session moved past the blocked permission.
 *
 * Behavior mapping:
 *   PostToolUse          → allow (tool executed successfully)
 *   PostToolUseFailure   → deny  (tool was rejected or failed)
 *   Everything else      → allow (session advanced, tool was implicitly allowed)
 *
 * We match by session_id only (not tool_use_id) because the PermissionRequest
 * body may not include tool_use_id.
 */
function resolveIfSessionAdvanced(raw: Record<string, unknown>, broadcaster: Broadcaster): void {
  if (pending.size === 0) return;

  const sessionId = raw.session_id as string | undefined;
  if (!sessionId) return;

  // Skip the PermissionRequest event itself — it fires alongside the HTTP hook
  // and should NOT auto-resolve its own pending entry.
  const hookName = raw.hook_event_name as string | undefined;
  if (hookName === 'PermissionRequest') return;

  // <!-- revised: resolve ALL matching permissions for this session, not just the first -->
  // Multiple permissions can exist for the same session (e.g. rapid-fire tool calls
  // from a subagent). Resolve all of them when the session advances.
  for (const [id, entry] of pending) {
    if (entry.event.session_id === sessionId) {
      const behavior = hookName === 'PostToolUseFailure' ? 'deny' : 'allow';
      clearTimeout(entry.timer);
      pending.delete(id);
      // Close the held HTTP response (Claude Code already moved on)
      try {
        entry.res.json({
          hookSpecificOutput: {
            hookEventName: 'PermissionRequest',
            decision: { behavior },
          },
        });
      } catch {
        // Response already closed
      }
      broadcaster.broadcastRaw({
        type: 'permissionResolved',
        data: { id, behavior },
      });
      logger.info({ id, sessionId, hookName }, 'Permission auto-resolved: session advanced');
    }
  }
}
```

- [ ] **Step 4: Update the call site**

At line ~123, rename the call:

```typescript
// Old:
resolveIfToolCompleted(raw, broadcaster);
// New:
resolveIfSessionAdvanced(raw, broadcaster);
```

- [ ] **Step 5: Update hookServer.ts comment**

<!-- revised: fixed old_string to match actual file content (was referencing resolveLocallyAnswered, actual code says resolveLocallyAnswered) -->

In `packages/server/src/hookServer.ts:76-79`, replace the existing comment block that starts with `// Note: req.on('close') was removed`. The current text references `resolveLocallyAnswered()` — update to:

```typescript
// Note: req.on('close') was removed — it fired unreliably (long delay after
// local answer in VS Code). Auto-dismiss is handled by resolveIfSessionAdvanced()
// in events.ts: ANY event from the same session resolves the pending permission.
// Layer 2 (connection monitor) catches cases where no further events arrive.
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `cd packages/server && npx vitest run src/__tests__/autoResolve.test.ts`

<!-- revised: updated test count — added multi-permission test -->

Expected: All 8 tests PASS (6 original + PermissionRequest self-loop guard + multi-permission)

- [ ] **Step 7: Run full server test suite**

Run: `cd packages/server && npx vitest run`
Expected: All existing tests still pass

- [ ] **Step 8: Commit**

```bash
git add packages/server/src/routes/events.ts packages/server/src/hookServer.ts packages/server/src/__tests__/autoResolve.test.ts
git commit -m "feat(server): layer 1 — resolve permissions on any session event

Rename resolveIfToolCompleted → resolveIfSessionAdvanced. Any event
from the same session (Stop, UserPromptSubmit, PreToolUse, etc.)
triggers auto-dismiss, not just PostToolUse/PostToolUseFailure.
Fixes cards staying forever when answered locally in VSCode."
```

---

## Chunk 2: Layer 2 — Server-Side Connection Monitor

### Task 3: Write failing tests for connection monitor

**Files:**

- Modify: `packages/server/src/__tests__/autoResolve.test.ts` (add describe block)

- [ ] **Step 9: Add connection monitor tests**

Append to `autoResolve.test.ts`:

```typescript
import { startConnectionMonitor, stopConnectionMonitor } from '../state/permissionState.js';

describe('connection monitor (Layer 2)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    stopConnectionMonitor();
    vi.useRealTimers();
  });

  it('resolves permission when socket is destroyed', async () => {
    const id = 'perm-conn-1';
    const mockRes = {
      json: vi.fn(),
      socket: { destroyed: false },
      writableEnded: false,
    };
    pending.set(id, {
      res: mockRes as any,
      event: { session_id: 'sess-conn-1', tool_name: 'Bash', hook_event_name: 'PermissionRequest' },
      timer: setTimeout(() => {}, 999999),
      createdAt: Date.now(),
    });

    startConnectionMonitor(broadcaster);

    // Simulate socket close
    mockRes.socket.destroyed = true;

    // Advance past the 2s check interval
    await vi.advanceTimersByTimeAsync(2100);

    expect(pending.has(id)).toBe(false);
    expect(broadcastSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'permissionResolved',
        data: expect.objectContaining({ id, behavior: 'allow' }),
      }),
    );
  });

  it('resolves permission when res.writableEnded is true', async () => {
    const id = 'perm-conn-2';
    const mockRes = {
      json: vi.fn(),
      socket: { destroyed: false },
      writableEnded: false,
    };
    pending.set(id, {
      res: mockRes as any,
      event: { session_id: 'sess-conn-2', tool_name: 'Edit', hook_event_name: 'PermissionRequest' },
      timer: setTimeout(() => {}, 999999),
      createdAt: Date.now(),
    });

    startConnectionMonitor(broadcaster);
    mockRes.writableEnded = true;

    await vi.advanceTimersByTimeAsync(2100);

    expect(pending.has(id)).toBe(false);
  });

  it('does NOT resolve when socket is still alive', async () => {
    const id = 'perm-conn-3';
    const mockRes = {
      json: vi.fn(),
      socket: { destroyed: false },
      writableEnded: false,
    };
    pending.set(id, {
      res: mockRes as any,
      event: { session_id: 'sess-conn-3', tool_name: 'Bash', hook_event_name: 'PermissionRequest' },
      timer: setTimeout(() => {}, 999999),
      createdAt: Date.now(),
    });

    startConnectionMonitor(broadcaster);
    await vi.advanceTimersByTimeAsync(2100);

    // Socket still alive — should NOT resolve
    expect(pending.has(id)).toBe(true);
  });

  it('auto-stops when pending map is empty', async () => {
    // Start with nothing pending
    startConnectionMonitor(broadcaster);
    // Advance past the first tick
    await vi.advanceTimersByTimeAsync(2100);
    // Monitor should have auto-stopped — no errors, no broadcasts
    expect(broadcastSpy).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 10: Run tests to verify they fail**

Run: `cd packages/server && npx vitest run src/__tests__/autoResolve.test.ts`
Expected: FAIL — `startConnectionMonitor` and `stopConnectionMonitor` don't exist yet

---

### Task 4: Implement connection monitor

**Files:**

- Modify: `packages/server/src/state/permissionState.ts`

- [ ] **Step 11: Add connection monitor to permissionState.ts**

Add at the bottom of the file:

```typescript
import { logger } from '../lib/logger.js';
import type { Broadcaster } from '../services/broadcaster.js';

// ── Layer 2: Connection monitor ───────────────────────────────
// Periodically checks if the held HTTP response socket is still alive.
// When Claude Code answers locally and closes the connection, this detects
// the dead socket and resolves the permission within ~2 seconds.

const CONNECTION_CHECK_INTERVAL_MS = 2000;
let connectionMonitor: ReturnType<typeof setInterval> | null = null;
let monitorBroadcaster: Broadcaster | null = null;

export function startConnectionMonitor(broadcaster: Broadcaster): void {
  monitorBroadcaster = broadcaster;
  if (connectionMonitor) return; // Already running

  connectionMonitor = setInterval(() => {
    if (pending.size === 0) {
      stopConnectionMonitor();
      return;
    }

    for (const [id, entry] of pending) {
      const res = entry.res as unknown as {
        writableEnded?: boolean;
        socket?: { destroyed?: boolean } | null;
      };
      const socketDead = res.socket?.destroyed ?? false;
      const writableEnded = res.writableEnded ?? false;

      if (socketDead || writableEnded) {
        clearTimeout(entry.timer);
        pending.delete(id);

        // <!-- revised: removed dead res.json() call — socket is confirmed dead, response is undeliverable -->
        // No need to send a response — the socket is already closed.
        // Layer 2 only needs to clean up state and notify the dashboard.

        monitorBroadcaster?.broadcastRaw({
          type: 'permissionResolved',
          data: { id, behavior: 'allow' },
        });
        logger.info({ id }, 'Permission auto-resolved: connection closed (Layer 2)');
      }
    }
  }, CONNECTION_CHECK_INTERVAL_MS);
}

export function stopConnectionMonitor(): void {
  if (connectionMonitor) {
    clearInterval(connectionMonitor);
    connectionMonitor = null;
  }
}
```

Note: The `logger` import needs to be added at the top. Since this file currently has no imports beyond Express types, add:

```typescript
import { logger } from '../lib/logger.js';
import type { Broadcaster } from '../services/broadcaster.js';
```

- [ ] **Step 12: Start monitor when permissions are created**

In `packages/server/src/hookServer.ts`, after `pending.set(id, ...)` (around line 74), add:

```typescript
import { startConnectionMonitor } from './state/permissionState.js';

// After: pending.set(id, { res, event: req.body, timer, createdAt });
startConnectionMonitor(broadcaster);
```

The `startConnectionMonitor` import goes at the top with the other permissionState imports. The function is idempotent (no-ops if already running), so calling it on every permission creation is safe.

- [ ] **Step 12b: Call `stopConnectionMonitor` on server shutdown**

<!-- revised: prevent interval from keeping event loop alive on SIGTERM -->

In `packages/server/src/index.ts`, find the existing shutdown/cleanup handler (e.g. `process.on('SIGTERM', ...)` or `process.on('SIGINT', ...)`). Add:

```typescript
import { stopConnectionMonitor } from './state/permissionState.js';

// Inside the shutdown handler:
stopConnectionMonitor();
```

If no shutdown handler exists, add one:

```typescript
function shutdown() {
  stopConnectionMonitor();
  // ... other cleanup
  process.exit(0);
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
```

- [ ] **Step 13: Run tests to verify they pass**

Run: `cd packages/server && npx vitest run src/__tests__/autoResolve.test.ts`
Expected: All tests (Layer 1 + Layer 2) PASS

- [ ] **Step 14: Run full server test suite**

Run: `cd packages/server && npx vitest run`
Expected: All existing tests still pass

- [ ] **Step 15: Commit**

```bash
git add packages/server/src/state/permissionState.ts packages/server/src/hookServer.ts packages/server/src/__tests__/autoResolve.test.ts
git commit -m "feat(server): layer 2 — connection monitor for dead sockets

Poll pending HTTP responses every 2s. When Claude Code answers locally
and closes the connection, the dead socket triggers auto-resolve.
Catches cases where no further events arrive for the session."
```

---

## Chunk 3: Layer 3 — Dashboard Adaptive Sync

### Task 5: Write failing tests for adaptive sync

**Files:**

- Create: `apps/dashboard/src/store/__tests__/permissionSync.test.ts`

- [ ] **Step 16: Write adaptive sync tests**

```typescript
// apps/dashboard/src/store/__tests__/permissionSync.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock fetch globally
const fetchSpy = vi.fn();
vi.stubGlobal('fetch', fetchSpy);

describe('adaptive permission sync', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    fetchSpy.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('exports createAdaptiveSync that returns start/stop/notify', async () => {
    const { createAdaptiveSync } = await import('../permissionStore.js');
    const sync = createAdaptiveSync();
    expect(typeof sync.start).toBe('function');
    expect(typeof sync.stop).toBe('function');
    expect(typeof sync.notifyPendingChange).toBe('function');
  });

  it('uses fast interval (5s) when pending count > 0', async () => {
    fetchSpy.mockResolvedValue({ ok: true, json: () => Promise.resolve([]) });
    const { createAdaptiveSync } = await import('../permissionStore.js');
    const sync = createAdaptiveSync();
    sync.start();
    sync.notifyPendingChange(1); // Signal that we have pending cards

    // Advance 5s — should trigger a sync
    await vi.advanceTimersByTimeAsync(5000);
    expect(fetchSpy).toHaveBeenCalled();

    sync.stop();
  });

  it('uses slow interval (30s) when pending count is 0', async () => {
    fetchSpy.mockResolvedValue({ ok: true, json: () => Promise.resolve([]) });
    const { createAdaptiveSync } = await import('../permissionStore.js');
    const sync = createAdaptiveSync();
    sync.start();
    sync.notifyPendingChange(0); // No pending cards

    // Advance 5s — should NOT trigger
    await vi.advanceTimersByTimeAsync(5000);
    expect(fetchSpy).not.toHaveBeenCalled();

    // Advance to 30s — should trigger
    await vi.advanceTimersByTimeAsync(25000);
    expect(fetchSpy).toHaveBeenCalled();

    sync.stop();
  });
});
```

- [ ] **Step 17: Run tests to verify they fail**

Run: `cd apps/dashboard && npx vitest run src/store/__tests__/permissionSync.test.ts`
Expected: FAIL — `createAdaptiveSync` doesn't exist yet

---

### Task 6: Implement adaptive sync

**Files:**

- Modify: `apps/dashboard/src/store/permissionStore.ts`
- Modify: `apps/dashboard/src/App.tsx:91-100`

- [ ] **Step 18: Add `createAdaptiveSync` to permissionStore.ts**

Add at the bottom of the file, before the final closing:

```typescript
// ── Layer 3: Adaptive sync interval ─────────────────────────
// When permission cards are visible, poll every 5s for fast auto-dismiss.
// When no cards are pending, back off to 30s as a safety net.

const FAST_SYNC_MS = 5_000;
const SLOW_SYNC_MS = 30_000;

export function createAdaptiveSync() {
  let timer: ReturnType<typeof setInterval> | null = null;
  let currentInterval = SLOW_SYNC_MS;
  let pendingCount = 0;

  function restart(intervalMs: number) {
    if (timer) clearInterval(timer);
    currentInterval = intervalMs;
    timer = setInterval(syncPermissions, currentInterval);
  }

  return {
    start() {
      if (timer) return;
      timer = setInterval(syncPermissions, currentInterval);
    },

    stop() {
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
    },

    /** Call when the number of pending permission cards changes */
    notifyPendingChange(count: number) {
      pendingCount = count;
      const targetInterval = count > 0 ? FAST_SYNC_MS : SLOW_SYNC_MS;
      if (targetInterval !== currentInterval) {
        restart(targetInterval);
      }
    },
  };
}
```

- [ ] **Step 19: Wire adaptive sync into App.tsx**

In `apps/dashboard/src/App.tsx`, replace the fixed 30s interval (lines ~91-100):

```typescript
// Old:
const syncTimer = setInterval(syncPermissions, 30_000);
return () => {
  wsClient.disconnect();
  clearInterval(syncTimer);
};

// New:
import { createAdaptiveSync } from '../store/permissionStore';

// <!-- revised: explicitly note this must be in the mount-only useEffect ([] deps) -->
// Inside the useEffect with [] deps (mount-only):
const adaptiveSync = createAdaptiveSync();
adaptiveSync.start();

// Subscribe to pending count changes — switches between 5s/30s intervals.
// Uses vanilla subscribe (not subscribeWithSelector) since the store
// doesn't use that middleware.
let prevCount = usePermissionStore.getState().pending.length;
const unsub = usePermissionStore.subscribe((s) => {
  const count = s.pending.length;
  if (count !== prevCount) {
    prevCount = count;
    adaptiveSync.notifyPendingChange(count);
  }
});

return () => {
  wsClient.disconnect();
  adaptiveSync.stop();
  unsub();
};
```

- [ ] **Step 20: Run tests to verify they pass**

Run: `cd apps/dashboard && npx vitest run src/store/__tests__/permissionSync.test.ts`
Expected: All tests PASS

- [ ] **Step 21: Run full dashboard test suite**

Run: `cd apps/dashboard && npx vitest run`
Expected: All existing tests still pass

- [ ] **Step 22: Commit**

```bash
git add apps/dashboard/src/store/permissionStore.ts apps/dashboard/src/App.tsx apps/dashboard/src/store/__tests__/permissionSync.test.ts
git commit -m "feat(dashboard): layer 3 — adaptive permission sync

Poll every 5s when permission cards are visible, 30s otherwise.
Catches any case layers 1+2 miss (WS drops, server restart).
Replaces the fixed 30s safety-net interval."
```

---

## Chunk 4: Integration Testing & Simulation Update

### Task 7: Update simulation script

**Files:**

- Modify: `scripts/simulate_permission_autodismiss.ts`

- [ ] **Step 23: Add `--event-type` flag to simulation**

Add support for testing non-PostToolUse resolution. After the `toolName` const (line 25):

```typescript
const resolveEvent = args[args.indexOf('--event-type') + 1] || 'PostToolUse';
```

Then in step 4 (line ~128), replace the hardcoded PostToolUse with:

```typescript
log('3️⃣', `Sending ${resolveEvent} (same session) → should trigger auto-dismiss...`);
await postEvent(
  {
    hook_event_name: resolveEvent,
    session_id: SESSION_ID,
    cwd: CWD,
    permission_mode: 'default',
    ...(resolveEvent.includes('Tool')
      ? { tool_name: toolName, tool_use_id: TOOL_USE_ID, tool_input: toolInput }
      : {}),
    ...(resolveEvent === 'UserPromptSubmit' ? { prompt: 'next prompt after approval' } : {}),
  },
  `${resolveEvent} (local answer)`,
);
```

Update the verification section at the end:

```typescript
console.log(`\n  What to verify on the dashboard:`);
console.log(`  • Permission card appeared after step 2`);
console.log(`  • Card auto-dismissed after step 3 (${resolveEvent})`);
console.log(`  • Card moved to "resolved" list (not just vanished)`);
console.log(`\n  Try other event types: --event-type Stop`);
console.log(`                         --event-type UserPromptSubmit`);
console.log(`                         --event-type PreToolUse\n`);
```

- [ ] **Step 24: Commit**

```bash
git add scripts/simulate_permission_autodismiss.ts
git commit -m "feat(scripts): add --event-type flag to permission simulator

Allows testing auto-dismiss with Stop, UserPromptSubmit, PreToolUse
events in addition to the default PostToolUse."
```

---

### Task 8: Manual integration test

<!-- revised: moved dashboard build to post-merge step (Chunk 5) to avoid pulling unrelated changes -->

Start the dev server (`.\start-server.ps1` + `.\start-client.ps1`) and run simulations against localhost:5173.

- [ ] **Step 25: Test Layer 1 with simulation**

```bash
# Test PostToolUse (existing)
npx tsx scripts/simulate_permission_autodismiss.ts --delay 3

# Test Stop event (new)
npx tsx scripts/simulate_permission_autodismiss.ts --delay 3 --event-type Stop

# Test UserPromptSubmit (new)
npx tsx scripts/simulate_permission_autodismiss.ts --delay 3 --event-type UserPromptSubmit
```

Verify on both localhost:5173 and localhost:27246:

- Permission card appears
- Card auto-dismisses within 1 second of the resolve event
- Card moves to "resolved" list

- [ ] **Step 27: Test Layer 3 with dashboard sync**

Open dashboard, verify:

- With pending cards: network tab shows `/api/permissions/pending` requests every ~5s
- After all cards dismiss: requests drop to every ~30s

- [ ] **Step 28: Run full test suite**

```bash
pnpm test
```

Expected: All tests pass across all packages

- [ ] **Step 29: Verify with a real Claude Code session**

Start a Claude Code session in VS Code, trigger a permission request (e.g. run a Bash command that requires approval), answer it locally in the terminal, and verify the dashboard card auto-dismisses within 2 seconds.

---

## Chunk 5: Post-Merge Build <!-- revised: separated from Chunk 4 -->

### Task 9: Rebuild dashboard and package

- [ ] **Step 30: Build and copy dashboard**

```bash
# Build dashboard for production
pnpm --filter dashboard build

# Copy to server static dir
cp -r apps/dashboard/dist/* apps/vscode/resources/synapse-server/dashboard/
```

- [ ] **Step 31: Commit build artifacts**

```bash
git add apps/vscode/resources/synapse-server/dashboard/
git commit -m "build: rebuild dashboard with permission auto-dismiss fixes"
```

---

## Open Questions / Deferred

<!-- P2 findings from plan review — address in future iterations -->

- **Auto-dismiss visual feedback:** Currently cards silently move to the "resolved" list. Consider adding a brief toast ("Permission auto-resolved — answered locally") or a fade-out animation so the user understands why the card vanished. Low priority since the resolved list already shows the history.
- **Layer 3 debug indicator:** No visible way to verify the adaptive sync interval switched from 30s to 5s. For debugging, rely on browser Network tab. Could add a dev-tools-only console.log if needed.
- **Test `afterAll` placement:** The `destroyBroadcaster` call in `afterAll` is at module scope rather than inside a `describe` block. Works fine in Vitest (file-level isolation), but would need restructuring if the test file grows multiple independent describe blocks sharing the app instance.
- **Test name for behavior mapping test:** Title could be more descriptive but the assertions are correct.
