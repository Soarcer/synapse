import path from 'path';
import os from 'os';

// Isolate DB for this test file
process.env.SYNAPSE_DB_PATH = path.join(
  os.tmpdir(),
  `synapse-test-querybounds-${process.pid}-${Date.now()}.db`,
);

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  initDb,
  insertEvent,
  getEventsBySession,
  getEventsByAgent,
  listSessions,
  deleteAllEvents,
  analyticsQueryAll,
} from '../db.js';
import { Broadcaster } from '../services/broadcaster.js';
import { AgentManager } from '../services/agentManager.js';

let broadcaster: Broadcaster;
let agentManager: AgentManager;

function makeEvent(overrides: Partial<Parameters<typeof insertEvent>[0]> = {}) {
  const id = `evt-${Math.random().toString(36).slice(2, 10)}`;
  return {
    event_id: id,
    session_id: overrides.session_id ?? 'sess-1',
    hook_event_name: 'ToolUse',
    event_type: overrides.event_type ?? 'tool_start',
    agent_id: overrides.agent_id ?? 'agent-1',
    tool_name: overrides.tool_name ?? 'Read',
    tool_use_id: overrides.tool_use_id ?? `tu-${id}`,
    raw_payload: JSON.stringify({ id }),
    created_at: overrides.created_at ?? Date.now(),
    ...overrides,
  };
}

beforeAll(async () => {
  await initDb();
  broadcaster = new Broadcaster();
  agentManager = new AgentManager();
});

afterAll(() => {
  broadcaster.destroy();
  agentManager.stopAll();
  deleteAllEvents();
});

// ── Query Bounds ───────────────────────────────────────────────────

describe('getEventsBySession with limit', () => {
  it('returns at most `limit` events', () => {
    // Insert 20 events
    for (let i = 0; i < 20; i++) {
      insertEvent(makeEvent({ session_id: 'limit-sess', created_at: Date.now() + i }));
    }

    const all = getEventsBySession('limit-sess');
    expect(all.length).toBe(20);

    const limited = getEventsBySession('limit-sess', 5);
    expect(limited.length).toBe(5);
  });
});

describe('getEventsByAgent with limit', () => {
  it('returns at most `limit` events', () => {
    for (let i = 0; i < 15; i++) {
      insertEvent(makeEvent({ agent_id: 'limit-agent', session_id: 'agent-sess', created_at: Date.now() + i }));
    }

    const all = getEventsByAgent('limit-agent');
    expect(all.length).toBe(15);

    const limited = getEventsByAgent('limit-agent', 3);
    expect(limited.length).toBe(3);
  });
});

describe('listSessions with limit', () => {
  it('respects default limit', () => {
    // We already have sessions from above — just verify it returns a bounded result
    const sessions = listSessions();
    expect(sessions.length).toBeLessThanOrEqual(500);
    expect(sessions.length).toBeGreaterThan(0);
  });

  it('respects explicit limit', () => {
    const sessions = listSessions(1);
    expect(sessions.length).toBe(1);
  });
});

describe('tool_use_id index', () => {
  it('idx_events_tool_use_id exists after initDb', () => {
    const rows = analyticsQueryAll(
      "SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'idx_events_tool_use_id'",
    );
    expect(rows.length).toBe(1);
  });
});
