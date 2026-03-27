// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Bernhard

// Set DB path to a temp location BEFORE any server imports
// so sql.js creates a fresh in-memory database.
import path from 'path';
import os from 'os';

process.env.SYNAPSE_DB_PATH = path.join(
  os.tmpdir(),
  'synapse-test-eventsRoute-' + Date.now() + '.db',
);

import request from 'supertest';
import type { Express } from 'express';
import { initDb, deleteAllEvents } from '../db.js';
import { createApp } from '../app.js';
import { Broadcaster } from '../services/broadcaster.js';
import { AgentManager } from '../services/agentManager.js';
import { registry } from '../routes/events.js';

const clearDedupeCache = () => registry.clearDedupeCache();

// ─── Shared Fixtures ──────────────────────────────────────────────────

const VALID_HOOK_EVENT = {
  hook_event_name: 'SessionStart',
  session_id: 'evt-test-session-1',
  model: 'claude-opus-4-6',
  cwd: '/test/project',
};

const TOOL_USE_EVENT = {
  hook_event_name: 'PreToolUse',
  session_id: 'evt-test-session-1',
  tool_name: 'Read',
  tool_input: { file_path: '/test/file.ts' },
  cwd: '/test/project',
};

const STOP_EVENT = {
  hook_event_name: 'Stop',
  session_id: 'evt-test-session-1',
  cwd: '/test/project',
};

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
  clearDedupeCache();
});

afterAll(() => {
  broadcaster.destroy();
  agentManager.stopAll();
});

// ═══════════════════════════════════════════════════════════════════════
// POST /api/events — valid payloads
// ═══════════════════════════════════════════════════════════════════════

describe('POST /api/events — valid payloads', () => {
  it('returns 200 with eventId for SessionStart', async () => {
    const res = await request(app).post('/api/events').send(VALID_HOOK_EVENT).expect(200);

    expect(res.body.ok).toBe(true);
    expect(typeof res.body.eventId).toBe('string');
    expect(res.body.eventId.length).toBeGreaterThan(0);
  });

  it('returns 200 for PreToolUse event', async () => {
    const res = await request(app).post('/api/events').send(TOOL_USE_EVENT).expect(200);

    expect(res.body.ok).toBe(true);
    expect(typeof res.body.eventId).toBe('string');
  });

  it('returns 200 for Stop event', async () => {
    const res = await request(app).post('/api/events').send(STOP_EVENT).expect(200);

    expect(res.body.ok).toBe(true);
    expect(typeof res.body.eventId).toBe('string');
  });

  it('accepts events with extra fields (passthrough)', async () => {
    const res = await request(app)
      .post('/api/events')
      .send({
        ...VALID_HOOK_EVENT,
        session_id: 'extra-fields-session',
        custom_field: 'custom_value',
        nested: { deep: true },
      })
      .expect(200);

    expect(res.body.ok).toBe(true);
  });

  it('accepts event without hook_event_name (openclaw pre-normalized)', async () => {
    const res = await request(app)
      .post('/api/events')
      .send({
        id: 'openclaw-evt-1',
        type: 'session_start',
        sessionId: 'openclaw-session-1',
        timestamp: Date.now(),
        eventSource: 'openclaw',
        vendor: 'anthropic',
      })
      .expect(200);

    expect(res.body.ok).toBe(true);
    expect(res.body.eventId).toBe('openclaw-evt-1');
  });

  it('deduplicates identical events', async () => {
    const event = {
      ...VALID_HOOK_EVENT,
      session_id: 'dedup-session',
    };

    const first = await request(app).post('/api/events').send(event).expect(200);
    expect(first.body.ok).toBe(true);
    expect(first.body.deduplicated).toBeFalsy();

    const second = await request(app).post('/api/events').send(event).expect(200);
    expect(second.body.ok).toBe(true);
    expect(second.body.deduplicated).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════
// POST /api/events — invalid payloads
// ═══════════════════════════════════════════════════════════════════════

describe('POST /api/events — invalid payloads', () => {
  it('returns 400 for a non-object (array) body', async () => {
    const res = await request(app).post('/api/events').send([1, 2, 3]).expect(400);

    expect(res.body.error).toBe('Validation failed');
  });

  it('rejects a string body (strict JSON parsing)', async () => {
    // Express body-parser strict mode rejects non-object/array JSON primitives
    const res = await request(app)
      .post('/api/events')
      .set('Content-Type', 'application/json')
      .send('"hello"');

    expect([400, 500]).toContain(res.status);
  });

  it('rejects a numeric body (strict JSON parsing)', async () => {
    const res = await request(app)
      .post('/api/events')
      .set('Content-Type', 'application/json')
      .send('42');

    expect([400, 500]).toContain(res.status);
  });

  it('rejects null body (strict JSON parsing)', async () => {
    const res = await request(app)
      .post('/api/events')
      .set('Content-Type', 'application/json')
      .send('null');

    expect([400, 500]).toContain(res.status);
  });

  it('returns 400 for an empty object (missing required adapter fields)', async () => {
    // An empty object passes Zod's passthrough but no adapter matches it
    const res = await request(app).post('/api/events').send({}).expect(400);

    expect(res.body.error).toBe('No adapter matched payload');
  });
});

// ═══════════════════════════════════════════════════════════════════════
// GET /api/events — querying
// ═══════════════════════════════════════════════════════════════════════

describe('GET /api/events', () => {
  it('returns empty array when no events exist', async () => {
    const res = await request(app).get('/api/events').expect(200);

    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.length).toBe(0);
  });

  it('returns stored events after POST', async () => {
    await request(app).post('/api/events').send(VALID_HOOK_EVENT).expect(200);

    const res = await request(app).get('/api/events').expect(200);

    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.length).toBeGreaterThanOrEqual(1);
    expect(res.body[0].sessionId).toBe('evt-test-session-1');
  });

  it('filters by sessionId query parameter', async () => {
    await request(app)
      .post('/api/events')
      .send({ ...VALID_HOOK_EVENT, session_id: 'filter-a' })
      .expect(200);
    await request(app)
      .post('/api/events')
      .send({ ...VALID_HOOK_EVENT, session_id: 'filter-b' })
      .expect(200);

    const res = await request(app).get('/api/events?sessionId=filter-a').expect(200);

    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.length).toBe(1);
    expect(res.body[0].sessionId).toBe('filter-a');
  });

  it('filters by type query parameter', async () => {
    // SessionStart normalizes to type: 'session_start'
    await request(app).post('/api/events').send(VALID_HOOK_EVENT).expect(200);
    // Stop normalizes to type: 'stop'
    await request(app).post('/api/events').send(STOP_EVENT).expect(200);

    const res = await request(app).get('/api/events?type=session_start').expect(200);

    expect(Array.isArray(res.body)).toBe(true);
    for (const evt of res.body) {
      expect(evt.type).toBe('session_start');
    }
  });

  it('respects limit query parameter', async () => {
    await request(app)
      .post('/api/events')
      .send({ ...VALID_HOOK_EVENT, session_id: 'lim-1' })
      .expect(200);
    await request(app)
      .post('/api/events')
      .send({ ...VALID_HOOK_EVENT, session_id: 'lim-2' })
      .expect(200);
    await request(app)
      .post('/api/events')
      .send({ ...VALID_HOOK_EVENT, session_id: 'lim-3' })
      .expect(200);

    const res = await request(app).get('/api/events?limit=2').expect(200);

    expect(res.body.length).toBe(2);
  });

  it('respects offset query parameter for pagination', async () => {
    await request(app)
      .post('/api/events')
      .send({ ...VALID_HOOK_EVENT, session_id: 'off-1' })
      .expect(200);
    await request(app)
      .post('/api/events')
      .send({ ...VALID_HOOK_EVENT, session_id: 'off-2' })
      .expect(200);
    await request(app)
      .post('/api/events')
      .send({ ...VALID_HOOK_EVENT, session_id: 'off-3' })
      .expect(200);

    const allRes = await request(app).get('/api/events').expect(200);
    const offsetRes = await request(app).get('/api/events?offset=1').expect(200);

    expect(offsetRes.body.length).toBe(allRes.body.length - 1);
  });

  it('returns events filtered by cwd', async () => {
    await request(app)
      .post('/api/events')
      .send({ ...VALID_HOOK_EVENT, session_id: 'cwd-a', cwd: '/project/alpha' })
      .expect(200);
    await request(app)
      .post('/api/events')
      .send({ ...VALID_HOOK_EVENT, session_id: 'cwd-b', cwd: '/project/beta' })
      .expect(200);

    const res = await request(app).get('/api/events?cwd=/project/alpha').expect(200);

    expect(Array.isArray(res.body)).toBe(true);
    for (const evt of res.body) {
      expect(evt.cwd).toContain('alpha');
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════
// GET /api/events/sessions
// ═══════════════════════════════════════════════════════════════════════

describe('GET /api/events/sessions', () => {
  it('returns empty array when no sessions exist', async () => {
    const res = await request(app).get('/api/events/sessions').expect(200);

    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.length).toBe(0);
  });

  it('returns session summaries after events are posted', async () => {
    await request(app)
      .post('/api/events')
      .send({ ...VALID_HOOK_EVENT, session_id: 'sess-summary-1' })
      .expect(200);
    await request(app)
      .post('/api/events')
      .send({ ...STOP_EVENT, session_id: 'sess-summary-1' })
      .expect(200);

    const res = await request(app).get('/api/events/sessions').expect(200);

    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.length).toBeGreaterThanOrEqual(1);

    const session = res.body.find(
      (s: Record<string, unknown>) => s.session_id === 'sess-summary-1',
    );
    expect(session).toBeDefined();
    expect(session.event_count).toBeGreaterThanOrEqual(2);
  });

  it('filters sessions by cwd query parameter', async () => {
    await request(app)
      .post('/api/events')
      .send({ ...VALID_HOOK_EVENT, session_id: 'sess-cwd-1', cwd: '/project/one' })
      .expect(200);
    await request(app)
      .post('/api/events')
      .send({ ...VALID_HOOK_EVENT, session_id: 'sess-cwd-2', cwd: '/project/two' })
      .expect(200);

    const res = await request(app).get('/api/events/sessions?cwd=/project/one').expect(200);

    expect(Array.isArray(res.body)).toBe(true);
    // Should only have sessions with matching cwd
    for (const session of res.body) {
      expect(session.session_id).not.toBe('sess-cwd-2');
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════
// GET /api/events/projects
// ═══════════════════════════════════════════════════════════════════════

describe('GET /api/events/projects', () => {
  it('returns projects object with array', async () => {
    const res = await request(app).get('/api/events/projects').expect(200);

    expect(res.body).toHaveProperty('projects');
    expect(Array.isArray(res.body.projects)).toBe(true);
  });

  it('lists project cwds after events are posted', async () => {
    await request(app)
      .post('/api/events')
      .send({ ...VALID_HOOK_EVENT, session_id: 'proj-1', cwd: '/project/alpha' })
      .expect(200);
    await request(app)
      .post('/api/events')
      .send({ ...VALID_HOOK_EVENT, session_id: 'proj-2', cwd: '/project/beta' })
      .expect(200);

    const res = await request(app).get('/api/events/projects').expect(200);

    expect(res.body.projects.length).toBeGreaterThanOrEqual(2);
  });
});

// ═══════════════════════════════════════════════════════════════════════
// DELETE /api/events
// ═══════════════════════════════════════════════════════════════════════

describe('DELETE /api/events', () => {
  it('deletes all events and returns deleted count', async () => {
    await request(app)
      .post('/api/events')
      .send({ ...VALID_HOOK_EVENT, session_id: 'del-all-1' })
      .expect(200);
    await request(app)
      .post('/api/events')
      .send({ ...VALID_HOOK_EVENT, session_id: 'del-all-2' })
      .expect(200);

    const delRes = await request(app).delete('/api/events').expect(200);

    expect(delRes.body.ok).toBe(true);
    expect(delRes.body.deleted).toBeGreaterThanOrEqual(2);

    // Verify empty
    const getRes = await request(app).get('/api/events').expect(200);
    expect(getRes.body.length).toBe(0);
  });

  it('returns deleted:0 when no events exist', async () => {
    const res = await request(app).delete('/api/events').expect(200);

    expect(res.body.ok).toBe(true);
    expect(res.body.deleted).toBe(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════
// DELETE /api/events/session/:sessionId
// ═══════════════════════════════════════════════════════════════════════

describe('DELETE /api/events/session/:sessionId', () => {
  it('deletes events for a specific session', async () => {
    await request(app)
      .post('/api/events')
      .send({ ...VALID_HOOK_EVENT, session_id: 'del-spec-1' })
      .expect(200);
    await request(app)
      .post('/api/events')
      .send({ ...VALID_HOOK_EVENT, session_id: 'del-spec-2' })
      .expect(200);

    const delRes = await request(app).delete('/api/events/session/del-spec-1').expect(200);

    expect(delRes.body.ok).toBe(true);
    expect(delRes.body.deleted).toBe(1);

    // Other session remains
    const getRes = await request(app).get('/api/events?sessionId=del-spec-2').expect(200);
    expect(getRes.body.length).toBe(1);
  });

  it('returns deleted:0 for a nonexistent session', async () => {
    const res = await request(app).delete('/api/events/session/nonexistent-session').expect(200);

    expect(res.body.ok).toBe(true);
    expect(res.body.deleted).toBe(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════
// Content-Type handling
// ═══════════════════════════════════════════════════════════════════════

describe('Content-Type handling', () => {
  it('accepts application/json content type', async () => {
    const res = await request(app)
      .post('/api/events')
      .set('Content-Type', 'application/json')
      .send(JSON.stringify(VALID_HOOK_EVENT))
      .expect(200);

    expect(res.body.ok).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════
// Multiple event lifecycle
// ═══════════════════════════════════════════════════════════════════════

describe('Event lifecycle (session start → tool use → stop)', () => {
  it('stores and retrieves a full session lifecycle', async () => {
    const sessionId = 'lifecycle-session';

    // 1. Session start
    await request(app)
      .post('/api/events')
      .send({ ...VALID_HOOK_EVENT, session_id: sessionId })
      .expect(200);

    // 2. Tool use
    await request(app)
      .post('/api/events')
      .send({ ...TOOL_USE_EVENT, session_id: sessionId })
      .expect(200);

    // 3. Stop
    await request(app)
      .post('/api/events')
      .send({ ...STOP_EVENT, session_id: sessionId })
      .expect(200);

    // Query all events for this session
    const res = await request(app).get(`/api/events?sessionId=${sessionId}`).expect(200);

    expect(res.body.length).toBe(3);

    const types = res.body.map((e: Record<string, unknown>) => e.type);
    expect(types).toContain('session_start');
    expect(types).toContain('stop');
  });
});
