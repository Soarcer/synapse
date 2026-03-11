// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Bernhard

import os from 'os';
import path from 'path';

const tmpDbPath = path.join(os.tmpdir(), `synapse-test-${process.pid}-${Date.now()}.db`);
process.env.SYNAPSE_DB_PATH = tmpDbPath;

import {
  initDb,
  insertEvent,
  queryEvents,
  getEventsBySession,
  getEventsByAgent,
  deleteEventsBySession,
  deleteAllEvents,
  listSessions,
  getDbStats,
  getEventsBySessionIds,
  updateDailyRollup,
  analyticsQueryAll,
  insertPriceHistory,
  getAllPriceHistory,
  deletePriceHistory,
  pruneOldEvents,
  pruneExcessEvents,
  upsertSessionSummary,
} from '../db.js';

// ─── Helpers ─────────────────────────────────────────────────────────

let eventCounter = 0;

function makeEvent(overrides: Record<string, unknown> = {}) {
  eventCounter += 1;
  return {
    event_id: `evt-${eventCounter}`,
    session_id: 'sess-1',
    hook_event_name: 'PreToolUse',
    event_type: 'tool_start',
    raw_payload: '{}',
    created_at: Date.now(),
    ...overrides,
  };
}

function cleanPriceTable(): void {
  const rows = getAllPriceHistory();
  for (const row of rows) {
    deletePriceHistory(row.id);
  }
}

// ─── Setup ───────────────────────────────────────────────────────────

beforeAll(async () => {
  await initDb();
  // Clear any pre-existing data from the loaded DB so tests start clean
  deleteAllEvents();
  cleanPriceTable();
});

afterEach(() => {
  deleteAllEvents();
  cleanPriceTable();
  eventCounter = 0;
});

// ─── Basic CRUD ──────────────────────────────────────────────────────

describe('insertEvent + queryEvents', () => {
  it('inserts an event and retrieves it via queryEvents', () => {
    const evt = makeEvent({ tool_name: 'Read', cwd: '/project' });
    insertEvent(evt);

    const rows = queryEvents({});
    expect(rows).toHaveLength(1);
    expect(rows[0].event_id).toBe(evt.event_id);
    expect(rows[0].session_id).toBe('sess-1');
    expect(rows[0].hook_event_name).toBe('PreToolUse');
    expect(rows[0].event_type).toBe('tool_start');
    expect(rows[0].tool_name).toBe('Read');
    expect(rows[0].cwd).toBe('/project');
    expect(rows[0].raw_payload).toBe('{}');
    expect(rows[0].created_at).toBe(evt.created_at);
  });
});

describe('queryEvents — filter by sessionId', () => {
  it('returns only events matching the given sessionId', () => {
    insertEvent(makeEvent({ session_id: 'sess-A' }));
    insertEvent(makeEvent({ session_id: 'sess-B' }));
    insertEvent(makeEvent({ session_id: 'sess-A' }));

    const rows = queryEvents({ sessionId: 'sess-A' });
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.session_id === 'sess-A')).toBe(true);
  });
});

describe('queryEvents — filter by agentId', () => {
  it('returns only events matching the given agentId', () => {
    insertEvent(makeEvent({ agent_id: 'agent-1' }));
    insertEvent(makeEvent({ agent_id: 'agent-2' }));
    insertEvent(makeEvent({ agent_id: 'agent-1' }));

    const rows = queryEvents({ agentId: 'agent-1' });
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.agent_id === 'agent-1')).toBe(true);
  });
});

describe('queryEvents — filter by type', () => {
  it('returns only events matching the given event_type', () => {
    insertEvent(makeEvent({ event_type: 'tool_start' }));
    insertEvent(makeEvent({ event_type: 'tool_end' }));
    insertEvent(makeEvent({ event_type: 'tool_start' }));

    const rows = queryEvents({ type: 'tool_end' });
    expect(rows).toHaveLength(1);
    expect(rows[0].event_type).toBe('tool_end');
  });
});

describe('queryEvents — filter by cwd', () => {
  it('returns only events matching the given cwd', () => {
    insertEvent(makeEvent({ cwd: '/project-alpha' }));
    insertEvent(makeEvent({ cwd: '/project-beta' }));
    insertEvent(makeEvent({ cwd: '/project-alpha' }));

    const rows = queryEvents({ cwd: '/project-alpha' });
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.cwd === '/project-alpha')).toBe(true);
  });
});

describe('queryEvents — pagination (limit + offset)', () => {
  it('respects limit and offset parameters', () => {
    const now = Date.now();
    for (let i = 0; i < 10; i++) {
      insertEvent(makeEvent({ created_at: now + i }));
    }

    // Default order for unfiltered queryEvents is created_at DESC
    const page1 = queryEvents({ limit: 3, offset: 0 });
    expect(page1).toHaveLength(3);

    const page2 = queryEvents({ limit: 3, offset: 3 });
    expect(page2).toHaveLength(3);

    // Pages should not overlap
    const page1Ids = new Set(page1.map((r) => r.event_id));
    const page2Ids = new Set(page2.map((r) => r.event_id));
    for (const id of page2Ids) {
      expect(page1Ids.has(id)).toBe(false);
    }
  });
});

describe('getEventsBySession', () => {
  it('returns events for a specific session ordered by created_at ASC', () => {
    const now = Date.now();
    insertEvent(makeEvent({ session_id: 'sess-X', created_at: now + 200 }));
    insertEvent(makeEvent({ session_id: 'sess-Y', created_at: now + 100 }));
    insertEvent(makeEvent({ session_id: 'sess-X', created_at: now + 50 }));

    const rows = getEventsBySession('sess-X');
    expect(rows).toHaveLength(2);
    expect(rows[0].created_at).toBeLessThanOrEqual(rows[1].created_at);
    expect(rows.every((r) => r.session_id === 'sess-X')).toBe(true);
  });
});

describe('getEventsByAgent', () => {
  it('returns events for a specific agent ordered by created_at ASC', () => {
    const now = Date.now();
    insertEvent(makeEvent({ agent_id: 'a-1', created_at: now + 300 }));
    insertEvent(makeEvent({ agent_id: 'a-2', created_at: now + 200 }));
    insertEvent(makeEvent({ agent_id: 'a-1', created_at: now + 100 }));

    const rows = getEventsByAgent('a-1');
    expect(rows).toHaveLength(2);
    expect(rows[0].created_at).toBeLessThanOrEqual(rows[1].created_at);
    expect(rows.every((r) => r.agent_id === 'a-1')).toBe(true);
  });
});

describe('deleteEventsBySession', () => {
  it('deletes only events from the specified session and returns count', () => {
    insertEvent(makeEvent({ session_id: 'sess-keep' }));
    insertEvent(makeEvent({ session_id: 'sess-delete' }));
    insertEvent(makeEvent({ session_id: 'sess-delete' }));

    const deleted = deleteEventsBySession('sess-delete');
    expect(deleted).toBe(2);

    const remaining = queryEvents({});
    expect(remaining).toHaveLength(1);
    expect(remaining[0].session_id).toBe('sess-keep');
  });
});

describe('deleteAllEvents', () => {
  it('removes all events and returns count', () => {
    insertEvent(makeEvent({ session_id: 'a' }));
    insertEvent(makeEvent({ session_id: 'b' }));
    insertEvent(makeEvent({ session_id: 'c' }));

    const deleted = deleteAllEvents();
    expect(deleted).toBe(3);

    const remaining = queryEvents({});
    expect(remaining).toHaveLength(0);
  });
});

describe('listSessions', () => {
  it('returns correct aggregation per session', () => {
    const now = Date.now();
    insertEvent(makeEvent({ session_id: 'sess-1', created_at: now }));
    insertEvent(makeEvent({ session_id: 'sess-1', created_at: now + 1000 }));
    insertEvent(makeEvent({ session_id: 'sess-1', created_at: now + 2000 }));
    insertEvent(makeEvent({ session_id: 'sess-2', created_at: now + 500 }));

    const sessions = listSessions();
    expect(sessions).toHaveLength(2);

    // Sessions are ordered by last_event DESC, so sess-1 (now+2000) comes first
    const s1 = sessions.find((s) => s.session_id === 'sess-1');
    const s2 = sessions.find((s) => s.session_id === 'sess-2');

    expect(s1).toBeDefined();
    expect(s1!.event_count).toBe(3);
    expect(s1!.first_event).toBe(now);
    expect(s1!.last_event).toBe(now + 2000);

    expect(s2).toBeDefined();
    expect(s2!.event_count).toBe(1);
    expect(s2!.first_event).toBe(now + 500);
    expect(s2!.last_event).toBe(now + 500);
  });
});

describe('getDbStats', () => {
  it('returns correct total events and session counts', () => {
    insertEvent(makeEvent({ session_id: 'sess-alpha' }));
    insertEvent(makeEvent({ session_id: 'sess-alpha' }));
    insertEvent(makeEvent({ session_id: 'sess-beta' }));

    const stats = getDbStats();
    expect(stats.totalEvents).toBe(3);
    expect(stats.totalSessions).toBe(2);
    expect(typeof stats.dbSizeBytes).toBe('number');
  });
});

describe('getEventsBySessionIds', () => {
  it('returns a Map grouping events by session_id', () => {
    const now = Date.now();
    insertEvent(makeEvent({ session_id: 's1', created_at: now }));
    insertEvent(makeEvent({ session_id: 's1', created_at: now + 100 }));
    insertEvent(makeEvent({ session_id: 's2', created_at: now + 200 }));
    insertEvent(makeEvent({ session_id: 's3', created_at: now + 300 }));

    const grouped = getEventsBySessionIds(['s1', 's2']);
    expect(grouped).toBeInstanceOf(Map);
    expect(grouped.size).toBe(2);

    const s1Events = grouped.get('s1');
    expect(s1Events).toHaveLength(2);
    // Verify ordering (ASC by created_at)
    expect(s1Events![0].created_at).toBeLessThanOrEqual(s1Events![1].created_at);

    const s2Events = grouped.get('s2');
    expect(s2Events).toHaveLength(1);

    // s3 was not requested
    expect(grouped.has('s3')).toBe(false);
  });

  it('returns an empty Map for an empty input array', () => {
    const grouped = getEventsBySessionIds([]);
    expect(grouped).toBeInstanceOf(Map);
    expect(grouped.size).toBe(0);
  });
});

// ─── Analytics ───────────────────────────────────────────────────────

describe('updateDailyRollup', () => {
  it('inserts a new rollup row and increments counters on repeated calls', () => {
    // Use a unique date far in the past to avoid collisions with other tests
    const testDate = new Date('2020-01-15T12:00:00Z').getTime();
    const cwd = '__test_rollup__';
    const model = 'test-model';

    updateDailyRollup({
      created_at: testDate,
      cwd,
      model,
      vendor: 'anthropic',
      event_type: 'tool_start',
      tool_name: 'Read',
      token_input: 100,
      token_output: 50,
      duration_ms: 200,
      cost_usd: 0.01,
    });

    // Query the rollup row
    const rows = analyticsQueryAll(
      'SELECT * FROM analytics_daily WHERE date = ? AND cwd = ? AND model = ?',
      ['2020-01-15', cwd, model],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].total_events).toBe(1);
    expect(rows[0].total_tool_calls).toBe(1);
    expect(rows[0].total_input_tokens).toBe(100);
    expect(rows[0].total_output_tokens).toBe(50);
    expect(rows[0].total_cost_usd).toBeCloseTo(0.01, 5);
    expect(rows[0].sum_latency_ms).toBe(200);

    // Insert a second event on the same date/cwd/model — should increment
    updateDailyRollup({
      created_at: testDate + 1000,
      cwd,
      model,
      vendor: 'anthropic',
      event_type: 'tool_end',
      tool_name: 'Read',
      token_input: 200,
      token_output: 100,
      duration_ms: 300,
      cost_usd: 0.02,
    });

    const updated = analyticsQueryAll(
      'SELECT * FROM analytics_daily WHERE date = ? AND cwd = ? AND model = ?',
      ['2020-01-15', cwd, model],
    );
    expect(updated).toHaveLength(1);
    expect(updated[0].total_events).toBe(2);
    expect(updated[0].total_tool_calls).toBe(2);
    expect(updated[0].total_input_tokens).toBe(300);
    expect(updated[0].total_output_tokens).toBe(150);
    expect(updated[0].total_cost_usd).toBeCloseTo(0.03, 5);
    expect(updated[0].max_latency_ms).toBe(300);
    expect(updated[0].min_latency_ms).toBe(200);
  });

  it('increments total_sessions only for session_start events', () => {
    const testDate = new Date('2020-02-20T12:00:00Z').getTime();
    const cwd = '__test_session_count__';
    const model = 'test-model';

    updateDailyRollup({
      created_at: testDate,
      cwd,
      model,
      event_type: 'session_start',
    });

    updateDailyRollup({
      created_at: testDate + 1000,
      cwd,
      model,
      event_type: 'tool_start',
      tool_name: 'Bash',
    });

    const rows = analyticsQueryAll(
      'SELECT * FROM analytics_daily WHERE date = ? AND cwd = ? AND model = ?',
      ['2020-02-20', cwd, model],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].total_sessions).toBe(1); // Only the session_start counted
    expect(rows[0].total_events).toBe(2); // Both events counted
  });
});

// ─── Price History ───────────────────────────────────────────────────

describe('insertPriceHistory + getAllPriceHistory', () => {
  it('inserts price entries and retrieves them in a CRUD roundtrip', () => {
    const id1 = insertPriceHistory({
      model: 'claude-opus-4-6',
      vendor: 'anthropic',
      effective_from: Date.now() - 86400000,
      input_per_1m: 15.0,
      cached_input_per_1m: 1.5,
      output_per_1m: 75.0,
      source: 'test',
    });
    expect(id1).toBe(1);

    const id2 = insertPriceHistory({
      model: 'claude-sonnet-4',
      vendor: 'anthropic',
      effective_from: Date.now(),
      input_per_1m: 3.0,
      cached_input_per_1m: 0.3,
      output_per_1m: 15.0,
    });
    expect(id2).toBe(1); // getRowsModified returns 1

    const all = getAllPriceHistory();
    expect(all.length).toBeGreaterThanOrEqual(2);

    const opus = all.find((r) => r.model === 'claude-opus-4-6');
    expect(opus).toBeDefined();
    expect(opus!.vendor).toBe('anthropic');
    expect(opus!.input_per_1m).toBe(15.0);
    expect(opus!.cached_input_per_1m).toBe(1.5);
    expect(opus!.output_per_1m).toBe(75.0);
    expect(opus!.source).toBe('test');

    const sonnet = all.find((r) => r.model === 'claude-sonnet-4');
    expect(sonnet).toBeDefined();
    expect(sonnet!.source).toBe('user'); // default source
  });
});

describe('deletePriceHistory', () => {
  it('removes a specific price entry by id', () => {
    insertPriceHistory({
      model: 'model-a',
      vendor: 'vendor-a',
      effective_from: Date.now(),
      input_per_1m: 1.0,
      cached_input_per_1m: 0.1,
      output_per_1m: 5.0,
    });
    insertPriceHistory({
      model: 'model-b',
      vendor: 'vendor-b',
      effective_from: Date.now(),
      input_per_1m: 2.0,
      cached_input_per_1m: 0.2,
      output_per_1m: 10.0,
    });

    const allBefore = getAllPriceHistory();
    expect(allBefore).toHaveLength(2);

    // Delete the first entry
    const targetId = allBefore.find((r) => r.model === 'model-a')!.id;
    const deleted = deletePriceHistory(targetId);
    expect(deleted).toBe(1);

    const allAfter = getAllPriceHistory();
    expect(allAfter).toHaveLength(1);
    expect(allAfter[0].model).toBe('model-b');
  });

  it('returns 0 when deleting a non-existent id', () => {
    const deleted = deletePriceHistory(99999);
    expect(deleted).toBe(0);
  });
});

// ─── Pruning ─────────────────────────────────────────────────────────

describe('pruneOldEvents', () => {
  it('removes events older than maxAgeDays and keeps newer ones', () => {
    const now = Date.now();
    const oneDayMs = 24 * 60 * 60 * 1000;

    // Insert an old event (15 days ago)
    insertEvent(makeEvent({ created_at: now - 15 * oneDayMs, session_id: 'old-sess' }));
    // Insert a recent event (1 day ago)
    insertEvent(makeEvent({ created_at: now - 1 * oneDayMs, session_id: 'new-sess' }));

    const pruned = pruneOldEvents(10); // Prune events older than 10 days
    expect(pruned).toBe(1);

    const remaining = queryEvents({});
    expect(remaining).toHaveLength(1);
    expect(remaining[0].session_id).toBe('new-sess');
  });

  it('returns 0 when no events are older than the cutoff', () => {
    insertEvent(makeEvent({ created_at: Date.now() }));

    const pruned = pruneOldEvents(30);
    expect(pruned).toBe(0);

    const remaining = queryEvents({});
    expect(remaining).toHaveLength(1);
  });
});

describe('pruneExcessEvents', () => {
  it('removes the oldest events when total exceeds maxCount', () => {
    const now = Date.now();
    // Insert 5 events with ascending timestamps
    for (let i = 0; i < 5; i++) {
      insertEvent(makeEvent({ created_at: now + i * 100 }));
    }

    // Keep only 3 — should prune the 2 oldest
    const pruned = pruneExcessEvents(3);
    expect(pruned).toBe(2);

    const remaining = queryEvents({});
    expect(remaining).toHaveLength(3);

    // The remaining events should be the 3 newest (highest created_at)
    // queryEvents with no filter returns DESC order
    for (const row of remaining) {
      expect(row.created_at).toBeGreaterThanOrEqual(now + 200);
    }
  });

  it('returns 0 when total is within maxCount', () => {
    insertEvent(makeEvent());
    insertEvent(makeEvent());

    const pruned = pruneExcessEvents(10);
    expect(pruned).toBe(0);

    const remaining = queryEvents({});
    expect(remaining).toHaveLength(2);
  });
});

// ─── Session Summary Materialization ─────────────────────────────────

describe('session_summary materialization', () => {
  it('listSessions returns summary after upsertSessionSummary', () => {
    const now = Date.now();
    insertEvent(
      makeEvent({
        session_id: 'mat-1',
        event_type: 'session_start',
        cwd: '/proj',
        created_at: now,
      }),
    );
    upsertSessionSummary({
      session_id: 'mat-1',
      created_at: now,
      event_type: 'session_start',
      cwd: '/proj',
    });
    const sessions = listSessions();
    expect(sessions).toHaveLength(1);
    expect(sessions[0].session_id).toBe('mat-1');
    expect(sessions[0].event_count).toBe(1);
    expect(sessions[0].cwd).toBe('/proj');
  });

  it('accumulates tool_count for tool events', () => {
    const now = Date.now();
    insertEvent(makeEvent({ session_id: 'mat-2', event_type: 'session_start', created_at: now }));
    upsertSessionSummary({ session_id: 'mat-2', created_at: now, event_type: 'session_start' });
    insertEvent(
      makeEvent({
        session_id: 'mat-2',
        event_type: 'tool_start',
        tool_name: 'Read',
        created_at: now + 1,
      }),
    );
    upsertSessionSummary({ session_id: 'mat-2', created_at: now + 1, event_type: 'tool_start' });
    insertEvent(
      makeEvent({
        session_id: 'mat-2',
        event_type: 'tool_end',
        tool_name: 'Read',
        created_at: now + 2,
      }),
    );
    upsertSessionSummary({ session_id: 'mat-2', created_at: now + 2, event_type: 'tool_end' });
    const sessions = listSessions();
    const s = sessions.find((s) => s.session_id === 'mat-2')!;
    expect(s.event_count).toBe(3);
    expect(s.tool_count).toBe(2);
  });

  it('accumulates total_tokens from token fields', () => {
    const now = Date.now();
    insertEvent(
      makeEvent({
        session_id: 'mat-3',
        event_type: 'result',
        token_input: 100,
        token_output: 50,
        created_at: now,
      }),
    );
    upsertSessionSummary({
      session_id: 'mat-3',
      created_at: now,
      event_type: 'result',
      token_input: 100,
      token_output: 50,
    });
    insertEvent(
      makeEvent({
        session_id: 'mat-3',
        event_type: 'result',
        token_input: 200,
        token_output: 75,
        created_at: now + 1,
      }),
    );
    upsertSessionSummary({
      session_id: 'mat-3',
      created_at: now + 1,
      event_type: 'result',
      token_input: 200,
      token_output: 75,
    });
    const sessions = listSessions();
    const s = sessions.find((s) => s.session_id === 'mat-3')!;
    expect(s.total_tokens).toBe(425);
  });

  it('marks has_ended when session_end event arrives', () => {
    const now = Date.now();
    insertEvent(makeEvent({ session_id: 'mat-4', event_type: 'session_start', created_at: now }));
    upsertSessionSummary({ session_id: 'mat-4', created_at: now, event_type: 'session_start' });
    let sessions = listSessions();
    expect(sessions.find((s) => s.session_id === 'mat-4')!.has_ended).toBe(0);

    insertEvent(makeEvent({ session_id: 'mat-4', event_type: 'session_end', created_at: now + 1 }));
    upsertSessionSummary({ session_id: 'mat-4', created_at: now + 1, event_type: 'session_end' });
    sessions = listSessions();
    expect(sessions.find((s) => s.session_id === 'mat-4')!.has_ended).toBe(1);
  });

  it('filters by cwd', () => {
    const now = Date.now();
    insertEvent(makeEvent({ session_id: 'mat-5a', cwd: '/alpha', created_at: now }));
    upsertSessionSummary({
      session_id: 'mat-5a',
      created_at: now,
      event_type: 'session_start',
      cwd: '/alpha',
    });
    insertEvent(makeEvent({ session_id: 'mat-5b', cwd: '/beta', created_at: now + 1 }));
    upsertSessionSummary({
      session_id: 'mat-5b',
      created_at: now + 1,
      event_type: 'session_start',
      cwd: '/beta',
    });
    const filtered = listSessions(500, '/alpha');
    expect(filtered).toHaveLength(1);
    expect(filtered[0].session_id).toBe('mat-5a');
  });
});
