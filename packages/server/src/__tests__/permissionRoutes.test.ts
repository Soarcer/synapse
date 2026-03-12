import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import request from 'supertest';
import type { Express, Response } from 'express';
import { initDb } from '../db.js';
import { pending, decisions } from '../state/permissionState.js';

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
    let resolvedWith: unknown = null;
    const mockRes = {
      json: (body: unknown) => {
        resolvedWith = body;
      },
    };

    pending.set('test-id', {
      res: mockRes as unknown as Response,
      event: { session_id: 'sess-1', hook_event_name: 'PermissionRequest', tool_name: 'Bash' },
      timer: setTimeout(() => {}, 999999),
      createdAt: Date.now() - 5000,
    });

    const res = await request(app)
      .put('/api/permissions/test-id/decision')
      .send({ behavior: 'allow' });

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(
      (resolvedWith as { hookSpecificOutput: { decision: { behavior: string } } })
        .hookSpecificOutput.decision.behavior,
    ).toBe('allow');
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
      res: { json: () => {} } as unknown as Response,
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
      res: {} as unknown as Response,
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
    expect(item.tool_input_preview.length).toBeLessThanOrEqual(200);
    expect(item.createdAt).toBe(now);
    expect(item.expiresAt).toBeDefined();
  });
});
