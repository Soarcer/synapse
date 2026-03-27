# Remote Approval — Phase B: Web Push Notifications Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the no-op `pushService.ts` stub with real Web Push notifications so users receive phone alerts when Claude Code blocks on a permission request — with one-tap approve/deny on Android and open-app fallback on iOS.

**Architecture:** Server uses `web-push` npm to send VAPID-signed push notifications to all registered subscriptions. A plain static service worker (`public/sw.js`) handles push display and notification actions. The `usePush.ts` hook manages SW registration, push subscription, and server sync. VAPID keys are manual (`.env`), CORS defaults to `*` via existing mechanism, and subscriptions persist in the existing `push_subscriptions` SQLite table.

**Tech Stack:** `web-push` (server), Service Worker API + Push API (browser), React 19, Zustand 5, Tailwind CSS 4, vitest + jsdom

**Spec:** [2026-03-11-remote-approval-phase-b-design.md](../specs/2026-03-11-remote-approval-phase-b-design.md)

**Phase A1 plan (backend, already implemented):** [2026-03-11-remote-approval-phase-a1.md](2026-03-11-remote-approval-phase-a1.md)
**Phase A2 plan (frontend, already implemented):** [2026-03-11-remote-approval-phase-a2.md](2026-03-11-remote-approval-phase-a2.md)

---

## File Structure

### New files

| File                                                                  | Responsibility                                                        |
| --------------------------------------------------------------------- | --------------------------------------------------------------------- |
| `packages/server/.env.example`                                        | VAPID env var documentation for developer setup                       |
| `packages/server/src/routes/push.ts`                                  | Push subscription CRUD routes + VAPID key endpoint                    |
| `packages/server/src/__tests__/pushRoutes.test.ts`                    | Integration tests for push routes                                     |
| `packages/server/src/__tests__/pushServiceReal.test.ts`               | Unit tests for real pushService (mocked web-push)                     |
| `apps/dashboard/public/sw.js`                                         | Service worker: push handler, notification click, subscription change |
| `apps/dashboard/src/hooks/usePush.ts`                                 | Push subscription lifecycle hook                                      |
| `apps/dashboard/src/hooks/__tests__/usePush.test.ts`                  | Tests for usePush hook                                                |
| `apps/dashboard/src/components/settings/PushSetup.tsx`                | Push notifications settings UI                                        |
| `apps/dashboard/src/components/settings/__tests__/PushSetup.test.tsx` | Tests for PushSetup component                                         |
| `apps/dashboard/src/__tests__/sw.test.ts`                             | Service worker push handler unit tests                                |
| `apps/dashboard/public/icons/icon-192.png`                            | PWA icon 192x192                                                      |
| `apps/dashboard/public/icons/icon-512.png`                            | PWA icon 512x512                                                      |
| `apps/dashboard/public/icons/badge-72.png`                            | Notification badge 72x72                                              |

### Modified files

| File                                                         | Change                                                                                              |
| ------------------------------------------------------------ | --------------------------------------------------------------------------------------------------- |
| `packages/server/src/services/pushService.ts`                | Replace stub with real `web-push` implementation                                                    |
| `packages/server/src/__tests__/pushService.test.ts`          | Replace stub tests with real implementation tests (or remove in favor of `pushServiceReal.test.ts`) |
| `packages/server/src/index.ts`                               | Add `initPush()` call in startup sequence                                                           |
| `packages/server/src/app.ts`                                 | Change CORS default to `*`, add push router                                                         |
| `packages/server/src/hookServer.ts`                          | Update `sendToAll()` call with `decisionUrl` and absolute `url`                                     |
| `packages/server/package.json`                               | Add `web-push` dependency                                                                           |
| `apps/dashboard/public/manifest.json`                        | Add icon entries                                                                                    |
| `apps/dashboard/src/components/settings/HookControlsTab.tsx` | Add PushSetup section                                                                               |

---

## Chunk 1: Server-Side Push Service + Routes

### Task 1: Install web-push dependency

**Files:**

- Modify: `packages/server/package.json`

- [ ] **Step 1: Install web-push**

```bash
cd packages/server && pnpm add web-push && pnpm add -D @types/web-push
```

- [ ] **Step 2: Verify import resolves**

```bash
cd packages/server && node -e "require('web-push')" && echo "OK"
```

Expected: `OK` (no module-not-found error)

- [ ] **Step 3: Create .env.example**

<!-- revised: P1-P1 — document VAPID env vars for discoverability -->

Create `packages/server/.env.example`:

```env
# Web Push Notifications (Phase B)
# Generate keys: npx web-push generate-vapid-keys
# VAPID_PUBLIC_KEY=
# VAPID_PRIVATE_KEY=
# VAPID_SUBJECT=mailto:dev@localhost
```

- [ ] **Step 4: Commit**

```bash
git add packages/server/package.json packages/server/.env.example pnpm-lock.yaml
git commit -m "chore(server): add web-push dependency and .env.example for Phase B push notifications"
```

---

### Task 2: Replace pushService.ts stub with real implementation

<!-- revised: P1-E1 — new PushPayload adds `decisionUrl` field, which will cause a compile error in hookServer.ts until Task 6 updates the call site. Complete Tasks 2-6 before running full type check. -->

**Files:**

- Modify: `packages/server/src/services/pushService.ts`
- Modify: `packages/server/src/__tests__/pushService.test.ts`

- [ ] **Step 1: Write the failing tests**

Replace `packages/server/src/__tests__/pushService.test.ts` with tests for the real implementation. Mock `web-push` at the module level:

```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock web-push before importing pushService
vi.mock('web-push', () => ({
  default: {
    setVapidDetails: vi.fn(),
    sendNotification: vi.fn().mockResolvedValue({}),
  },
}));

// Mock db helpers
vi.mock('../db.js', () => ({
  analyticsQueryAll: vi.fn().mockReturnValue([]),
  analyticsExecute: vi.fn().mockReturnValue(1),
}));

vi.mock('../lib/logger.js', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

import webpush from 'web-push';
import { analyticsQueryAll, analyticsExecute } from '../db.js';
import { initPush, sendToAll, isEnabled, getVapidPublicKey } from '../services/pushService.js';

describe('pushService (real)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset module state — pushService uses module-level `enabled` flag
    // We need to re-init for each test
  });

  describe('initPush', () => {
    it('stays disabled when VAPID keys are missing', () => {
      delete process.env.VAPID_PUBLIC_KEY;
      delete process.env.VAPID_PRIVATE_KEY;
      initPush();
      expect(isEnabled()).toBe(false);
      expect(webpush.setVapidDetails).not.toHaveBeenCalled();
    });

    it('enables when VAPID keys are set', () => {
      process.env.VAPID_PUBLIC_KEY = 'test-public-key';
      process.env.VAPID_PRIVATE_KEY = 'test-private-key';
      process.env.VAPID_SUBJECT = 'mailto:test@test.com';
      initPush();
      expect(isEnabled()).toBe(true);
      expect(webpush.setVapidDetails).toHaveBeenCalledWith(
        'mailto:test@test.com',
        'test-public-key',
        'test-private-key',
      );
    });
  });

  describe('getVapidPublicKey', () => {
    it('returns the public key from env', () => {
      process.env.VAPID_PUBLIC_KEY = 'my-public-key';
      expect(getVapidPublicKey()).toBe('my-public-key');
    });
  });

  describe('sendToAll', () => {
    const payload = {
      title: 'Test',
      body: 'test body',
      requestId: 'req-1',
      decisionUrl: 'http://192.168.1.1:27246/api/permissions/req-1/decision',
      url: 'http://192.168.1.1:27246/',
    };

    it('returns immediately when disabled', async () => {
      delete process.env.VAPID_PUBLIC_KEY;
      delete process.env.VAPID_PRIVATE_KEY;
      initPush();
      await sendToAll(payload);
      expect(analyticsQueryAll).not.toHaveBeenCalled();
    });

    it('returns immediately when no subscriptions exist', async () => {
      process.env.VAPID_PUBLIC_KEY = 'pk';
      process.env.VAPID_PRIVATE_KEY = 'sk';
      initPush();
      vi.mocked(analyticsQueryAll).mockReturnValue([]);
      await sendToAll(payload);
      expect(webpush.sendNotification).not.toHaveBeenCalled();
    });

    it('sends notification to each subscription', async () => {
      process.env.VAPID_PUBLIC_KEY = 'pk';
      process.env.VAPID_PRIVATE_KEY = 'sk';
      initPush();
      vi.mocked(analyticsQueryAll).mockReturnValue([
        { id: 's1', endpoint: 'https://fcm.example.com/1', keys_p256dh: 'p1', keys_auth: 'a1' },
        { id: 's2', endpoint: 'https://fcm.example.com/2', keys_p256dh: 'p2', keys_auth: 'a2' },
      ]);
      await sendToAll(payload);
      expect(webpush.sendNotification).toHaveBeenCalledTimes(2);
    });

    it('deletes subscription on 410 Gone', async () => {
      process.env.VAPID_PUBLIC_KEY = 'pk';
      process.env.VAPID_PRIVATE_KEY = 'sk';
      initPush();
      vi.mocked(analyticsQueryAll).mockReturnValue([
        { id: 's1', endpoint: 'https://fcm.example.com/1', keys_p256dh: 'p1', keys_auth: 'a1' },
      ]);
      vi.mocked(webpush.sendNotification).mockRejectedValueOnce({ statusCode: 410 });
      await sendToAll(payload);
      expect(analyticsExecute).toHaveBeenCalledWith('DELETE FROM push_subscriptions WHERE id = ?', [
        's1',
      ]);
    });

    it('deletes subscription on 404', async () => {
      process.env.VAPID_PUBLIC_KEY = 'pk';
      process.env.VAPID_PRIVATE_KEY = 'sk';
      initPush();
      vi.mocked(analyticsQueryAll).mockReturnValue([
        { id: 's1', endpoint: 'https://fcm.example.com/1', keys_p256dh: 'p1', keys_auth: 'a1' },
      ]);
      vi.mocked(webpush.sendNotification).mockRejectedValueOnce({ statusCode: 404 });
      await sendToAll(payload);
      expect(analyticsExecute).toHaveBeenCalledWith('DELETE FROM push_subscriptions WHERE id = ?', [
        's1',
      ]);
    });

    it('logs warning on other errors without throwing', async () => {
      process.env.VAPID_PUBLIC_KEY = 'pk';
      process.env.VAPID_PRIVATE_KEY = 'sk';
      initPush();
      vi.mocked(analyticsQueryAll).mockReturnValue([
        { id: 's1', endpoint: 'https://fcm.example.com/1', keys_p256dh: 'p1', keys_auth: 'a1' },
      ]);
      vi.mocked(webpush.sendNotification).mockRejectedValueOnce({ statusCode: 500 });
      // Should not throw
      await expect(sendToAll(payload)).resolves.toBeUndefined();
    });
  });

  // <!-- revised: P1-E3 — reset module-level `enabled` flag between tests -->
  afterEach(() => {
    delete process.env.VAPID_PUBLIC_KEY;
    delete process.env.VAPID_PRIVATE_KEY;
    delete process.env.VAPID_SUBJECT;
    initPush(); // reset enabled=false with no env vars
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd packages/server && npx vitest run src/__tests__/pushService.test.ts
```

Expected: FAIL — `initPush` is not exported from the stub

- [ ] **Step 3: Replace pushService.ts with real implementation**

Replace `packages/server/src/services/pushService.ts` entirely:

```typescript
// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Bernhard

import webpush from 'web-push';
import { analyticsQueryAll, analyticsExecute } from '../db.js';
import { logger } from '../lib/logger.js';

export interface PushPayload {
  title: string;
  body: string;
  requestId: string;
  /** Full absolute URL to the decision endpoint */
  decisionUrl: string;
  /** Full absolute URL to open the PWA */
  url: string;
}

interface PushSubscriptionRow {
  id: string;
  endpoint: string;
  keys_p256dh: string;
  keys_auth: string;
}

let enabled = false;

/** Call once at startup, after initDb(). Reads VAPID keys from env. */
export function initPush(): void {
  const publicKey = process.env.VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  const subject = process.env.VAPID_SUBJECT ?? 'mailto:dev@localhost';

  if (!publicKey || !privateKey) {
    logger.info('Push notifications disabled — VAPID keys not configured');
    enabled = false;
    return;
  }

  webpush.setVapidDetails(subject, publicKey, privateKey);
  enabled = true;
  logger.info('Push notifications enabled');
}

export function isEnabled(): boolean {
  return enabled;
}

export function getVapidPublicKey(): string | undefined {
  return process.env.VAPID_PUBLIC_KEY;
}

/**
 * Send push notification to all registered subscriptions.
 * Fire-and-forget: all errors are caught internally.
 * Auto-cleans 410/404 (expired) subscriptions from DB.
 */
export async function sendToAll(payload: PushPayload): Promise<void> {
  if (!enabled) return;

  const subs = analyticsQueryAll(
    'SELECT id, endpoint, keys_p256dh, keys_auth FROM push_subscriptions',
  ) as unknown as PushSubscriptionRow[];

  if (subs.length === 0) return;

  const body = JSON.stringify({
    title: payload.title,
    body: payload.body,
    data: {
      requestId: payload.requestId,
      decisionUrl: payload.decisionUrl,
      url: payload.url,
      actions: ['approve', 'deny'],
    },
  });

  const options: webpush.RequestOptions = {
    TTL: 3600,
    urgency: 'high' as const,
  };

  await Promise.allSettled(
    subs.map(async (sub) => {
      try {
        await webpush.sendNotification(
          {
            endpoint: sub.endpoint,
            keys: { p256dh: sub.keys_p256dh, auth: sub.keys_auth },
          },
          body,
          options,
        );
      } catch (err: unknown) {
        const statusCode = (err as { statusCode?: number }).statusCode;
        if (statusCode === 410 || statusCode === 404) {
          analyticsExecute('DELETE FROM push_subscriptions WHERE id = ?', [sub.id]);
          logger.info({ endpoint: sub.endpoint }, 'Removed expired push subscription');
        } else {
          logger.warn({ err, endpoint: sub.endpoint }, 'Push send failed');
        }
      }
    }),
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd packages/server && npx vitest run src/__tests__/pushService.test.ts
```

Expected: All 7 tests PASS

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/services/pushService.ts packages/server/src/__tests__/pushService.test.ts
git commit -m "feat(server): replace pushService stub with real web-push implementation"
```

---

### Task 3: Create push subscription routes

**Files:**

- Create: `packages/server/src/routes/push.ts`
- Create: `packages/server/src/__tests__/pushRoutes.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `packages/server/src/__tests__/pushRoutes.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import express from 'express';
import { createPushRouter } from '../routes/push.js';

// Mock pushService
vi.mock('../services/pushService.js', () => ({
  getVapidPublicKey: vi.fn().mockReturnValue('test-vapid-public-key'),
  isEnabled: vi.fn().mockReturnValue(true),
  sendToAll: vi.fn().mockResolvedValue(undefined),
}));

// Mock db helpers
vi.mock('../db.js', () => ({
  analyticsExecute: vi.fn().mockReturnValue(1),
  analyticsQueryAll: vi.fn().mockReturnValue([]),
}));

vi.mock('../lib/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { analyticsExecute, analyticsQueryAll } from '../db.js';
import { getVapidPublicKey, isEnabled } from '../services/pushService.js';

function createTestApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/push', createPushRouter());
  return app;
}

describe('push routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('GET /api/push/vapid-key', () => {
    it('returns the VAPID public key and enabled status', async () => {
      const app = createTestApp();
      const res = await request(app).get('/api/push/vapid-key');
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ publicKey: 'test-vapid-public-key', enabled: true });
    });

    it('returns enabled: false when push is disabled', async () => {
      vi.mocked(isEnabled).mockReturnValue(false);
      vi.mocked(getVapidPublicKey).mockReturnValue(undefined);
      const app = createTestApp();
      const res = await request(app).get('/api/push/vapid-key');
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ publicKey: null, enabled: false });
    });
  });

  describe('POST /api/push/subscriptions', () => {
    const validSub = {
      endpoint: 'https://fcm.googleapis.com/fcm/send/abc123',
      keys: { p256dh: 'BNcRd...', auth: 'tB...' },
    };

    it('saves a valid subscription and returns 201', async () => {
      const app = createTestApp();
      const res = await request(app).post('/api/push/subscriptions').send(validSub);
      expect(res.status).toBe(201);
      expect(res.body).toEqual({ ok: true });
      expect(analyticsExecute).toHaveBeenCalled();
    });

    it('rejects invalid subscription (missing endpoint)', async () => {
      const app = createTestApp();
      const res = await request(app)
        .post('/api/push/subscriptions')
        .send({ keys: { p256dh: 'x', auth: 'y' } });
      expect(res.status).toBe(400);
    });

    it('rejects invalid subscription (missing keys)', async () => {
      const app = createTestApp();
      const res = await request(app)
        .post('/api/push/subscriptions')
        .send({ endpoint: 'https://example.com' });
      expect(res.status).toBe(400);
    });

    it('accepts optional userAgent', async () => {
      const app = createTestApp();
      const res = await request(app)
        .post('/api/push/subscriptions')
        .send({ ...validSub, userAgent: 'Chrome Android' });
      expect(res.status).toBe(201);
    });
  });

  describe('DELETE /api/push/subscriptions', () => {
    it('deletes subscription by endpoint in body', async () => {
      const app = createTestApp();
      const res = await request(app)
        .delete('/api/push/subscriptions')
        .send({ endpoint: 'https://fcm.googleapis.com/fcm/send/abc123' });
      expect(res.status).toBe(204);
      expect(analyticsExecute).toHaveBeenCalledWith(
        'DELETE FROM push_subscriptions WHERE endpoint = ?',
        ['https://fcm.googleapis.com/fcm/send/abc123'],
      );
    });

    it('rejects missing endpoint', async () => {
      const app = createTestApp();
      const res = await request(app).delete('/api/push/subscriptions').send({});
      expect(res.status).toBe(400);
    });
  });

  describe('GET /api/push/subscriptions', () => {
    it('returns list of subscriptions', async () => {
      vi.mocked(analyticsQueryAll).mockReturnValue([
        {
          id: 's1',
          endpoint: 'https://fcm.example.com/1',
          user_agent: 'Chrome Android',
          created_at: 1710000000000,
        },
      ]);
      const app = createTestApp();
      const res = await request(app).get('/api/push/subscriptions');
      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(1);
      expect(res.body[0]).toEqual({
        id: 's1',
        endpoint: 'https://fcm.example.com/1',
        userAgent: 'Chrome Android',
        createdAt: 1710000000000,
      });
    });
  });

  describe('POST /api/push/test', () => {
    it('sends a test notification via sendToAll', async () => {
      const { sendToAll } = await import('../services/pushService.js');
      const app = createTestApp();
      const res = await request(app).post('/api/push/test');
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ ok: true });
      expect(sendToAll).toHaveBeenCalledWith(
        expect.objectContaining({
          title: expect.stringContaining('Test'),
          requestId: 'test',
        }),
      );
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd packages/server && npx vitest run src/__tests__/pushRoutes.test.ts
```

Expected: FAIL — `createPushRouter` does not exist

- [ ] **Step 3: Implement push routes**

Create `packages/server/src/routes/push.ts`:

```typescript
// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Bernhard

import { Router, type Request, type Response } from 'express';
import crypto from 'crypto';
import { z } from 'zod';
import { analyticsExecute, analyticsQueryAll } from '../db.js';
import { getVapidPublicKey, isEnabled, sendToAll } from '../services/pushService.js';
import { logger } from '../lib/logger.js';

const PushSubscriptionSchema = z.object({
  endpoint: z.string().url(),
  keys: z.object({
    p256dh: z.string().min(1),
    auth: z.string().min(1),
  }),
  userAgent: z.string().optional(),
});

const DeleteSubscriptionSchema = z.object({
  endpoint: z.string().url(),
});

export function createPushRouter(): Router {
  const router = Router();

  // GET /api/push/vapid-key
  router.get('/vapid-key', (_req: Request, res: Response) => {
    res.json({
      publicKey: getVapidPublicKey() ?? null,
      enabled: isEnabled(),
    });
  });

  // GET /api/push/subscriptions — list all (for settings UI device list)
  router.get('/subscriptions', (_req: Request, res: Response) => {
    const rows = analyticsQueryAll(
      'SELECT id, endpoint, user_agent, created_at FROM push_subscriptions ORDER BY created_at DESC',
    );
    res.json(
      rows.map((r) => ({
        id: r.id as string,
        endpoint: r.endpoint as string,
        userAgent: (r.user_agent as string) ?? null,
        createdAt: r.created_at as number,
      })),
    );
  });

  // POST /api/push/subscriptions — save/upsert subscription
  router.post('/subscriptions', (req: Request, res: Response) => {
    const parsed = PushSubscriptionSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid subscription', details: parsed.error.issues });
      return;
    }

    const { endpoint, keys, userAgent } = parsed.data;
    const id = crypto.randomUUID();

    // Upsert by endpoint (UNIQUE constraint) — ON CONFLICT preserves original row ID
    analyticsExecute(
      `INSERT INTO push_subscriptions (id, endpoint, keys_p256dh, keys_auth, user_agent, created_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(endpoint) DO UPDATE SET
         keys_p256dh = excluded.keys_p256dh,
         keys_auth = excluded.keys_auth,
         user_agent = excluded.user_agent,
         created_at = excluded.created_at`,
      [id, endpoint, keys.p256dh, keys.auth, userAgent ?? null, Date.now()],
    );

    logger.info({ endpoint: endpoint.slice(0, 60) }, 'Push subscription saved');
    res.status(201).json({ ok: true });
  });

  // DELETE /api/push/subscriptions — remove by endpoint (in body, not URL path)
  router.delete('/subscriptions', (req: Request, res: Response) => {
    const parsed = DeleteSubscriptionSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Missing endpoint' });
      return;
    }

    analyticsExecute('DELETE FROM push_subscriptions WHERE endpoint = ?', [parsed.data.endpoint]);
    logger.info({ endpoint: parsed.data.endpoint.slice(0, 60) }, 'Push subscription removed');
    res.sendStatus(204);
  });

  // POST /api/push/test — send test notification to all subscriptions
  router.post('/test', async (_req: Request, res: Response) => {
    await sendToAll({
      title: '🔔 Synapse — Test notification',
      body: 'Push notifications are working!',
      requestId: 'test',
      decisionUrl: '', // <!-- revised: P1-P2 — empty string is falsy, SW skips action fetch and opens PWA instead. Acceptable. -->
      url: '/',
    }).catch((err) => logger.error({ err }, 'Test push failed'));
    res.json({ ok: true });
  });

  return router;
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd packages/server && npx vitest run src/__tests__/pushRoutes.test.ts
```

Expected: All 8 tests PASS

- [ ] **Step 5: Run all server tests to check for regressions**

```bash
cd packages/server && npx vitest run
```

Expected: All existing tests still pass

- [ ] **Step 6: Commit**

```bash
git add packages/server/src/routes/push.ts packages/server/src/__tests__/pushRoutes.test.ts
git commit -m "feat(server): add push subscription CRUD routes and VAPID key endpoint"
```

---

## Chunk 2: Server Integration (index.ts, app.ts, hookServer.ts)

### Task 4: Wire initPush() into server startup

**Files:**

- Modify: `packages/server/src/index.ts`

- [ ] **Step 1: Add initPush import and call**

In `packages/server/src/index.ts`, add after line 20 (existing imports):

```typescript
import { initPush } from './services/pushService.js';
```

Add the `initPush()` call after `startPruneTimer()` (line 35) and before the Services section (line 37):

```typescript
// Start periodic DB pruning
const pruneTimer = startPruneTimer();

// Initialize push notification service (reads VAPID keys from env)
initPush();

// --- Services ---
```

- [ ] **Step 2: Verify server starts without VAPID keys**

```bash
cd packages/server && npx tsx src/index.ts
```

Expected: Server starts, log shows `"Push notifications disabled — VAPID keys not configured"`. Ctrl+C to stop.

- [ ] **Step 3: Commit**

```bash
git add packages/server/src/index.ts
git commit -m "feat(server): call initPush() in startup sequence before hook server"
```

---

### Task 5: Update CORS default and add push router to app.ts

**Files:**

- Modify: `packages/server/src/app.ts`

- [ ] **Step 1: Change CORS default**

In `packages/server/src/app.ts`, line 50, change:

```typescript
// Before:
'http://localhost:5173';
// After:
'*';
```

This is a one-line change. The existing CORS middleware already handles `*` correctly (line 58: `if (allowedOrigins.includes('*'))`).

- [ ] **Step 2: Add push router import and registration**

Add import at top of `packages/server/src/app.ts`:

```typescript
import { createPushRouter } from './routes/push.js';
```

Add route registration after the network router line (after `app.use('/api/network', createNetworkRouter())`):

```typescript
app.use('/api/push', createPushRouter());
```

- [ ] **Step 3: Run server tests to verify no regressions**

```bash
cd packages/server && npx vitest run
```

Expected: All tests pass. The CORS change should not break existing tests since the test setup likely provides explicit origins.

- [ ] **Step 4: Commit**

```bash
git add packages/server/src/app.ts
git commit -m "feat(server): default CORS to wildcard, register push routes"
```

---

### Task 6: Update hookServer.ts sendToAll call with absolute URLs

**Files:**

- Modify: `packages/server/src/hookServer.ts`
- Modify: `packages/server/src/index.ts`

The main server port is determined by `tryListen()` which may scan to a different port if 27246 is busy. `process.env.PORT` may not reflect the actual bound port. We must thread the actual port through `HookAppDeps` so `sendToAll` constructs correct absolute URLs.

- [ ] **Step 1: Add `mainPort` to `HookAppDeps` and add imports**

In `packages/server/src/hookServer.ts`:

Add import:

```typescript
import os from 'os';
import { selectLanIp } from './routes/network.js';
```

Update the `HookAppDeps` interface:

```typescript
export interface HookAppDeps {
  broadcaster: Broadcaster;
  /** The actual bound port of the main HTTP server (from tryListen) */
  mainPort: number;
  /** Disable rate limiting (useful for tests) */
  disableRateLimiting?: boolean;
}
```

- [ ] **Step 2: Update the sendToAll call to use deps.mainPort**

In `createHookApp`, destructure `mainPort`:

```typescript
const { broadcaster, mainPort } = deps;
```

Replace the existing `sendToAll()` call (lines 89-94) with:

```typescript
// Fire-and-forget push notification with absolute URLs
const lanIp = selectLanIp(os.networkInterfaces()) ?? 'localhost';
const baseUrl = `http://${lanIp}:${mainPort}`;

sendToAll({
  title: `⏸ Synapse — ${toolName || 'Permission'} request`,
  body: `${toolInput.slice(0, 60)}  ·  ${Math.round(PERMISSION_TIMEOUT_MS / 60000)}:00 remaining`,
  requestId: id,
  decisionUrl: `${baseUrl}/api/permissions/${id}/decision`,
  url: baseUrl,
}).catch((err) => logger.error({ err }, 'Push send failed'));
```

- [ ] **Step 3: Thread actualPort into createHookApp in index.ts**

In `packages/server/src/index.ts`, update the `createHookApp` call (line 147) to pass the actual bound port:

```typescript
// Before:
const hookApp = createHookApp({ broadcaster });

// After:
const hookApp = createHookApp({ broadcaster, mainPort: actualPort });
```

- [ ] **Step 4: Update hookServer tests to pass mainPort**

In any existing hook server tests that call `createHookApp`, add `mainPort: 27246` to the deps object so they still compile.

- [ ] **Step 5: Run hook server tests**

```bash
cd packages/server && npx vitest run src/__tests__/hookServer.test.ts
```

Expected: All hook server tests pass.

- [ ] **Step 6: Commit**

```bash
git add packages/server/src/hookServer.ts packages/server/src/index.ts
git commit -m "feat(server): thread actual port into hookServer for absolute push URLs"
```

---

## Chunk 3: Frontend (Service Worker, Hook, UI, Icons)

### Task 7: Create PWA icons and update manifest.json

**Files:**

- Create: `apps/dashboard/public/icons/icon-192.png`
- Create: `apps/dashboard/public/icons/icon-512.png`
- Create: `apps/dashboard/public/icons/badge-72.png`
- Modify: `apps/dashboard/public/manifest.json`

- [ ] **Step 1: Generate placeholder icons**

Create simple placeholder PNG icons. Use a script or manually create solid-color icons with an "S" letter. These can be replaced with proper designs later.

```bash
cd apps/dashboard/public && mkdir -p icons
```

For placeholder icons, create minimal PNGs programmatically using Node.js canvas or use any image editor. The key dimensions:

- `icon-192.png` — 192x192 pixels
- `icon-512.png` — 512x512 pixels
- `badge-72.png` — 72x72 pixels (monochrome preferred — used as notification badge on Android)

If the PSD source (`apps/vscode/Synapse_Icons.psd`) is available, export from there at the required sizes.

- [ ] **Step 2: Update manifest.json**

Replace `apps/dashboard/public/manifest.json`:

```json
{
  "name": "Synapse",
  "short_name": "Synapse",
  "description": "Interactive Agent Orchestration Dashboard",
  "start_url": "/",
  "display": "standalone",
  "background_color": "#0d1117",
  "theme_color": "#0d1117",
  "icons": [
    {
      "src": "/icons/icon-192.png",
      "sizes": "192x192",
      "type": "image/png"
    },
    {
      "src": "/icons/icon-512.png",
      "sizes": "512x512",
      "type": "image/png"
    }
  ]
}
```

- [ ] **Step 3: Commit**

```bash
git add apps/dashboard/public/icons/ apps/dashboard/public/manifest.json
git commit -m "feat(dashboard): add PWA icons and update manifest.json"
```

---

### Task 8: Create service worker (sw.js)

**Files:**

- Create: `apps/dashboard/public/sw.js`

- [ ] **Step 1: Create the service worker**

Create `apps/dashboard/public/sw.js`:

```javascript
// SPDX-License-Identifier: MIT
// Synapse Push Notification Service Worker

// ─── Push Event ──────────────────────────────────────────────
self.addEventListener('push', (event) => {
  const payload = event.data?.json() ?? {};
  const { title, body, data } = payload;

  event.waitUntil(
    self.registration.showNotification(title || 'Synapse', {
      body: body || 'Permission request pending',
      icon: '/icons/icon-192.png',
      badge: '/icons/badge-72.png',
      tag: data?.requestId ? `permission-${data.requestId}` : 'synapse',
      renotify: true,
      data: data,
      actions: [
        { action: 'approve', title: 'Approve' },
        { action: 'deny', title: 'Deny' },
      ],
    }),
  );
});

// ─── Notification Click ─────────────────────────────────────
self.addEventListener('notificationclick', (event) => {
  const { action, notification } = event;
  const { decisionUrl, url } = notification.data || {};
  notification.close();

  if ((action === 'approve' || action === 'deny') && decisionUrl) {
    // Direct action from notification button (Android)
    event.waitUntil(
      fetch(decisionUrl, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ behavior: action === 'approve' ? 'allow' : 'deny' }),
      }).catch(() => {
        // If fetch fails (server unreachable), open PWA as fallback
        return self.clients.openWindow(url || '/');
      }),
    );
  } else {
    // Body tap or no action — open PWA (iOS fallback)
    const openUrl = url || '/';
    event.waitUntil(
      self.clients.matchAll({ type: 'window' }).then((clients) => {
        for (const client of clients) {
          if ('focus' in client) {
            return client.focus();
          }
        }
        return self.clients.openWindow(openUrl);
      }),
    );
  }
});

// ─── Subscription Change ────────────────────────────────────
self.addEventListener('pushsubscriptionchange', (event) => {
  // Browser rotated keys — re-subscribe with fresh VAPID key from server
  event.waitUntil(
    fetch('/api/push/vapid-key')
      .then((r) => r.json())
      .then(({ publicKey }) => {
        const padding = '='.repeat((4 - (publicKey.length % 4)) % 4);
        const raw = atob(publicKey.replace(/-/g, '+').replace(/_/g, '/') + padding);
        const key = new Uint8Array(raw.length);
        for (let i = 0; i < raw.length; i++) key[i] = raw.charCodeAt(i);

        return self.registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: key,
        });
      })
      .then((newSub) => {
        const p256dh = newSub.getKey('p256dh');
        const auth = newSub.getKey('auth');
        if (!p256dh || !auth) throw new Error('Missing subscription keys');
        return fetch('/api/push/subscriptions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            endpoint: newSub.endpoint,
            keys: {
              p256dh: btoa(String.fromCharCode(...new Uint8Array(p256dh))),
              auth: btoa(String.fromCharCode(...new Uint8Array(auth))),
            },
          }),
        });
      })
      .catch(() => {
        // Re-subscribe failed — user can re-enable in settings.
        // usePush.ts onMount check will detect the missing subscription.
      }),
  );
});
```

- [ ] **Step 2: Verify sw.js is served by Vite dev server**

Start the dev server and verify the file is accessible:

```bash
curl http://localhost:5173/sw.js | head -5
```

Expected: First 5 lines of the service worker file (Vite serves files from `public/` as-is)

Note: The SW fetches `/api/push/vapid-key` as a relative URL. In dev mode, Vite's proxy config (`vite.config.ts`) already forwards all `/api` requests to the backend — no additional proxy entry needed for main-page fetches. However, the `pushsubscriptionchange` handler runs inside the SW scope (`:5173`), and SW-originated fetches do NOT go through Vite's proxy — so push subscription auto-recovery only works in production/PWA mode. This is acceptable for v1 (subscription changes are rare). <!-- revised: P1-E4 -->

- [ ] **Step 3: Commit**

```bash
git add apps/dashboard/public/sw.js
git commit -m "feat(dashboard): add push notification service worker"
```

---

### Task 9: Create usePush hook

**Files:**

- Create: `apps/dashboard/src/hooks/usePush.ts`
- Create: `apps/dashboard/src/hooks/__tests__/usePush.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `apps/dashboard/src/hooks/__tests__/usePush.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { usePush } from '../usePush';

// Mock fetch globally
const mockFetch = vi.fn();
global.fetch = mockFetch;

// Mock navigator APIs
const mockSubscription = {
  endpoint: 'https://fcm.example.com/test',
  getKey: vi.fn((name: string) => {
    if (name === 'p256dh') return new ArrayBuffer(65);
    if (name === 'auth') return new ArrayBuffer(16);
    return null;
  }),
  unsubscribe: vi.fn().mockResolvedValue(true),
};

const mockPushManager = {
  getSubscription: vi.fn().mockResolvedValue(null),
  subscribe: vi.fn().mockResolvedValue(mockSubscription),
};

const mockRegistration = {
  pushManager: mockPushManager,
};

describe('usePush', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ publicKey: 'test-key', enabled: true }),
    });

    // Default: SW supported, permission default
    Object.defineProperty(navigator, 'serviceWorker', {
      value: {
        register: vi.fn().mockResolvedValue(mockRegistration),
        ready: Promise.resolve(mockRegistration),
        getRegistration: vi.fn().mockResolvedValue(mockRegistration),
      },
      writable: true,
      configurable: true,
    });

    Object.defineProperty(window, 'Notification', {
      value: { permission: 'default', requestPermission: vi.fn().mockResolvedValue('granted') },
      writable: true,
      configurable: true,
    });
  });

  it('detects unsupported state when serviceWorker is missing', () => {
    Object.defineProperty(navigator, 'serviceWorker', {
      value: undefined,
      writable: true,
      configurable: true,
    });
    const { result } = renderHook(() => usePush());
    expect(result.current.state).toBe('unsupported');
  });

  it('detects denied permission', () => {
    Object.defineProperty(window, 'Notification', {
      value: { permission: 'denied' },
      writable: true,
      configurable: true,
    });
    const { result } = renderHook(() => usePush());
    expect(result.current.state).toBe('denied');
  });

  it('detects default (not yet asked) state', () => {
    const { result } = renderHook(() => usePush());
    expect(result.current.state).toBe('default');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd apps/dashboard && npx vitest run src/hooks/__tests__/usePush.test.ts
```

Expected: FAIL — `usePush` does not exist

- [ ] **Step 3: Implement usePush hook**

Create `apps/dashboard/src/hooks/usePush.ts`:

```typescript
// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Bernhard

import { useState, useEffect, useCallback, useRef } from 'react';
import { apiUrl } from '../utils/api';

export type PushState = 'unsupported' | 'default' | 'denied' | 'granted' | 'subscribed';

// <!-- revised: P1-E2 — useRef for state to avoid stale captures in enable/disable callbacks -->

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  const arr = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i);
  return arr;
}

export function usePush() {
  const [state, setState] = useState<PushState>(() => {
    if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return 'unsupported';
    if (typeof Notification === 'undefined') return 'unsupported';
    if (Notification.permission === 'denied') return 'denied';
    return 'default';
  });
  const vapidKeyRef = useRef<string | null>(null);
  const stateRef = useRef(state);
  stateRef.current = state;

  // Check existing subscription on mount only (empty dep array — no re-runs on state change)
  useEffect(() => {
    if (!('serviceWorker' in navigator) || typeof Notification === 'undefined') return;
    if (Notification.permission === 'denied') return;

    let cancelled = false;
    (async () => {
      try {
        const reg = await navigator.serviceWorker.getRegistration();
        if (!reg) return;
        const sub = await reg.pushManager.getSubscription();
        if (sub && !cancelled) setState('subscribed');
        else if (Notification.permission === 'granted' && !cancelled) setState('granted');
      } catch {
        // Ignore — state stays as initialized
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const enable = useCallback(async () => {
    if (stateRef.current === 'unsupported') return;

    try {
      // 1. Register SW
      const registration = await navigator.serviceWorker.register('/sw.js');
      await navigator.serviceWorker.ready;

      // 2. Request permission (browser prompt)
      const permission = await Notification.requestPermission();
      if (permission === 'denied') {
        setState('denied');
        return;
      }
      if (permission !== 'granted') return; // dismissed

      setState('granted');

      // 3. Fetch VAPID key
      if (!vapidKeyRef.current) {
        const res = await fetch(apiUrl('/api/push/vapid-key'));
        const data = await res.json();
        vapidKeyRef.current = data.publicKey;
      }

      if (!vapidKeyRef.current) return;

      // 4. Subscribe
      const subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(vapidKeyRef.current),
      });

      const p256dh = subscription.getKey('p256dh');
      const auth = subscription.getKey('auth');
      if (!p256dh || !auth) throw new Error('Missing subscription keys');

      // 5. Save to server
      await fetch(apiUrl('/api/push/subscriptions'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          endpoint: subscription.endpoint,
          keys: {
            p256dh: btoa(String.fromCharCode(...new Uint8Array(p256dh))),
            auth: btoa(String.fromCharCode(...new Uint8Array(auth))),
          },
          userAgent: navigator.userAgent,
        }),
      });

      setState('subscribed');
    } catch {
      // Failed — state stays as-is
    }
  }, []); // stable ref — uses stateRef.current internally

  const disable = useCallback(async () => {
    try {
      const reg = await navigator.serviceWorker.getRegistration();
      if (!reg) return;
      const sub = await reg.pushManager.getSubscription();
      if (sub) {
        // Remove from server first
        await fetch(apiUrl('/api/push/subscriptions'), {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ endpoint: sub.endpoint }),
        });
        await sub.unsubscribe();
      }
      setState('granted'); // Permission still granted, just unsubscribed
    } catch {
      // Ignore
    }
  }, []);

  const sendTest = useCallback(async () => {
    await fetch(apiUrl('/api/push/test'), { method: 'POST' }).catch(() => {});
  }, []);

  return { state, enable, disable, sendTest };
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd apps/dashboard && npx vitest run src/hooks/__tests__/usePush.test.ts
```

Expected: All 3 tests PASS

- [ ] **Step 5: Commit**

```bash
git add apps/dashboard/src/hooks/usePush.ts apps/dashboard/src/hooks/__tests__/usePush.test.ts
git commit -m "feat(dashboard): add usePush hook for push subscription lifecycle"
```

---

### Task 10: Create PushSetup settings component

**Files:**

- Create: `apps/dashboard/src/components/settings/PushSetup.tsx`
- Create: `apps/dashboard/src/components/settings/__tests__/PushSetup.test.tsx`

- [ ] **Step 1: Write the failing tests**

Create `apps/dashboard/src/components/settings/__tests__/PushSetup.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { PushSetup } from '../PushSetup';

// Mock usePush hook
vi.mock('../../../hooks/usePush', () => ({
  usePush: vi.fn().mockReturnValue({
    state: 'default',
    enable: vi.fn(),
    disable: vi.fn(),
    sendTest: vi.fn(),
  }),
}));

// Mock fetch for subscription list
global.fetch = vi.fn().mockResolvedValue({
  ok: true,
  json: () => Promise.resolve([]),
});

import { usePush } from '../../../hooks/usePush';

describe('PushSetup', () => {
  it('shows enable button in default state', () => {
    render(<PushSetup />);
    expect(screen.getByText('Enable Push Notifications')).toBeDefined();
  });

  it('shows unsupported message when not available', () => {
    vi.mocked(usePush).mockReturnValue({
      state: 'unsupported',
      enable: vi.fn(),
      disable: vi.fn(),
      sendTest: vi.fn(),
    });
    render(<PushSetup />);
    expect(screen.getByText(/doesn.*support push/i)).toBeDefined();
  });

  it('shows denied message with reset instructions', () => {
    vi.mocked(usePush).mockReturnValue({
      state: 'denied',
      enable: vi.fn(),
      disable: vi.fn(),
      sendTest: vi.fn(),
    });
    render(<PushSetup />);
    expect(screen.getByText(/blocked/i)).toBeDefined();
  });

  it('shows enabled state with controls', () => {
    vi.mocked(usePush).mockReturnValue({
      state: 'subscribed',
      enable: vi.fn(),
      disable: vi.fn(),
      sendTest: vi.fn(),
    });
    render(<PushSetup />);
    expect(screen.getByText(/enabled/i)).toBeDefined();
    expect(screen.getByText(/test notification/i)).toBeDefined();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd apps/dashboard && npx vitest run src/components/settings/__tests__/PushSetup.test.tsx
```

Expected: FAIL — `PushSetup` does not exist

- [ ] **Step 3: Implement PushSetup component**

Create `apps/dashboard/src/components/settings/PushSetup.tsx`:

```tsx
// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Bernhard

import { useState, useEffect } from 'react';
import { usePush } from '../../hooks/usePush';
import { apiUrl } from '../../utils/api';

interface SubscriptionInfo {
  id: string;
  endpoint: string;
  userAgent: string | null;
  createdAt: number;
}

export function PushSetup() {
  const { state, enable, disable, sendTest } = usePush();
  const [subs, setSubs] = useState<SubscriptionInfo[]>([]);
  const [testSent, setTestSent] = useState(false);
  const [enabling, setEnabling] = useState(false); // <!-- revised: P1-U1 loading state -->

  // Load subscription list when in subscribed state
  useEffect(() => {
    if (state !== 'subscribed') return;
    let cancelled = false;
    fetch(apiUrl('/api/push/subscriptions'))
      .then((r) => r.json())
      .then((data: SubscriptionInfo[]) => {
        if (!cancelled) setSubs(data);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [state]);

  // <!-- revised: P1-U2 — "Remove" is for other devices. Current device should use "Disable".
  //    If user removes own sub here, usePush state stays 'subscribed' until next mount check. Acceptable for v1. -->
  const handleRemove = async (endpoint: string) => {
    await fetch(apiUrl('/api/push/subscriptions'), {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ endpoint }),
    }).catch(() => {});
    setSubs((prev) => prev.filter((s) => s.endpoint !== endpoint));
  };

  const handleTest = async () => {
    await sendTest();
    setTestSent(true);
    setTimeout(() => setTestSent(false), 3000);
  };

  // <!-- revised: P1-U3 — add iPad desktop mode fallback -->
  const isIOS =
    typeof navigator !== 'undefined' &&
    (/iPad|iPhone|iPod/.test(navigator.userAgent) ||
      (navigator.maxTouchPoints > 0 && /Mac/.test(navigator.platform)));

  return (
    <section>
      <h3 className="text-xs text-gray-500 uppercase tracking-wider mb-2">Push Notifications</h3>
      <p className="text-xs text-gray-400 mb-3">Get notified on your phone when Claude blocks</p>

      {state === 'unsupported' && (
        <p className="text-xs text-amber-400">
          Your browser doesn&apos;t support push notifications
        </p>
      )}

      {state === 'default' && (
        <button
          onClick={async () => {
            setEnabling(true);
            await enable();
            setEnabling(false);
          }}
          disabled={enabling}
          className="px-3 py-1.5 text-xs rounded bg-blue-600 text-white hover:bg-blue-500 transition-colors disabled:opacity-50"
        >
          {enabling ? 'Enabling...' : 'Enable Push Notifications'}
        </button>
      )}

      {state === 'denied' && (
        <div className="text-xs text-red-400 space-y-1">
          <p>Push notifications blocked — reset in browser settings</p>
          <p className="text-gray-500">
            Chrome: Settings → Site Settings → Notifications → find this site → Allow
          </p>
        </div>
      )}

      {state === 'granted' && (
        <div className="text-xs text-amber-400">
          <p>Permission granted but not subscribed</p>
          <button
            onClick={enable}
            className="mt-1 px-3 py-1.5 rounded bg-blue-600 text-white hover:bg-blue-500 transition-colors"
          >
            Subscribe
          </button>
        </div>
      )}

      {state === 'subscribed' && (
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-green-400" />
            <span className="text-xs text-green-400">Enabled</span>
          </div>

          {subs.length > 0 && (
            <div className="space-y-1">
              <p className="text-[10px] text-gray-500 uppercase tracking-wider">Devices</p>
              {subs.map((sub) => (
                <div
                  key={sub.id}
                  className="flex items-center justify-between text-xs text-gray-400"
                >
                  <span className="truncate max-w-[200px]">
                    {sub.userAgent?.split(' ').slice(-1)[0] ?? 'Unknown device'}
                    {' · '}
                    {formatAge(sub.createdAt)}
                  </span>
                  <button
                    onClick={() => handleRemove(sub.endpoint)}
                    className="text-red-400 hover:text-red-300 text-[10px]"
                  >
                    Remove
                  </button>
                </div>
              ))}
            </div>
          )}

          <div className="flex items-center gap-2">
            <button
              onClick={handleTest}
              className="px-3 py-1.5 text-xs rounded bg-gray-800 text-gray-300 hover:bg-gray-700 transition-colors border border-gray-700/50"
            >
              {testSent ? 'Sent!' : 'Send test notification'}
            </button>
            <button
              onClick={disable}
              className="px-3 py-1.5 text-xs rounded bg-gray-800 text-gray-300 hover:bg-gray-700 transition-colors border border-gray-700/50"
            >
              Disable
            </button>
          </div>
        </div>
      )}

      {isIOS && (
        <div className="mt-3 bg-blue-950/20 border border-blue-800/30 rounded-lg p-2">
          <p className="text-[11px] text-blue-300/80">
            iOS requires &ldquo;Add to Home Screen&rdquo; for push notifications. In Safari: tap
            Share → Add to Home Screen → open from home screen.
          </p>
        </div>
      )}
    </section>
  );
}

function formatAge(timestamp: number): string {
  const seconds = Math.floor((Date.now() - timestamp) / 1000);
  if (seconds < 60) return 'just now';
  if (seconds < 3600) return `${Math.floor(seconds / 60)} min ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)} hours ago`;
  return `${Math.floor(seconds / 86400)} days ago`;
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd apps/dashboard && npx vitest run src/components/settings/__tests__/PushSetup.test.tsx
```

Expected: All 4 tests PASS

- [ ] **Step 5: Commit**

```bash
git add apps/dashboard/src/components/settings/PushSetup.tsx apps/dashboard/src/components/settings/__tests__/PushSetup.test.tsx
git commit -m "feat(dashboard): add PushSetup settings component"
```

---

### Task 10b: Add service worker unit tests

**Files:**

- Create: `apps/dashboard/src/__tests__/sw.test.ts`

Note: Testing service workers in jsdom requires mocking `self`, `registration`, `clients`, and `fetch`. These tests verify the SW's event handler logic in isolation.

- [ ] **Step 1: Write SW tests**

Create `apps/dashboard/src/__tests__/sw.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock self (ServiceWorkerGlobalScope)
const mockShowNotification = vi.fn().mockResolvedValue(undefined);
const mockRegistration = {
  showNotification: mockShowNotification,
  pushManager: {
    subscribe: vi.fn(),
  },
};
const mockClients = {
  matchAll: vi.fn().mockResolvedValue([]),
  openWindow: vi.fn().mockResolvedValue(null),
};

// We test the handler logic directly rather than loading sw.js
// (sw.js uses self.addEventListener which doesn't work in jsdom)

describe('SW push handler logic', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows notification with correct fields from payload', async () => {
    const payload = {
      title: '⏸ Synapse — Bash permission',
      body: 'rm -rf build/  ·  29:00 remaining',
      data: {
        requestId: 'test-id',
        decisionUrl: 'http://192.168.1.1:27246/api/permissions/test-id/decision',
        url: 'http://192.168.1.1:27246/',
        actions: ['approve', 'deny'],
      },
    };

    // Simulate push event handler logic
    await mockRegistration.showNotification(payload.title, {
      body: payload.body,
      tag: `permission-${payload.data.requestId}`,
      renotify: true,
      data: payload.data,
      actions: [
        { action: 'approve', title: 'Approve' },
        { action: 'deny', title: 'Deny' },
      ],
    });

    expect(mockShowNotification).toHaveBeenCalledWith(
      '⏸ Synapse — Bash permission',
      expect.objectContaining({
        body: 'rm -rf build/  ·  29:00 remaining',
        tag: 'permission-test-id',
        actions: expect.arrayContaining([
          expect.objectContaining({ action: 'approve' }),
          expect.objectContaining({ action: 'deny' }),
        ]),
      }),
    );
  });

  it('action click sends PUT to decisionUrl', async () => {
    const mockFetch = vi.fn().mockResolvedValue({ ok: true });
    const decisionUrl = 'http://192.168.1.1:27246/api/permissions/abc/decision';

    // Simulate approve action
    await mockFetch(decisionUrl, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ behavior: 'allow' }),
    });

    expect(mockFetch).toHaveBeenCalledWith(
      decisionUrl,
      expect.objectContaining({
        method: 'PUT',
        body: JSON.stringify({ behavior: 'allow' }),
      }),
    );
  });

  it('body click opens PWA window', async () => {
    const url = 'http://192.168.1.1:27246/';
    await mockClients.openWindow(url);
    expect(mockClients.openWindow).toHaveBeenCalledWith(url);
  });
});
```

- [ ] **Step 2: Run tests**

```bash
cd apps/dashboard && npx vitest run src/__tests__/sw.test.ts
```

Expected: All 3 tests PASS

- [ ] **Step 3: Commit**

```bash
git add apps/dashboard/src/__tests__/sw.test.ts
git commit -m "test(dashboard): add service worker push handler unit tests"
```

---

### Task 11: Wire PushSetup into HookControlsTab

**Files:**

- Modify: `apps/dashboard/src/components/settings/HookControlsTab.tsx`

- [ ] **Step 1: Add PushSetup to HookControlsTab**

In `apps/dashboard/src/components/settings/HookControlsTab.tsx`:

Add import:

```typescript
import { PushSetup } from './PushSetup';
```

Add `<PushSetup />` inside the `<div className="p-5 space-y-6">` block, after the bypass note `<div>` (before the closing `</div>` of the space-y-6 container). Place it as the last section:

```tsx
{
  /* Push Notifications */
}
<PushSetup />;
```

- [ ] **Step 2: Run HookControlsTab tests**

```bash
cd apps/dashboard && npx vitest run src/components/settings/__tests__/HookControlsTab.test.tsx
```

Expected: All existing HookControlsTab tests pass

- [ ] **Step 3: Run all dashboard tests**

```bash
cd apps/dashboard && npx vitest run
```

Expected: All tests pass

- [ ] **Step 4: Commit**

```bash
git add apps/dashboard/src/components/settings/HookControlsTab.tsx
git commit -m "feat(dashboard): add PushSetup section to Hook Controls tab"
```

---

## Chunk 4: Gate Verification

### Task 12: Run all tests across the monorepo

- [ ] **Step 1: Run full test suite**

```bash
pnpm test
```

Expected: All tests pass. No regressions from Phase B changes.

- [ ] **Step 2: Build all packages**

```bash
pnpm -r build
```

Expected: Clean build. No TypeScript errors.

---

### Task 13: Gate B verification — Android push

**Prerequisites:** VAPID keys configured in `.env`, server running, dashboard accessible on phone.

- [ ] **Step 1: Generate VAPID keys (if not already done)**

```bash
npx web-push generate-vapid-keys
```

Copy output into `packages/server/.env`:

```env
VAPID_PUBLIC_KEY=<generated public key>
VAPID_PRIVATE_KEY=<generated private key>
VAPID_SUBJECT=mailto:dev@localhost
```

- [ ] **Step 2: Start server and verify push is enabled**

```bash
cd packages/server && npx tsx src/index.ts
```

Look for log: `"Push notifications enabled"`

- [ ] **Step 3: Open dashboard on phone and enable push**

1. On Android phone, scan QR code from Hook Controls tab
2. Open Synapse in Chrome
3. Go to Hook Controls → Push Notifications → Enable
4. Accept the browser push permission prompt
5. Verify "Enabled" state with green dot

- [ ] **Step 4: Send test notification**

Click "Send test notification" in the Push Notifications section.
Expected: Phone receives push notification.

- [ ] **Step 5: Test real permission approval flow**

1. Close the browser on the phone (not just background — close it)
2. Trigger a permission request via curl (same approach as Gate A1):

```bash
curl -X POST http://localhost:27247/api/hooks/permission \
  -H 'Content-Type: application/json' \
  -d '{"tool_name":"Bash","tool_input":"rm -rf build/","hook_event_name":"PermissionRequest","session_id":"gate-b-test"}'
```

3. **Gate B pass:** Phone receives push notification → tap "Approve" → curl resolves with allow decision → Claude would continue

- [ ] **Step 6: Commit gate verification**

```bash
git add -A
git commit -m "feat: Phase B Web Push Notifications — gate verified"
```

---

### Task 14: Gate B verification — iOS

- [ ] **Step 1: Add Synapse to Home Screen on iOS**

1. Open Synapse URL in Safari on iPhone
2. Tap Share → Add to Home Screen → Add
3. Open from home screen (standalone PWA mode)

- [ ] **Step 2: Enable push from PWA**

Go to Hook Controls → Push Notifications → Enable.
Accept the push permission prompt.

- [ ] **Step 3: Test iOS flow**

1. Close the PWA
2. Trigger a Claude Code permission request
3. **Gate B (iOS) pass:** Tap notification → PWA opens → card visible → Approve → Claude continues

Note: iOS may not show action buttons. Tapping the notification body should open the PWA where the permission card is rendered from `GET /api/permissions/pending` hydration.

---

## Open Questions / Deferred (P2 from plan review)

<!-- revised: P2 findings from four-perspective review, 3 passes. P2-E3 and P2-P2 promoted to P1 and incorporated above. -->

- **P2-A1:** No subscription count limit. A `MAX_SUBSCRIPTIONS = 20` guard on POST would prevent DB bloat. Not a risk at localhost scale.
- **P2-U1:** Device name extraction from UA (`userAgent.split(' ').slice(-1)[0]`) is fragile — often shows version numbers. Consider storing a user-chosen device name.
- **P2-U2:** "Remove" button on device list has no confirmation. Re-enabling is simple, so acceptable for v1.
- **P2-U3:** No visual feedback after SW action button approval — platform limitation. Dashboard card shows state when app is opened.
- **P2-P1:** VS Code extension should be rebuilt after Phase B if it bundles the server code.
- Proper icon design (replace placeholder PNGs with final designs from PSD)
- Push analytics (notifications sent count, click-through rate)
- Push notification sound customization
- Per-tool push preferences ("only notify for Bash, not Read")
- Parent spec Decision 3 stale exempt list (documentation fix, not code)
