// Set DB path to a non-existent temp location BEFORE any server imports
// so sql.js creates a fresh in-memory database.
import path from 'path';
import os from 'os';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
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
    const res = await request(app)
      .get('/api/transcript/nonexistent-session-id')
      .expect(200);

    expect(res.body).toMatchObject({ sessionId: 'nonexistent-session-id', found: false });
  });

  it('rejects path traversal', async () => {
    const res = await request(app)
      .get('/api/transcript/../../etc/passwd')
      .expect(404);

    expect(res.status).toBe(404);
  });

  it('returns 200 with found:false for valid-looking but nonexistent session', async () => {
    const res = await request(app)
      .get('/api/transcript/abc123def456')
      .expect(200);

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
    const res = await request(app)
      .get('/api/transcript/nonexistent-session-id/full')
      .expect(404);

    expect(res.body.error).toBe('Transcript not found');
  });
});

// ═══════════════════════════════════════════════════════════════════════
// GET /api/transcript
// ═══════════════════════════════════════════════════════════════════════

describe('GET /api/transcript', () => {
  it('returns empty array when no sessions exist', async () => {
    const res = await request(app)
      .get('/api/transcript')
      .expect(200);

    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body).toEqual([]);
  });
});
