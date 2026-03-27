# Remote Approval — Phase A1 Backend Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the backend infrastructure for remote permission approval — hook server on fixed port 27247, deferred-response pattern, shared state, and REST endpoints — so that `curl POST → curl PUT` resolves end-to-end.

**Architecture:** A second Express server (hook server) on fixed port 27247 receives Claude Code HTTP hook POSTs and holds the response open. A shared in-memory state module (`permissionState.ts`) connects it to the main server, where `PUT /api/permissions/:id/decision` resolves the held response. Both servers run in the same Node.js process. A no-op `pushService` stub allows Phase A1 code to compile before Phase B implements real push.

**Tech Stack:** Express 5, sql.js (via existing db.ts helpers), ws (existing Broadcaster), Zod 4, pino, TypeScript

**Spec:** [2026-03-11-remote-approval-and-prompt-interceptor-design.md](../specs/2026-03-11-remote-approval-and-prompt-interceptor-design.md)

---

## Chunk 1: Core Types, Shared State, and Push Stub

### Task 1: ClaudeHookEvent type in @synapse-ai/core

**Files:**

- Create: `packages/core/src/types/hooks.ts`
- Modify: `packages/core/src/index.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/core/src/__tests__/hooks.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import type { ClaudeHookEvent } from '@synapse-ai/core';

describe('ClaudeHookEvent', () => {
  it('accepts a valid PermissionRequest hook payload', () => {
    const event: ClaudeHookEvent = {
      session_id: 'sess-abc',
      tool_name: 'Bash',
      tool_input: { command: 'rm -rf build/' },
      hook_event_name: 'PermissionRequest',
    };
    expect(event.session_id).toBe('sess-abc');
    expect(event.tool_name).toBe('Bash');
    expect(event.hook_event_name).toBe('PermissionRequest');
  });

  it('accepts extra fields via index signature', () => {
    const event: ClaudeHookEvent = {
      session_id: 'sess-abc',
      hook_event_name: 'PermissionRequest',
      transcript_path: '/some/path',
    };
    expect(event.transcript_path).toBe('/some/path');
  });

  it('requires session_id and hook_event_name', () => {
    // This is a compile-time check — if the type is wrong, TS will error.
    // At runtime, just verify the shape.
    const event: ClaudeHookEvent = {
      session_id: 'x',
      hook_event_name: 'PermissionRequest',
    };
    expect(event.session_id).toBeDefined();
    expect(event.hook_event_name).toBeDefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- packages/core/src/__tests__/hooks.test.ts`
Expected: FAIL — `ClaudeHookEvent` not found in `@synapse-ai/core`

- [ ] **Step 3: Create the type file**

Create `packages/core/src/types/hooks.ts`:

```typescript
// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Bernhard

/**
 * Shape of the JSON body Claude Code sends to HTTP hooks.
 * Known fields are typed explicitly; the index signature
 * allows future/unknown fields to pass through.
 */
export interface ClaudeHookEvent {
  session_id: string;
  tool_name?: string;
  tool_input?: unknown;
  hook_event_name: string;
  [key: string]: unknown;
}
```

- [ ] **Step 4: Export from barrel**

Add to `packages/core/src/index.ts` after the existing coaching type exports (after line 69):

```typescript
export type { ClaudeHookEvent } from './types/hooks.js';
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm test -- packages/core/src/__tests__/hooks.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/types/hooks.ts packages/core/src/__tests__/hooks.test.ts packages/core/src/index.ts
git commit -m "feat(core): add ClaudeHookEvent type for HTTP hook payloads"
```

---

### Task 2: WsServerMessage — add permission variants

**Files:**

- Modify: `packages/core/src/types/agent.ts` (lines 144–150)
- Test: `packages/core/src/__tests__/hooks.test.ts` (extend)

- [ ] **Step 1: Write the failing test**

Append to `packages/core/src/__tests__/hooks.test.ts`:

```typescript
import type { WsServerMessage } from '@synapse-ai/core';

describe('WsServerMessage permission variants', () => {
  it('accepts pendingPermission message', () => {
    const msg: WsServerMessage = {
      type: 'pendingPermission',
      data: {
        id: 'perm-1',
        tool_name: 'Bash',
        tool_input_preview: 'rm -rf build/',
        createdAt: Date.now(),
        expiresAt: Date.now() + 1800000,
      },
    };
    expect(msg.type).toBe('pendingPermission');
  });

  it('accepts permissionResolved message', () => {
    const msg: WsServerMessage = {
      type: 'permissionResolved',
      data: { id: 'perm-1', behavior: 'allow' },
    };
    expect(msg.type).toBe('permissionResolved');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- packages/core/src/__tests__/hooks.test.ts`
Expected: FAIL — `pendingPermission` not assignable to `WsServerMessage`

- [ ] **Step 3: Add the new variants to WsServerMessage**

In `packages/core/src/types/agent.ts`, add to the `WsServerMessage` union (after line 150, before the semicolon):

```typescript
  | { type: 'pendingPermission'; data: { id: string; tool_name: string; tool_input_preview: string; createdAt: number; expiresAt: number } }
  | { type: 'permissionResolved'; data: { id: string; behavior: 'allow' | 'deny' } }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test -- packages/core/src/__tests__/hooks.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/types/agent.ts packages/core/src/__tests__/hooks.test.ts
git commit -m "feat(core): add pendingPermission + permissionResolved to WsServerMessage"
```

---

### Task 3: Shared state module — permissionState.ts

**Files:**

- Create: `packages/server/src/state/permissionState.ts`
- Test: `packages/server/src/__tests__/permissionState.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/server/src/__tests__/permissionState.test.ts`:

```typescript
import { describe, it, expect, beforeEach } from 'vitest';

// Import will fail until the module exists
import {
  pending,
  decisions,
  MAX_PENDING,
  PERMISSION_TIMEOUT_MS,
  purgeExpiredDecisions,
} from '../state/permissionState.js';

describe('permissionState', () => {
  beforeEach(() => {
    pending.clear();
    decisions.clear();
  });

  it('exports empty Maps and constants', () => {
    expect(pending.size).toBe(0);
    expect(decisions.size).toBe(0);
    expect(MAX_PENDING).toBe(50);
    expect(PERMISSION_TIMEOUT_MS).toBeGreaterThan(0);
  });

  it('PERMISSION_TIMEOUT_MS defaults to 1800000 (30 min)', () => {
    // env var not set in test → default
    expect(PERMISSION_TIMEOUT_MS).toBe(1800000);
  });

  it('purgeExpiredDecisions removes expired entries', () => {
    decisions.set('old', { behavior: 'allow', expiresAt: Date.now() - 1000 });
    decisions.set('fresh', { behavior: 'deny', expiresAt: Date.now() + 60000 });
    purgeExpiredDecisions();
    expect(decisions.has('old')).toBe(false);
    expect(decisions.has('fresh')).toBe(true);
  });

  it('purgeExpiredDecisions is a no-op on empty map', () => {
    purgeExpiredDecisions();
    expect(decisions.size).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- packages/server/src/__tests__/permissionState.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Create the shared state module**

Create directory `packages/server/src/state/` and file `packages/server/src/state/permissionState.ts`:

```typescript
// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Bernhard

import type { Response } from 'express';
import type { ClaudeHookEvent } from '@synapse-ai/core';

export interface PendingEntry {
  res: Response;
  event: ClaudeHookEvent;
  timer: NodeJS.Timeout;
  createdAt: number;
}

export interface DecisionEntry {
  behavior: 'allow' | 'deny';
  expiresAt: number;
}

export const pending = new Map<string, PendingEntry>();
export const decisions = new Map<string, DecisionEntry>();
export const MAX_PENDING = 50;

/** Default 30 min. Overridable via env var. */
export const PERMISSION_TIMEOUT_MS = parseInt(
  process.env.SYNAPSE_PERMISSION_TIMEOUT_MS ?? '1800000',
  10,
);

export function purgeExpiredDecisions(): void {
  const now = Date.now();
  for (const [id, d] of decisions.entries()) {
    if (d.expiresAt < now) decisions.delete(id);
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test -- packages/server/src/__tests__/permissionState.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/state/permissionState.ts packages/server/src/__tests__/permissionState.test.ts
git commit -m "feat(server): add permissionState shared state module"
```

---

### Task 4: No-op pushService stub

**Files:**

- Create: `packages/server/src/services/pushService.ts`
- Test: `packages/server/src/__tests__/pushService.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/server/src/__tests__/pushService.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { sendToAll } from '../services/pushService.js';

describe('pushService (stub)', () => {
  it('sendToAll resolves without error', async () => {
    await expect(
      sendToAll({
        title: 'Test',
        body: 'test body',
        requestId: 'req-1',
        url: '/',
      }),
    ).resolves.toBeUndefined();
  });

  it('sendToAll can be called multiple times', async () => {
    await sendToAll({ title: 'A', body: '', requestId: '1', url: '/' });
    await sendToAll({ title: 'B', body: '', requestId: '2', url: '/' });
    // No throw = pass
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- packages/server/src/__tests__/pushService.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Create the stub**

Create `packages/server/src/services/pushService.ts`:

```typescript
// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Bernhard
//
// No-op stub for push notifications. Phase B replaces this
// with real web-push VAPID implementation.

export interface PushPayload {
  title: string;
  body: string;
  requestId: string;
  url: string;
}

/** No-op in Phase A — Phase B replaces with real web-push. */
export async function sendToAll(_payload: PushPayload): Promise<void> {
  // Intentionally empty — stub for Phase A compilation
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test -- packages/server/src/__tests__/pushService.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/services/pushService.ts packages/server/src/__tests__/pushService.test.ts
git commit -m "feat(server): add no-op pushService stub for Phase A compilation"
```

---

## Chunk 2: Database Migration and Hook Server

### Task 5: Database migration — permission_events + push_subscriptions tables

**Files:**

- Modify: `packages/server/src/db.ts` (add tables in `initDb()` schema creation)
- Test: `packages/server/src/__tests__/permissionDb.test.ts`

**Context:** The existing codebase creates tables inline in `initDb()` (no separate migration files). Follow the same pattern — add `CREATE TABLE IF NOT EXISTS` statements to the existing schema block in `db.ts`.

- [ ] **Step 1: Write the failing test**

Create `packages/server/src/__tests__/permissionDb.test.ts`:

```typescript
import { describe, it, expect, beforeAll } from 'vitest';
import { initDb, analyticsExecute, analyticsQueryAll } from '../db.js';

// Use temp DB for test isolation
process.env.SYNAPSE_DB_PATH = ':memory:';

beforeAll(async () => {
  await initDb();
});

describe('permission_events table', () => {
  it('can insert and query a permission event', () => {
    const id = 'perm-test-1';
    const now = Date.now();
    analyticsExecute(
      `INSERT INTO permission_events (id, session_id, tool_name, tool_input, behavior, latency_ms, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [id, 'sess-1', 'Bash', 'rm -rf build/', 'allow', 1234, now],
    );

    const rows = analyticsQueryAll('SELECT * FROM permission_events WHERE id = ?', [id]);
    expect(rows).toHaveLength(1);
    expect(rows[0].session_id).toBe('sess-1');
    expect(rows[0].tool_name).toBe('Bash');
    expect(rows[0].behavior).toBe('allow');
    expect(rows[0].latency_ms).toBe(1234);
  });
});

describe('push_subscriptions table', () => {
  it('can insert and query a push subscription', () => {
    const id = 'push-test-1';
    const now = Date.now();
    analyticsExecute(
      `INSERT INTO push_subscriptions (id, endpoint, keys_p256dh, keys_auth, user_agent, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [id, 'https://fcm.googleapis.com/fcm/send/abc', 'p256dh-key', 'auth-key', 'Chrome/120', now],
    );

    const rows = analyticsQueryAll('SELECT * FROM push_subscriptions WHERE id = ?', [id]);
    expect(rows).toHaveLength(1);
    expect(rows[0].endpoint).toBe('https://fcm.googleapis.com/fcm/send/abc');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- packages/server/src/__tests__/permissionDb.test.ts`
Expected: FAIL — `no such table: permission_events`

- [ ] **Step 3: Add CREATE TABLE statements to db.ts initDb()**

In `packages/server/src/db.ts`, find the `initDb()` function and add these `CREATE TABLE IF NOT EXISTS` statements alongside the existing table creations (after the last existing `CREATE TABLE` block, before any `CREATE INDEX` blocks):

```sql
CREATE TABLE IF NOT EXISTS permission_events (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  tool_name TEXT NOT NULL,
  tool_input TEXT,
  behavior TEXT NOT NULL,
  latency_ms INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS push_subscriptions (
  id TEXT PRIMARY KEY,
  endpoint TEXT NOT NULL UNIQUE,
  keys_p256dh TEXT NOT NULL,
  keys_auth TEXT NOT NULL,
  user_agent TEXT,
  created_at INTEGER NOT NULL
);
```

Add indexes:

```sql
CREATE INDEX IF NOT EXISTS idx_permission_events_session ON permission_events(session_id);
CREATE INDEX IF NOT EXISTS idx_permission_events_created ON permission_events(created_at);
CREATE INDEX IF NOT EXISTS idx_push_subscriptions_endpoint ON push_subscriptions(endpoint);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test -- packages/server/src/__tests__/permissionDb.test.ts`
Expected: PASS

- [ ] **Step 5: Run full test suite to check for regressions**

Run: `pnpm test`
Expected: All existing tests pass

- [ ] **Step 6: Commit**

```bash
git add packages/server/src/db.ts packages/server/src/__tests__/permissionDb.test.ts
git commit -m "feat(server): add permission_events + push_subscriptions tables"
```

---

### Task 6: Hook server — hookServer.ts

**Files:**

- Create: `packages/server/src/hookServer.ts`
- Test: `packages/server/src/__tests__/hookServer.test.ts`

**Context:** This is a second Express app on a separate fixed port (27247). It must share the same process as the main server. It does NOT use the existing `createApp()` — it has its own minimal Express instance with `server.timeout = 0` (no request timeout, since permission responses are deferred up to 30 min). Rate limiting at 60 req/min. No auth (Claude Code can't send Bearer tokens).

- [ ] **Step 1: Write the failing test**

Create `packages/server/src/__tests__/hookServer.test.ts`:

```typescript
import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { initDb } from '../db.js';
import { pending } from '../state/permissionState.js';

// We test the Express app directly (not the listen() part)
process.env.SYNAPSE_DB_PATH = ':memory:';

let app: Express;

beforeAll(async () => {
  await initDb();
  // Dynamic import after env setup
  const { createHookApp } = await import('../hookServer.js');
  const { Broadcaster } = await import('../services/broadcaster.js');
  const broadcaster = new Broadcaster();
  app = createHookApp({ broadcaster, disableRateLimiting: true });
});

afterEach(() => {
  // Clean up pending entries (clear timers too)
  for (const [, entry] of pending.entries()) {
    clearTimeout(entry.timer);
  }
  pending.clear();
});

describe('POST /api/hooks/permission', () => {
  it('holds the response open (deferred pattern)', async () => {
    // Start the POST — it should NOT resolve immediately
    const postPromise = request(app)
      .post('/api/hooks/permission')
      .send({
        session_id: 'sess-1',
        tool_name: 'Bash',
        tool_input: { command: 'ls' },
        hook_event_name: 'PermissionRequest',
      });

    // Give the server a tick to process
    await new Promise((r) => setTimeout(r, 50));

    // There should now be 1 pending entry
    expect(pending.size).toBe(1);

    // Resolve it by finding the id and responding
    const [id, entry] = [...pending.entries()][0];
    clearTimeout(entry.timer);
    entry.res.json({
      hookSpecificOutput: {
        hookEventName: 'PermissionRequest',
        decision: { behavior: 'allow' },
      },
    });
    pending.delete(id);

    const res = await postPromise;
    expect(res.status).toBe(200);
    expect(res.body.hookSpecificOutput.decision.behavior).toBe('allow');
  });

  it('returns 429 when MAX_PENDING is reached', async () => {
    // Fill pending to max (mock entries — no real response objects needed for count check)
    const { MAX_PENDING } = await import('../state/permissionState.js');
    for (let i = 0; i < MAX_PENDING; i++) {
      pending.set(`fill-${i}`, {
        res: {} as any,
        event: { session_id: 's', hook_event_name: 'PermissionRequest' },
        timer: setTimeout(() => {}, 999999),
        createdAt: Date.now(),
      });
    }

    const res = await request(app).post('/api/hooks/permission').send({
      session_id: 'sess-overflow',
      hook_event_name: 'PermissionRequest',
    });

    expect(res.status).toBe(429);
    expect(res.body.error).toContain('Too many');
  });
});

describe('GET /api/hook-server/status', () => {
  it('returns running status', async () => {
    const res = await request(app).get('/api/hook-server/status');
    expect(res.status).toBe(200);
    expect(res.body.running).toBe(true);
    expect(res.body.port).toBeDefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- packages/server/src/__tests__/hookServer.test.ts`
Expected: FAIL — `../hookServer.js` not found

- [ ] **Step 3: Create hookServer.ts**

Create `packages/server/src/hookServer.ts`:

```typescript
// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Bernhard

import express from 'express';
import crypto from 'crypto';
import rateLimit from 'express-rate-limit';
import { logger } from './lib/logger.js';
import { Broadcaster } from './services/broadcaster.js';
import { pending, MAX_PENDING, PERMISSION_TIMEOUT_MS } from './state/permissionState.js';
import { sendToAll } from './services/pushService.js';

const HOOK_PORT = parseInt(process.env.SYNAPSE_HOOK_PORT ?? '27247', 10);

export interface HookAppDeps {
  broadcaster: Broadcaster;
  /** Disable rate limiting (useful for tests) */
  disableRateLimiting?: boolean;
}

/**
 * Creates the hook server Express app (separate from main app).
 * Exported for testing — listen() is called separately in index.ts.
 */
export function createHookApp(deps: HookAppDeps): express.Express {
  const { broadcaster } = deps;
  const app = express();

  app.use(express.json({ limit: '1mb' }));

  // Rate limit: 60 req/min (prevents runaway hook loops)
  if (!deps.disableRateLimiting) {
    app.use(
      rateLimit({
        windowMs: 60_000,
        max: 60,
        standardHeaders: 'draft-8',
        message: { error: 'Too many requests' },
      }),
    );
  }

  // ─── POST /api/hooks/permission ─────────────────────────────────
  // Claude Code POSTs here and BLOCKS waiting for the response.
  // We hold the response open until a user approves/denies via the dashboard.
  app.post('/api/hooks/permission', (req, res) => {
    if (pending.size >= MAX_PENDING) {
      res.status(429).json({ error: 'Too many pending permissions' });
      return;
    }

    const id = crypto.randomUUID();
    const createdAt = Date.now();
    const expiresAt = createdAt + PERMISSION_TIMEOUT_MS;

    const timer = setTimeout(() => {
      pending.delete(id);
      try {
        res.json({
          hookSpecificOutput: {
            hookEventName: 'PermissionRequest',
            decision: {
              behavior: 'deny',
              message: 'Synapse approval timed out. Re-run the task or approve in terminal.',
            },
          },
        });
      } catch {
        // Response may already be closed
      }
    }, PERMISSION_TIMEOUT_MS);

    pending.set(id, { res, event: req.body, timer, createdAt });

    // Broadcast to dashboard via WS (use broadcastRaw — not broadcast(),
    // which wraps in { type: 'event' } and expects AgentEvent)
    const toolName = req.body.tool_name ?? '';
    const toolInput = String(req.body.tool_input ?? '');
    broadcaster.broadcastRaw({
      type: 'pendingPermission',
      data: {
        id,
        tool_name: toolName,
        tool_input_preview: toolInput.slice(0, 200),
        createdAt,
        expiresAt,
      },
    });

    // Fire-and-forget push notification
    sendToAll({
      title: `⏸ Synapse — ${toolName || 'Permission'} request`,
      body: `${toolInput.slice(0, 60)}  ·  ${Math.round(PERMISSION_TIMEOUT_MS / 60000)}:00 remaining`,
      requestId: id,
      url: '/',
    }).catch((err) => logger.error({ err }, 'Push send failed'));

    // res intentionally NOT called — held until decision or timeout
  });

  // ─── GET /api/hook-server/status ────────────────────────────────
  app.get('/api/hook-server/status', (_req, res) => {
    res.json({ running: true, port: HOOK_PORT, pending: pending.size });
  });

  return app;
}

export { HOOK_PORT };
```

- [ ] **Step 4: Add broadcastRaw to Broadcaster**

The existing `Broadcaster` has `broadcast(event: AgentEvent)` which wraps in `{ type: 'event', data }`. We need a `broadcastRaw(msg: WsServerMessage)` method to send permission messages directly. Add to `packages/server/src/services/broadcaster.ts`:

```typescript
/** Broadcast a raw WsServerMessage without wrapping in { type: 'event' }. */
broadcastRaw(msg: WsServerMessage): void {
  const payload = JSON.stringify(msg);
  for (const client of this.clients) {
    this.safeSend(client, payload);
  }
}
```

Add the import at the top of broadcaster.ts:

```typescript
import type { WsServerMessage } from '@synapse-ai/core';
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm test -- packages/server/src/__tests__/hookServer.test.ts`
Expected: PASS

- [ ] **Step 6: Run full test suite**

Run: `pnpm test`
Expected: All tests pass

- [ ] **Step 7: Commit**

```bash
git add packages/server/src/hookServer.ts packages/server/src/services/broadcaster.ts packages/server/src/__tests__/hookServer.test.ts
git commit -m "feat(server): add hook server with deferred permission response"
```

---

## Chunk 3: Permission Router and Main Server Integration

### Task 7: Permission router — PUT /api/permissions/:id/decision + GET /api/permissions/pending

**Files:**

- Create: `packages/server/src/routes/permissions.ts`
- Test: `packages/server/src/__tests__/permissionRoutes.test.ts`

**Context:** These routes run on the MAIN server (port 27246), not the hook server. They resolve pending permissions and provide a hydration endpoint.

- [ ] **Step 1: Write the failing test**

Create `packages/server/src/__tests__/permissionRoutes.test.ts`:

```typescript
import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { initDb } from '../db.js';
import { pending, decisions } from '../state/permissionState.js';
import type { PendingEntry } from '../state/permissionState.js';

process.env.SYNAPSE_DB_PATH = ':memory:';

let app: Express;

beforeAll(async () => {
  await initDb();
  const { Broadcaster } = await import('../services/broadcaster.js');
  const { AgentManager } = await import('../services/agentManager.js');
  const { createApp } = await import('../app.js');
  const broadcaster = new Broadcaster();
  const agentManager = new AgentManager();
  app = createApp({ broadcaster, agentManager, disableRateLimiting: true });
});

afterEach(() => {
  for (const [, entry] of pending.entries()) {
    clearTimeout(entry.timer);
  }
  pending.clear();
  decisions.clear();
});

describe('PUT /api/permissions/:id/decision', () => {
  it('resolves a pending permission and returns ok', async () => {
    // Simulate a pending entry with a mock response
    let resolvedWith: any = null;
    const mockRes = {
      json: (body: any) => {
        resolvedWith = body;
      },
    };

    pending.set('test-id', {
      res: mockRes as any,
      event: { session_id: 'sess-1', hook_event_name: 'PermissionRequest', tool_name: 'Bash' },
      timer: setTimeout(() => {}, 999999),
      createdAt: Date.now() - 5000,
    });

    const res = await request(app)
      .put('/api/permissions/test-id/decision')
      .send({ behavior: 'allow' });

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(resolvedWith.hookSpecificOutput.decision.behavior).toBe('allow');
    expect(pending.has('test-id')).toBe(false);
  });

  it('returns 404 for unknown id', async () => {
    const res = await request(app)
      .put('/api/permissions/nonexistent/decision')
      .send({ behavior: 'deny' });

    expect(res.status).toBe(404);
  });

  it('returns 400 for invalid behavior', async () => {
    pending.set('test-bad', {
      res: { json: () => {} } as any,
      event: { session_id: 's', hook_event_name: 'PermissionRequest' },
      timer: setTimeout(() => {}, 999999),
      createdAt: Date.now(),
    });

    const res = await request(app)
      .put('/api/permissions/test-bad/decision')
      .send({ behavior: 'invalid' });

    expect(res.status).toBe(400);
  });
});

describe('GET /api/permissions/pending', () => {
  it('returns empty array when no pending', async () => {
    const res = await request(app).get('/api/permissions/pending');
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it('returns summary shape for pending entries', async () => {
    const now = Date.now();
    pending.set('pending-1', {
      res: {} as any,
      event: {
        session_id: 's1',
        hook_event_name: 'PermissionRequest',
        tool_name: 'Bash',
        tool_input: { command: 'a'.repeat(300) },
      },
      timer: setTimeout(() => {}, 999999),
      createdAt: now,
    });

    const res = await request(app).get('/api/permissions/pending');
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);

    const item = res.body[0];
    expect(item.id).toBe('pending-1');
    expect(item.tool_name).toBe('Bash');
    // tool_input_preview should be truncated to 200 chars
    expect(item.tool_input_preview.length).toBeLessThanOrEqual(200);
    expect(item.createdAt).toBe(now);
    expect(item.expiresAt).toBeDefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- packages/server/src/__tests__/permissionRoutes.test.ts`
Expected: FAIL — routes not registered

- [ ] **Step 3: Create the permission router**

Create `packages/server/src/routes/permissions.ts`:

```typescript
// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Bernhard

import { Router, type Request, type Response } from 'express';
import { logger } from '../lib/logger.js';
import { analyticsExecute } from '../db.js';
import { Broadcaster } from '../services/broadcaster.js';
import {
  pending,
  decisions,
  PERMISSION_TIMEOUT_MS,
  purgeExpiredDecisions,
} from '../state/permissionState.js';

export function createPermissionsRouter(broadcaster: Broadcaster): Router {
  const router = Router();

  // PUT /api/permissions/:id/decision — resolve a pending permission
  router.put('/:id/decision', (req: Request, res: Response) => {
    try {
      const id = String(req.params.id);
      const behavior = req.body?.behavior;

      if (behavior !== 'allow' && behavior !== 'deny') {
        res.status(400).json({ error: 'behavior must be "allow" or "deny"' });
        return;
      }

      purgeExpiredDecisions();

      const entry = pending.get(id);
      if (!entry) {
        res.status(404).json({ error: 'already resolved or not found' });
        return;
      }

      const latencyMs = Date.now() - entry.createdAt;

      clearTimeout(entry.timer);
      pending.delete(id);
      decisions.set(id, { behavior, expiresAt: Date.now() + 30_000 });

      // Store analytics event
      try {
        analyticsExecute(
          `INSERT INTO permission_events (id, session_id, tool_name, tool_input, behavior, latency_ms, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [
            id,
            entry.event.session_id,
            (entry.event.tool_name as string) ?? '',
            String(entry.event.tool_input ?? '').slice(0, 500),
            behavior,
            latencyMs,
            Date.now(),
          ],
        );
      } catch (dbErr) {
        logger.error({ err: dbErr }, 'Failed to store permission event');
        // Don't fail the decision — the hook response is more important
      }

      // Broadcast resolution to all dashboard clients
      broadcaster.broadcastRaw({
        type: 'permissionResolved',
        data: { id, behavior },
      });

      // Resolve the held hook response to Claude Code
      try {
        entry.res.json({
          hookSpecificOutput: {
            hookEventName: 'PermissionRequest',
            decision: { behavior },
          },
        });
      } catch {
        logger.warn({ id }, 'Hook response already closed');
      }

      res.json({ ok: true, latencyMs });
    } catch (err) {
      logger.error({ err }, 'Error resolving permission');
      res.status(500).json({ error: 'Internal error' });
    }
  });

  // GET /api/permissions/pending — hydration endpoint (summary shape)
  router.get('/pending', (_req: Request, res: Response) => {
    const summaries = [...pending.entries()].map(([id, entry]) => ({
      id,
      tool_name: (entry.event.tool_name as string) ?? '',
      tool_input_preview: String(entry.event.tool_input ?? '').slice(0, 200),
      createdAt: entry.createdAt,
      expiresAt: entry.createdAt + PERMISSION_TIMEOUT_MS,
    }));
    res.json(summaries);
  });

  // GET /api/permissions/:id — full detail for a single pending entry
  router.get('/:id', (req: Request, res: Response) => {
    const id = String(req.params.id);
    const entry = pending.get(id);
    if (!entry) {
      res.status(404).json({ error: 'not found' });
      return;
    }
    res.json({
      id,
      event: entry.event,
      createdAt: entry.createdAt,
      expiresAt: entry.createdAt + PERMISSION_TIMEOUT_MS,
    });
  });

  return router;
}
```

- [ ] **Step 4: Register the router in app.ts**

In `packages/server/src/app.ts`:

Add import:

```typescript
import { createPermissionsRouter } from './routes/permissions.js';
```

Add route registration (after `app.use('/api/settings', createSettingsRouter());`):

```typescript
app.use('/api/permissions', createPermissionsRouter(broadcaster));
```

- [ ] **Step 5: Add auth exemption for /api/permissions**

In `packages/server/src/app.ts`, change the auth middleware (line 71):

Replace:

```typescript
app.use('/api', apiKeyAuth);
```

With:

```typescript
app.use('/api', (req: Request, res: Response, next: NextFunction) => {
  // Permission and hook endpoints are exempt from API key auth
  // (Claude Code can't send Bearer tokens; phones need unauthenticated access)
  // Note: req.path is the FULL path (Express 5 app.use does NOT strip the mount prefix)
  const exempt = ['/api/permissions', '/api/hooks/', '/api/push/', '/api/hook-server/'];
  if (exempt.some((p) => req.path.startsWith(p))) return next();
  return apiKeyAuth(req, res, next);
});
```

- [ ] **Step 6: Run test to verify it passes**

Run: `pnpm test -- packages/server/src/__tests__/permissionRoutes.test.ts`
Expected: PASS

- [ ] **Step 7: Run full test suite**

Run: `pnpm test`
Expected: All tests pass

- [ ] **Step 8: Commit**

```bash
git add packages/server/src/routes/permissions.ts packages/server/src/app.ts packages/server/src/__tests__/permissionRoutes.test.ts
git commit -m "feat(server): add permission router with PUT decision + GET pending"
```

---

### Task 8: Wire hook server into index.ts + graceful shutdown

**Files:**

- Modify: `packages/server/src/index.ts`

**Context:** The hook server must start on fixed port 27247 in the same process. If the port is in use, log a warning and skip (graceful degradation). On SIGTERM/SIGINT, drain all pending permissions with deny before closing.

- [ ] **Step 1: Add hook server startup to index.ts**

In `packages/server/src/index.ts`, add after the main server `createServer(app)` line (around line 90):

Add imports at the top (note: `createServer` is already imported from `'http'` — reuse it, no alias needed):

```typescript
import { createHookApp, HOOK_PORT } from './hookServer.js';
import { pending } from './state/permissionState.js';
```

After the existing `const server = createServer(app);` line, add:

```typescript
// --- Hook Server (fixed port for Claude Code HTTP hooks) ---
const hookApp = createHookApp({ broadcaster });
const hookHttpServer = createServer(hookApp);
hookHttpServer.timeout = 0; // No request timeout — permissions can be held for 30+ min

let hookServerRunning = false;
try {
  await new Promise<void>((resolve, reject) => {
    hookHttpServer.once('error', (err: NodeJS.ErrnoException) => {
      if (err.code === 'EADDRINUSE') {
        logger.warn(
          { port: HOOK_PORT },
          'Hook server port in use — permission routing unavailable',
        );
        resolve(); // Graceful degradation
      } else {
        reject(err);
      }
    });
    hookHttpServer.once('listening', () => {
      hookServerRunning = true;
      resolve();
    });
    hookHttpServer.listen(HOOK_PORT, HOST);
  });
  if (hookServerRunning) {
    logger.info({ host: HOST, port: HOOK_PORT }, 'Hook server started');
  }
} catch (err) {
  logger.error({ err }, 'Hook server failed to start');
}
```

- [ ] **Step 2: Update graceful shutdown to drain pending permissions**

In the existing `shutdown()` function in `index.ts`, add pending permission drain BEFORE the existing shutdown logic (before `agentManager.stopAll()`):

```typescript
// 0. Drain pending permissions — deny all before shutdown
for (const [id, entry] of pending.entries()) {
  clearTimeout(entry.timer);
  try {
    entry.res.json({
      hookSpecificOutput: {
        hookEventName: 'PermissionRequest',
        decision: { behavior: 'deny', message: 'Synapse server is shutting down.' },
      },
    });
  } catch {
    // Response may already be closed
  }
}
pending.clear();
```

And add hook server close. Since `shutdown()` is a synchronous function (not async), use callback style — close hook server before the drain timer:

```typescript
// Close hook server (callback-based — shutdown() is not async)
if (hookServerRunning) {
  hookHttpServer.close(() => {
    logger.info('Hook server closed');
  });
}
```

This goes right before the existing `server.close(...)` call in the shutdown function.

- [ ] **Step 3: Add hook-server/status endpoint to main server**

Add to `packages/server/src/app.ts` (or in the health check area of index.ts):

In `app.ts`, add after the health check:

```typescript
// Hook server status (main server reports hook server state)
app.get('/api/hook-server/status', (_req, res) => {
  // hookServerRunning is set in index.ts — this endpoint is a fallback.
  // The real status endpoint is on the hook server itself.
  // This one always returns the cached state.
  res.json({ running: false, port: 27247 });
});
```

Since the catch-all SPA route in `index.ts` would block any routes added after `createApp()`, we must register this BEFORE the catch-all. Add to `index.ts` right after `const app = createApp(...)` and BEFORE the `dashDir` static/SPA block:

```typescript
// Expose hook server status on main server (must be before catch-all SPA route)
// hookServerRunning is set later — this closure captures the mutable variable
app.get('/api/hook-server/status', (_req, res) => {
  res.json({ running: hookServerRunning, port: HOOK_PORT, pending: pending.size });
});
```

**Important ordering:** This line must go BEFORE `if (dashDir) { app.use(express.static(...)) ... }` in index.ts.

- [ ] **Step 4: Run full test suite**

Run: `pnpm test`
Expected: All tests pass

- [ ] **Step 5: Manual integration test**

Start the server:

```bash
npx tsx packages/server/src/index.ts
```

Test the hook server:

```bash
# Terminal 1: POST that blocks (will hold)
curl -X POST http://localhost:27247/api/hooks/permission \
  -H "Content-Type: application/json" \
  -d '{"session_id":"test","tool_name":"Bash","tool_input":"ls","hook_event_name":"PermissionRequest"}'

# Terminal 2: Check pending
curl http://localhost:27246/api/permissions/pending

# Terminal 2: Resolve it (use the id from the pending response)
curl -X PUT http://localhost:27246/api/permissions/<ID>/decision \
  -H "Content-Type: application/json" \
  -d '{"behavior":"allow"}'

# Terminal 1 should now show the allow response
```

- [ ] **Step 6: Commit**

```bash
git add packages/server/src/index.ts
git commit -m "feat(server): wire hook server into main process with graceful shutdown"
```

---

## Chunk 4: Settings and Hook Configuration

### Task 9: Add permission settings keys

**Files:**

- Modify: `packages/server/src/services/settingsService.ts`
- Modify: `packages/server/src/routes/settings.ts`

- [ ] **Step 1: Add new settings keys**

In `packages/server/src/services/settingsService.ts`, add to `SETTINGS_KEYS`:

```typescript
PERMISSION_APPROVAL_ENABLED: 'permission_approval_enabled',
PERMISSION_TIMEOUT_MINUTES: 'permission_timeout_minutes',
PROMPT_INTERCEPTOR_ENABLED: 'prompt_interceptor_enabled',
```

- [ ] **Step 2: Run full test suite to check nothing broke**

Run: `pnpm test`
Expected: All tests pass

- [ ] **Step 3: Commit**

```bash
git add packages/server/src/services/settingsService.ts
git commit -m "feat(server): add permission and interceptor settings keys"
```

---

### Task 10: Add HTTP hooks to .claude/settings.json

**Files:**

- Modify: `.claude/settings.json`

- [ ] **Step 1: Read current settings.json**

Read `.claude/settings.json` to understand the current hook structure.

- [ ] **Step 2: Add HTTP hooks for PermissionRequest**

Add to the hooks configuration in `.claude/settings.json`:

```json
{
  "hooks": {
    "PermissionRequest": [
      {
        "type": "http",
        "url": "http://localhost:27247/api/hooks/permission",
        "timeout": 1800
      }
    ]
  }
}
```

**Important:** Merge with existing hooks — don't overwrite the command hooks for observational events (like the existing `send_event.cjs` hooks).

- [ ] **Step 3: Commit**

```bash
git add .claude/settings.json
git commit -m "feat: add PermissionRequest HTTP hook pointing to hook server"
```

---

### Task 11: LAN IP detection endpoint

**Files:**

- Create: `packages/server/src/routes/network.ts`
- Test: `packages/server/src/__tests__/networkRoutes.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/server/src/__tests__/networkRoutes.test.ts`:

```typescript
import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { initDb } from '../db.js';

process.env.SYNAPSE_DB_PATH = ':memory:';

let app: Express;

beforeAll(async () => {
  await initDb();
  const { Broadcaster } = await import('../services/broadcaster.js');
  const { AgentManager } = await import('../services/agentManager.js');
  const { createApp } = await import('../app.js');
  app = createApp({
    broadcaster: new Broadcaster(),
    agentManager: new AgentManager(),
    disableRateLimiting: true,
  });
});

describe('GET /api/network/local-url', () => {
  it('returns a url and ip field', async () => {
    const res = await request(app).get('/api/network/local-url');
    expect(res.status).toBe(200);
    expect(res.body.ip).toBeDefined();
    expect(res.body.url).toBeDefined();
    expect(typeof res.body.url).toBe('string');
  });

  it('url contains port', async () => {
    const res = await request(app).get('/api/network/local-url');
    // URL should contain a port number
    expect(res.body.url).toMatch(/:\d+/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- packages/server/src/__tests__/networkRoutes.test.ts`
Expected: FAIL — route not found (404)

- [ ] **Step 3: Create the network router**

Create `packages/server/src/routes/network.ts`:

```typescript
// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Bernhard

import { Router, type Request, type Response } from 'express';
import os from 'os';

/**
 * LAN IP selection heuristic (Decision 12 from spec):
 * 1. IPv4 only
 * 2. Exclude loopback (127.x)
 * 3. Exclude Docker bridges (172.17–172.31)
 * 4. Exclude Tailscale (100.x)
 * 5. Exclude link-local (169.254.x)
 * 6. Prefer 192.168.x or 10.x
 * 7. First match wins
 * 8. Fallback: localhost with warning
 */
function detectLanIp(): { ip: string; warning?: string } {
  const interfaces = os.networkInterfaces();
  const candidates: string[] = [];

  for (const addrs of Object.values(interfaces)) {
    if (!addrs) continue;
    for (const addr of addrs) {
      if (addr.family !== 'IPv4' && (addr.family as unknown) !== 4) continue;
      if (addr.internal) continue; // loopback

      const ip = addr.address;
      // Exclude Docker bridges (172.17.0.0 – 172.31.255.255)
      if (/^172\.(1[6-9]|2\d|3[01])\./.test(ip)) continue;
      // Exclude Tailscale (100.x.x.x)
      if (ip.startsWith('100.')) continue;
      // Exclude link-local (169.254.x.x)
      if (ip.startsWith('169.254.')) continue;

      candidates.push(ip);
    }
  }

  // Prefer 192.168.x or 10.x
  const preferred = candidates.find((ip) => ip.startsWith('192.168.') || ip.startsWith('10.'));

  if (preferred) return { ip: preferred };
  if (candidates.length > 0) return { ip: candidates[0] };
  return { ip: 'localhost', warning: 'No LAN interface detected' };
}

export function createNetworkRouter(): Router {
  const router = Router();

  router.get('/local-url', (req: Request, res: Response) => {
    const { ip, warning } = detectLanIp();
    const port = req.socket.localPort ?? 27246;
    const url = `http://${ip}:${port}`;
    res.json({ ip, port, url, ...(warning ? { warning } : {}) });
  });

  return router;
}
```

- [ ] **Step 4: Register in app.ts**

Add import:

```typescript
import { createNetworkRouter } from './routes/network.js';
```

Add route (after permissions router):

```typescript
app.use('/api/network', createNetworkRouter());
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm test -- packages/server/src/__tests__/networkRoutes.test.ts`
Expected: PASS

- [ ] **Step 6: Run full test suite**

Run: `pnpm test`
Expected: All tests pass

- [ ] **Step 7: Commit**

```bash
git add packages/server/src/routes/network.ts packages/server/src/__tests__/networkRoutes.test.ts packages/server/src/app.ts
git commit -m "feat(server): add LAN IP detection endpoint with heuristic filtering"
```

---

### Task 12: Gate A1 — End-to-end verification

- [ ] **Step 1: Run the full test suite one final time**

Run: `pnpm test`
Expected: All tests pass, no regressions

- [ ] **Step 2: Manual curl end-to-end test**

Start server: `npx tsx packages/server/src/index.ts`

```bash
# Terminal 1: POST — this will block
curl -s -X POST http://localhost:27247/api/hooks/permission \
  -H "Content-Type: application/json" \
  -d '{"session_id":"gate-test","tool_name":"Bash","tool_input":"echo hello","hook_event_name":"PermissionRequest"}'
```

```bash
# Terminal 2: Verify pending
curl -s http://localhost:27246/api/permissions/pending | jq .

# Get the id from the response, then resolve:
curl -s -X PUT http://localhost:27246/api/permissions/<ID>/decision \
  -H "Content-Type: application/json" \
  -d '{"behavior":"allow"}'
```

```bash
# Terminal 1 should now show:
# {"hookSpecificOutput":{"hookEventName":"PermissionRequest","decision":{"behavior":"allow"}}}
```

Verify:

1. POST blocks in terminal 1
2. GET /pending shows the entry
3. PUT resolves the POST
4. Terminal 1 receives the correct JSON response
5. GET /pending returns empty array after resolution

- [ ] **Step 3: Verify hook server status endpoints**

```bash
curl http://localhost:27247/api/hook-server/status
# → { "running": true, "port": 27247, "pending": 0 }

curl http://localhost:27246/api/hook-server/status
# → { "running": true, "port": 27247, "pending": 0 }
```

- [ ] **Step 4: Verify graceful degradation**

Start something on port 27247 first (e.g. `npx http-server -p 27247`), then start Synapse. Verify:

- Main server starts normally
- Log shows: `WARN: Hook server port in use — permission routing unavailable`
- `GET /api/hook-server/status` returns `{ "running": false }`

- [ ] **Step 5: Final commit with gate verification**

```bash
git commit --allow-empty -m "gate(A1): curl POST→PUT end-to-end verified — Phase A1 complete"
```

---

## Summary

| Task | Component                | Test file                                                |
| ---- | ------------------------ | -------------------------------------------------------- |
| 1    | ClaudeHookEvent type     | `packages/core/src/__tests__/hooks.test.ts`              |
| 2    | WsServerMessage variants | `packages/core/src/__tests__/hooks.test.ts`              |
| 3    | permissionState.ts       | `packages/server/src/__tests__/permissionState.test.ts`  |
| 4    | pushService stub         | `packages/server/src/__tests__/pushService.test.ts`      |
| 5    | DB migration tables      | `packages/server/src/__tests__/permissionDb.test.ts`     |
| 6    | hookServer.ts            | `packages/server/src/__tests__/hookServer.test.ts`       |
| 7    | Permission router        | `packages/server/src/__tests__/permissionRoutes.test.ts` |
| 8    | index.ts integration     | Manual + existing tests                                  |
| 9    | Settings keys            | Existing settings tests                                  |
| 10   | .claude/settings.json    | N/A (config)                                             |
| 11   | LAN IP endpoint          | `packages/server/src/__tests__/networkRoutes.test.ts`    |
| 12   | Gate A1                  | Manual curl verification                                 |
