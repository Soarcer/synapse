// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Synapse Contributors

// Set DB path to a non-existent temp location BEFORE any server imports
// so sql.js creates a fresh in-memory database.
import path from 'path';
import os from 'os';

process.env.SYNAPSE_DB_PATH = path.join(os.tmpdir(), 'synapse-test-pipeline-' + Date.now() + '.db');

import request from 'supertest';
import type { Express } from 'express';
import { initDb, deleteAllEvents } from '../db.js';
import { createApp } from '../app.js';
import { Broadcaster } from '../services/broadcaster.js';
import { AgentManager } from '../services/agentManager.js';
import { registry } from '../routes/events.js';
const clearDedupeCache = () => registry.clearDedupeCache();

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

    const getRes = await request(app).get('/api/events?sessionId=test-pipe-1').expect(200);

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
  it('stores two events when the same session_id is posted with different hook names', async () => {
    const base = {
      session_id: 'test-pipe-dup',
      model: 'claude-opus-4-6',
      cwd: '/test',
    };

    const res1 = await request(app)
      .post('/api/events')
      .send({ ...base, hook_event_name: 'SessionStart' })
      .expect(200);

    const res2 = await request(app)
      .post('/api/events')
      .send({ ...base, hook_event_name: 'Stop' })
      .expect(200);

    // Each POST generates a unique server-side event ID
    expect(res1.body.eventId).not.toBe(res2.body.eventId);

    const getRes = await request(app).get('/api/events?sessionId=test-pipe-dup').expect(200);

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

    const postRes = await request(app).post('/api/events').send(openclawEvent).expect(200);

    expect(postRes.body.ok).toBe(true);
    expect(postRes.body.eventId).toBe('oc-1');

    const getRes = await request(app).get('/api/events?sessionId=oc-sess').expect(200);

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

    const getRes = await request(app).get('/api/events?type=tool_start').expect(200);

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
    const beforeRes = await request(app).get('/api/events?sessionId=test-pipe-delete').expect(200);
    expect(beforeRes.body.length).toBe(1);

    // Delete all
    const delRes = await request(app).delete('/api/events').expect(200);

    expect(delRes.body.ok).toBe(true);
    expect(delRes.body.deleted).toBeGreaterThanOrEqual(1);

    // Confirm empty
    const afterRes = await request(app).get('/api/events').expect(200);

    expect(Array.isArray(afterRes.body)).toBe(true);
    expect(afterRes.body.length).toBe(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════
// 6. Gemini CLI events — detected, normalized, stored with vendor: google
// ═══════════════════════════════════════════════════════════════════════

describe('Gemini CLI events via AdapterRegistry', () => {
  it('stores a Gemini BeforeModel event as user_prompt with vendor google', async () => {
    const postRes = await request(app)
      .post('/api/events')
      .send({
        hook_event_name: 'BeforeModel',
        session_id: 'gemini-int-test-1',
        timestamp: '2026-02-10T14:30:00Z',
        cwd: '/project',
        llm_request: {
          model: 'gemini-2.5-pro',
          messages: [{ role: 'user', content: 'Fix the bug' }],
        },
      })
      .expect(200);

    expect(postRes.body.ok).toBe(true);

    const getRes = await request(app).get('/api/events?sessionId=gemini-int-test-1').expect(200);

    expect(getRes.body.length).toBe(1);
    const event = getRes.body[0];
    expect(event.type).toBe('user_prompt');
    expect(event.vendor).toBe('google');
    expect(event.eventSource).toBe('hook');
  });

  it('stores a Gemini SessionStart event with .gemini/ path as vendor google', async () => {
    const postRes = await request(app)
      .post('/api/events')
      .send({
        hook_event_name: 'SessionStart',
        session_id: 'gemini-int-test-2',
        timestamp: '2026-02-10T14:30:00Z',
        cwd: '/project',
        model: 'gemini-2.5-pro',
        source: 'startup',
        transcript_path: '/home/user/.gemini/tmp/abc/chats/session.jsonl',
      })
      .expect(200);

    expect(postRes.body.ok).toBe(true);

    const getRes = await request(app).get('/api/events?sessionId=gemini-int-test-2').expect(200);

    expect(getRes.body.length).toBe(1);
    expect(getRes.body[0].type).toBe('session_start');
    expect(getRes.body[0].vendor).toBe('google');
  });

  it('stores a Gemini AfterTool error as tool_error', async () => {
    await request(app)
      .post('/api/events')
      .send({
        hook_event_name: 'AfterTool',
        session_id: 'gemini-int-test-3',
        timestamp: '2026-02-10T14:31:00Z',
        tool_name: 'run_shell_command',
        tool_response: { error: 'Tests failed' },
      })
      .expect(200);

    const getRes = await request(app).get('/api/events?sessionId=gemini-int-test-3').expect(200);

    expect(getRes.body.length).toBe(1);
    expect(getRes.body[0].type).toBe('tool_error');
    expect(getRes.body[0].vendor).toBe('google');
    expect(getRes.body[0].status).toBe('error');
  });

  it('Claude and Gemini events coexist in same DB', async () => {
    // Post a Claude event
    await request(app)
      .post('/api/events')
      .send({
        hook_event_name: 'SessionStart',
        session_id: 'coexist-claude',
        model: 'claude-opus-4-6',
      })
      .expect(200);

    // Post a Gemini event
    await request(app)
      .post('/api/events')
      .send({
        hook_event_name: 'BeforeModel',
        session_id: 'coexist-gemini',
        timestamp: '2026-02-10T14:30:00Z',
        llm_request: { model: 'gemini-2.5-pro', messages: [] },
      })
      .expect(200);

    // Retrieve Claude event
    const claudeRes = await request(app).get('/api/events?sessionId=coexist-claude').expect(200);

    expect(claudeRes.body.length).toBe(1);
    expect(claudeRes.body[0].vendor).toBe('anthropic');

    // Retrieve Gemini event
    const geminiRes = await request(app)
      .get('/api/events?sessionId=gemini-coexist-gemini')
      .expect(200);

    expect(geminiRes.body.length).toBe(1);
    expect(geminiRes.body[0].vendor).toBe('google');
  });
});

// ═══════════════════════════════════════════════════════════════════════
// 7. Codex CLI events — detected, normalized, stored with vendor: openai
// ═══════════════════════════════════════════════════════════════════════

describe('Codex CLI events via AdapterRegistry', () => {
  it('stores a Codex event_msg user_message as user_prompt with vendor openai', async () => {
    const postRes = await request(app)
      .post('/api/events')
      .send({
        type: 'event_msg',
        session_id: 'cx-int-1',
        payload: {
          type: 'user_message',
          message: 'Fix the auth bug',
        },
      })
      .expect(200);

    expect(postRes.body.ok).toBe(true);

    const getRes = await request(app).get('/api/events?sessionId=codex-cx-int-1').expect(200);

    expect(getRes.body.length).toBe(1);
    const event = getRes.body[0];
    expect(event.type).toBe('user_prompt');
    expect(event.vendor).toBe('openai');
    expect(event.eventSource).toBe('hook');
  });

  it('stores a Codex agent-turn-complete as result', async () => {
    const postRes = await request(app)
      .post('/api/events')
      .send({
        type: 'agent-turn-complete',
        'thread-id': 'cx-int-2',
        'last-assistant-message': 'Fixed the bug.',
        codex_source: 'notify',
      })
      .expect(200);

    expect(postRes.body.ok).toBe(true);

    const getRes = await request(app).get('/api/events?sessionId=codex-cx-int-2').expect(200);

    expect(getRes.body.length).toBe(1);
    expect(getRes.body[0].type).toBe('result');
    expect(getRes.body[0].vendor).toBe('openai');
  });

  it('stores a Codex role=assistant tool_use as tool_start', async () => {
    await request(app)
      .post('/api/events')
      .send({
        type: 'message',
        session_id: 'cx-int-3',
        role: 'assistant',
        content: [
          { type: 'tool_use', id: 'tu-int-1', name: 'shell', input: { command: 'npm test' } },
        ],
      })
      .expect(200);

    const getRes = await request(app).get('/api/events?sessionId=codex-cx-int-3').expect(200);

    expect(getRes.body.length).toBe(1);
    expect(getRes.body[0].type).toBe('tool_start');
    expect(getRes.body[0].toolName).toBe('shell');
    expect(getRes.body[0].vendor).toBe('openai');
  });

  it('Claude, Gemini, and Codex events coexist in same DB', async () => {
    // Claude
    await request(app)
      .post('/api/events')
      .send({ hook_event_name: 'SessionStart', session_id: 'tri-claude', model: 'claude-opus-4-6' })
      .expect(200);

    // Gemini
    await request(app)
      .post('/api/events')
      .send({
        hook_event_name: 'BeforeModel',
        session_id: 'tri-gemini',
        timestamp: '2026-02-10T14:30:00Z',
        llm_request: { model: 'gemini-2.5-pro', messages: [] },
      })
      .expect(200);

    // Codex
    await request(app)
      .post('/api/events')
      .send({
        type: 'event_msg',
        session_id: 'tri-cx',
        payload: { type: 'user_message', message: 'Hello from Codex' },
      })
      .expect(200);

    // Verify all three
    const claude = await request(app).get('/api/events?sessionId=tri-claude').expect(200);
    expect(claude.body[0].vendor).toBe('anthropic');

    const gemini = await request(app).get('/api/events?sessionId=gemini-tri-gemini').expect(200);
    expect(gemini.body[0].vendor).toBe('google');

    const codex = await request(app).get('/api/events?sessionId=codex-tri-cx').expect(200);
    expect(codex.body[0].vendor).toBe('openai');
  });
});
