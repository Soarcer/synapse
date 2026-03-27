// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Bernhard

// Set DB path to a non-existent temp location BEFORE any server imports
import path from 'path';
import os from 'os';

process.env.SYNAPSE_DB_PATH = path.join(os.tmpdir(), 'synapse-test-snapshot-' + Date.now() + '.db');

import request from 'supertest';
import type { Express } from 'express';
import { initDb, deleteAllEvents } from '../db.js';
import { createApp } from '../app.js';
import { Broadcaster } from '../services/broadcaster.js';
import { AgentManager } from '../services/agentManager.js';
import { registry } from '../routes/events.js';
const clearDedupeCache = () => registry.clearDedupeCache();

// ─── Helpers ─────────────────────────────────────────────────────────

const VALID_HOOK_EVENT = {
  hook_event_name: 'SessionStart',
  session_id: 'snap-test-session',
  model: 'claude-opus-4-6',
  cwd: '/test/project',
};

function makeSnapshotPayload(events: Record<string, unknown>[] = [], sessionId = 'snap-session-1') {
  return {
    version: 1,
    exportedAt: new Date().toISOString(),
    projectDir: '/test/project',
    sessions: [
      {
        sessionId,
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

// ─── Setup ───────────────────────────────────────────────────────────

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
// GET /api/snapshot/export
// ═══════════════════════════════════════════════════════════════════════

describe('GET /api/snapshot/export', () => {
  it(
    'returns correct Content-Type and Content-Disposition headers',
    { timeout: 15_000 },
    async () => {
      const res = await request(app).get('/api/snapshot/export').expect(200);

      expect(res.headers['content-type']).toMatch(/application\/json/);
      expect(res.headers['content-disposition']).toMatch(
        /^attachment; filename="synapse-snapshot-/,
      );
    },
  );

  it('returns empty sessions array when DB has no events', async () => {
    const res = await request(app).get('/api/snapshot/export').expect(200);

    expect(res.body.version).toBe(1);
    expect(res.body.sessions).toEqual([]);
    expect(typeof res.body.exportedAt).toBe('string');
    expect(typeof res.body.projectDir).toBe('string');
  });

  it('includes events in the exported session', { timeout: 15_000 }, async () => {
    await request(app).post('/api/events').send(VALID_HOOK_EVENT).expect(200);

    const res = await request(app).get('/api/snapshot/export').expect(200);

    expect(res.body.sessions.length).toBe(1);
    const session = res.body.sessions[0];
    expect(session.sessionId).toBe('snap-test-session');
    expect(session.events.length).toBeGreaterThanOrEqual(1);
    expect(session.events[0].type).toBe('session_start');
  });

  it('filters by sessionId query parameter', { timeout: 15_000 }, async () => {
    // Insert events for two different sessions
    await request(app)
      .post('/api/events')
      .send({ ...VALID_HOOK_EVENT, session_id: 'sess-alpha' })
      .expect(200);
    await request(app)
      .post('/api/events')
      .send({ ...VALID_HOOK_EVENT, session_id: 'sess-beta' })
      .expect(200);

    const res = await request(app).get('/api/snapshot/export?sessionId=sess-alpha').expect(200);

    expect(res.body.sessions.length).toBe(1);
    expect(res.body.sessions[0].sessionId).toBe('sess-alpha');
  });

  it('returns all sessions when sessionId filter does not match', { timeout: 15_000 }, async () => {
    await request(app)
      .post('/api/events')
      .send({ ...VALID_HOOK_EVENT, session_id: 'sess-gamma' })
      .expect(200);

    // Invalid session ID pattern (contains special chars) is ignored → returns all
    const res = await request(app)
      .get('/api/snapshot/export?sessionId=<script>alert(1)</script>')
      .expect(200);

    // The invalid sessionId should be rejected by the pattern check, returning all sessions
    expect(res.body.sessions.length).toBeGreaterThanOrEqual(1);
  });

  it('exports multiple sessions when no filter is provided', { timeout: 30_000 }, async () => {
    await request(app)
      .post('/api/events')
      .send({ ...VALID_HOOK_EVENT, session_id: 'multi-1' })
      .expect(200);
    await request(app)
      .post('/api/events')
      .send({ ...VALID_HOOK_EVENT, session_id: 'multi-2' })
      .expect(200);
    await request(app)
      .post('/api/events')
      .send({ ...VALID_HOOK_EVENT, session_id: 'multi-3' })
      .expect(200);

    const res = await request(app).get('/api/snapshot/export').expect(200);

    expect(res.body.sessions.length).toBe(3);
    const ids = res.body.sessions.map((s: { sessionId: string }) => s.sessionId);
    expect(ids).toContain('multi-1');
    expect(ids).toContain('multi-2');
    expect(ids).toContain('multi-3');
  });

  it('includes transcript field (null when not available)', { timeout: 15_000 }, async () => {
    await request(app).post('/api/events').send(VALID_HOOK_EVENT).expect(200);

    const res = await request(app).get('/api/snapshot/export').expect(200);

    // Transcript will be null in test environment (no transcript files)
    expect(res.body.sessions[0]).toHaveProperty('transcript');
  });
});

// ═══════════════════════════════════════════════════════════════════════
// POST /api/snapshot/import
// ═══════════════════════════════════════════════════════════════════════

describe('POST /api/snapshot/import', () => {
  it('imports a valid snapshot with events', async () => {
    const snapshot = makeSnapshotPayload([
      makeSnapshotEvent('import-1'),
      makeSnapshotEvent('import-2', { type: 'stop' }),
    ]);

    const res = await request(app).post('/api/snapshot/import').send(snapshot).expect(200);

    expect(res.body.imported).toBe(true);
    expect(res.body.sessions).toBe(1);
    expect(res.body.events).toBe(2);
    expect(res.body.skipped).toBe(0);
  });

  it('returns imported events in allEvents field', async () => {
    const snapshot = makeSnapshotPayload([makeSnapshotEvent('allev-1')]);

    const res = await request(app).post('/api/snapshot/import').send(snapshot).expect(200);

    expect(Array.isArray(res.body.allEvents)).toBe(true);
    expect(res.body.allEvents.length).toBeGreaterThanOrEqual(1);
  });

  it('skips duplicate events on re-import', async () => {
    const events = [makeSnapshotEvent('dup-1'), makeSnapshotEvent('dup-2', { type: 'stop' })];
    const snapshot = makeSnapshotPayload(events);

    await request(app).post('/api/snapshot/import').send(snapshot).expect(200);
    const res = await request(app).post('/api/snapshot/import').send(snapshot).expect(200);

    expect(res.body.imported).toBe(true);
    expect(res.body.events).toBe(0);
    expect(res.body.skipped).toBe(2);
  });

  it('handles a snapshot with empty sessions array', async () => {
    const snapshot = {
      version: 1,
      exportedAt: new Date().toISOString(),
      projectDir: '/test',
      sessions: [],
    };

    const res = await request(app).post('/api/snapshot/import').send(snapshot).expect(200);

    expect(res.body.imported).toBe(true);
    expect(res.body.sessions).toBe(0);
    expect(res.body.events).toBe(0);
  });

  it('handles a session with empty events array', async () => {
    const snapshot = makeSnapshotPayload([]);

    const res = await request(app).post('/api/snapshot/import').send(snapshot).expect(200);

    expect(res.body.imported).toBe(true);
    expect(res.body.sessions).toBe(0); // skipped because no events
    expect(res.body.events).toBe(0);
  });

  it('skips events that fail AgentEventSchema validation', async () => {
    const snapshot = makeSnapshotPayload([
      { id: 'bad-1', type: 'unknown_type' }, // missing required fields
      makeSnapshotEvent('good-1'),
    ]);

    const res = await request(app).post('/api/snapshot/import').send(snapshot).expect(200);

    expect(res.body.imported).toBe(true);
    // The bad event should be skipped, the good one imported
    expect(res.body.skipped).toBeGreaterThanOrEqual(1);
  });

  it('skips oversized events (>100KB)', async () => {
    const largePayload = 'x'.repeat(101_000);
    const snapshot = makeSnapshotPayload([
      makeSnapshotEvent('big-1', { toolResponse: largePayload }),
      makeSnapshotEvent('small-1'),
    ]);

    const res = await request(app).post('/api/snapshot/import').send(snapshot).expect(200);

    expect(res.body.imported).toBe(true);
    // The oversized event should be skipped
    expect(res.body.skipped).toBeGreaterThanOrEqual(1);
  });

  it('imports multiple sessions in one snapshot', async () => {
    const snapshot = {
      version: 1,
      exportedAt: new Date().toISOString(),
      projectDir: '/test',
      sessions: [
        {
          sessionId: 'multi-sess-a',
          events: [makeSnapshotEvent('ms-a-1', { sessionId: 'multi-sess-a' })],
          transcript: null,
        },
        {
          sessionId: 'multi-sess-b',
          events: [makeSnapshotEvent('ms-b-1', { sessionId: 'multi-sess-b' })],
          transcript: null,
        },
      ],
    };

    const res = await request(app).post('/api/snapshot/import').send(snapshot).expect(200);

    expect(res.body.imported).toBe(true);
    expect(res.body.sessions).toBe(2);
    expect(res.body.events).toBe(2);
  });

  it('returns transcripts from the imported snapshot', async () => {
    const snapshot = {
      version: 1,
      exportedAt: new Date().toISOString(),
      projectDir: '/test',
      sessions: [
        {
          sessionId: 'transcript-sess',
          events: [makeSnapshotEvent('tr-1', { sessionId: 'transcript-sess' })],
          transcript: { turns: 5, summary: 'test transcript' },
        },
      ],
    };

    const res = await request(app).post('/api/snapshot/import').send(snapshot).expect(200);

    expect(Array.isArray(res.body.transcripts)).toBe(true);
    expect(res.body.transcripts.length).toBe(1);
    expect(res.body.transcripts[0].sessionId).toBe('transcript-sess');
    expect(res.body.transcripts[0].transcript).toEqual({ turns: 5, summary: 'test transcript' });
  });

  // ─── Validation / Error Handling ─────────────────────────────────

  it('returns 400 for a body missing "version"', async () => {
    const bad = {
      exportedAt: new Date().toISOString(),
      projectDir: '/test',
      sessions: [],
    };

    const res = await request(app).post('/api/snapshot/import').send(bad).expect(400);

    expect(res.body.error).toBe('Validation failed');
  });

  it('returns 400 for wrong version number', async () => {
    const bad = {
      version: 2,
      exportedAt: new Date().toISOString(),
      projectDir: '/test',
      sessions: [],
    };

    const res = await request(app).post('/api/snapshot/import').send(bad).expect(400);

    expect(res.body.error).toBe('Validation failed');
  });

  it('returns 400 for missing sessions array', async () => {
    const bad = {
      version: 1,
      exportedAt: new Date().toISOString(),
      projectDir: '/test',
    };

    const res = await request(app).post('/api/snapshot/import').send(bad).expect(400);

    expect(res.body.error).toBe('Validation failed');
  });

  it('returns 400 for missing exportedAt', async () => {
    const bad = {
      version: 1,
      projectDir: '/test',
      sessions: [],
    };

    const res = await request(app).post('/api/snapshot/import').send(bad).expect(400);

    expect(res.body.error).toBe('Validation failed');
  });

  it('returns 400 for missing projectDir', async () => {
    const bad = {
      version: 1,
      exportedAt: new Date().toISOString(),
      sessions: [],
    };

    const res = await request(app).post('/api/snapshot/import').send(bad).expect(400);

    expect(res.body.error).toBe('Validation failed');
  });

  it('returns an error for a non-object body (invalid JSON string)', async () => {
    // Express body-parser returns 500 for unparseable JSON before route handler runs
    const res = await request(app)
      .post('/api/snapshot/import')
      .send('not-json')
      .set('Content-Type', 'application/json');

    // Either 400 (body-parser strict mode) or 500 (error handler) is acceptable
    expect([400, 500]).toContain(res.status);
  });

  it('returns 400 for sessions with missing sessionId', async () => {
    const bad = {
      version: 1,
      exportedAt: new Date().toISOString(),
      projectDir: '/test',
      sessions: [{ events: [], transcript: null }],
    };

    const res = await request(app).post('/api/snapshot/import').send(bad).expect(400);

    expect(res.body.error).toBe('Validation failed');
  });
});

// ═══════════════════════════════════════════════════════════════════════
// Export → Import round-trip
// ═══════════════════════════════════════════════════════════════════════

describe('Snapshot round-trip', () => {
  it('exports and re-imports events correctly', { timeout: 15_000 }, async () => {
    // Insert events via the normal API
    await request(app)
      .post('/api/events')
      .send({ ...VALID_HOOK_EVENT, session_id: 'roundtrip-sess' })
      .expect(200);

    // Export
    const exportRes = await request(app).get('/api/snapshot/export').expect(200);
    expect(exportRes.body.sessions.length).toBe(1);

    // Clear DB
    deleteAllEvents();
    clearDedupeCache();

    // Verify empty
    const emptyRes = await request(app).get('/api/events').expect(200);
    expect(emptyRes.body.length).toBe(0);

    // Re-import the exported snapshot
    const importRes = await request(app)
      .post('/api/snapshot/import')
      .send(exportRes.body)
      .expect(200);

    expect(importRes.body.imported).toBe(true);
    expect(importRes.body.events).toBeGreaterThanOrEqual(1);

    // Verify events are back
    const verifyRes = await request(app).get('/api/events').expect(200);
    expect(verifyRes.body.length).toBeGreaterThanOrEqual(1);
    expect(verifyRes.body[0].sessionId).toBe('roundtrip-sess');
  });
});
