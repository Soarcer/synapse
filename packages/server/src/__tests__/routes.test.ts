// Set DB path to a non-existent temp location BEFORE any server imports
// so sql.js creates a fresh in-memory database.
import path from 'path';
import os from 'os';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
process.env.SYNAPSE_DB_PATH = path.join(
  os.tmpdir(),
  'synapse-test-routes-' + Date.now() + '.db',
);

import request from 'supertest';
import type { Express } from 'express';
import { initDb, deleteAllEvents } from '../db.js';
import { createApp } from '../app.js';
import { Broadcaster } from '../services/broadcaster.js';
import { AgentManager } from '../services/agentManager.js';

// ─── Shared Fixtures ──────────────────────────────────────────────────

const VALID_HOOK_EVENT = {
  hook_event_name: 'SessionStart',
  session_id: 'test-session-1',
  model: 'claude-opus-4-6',
  cwd: '/test/project',
};

function makeSnapshotPayload(events: Record<string, unknown>[] = []) {
  return {
    version: 1,
    exportedAt: new Date().toISOString(),
    projectDir: '/test/project',
    sessions: [
      {
        sessionId: 'snap-session-1',
        events,
        transcript: null,
      },
    ],
  };
}

function makeSnapshotEvent(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    type: 'session_start',
    sessionId: 'snap-session-1',
    timestamp: Date.now(),
    eventSource: 'hook',
    vendor: 'anthropic',
    ...overrides,
  };
}

// ─── Setup ────────────────────────────────────────────────────────────

let app: Express;
let broadcaster: Broadcaster;
let agentManager: AgentManager;

beforeAll(async () => {
  await initDb();
  broadcaster = new Broadcaster();
  agentManager = new AgentManager();
  app = createApp({ broadcaster, agentManager, disableRateLimiting: true });
});

afterEach(() => {
  deleteAllEvents();
});

afterAll(() => {
  broadcaster.destroy();
  agentManager.stopAll();
});

// ═══════════════════════════════════════════════════════════════════════
// POST /api/events
// ═══════════════════════════════════════════════════════════════════════

describe('POST /api/events', () => {
  it('returns 200 with eventId for a valid hook event', async () => {
    const res = await request(app)
      .post('/api/events')
      .send(VALID_HOOK_EVENT)
      .expect(200);

    expect(res.body.ok).toBe(true);
    expect(typeof res.body.eventId).toBe('string');
    expect(res.body.eventId.length).toBeGreaterThan(0);
  });

  it('returns 400 for a malformed body (non-object payload)', async () => {
    // Sending a JSON array instead of an object fails Zod's z.object() validation
    const res = await request(app)
      .post('/api/events')
      .send([1, 2, 3])
      .expect(400);

    expect(res.body.error).toBeDefined();
    expect(res.body.error).toBe('Validation failed');
  });
});

// ═══════════════════════════════════════════════════════════════════════
// GET /api/events
// ═══════════════════════════════════════════════════════════════════════

describe('GET /api/events', () => {
  it('returns an empty array when no events exist', async () => {
    const res = await request(app).get('/api/events').expect(200);

    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.length).toBe(0);
  });

  it('returns stored events after POST', async () => {
    // Insert an event first
    await request(app).post('/api/events').send(VALID_HOOK_EVENT).expect(200);

    const res = await request(app).get('/api/events').expect(200);

    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.length).toBeGreaterThanOrEqual(1);
    expect(res.body[0].sessionId).toBe('test-session-1');
    expect(res.body[0].type).toBe('session_start');
  });

  it('respects limit query parameter for pagination', async () => {
    // Insert multiple events
    await request(app)
      .post('/api/events')
      .send({ ...VALID_HOOK_EVENT, session_id: 'sess-a' })
      .expect(200);
    await request(app)
      .post('/api/events')
      .send({ ...VALID_HOOK_EVENT, session_id: 'sess-b' })
      .expect(200);
    await request(app)
      .post('/api/events')
      .send({ ...VALID_HOOK_EVENT, session_id: 'sess-c' })
      .expect(200);

    const res = await request(app).get('/api/events?limit=1').expect(200);

    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.length).toBe(1);
  });
});

// ═══════════════════════════════════════════════════════════════════════
// GET /api/events/sessions
// ═══════════════════════════════════════════════════════════════════════

describe('GET /api/events/sessions', () => {
  it('returns session summaries', async () => {
    await request(app).post('/api/events').send(VALID_HOOK_EVENT).expect(200);
    await request(app)
      .post('/api/events')
      .send({ ...VALID_HOOK_EVENT, hook_event_name: 'Stop' })
      .expect(200);

    const res = await request(app).get('/api/events/sessions').expect(200);

    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.length).toBeGreaterThanOrEqual(1);

    const session = res.body.find(
      (s: Record<string, unknown>) => s.session_id === 'test-session-1',
    );
    expect(session).toBeDefined();
    expect(session.event_count).toBeGreaterThanOrEqual(2);
  });
});

// ═══════════════════════════════════════════════════════════════════════
// DELETE /api/events
// ═══════════════════════════════════════════════════════════════════════

describe('DELETE /api/events', () => {
  it('clears all events and returns deleted count', async () => {
    await request(app).post('/api/events').send(VALID_HOOK_EVENT).expect(200);
    await request(app).post('/api/events').send(VALID_HOOK_EVENT).expect(200);

    const delRes = await request(app).delete('/api/events').expect(200);

    expect(delRes.body.ok).toBe(true);
    expect(delRes.body.deleted).toBeGreaterThanOrEqual(2);

    // Verify empty
    const getRes = await request(app).get('/api/events').expect(200);
    expect(getRes.body.length).toBe(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════
// DELETE /api/events/session/:id
// ═══════════════════════════════════════════════════════════════════════

describe('DELETE /api/events/session/:id', () => {
  it('clears events for a specific session', async () => {
    await request(app)
      .post('/api/events')
      .send({ ...VALID_HOOK_EVENT, session_id: 'del-sess-1' })
      .expect(200);
    await request(app)
      .post('/api/events')
      .send({ ...VALID_HOOK_EVENT, session_id: 'del-sess-2' })
      .expect(200);

    const delRes = await request(app)
      .delete('/api/events/session/del-sess-1')
      .expect(200);

    expect(delRes.body.ok).toBe(true);
    expect(delRes.body.deleted).toBe(1);

    // Session 2 should still exist
    const getRes = await request(app)
      .get('/api/events?sessionId=del-sess-2')
      .expect(200);
    expect(getRes.body.length).toBe(1);
  });
});

// ═══════════════════════════════════════════════════════════════════════
// GET /api/agents
// ═══════════════════════════════════════════════════════════════════════

describe('GET /api/agents', () => {
  it('returns an empty agent list initially', async () => {
    const res = await request(app).get('/api/agents').expect(200);

    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.length).toBe(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════
// DELETE /api/agents/:id
// ═══════════════════════════════════════════════════════════════════════

describe('DELETE /api/agents/:id', () => {
  it('returns 404 for a nonexistent agent', async () => {
    const res = await request(app)
      .delete('/api/agents/nonexistent')
      .expect(404);

    expect(res.body.error).toBe('Agent not found');
  });
});

// ═══════════════════════════════════════════════════════════════════════
// GET /api/health
// ═══════════════════════════════════════════════════════════════════════

describe('GET /api/health', () => {
  it('returns health status with ok:true and db stats', async () => {
    const res = await request(app).get('/api/health').expect(200);

    expect(res.body.ok).toBe(true);
    expect(typeof res.body.clients).toBe('number');
    expect(typeof res.body.agents).toBe('number');
    expect(res.body.db).toBeDefined();
    expect(typeof res.body.db.totalEvents).toBe('number');
    expect(typeof res.body.db.totalSessions).toBe('number');
  });
});

// ═══════════════════════════════════════════════════════════════════════
// GET /api/snapshot/export
// ═══════════════════════════════════════════════════════════════════════

describe('GET /api/snapshot/export', () => {
  it('returns an empty sessions array when no events exist', async () => {
    const res = await request(app).get('/api/snapshot/export').expect(200);

    expect(res.body.version).toBe(1);
    expect(Array.isArray(res.body.sessions)).toBe(true);
    expect(res.body.sessions.length).toBe(0);
  });

  it('returns a valid snapshot JSON with version and sessions', async () => {
    // Insert an event so there is something to export
    await request(app).post('/api/events').send(VALID_HOOK_EVENT).expect(200);

    const res = await request(app).get('/api/snapshot/export').expect(200);

    expect(res.body.version).toBe(1);
    expect(typeof res.body.exportedAt).toBe('string');
    expect(typeof res.body.projectDir).toBe('string');
    expect(Array.isArray(res.body.sessions)).toBe(true);
    expect(res.body.sessions.length).toBeGreaterThanOrEqual(1);

    const session = res.body.sessions[0];
    expect(session.sessionId).toBe('test-session-1');
    expect(Array.isArray(session.events)).toBe(true);
    expect(session.events.length).toBeGreaterThanOrEqual(1);
  });
});

// ═══════════════════════════════════════════════════════════════════════
// POST /api/snapshot/import
// ═══════════════════════════════════════════════════════════════════════

describe('POST /api/snapshot/import', () => {
  it('imports a valid snapshot and returns event count', async () => {
    const snapshot = makeSnapshotPayload([
      makeSnapshotEvent('import-evt-1'),
      makeSnapshotEvent('import-evt-2', { type: 'stop' }),
    ]);

    const res = await request(app)
      .post('/api/snapshot/import')
      .send(snapshot)
      .expect(200);

    expect(res.body.imported).toBe(true);
    expect(res.body.events).toBe(2);
    expect(res.body.sessions).toBe(1);
  });

  it('skips duplicate events on re-import', async () => {
    const events = [
      makeSnapshotEvent('dup-evt-1'),
      makeSnapshotEvent('dup-evt-2', { type: 'stop' }),
    ];
    const snapshot = makeSnapshotPayload(events);

    // First import
    await request(app).post('/api/snapshot/import').send(snapshot).expect(200);

    // Second import — same event IDs should be skipped
    const res = await request(app)
      .post('/api/snapshot/import')
      .send(snapshot)
      .expect(200);

    expect(res.body.imported).toBe(true);
    expect(res.body.events).toBe(0);
    expect(res.body.skipped).toBe(2);
  });
});

// ═══════════════════════════════════════════════════════════════════════
// Authentication (SYNAPSE_API_KEY)
// ═══════════════════════════════════════════════════════════════════════

describe('Authentication via SYNAPSE_API_KEY', () => {
  const TEST_API_KEY = 'test-secret-key-12345';
  let authedApp: Express;

  beforeAll(() => {
    vi.stubEnv('SYNAPSE_API_KEY', TEST_API_KEY);
    // Create a new app instance that will pick up the env var
    const authedBroadcaster = new Broadcaster();
    const authedAgentManager = new AgentManager();
    authedApp = createApp({
      broadcaster: authedBroadcaster,
      agentManager: authedAgentManager,
      disableRateLimiting: true,
    });
  });

  afterAll(() => {
    vi.unstubAllEnvs();
  });

  it('returns 401 when no Bearer token is provided', async () => {
    const res = await request(authedApp).get('/api/health').expect(401);

    expect(res.body.error).toBe('Unauthorized');
  });

  it('succeeds when a valid Bearer token is provided', async () => {
    const res = await request(authedApp)
      .get('/api/health')
      .set('Authorization', `Bearer ${TEST_API_KEY}`)
      .expect(200);

    expect(res.body.ok).toBe(true);
  });

  it('returns 401 when an invalid Bearer token is provided', async () => {
    const res = await request(authedApp)
      .get('/api/health')
      .set('Authorization', 'Bearer wrong-key')
      .expect(401);

    expect(res.body.error).toBe('Unauthorized');
  });

  it('returns 401 for POST /api/events without auth', async () => {
    const res = await request(authedApp)
      .post('/api/events')
      .send(VALID_HOOK_EVENT)
      .expect(401);

    expect(res.body.error).toBe('Unauthorized');
  });

  it('allows POST /api/events with valid auth', async () => {
    const res = await request(authedApp)
      .post('/api/events')
      .send(VALID_HOOK_EVENT)
      .set('Authorization', `Bearer ${TEST_API_KEY}`)
      .expect(200);

    expect(res.body.ok).toBe(true);
    expect(typeof res.body.eventId).toBe('string');
  });
});
