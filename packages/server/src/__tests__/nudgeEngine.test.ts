// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Synapse Contributors

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
import { checkNudges, updateEventBuffer, getSessionAccumulator } from '../services/nudgeEngine.js';
import { registerAllRules } from '../services/rules/index.js';
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
  registerAllRules();
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
// 3. updateEventBuffer handles many events without errors
// ═════════════════════════════════════════════════════════════════════

describe('updateEventBuffer handles many events', () => {
  it('handles 25 events without errors', () => {
    const sessionId = 'buffer-cap-session-' + Date.now();

    for (let i = 0; i < 25; i++) {
      expect(() =>
        updateEventBuffer(makeEvent({
          sessionId,
          toolName: 'Read',
          toolInput: { file_path: `/test/file-${i}.ts` },
        })),
      ).not.toThrow();
    }

    const event = makeEvent({ type: 'tool_start', sessionId });
    expect(() => checkNudges(event, broadcaster)).not.toThrow();
  });

  it('handles 50 events for the same session without unbounded growth', () => {
    const sessionId = 'buffer-large-session-' + Date.now();

    for (let i = 0; i < 50; i++) {
      updateEventBuffer(makeEvent({ sessionId }));
    }

    const event = makeEvent({ type: 'tool_start', sessionId });
    expect(() => checkNudges(event, broadcaster)).not.toThrow();
  });
});

// ═════════════════════════════════════════════════════════════════════
// 4. Bash-streak detector fires on 3+ consecutive Bash file-op calls
// ═════════════════════════════════════════════════════════════════════

describe('Bash-streak detector', () => {
  it('fires a nudge when 3+ consecutive Bash file-op calls are detected', () => {
    const sessionId = 'bash-streak-' + Date.now();

    // Push Bash file-op tool_start AND tool_end events (accumulator tracks on both)
    for (let i = 0; i < 4; i++) {
      const startEvent = makeEvent({
        sessionId,
        type: 'tool_start',
        toolName: 'Bash',
        toolInput: { command: `cat /path/to/file-${i}.ts` },
      });
      updateEventBuffer(startEvent);
      checkNudges(startEvent, broadcaster);

      const endEvent = makeEvent({
        sessionId,
        type: 'tool_end',
        toolName: 'Bash',
        toolInput: { command: `cat /path/to/file-${i}.ts` },
        status: 'success',
      });
      updateEventBuffer(endEvent);
      checkNudges(endEvent, broadcaster);
    }

    // Should have at least one bash-related nudge
    const bashNudge = broadcaster.nudges.find(n =>
      n.detectorId === 'tool.bash-streak' || n.detectorId === 'tool.bash-file-ops',
    );
    expect(bashNudge).toBeDefined();
    expect(bashNudge!.severity).toBe('suggestion');
  });

  it('does not fire when Bash commands are not file operations', () => {
    const sessionId = 'bash-no-streak-' + Date.now();

    for (let i = 0; i < 5; i++) {
      const event = makeEvent({
        sessionId,
        type: 'tool_start',
        toolName: 'Bash',
        toolInput: { command: `npm install package-${i}` },
      });
      updateEventBuffer(event);
      checkNudges(event, broadcaster);
    }

    const bashNudge = broadcaster.nudges.find(n =>
      n.detectorId === 'tool.bash-streak',
    );
    expect(bashNudge).toBeUndefined();
  });
});

// ═════════════════════════════════════════════════════════════════════
// 5. Error spiral detector fires on 3+ consecutive errors
// ═════════════════════════════════════════════════════════════════════

describe('Error spiral detector', () => {
  it('fires a warning nudge on 3+ consecutive tool errors', () => {
    const sessionId = 'error-spiral-' + Date.now();

    // Seed buffer with some events first
    for (let i = 0; i < 3; i++) {
      updateEventBuffer(makeEvent({ sessionId, type: 'tool_end', toolName: 'Read', status: 'success' }));
    }

    // Now push consecutive errors
    for (let i = 0; i < 4; i++) {
      const event = makeEvent({
        sessionId,
        type: 'tool_error',
        toolName: 'Edit',
        status: 'error',
        error: `Edit failed ${i}`,
      });
      updateEventBuffer(event);
      checkNudges(event, broadcaster);
    }

    const errorNudge = broadcaster.nudges.find(n =>
      n.detectorId === 'verify.error-spiral',
    );
    expect(errorNudge).toBeDefined();
    expect(errorNudge!.severity).toBe('warning');
  });
});

// ═════════════════════════════════════════════════════════════════════
// 6. Edit-without-read fires when editing unread files
// ═════════════════════════════════════════════════════════════════════

describe('Edit-without-read detector', () => {
  it('fires a warning when editing a file that was not read first', () => {
    const sessionId = 'edit-no-read-' + Date.now();

    // Seed buffer
    for (let i = 0; i < 3; i++) {
      updateEventBuffer(makeEvent({ sessionId, type: 'tool_end', toolName: 'Bash', status: 'success' }));
    }

    // Edit a file that was never Read
    const editEvent = makeEvent({
      sessionId,
      type: 'tool_start',
      toolName: 'Edit',
      toolInput: { file_path: '/src/never-read.ts', old_string: 'foo', new_string: 'bar' },
    });
    updateEventBuffer(editEvent);
    checkNudges(editEvent, broadcaster);

    const editNudge = broadcaster.nudges.find(n =>
      n.detectorId === 'tool.edit-without-read',
    );
    expect(editNudge).toBeDefined();
    expect(editNudge!.severity).toBe('warning');
    expect(editNudge!.message).toContain('never-read.ts');
  });

  it('does not fire when the file was read first', () => {
    const sessionId = 'edit-with-read-' + Date.now();

    // Seed buffer
    for (let i = 0; i < 3; i++) {
      updateEventBuffer(makeEvent({ sessionId, type: 'tool_end', toolName: 'Bash', status: 'success' }));
    }

    // Read the file first
    const readEvent = makeEvent({
      sessionId,
      type: 'tool_end',
      toolName: 'Read',
      toolInput: { file_path: '/src/properly-read.ts' },
      status: 'success',
    });
    updateEventBuffer(readEvent);

    // Now edit it
    const editEvent = makeEvent({
      sessionId,
      type: 'tool_start',
      toolName: 'Edit',
      toolInput: { file_path: '/src/properly-read.ts', old_string: 'foo', new_string: 'bar' },
    });
    updateEventBuffer(editEvent);
    checkNudges(editEvent, broadcaster);

    const editNudge = broadcaster.nudges.find(n =>
      n.detectorId === 'tool.edit-without-read',
    );
    expect(editNudge).toBeUndefined();
  });
});

// ═════════════════════════════════════════════════════════════════════
// 7. Cooldown prevents duplicate nudges
// ═════════════════════════════════════════════════════════════════════

describe('Cooldown prevents duplicate nudges', () => {
  it('does not fire the same detector twice within the cooldown window', () => {
    const sessionId = 'cooldown-test-' + Date.now();

    // Push bash file-op events
    for (let i = 0; i < 5; i++) {
      const event = makeEvent({
        sessionId,
        type: 'tool_start',
        toolName: 'Bash',
        toolInput: { command: `cat /path/file-${i}.ts` },
      });
      updateEventBuffer(event);
      checkNudges(event, broadcaster);
    }

    const firstCount = broadcaster.nudges.filter(n =>
      n.detectorId === 'tool.bash-file-ops',
    ).length;

    // Push more events to try to trigger again
    for (let i = 0; i < 5; i++) {
      const event = makeEvent({
        sessionId,
        type: 'tool_start',
        toolName: 'Bash',
        toolInput: { command: `tail -50 /path/another-${i}.ts` },
      });
      updateEventBuffer(event);
      checkNudges(event, broadcaster);
    }

    const totalNudges = broadcaster.nudges.filter(n =>
      n.detectorId === 'tool.bash-file-ops',
    ).length;

    // Should only fire once due to cooldown
    expect(totalNudges).toBe(firstCount);
  });
});

// ═════════════════════════════════════════════════════════════════════
// 8. Conversation mode detection
// ═════════════════════════════════════════════════════════════════════

describe('Conversation mode detection', () => {
  it('recentPromptTexts maintains a sliding window of last 3', () => {
    const sessionId = 'conv-window-' + Date.now();
    const now = Date.now();

    for (let i = 0; i < 4; i++) {
      updateEventBuffer(makeEvent({
        sessionId,
        type: 'user_prompt',
        toolName: undefined,
        text: `Prompt number ${i + 1}`,
        timestamp: now + i * 30_000,
      }));
    }

    const acc = getSessionAccumulator(sessionId);
    expect(acc).toBeDefined();
    expect(acc!.recentPromptTexts).toHaveLength(3);
    expect(acc!.recentPromptTexts[0]).toBe('Prompt number 2');
    expect(acc!.recentPromptTexts[1]).toBe('Prompt number 3');
    expect(acc!.recentPromptTexts[2]).toBe('Prompt number 4');
  });

  it('sessionGoalSummary extracts first sentence from first prompt', () => {
    const sessionId = 'conv-goal-' + Date.now();

    updateEventBuffer(makeEvent({
      sessionId,
      type: 'user_prompt',
      toolName: undefined,
      text: 'Refactor the auth module. Make it cleaner and more maintainable.',
      timestamp: Date.now(),
    }));

    const acc = getSessionAccumulator(sessionId);
    expect(acc!.sessionGoalSummary).toBe('Refactor the auth module.');

    // Second prompt should NOT update the goal
    updateEventBuffer(makeEvent({
      sessionId,
      type: 'user_prompt',
      toolName: undefined,
      text: 'Also add tests for it.',
      timestamp: Date.now() + 10_000,
    }));

    const acc2 = getSessionAccumulator(sessionId);
    expect(acc2!.sessionGoalSummary).toBe('Refactor the auth module.');
  });

  it('conversationMode activates with rapid short prompts', () => {
    const sessionId = 'conv-active-' + Date.now();
    const now = Date.now();

    // 3 short prompts 30 seconds apart
    const shortTexts = ['Fix the header', 'Make it blue', 'Add padding'];
    for (let i = 0; i < shortTexts.length; i++) {
      updateEventBuffer(makeEvent({
        sessionId,
        type: 'user_prompt',
        toolName: undefined,
        text: shortTexts[i],
        timestamp: now + i * 30_000,
      }));
    }

    const acc = getSessionAccumulator(sessionId);
    expect(acc!.conversationMode).toBe(true);
  });

  it('conversationMode stays false when early prompts are long despite recent short ones', () => {
    const sessionId = 'conv-mixed-' + Date.now();
    const now = Date.now();

    // 1 long prompt, then 2 short ones — the long one is within the last 3
    updateEventBuffer(makeEvent({
      sessionId,
      type: 'user_prompt',
      toolName: undefined,
      text: 'Refactor the entire authentication system with JWT tokens refresh flow middleware guards and update the database schema migrations',
      timestamp: now,
    }));
    updateEventBuffer(makeEvent({
      sessionId,
      type: 'user_prompt',
      toolName: undefined,
      text: 'Make it blue',
      timestamp: now + 30_000,
    }));
    updateEventBuffer(makeEvent({
      sessionId,
      type: 'user_prompt',
      toolName: undefined,
      text: 'Add padding',
      timestamp: now + 60_000,
    }));

    const acc = getSessionAccumulator(sessionId);
    // Long prompt in the last-3 window means NOT conversational
    expect(acc!.conversationMode).toBe(false);
  });

  it('conversationMode stays false for spaced-out prompts', () => {
    const sessionId = 'conv-spaced-' + Date.now();
    const now = Date.now();

    // 3 short prompts 5 minutes apart
    for (let i = 0; i < 3; i++) {
      updateEventBuffer(makeEvent({
        sessionId,
        type: 'user_prompt',
        toolName: undefined,
        text: `Short prompt ${i}`,
        timestamp: now + i * 5 * 60_000,
      }));
    }

    const acc = getSessionAccumulator(sessionId);
    expect(acc!.conversationMode).toBe(false);
  });

  it('vague-prompt rule is suppressed in conversation mode for moderate prompts', () => {
    const sessionId = 'conv-vague-suppressed-' + Date.now();
    const now = Date.now();

    // Seed with enough events for minEvents threshold
    for (let i = 0; i < 6; i++) {
      updateEventBuffer(makeEvent({ sessionId, type: 'tool_end', toolName: 'Read', status: 'success', timestamp: now + i * 1000 }));
    }

    // First prompt to set up patternState (short, rapid)
    const prompt1 = makeEvent({
      sessionId,
      type: 'user_prompt',
      toolName: undefined,
      text: 'Build a settings page',
      timestamp: now + 10_000,
    });
    updateEventBuffer(prompt1);
    checkNudges(prompt1, broadcaster);

    // Simulate large output from the first prompt
    for (let i = 0; i < 3; i++) {
      updateEventBuffer(makeEvent({
        sessionId,
        type: 'tool_end',
        toolName: 'Edit',
        status: 'success',
        timestamp: now + 20_000 + i * 1000,
        tokenUsage: { input: 500, output: 1000, cacheRead: 0, cacheCreation: 0 },
      }));
    }

    // Second short prompt 30s later — in conversation mode, 4 words should NOT trigger vague-prompt
    const prompt2 = makeEvent({
      sessionId,
      type: 'user_prompt',
      toolName: undefined,
      text: 'Make it black',
      timestamp: now + 40_000,
    });
    updateEventBuffer(prompt2);
    broadcaster.clearNudges();
    checkNudges(prompt2, broadcaster);

    const vagueNudge = broadcaster.nudges.find(n => n.detectorId === 'plan.vague-prompt');
    expect(vagueNudge).toBeUndefined();
  });

  it('rapid-prompts rule is suppressed in conversation mode', () => {
    const sessionId = 'conv-rapid-suppressed-' + Date.now();
    const now = Date.now();

    // 4 rapid short prompts — triggers conversationMode
    const shortTexts = ['Fix header', 'Add border', 'Make blue', 'Add shadow'];
    for (let i = 0; i < shortTexts.length; i++) {
      const event = makeEvent({
        sessionId,
        type: 'user_prompt',
        toolName: undefined,
        text: shortTexts[i],
        timestamp: now + i * 20_000,
      });
      updateEventBuffer(event);
      checkNudges(event, broadcaster);
    }

    const rapidNudge = broadcaster.nudges.find(n => n.detectorId === 'plan.rapid-prompts');
    expect(rapidNudge).toBeUndefined();
  });

  it('rapid-prompts rule fires without conversation mode (long prompts)', () => {
    const sessionId = 'conv-rapid-fires-' + Date.now();
    const now = Date.now();

    // 4 rapid LONG prompts — avg words > 15 so conversationMode stays false
    const longTexts = [
      'I need you to refactor the entire authentication module to use JWT tokens instead of session cookies for all endpoints',
      'Please also update the middleware to validate the token signature and check expiration on every protected route',
      'Add comprehensive error handling for expired tokens and invalid signatures with proper HTTP status codes returned',
      'Finally write integration tests covering all the edge cases including token refresh flow and concurrent requests',
    ];
    for (let i = 0; i < longTexts.length; i++) {
      const event = makeEvent({
        sessionId,
        type: 'user_prompt',
        toolName: undefined,
        text: longTexts[i],
        timestamp: now + i * 20_000,
      });
      updateEventBuffer(event);
      checkNudges(event, broadcaster);
    }

    const rapidNudge = broadcaster.nudges.find(n => n.detectorId === 'plan.rapid-prompts');
    expect(rapidNudge).toBeDefined();
  });
});
