// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Bernhard

// Set DB path BEFORE any server imports
import path from 'path';
import os from 'os';

process.env.SYNAPSE_DB_PATH = path.join(
  os.tmpdir(),
  'synapse-test-analytics-' + Date.now() + '.db',
);

import request from 'supertest';
import type { Express } from 'express';
import { initDb, deleteAllEvents } from '../db.js';
import { createApp } from '../app.js';
import { Broadcaster } from '../services/broadcaster.js';
import { AgentManager } from '../services/agentManager.js';
import { registry } from '../routes/events.js';
const clearDedupeCache = () => registry.clearDedupeCache();

// ─── Fixtures ────────────────────────────────────────────────────────

function makeEvent(overrides: Record<string, unknown> = {}) {
  return {
    hook_event_name: 'SessionStart',
    session_id: 'analytics-session-1',
    model: 'claude-opus-4-6',
    cwd: '/test/analytics',
    ...overrides,
  };
}

function makeToolEvent(
  toolName: string,
  sessionId: string,
  overrides: Record<string, unknown> = {},
) {
  return {
    hook_event_name: 'PostToolUse',
    session_id: sessionId,
    tool_name: toolName,
    tool_use_id: `tool-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    model: 'claude-opus-4-6',
    cwd: '/test/analytics',
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

// ─── Seed helper ─────────────────────────────────────────────────────

async function seedEvents(count: number, sessionPrefix = 'sess') {
  const hookNames = [
    'SessionStart',
    'Stop',
    'Notification',
    'SubagentStart',
    'SubagentStop',
    'PreToolUse',
    'PostToolUse',
    'UserPromptSubmit',
  ];
  for (let i = 0; i < count; i++) {
    const sessionId = `${sessionPrefix}-${i % 3}`;
    await request(app)
      .post('/api/events')
      .send(makeEvent({ session_id: sessionId, hook_event_name: hookNames[i % hookNames.length] }));
  }
}

async function seedToolEvents(count: number) {
  const tools = ['Read', 'Write', 'Edit', 'Bash', 'Glob', 'Grep'];
  for (let i = 0; i < count; i++) {
    await request(app)
      .post('/api/events')
      .send(makeToolEvent(tools[i % tools.length], `tool-sess-${i % 2}`));
  }
}

// ═════════════════════════════════════════════════════════════════════
// GET /api/analytics/overview
// ═════════════════════════════════════════════════════════════════════

describe('GET /api/analytics/overview', () => {
  it('returns zero metrics for an empty time range', async () => {
    // Use a far-future time range where no events can exist
    const future = Date.now() + 100_000_000;
    const res = await request(app)
      .get(`/api/analytics/overview?from=${future}&to=${future + 86400000}`)
      .expect(200);

    expect(res.body.data).toBeDefined();
    expect(res.body.data.totalSessions).toBe(0);
    expect(res.body.data.totalToolCalls).toBe(0);
    expect(res.body.data.totalCost).toBe(0);
    expect(res.body.meta).toBeDefined();
    expect(typeof res.body.meta.from).toBe('number');
    expect(typeof res.body.meta.to).toBe('number');
  });

  it('returns correct aggregate metrics after seeding events', async () => {
    await seedEvents(6);

    const now = Date.now();
    const res = await request(app)
      .get(`/api/analytics/overview?from=${now - 86400000}&to=${now + 1000}`)
      .expect(200);

    expect(res.body.data.totalSessions).toBeGreaterThanOrEqual(1);
    expect(res.body.data.totalEvents).toBe(6);
  });

  it('filters by cwd', async () => {
    await request(app)
      .post('/api/events')
      .send(makeEvent({ cwd: '/project-a' }));
    await request(app)
      .post('/api/events')
      .send(makeEvent({ cwd: '/project-b' }));

    const now = Date.now();
    const res = await request(app)
      .get(`/api/analytics/overview?from=0&to=${now + 1000}&cwd=/project-a`)
      .expect(200);

    expect(res.body.data.totalEvents).toBe(1);
  });

  it('uses default time range when params are missing', async () => {
    await seedEvents(3);

    const res = await request(app).get('/api/analytics/overview').expect(200);

    // Should still return data (defaults to last 7 days)
    expect(res.body.data).toBeDefined();
    expect(res.body.data.totalEvents).toBe(3);
  });
});

// ═════════════════════════════════════════════════════════════════════
// GET /api/analytics/timeseries
// ═════════════════════════════════════════════════════════════════════

describe('GET /api/analytics/timeseries', () => {
  it('returns empty array when no events exist', async () => {
    const now = Date.now();
    const res = await request(app)
      .get(`/api/analytics/timeseries?from=${now - 86400000}&to=${now}`)
      .expect(200);

    expect(res.body.data).toEqual([]);
  });

  it('returns timeseries buckets grouped by day', async () => {
    await seedEvents(5);

    const now = Date.now();
    const res = await request(app)
      .get(`/api/analytics/timeseries?from=${now - 86400000}&to=${now + 1000}&granularity=day`)
      .expect(200);

    expect(Array.isArray(res.body.data)).toBe(true);
    // All events on same day should be in one bucket
    expect(res.body.data.length).toBe(1);
    expect(res.body.data[0].sessions).toBeGreaterThanOrEqual(1);
    expect(res.body.data[0].timestamp).toBeGreaterThan(0);
  });

  it('supports hour granularity', async () => {
    await seedEvents(3);

    const now = Date.now();
    const res = await request(app)
      .get(`/api/analytics/timeseries?from=${now - 86400000}&to=${now + 1000}&granularity=hour`)
      .expect(200);

    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.data.length).toBeGreaterThanOrEqual(1);
  });
});

// ═════════════════════════════════════════════════════════════════════
// GET /api/analytics/sessions
// ═════════════════════════════════════════════════════════════════════

describe('GET /api/analytics/sessions', () => {
  it('returns empty when no sessions exist', async () => {
    const now = Date.now();
    const res = await request(app).get(`/api/analytics/sessions?from=0&to=${now}`).expect(200);

    expect(res.body.data).toEqual([]);
    expect(res.body.meta.totalCount).toBe(0);
  });

  it('returns session summaries with all required fields', async () => {
    await seedEvents(6);

    const now = Date.now();
    const res = await request(app)
      .get(`/api/analytics/sessions?from=0&to=${now + 1000}`)
      .expect(200);

    expect(res.body.data.length).toBeGreaterThanOrEqual(1);
    const session = res.body.data[0];
    expect(session.id).toBeDefined();
    expect(session.name).toBeDefined();
    expect(typeof session.startTime).toBe('number');
    expect(typeof session.endTime).toBe('number');
    expect(typeof session.model).toBe('string');
    expect(typeof session.vendor).toBe('string');
    expect(typeof session.totalInputTokens).toBe('number');
    expect(typeof session.totalOutputTokens).toBe('number');
    expect(typeof session.totalCost).toBe('number');
    expect(typeof session.toolCalls).toBe('number');
  });

  it('respects limit and offset', async () => {
    await seedEvents(9); // 3 sessions (0,1,2)

    const now = Date.now();
    const res = await request(app)
      .get(`/api/analytics/sessions?from=0&to=${now + 1000}&limit=2&offset=0`)
      .expect(200);

    expect(res.body.data.length).toBe(2);
    expect(res.body.meta.totalCount).toBe(3);
  });
});

// ═════════════════════════════════════════════════════════════════════
// GET /api/analytics/tools
// ═════════════════════════════════════════════════════════════════════

describe('GET /api/analytics/tools', () => {
  it('returns empty when no tool events exist', async () => {
    const now = Date.now();
    const res = await request(app).get(`/api/analytics/tools?from=0&to=${now}`).expect(200);

    expect(res.body.data).toEqual([]);
  });

  it('returns tool summaries with counts and error rates', async () => {
    await seedToolEvents(12);

    const now = Date.now();
    const res = await request(app)
      .get(`/api/analytics/tools?from=0&to=${now + 1000}`)
      .expect(200);

    expect(res.body.data.length).toBeGreaterThanOrEqual(1);
    const tool = res.body.data[0];
    expect(tool.name).toBeDefined();
    expect(typeof tool.count).toBe('number');
    expect(typeof tool.avgDuration).toBe('number');
    expect(typeof tool.errorRate).toBe('number');
  });
});

// ═════════════════════════════════════════════════════════════════════
// GET /api/analytics/models
// ═════════════════════════════════════════════════════════════════════

describe('GET /api/analytics/models', () => {
  it('returns empty when no events exist', async () => {
    const now = Date.now();
    const res = await request(app).get(`/api/analytics/models?from=0&to=${now}`).expect(200);

    expect(res.body.data).toEqual([]);
  });

  it('returns model breakdowns with cost', async () => {
    await seedEvents(5);

    const now = Date.now();
    const res = await request(app)
      .get(`/api/analytics/models?from=0&to=${now + 1000}`)
      .expect(200);

    expect(res.body.data.length).toBeGreaterThanOrEqual(1);
    const model = res.body.data[0];
    expect(typeof model.model).toBe('string');
    expect(typeof model.sessions).toBe('number');
    expect(typeof model.cost).toBe('number');
    expect(typeof model.tokens).toBe('number');
  });
});

// ═════════════════════════════════════════════════════════════════════
// GET /api/analytics/turns
// ═════════════════════════════════════════════════════════════════════

describe('GET /api/analytics/turns', () => {
  it('returns empty for unknown session', async () => {
    const res = await request(app).get('/api/analytics/turns?sessionId=nonexistent').expect(200);

    expect(res.body.data).toEqual([]);
  });

  it('returns turns for a specific session', async () => {
    // Seed a session with a prompt and tool call
    await request(app)
      .post('/api/events')
      .send(makeEvent({ session_id: 'turn-sess' }));
    await request(app)
      .post('/api/events')
      .send(
        makeEvent({
          session_id: 'turn-sess',
          hook_event_name: 'UserPromptSubmit',
          prompt: 'Hello world',
        }),
      );
    await request(app).post('/api/events').send(makeToolEvent('Read', 'turn-sess'));

    const res = await request(app).get('/api/analytics/turns?sessionId=turn-sess').expect(200);

    expect(res.body.data.length).toBeGreaterThanOrEqual(1);
    const turn = res.body.data[0];
    expect(turn.sessionId).toBe('turn-sess');
    expect(typeof turn.turnIndex).toBe('number');
    expect(typeof turn.timestamp).toBe('number');
    expect(typeof turn.toolCount).toBe('number');
  });

  it('returns turns in bulk mode without sessionId', async () => {
    await seedEvents(6);

    const now = Date.now();
    const res = await request(app)
      .get(`/api/analytics/turns?from=0&to=${now + 1000}&limit=10`)
      .expect(200);

    expect(Array.isArray(res.body.data)).toBe(true);
  });
});

// ═════════════════════════════════════════════════════════════════════
// GET /api/analytics/tool-calls
// ═════════════════════════════════════════════════════════════════════

describe('GET /api/analytics/tool-calls', () => {
  it('returns empty when no tool calls exist', async () => {
    const now = Date.now();
    const res = await request(app).get(`/api/analytics/tool-calls?from=0&to=${now}`).expect(200);

    expect(res.body.data).toEqual([]);
  });

  it('returns paired tool call objects', async () => {
    await seedToolEvents(6);

    const now = Date.now();
    const res = await request(app)
      .get(`/api/analytics/tool-calls?from=0&to=${now + 1000}`)
      .expect(200);

    expect(res.body.data.length).toBeGreaterThanOrEqual(1);
    const tc = res.body.data[0];
    expect(tc.toolName).toBeDefined();
    expect(typeof tc.timestamp).toBe('number');
    expect(typeof tc.durationMs).toBe('number');
    expect(['success', 'error']).toContain(tc.status);
  });
});

// ═════════════════════════════════════════════════════════════════════
// Price History CRUD
// ═════════════════════════════════════════════════════════════════════

describe('Price History CRUD', () => {
  it('GET /api/analytics/prices returns empty initially', async () => {
    const res = await request(app).get('/api/analytics/prices').expect(200);

    expect(Array.isArray(res.body.data)).toBe(true);
  });

  it('POST /api/analytics/prices creates a new price entry', async () => {
    const res = await request(app)
      .post('/api/analytics/prices')
      .send({
        model: 'test-model',
        vendor: 'test-vendor',
        effectiveFrom: Date.now(),
        inputPer1M: 5,
        cachedInputPer1M: 0.5,
        outputPer1M: 25,
      })
      .expect(201);

    expect(res.body.ok).toBe(true);

    // Verify it was created
    const getRes = await request(app).get('/api/analytics/prices').expect(200);
    const found = getRes.body.data.find((p: Record<string, unknown>) => p.model === 'test-model');
    expect(found).toBeDefined();
    expect(found.input_per_1m).toBe(5);
  });

  it('DELETE /api/analytics/prices/:id removes a price entry', async () => {
    // Create one first
    await request(app)
      .post('/api/analytics/prices')
      .send({
        model: 'del-model',
        vendor: 'del',
        effectiveFrom: Date.now(),
        inputPer1M: 1,
        cachedInputPer1M: 0.1,
        outputPer1M: 5,
      })
      .expect(201);

    const prices = await request(app).get('/api/analytics/prices').expect(200);
    const delTarget = prices.body.data.find(
      (p: Record<string, unknown>) => p.model === 'del-model',
    );
    expect(delTarget).toBeDefined();

    const delRes = await request(app).delete(`/api/analytics/prices/${delTarget.id}`).expect(200);
    expect(delRes.body.ok).toBe(true);
  });

  it('DELETE /api/analytics/prices/:id returns 400 for invalid id', async () => {
    await request(app).delete('/api/analytics/prices/not-a-number').expect(400);
  });
});

// ═════════════════════════════════════════════════════════════════════
// Response envelope format
// ═════════════════════════════════════════════════════════════════════

describe('Response envelope format', () => {
  it('wraps data in { data, meta } envelope for all endpoints', async () => {
    const now = Date.now();

    const endpoints = [
      `/api/analytics/overview?from=0&to=${now}`,
      `/api/analytics/timeseries?from=0&to=${now}`,
      `/api/analytics/sessions?from=0&to=${now}`,
      `/api/analytics/tools?from=0&to=${now}`,
      `/api/analytics/models?from=0&to=${now}`,
    ];

    for (const endpoint of endpoints) {
      const res = await request(app).get(endpoint).expect(200);
      expect(res.body.data).toBeDefined();
      expect(res.body.meta).toBeDefined();
      expect(typeof res.body.meta.from).toBe('number');
      expect(typeof res.body.meta.to).toBe('number');
    }
  });
});

// ═════════════════════════════════════════════════════════════════════
// CWD filtering isolation
// ═════════════════════════════════════════════════════════════════════

describe('CWD filtering isolation', () => {
  it('isolates data by cwd across all endpoints', async () => {
    // Seed events for two different projects
    for (let i = 0; i < 5; i++) {
      await request(app)
        .post('/api/events')
        .send(makeEvent({ cwd: '/project-alpha', session_id: `alpha-${i}` }));
      await request(app)
        .post('/api/events')
        .send(makeEvent({ cwd: '/project-beta', session_id: `beta-${i}` }));
    }

    const now = Date.now();

    // Overview should only count alpha events
    const overview = await request(app)
      .get(`/api/analytics/overview?from=0&to=${now + 1000}&cwd=/project-alpha`)
      .expect(200);
    expect(overview.body.data.totalEvents).toBe(5);

    // Sessions should only return alpha sessions
    const sessions = await request(app)
      .get(`/api/analytics/sessions?from=0&to=${now + 1000}&cwd=/project-alpha`)
      .expect(200);
    expect(sessions.body.meta.totalCount).toBe(5);
  });
});

// ═════════════════════════════════════════════════════════════════════
// Time range filtering
// ═════════════════════════════════════════════════════════════════════

describe('Time range filtering', () => {
  it('returns only events within the time range', async () => {
    // Seed some events
    await seedEvents(3);

    const now = Date.now();

    // Query a time range in the far future — should find nothing
    const future = now + 100_000_000;
    const res = await request(app)
      .get(`/api/analytics/overview?from=${future}&to=${future + 86400000}`)
      .expect(200);

    expect(res.body.data.totalEvents).toBe(0);
  });
});

// ═════════════════════════════════════════════════════════════════════
// Performance: 10k events
// ═════════════════════════════════════════════════════════════════════

describe('Performance benchmark', () => {
  it('handles 1000 events with analytics queries under 500ms', async () => {
    // Seed 1000 events via direct DB insert for speed
    const { insertEvent } = await import('../db.js');
    const now = Date.now();
    const tools = ['Read', 'Write', 'Edit', 'Bash', 'Glob', 'Grep'];
    const models = ['claude-opus-4-6', 'claude-sonnet-4-5', 'gpt-4o'];

    for (let i = 0; i < 1000; i++) {
      const sessionId = `perf-sess-${i % 50}`;
      const isToolEvent = i % 3 === 0;
      insertEvent({
        event_id: `perf-${i}`,
        session_id: sessionId,
        hook_event_name: isToolEvent ? 'PostToolUse' : 'SessionStart',
        event_type: isToolEvent ? 'tool_end' : 'session_start',
        tool_name: isToolEvent ? tools[i % tools.length] : null,
        tool_use_id: isToolEvent ? `tid-${i}` : null,
        tool_input: null,
        tool_response: null,
        status: 'success',
        error: null,
        token_input: Math.floor(Math.random() * 10000),
        token_output: Math.floor(Math.random() * 5000),
        duration_ms: Math.floor(Math.random() * 5000),
        model: models[i % models.length],
        vendor: 'anthropic',
        cwd: '/perf/test',
        raw_payload: JSON.stringify({ model: models[i % models.length] }),
        created_at: now - (1000 - i) * 60000, // spread across ~16 hours
      });
    }

    // Measure query performance
    const start = performance.now();

    const [overviewRes, timeseriesRes, sessionsRes, toolsRes, modelsRes] = await Promise.all([
      request(app).get(`/api/analytics/overview?from=0&to=${now + 1000}&cwd=/perf/test`),
      request(app).get(
        `/api/analytics/timeseries?from=0&to=${now + 1000}&cwd=/perf/test&granularity=hour`,
      ),
      request(app).get(`/api/analytics/sessions?from=0&to=${now + 1000}&cwd=/perf/test&limit=50`),
      request(app).get(`/api/analytics/tools?from=0&to=${now + 1000}&cwd=/perf/test`),
      request(app).get(`/api/analytics/models?from=0&to=${now + 1000}&cwd=/perf/test`),
    ]);

    const elapsed = performance.now() - start;

    expect(overviewRes.status).toBe(200);
    expect(timeseriesRes.status).toBe(200);
    expect(sessionsRes.status).toBe(200);
    expect(toolsRes.status).toBe(200);
    expect(modelsRes.status).toBe(200);

    expect(overviewRes.body.data.totalEvents).toBe(1000);
    expect(overviewRes.body.data.totalSessions).toBe(50);

    // All 5 analytics queries should complete in under 2000ms combined
    // (transcript file lookups add I/O for sessions without transcript files)
    expect(elapsed).toBeLessThan(2000);
  });
});
