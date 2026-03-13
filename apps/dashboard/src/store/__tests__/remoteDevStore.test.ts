// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Bernhard

// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../utils/api', () => ({
  apiUrl: (path: string) => path,
}));

import { useRemoteDevStore } from '../remoteDevStore';

const initialState = useRemoteDevStore.getState();

function resetStore() {
  useRemoteDevStore.setState({
    ...initialState,
    messages: [],
    pendingQuestion: null,
    quickActions: [],
    status: 'idle',
  });
}

beforeEach(() => resetStore());

// ── receiveQuestion ──────────────────────────────────────────

describe('receiveQuestion', () => {
  const makeQuestion = (questionText: string, options: string[] = []) => ({
    id: 'perm-1',
    tool_name: 'AskUserQuestion',
    tool_input_preview: questionText.slice(0, 200),
    tool_input_raw: {
      questions: [
        {
          question: questionText,
          header: 'Remote',
          options: options.map((label) => ({ label, description: '' })),
        },
      ],
      metadata: { source: 'remote-dev' },
    },
    createdAt: 1000,
    expiresAt: 1000 + 30 * 60_000,
  });

  it('parses question with separator into claude message + waiting state', () => {
    const store = useRemoteDevStore.getState();
    store.receiveQuestion(
      makeQuestion("Added sticky header. Tests pass.\n===NEXT===\nWhat's next?"),
    );

    const s = useRemoteDevStore.getState();
    expect(s.status).toBe('waiting');
    expect(s.pendingQuestion?.id).toBe('perm-1');
    expect(s.messages).toHaveLength(1);
    expect(s.messages[0].role).toBe('claude');
    expect(s.messages[0].text).toBe('Added sticky header. Tests pass.');
  });

  it('handles question without separator (first iteration)', () => {
    const store = useRemoteDevStore.getState();
    store.receiveQuestion(makeQuestion("What's next?"));

    const s = useRemoteDevStore.getState();
    expect(s.status).toBe('waiting');
    expect(s.messages).toHaveLength(0); // No status text = no claude message
  });

  it('extracts quick actions from options', () => {
    const store = useRemoteDevStore.getState();
    store.receiveQuestion(
      makeQuestion("Done.\n===NEXT===\nWhat's next?", ['Run tests', 'Build', 'Commit']),
    );

    expect(useRemoteDevStore.getState().quickActions).toEqual(['Run tests', 'Build', 'Commit']);
  });

  it('detects error in status text', () => {
    const store = useRemoteDevStore.getState();
    store.receiveQuestion(makeQuestion("Build failed with 3 errors.\n===NEXT===\nWhat's next?"));

    const msg = useRemoteDevStore.getState().messages[0];
    expect(msg.isError).toBe(true);
  });

  it('replaces previous pending question (race guard)', () => {
    const store = useRemoteDevStore.getState();
    store.receiveQuestion(makeQuestion("First.\n===NEXT===\nWhat's next?"));
    store.receiveQuestion({
      ...makeQuestion("Second.\n===NEXT===\nWhat's next?"),
      id: 'perm-2',
    });

    const s = useRemoteDevStore.getState();
    expect(s.pendingQuestion?.id).toBe('perm-2');
    expect(s.messages).toHaveLength(2); // Both claude messages kept in history
  });
});

// ── sendAnswer ───────────────────────────────────────────────

describe('sendAnswer', () => {
  const makeQuestion = (questionText: string) => ({
    id: 'perm-1',
    tool_name: 'AskUserQuestion',
    tool_input_preview: questionText.slice(0, 200),
    tool_input_raw: {
      questions: [{ question: questionText, header: 'Remote', options: [] }],
      metadata: { source: 'remote-dev' },
    },
    createdAt: 1000,
    expiresAt: 1000 + 30 * 60_000,
  });

  it('sends answer and transitions to working', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({ ok: true, status: 200 });

    const store = useRemoteDevStore.getState();
    store.receiveQuestion(makeQuestion("What's next?"));
    await store.sendAnswer('make it blue');

    const s = useRemoteDevStore.getState();
    expect(s.status).toBe('working');
    expect(s.messages.at(-1)?.role).toBe('user');
    expect(s.messages.at(-1)?.text).toBe('make it blue');
    expect(globalThis.fetch).toHaveBeenCalledWith(
      '/api/permissions/perm-1/decision',
      expect.objectContaining({ method: 'PUT' }),
    );
  });

  it('reverts to waiting on network error', async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new Error('Network error'));

    const store = useRemoteDevStore.getState();
    store.receiveQuestion(makeQuestion("What's next?"));
    await store.sendAnswer('make it blue');

    const s = useRemoteDevStore.getState();
    expect(s.status).toBe('waiting');
    expect(s.messages.at(-1)?.isError).toBe(true);
    expect(s.messages.at(-1)?.text).toContain('failed to send');
  });

  it('does nothing if no pending question', async () => {
    globalThis.fetch = vi.fn();
    await useRemoteDevStore.getState().sendAnswer('hello');
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });
});

// ── resolveQuestion ──────────────────────────────────────────

describe('resolveQuestion', () => {
  it('clears pending but keeps working status', () => {
    const store = useRemoteDevStore.getState();
    store.receiveQuestion({
      id: 'perm-1',
      tool_name: 'AskUserQuestion',
      tool_input_preview: '',
      tool_input_raw: {
        questions: [{ question: "What's next?", header: 'Remote', options: [] }],
        metadata: { source: 'remote-dev' },
      },
      createdAt: 1000,
      expiresAt: 1000 + 30 * 60_000,
    });
    // Simulate sendAnswer setting status to working
    useRemoteDevStore.setState({ status: 'working' });
    store.resolveQuestion();

    const s = useRemoteDevStore.getState();
    expect(s.pendingQuestion).toBeNull();
    expect(s.status).toBe('working'); // Stays working until next receiveQuestion
  });
});

// ── clear ────────────────────────────────────────────────────

describe('clear', () => {
  it('resets all state to idle', () => {
    const store = useRemoteDevStore.getState();
    store.receiveQuestion({
      id: 'perm-1',
      tool_name: 'AskUserQuestion',
      tool_input_preview: '',
      tool_input_raw: {
        questions: [{ question: "Done.\n===NEXT===\nWhat's next?", header: 'Remote', options: [] }],
        metadata: { source: 'remote-dev' },
      },
      createdAt: 1000,
      expiresAt: 1000 + 30 * 60_000,
    });
    store.clear();

    const s = useRemoteDevStore.getState();
    expect(s.messages).toHaveLength(0);
    expect(s.pendingQuestion).toBeNull();
    expect(s.status).toBe('idle');
  });
});
