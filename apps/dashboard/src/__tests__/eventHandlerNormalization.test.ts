// @vitest-environment jsdom
// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Bernhard

import { describe, it, expect } from 'vitest';
import { createFreshDraft, processEvent } from '../store/eventHandlers';
import type { AgentEvent } from '@synapse-ai/core';

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeEvent(overrides: Partial<AgentEvent>): AgentEvent {
  return {
    id: `evt-${Math.random().toString(36).slice(2)}`,
    type: 'session_start',
    sessionId: 'sess-1',
    timestamp: Date.now(),
    ...overrides,
  };
}

function applyEvents(events: AgentEvent[]) {
  const draft = createFreshDraft();
  for (const ev of events) {
    processEvent(ev, draft, true /* showHookEvents */);
  }
  return draft;
}

// ── Token normalization via Task tool_end ─────────────────────────────────────
// The normalization rule (Point C) is:
//   inputTokens = raw_input_tokens - cache_read_input_tokens  (fresh only)
//
// This is implemented in the `applyTaskTokensFromToolEnd` helper inside
// eventHandlers.ts. We verify it by:
//   1. Creating a session + agent via SessionStart + SubagentStart
//   2. Firing a PreToolUse(Task) + PostToolUse(Task) with usage data
//   3. Asserting the agent's tokenUsage reflects the normalization

// ── Token normalization rule (Point C) ────────────────────────────────────────
// inputTokens = raw_input_tokens - cache_read_input_tokens (fresh only)
//
// The SDK path: tool_end.toolResponse.agentId names the child agent.
// We use that path in tests since it's simpler to set up without the FIFO
// SubagentStart→Task correlation required by the hook path.

describe('eventHandler token normalization', () => {
  it('initializes agent tokenUsage with zero input and output', () => {
    const draft = applyEvents([
      makeEvent({ type: 'session_start', sessionId: 'sess-1' }),
      makeEvent({
        type: 'agent_start',
        sessionId: 'sess-1',
        agentId: 'a1',
        eventSource: 'hook',
        vendor: 'anthropic',
      }),
    ]);

    const agent = draft.agents.get('a1');
    expect(agent).toBeDefined();
    expect(agent?.tokenUsage.input).toBe(0);
    expect(agent?.tokenUsage.output).toBe(0);
    // cacheRead/thinking are optional and default to undefined initially
    expect(agent?.tokenUsage.cacheRead == null || agent.tokenUsage.cacheRead === 0).toBe(true);
  });

  it('applies inputTokens = raw - cacheRead from Task tool_end (SDK path)', () => {
    // SDK path: toolResponse.agentId names the child agent
    const toolUseId = 'tu-task-1';
    const childAgentId = 'child-a1';

    const draft = applyEvents([
      makeEvent({ type: 'session_start', sessionId: 'sess-1' }),
      makeEvent({
        type: 'agent_start',
        sessionId: 'sess-1',
        agentId: 'a1',
        eventSource: 'openclaw',
        vendor: 'anthropic',
      }),
      makeEvent({
        type: 'tool_start',
        sessionId: 'sess-1',
        agentId: 'a1',
        toolName: 'Task',
        toolUseId,
        eventSource: 'openclaw',
        vendor: 'anthropic',
        status: 'running',
      }),
      makeEvent({
        type: 'agent_start',
        sessionId: 'sess-1',
        agentId: childAgentId,
        parentAgentId: 'a1',
        eventSource: 'openclaw',
        vendor: 'anthropic',
      }),
      // Task tool_end via SDK path — agentId in toolResponse names the child
      // raw input = 5000, cacheRead = 3000 → normalized input = 2000
      makeEvent({
        type: 'tool_end',
        sessionId: 'sess-1',
        agentId: 'a1',
        toolName: 'Task',
        toolUseId,
        eventSource: 'openclaw',
        vendor: 'anthropic',
        status: 'success',
        toolResponse: {
          agentId: childAgentId,
          usage: {
            input_tokens: 5000,
            output_tokens: 800,
            cache_read_input_tokens: 3000,
            cache_creation_input_tokens: 200,
            thinking_tokens: 100,
          },
        },
      }),
    ]);

    const child = draft.agents.get(childAgentId);
    expect(child).toBeDefined();
    // input should be fresh-only (5000 - 3000 = 2000)
    expect(child?.tokenUsage.input).toBe(2000);
    expect(child?.tokenUsage.output).toBe(800);
    expect(child?.tokenUsage.cacheRead).toBe(3000);
    expect(child?.tokenUsage.cacheCreation).toBe(200);
    expect(child?.tokenUsage.thinking).toBe(100);
  });

  it('clamps to zero when cacheRead > raw input (Math.max(0, ...))', () => {
    const toolUseId = 'tu-task-2';
    const childAgentId = 'child-a2';

    const draft = applyEvents([
      makeEvent({ type: 'session_start', sessionId: 'sess-2' }),
      makeEvent({
        type: 'agent_start',
        sessionId: 'sess-2',
        agentId: 'a2',
        eventSource: 'openclaw',
        vendor: 'anthropic',
      }),
      makeEvent({
        type: 'tool_start',
        sessionId: 'sess-2',
        agentId: 'a2',
        toolName: 'Task',
        toolUseId,
        eventSource: 'openclaw',
        vendor: 'anthropic',
        status: 'running',
      }),
      makeEvent({
        type: 'agent_start',
        sessionId: 'sess-2',
        agentId: childAgentId,
        parentAgentId: 'a2',
        eventSource: 'openclaw',
        vendor: 'anthropic',
      }),
      // cacheRead (5000) > input_tokens (3000) → Math.max(0, 3000 - 5000) = 0
      makeEvent({
        type: 'tool_end',
        sessionId: 'sess-2',
        agentId: 'a2',
        toolName: 'Task',
        toolUseId,
        eventSource: 'openclaw',
        vendor: 'anthropic',
        status: 'success',
        toolResponse: {
          agentId: childAgentId,
          usage: {
            input_tokens: 3000,
            output_tokens: 400,
            cache_read_input_tokens: 5000,
            cache_creation_input_tokens: 0,
            thinking_tokens: 0,
          },
        },
      }),
    ]);

    const child = draft.agents.get(childAgentId);
    expect(child?.tokenUsage.input).toBe(0); // Math.max(0, 3000 - 5000)
    expect(child?.tokenUsage.cacheRead).toBe(5000);
    expect(child?.tokenUsage.output).toBe(400);
  });

  it('does not overwrite existing non-zero tokenUsage on child agent', () => {
    // Guard: `if (input !== 0 || output !== 0) return` prevents double-write
    const toolUseId = 'tu-task-3';
    const toolUseId2 = 'tu-task-3b';
    const childAgentId = 'child-a3';

    const draft = applyEvents([
      makeEvent({ type: 'session_start', sessionId: 'sess-3' }),
      makeEvent({
        type: 'agent_start',
        sessionId: 'sess-3',
        agentId: 'a3',
        eventSource: 'openclaw',
        vendor: 'anthropic',
      }),
      makeEvent({
        type: 'tool_start',
        sessionId: 'sess-3',
        agentId: 'a3',
        toolName: 'Task',
        toolUseId,
        eventSource: 'openclaw',
        vendor: 'anthropic',
        status: 'running',
      }),
      makeEvent({
        type: 'agent_start',
        sessionId: 'sess-3',
        agentId: childAgentId,
        parentAgentId: 'a3',
        eventSource: 'openclaw',
        vendor: 'anthropic',
      }),
      // First tool_end populates child tokenUsage: 1000 fresh, 300 output
      makeEvent({
        type: 'tool_end',
        sessionId: 'sess-3',
        agentId: 'a3',
        toolName: 'Task',
        toolUseId,
        eventSource: 'openclaw',
        vendor: 'anthropic',
        status: 'success',
        toolResponse: {
          agentId: childAgentId,
          usage: {
            input_tokens: 1000,
            output_tokens: 300,
            cache_read_input_tokens: 0,
            cache_creation_input_tokens: 0,
            thinking_tokens: 0,
          },
        },
      }),
      // Second tool_end — guard should prevent overwrite (child already has input=1000, output=300)
      makeEvent({
        type: 'tool_start',
        sessionId: 'sess-3',
        agentId: 'a3',
        toolName: 'Task',
        toolUseId: toolUseId2,
        eventSource: 'openclaw',
        vendor: 'anthropic',
        status: 'running',
      }),
      makeEvent({
        type: 'tool_end',
        sessionId: 'sess-3',
        agentId: 'a3',
        toolName: 'Task',
        toolUseId: toolUseId2,
        eventSource: 'openclaw',
        vendor: 'anthropic',
        status: 'success',
        toolResponse: {
          agentId: childAgentId,
          usage: {
            input_tokens: 9999,
            output_tokens: 9999,
            cache_read_input_tokens: 0,
            cache_creation_input_tokens: 0,
            thinking_tokens: 0,
          },
        },
      }),
    ]);

    const child = draft.agents.get(childAgentId);
    // Should still have the first event's values
    expect(child?.tokenUsage.input).toBe(1000);
    expect(child?.tokenUsage.output).toBe(300);
  });
});

// ── processEvent: basic event routing ─────────────────────────────────────────

describe('processEvent routing', () => {
  it('creates a session node for session_start', () => {
    const draft = applyEvents([makeEvent({ type: 'session_start', sessionId: 'sess-x' })]);
    expect(draft.sessions.has('sess-x')).toBe(true);
    expect(draft.nodes.some((n) => n.id === 'session-sess-x')).toBe(true);
  });

  it('creates an agent entry for agent_start', () => {
    const draft = applyEvents([
      makeEvent({ type: 'session_start', sessionId: 'sess-y' }),
      makeEvent({
        type: 'agent_start',
        sessionId: 'sess-y',
        agentId: 'ay',
        eventSource: 'hook',
        vendor: 'anthropic',
      }),
    ]);
    expect(draft.agents.has('ay')).toBe(true);
  });

  it('creates a tool call for tool_start', () => {
    const draft = applyEvents([
      makeEvent({ type: 'session_start', sessionId: 'sess-z' }),
      makeEvent({
        type: 'agent_start',
        sessionId: 'sess-z',
        agentId: 'az',
        eventSource: 'hook',
        vendor: 'anthropic',
      }),
      makeEvent({
        type: 'tool_start',
        sessionId: 'sess-z',
        agentId: 'az',
        toolName: 'Read',
        toolUseId: 'tu-z1',
        eventSource: 'hook',
        vendor: 'anthropic',
        status: 'running',
      }),
    ]);

    const toolCalls = draft.toolCalls.get('az');
    expect(toolCalls?.some((tc) => tc.toolUseId === 'tu-z1')).toBe(true);
  });

  it('marks tool_end as success status', () => {
    const draft = applyEvents([
      makeEvent({ type: 'session_start', sessionId: 'sess-w' }),
      makeEvent({
        type: 'agent_start',
        sessionId: 'sess-w',
        agentId: 'aw',
        eventSource: 'hook',
        vendor: 'anthropic',
      }),
      makeEvent({
        type: 'tool_start',
        sessionId: 'sess-w',
        agentId: 'aw',
        toolName: 'Write',
        toolUseId: 'tu-w1',
        eventSource: 'hook',
        vendor: 'anthropic',
        status: 'running',
      }),
      makeEvent({
        type: 'tool_end',
        sessionId: 'sess-w',
        agentId: 'aw',
        toolName: 'Write',
        toolUseId: 'tu-w1',
        eventSource: 'hook',
        vendor: 'anthropic',
        status: 'success',
      }),
    ]);

    const toolCalls = draft.toolCalls.get('aw');
    const tc = toolCalls?.find((t) => t.toolUseId === 'tu-w1');
    expect(tc?.status).toBe('success');
  });
});

// ── Suppressed session handling ───────────────────────────────────────────────

describe('suppressed session handling', () => {
  it('ensureSession does not recreate a suppressed session', () => {
    const draft = applyEvents([
      makeEvent({ type: 'session_start', sessionId: 'sess-1', timestamp: 1000 }),
      makeEvent({ type: 'user_prompt', sessionId: 'sess-1', text: 'hello', timestamp: 2000 }),
    ]);

    // Verify session exists
    expect(draft.sessions.has('sess-1')).toBe(true);

    // Simulate deletion: remove from draft and add to suppressed set
    draft.sessions.delete('sess-1');
    draft.nodes = draft.nodes.filter(
      (n) => !n.id.startsWith('session-sess-1') && !n.id.startsWith('prompt-'),
    );
    draft.edges = [];
    draft.prompts.delete('sess-1');
    draft.suppressedSessionIds = new Set(['sess-1']);

    // New event arrives for deleted session
    processEvent(
      makeEvent({ type: 'user_prompt', sessionId: 'sess-1', text: 'new prompt', timestamp: 5000 }),
      draft,
      true,
    );

    // Session should NOT be recreated
    expect(draft.sessions.has('sess-1')).toBe(false);
    // No new prompt node should exist
    expect(draft.nodes.some((n) => n.id.includes('prompt-'))).toBe(false);
  });

  it('allows events for non-suppressed sessions', () => {
    const draft = applyEvents([
      makeEvent({ type: 'session_start', sessionId: 'sess-1', timestamp: 1000 }),
    ]);
    draft.suppressedSessionIds = new Set(['sess-other']);

    processEvent(
      makeEvent({ type: 'user_prompt', sessionId: 'sess-1', text: 'allowed', timestamp: 2000 }),
      draft,
      true,
    );

    // Prompt should exist for the non-suppressed session
    expect(draft.nodes.some((n) => n.id.includes('prompt-'))).toBe(true);
  });
});
