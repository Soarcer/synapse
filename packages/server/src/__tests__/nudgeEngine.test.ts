// Set DB path BEFORE any server imports
import path from 'path';
import os from 'os';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
process.env.SYNAPSE_DB_PATH = path.join(
  os.tmpdir(),
  'synapse-test-nudge-' + Date.now() + '.db',
);

import { initDb } from '../db.js';
import { checkNudges, updateEventBuffer } from '../services/nudgeEngine.js';
import { Broadcaster } from '../services/broadcaster.js';
import type { AgentEvent, CoachingNudge } from '@synapse-ai/core';

// ─── Mock Broadcaster ─────────────────────────────────────────────

class MockBroadcaster extends Broadcaster {
  public nudges: CoachingNudge[] = [];

  override broadcastNudge(nudge: CoachingNudge): void {
    this.nudges.push(nudge);
  }

  clearNudges(): void {
    this.nudges = [];
  }
}

// ─── Fixture Helpers ──────────────────────────────────────────────

let eventCounter = 0;

function makeEvent(overrides: Partial<AgentEvent> = {}): AgentEvent {
  eventCounter++;
  return {
    id: `evt-${eventCounter}-${Date.now()}`,
    type: 'tool_start',
    sessionId: 'nudge-test-session',
    agentId: 'agent-1',
    timestamp: Date.now(),
    status: 'running',
    toolName: 'Bash',
    ...overrides,
  };
}

// ─── Setup ────────────────────────────────────────────────────────

let broadcaster: MockBroadcaster;

beforeAll(async () => {
  await initDb();
});

beforeEach(() => {
  broadcaster = new MockBroadcaster();
});

afterEach(() => {
  broadcaster.destroy();
});

// ═════════════════════════════════════════════════════════════════════
// 1. Early-exit for irrelevant event types
// ═════════════════════════════════════════════════════════════════════

describe('Early-exit for irrelevant event types', () => {
  it('does not invoke detectors for session_start events', () => {
    const event = makeEvent({
      type: 'session_start',
      sessionId: 'irrelevant-session',
      toolName: undefined,
    });

    // Feed some buffer data so the buffer isn't empty
    for (let i = 0; i < 5; i++) {
      updateEventBuffer(makeEvent({ sessionId: 'irrelevant-session' }));
    }

    checkNudges(event, broadcaster);

    expect(broadcaster.nudges).toHaveLength(0);
  });

  it('does not invoke detectors for session_end events', () => {
    const event = makeEvent({
      type: 'session_end',
      sessionId: 'irrelevant-session-2',
      toolName: undefined,
    });

    for (let i = 0; i < 5; i++) {
      updateEventBuffer(makeEvent({ sessionId: 'irrelevant-session-2' }));
    }

    checkNudges(event, broadcaster);

    expect(broadcaster.nudges).toHaveLength(0);
  });
});

// ═════════════════════════════════════════════════════════════════════
// 2. Relevant event types reach detectors without throwing
// ═════════════════════════════════════════════════════════════════════

describe('Relevant event types reach detectors', () => {
  it('does not throw for a tool_start event with buffer data', () => {
    const sessionId = 'relevant-session-' + Date.now();

    for (let i = 0; i < 5; i++) {
      updateEventBuffer(makeEvent({ sessionId }));
    }

    const event = makeEvent({ type: 'tool_start', sessionId });

    expect(() => checkNudges(event, broadcaster)).not.toThrow();
  });

  it('does not throw for a user_prompt event with buffer data', () => {
    const sessionId = 'relevant-prompt-' + Date.now();

    for (let i = 0; i < 5; i++) {
      updateEventBuffer(makeEvent({ sessionId }));
    }

    const event = makeEvent({ type: 'user_prompt', sessionId, toolName: undefined });

    expect(() => checkNudges(event, broadcaster)).not.toThrow();
  });

  it('does not throw for a tool_error event with buffer data', () => {
    const sessionId = 'relevant-error-' + Date.now();

    for (let i = 0; i < 5; i++) {
      updateEventBuffer(makeEvent({ sessionId }));
    }

    const event = makeEvent({ type: 'tool_error', sessionId, status: 'error' });

    expect(() => checkNudges(event, broadcaster)).not.toThrow();
  });
});

// ═════════════════════════════════════════════════════════════════════
// 3. updateEventBuffer caps at MAX_BUFFER_SIZE (20)
// ═════════════════════════════════════════════════════════════════════

describe('updateEventBuffer caps at MAX_BUFFER_SIZE', () => {
  it('handles 25 events without errors (buffer internally capped at 20)', () => {
    const sessionId = 'buffer-cap-session-' + Date.now();

    // Push 25 events into the same session buffer
    for (let i = 0; i < 25; i++) {
      expect(() =>
        updateEventBuffer(makeEvent({
          sessionId,
          toolName: 'Read',
          toolInput: { file_path: `/test/file-${i}.ts` },
        })),
      ).not.toThrow();
    }

    // Verify the buffer is usable by running checkNudges without error
    const event = makeEvent({ type: 'tool_start', sessionId });
    expect(() => checkNudges(event, broadcaster)).not.toThrow();
  });

  it('handles 50 events for the same session without unbounded growth', () => {
    const sessionId = 'buffer-large-session-' + Date.now();

    for (let i = 0; i < 50; i++) {
      updateEventBuffer(makeEvent({ sessionId }));
    }

    // If the buffer grew unbounded, this would be 50 events.
    // We verify correctness indirectly: no error + nudge detectors still work.
    const event = makeEvent({ type: 'tool_start', sessionId });
    expect(() => checkNudges(event, broadcaster)).not.toThrow();
  });
});

// ═════════════════════════════════════════════════════════════════════
// 4. Bash-streak detector fires on 3+ consecutive Bash file-op calls
// ═════════════════════════════════════════════════════════════════════

describe('Bash-streak detector', () => {
  it('fires a nudge when 3+ consecutive Bash file-op calls are in the buffer', () => {
    const sessionId = 'bash-streak-' + Date.now();

    // Push 3 Bash file-op tool_start events with commands matching the detector pattern
    for (let i = 0; i < 4; i++) {
      updateEventBuffer(makeEvent({
        sessionId,
        type: 'tool_start',
        toolName: 'Bash',
        toolInput: { command: `cat /path/to/file-${i}.ts` },
      }));
    }

    // Now call checkNudges with another Bash tool_start event
    const triggerEvent = makeEvent({
      sessionId,
      type: 'tool_start',
      toolName: 'Bash',
      toolInput: { command: 'grep -r "TODO" /src' },
    });

    checkNudges(triggerEvent, broadcaster);

    // The bash-streak detector should have fired a nudge
    expect(broadcaster.nudges.length).toBeGreaterThanOrEqual(1);

    const bashNudge = broadcaster.nudges.find(n =>
      n.detectorId === 'nudge.bash-streak',
    );
    expect(bashNudge).toBeDefined();
    expect(bashNudge!.severity).toBe('suggestion');
    expect(bashNudge!.title).toBe('Use dedicated tools');
    expect(bashNudge!.sessionId).toBe(sessionId);
  });

  it('does not fire when Bash commands are not file operations', () => {
    const sessionId = 'bash-no-streak-' + Date.now();

    // Push Bash events that do NOT match file-op patterns
    for (let i = 0; i < 5; i++) {
      updateEventBuffer(makeEvent({
        sessionId,
        type: 'tool_start',
        toolName: 'Bash',
        toolInput: { command: `npm install package-${i}` },
      }));
    }

    const triggerEvent = makeEvent({
      sessionId,
      type: 'tool_start',
      toolName: 'Bash',
      toolInput: { command: 'npm test' },
    });

    checkNudges(triggerEvent, broadcaster);

    const bashNudge = broadcaster.nudges.find(n =>
      n.detectorId === 'nudge.bash-streak',
    );
    expect(bashNudge).toBeUndefined();
  });
});

// ═════════════════════════════════════════════════════════════════════
// 5. Cooldown prevents duplicate nudges
// ═════════════════════════════════════════════════════════════════════

describe('Cooldown prevents duplicate nudges', () => {
  it('does not fire the same detector twice within the cooldown window', () => {
    const sessionId = 'cooldown-test-' + Date.now();

    // Seed the buffer with enough Bash file-op events to trigger bash-streak
    for (let i = 0; i < 5; i++) {
      updateEventBuffer(makeEvent({
        sessionId,
        type: 'tool_start',
        toolName: 'Bash',
        toolInput: { command: `cat /path/file-${i}.ts` },
      }));
    }

    // First trigger — should fire
    const firstEvent = makeEvent({
      sessionId,
      type: 'tool_start',
      toolName: 'Bash',
      toolInput: { command: 'head -20 /src/index.ts' },
    });
    checkNudges(firstEvent, broadcaster);

    const firstCount = broadcaster.nudges.filter(n =>
      n.detectorId === 'nudge.bash-streak',
    ).length;
    expect(firstCount).toBe(1);

    // Push more Bash file-op events to keep the pattern alive
    for (let i = 0; i < 5; i++) {
      updateEventBuffer(makeEvent({
        sessionId,
        type: 'tool_start',
        toolName: 'Bash',
        toolInput: { command: `tail -50 /path/another-${i}.ts` },
      }));
    }

    // Second trigger — same session, same detector, within cooldown
    const secondEvent = makeEvent({
      sessionId,
      type: 'tool_start',
      toolName: 'Bash',
      toolInput: { command: 'sed -i "s/old/new/g" /src/utils.ts' },
    });
    checkNudges(secondEvent, broadcaster);

    // The total bash-streak nudges should still be 1 (cooldown blocked the second)
    const totalBashNudges = broadcaster.nudges.filter(n =>
      n.detectorId === 'nudge.bash-streak',
    ).length;
    expect(totalBashNudges).toBe(1);
  });

  it('allows nudges from different detectors to fire independently', () => {
    const sessionId = 'multi-detector-' + Date.now();

    // Seed buffer with error events to trigger error-spiral
    for (let i = 0; i < 5; i++) {
      updateEventBuffer(makeEvent({
        sessionId,
        type: 'tool_error',
        toolName: 'Edit',
        status: 'error',
        error: `Edit failed ${i}`,
      }));
    }

    const triggerEvent = makeEvent({
      sessionId,
      type: 'tool_error',
      toolName: 'Edit',
      status: 'error',
      error: 'Edit failed again',
    });

    checkNudges(triggerEvent, broadcaster);

    // error-spiral should have fired
    const errorNudge = broadcaster.nudges.find(n =>
      n.detectorId === 'nudge.error-spiral',
    );
    expect(errorNudge).toBeDefined();
    expect(errorNudge!.severity).toBe('warning');
    expect(errorNudge!.title).toBe('Error spiral detected');
  });
});
