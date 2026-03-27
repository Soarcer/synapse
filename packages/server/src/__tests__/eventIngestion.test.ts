// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Bernhard

import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest';
import path from 'path';
import os from 'os';

// Use a fresh in-memory DB for each test run
process.env.SYNAPSE_DB_PATH = path.join(
  os.tmpdir(),
  'synapse-test-ingestion-' + Date.now() + '.db',
);

import { initDb, deleteAllEvents } from '../db.js';
import { ingestRawEvent, resolveIfSessionAdvanced } from '../services/eventIngestion.js';
import { registry } from '../routes/events.js';
import { pending } from '../state/permissionState.js';
import type { Broadcaster } from '../services/broadcaster.js';
import type { Response } from 'express';

// ─── Helpers ─────────────────────────────────────────────────────────

function makeBroadcaster(): Broadcaster & {
  broadcastCalls: unknown[];
  broadcastRawCalls: unknown[];
} {
  const broadcastCalls: unknown[] = [];
  const broadcastRawCalls: unknown[] = [];
  return {
    broadcast: vi.fn((evt: unknown) => broadcastCalls.push(evt)),
    broadcastRaw: vi.fn((msg: unknown) => broadcastRawCalls.push(msg)),
    broadcastCalls,
    broadcastRawCalls,
    // Stubs for unused Broadcaster methods
    addClient: vi.fn(),
    removeClient: vi.fn(),
    destroy: vi.fn(),
    startHeartbeat: vi.fn(),
  } as unknown as Broadcaster & {
    broadcastCalls: unknown[];
    broadcastRawCalls: unknown[];
  };
}

function makeMockRes() {
  return {
    json: vi.fn(),
    socket: { destroyed: false },
    writableEnded: false,
  };
}

function seedPending(sessionId: string): string {
  const id = `perm-${Math.random().toString(36).slice(2)}`;
  const mockRes = makeMockRes();
  pending.set(id, {
    res: mockRes as unknown as Response,
    event: {
      session_id: sessionId,
      tool_name: 'Bash',
      hook_event_name: 'PermissionRequest',
    },
    timer: setTimeout(() => {}, 999999),
    createdAt: Date.now() - 5000,
  });
  return id;
}

// ─── Setup ───────────────────────────────────────────────────────────

let broadcaster: ReturnType<typeof makeBroadcaster>;

beforeAll(async () => {
  await initDb();
});

afterEach(() => {
  deleteAllEvents();
  registry.clearDedupeCache();
  for (const [, entry] of pending.entries()) clearTimeout(entry.timer);
  pending.clear();
  broadcaster = makeBroadcaster();
});

// Fresh broadcaster before first test
broadcaster = makeBroadcaster();

// ═════════════════════════════════════════════════════════════════════
// 1. ingestRawEvent — Claude hook events
// ═════════════════════════════════════════════════════════════════════

describe('ingestRawEvent — Claude hook events', () => {
  it('ingests a SessionStart event and returns ok with eventId', () => {
    const result = ingestRawEvent(
      {
        hook_event_name: 'SessionStart',
        session_id: 'sess-1',
        model: 'claude-opus-4-6',
        cwd: '/project',
      },
      broadcaster,
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(typeof result.eventId).toBe('string');
      expect(result.eventId.length).toBeGreaterThan(0);
    }
  });

  it('ingests a PreToolUse event with tool fields', () => {
    const result = ingestRawEvent(
      {
        hook_event_name: 'PreToolUse',
        session_id: 'sess-2',
        tool_name: 'Read',
        tool_use_id: 'tu-1',
        tool_input: { file_path: '/foo.ts' },
      },
      broadcaster,
    );

    expect(result.ok).toBe(true);
  });

  it('ingests a PostToolUse event', () => {
    const result = ingestRawEvent(
      {
        hook_event_name: 'PostToolUse',
        session_id: 'sess-3',
        tool_name: 'Bash',
        tool_use_id: 'tu-2',
        tool_response: { output: 'hello' },
      },
      broadcaster,
    );

    expect(result.ok).toBe(true);
  });

  it('ingests a Stop event', () => {
    const result = ingestRawEvent(
      {
        hook_event_name: 'Stop',
        session_id: 'sess-4',
        reason: 'end_turn',
      },
      broadcaster,
    );

    expect(result.ok).toBe(true);
  });

  it('ingests a UserPromptSubmit event', () => {
    const result = ingestRawEvent(
      {
        hook_event_name: 'UserPromptSubmit',
        session_id: 'sess-5',
        prompt: 'Fix the tests',
      },
      broadcaster,
    );

    expect(result.ok).toBe(true);
  });

  it('ingests a Notification event', () => {
    const result = ingestRawEvent(
      {
        hook_event_name: 'Notification',
        session_id: 'sess-6',
        message: 'Permission needed',
        notification_type: 'permission_prompt',
      },
      broadcaster,
    );

    expect(result.ok).toBe(true);
  });

  it('broadcasts the normalized event to WebSocket clients', () => {
    ingestRawEvent(
      {
        hook_event_name: 'SessionStart',
        session_id: 'sess-bc',
        model: 'claude-opus-4-6',
      },
      broadcaster,
    );

    expect(broadcaster.broadcast).toHaveBeenCalledTimes(1);
    const broadcastedEvent = (broadcaster.broadcast as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(broadcastedEvent.type).toBe('session_start');
    expect(broadcastedEvent.sessionId).toBe('sess-bc');
  });
});

// ═════════════════════════════════════════════════════════════════════
// 2. ingestRawEvent — OpenClaw pre-normalized events
// ═════════════════════════════════════════════════════════════════════

describe('ingestRawEvent — OpenClaw pre-normalized events', () => {
  it('ingests an OpenClaw event bypassing adapter registry', () => {
    const result = ingestRawEvent(
      {
        id: 'oc-evt-1',
        type: 'agent_start',
        sessionId: 'oc-sess-1',
        agentId: 'oc-agent-1',
        timestamp: Date.now(),
        eventSource: 'openclaw',
        status: 'running',
      },
      broadcaster,
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.eventId).toBe('oc-evt-1');
    }
  });

  it('broadcasts the OpenClaw event', () => {
    ingestRawEvent(
      {
        id: 'oc-evt-2',
        type: 'tool_start',
        sessionId: 'oc-sess-2',
        agentId: 'oc-agent-2',
        timestamp: Date.now(),
        eventSource: 'openclaw',
        toolName: 'Read',
      },
      broadcaster,
    );

    expect(broadcaster.broadcast).toHaveBeenCalledTimes(1);
  });

  it('requires all four fields to be treated as OpenClaw', () => {
    // Missing sessionId — should go through adapter registry instead
    const result = ingestRawEvent(
      {
        id: 'oc-partial',
        type: 'agent_start',
        eventSource: 'openclaw',
        timestamp: Date.now(),
        // no sessionId
      },
      broadcaster,
    );

    // Should still succeed (Claude adapter catches it), but not via OpenClaw path
    // The eventId should NOT be 'oc-partial' since it went through adapter dispatch
    if (result.ok) {
      expect(result.eventId).not.toBe('oc-partial');
    }
  });
});

// ═════════════════════════════════════════════════════════════════════
// 3. ingestRawEvent — Gemini events
// ═════════════════════════════════════════════════════════════════════

describe('ingestRawEvent — Gemini events', () => {
  it('ingests a Gemini BeforeModel event', () => {
    const result = ingestRawEvent(
      {
        hook_event_name: 'BeforeModel',
        session_id: 'gemini-sess-1',
        timestamp: '2026-02-10T14:30:00Z',
        llm_request: {
          model: 'gemini-2.5-pro',
          messages: [{ role: 'user', content: 'Hello' }],
        },
      },
      broadcaster,
    );

    expect(result.ok).toBe(true);
  });

  it('ingests a Gemini AfterTool error event', () => {
    const result = ingestRawEvent(
      {
        hook_event_name: 'AfterTool',
        session_id: 'gemini-sess-2',
        timestamp: '2026-02-10T14:31:00Z',
        tool_name: 'run_shell_command',
        tool_response: { error: 'Tests failed' },
      },
      broadcaster,
    );

    expect(result.ok).toBe(true);
  });
});

// ═════════════════════════════════════════════════════════════════════
// 4. ingestRawEvent — Codex events
// ═════════════════════════════════════════════════════════════════════

describe('ingestRawEvent — Codex events', () => {
  it('ingests a Codex user_message event', () => {
    const result = ingestRawEvent(
      {
        type: 'event_msg',
        session_id: 'cx-sess-1',
        payload: {
          type: 'user_message',
          message: 'Fix the auth bug',
        },
      },
      broadcaster,
    );

    expect(result.ok).toBe(true);
  });

  it('ingests a Codex agent-turn-complete event', () => {
    const result = ingestRawEvent(
      {
        type: 'agent-turn-complete',
        'thread-id': 'cx-sess-2',
        'last-assistant-message': 'Done.',
        codex_source: 'notify',
      },
      broadcaster,
    );

    expect(result.ok).toBe(true);
  });
});

// ═════════════════════════════════════════════════════════════════════
// 5. ingestRawEvent — no adapter match
// ═════════════════════════════════════════════════════════════════════

describe('ingestRawEvent — no adapter match', () => {
  it('returns no_adapter for a completely unrecognized payload shape', () => {
    // The Claude adapter is a catch-all that accepts any payload with hook_event_name
    // or even without it. To get no_adapter, we need a payload that no adapter detects.
    // The Claude adapter detects payloads with hook_event_name OR session_id OR as fallback.
    // Let's try to mock the registry to control this.
    const origDispatch = registry.dispatch.bind(registry);
    vi.spyOn(registry, 'dispatch').mockReturnValueOnce(null);

    const result = ingestRawEvent({ totally: 'unknown' }, broadcaster);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe('no_adapter');
    }

    // Restore
    vi.restoreAllMocks();
  });
});

// ═════════════════════════════════════════════════════════════════════
// 6. ingestRawEvent — deduplication
// ═════════════════════════════════════════════════════════════════════

describe('ingestRawEvent — deduplication', () => {
  it('marks duplicate events within the dedupe window', () => {
    const payload = {
      hook_event_name: 'PreToolUse',
      session_id: 'dedup-sess',
      tool_name: 'Read',
      tool_use_id: 'tu-dedup-1',
    };

    const result1 = ingestRawEvent(payload, broadcaster);
    expect(result1.ok).toBe(true);
    if (result1.ok) {
      expect(result1.deduplicated).toBeUndefined();
    }

    // Second identical event should be deduplicated
    const result2 = ingestRawEvent(payload, broadcaster);
    expect(result2.ok).toBe(true);
    if (result2.ok) {
      expect(result2.deduplicated).toBe(true);
    }
  });

  it('does not broadcast deduplicated events (storeNormalized not called)', () => {
    const payload = {
      hook_event_name: 'PreToolUse',
      session_id: 'dedup-sess-2',
      tool_name: 'Edit',
      tool_use_id: 'tu-dedup-2',
    };

    ingestRawEvent(payload, broadcaster);
    const callsAfterFirst = (broadcaster.broadcast as ReturnType<typeof vi.fn>).mock.calls.length;

    ingestRawEvent(payload, broadcaster);
    const callsAfterSecond = (broadcaster.broadcast as ReturnType<typeof vi.fn>).mock.calls.length;

    // Broadcast should not have been called again for the duplicate
    expect(callsAfterSecond).toBe(callsAfterFirst);
  });
});

// ═════════════════════════════════════════════════════════════════════
// 7. ingestRawEvent — error handling
// ═════════════════════════════════════════════════════════════════════

describe('ingestRawEvent — error handling', () => {
  it('returns error result when registry.dispatch throws', () => {
    vi.spyOn(registry, 'dispatch').mockImplementationOnce(() => {
      throw new Error('Adapter explosion');
    });

    const result = ingestRawEvent(
      { hook_event_name: 'SessionStart', session_id: 'err-sess' },
      broadcaster,
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe('error');
      expect(result.err).toBeInstanceOf(Error);
    }

    vi.restoreAllMocks();
  });

  it('never throws even with unexpected errors', () => {
    vi.spyOn(registry, 'dispatch').mockImplementationOnce(() => {
      throw 'string-error';
    });

    expect(() => {
      const result = ingestRawEvent({ session_id: 'err-2' }, broadcaster);
      expect(result.ok).toBe(false);
    }).not.toThrow();

    vi.restoreAllMocks();
  });
});

// ═════════════════════════════════════════════════════════════════════
// 8. resolveIfSessionAdvanced
// ═════════════════════════════════════════════════════════════════════

describe('resolveIfSessionAdvanced', () => {
  it('does nothing when pending map is empty', () => {
    // Should not throw
    resolveIfSessionAdvanced(
      { hook_event_name: 'PostToolUse', session_id: 'no-pending' },
      broadcaster,
    );

    expect(broadcaster.broadcastRaw).not.toHaveBeenCalled();
  });

  it('resolves pending permission on PostToolUse for matching session', () => {
    const permId = seedPending('resolve-sess-1');

    resolveIfSessionAdvanced(
      { hook_event_name: 'PostToolUse', session_id: 'resolve-sess-1' },
      broadcaster,
    );

    expect(pending.has(permId)).toBe(false);
    expect(broadcaster.broadcastRaw).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'permissionResolved',
        data: expect.objectContaining({ id: permId, behavior: 'allow' }),
      }),
    );
  });

  it('resolves with deny behavior on PostToolUseFailure', () => {
    const permId = seedPending('resolve-sess-2');

    resolveIfSessionAdvanced(
      { hook_event_name: 'PostToolUseFailure', session_id: 'resolve-sess-2' },
      broadcaster,
    );

    expect(pending.has(permId)).toBe(false);
    expect(broadcaster.broadcastRaw).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'permissionResolved',
        data: expect.objectContaining({ id: permId, behavior: 'deny' }),
      }),
    );
  });

  it('resolves with allow behavior on Stop event', () => {
    const permId = seedPending('resolve-sess-3');

    resolveIfSessionAdvanced(
      { hook_event_name: 'Stop', session_id: 'resolve-sess-3' },
      broadcaster,
    );

    expect(pending.has(permId)).toBe(false);
    expect(broadcaster.broadcastRaw).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'permissionResolved',
        data: expect.objectContaining({ id: permId, behavior: 'allow' }),
      }),
    );
  });

  it('does NOT resolve for non-resolve event types', () => {
    const permId = seedPending('resolve-sess-4');

    resolveIfSessionAdvanced(
      { hook_event_name: 'PreToolUse', session_id: 'resolve-sess-4' },
      broadcaster,
    );

    expect(pending.has(permId)).toBe(true);
    expect(broadcaster.broadcastRaw).not.toHaveBeenCalled();
  });

  it('does NOT resolve for non-resolve event: UserPromptSubmit', () => {
    const permId = seedPending('resolve-sess-5');

    resolveIfSessionAdvanced(
      { hook_event_name: 'UserPromptSubmit', session_id: 'resolve-sess-5' },
      broadcaster,
    );

    expect(pending.has(permId)).toBe(true);
  });

  it('does NOT resolve for non-resolve event: SessionStart', () => {
    const permId = seedPending('resolve-sess-6');

    resolveIfSessionAdvanced(
      { hook_event_name: 'SessionStart', session_id: 'resolve-sess-6' },
      broadcaster,
    );

    expect(pending.has(permId)).toBe(true);
  });

  it('does NOT resolve for a different session_id', () => {
    const permId = seedPending('resolve-sess-7');

    resolveIfSessionAdvanced(
      { hook_event_name: 'PostToolUse', session_id: 'different-session' },
      broadcaster,
    );

    expect(pending.has(permId)).toBe(true);
    expect(broadcaster.broadcastRaw).not.toHaveBeenCalled();
  });

  it('does nothing when hook_event_name is missing', () => {
    const permId = seedPending('resolve-sess-8');

    resolveIfSessionAdvanced({ session_id: 'resolve-sess-8' }, broadcaster);

    expect(pending.has(permId)).toBe(true);
  });

  it('does nothing when session_id is missing', () => {
    const permId = seedPending('resolve-sess-9');

    resolveIfSessionAdvanced({ hook_event_name: 'PostToolUse' }, broadcaster);

    expect(pending.has(permId)).toBe(true);
  });

  it('resolves ALL pending permissions for the same session', () => {
    const id1 = seedPending('resolve-multi');
    const id2 = seedPending('resolve-multi');

    resolveIfSessionAdvanced(
      { hook_event_name: 'PostToolUse', session_id: 'resolve-multi' },
      broadcaster,
    );

    expect(pending.has(id1)).toBe(false);
    expect(pending.has(id2)).toBe(false);
    expect(broadcaster.broadcastRaw).toHaveBeenCalledTimes(2);
  });

  it('sends JSON response to the held HTTP request', () => {
    const id = `perm-res-test`;
    const mockRes = makeMockRes();
    pending.set(id, {
      res: mockRes as unknown as Response,
      event: {
        session_id: 'resolve-resp',
        tool_name: 'Bash',
        hook_event_name: 'PermissionRequest',
      },
      timer: setTimeout(() => {}, 999999),
      createdAt: Date.now() - 5000,
    });

    resolveIfSessionAdvanced(
      { hook_event_name: 'PostToolUse', session_id: 'resolve-resp' },
      broadcaster,
    );

    expect(mockRes.json).toHaveBeenCalledWith({
      hookSpecificOutput: {
        hookEventName: 'PermissionRequest',
        decision: { behavior: 'allow' },
      },
    });
  });

  it('handles res.json throwing gracefully (response already closed)', () => {
    const id = `perm-closed`;
    const mockRes = makeMockRes();
    mockRes.json.mockImplementation(() => {
      throw new Error('Response already sent');
    });
    pending.set(id, {
      res: mockRes as unknown as Response,
      event: {
        session_id: 'resolve-closed',
        tool_name: 'Bash',
        hook_event_name: 'PermissionRequest',
      },
      timer: setTimeout(() => {}, 999999),
      createdAt: Date.now() - 5000,
    });

    // Should not throw
    expect(() => {
      resolveIfSessionAdvanced(
        { hook_event_name: 'PostToolUse', session_id: 'resolve-closed' },
        broadcaster,
      );
    }).not.toThrow();

    // Should still remove from pending and broadcast
    expect(pending.has(id)).toBe(false);
    expect(broadcaster.broadcastRaw).toHaveBeenCalled();
  });
});

// ═════════════════════════════════════════════════════════════════════
// 9. ingestRawEvent — integration with resolveIfSessionAdvanced
// ═════════════════════════════════════════════════════════════════════

describe('ingestRawEvent — triggers auto-resolve', () => {
  it('auto-resolves pending permission when PostToolUse is ingested', () => {
    const permId = seedPending('auto-resolve-sess');

    const result = ingestRawEvent(
      {
        hook_event_name: 'PostToolUse',
        session_id: 'auto-resolve-sess',
        tool_name: 'Bash',
        tool_use_id: 'tu-auto',
      },
      broadcaster,
    );

    expect(result.ok).toBe(true);
    expect(pending.has(permId)).toBe(false);
  });

  it('does NOT auto-resolve on PreToolUse ingestion', () => {
    const permId = seedPending('no-auto-resolve');

    ingestRawEvent(
      {
        hook_event_name: 'PreToolUse',
        session_id: 'no-auto-resolve',
        tool_name: 'Read',
        tool_use_id: 'tu-no-auto',
      },
      broadcaster,
    );

    expect(pending.has(permId)).toBe(true);
  });
});

// ═════════════════════════════════════════════════════════════════════
// 10. IngestResult type coverage
// ═════════════════════════════════════════════════════════════════════

describe('IngestResult — return type shapes', () => {
  it('success result has ok=true and eventId', () => {
    const result = ingestRawEvent(
      { hook_event_name: 'SessionStart', session_id: 'shape-1' },
      broadcaster,
    );

    expect(result).toEqual(expect.objectContaining({ ok: true, eventId: expect.any(String) }));
  });

  it('no_adapter result has ok=false and reason', () => {
    vi.spyOn(registry, 'dispatch').mockReturnValueOnce(null);

    const result = ingestRawEvent({ unknown: true }, broadcaster);

    expect(result).toEqual({ ok: false, reason: 'no_adapter' });

    vi.restoreAllMocks();
  });

  it('error result has ok=false, reason=error, and err', () => {
    const testError = new Error('test');
    vi.spyOn(registry, 'dispatch').mockImplementationOnce(() => {
      throw testError;
    });

    const result = ingestRawEvent({ session_id: 'shape-3' }, broadcaster);

    expect(result).toEqual({ ok: false, reason: 'error', err: testError });

    vi.restoreAllMocks();
  });
});
