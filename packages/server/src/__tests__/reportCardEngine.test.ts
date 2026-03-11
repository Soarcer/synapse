// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Bernhard

// Set DB path BEFORE any server imports
import path from 'path';
import os from 'os';
process.env.SYNAPSE_DB_PATH = path.join(
  os.tmpdir(),
  'synapse-test-reportcard-' + Date.now() + '.db',
);

import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { initDb, deleteAllEvents, insertEvent } from '../db.js';
import {
  buildSessionContext,
  computeReportCard,
  getReportCardHistory,
} from '../services/reportCardEngine.js';

// ─── Setup ──────────────────────────────────────────────────────────

beforeAll(async () => {
  await initDb();
});

afterEach(() => {
  deleteAllEvents();
});

// ─── Helpers ────────────────────────────────────────────────────────

let eventSeq = 0;
let sessionSeq = 0;

/** Generate a unique session ID per test to avoid the 60-second context cache. */
function uniqueSessionId(prefix = 'sess'): string {
  return `${prefix}-${++sessionSeq}-${Date.now()}`;
}

function makeEvent(
  sessionId: string,
  overrides: Partial<{
    event_type: string;
    tool_name: string;
    tool_input: string;
    tool_response: string;
    status: string;
    token_input: number;
    token_output: number;
    raw_payload: string;
    model: string;
    agent_type: string;
    hook_event_name: string;
    created_at: number;
  }>,
): void {
  const seq = ++eventSeq;
  insertEvent({
    event_id: `evt-${seq}`,
    session_id: sessionId,
    hook_event_name: overrides.hook_event_name ?? 'Tool',
    event_type: overrides.event_type ?? 'tool_call',
    agent_id: null,
    agent_type: overrides.agent_type ?? null,
    parent_agent_id: null,
    tool_name: overrides.tool_name ?? null,
    tool_use_id: null,
    tool_input: overrides.tool_input ?? null,
    tool_response: overrides.tool_response ?? null,
    status: overrides.status ?? null,
    error: null,
    token_input: overrides.token_input ?? null,
    token_output: overrides.token_output ?? null,
    duration_ms: null,
    model: overrides.model ?? null,
    vendor: null,
    cwd: '/test',
    raw_payload: overrides.raw_payload ?? '{}',
    created_at: overrides.created_at ?? Date.now() + seq,
  });
}

// ═══════════════════════════════════════════════════════════════════════
// buildSessionContext
// ═══════════════════════════════════════════════════════════════════════

describe('buildSessionContext', () => {
  it('returns empty context for a session with no events', () => {
    const ctx = buildSessionContext(uniqueSessionId());
    expect(ctx.eventCount).toBe(0);
    expect(ctx.promptTexts).toEqual([]);
    expect(ctx.toolCounts.size).toBe(0);
  });

  it('counts tools correctly', () => {
    const sid = uniqueSessionId();
    makeEvent(sid, { tool_name: 'Read', tool_input: JSON.stringify({ file_path: '/a.ts' }) });
    makeEvent(sid, { tool_name: 'Read', tool_input: JSON.stringify({ file_path: '/b.ts' }) });
    makeEvent(sid, { tool_name: 'Edit', tool_input: JSON.stringify({ file_path: '/a.ts' }) });
    makeEvent(sid, { tool_name: 'Bash', tool_input: JSON.stringify({ command: 'npm test' }) });

    const ctx = buildSessionContext(sid);
    expect(ctx.toolCounts.get('Read')).toBe(2);
    expect(ctx.toolCounts.get('Edit')).toBe(1);
    expect(ctx.toolCounts.get('Bash')).toBe(1);
    expect(ctx.eventCount).toBe(4);
  });

  it('tracks read-before-edit patterns', () => {
    const sid = uniqueSessionId();
    const now = Date.now();
    makeEvent(sid, {
      tool_name: 'Read',
      tool_input: JSON.stringify({ file_path: '/foo.ts' }),
      created_at: now + 1,
    });
    makeEvent(sid, {
      tool_name: 'Edit',
      tool_input: JSON.stringify({ file_path: '/foo.ts' }),
      created_at: now + 2,
    });
    makeEvent(sid, {
      tool_name: 'Edit',
      tool_input: JSON.stringify({ file_path: '/bar.ts' }),
      created_at: now + 3,
    });

    const ctx = buildSessionContext(sid);
    expect(ctx.readBeforeEditFiles.has('/foo.ts')).toBe(true);
    expect(ctx.editWithoutReadFiles.has('/bar.ts')).toBe(true);
    expect(ctx.distinctFilesEdited.size).toBe(2);
  });

  it('detects bash file operations', () => {
    const sid = uniqueSessionId();
    makeEvent(sid, { tool_name: 'Bash', tool_input: JSON.stringify({ command: 'cat /foo.ts' }) });
    makeEvent(sid, {
      tool_name: 'Bash',
      tool_input: JSON.stringify({ command: 'grep -r "import"' }),
    });
    makeEvent(sid, { tool_name: 'Bash', tool_input: JSON.stringify({ command: 'npm test' }) });

    const ctx = buildSessionContext(sid);
    expect(ctx.bashFileOps).toBe(2);
  });

  it('extracts prompts from raw_payload', () => {
    const sid = uniqueSessionId();
    makeEvent(sid, {
      event_type: 'user_prompt',
      raw_payload: JSON.stringify({ prompt: 'Fix the bug in auth.ts' }),
    });
    makeEvent(sid, {
      event_type: 'user_prompt',
      raw_payload: JSON.stringify({ prompt: 'Now run the tests' }),
    });

    const ctx = buildSessionContext(sid);
    expect(ctx.promptTexts).toEqual(['Fix the bug in auth.ts', 'Now run the tests']);
  });

  it('counts compactions', () => {
    const sid = uniqueSessionId();
    makeEvent(sid, { event_type: 'compact' });
    makeEvent(sid, { event_type: 'compact' });

    const ctx = buildSessionContext(sid);
    expect(ctx.compactionCount).toBe(2);
  });

  it('tracks tokens', () => {
    const sid = uniqueSessionId();
    makeEvent(sid, { token_input: 1000, token_output: 500 });
    makeEvent(sid, { token_input: 2000, token_output: 1500 });

    const ctx = buildSessionContext(sid);
    expect(ctx.totalInputTokens).toBe(3000);
    expect(ctx.totalOutputTokens).toBe(2000);
  });
});

// ═══════════════════════════════════════════════════════════════════════
// computeReportCard
// ═══════════════════════════════════════════════════════════════════════

describe('computeReportCard', () => {
  it('returns a valid report card for a minimal session', () => {
    const sid = uniqueSessionId();
    const now = Date.now();
    makeEvent(sid, {
      event_type: 'session_start',
      model: 'claude-sonnet-4-5',
      raw_payload: '{}',
      created_at: now,
    });
    makeEvent(sid, {
      event_type: 'user_prompt',
      raw_payload: JSON.stringify({
        prompt: 'Fix the auth bug in src/auth.ts. Ensure tests pass.',
      }),
      created_at: now + 1,
    });
    makeEvent(sid, {
      tool_name: 'Read',
      tool_input: JSON.stringify({ file_path: '/src/auth.ts' }),
      created_at: now + 10,
    });
    makeEvent(sid, {
      tool_name: 'Edit',
      tool_input: JSON.stringify({ file_path: '/src/auth.ts' }),
      created_at: now + 20,
    });

    const card = computeReportCard(sid);

    expect(card.sessionId).toBe(sid);
    expect(card.overallScore).toBeGreaterThanOrEqual(0);
    expect(card.overallScore).toBeLessThanOrEqual(100);
    expect(card.grade).toBeTruthy();
    expect(card.dimensions.length).toBe(8);
    expect(card.summary).toBeTruthy();
    expect(Array.isArray(card.topStrengths)).toBe(true);
    expect(Array.isArray(card.topImprovements)).toBe(true);
  });

  it('returns cached report card on second call', () => {
    const sid = uniqueSessionId();
    makeEvent(sid, { event_type: 'session_start', raw_payload: '{}' });

    const first = computeReportCard(sid);
    const second = computeReportCard(sid);

    // Both should have same computedAt since second is from cache
    expect(second.computedAt).toBe(first.computedAt);
    expect(second.overallScore).toBe(first.overallScore);
  });

  it('each dimension has valid structure', () => {
    const sid = uniqueSessionId();
    makeEvent(sid, { event_type: 'session_start', raw_payload: '{}' });
    makeEvent(sid, {
      event_type: 'user_prompt',
      raw_payload: JSON.stringify({ prompt: 'Do something' }),
    });

    const card = computeReportCard(sid);

    for (const dim of card.dimensions) {
      expect(dim.dimension).toBeTruthy();
      expect(dim.label).toBeTruthy();
      expect(dim.score).toBeGreaterThanOrEqual(0);
      expect(dim.score).toBeLessThanOrEqual(100);
      expect(dim.recommendation).toBeTruthy();
      expect(Array.isArray(dim.detectors)).toBe(true);
    }
  });

  it('high-quality session gets a higher score', () => {
    const sid = uniqueSessionId();
    const now = Date.now();
    makeEvent(sid, {
      event_type: 'session_start',
      model: 'claude-sonnet-4-5',
      raw_payload: JSON.stringify({ permission_mode: 'acceptEdits' }),
      created_at: now,
    });
    makeEvent(sid, {
      event_type: 'user_prompt',
      raw_payload: JSON.stringify({
        prompt:
          'Fix the validation bug in src/validators.ts. The email regex should reject domains without TLDs. Run tests to verify.',
      }),
      created_at: now + 1,
    });

    // Read → Edit → Test pattern
    makeEvent(sid, {
      tool_name: 'Read',
      tool_input: JSON.stringify({ file_path: '/src/validators.ts' }),
      created_at: now + 10,
    });
    makeEvent(sid, {
      tool_name: 'Read',
      tool_input: JSON.stringify({ file_path: '/src/validators.test.ts' }),
      created_at: now + 20,
    });
    makeEvent(sid, {
      tool_name: 'Edit',
      tool_input: JSON.stringify({ file_path: '/src/validators.ts' }),
      created_at: now + 30,
    });
    makeEvent(sid, {
      tool_name: 'Bash',
      tool_input: JSON.stringify({ command: 'npm test' }),
      created_at: now + 40,
    });

    const card = computeReportCard(sid);

    // A well-structured session should score decently
    expect(card.overallScore).toBeGreaterThan(50);
  });

  it('empty session produces neutral scores', () => {
    const card = computeReportCard(uniqueSessionId());

    // With no events, most detectors return 50 (neutral)
    expect(card.overallScore).toBeGreaterThanOrEqual(40);
    expect(card.overallScore).toBeLessThanOrEqual(80);
  });
});

// ═══════════════════════════════════════════════════════════════════════
// Grade mapping
// ═══════════════════════════════════════════════════════════════════════

describe('grade mapping (via computeReportCard)', () => {
  it('grades are valid grade strings', () => {
    const sid = uniqueSessionId();
    makeEvent(sid, { event_type: 'session_start', raw_payload: '{}' });
    const card = computeReportCard(sid);

    const validGrades = ['A+', 'A', 'A-', 'B+', 'B', 'B-', 'C+', 'C', 'C-', 'D', 'F'];
    expect(validGrades).toContain(card.grade);
  });
});

// ═══════════════════════════════════════════════════════════════════════
// getReportCardHistory
// ═══════════════════════════════════════════════════════════════════════

describe('getReportCardHistory', () => {
  it('returns computed report cards within time range', () => {
    const sid = uniqueSessionId();
    makeEvent(sid, { event_type: 'session_start', raw_payload: '{}' });
    computeReportCard(sid);

    const now = Date.now();
    const cards = getReportCardHistory(now - 60_000, now + 60_000);

    // At least the card we just computed should be present
    const found = cards.find((c) => c.sessionId === sid);
    expect(found).toBeDefined();
    expect(found!.grade).toBeTruthy();
    expect(found!.dimensions.length).toBe(8);
  });

  it('excludes report cards outside time range', () => {
    const sid = uniqueSessionId();
    makeEvent(sid, { event_type: 'session_start', raw_payload: '{}' });
    computeReportCard(sid);

    // Query a time range far in the past
    const cards = getReportCardHistory(0, 1000);
    expect(cards.length).toBe(0);
  });
});
