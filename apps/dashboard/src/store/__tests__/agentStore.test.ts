// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Synapse Contributors

// @vitest-environment jsdom
import type { AgentEvent } from '@synapse-ai/core';
import { PALETTES } from '@synapse-ai/core';

// Mock modules that rely on browser APIs before importing the store
vi.mock('../wsClient', () => ({
  wsClient: {
    setOnEvent: vi.fn(),
    setOnStatusChange: vi.fn(),
    setOnReconnect: vi.fn(),
    connect: vi.fn(),
    disconnect: vi.fn(),
    send: vi.fn(),
  },
}));

vi.mock('../../components/Toast', () => ({
  toast: vi.fn(),
}));

vi.mock('../../utils/api', () => ({
  apiUrl: (path: string) => path,
}));

// Now import the store (after mocks are in place)
import { useAgentStore } from '../agentStore';

// ── Helper: reset store to initial state before each test ──────────

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
    nodes: [...initialState.nodes.filter((n) => n.id === '__spawn__')],
    edges: [],
    selectedNodeId: null,
    highlightedNodeIds: null,
    multiHighlightIds: null,
    connectionStatus: 'disconnected',
    filter: {},
    showSpawnDialog: false,
    showWorkshop: false,
    paused: false,
    showHookEvents: true,
    showAllTools: false,
    lockViewport: true,
    autoClosePrompts: false,
    graphSearchQuery: '',
    collapsedNodes: new Set(),
    transcripts: new Map(),
    liveNudges: [],
    isLoading: true,
    loadError: null,
    activeLensTab: 'tree',
    lensPanelWidth: 320,
    lensSearchQuery: '',
    profileMetric: 'tokens',
    paletteIndex: 0,
    selectSource: null,
  });
}

// ── Helper: create a minimal AgentEvent ────────────────────────────

function makeEvent(overrides: Partial<AgentEvent> = {}): AgentEvent {
  return {
    id: overrides.id ?? `evt-${Date.now()}`,
    type: overrides.type ?? 'session_start',
    sessionId: overrides.sessionId ?? 'sess-1',
    timestamp: overrides.timestamp ?? Date.now(),
    ...overrides,
  };
}

// ── Tests ──────────────────────────────────────────────────────────

describe('agentStore', () => {
  beforeEach(() => {
    resetStore();
  });

  it('initializes with empty state', () => {
    const state = useAgentStore.getState();

    expect(state.sessions.size).toBe(0);
    expect(state.agents.size).toBe(0);
    expect(state.events).toHaveLength(0);
    expect(state.edges).toHaveLength(0);
  });

  it('has expected initial state shape', () => {
    const state = useAgentStore.getState();

    // Maps should be empty
    expect(state.sessions).toBeInstanceOf(Map);
    expect(state.agents).toBeInstanceOf(Map);
    expect(state.agentsBySession).toBeInstanceOf(Map);
    expect(state.childAgents).toBeInstanceOf(Map);
    expect(state.toolCalls).toBeInstanceOf(Map);
    expect(state.prompts).toBeInstanceOf(Map);
    expect(state.activeAgents).toBeInstanceOf(Map);
    expect(state.toolAgentMap).toBeInstanceOf(Map);

    // Scalar defaults
    expect(state.events).toEqual([]);
    expect(state.selectedNodeId).toBeNull();
    expect(state.connectionStatus).toBe('disconnected');
    expect(state.filter).toEqual({});
    expect(state.showSpawnDialog).toBe(false);
    expect(state.paused).toBe(false);
    expect(state.showHookEvents).toBe(true);
    expect(state.lockViewport).toBe(true);
    expect(state.paletteIndex).toBe(0);

    // Nodes should contain only the spawn node
    expect(state.nodes).toHaveLength(1);
    expect(state.nodes[0].id).toBe('__spawn__');
  });

  it('addEvent adds an event to the store when not paused', () => {
    const event = makeEvent({
      id: 'e1',
      type: 'session_start',
      sessionId: 'sess-1',
      timestamp: 1000,
    });

    useAgentStore.getState().addEvent(event);

    const state = useAgentStore.getState();
    expect(state.events).toHaveLength(1);
    expect(state.events[0].id).toBe('e1');
    // session_start also creates a session entry
    expect(state.sessions.size).toBe(1);
    expect(state.sessions.has('sess-1')).toBe(true);
  });

  it('addEvent does NOT add events when paused', () => {
    // Pause the store
    useAgentStore.getState().setPaused(true);

    const event = makeEvent({ id: 'e-paused', type: 'session_start' });
    useAgentStore.getState().addEvent(event);

    const state = useAgentStore.getState();
    expect(state.events).toHaveLength(0);
    expect(state.sessions.size).toBe(0);
  });

  it('selectNode updates selectedNodeId', () => {
    useAgentStore.getState().selectNode('agent-123');

    const state = useAgentStore.getState();
    expect(state.selectedNodeId).toBe('agent-123');
  });

  it('setPaused toggles the paused flag', () => {
    expect(useAgentStore.getState().paused).toBe(false);

    useAgentStore.getState().setPaused(true);
    expect(useAgentStore.getState().paused).toBe(true);

    useAgentStore.getState().setPaused(false);
    expect(useAgentStore.getState().paused).toBe(false);
  });

  it('clearEvents empties all state back to defaults', () => {
    // Add some data first
    const event = makeEvent({ id: 'e-clear', type: 'session_start', sessionId: 'sess-x' });
    useAgentStore.getState().addEvent(event);
    useAgentStore.getState().selectNode('some-node');

    // Verify data exists
    expect(useAgentStore.getState().events.length).toBeGreaterThan(0);
    expect(useAgentStore.getState().sessions.size).toBeGreaterThan(0);
    expect(useAgentStore.getState().selectedNodeId).toBe('some-node');

    // Clear everything
    useAgentStore.getState().clearEvents();

    const state = useAgentStore.getState();
    expect(state.sessions.size).toBe(0);
    expect(state.agents.size).toBe(0);
    expect(state.events).toHaveLength(0);
    expect(state.edges).toHaveLength(0);
    expect(state.selectedNodeId).toBeNull();
    expect(state.highlightedNodeIds).toBeNull();
    expect(state.nodes).toHaveLength(1);
    expect(state.nodes[0].id).toBe('__spawn__');
  });

  it('cyclePalette increments paletteIndex and wraps around', () => {
    expect(useAgentStore.getState().paletteIndex).toBe(0);

    useAgentStore.getState().cyclePalette();
    expect(useAgentStore.getState().paletteIndex).toBe(1);

    // Cycle through remaining palettes to wrap around
    for (let i = 1; i < PALETTES.length; i++) {
      useAgentStore.getState().cyclePalette();
    }
    // Should wrap back to 0
    expect(useAgentStore.getState().paletteIndex).toBe(0);
  });

  it('selectedNodeId starts as null', () => {
    const state = useAgentStore.getState();
    expect(state.selectedNodeId).toBeNull();
  });

  // ── updateNodeDimensions ──────────────────────────────────────

  describe('updateNodeDimensions', () => {
    it('writes measured dimensions onto matching nodes', () => {
      useAgentStore.getState().addEvent(
        makeEvent({ id: 'e1', type: 'session_start', sessionId: 'sess-1', timestamp: 1000 }),
      );
      const sessionNode = useAgentStore.getState().nodes.find((n) => n.id === 'session-sess-1');
      expect(sessionNode).toBeDefined();
      expect(sessionNode!.measured).toBeUndefined();

      useAgentStore.getState().updateNodeDimensions([
        { id: 'session-sess-1', width: 230, height: 95 },
      ]);

      const updated = useAgentStore.getState().nodes.find((n) => n.id === 'session-sess-1');
      expect(updated!.measured).toEqual({ width: 230, height: 95 });
    });

    it('is a no-op when dimensions have not changed', () => {
      useAgentStore.getState().addEvent(
        makeEvent({ id: 'e1', type: 'session_start', sessionId: 'sess-1', timestamp: 1000 }),
      );
      useAgentStore.getState().updateNodeDimensions([
        { id: 'session-sess-1', width: 230, height: 95 },
      ]);
      const nodesRef = useAgentStore.getState().nodes;

      // Call again with same dimensions — should be exact same array reference
      useAgentStore.getState().updateNodeDimensions([
        { id: 'session-sess-1', width: 230, height: 95 },
      ]);
      expect(useAgentStore.getState().nodes).toBe(nodesRef);
    });

    it('ignores updates for non-existent node IDs', () => {
      const nodesBefore = useAgentStore.getState().nodes;
      useAgentStore.getState().updateNodeDimensions([
        { id: 'nonexistent-123', width: 100, height: 50 },
      ]);
      expect(useAgentStore.getState().nodes).toBe(nodesBefore);
    });

    it('updates multiple nodes in a single call', () => {
      useAgentStore.getState().addEvent(
        makeEvent({ id: 'e1', type: 'session_start', sessionId: 'sess-1', timestamp: 1000 }),
      );
      useAgentStore.getState().addEvent(
        makeEvent({ id: 'e2', type: 'user_prompt', sessionId: 'sess-1', timestamp: 2000, text: 'hello' }),
      );

      useAgentStore.getState().updateNodeDimensions([
        { id: 'session-sess-1', width: 225, height: 85 },
        { id: 'prompt-e2', width: 250, height: 140 },
      ]);

      const nodes = useAgentStore.getState().nodes;
      const session = nodes.find((n) => n.id === 'session-sess-1');
      const prompt = nodes.find((n) => n.id === 'prompt-e2');
      expect(session!.measured).toEqual({ width: 225, height: 85 });
      expect(prompt!.measured).toEqual({ width: 250, height: 140 });
    });
  });

  // ── Task→Agent connection (Bug 1+2 fix) ─────────────────────────

  describe('Task tool → Agent hierarchy', () => {
    it('connects agent to its parent Task tool node', () => {
      const { addEvent } = useAgentStore.getState();

      addEvent(makeEvent({ id: 'e1', type: 'session_start', sessionId: 's1', timestamp: 1 }));
      addEvent(makeEvent({ id: 'e2', type: 'user_prompt', sessionId: 's1', timestamp: 2, text: 'go' }));
      // Main agent fires Task tool
      addEvent(makeEvent({
        id: 'e3', type: 'tool_start', sessionId: 's1', timestamp: 3,
        toolName: 'Task', toolUseId: 'task-1',
      }));
      // SubagentStart follows
      addEvent(makeEvent({
        id: 'e4', type: 'agent_start', sessionId: 's1', timestamp: 4,
        agentId: 'explore-1', agentType: 'Explore',
      }));

      const state = useAgentStore.getState();
      // Agent should be connected to the Task tool, not the prompt
      const agentEdge = state.edges.find((e) => e.target === 'agent-explore-1');
      expect(agentEdge).toBeDefined();
      expect(agentEdge!.source).toBe('tool-task-1');
    });

    it('falls back to prompt when no pending Task tool', () => {
      const { addEvent } = useAgentStore.getState();

      addEvent(makeEvent({ id: 'e1', type: 'session_start', sessionId: 's1', timestamp: 1 }));
      addEvent(makeEvent({ id: 'e2', type: 'user_prompt', sessionId: 's1', timestamp: 2, text: 'go' }));
      // Agent starts without a preceding Task tool (SDK-spawned)
      addEvent(makeEvent({
        id: 'e3', type: 'agent_start', sessionId: 's1', timestamp: 3,
        agentId: 'agent-1', agentType: 'Plan',
      }));

      const state = useAgentStore.getState();
      const agentEdge = state.edges.find((e) => e.target === 'agent-agent-1');
      expect(agentEdge).toBeDefined();
      expect(agentEdge!.source).toBe('prompt-e2');
    });

    it('handles multiple Task tools with their respective agents', () => {
      const { addEvent } = useAgentStore.getState();

      addEvent(makeEvent({ id: 'e1', type: 'session_start', sessionId: 's1', timestamp: 1 }));
      addEvent(makeEvent({ id: 'e2', type: 'user_prompt', sessionId: 's1', timestamp: 2, text: 'go' }));
      // First Task tool
      addEvent(makeEvent({
        id: 'e3', type: 'tool_start', sessionId: 's1', timestamp: 3,
        toolName: 'Task', toolUseId: 'task-1',
      }));
      addEvent(makeEvent({
        id: 'e4', type: 'agent_start', sessionId: 's1', timestamp: 4,
        agentId: 'explore-1', agentType: 'Explore',
      }));
      addEvent(makeEvent({
        id: 'e5', type: 'agent_stop', sessionId: 's1', timestamp: 5,
        agentId: 'explore-1',
      }));
      addEvent(makeEvent({
        id: 'e6', type: 'tool_end', sessionId: 's1', timestamp: 6,
        toolName: 'Task', toolUseId: 'task-1',
      }));
      // Second Task tool
      addEvent(makeEvent({
        id: 'e7', type: 'tool_start', sessionId: 's1', timestamp: 7,
        toolName: 'Task', toolUseId: 'task-2',
      }));
      addEvent(makeEvent({
        id: 'e8', type: 'agent_start', sessionId: 's1', timestamp: 8,
        agentId: 'plan-1', agentType: 'Plan',
      }));

      const state = useAgentStore.getState();
      const edge1 = state.edges.find((e) => e.target === 'agent-explore-1');
      const edge2 = state.edges.find((e) => e.target === 'agent-plan-1');
      expect(edge1!.source).toBe('tool-task-1');
      expect(edge2!.source).toBe('tool-task-2');
    });
  });

  // ── Parent agent validation (Bug 3 fix) ──────────────────────────

  describe('parent agent edge validation', () => {
    it('falls back to prompt when parentAgentId references non-existent node', () => {
      const { addEvent } = useAgentStore.getState();

      addEvent(makeEvent({ id: 'e1', type: 'session_start', sessionId: 's1', timestamp: 1 }));
      addEvent(makeEvent({ id: 'e2', type: 'user_prompt', sessionId: 's1', timestamp: 2, text: 'go' }));
      // Agent with parentAgentId pointing to non-existent agent
      addEvent(makeEvent({
        id: 'e3', type: 'agent_start', sessionId: 's1', timestamp: 3,
        agentId: 'child-1', agentType: 'Explore',
        parentAgentId: 'nonexistent-parent',
      }));

      const state = useAgentStore.getState();
      const agentEdge = state.edges.find((e) => e.target === 'agent-child-1');
      expect(agentEdge).toBeDefined();
      // Should NOT point to the nonexistent parent — should fall back to prompt
      expect(agentEdge!.source).not.toBe('agent-nonexistent-parent');
      expect(agentEdge!.source).toBe('prompt-e2');
    });

    it('connects to parent agent when it exists', () => {
      const { addEvent } = useAgentStore.getState();

      addEvent(makeEvent({ id: 'e1', type: 'session_start', sessionId: 's1', timestamp: 1 }));
      addEvent(makeEvent({ id: 'e2', type: 'user_prompt', sessionId: 's1', timestamp: 2, text: 'go' }));
      addEvent(makeEvent({
        id: 'e3', type: 'tool_start', sessionId: 's1', timestamp: 3,
        toolName: 'Task', toolUseId: 'task-1',
      }));
      addEvent(makeEvent({
        id: 'e4', type: 'agent_start', sessionId: 's1', timestamp: 4,
        agentId: 'parent-1', agentType: 'Explore',
      }));
      // Nested agent with valid parentAgentId
      addEvent(makeEvent({
        id: 'e5', type: 'agent_start', sessionId: 's1', timestamp: 5,
        agentId: 'child-1', agentType: 'Plan',
        parentAgentId: 'parent-1',
      }));

      const state = useAgentStore.getState();
      const childEdge = state.edges.find((e) => e.target === 'agent-child-1');
      expect(childEdge!.source).toBe('agent-parent-1');
    });
  });

  // ── Out-of-order tool events (Bug 4 fix) ──────────────────────────

  describe('out-of-order tool events', () => {
    it('creates tool node when tool_end arrives before tool_start', () => {
      const { addEvent } = useAgentStore.getState();

      addEvent(makeEvent({ id: 'e1', type: 'session_start', sessionId: 's1', timestamp: 1 }));
      addEvent(makeEvent({ id: 'e2', type: 'user_prompt', sessionId: 's1', timestamp: 2, text: 'go' }));
      // tool_end arrives first (async hook race)
      addEvent(makeEvent({
        id: 'e3', type: 'tool_end', sessionId: 's1', timestamp: 3,
        toolName: 'Read', toolUseId: 'read-1',
      }));

      const state = useAgentStore.getState();
      // Tool node should exist (created by finalizeToolCall)
      const toolNode = state.nodes.find((n) => n.id === 'tool-read-1');
      expect(toolNode).toBeDefined();
      // Should have an edge connecting it
      const toolEdge = state.edges.find((e) => e.target === 'tool-read-1');
      expect(toolEdge).toBeDefined();
    });
  });

  // ── Coaching nudges ─────────────────────────────────────────────

  describe('coaching nudges', () => {
    it('initializes with empty liveNudges', () => {
      const state = useAgentStore.getState();
      expect(state.liveNudges).toEqual([]);
    });

    it('addNudge appends to liveNudges', () => {
      useAgentStore.getState().addNudge({
        id: 'n1',
        sessionId: 's1',
        detectorId: 'nudge.bash-streak',
        severity: 'suggestion',
        title: 'Use dedicated tools',
        message: 'Multiple Bash calls for file ops',
        recommendation: 'Use Read/Edit instead',
        firedAt: Date.now(),
        dismissed: false,
      });

      const state = useAgentStore.getState();
      expect(state.liveNudges).toHaveLength(1);
      expect(state.liveNudges[0].id).toBe('n1');
    });

    it('addNudge caps at 50 nudges', () => {
      for (let i = 0; i < 55; i++) {
        useAgentStore.getState().addNudge({
          id: `n${i}`,
          sessionId: 's1',
          detectorId: 'test',
          severity: 'info',
          title: `Nudge ${i}`,
          message: 'test',
          recommendation: '',
          firedAt: Date.now() + i,
          dismissed: false,
        });
      }

      const state = useAgentStore.getState();
      expect(state.liveNudges).toHaveLength(50);
      // Should keep the most recent (last 50)
      expect(state.liveNudges[0].id).toBe('n5');
      expect(state.liveNudges[49].id).toBe('n54');
    });

    it('dismissNudge sets dismissed to true without removing', () => {
      useAgentStore.getState().addNudge({
        id: 'dismiss-test',
        sessionId: 's1',
        detectorId: 'test',
        severity: 'warning',
        title: 'Test',
        message: 'test',
        recommendation: '',
        firedAt: Date.now(),
        dismissed: false,
      });

      useAgentStore.getState().dismissNudge('dismiss-test');

      const state = useAgentStore.getState();
      expect(state.liveNudges).toHaveLength(1);
      expect(state.liveNudges[0].dismissed).toBe(true);
    });

    it('clearEvents resets liveNudges', () => {
      useAgentStore.getState().addNudge({
        id: 'clear-test',
        sessionId: 's1',
        detectorId: 'test',
        severity: 'info',
        title: 'Test',
        message: 'test',
        recommendation: '',
        firedAt: Date.now(),
        dismissed: false,
      });

      expect(useAgentStore.getState().liveNudges).toHaveLength(1);

      useAgentStore.getState().clearEvents();

      expect(useAgentStore.getState().liveNudges).toEqual([]);
    });
  });

  // ── loadEvents batch replay ───────────────────────────────────────

  describe('loadEvents', () => {
    it('builds correct Task→Agent hierarchy when replaying events', () => {
      const events: AgentEvent[] = [
        makeEvent({ id: 'e1', type: 'session_start', sessionId: 's1', timestamp: 1 }),
        makeEvent({ id: 'e2', type: 'user_prompt', sessionId: 's1', timestamp: 2, text: 'go' }),
        makeEvent({ id: 'e3', type: 'tool_start', sessionId: 's1', timestamp: 3, toolName: 'Task', toolUseId: 'task-1' }),
        makeEvent({ id: 'e4', type: 'agent_start', sessionId: 's1', timestamp: 4, agentId: 'explore-1', agentType: 'Explore' }),
        makeEvent({ id: 'e5', type: 'tool_start', sessionId: 's1', timestamp: 5, toolName: 'Glob', toolUseId: 'glob-1', agentId: 'explore-1' }),
        makeEvent({ id: 'e6', type: 'tool_end', sessionId: 's1', timestamp: 6, toolName: 'Glob', toolUseId: 'glob-1', agentId: 'explore-1' }),
        makeEvent({ id: 'e7', type: 'agent_stop', sessionId: 's1', timestamp: 7, agentId: 'explore-1' }),
        makeEvent({ id: 'e8', type: 'tool_end', sessionId: 's1', timestamp: 8, toolName: 'Task', toolUseId: 'task-1' }),
      ];

      useAgentStore.getState().loadEvents(events);

      const state = useAgentStore.getState();
      // Task tool → Agent
      const agentEdge = state.edges.find((e) => e.target === 'agent-explore-1');
      expect(agentEdge!.source).toBe('tool-task-1');
      // Agent → Tool
      const toolEdge = state.edges.find((e) => e.target === 'tool-glob-1');
      expect(toolEdge!.source).toBe('agent-explore-1');
    });
  });

  // ── Enriched token data & model propagation ──────────────────────

  describe('enriched token data', () => {
    it('extracts cache/thinking tokens from Task tool_end response', () => {
      const events: AgentEvent[] = [
        makeEvent({ id: 'e1', type: 'session_start', sessionId: 's1', timestamp: 1, model: 'claude-opus-4-6' }),
        makeEvent({ id: 'e2', type: 'user_prompt', sessionId: 's1', timestamp: 2, text: 'go' }),
        makeEvent({ id: 'e3', type: 'tool_start', sessionId: 's1', timestamp: 3, toolName: 'Task', toolUseId: 'task-1' }),
        makeEvent({ id: 'e4', type: 'agent_start', sessionId: 's1', timestamp: 4, agentId: 'child-1', agentType: 'Explore' }),
        makeEvent({ id: 'e5', type: 'agent_stop', sessionId: 's1', timestamp: 5, agentId: 'child-1' }),
        makeEvent({
          id: 'e6', type: 'tool_end', sessionId: 's1', timestamp: 6,
          toolName: 'Task', toolUseId: 'task-1',
          toolResponse: {
            agentId: 'child-1',
            usage: {
              input_tokens: 1000,
              output_tokens: 500,
              cache_read_input_tokens: 200,
              cache_creation_input_tokens: 50,
              thinking_tokens: 100,
            },
          },
        }),
      ];

      useAgentStore.getState().loadEvents(events);
      const state = useAgentStore.getState();
      const agent = state.agents.get('child-1');

      expect(agent).toBeDefined();
      expect(agent!.tokenUsage.cacheRead).toBe(200);
      expect(agent!.tokenUsage.cacheCreation).toBe(50);
      expect(agent!.tokenUsage.thinking).toBe(100);
      // input = input_tokens + cache_read + cache_creation
      expect(agent!.tokenUsage.input).toBe(1250);
      expect(agent!.tokenUsage.output).toBe(500);
    });

    it('sets model on agent from session when not on event', () => {
      const events: AgentEvent[] = [
        makeEvent({ id: 'e1', type: 'session_start', sessionId: 's1', timestamp: 1, model: 'claude-sonnet-4-5' }),
        makeEvent({ id: 'e2', type: 'agent_start', sessionId: 's1', timestamp: 2, agentId: 'a1', agentType: 'Main' }),
      ];

      useAgentStore.getState().loadEvents(events);
      const state = useAgentStore.getState();
      const agent = state.agents.get('a1');

      expect(agent).toBeDefined();
      expect(agent!.model).toBe('claude-sonnet-4-5');
    });

    it('backfills model on agents when session_start arrives after agent_start', () => {
      // Simulate out-of-order events: agent_start arrives before session_start
      const events: AgentEvent[] = [
        makeEvent({ id: 'e1', type: 'agent_start', sessionId: 's1', timestamp: 1, agentId: 'a1', agentType: 'Main' }),
        makeEvent({ id: 'e2', type: 'session_start', sessionId: 's1', timestamp: 2, model: 'claude-opus-4-6' }),
      ];

      useAgentStore.getState().loadEvents(events);
      const state = useAgentStore.getState();
      const agent = state.agents.get('a1');

      expect(agent).toBeDefined();
      expect(agent!.model).toBe('claude-opus-4-6');
    });

    it('preserves cache/thinking tokens when agent_stop updates tokenUsage', () => {
      const events: AgentEvent[] = [
        makeEvent({ id: 'e1', type: 'session_start', sessionId: 's1', timestamp: 1 }),
        makeEvent({ id: 'e2', type: 'tool_start', sessionId: 's1', timestamp: 2, toolName: 'Task', toolUseId: 'task-1' }),
        makeEvent({ id: 'e3', type: 'agent_start', sessionId: 's1', timestamp: 3, agentId: 'a1', agentType: 'Explore' }),
        // Task tool_end sets cache/thinking tokens
        makeEvent({
          id: 'e4', type: 'tool_end', sessionId: 's1', timestamp: 4,
          toolName: 'Task', toolUseId: 'task-1',
          toolResponse: {
            agentId: 'a1',
            usage: {
              input_tokens: 500,
              output_tokens: 200,
              cache_read_input_tokens: 100,
              cache_creation_input_tokens: 0,
              thinking_tokens: 50,
            },
          },
        }),
        // agent_stop arrives with basic tokenUsage (no cache breakdown)
        makeEvent({
          id: 'e5', type: 'agent_stop', sessionId: 's1', timestamp: 5,
          agentId: 'a1',
          tokenUsage: { input: 800, output: 300 },
        }),
      ];

      useAgentStore.getState().loadEvents(events);
      const state = useAgentStore.getState();
      const agent = state.agents.get('a1');

      expect(agent).toBeDefined();
      // agent_stop token counts take precedence
      expect(agent!.tokenUsage.input).toBe(800);
      expect(agent!.tokenUsage.output).toBe(300);
      // But cache/thinking from earlier Task tool_end are preserved
      expect(agent!.tokenUsage.cacheRead).toBe(100);
      expect(agent!.tokenUsage.thinking).toBe(50);
    });

    it('updates model from agent_stop event', () => {
      const events: AgentEvent[] = [
        makeEvent({ id: 'e1', type: 'session_start', sessionId: 's1', timestamp: 1 }),
        makeEvent({ id: 'e2', type: 'agent_start', sessionId: 's1', timestamp: 2, agentId: 'a1', agentType: 'Main' }),
        makeEvent({ id: 'e3', type: 'agent_stop', sessionId: 's1', timestamp: 3, agentId: 'a1', model: 'claude-haiku-4-5' }),
      ];

      useAgentStore.getState().loadEvents(events);
      const state = useAgentStore.getState();
      const agent = state.agents.get('a1');

      expect(agent!.model).toBe('claude-haiku-4-5');
    });
  });

  // ── Session naming ───────────────────────────────────────────────

  describe('session naming', () => {
    it('should set session title from first user_prompt text', () => {
      const events: AgentEvent[] = [
        makeEvent({ id: 'e1', type: 'session_start', sessionId: 'sess1', timestamp: 1000 }),
        makeEvent({
          id: 'e2', type: 'user_prompt', sessionId: 'sess1', timestamp: 1001,
          text: 'Add dark mode toggle to the settings page with persistent state',
        }),
      ];

      useAgentStore.getState().loadEvents(events);
      const session = useAgentStore.getState().sessions.get('sess1');
      expect(session?.title).toBe('Add dark mode toggle to the settings page wit...');
    });

    it('should not overwrite title from second prompt', () => {
      const events: AgentEvent[] = [
        makeEvent({ id: 'e1', type: 'session_start', sessionId: 'sess1', timestamp: 1000 }),
        makeEvent({ id: 'e2', type: 'user_prompt', sessionId: 'sess1', timestamp: 1001, text: 'First prompt' }),
        makeEvent({ id: 'e3', type: 'user_prompt', sessionId: 'sess1', timestamp: 1002, text: 'Second prompt' }),
      ];

      useAgentStore.getState().loadEvents(events);
      const session = useAgentStore.getState().sessions.get('sess1');
      expect(session?.title).toBe('First prompt');
    });

    it('should set session gitBranch from session_start event', () => {
      const events: AgentEvent[] = [
        makeEvent({ id: 'e1', type: 'session_start', sessionId: 'sess1', timestamp: 1000, gitBranch: 'feat/dark-mode' }),
      ];

      useAgentStore.getState().loadEvents(events);
      const session = useAgentStore.getState().sessions.get('sess1');
      expect(session?.gitBranch).toBe('feat/dark-mode');
    });

    it('should compute topTools from agent tool calls', () => {
      const events: AgentEvent[] = [
        makeEvent({ id: 'e1', type: 'session_start', sessionId: 'sess1', timestamp: 1000 }),
        makeEvent({ id: 'e2', type: 'user_prompt', sessionId: 'sess1', timestamp: 1001, text: 'go' }),
        makeEvent({ id: 'e3', type: 'agent_start', sessionId: 'sess1', timestamp: 1002, agentId: 'a1' }),
        makeEvent({ id: 'e4', type: 'tool_start', sessionId: 'sess1', timestamp: 1003, agentId: 'a1', toolName: 'Read', toolUseId: 'tu1' }),
        makeEvent({ id: 'e5', type: 'tool_end', sessionId: 'sess1', timestamp: 1004, agentId: 'a1', toolName: 'Read', toolUseId: 'tu1' }),
        makeEvent({ id: 'e6', type: 'tool_start', sessionId: 'sess1', timestamp: 1005, agentId: 'a1', toolName: 'Edit', toolUseId: 'tu2' }),
        makeEvent({ id: 'e7', type: 'tool_end', sessionId: 'sess1', timestamp: 1006, agentId: 'a1', toolName: 'Edit', toolUseId: 'tu2' }),
        makeEvent({ id: 'e8', type: 'tool_start', sessionId: 'sess1', timestamp: 1007, agentId: 'a1', toolName: 'Read', toolUseId: 'tu3' }),
        makeEvent({ id: 'e9', type: 'tool_end', sessionId: 'sess1', timestamp: 1008, agentId: 'a1', toolName: 'Read', toolUseId: 'tu3' }),
        makeEvent({ id: 'e10', type: 'tool_start', sessionId: 'sess1', timestamp: 1009, agentId: 'a1', toolName: 'Bash', toolUseId: 'tu4' }),
        makeEvent({ id: 'e11', type: 'tool_end', sessionId: 'sess1', timestamp: 1010, agentId: 'a1', toolName: 'Bash', toolUseId: 'tu4' }),
      ];

      useAgentStore.getState().loadEvents(events);
      const session = useAgentStore.getState().sessions.get('sess1');
      expect(session?.topTools).toEqual(['Read', 'Edit', 'Bash']);
    });
  });

  describe('compaction tracking', () => {
    it('should track compaction count on agents', () => {
      const store = useAgentStore.getState();
      store.addEvent(makeEvent({ id: 'e1', type: 'session_start', sessionId: 's1', timestamp: 1000 }));
      store.addEvent(makeEvent({ id: 'e2', type: 'user_prompt', sessionId: 's1', timestamp: 1001, text: 'test' }));
      store.addEvent(makeEvent({ id: 'e3', type: 'agent_start', sessionId: 's1', agentId: 'a1', timestamp: 1002 }));
      store.addEvent(makeEvent({ id: 'e4', type: 'compact', sessionId: 's1', timestamp: 1003 }));

      const agent = useAgentStore.getState().agents.get('a1');
      expect(agent?.compactionCount).toBe(1);
    });

    it('should increment compaction count on multiple compact events', () => {
      const store = useAgentStore.getState();
      store.addEvent(makeEvent({ id: 'e1', type: 'session_start', sessionId: 's1', timestamp: 1000 }));
      store.addEvent(makeEvent({ id: 'e2', type: 'user_prompt', sessionId: 's1', timestamp: 1001, text: 'test' }));
      store.addEvent(makeEvent({ id: 'e3', type: 'agent_start', sessionId: 's1', agentId: 'a1', timestamp: 1002 }));
      store.addEvent(makeEvent({ id: 'e4', type: 'compact', sessionId: 's1', timestamp: 1003 }));
      store.addEvent(makeEvent({ id: 'e5', type: 'compact', sessionId: 's1', timestamp: 1004 }));

      const agent = useAgentStore.getState().agents.get('a1');
      expect(agent?.compactionCount).toBe(2);
    });
  });

  describe('FIFO validation', () => {
    it('should warn on FIFO mismatch between Task prompt and agent description', () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const store = useAgentStore.getState();

      store.addEvent(makeEvent({ id: 'e1', type: 'session_start', sessionId: 's1', timestamp: 1000 }));
      store.addEvent(makeEvent({ id: 'e2', type: 'user_prompt', sessionId: 's1', timestamp: 1001, text: 'go' }));
      store.addEvent(makeEvent({ id: 'e3', type: 'agent_start', sessionId: 's1', agentId: 'a1', timestamp: 1002 }));
      // Two concurrent Task tools
      store.addEvent(makeEvent({ id: 'e4', type: 'tool_start', sessionId: 's1', agentId: 'a1', toolName: 'Task', toolUseId: 'tu1', timestamp: 1003, toolInput: { prompt: 'Search for auth files' } }));
      store.addEvent(makeEvent({ id: 'e5', type: 'tool_start', sessionId: 's1', agentId: 'a1', toolName: 'Task', toolUseId: 'tu2', timestamp: 1004, toolInput: { prompt: 'Run the test suite' } }));
      // Agent starts with no explicit toolUseId — FIFO assigns tu1, but agent's prompt says "Run the test suite"
      store.addEvent(makeEvent({ id: 'e6', type: 'agent_start', sessionId: 's1', agentId: 'a2', timestamp: 1005, prompt: 'Run the test suite' }));

      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('FIFO mismatch'),
      );
      warnSpy.mockRestore();
    });
  });

  describe('sidechain metadata', () => {
    it('should attach isTaskEdge metadata to Task→Agent edges', () => {
      const store = useAgentStore.getState();
      store.addEvent(makeEvent({ id: 'e1', type: 'session_start', sessionId: 's1', timestamp: 1000 }));
      store.addEvent(makeEvent({ id: 'e2', type: 'user_prompt', sessionId: 's1', timestamp: 1001, text: 'hello' }));
      store.addEvent(makeEvent({ id: 'e3', type: 'agent_start', sessionId: 's1', agentId: 'a1', timestamp: 1002 }));
      store.addEvent(makeEvent({ id: 'e4', type: 'tool_start', sessionId: 's1', agentId: 'a1', toolName: 'Task', toolUseId: 'tu1', timestamp: 1003, toolInput: { prompt: 'Search for auth files' } }));
      store.addEvent(makeEvent({ id: 'e5', type: 'agent_start', sessionId: 's1', agentId: 'a2', toolUseId: 'tu1', timestamp: 1004 }));
      store.addEvent(makeEvent({ id: 'e6', type: 'tool_end', sessionId: 's1', agentId: 'a1', toolName: 'Task', toolUseId: 'tu1', timestamp: 1010, toolResponse: { agentId: 'a2' } }));

      const edges = useAgentStore.getState().edges;
      const taskEdge = edges.find((e) => e.source === 'tool-tu1' && e.target === 'agent-a2');
      expect(taskEdge).toBeDefined();
      expect((taskEdge?.data as Record<string, unknown>)?.isTaskEdge).toBe(true);
    });
  });
});
