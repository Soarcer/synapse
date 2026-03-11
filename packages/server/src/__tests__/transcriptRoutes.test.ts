// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Bernhard

// Set DB path to a non-existent temp location BEFORE any server imports
// so sql.js creates a fresh in-memory database.
import path from 'path';
import os from 'os';

process.env.SYNAPSE_DB_PATH = path.join(
  os.tmpdir(),
  'synapse-test-transcript-' + Date.now() + '.db',
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

beforeEach(() => {
  deleteAllEvents();
});

afterAll(() => {
  broadcaster.destroy();
  agentManager.stopAll();
});

// ═══════════════════════════════════════════════════════════════════════
// GET /api/transcript/:sessionId
// ═══════════════════════════════════════════════════════════════════════

describe('GET /api/transcript/:sessionId', () => {
  it('returns 200 with found:false for unknown session', async () => {
    const res = await request(app).get('/api/transcript/nonexistent-session-id').expect(200);

    expect(res.body).toMatchObject({ sessionId: 'nonexistent-session-id', found: false });
  });

  it('rejects path traversal', async () => {
    const res = await request(app).get('/api/transcript/../../etc/passwd').expect(404);

    expect(res.status).toBe(404);
  });

  it('returns 200 with found:false for valid-looking but nonexistent session', async () => {
    const res = await request(app).get('/api/transcript/abc123def456').expect(200);

    expect(res.body).toMatchObject({ sessionId: 'abc123def456', found: false });
  });
});

// ═══════════════════════════════════════════════════════════════════════
// GET /api/transcript/:sessionId/reasoning
// ═══════════════════════════════════════════════════════════════════════

describe('GET /api/transcript/:sessionId/reasoning', () => {
  it('returns 404 for unknown session', async () => {
    const res = await request(app)
      .get('/api/transcript/nonexistent-session-id/reasoning')
      .expect(404);

    expect(res.body.error).toBe('Transcript not found');
  });
});

// ═══════════════════════════════════════════════════════════════════════
// GET /api/transcript/:sessionId/full
// ═══════════════════════════════════════════════════════════════════════

describe('GET /api/transcript/:sessionId/full', () => {
  it('returns 404 for unknown session', async () => {
    const res = await request(app).get('/api/transcript/nonexistent-session-id/full').expect(404);

    expect(res.body.error).toBe('Transcript not found');
  });
});

// ═══════════════════════════════════════════════════════════════════════
// GET /api/transcript
// ═══════════════════════════════════════════════════════════════════════

describe('GET /api/transcript', () => {
  it('returns empty array when no sessions exist', async () => {
    const res = await request(app).get('/api/transcript').expect(200);

    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body).toEqual([]);
  });
});

// ═══════════════════════════════════════════════════════════════════════
// POST /api/transcript/batch
// ═══════════════════════════════════════════════════════════════════════

describe('POST /api/transcript/batch', () => {
  it('returns transcript summaries for multiple session IDs', async () => {
    const res = await request(app)
      .post('/api/transcript/batch')
      .send({ sessionIds: ['sess-1', 'sess-2'] });

    expect(res.status).toBe(200);
    // Both should be null since no transcripts exist in test env
    expect(res.body).toHaveProperty('sess-1');
    expect(res.body).toHaveProperty('sess-2');
  });

  it('rejects more than 20 session IDs', async () => {
    const ids = Array.from({ length: 21 }, (_, i) => `sess-${i}`);
    const res = await request(app).post('/api/transcript/batch').send({ sessionIds: ids });

    expect(res.status).toBe(400);
  });

  it('rejects empty sessionIds array', async () => {
    const res = await request(app).post('/api/transcript/batch').send({ sessionIds: [] });

    expect(res.status).toBe(400);
  });

  it('rejects missing sessionIds', async () => {
    const res = await request(app).post('/api/transcript/batch').send({});

    expect(res.status).toBe(400);
  });

  it('returns null for sessions without transcripts', async () => {
    const res = await request(app)
      .post('/api/transcript/batch')
      .send({ sessionIds: ['nonexistent'] });

    expect(res.status).toBe(200);
    expect(res.body.nonexistent).toBeNull();
  });
});
