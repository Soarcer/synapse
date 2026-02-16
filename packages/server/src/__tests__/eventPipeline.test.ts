// Set DB path to a non-existent temp location BEFORE any server imports
// so sql.js creates a fresh in-memory database.
import path from 'path';
import os from 'os';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
process.env.SYNAPSE_DB_PATH = path.join(
  os.tmpdir(),
  'synapse-test-pipeline-' + Date.now() + '.db',
);

import request from 'supertest';
import type { Express } from 'express';
import { initDb, deleteAllEvents } from '../db.js';
import { createApp } from '../app.js';
import { Broadcaster } from '../services/broadcaster.js';
import { AgentManager } from '../services/agentManager.js';

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
// 1. POST hook event → stores in DB → can be retrieved via GET
// ═══════════════════════════════════════════════════════════════════════

describe('POST hook event → DB storage → GET retrieval', () => {
  it('stores a hook event in the DB and retrieves it via GET', async () => {
    const postRes = await request(app)
      .post('/api/events')
      .send({
        hook_event_name: 'SessionStart',
        session_id: 'test-pipe-1',
        model: 'claude-opus-4-6',
        cwd: '/test',
      })
      .expect(200);

    expect(postRes.body.ok).toBe(true);
    expect(typeof postRes.body.eventId).toBe('string');

    const getRes = await request(app)
      .get('/api/events?sessionId=test-pipe-1')
      .expect(200);

    expect(Array.isArray(getRes.body)).toBe(true);
    expect(getRes.body.length).toBe(1);
    expect(getRes.body[0].sessionId).toBe('test-pipe-1');
    expect(getRes.body[0].type).toBe('session_start');
    expect(getRes.body[0].model).toBe('claude-opus-4-6');
  });
});

// ═══════════════════════════════════════════════════════════════════════
// 2. Posting the same session_id twice creates two distinct events
// ═══════════════════════════════════════════════════════════════════════

describe('Duplicate session_id creates separate events', () => {
  it('stores two events when the same session_id is posted twice', async () => {
    const payload = {
      hook_event_name: 'SessionStart',
      session_id: 'test-pipe-dup',
      model: 'claude-opus-4-6',
      cwd: '/test',
    };

    const res1 = await request(app)
      .post('/api/events')
      .send(payload)
      .expect(200);

    const res2 = await request(app)
      .post('/api/events')
      .send(payload)
      .expect(200);

    // Each POST generates a unique server-side event ID
    expect(res1.body.eventId).not.toBe(res2.body.eventId);

    const getRes = await request(app)
      .get('/api/events?sessionId=test-pipe-dup')
      .expect(200);

    expect(Array.isArray(getRes.body)).toBe(true);
    expect(getRes.body.length).toBe(2);
  });
});

// ═══════════════════════════════════════════════════════════════════════
// 3. Pre-normalized OpenClaw events bypass hook normalization
// ═══════════════════════════════════════════════════════════════════════

describe('Pre-normalized OpenClaw events', () => {
  it('stores an OpenClaw event with eventSource preserved', async () => {
    const openclawEvent = {
      id: 'oc-1',
      type: 'agent_start',
      sessionId: 'oc-sess',
      agentId: 'oc-agent',
      timestamp: Date.now(),
      eventSource: 'openclaw',
      status: 'running',
    };

    const postRes = await request(app)
      .post('/api/events')
      .send(openclawEvent)
      .expect(200);

    expect(postRes.body.ok).toBe(true);
    expect(postRes.body.eventId).toBe('oc-1');

    const getRes = await request(app)
      .get('/api/events?sessionId=oc-sess')
      .expect(200);

    expect(Array.isArray(getRes.body)).toBe(true);
    expect(getRes.body.length).toBe(1);
    expect(getRes.body[0].eventSource).toBe('openclaw');
    expect(getRes.body[0].agentId).toBe('oc-agent');
    expect(getRes.body[0].type).toBe('agent_start');
  });
});

// ═══════════════════════════════════════════════════════════════════════
// 4. GET /api/events returns events filtered by type
// ═══════════════════════════════════════════════════════════════════════

describe('GET /api/events filtered by type', () => {
  it('returns only events matching the requested type', async () => {
    // Post a session_start event
    await request(app)
      .post('/api/events')
      .send({
        hook_event_name: 'SessionStart',
        session_id: 'test-pipe-filter',
        model: 'claude-opus-4-6',
        cwd: '/test',
      })
      .expect(200);

    // Post a tool_start event
    await request(app)
      .post('/api/events')
      .send({
        hook_event_name: 'PreToolUse',
        session_id: 'test-pipe-filter',
        tool_name: 'Read',
        tool_use_id: 'tu-1',
      })
      .expect(200);

    const getRes = await request(app)
      .get('/api/events?type=tool_start')
      .expect(200);

    expect(Array.isArray(getRes.body)).toBe(true);
    expect(getRes.body.length).toBe(1);
    expect(getRes.body[0].type).toBe('tool_start');
    expect(getRes.body[0].toolName).toBe('Read');
  });
});

// ═══════════════════════════════════════════════════════════════════════
// 5. DELETE /api/events clears all events
// ═══════════════════════════════════════════════════════════════════════

describe('DELETE /api/events clears all events', () => {
  it('removes all stored events and subsequent GET returns empty', async () => {
    // Insert an event
    await request(app)
      .post('/api/events')
      .send({
        hook_event_name: 'SessionStart',
        session_id: 'test-pipe-delete',
        model: 'claude-opus-4-6',
        cwd: '/test',
      })
      .expect(200);

    // Confirm it exists
    const beforeRes = await request(app)
      .get('/api/events?sessionId=test-pipe-delete')
      .expect(200);
    expect(beforeRes.body.length).toBe(1);

    // Delete all
    const delRes = await request(app)
      .delete('/api/events')
      .expect(200);

    expect(delRes.body.ok).toBe(true);
    expect(delRes.body.deleted).toBeGreaterThanOrEqual(1);

    // Confirm empty
    const afterRes = await request(app)
      .get('/api/events')
      .expect(200);

    expect(Array.isArray(afterRes.body)).toBe(true);
    expect(afterRes.body.length).toBe(0);
  });
});
