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
    events: [],
    nodes: [...initialState.nodes.filter((n) => n.id === '__spawn__')],
    edges: [],
    selectedNodeId: null,
    highlightedNodeIds: null,
    multiHighlightIds: null,
    connectionStatus: 'disconnected',
    filter: {},
    showSpawnDialog: false,
    paused: false,
    layoutMode: 'graph',
    showHookEvents: true,
    showAllTools: false,
    lockViewport: true,
    autoClosePrompts: false,
    graphSearchQuery: '',
    collapsedNodes: new Set(),
    transcripts: new Map(),
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
    expect(state.layoutMode).toBe('graph');
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
});
