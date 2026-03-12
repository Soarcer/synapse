import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { initDb } from '../db.js';
import { pending } from '../state/permissionState.js';

// We test the Express app directly (not the listen() part)
process.env.SYNAPSE_DB_PATH = ':memory:';

let app: Express;

beforeAll(async () => {
  await initDb();
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
    // Use callback form to fire the request immediately
    const responsePromise = new Promise<request.Response>((resolve, reject) => {
      request(app)
        .post('/api/hooks/permission')
        .send({
          session_id: 'sess-1',
          tool_name: 'Bash',
          tool_input: { command: 'ls' },
          hook_event_name: 'PermissionRequest',
        })
        .end((err, res) => {
          if (err) reject(err);
          else resolve(res);
        });
    });

    // Wait for the request to be processed
    await new Promise((r) => setTimeout(r, 100));

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

    const res = await responsePromise;
    expect(res.status).toBe(200);
    expect(res.body.hookSpecificOutput.decision.behavior).toBe('allow');
  });

  it('returns 429 when MAX_PENDING is reached', async () => {
    // Fill pending to max (mock entries — no real response objects needed for count check)
    const { MAX_PENDING } = await import('../state/permissionState.js');
    for (let i = 0; i < MAX_PENDING; i++) {
      pending.set(`fill-${i}`, {
        res: {} as unknown as import('express').Response,
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
