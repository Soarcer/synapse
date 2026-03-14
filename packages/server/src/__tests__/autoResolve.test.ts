// packages/server/src/__tests__/autoResolve.test.ts
import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest';
import type { Express, Response } from 'express';
import request from 'supertest';
import { initDb, insertEvent } from '../db.js';
import {
  pending,
  startConnectionMonitor,
  stopConnectionMonitor,
} from '../state/permissionState.js';
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
    res: mockRes as unknown as Response,
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

  it('maps PostToolUse->allow, PostToolUseFailure->deny, Stop->allow', async () => {
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
      res: mockRes as unknown as Response,
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
      res: mockRes as unknown as Response,
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
      res: mockRes as unknown as Response,
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

  it('resolves when socket alive but session has newer events in DB (Layer 2b)', async () => {
    const id = 'perm-conn-db';
    const createdAt = Date.now() - 5000; // Permission created 5s ago
    const mockRes = {
      json: vi.fn(),
      socket: { destroyed: false },
      writableEnded: false,
    };
    pending.set(id, {
      res: mockRes as unknown as Response,
      event: {
        session_id: 'sess-conn-db',
        tool_name: 'AskUserQuestion',
        hook_event_name: 'PermissionRequest',
      },
      timer: setTimeout(() => {}, 999999),
      createdAt,
    });

    // Insert an event for the same session AFTER the permission was created
    insertEvent({
      event_id: 'evt-after-perm',
      session_id: 'sess-conn-db',
      hook_event_name: 'PostToolUse',
      event_type: 'tool_end',
      tool_name: 'AskUserQuestion',
      tool_use_id: 'toolu_db',
      raw_payload: '{}',
      cwd: '/tmp',
      created_at: createdAt + 2000, // 2s after permission
    });

    startConnectionMonitor(broadcaster);
    await vi.advanceTimersByTimeAsync(2100);

    // Socket is alive, but DB shows session advanced → should resolve
    expect(pending.has(id)).toBe(false);
    expect(broadcastSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'permissionResolved',
        data: expect.objectContaining({ id, behavior: 'allow' }),
      }),
    );
    // Should have sent the HTTP response (socket was alive)
    expect(mockRes.json).toHaveBeenCalled();
  });
});
