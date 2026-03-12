// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { AgentEvent } from '@synapse-ai/core';

// Mock modules that rely on browser APIs before importing the store
vi.mock('../store/wsClient', () => ({
  wsClient: {
    setOnEvent: vi.fn(),
    setOnBatchEvent: vi.fn(),
    setOnStatusChange: vi.fn(),
    setOnReconnect: vi.fn(),
    connect: vi.fn(),
    disconnect: vi.fn(),
    send: vi.fn(),
  },
}));

vi.mock('../components/Toast', () => ({
  toast: vi.fn(),
}));

vi.mock('../utils/api', () => ({
  apiUrl: (path: string) => path,
}));

import { useAgentStore } from '../store/agentStore';

const initialState = useAgentStore.getState();

function resetStore() {
  useAgentStore.setState({
    sessions: new Map(),
    agents: new Map(),
    agentsBySession: new Map(),
    childAgents: new Map(),
    toolCalls: new Map(),
    prompts: new Map(),
    activeAgents: new Map(),
    toolAgentMap: new Map(),
    pendingTaskTools: new Map(),
    taskToolAgentMap: new Map(),
    events: [],
    eventIds: new Set<string>(),
    nodes: [...initialState.nodes.filter((n) => n.id === '__spawn__')],
    edges: [],
    selectedNodeId: null,
    highlightedNodeIds: null,
    multiHighlightIds: null,
    paused: false,
    showHookEvents: true,
    collapsedNodes: new Set(),
    liveNudges: [],
  });
}

function makeToolEvent(overrides: Partial<AgentEvent> = {}): AgentEvent {
  return {
    id: overrides.id ?? `evt-${Math.random()}`,
    type: 'tool_start',
    sessionId: 'sess-perf',
    agentId: 'agent-perf',
    toolUseId: overrides.id ?? `tool-${Math.random()}`,
    toolName: 'Read',
    timestamp: Date.now(),
    ...overrides,
  };
}

describe('render pipeline baseline', () => {
  beforeEach(() => {
    resetStore();
  });

  it('measures addEvent time on a 500-node store', () => {
    const store = useAgentStore.getState();

    // Seed session + agent so tool events have parents
    store.addEvent({
      id: 'sess-start',
      type: 'session_start',
      sessionId: 'sess-perf',
      timestamp: Date.now(),
    });
    store.addEvent({
      id: 'agent-start',
      type: 'agent_start',
      sessionId: 'sess-perf',
      agentId: 'agent-perf',
      agentType: 'main',
      timestamp: Date.now(),
    });

    // Seed 500 tool nodes
    for (let i = 0; i < 500; i++) {
      store.addEvent(makeToolEvent({ id: `seed-${i}`, toolUseId: `seed-tool-${i}` }));
    }

    // Measure: add 10 more events, record per-event time
    const times: number[] = [];
    for (let i = 0; i < 10; i++) {
      const start = performance.now();
      store.addEvent(makeToolEvent({ id: `measure-${i}`, toolUseId: `measure-tool-${i}` }));
      times.push(performance.now() - start);
    }

    const avg = times.reduce((a, b) => a + b, 0) / times.length;
    const max = Math.max(...times);
    console.log(
      `[BASELINE] avg=${avg.toFixed(1)}ms max=${max.toFixed(1)}ms times=[${times.map((t) => t.toFixed(1)).join(', ')}]`,
    );

    // This test always passes — it's a measurement, not an assertion.
    // After all optimizations, change this to: expect(avg).toBeLessThan(50);
    expect(avg).toBeGreaterThanOrEqual(0);
  });
});
