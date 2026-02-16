// Set DB path BEFORE any server imports
import path from 'path';
import os from 'os';
process.env.SYNAPSE_DB_PATH = path.join(
  os.tmpdir(),
  'synapse-test-coaching-' + Date.now() + '.db',
);

import request from 'supertest';
import type { Express } from 'express';
import { describe, it, expect, beforeAll, afterEach, afterAll } from 'vitest';
import { initDb, deleteAllEvents, insertEvent } from '../db.js';
import { createApp } from '../app.js';
import { Broadcaster } from '../services/broadcaster.js';
import { AgentManager } from '../services/agentManager.js';

// ─── Setup ──────────────────────────────────────────────────────────

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

// ─── Helpers ────────────────────────────────────────────────────────

let eventSeq = 0;

function seedSession(sessionId: string): void {
  const seq = ++eventSeq;
  insertEvent({
    event_id: `evt-seed-${seq}`,
    session_id: sessionId,
    hook_event_name: 'SessionStart',
    event_type: 'session_start',
    agent_id: null,
    agent_type: null,
    parent_agent_id: null,
    tool_name: null,
    tool_use_id: null,
    tool_input: null,
    tool_response: null,
    status: null,
    error: null,
    token_input: 1000,
    token_output: 500,
    duration_ms: null,
    model: 'claude-sonnet-4-5',
    vendor: 'anthropic',
    cwd: '/test',
    raw_payload: JSON.stringify({ permission_mode: 'default' }),
    created_at: Date.now(),
  });
  // Add a user prompt event
  insertEvent({
    event_id: `evt-prompt-${seq}`,
    session_id: sessionId,
    hook_event_name: 'UserPrompt',
    event_type: 'user_prompt',
    agent_id: null,
    agent_type: null,
    parent_agent_id: null,
    tool_name: null,
    tool_use_id: null,
    tool_input: null,
    tool_response: null,
    status: null,
    error: null,
    token_input: null,
    token_output: null,
    duration_ms: null,
    model: null,
    vendor: null,
    cwd: '/test',
    raw_payload: JSON.stringify({ prompt: 'Fix the bug in auth.ts' }),
    created_at: Date.now() + 1,
  });
}

// ═══════════════════════════════════════════════════════════════════════
// GET /api/analytics/coaching/report-card
// ═══════════════════════════════════════════════════════════════════════

describe('GET /api/analytics/coaching/report-card', () => {
  it('returns 400 without sessionId', async () => {
    const res = await request(app)
      .get('/api/analytics/coaching/report-card')
      .expect(400);

    expect(res.body.error).toBe('Invalid query parameters');
  });

  it('returns report card for a valid session', async () => {
    seedSession('rc-session-1');

    const res = await request(app)
      .get('/api/analytics/coaching/report-card?sessionId=rc-session-1')
      .expect(200);

    expect(res.body.data).toBeDefined();
    expect(res.body.data.sessionId).toBe('rc-session-1');
    expect(res.body.data.overallScore).toBeGreaterThanOrEqual(0);
    expect(res.body.data.overallScore).toBeLessThanOrEqual(100);
    expect(res.body.data.grade).toBeTruthy();
    expect(res.body.data.dimensions).toHaveLength(8);
    expect(res.body.data.summary).toBeTruthy();
  });

  it('returns report card for session with no events (neutral scores)', async () => {
    const res = await request(app)
      .get('/api/analytics/coaching/report-card?sessionId=empty-session')
      .expect(200);

    expect(res.body.data).toBeDefined();
    expect(res.body.data.sessionId).toBe('empty-session');
    expect(res.body.data.dimensions).toHaveLength(8);
  });
});

// ═══════════════════════════════════════════════════════════════════════
// GET /api/analytics/coaching/report-cards
// ═══════════════════════════════════════════════════════════════════════

describe('GET /api/analytics/coaching/report-cards', () => {
  it('returns computed report cards within range', async () => {
    seedSession('rc-range-1');

    // First compute a report card
    await request(app)
      .get('/api/analytics/coaching/report-card?sessionId=rc-range-1')
      .expect(200);

    const now = Date.now();
    const res = await request(app)
      .get(`/api/analytics/coaching/report-cards?from=${now - 60000}&to=${now + 60000}`)
      .expect(200);

    expect(res.body.data.length).toBeGreaterThanOrEqual(1);
    expect(res.body.meta.totalCount).toBeGreaterThanOrEqual(1);
  });
});

// ═══════════════════════════════════════════════════════════════════════
// GET /api/analytics/coaching/nudges
// ═══════════════════════════════════════════════════════════════════════

describe('GET /api/analytics/coaching/nudges', () => {
  it('returns 400 without sessionId', async () => {
    const res = await request(app)
      .get('/api/analytics/coaching/nudges')
      .expect(400);

    expect(res.body.error).toBe('Invalid query parameters');
  });

  it('returns empty array for session with no nudges', async () => {
    const res = await request(app)
      .get('/api/analytics/coaching/nudges?sessionId=no-nudges')
      .expect(200);

    expect(res.body.data).toEqual([]);
  });
});

// ═══════════════════════════════════════════════════════════════════════
// POST /api/analytics/coaching/nudges/dismiss
// ═══════════════════════════════════════════════════════════════════════

describe('POST /api/analytics/coaching/nudges/dismiss', () => {
  it('returns 400 with missing fields', async () => {
    const res = await request(app)
      .post('/api/analytics/coaching/nudges/dismiss')
      .send({})
      .expect(400);

    expect(res.body.error).toBe('Validation failed');
  });

  it('accepts valid dismiss request', async () => {
    const res = await request(app)
      .post('/api/analytics/coaching/nudges/dismiss')
      .send({ sessionId: 'test-session', nudgeId: 'non-existent' })
      .expect(200);

    expect(res.body.ok).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════
// Playbook CRUD
// ═══════════════════════════════════════════════════════════════════════

describe('Playbook CRUD', () => {
  it('GET /playbooks returns empty array initially', async () => {
    const res = await request(app)
      .get('/api/analytics/coaching/playbooks')
      .expect(200);

    expect(res.body.data).toEqual([]);
  });

  it('POST /playbooks creates a playbook and GET returns it', async () => {
    const createRes = await request(app)
      .post('/api/analytics/coaching/playbooks')
      .send({
        name: 'Test Playbook',
        description: 'A test playbook',
        category: 'feature',
        tags: ['typescript', 'testing'],
      })
      .expect(201);

    expect(createRes.body.data).toBeDefined();
    expect(createRes.body.data.name).toBe('Test Playbook');
    expect(createRes.body.data.category).toBe('feature');

    const id = createRes.body.data.id;

    // GET by ID
    const getRes = await request(app)
      .get(`/api/analytics/coaching/playbooks/${id}`)
      .expect(200);

    expect(getRes.body.data.id).toBe(id);
    expect(getRes.body.data.name).toBe('Test Playbook');

    // GET all
    const listRes = await request(app)
      .get('/api/analytics/coaching/playbooks')
      .expect(200);

    expect(listRes.body.data.length).toBeGreaterThanOrEqual(1);
  });

  it('DELETE /playbooks/:id removes the playbook', async () => {
    const createRes = await request(app)
      .post('/api/analytics/coaching/playbooks')
      .send({
        name: 'To Delete',
        description: 'Will be removed',
        category: 'bugfix',
      })
      .expect(201);

    const id = createRes.body.data.id;

    const deleteRes = await request(app)
      .delete(`/api/analytics/coaching/playbooks/${id}`)
      .expect(200);

    expect(deleteRes.body.ok).toBe(true);
    expect(deleteRes.body.deleted).toBe(1);

    // Should be 404 now
    await request(app)
      .get(`/api/analytics/coaching/playbooks/${id}`)
      .expect(404);
  });

  it('POST /playbooks returns 400 with invalid data', async () => {
    const res = await request(app)
      .post('/api/analytics/coaching/playbooks')
      .send({ name: '', description: 'missing name' })
      .expect(400);

    expect(res.body.error).toBe('Validation failed');
  });

  it('GET /playbooks/:id returns 400 for non-numeric ID', async () => {
    const res = await request(app)
      .get('/api/analytics/coaching/playbooks/abc')
      .expect(400);

    expect(res.body.error).toBe('Invalid playbook ID');
  });

  it('GET /playbooks/:id returns 404 for non-existent ID', async () => {
    const res = await request(app)
      .get('/api/analytics/coaching/playbooks/99999')
      .expect(404);

    expect(res.body.error).toBe('Playbook not found');
  });

  it('DELETE /playbooks/:id returns 400 for non-numeric ID', async () => {
    const res = await request(app)
      .delete('/api/analytics/coaching/playbooks/abc')
      .expect(400);

    expect(res.body.error).toBe('Invalid playbook ID');
  });
});

// ═══════════════════════════════════════════════════════════════════════
// POST /playbooks/from-session
// ═══════════════════════════════════════════════════════════════════════

describe('POST /api/analytics/coaching/playbooks/from-session', () => {
  it('returns 400 without sessionId', async () => {
    const res = await request(app)
      .post('/api/analytics/coaching/playbooks/from-session')
      .expect(400);

    expect(res.body.error).toBe('Invalid query parameters');
  });

  it('creates a playbook from session events', async () => {
    seedSession('playbook-gen-1');

    const res = await request(app)
      .post('/api/analytics/coaching/playbooks/from-session?sessionId=playbook-gen-1')
      .expect(201);

    expect(res.body.data).toBeDefined();
    expect(res.body.data.name).toContain('Playbook');
    expect(res.body.data.category).toBe('custom');
    expect(res.body.data.pattern).toBeDefined();
  });
});
