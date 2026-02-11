import { create } from 'zustand';
import type { Node, Edge } from '@xyflow/react';
import type {
  AgentEvent,
  AgentNodeData,
  SessionData,
  ToolCallSummary,
  UserPromptData,
} from '../types/agent';
import type { TranscriptSummary } from '../types/transcript';
import { wsClient } from './wsClient';
import { toast } from '../components/Toast';
import { PALETTES } from '../utils/format';
import { apiUrl } from '../utils/api';
import {
  SPAWN_NODE,
  NO_GRAPH_EVENTS,
  nid,
  createFreshDraft,
  draftFromState,
  processEvent,
  buildDerivedMaps,
} from './eventHandlers';

// ── Shared fetch-and-reload ──────────────────────────────────

let reloadAbort: AbortController | null = null;

function reloadAllEvents(): void {
  reloadAbort?.abort();
  reloadAbort = new AbortController();
  const signal = reloadAbort.signal;

  fetch(apiUrl('/api/events?limit=2000'), { signal })
    .then((r) => r.json())
    .then((data) => {
      const events = Array.isArray(data) ? data : data?.events;
      if (Array.isArray(events)) {
        useAgentStore.getState().loadEvents(events);
      }
    })
    .catch((err: unknown) => {
      if (err instanceof Error && err.name === 'AbortError') return;
    });
}

// ── Store interface ──────────────────────────────────────────

interface AgentStore {
  sessions: Map<string, SessionData>;
  agents: Map<string, AgentNodeData>;
  agentsBySession: Map<string, AgentNodeData[]>;
  childAgents: Map<string, AgentNodeData[]>;
  toolCalls: Map<string, ToolCallSummary[]>;
  prompts: Map<string, UserPromptData[]>;
  activeAgents: Map<string, string[]>;
  toolAgentMap: Map<string, string>;
  events: AgentEvent[];
  nodes: Node[];
  edges: Edge[];
  selectedNodeId: string | null;
  highlightedNodeIds: Set<string> | null;
  multiHighlightIds: Set<string> | null;
  connectionStatus: 'connected' | 'disconnected' | 'reconnecting';
  filter: { sessionId?: string; agentType?: string };
  showSpawnDialog: boolean;
  paused: boolean;
  layoutMode: 'graph' | 'list';
  showHookEvents: boolean;
  showAllTools: boolean;
  lockViewport: boolean;
  autoClosePrompts: boolean;
  graphSearchQuery: string;
  collapsedNodes: Set<string>;
  transcripts: Map<string, TranscriptSummary>;
  isLoading: boolean;
  loadError: string | null;

  // Lens Panel state
  activeLensTab: string;
  lensPanelWidth: number;
  lensSearchQuery: string;
  profileMetric: 'tokens' | 'duration' | 'count';
  paletteIndex: number;
  selectSource: 'graph' | 'lens' | null;

  // Actions
  addEvent: (event: AgentEvent) => void;
  selectNode: (id: string | null, source?: 'graph' | 'lens') => void;
  setFilter: (filter: { sessionId?: string; agentType?: string }) => void;
  setConnectionStatus: (s: 'connected' | 'disconnected' | 'reconnecting') => void;
  setShowSpawnDialog: (show: boolean) => void;
  setPaused: (paused: boolean) => void;
  setLayoutMode: (mode: 'graph' | 'list') => void;
  setShowHookEvents: (show: boolean) => void;
  setShowAllTools: (show: boolean) => void;
  setLockViewport: (lock: boolean) => void;
  setAutoClosePrompts: (v: boolean) => void;
  setGraphSearchQuery: (query: string) => void;
  toggleCollapsed: (nodeId: string) => void;
  expandNode: (nodeId: string) => void;
  setHighlightedNodeIds: (ids: Set<string> | null) => void;
  setMultiHighlight: (ids: Set<string> | null) => void;
  setActiveLensTab: (tab: string) => void;
  setLensPanelWidth: (width: number) => void;
  setLensSearchQuery: (query: string) => void;
  setProfileMetric: (metric: 'tokens' | 'duration' | 'count') => void;
  cyclePalette: () => void;
  setTranscript: (sessionId: string, data: TranscriptSummary) => void;
  setLoading: (loading: boolean) => void;
  setLoadError: (error: string | null) => void;
  removeNode: (nodeId: string) => void;
  removeSession: (sessionId: string) => void;
  clearEvents: () => void;
  loadEvents: (events: AgentEvent[]) => void;
}

// ── Store ────────────────────────────────────────────────────

export const useAgentStore = create<AgentStore>((set, get) => ({
  sessions: new Map(),
  agents: new Map(),
  agentsBySession: new Map(),
  childAgents: new Map(),
  toolCalls: new Map(),
  prompts: new Map(),
  activeAgents: new Map(),
  toolAgentMap: new Map(),
  events: [],
  nodes: [{ ...SPAWN_NODE }],
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
  collapsedNodes: new Set<string>(),
  transcripts: new Map(),
  isLoading: true,
  loadError: null,

  // Lens Panel state
  activeLensTab: 'tree',
  lensPanelWidth: 320,
  lensSearchQuery: '',
  profileMetric: 'tokens',
  paletteIndex: 0,
  selectSource: null,

  // ── addEvent ─────────────────────────────────────────────

  addEvent: (event) => {
    const state = get();
    if (state.paused) return;

    // Fast path: text_delta — only copy agents Map + nodes array
    if (event.type === 'text_delta') {
      const agentId = event.agentId ?? '';
      const agent = state.agents.get(agentId);
      const events = [event, ...state.events].slice(0, 1000);
      if (!agent) {
        set({ events });
        return;
      }
      const updated = {
        ...agent,
        streamingText: (agent.streamingText ?? '') + (event.text ?? ''),
      };
      const agents = new Map(state.agents);
      agents.set(agentId, updated);
      const nodes = state.nodes.map((n) =>
        n.id === nid.agent(agentId) ? { ...n, data: { agent: updated } } : n,
      );
      set({ agents, nodes, events, ...buildDerivedMaps(agents) });
      return;
    }

    const events = [event, ...state.events].slice(0, 1000);

    // Hidden hook events: store event, skip graph processing
    if (event.eventSource === 'hook' && !state.showHookEvents) {
      set({ events });
      return;
    }

    // No-op events: store event, skip graph processing
    if (NO_GRAPH_EVENTS.has(event.type)) {
      set({ events });
      return;
    }

    const draft = draftFromState(state);
    processEvent(event, draft, state.showHookEvents);
    set({ ...draft, events, ...buildDerivedMaps(draft.agents) });
  },

  // ── Simple setters ───────────────────────────────────────

  selectNode: (id, source) => set({ selectedNodeId: id, selectSource: source ?? null, multiHighlightIds: null }),

  setFilter: (filter) => set({ filter }),

  setConnectionStatus: (connectionStatus) => set({ connectionStatus }),

  setShowSpawnDialog: (showSpawnDialog) => set({ showSpawnDialog }),

  setLayoutMode: (layoutMode) => set({ layoutMode }),

  setLoading: (loading) => set({ isLoading: loading }),
  setLoadError: (error) => set({ loadError: error }),

  setAutoClosePrompts: (autoClosePrompts) => set({ autoClosePrompts }),
  setGraphSearchQuery: (graphSearchQuery) => set({ graphSearchQuery }),

  toggleCollapsed: (nodeId) => {
    const s = new Set(get().collapsedNodes);
    if (s.has(nodeId)) s.delete(nodeId);
    else s.add(nodeId);
    set({ collapsedNodes: s });
  },

  expandNode: (nodeId) => {
    const s = get().collapsedNodes;
    if (!s.has(nodeId)) return;
    const next = new Set(s);
    next.delete(nodeId);
    set({ collapsedNodes: next });
  },
  setHighlightedNodeIds: (highlightedNodeIds) => set({ highlightedNodeIds }),
  setMultiHighlight: (multiHighlightIds) => set({ multiHighlightIds }),

  setActiveLensTab: (activeLensTab) => set({ activeLensTab }),
  setLensPanelWidth: (lensPanelWidth) => set({ lensPanelWidth }),
  setLensSearchQuery: (lensSearchQuery) => set({ lensSearchQuery }),
  setProfileMetric: (profileMetric) => set({ profileMetric }),
  cyclePalette: () => set((s) => ({ paletteIndex: (s.paletteIndex + 1) % PALETTES.length })),

  setTranscript: (sessionId, data) => {
    const transcripts = new Map(get().transcripts);
    transcripts.set(sessionId, data);
    set({ transcripts });
  },

  setShowHookEvents: (showHookEvents) => {
    set({ showHookEvents });
    reloadAllEvents();
  },

  setShowAllTools: (showAllTools) => set({ showAllTools }),

  setLockViewport: (lockViewport) => set({ lockViewport }),

  setPaused: (paused) => {
    set({ paused });
    if (!paused) reloadAllEvents();
  },

  // ── removeNode (BFS with adjacency map) ──────────────────

  removeNode: (nodeId) => {
    const state = get();
    if (nodeId === SPAWN_NODE.id) return;

    // Build source→targets adjacency map for efficient BFS
    const childrenOf = new Map<string, string[]>();
    for (const edge of state.edges) {
      const list = childrenOf.get(edge.source);
      if (list) list.push(edge.target);
      else childrenOf.set(edge.source, [edge.target]);
    }

    // BFS to collect node + all descendants
    const removeIds = new Set<string>();
    const queue = [nodeId];
    while (queue.length > 0) {
      const current = queue.shift()!;
      removeIds.add(current);
      for (const child of childrenOf.get(current) ?? []) {
        if (!removeIds.has(child)) queue.push(child);
      }
    }

    // Clean up store maps
    const sessions = new Map(state.sessions);
    const agents = new Map(state.agents);
    const toolCalls = new Map(state.toolCalls);
    const prompts = new Map(state.prompts);

    for (const rid of removeIds) {
      if (rid.startsWith('session-')) {
        const sid = rid.slice('session-'.length);
        sessions.delete(sid);
        prompts.delete(sid);
        fetch(apiUrl(`/api/events/session/${sid}`), { method: 'DELETE' }).catch(() => {});
      } else if (rid.startsWith('agent-')) {
        const aid = rid.slice('agent-'.length);
        agents.delete(aid);
        toolCalls.delete(aid);
      } else if (rid.startsWith('prompt-')) {
        const pid = rid.slice('prompt-'.length);
        for (const [sid, pList] of prompts) {
          const filtered = pList.filter((p) => p.id !== pid);
          if (filtered.length !== pList.length) prompts.set(sid, filtered);
        }
      } else if (rid.startsWith('tool-')) {
        const tid = rid.slice('tool-'.length);
        for (const [key, tcs] of toolCalls) {
          const filtered = tcs.filter((tc) => tc.toolUseId !== tid);
          if (filtered.length !== tcs.length) toolCalls.set(key, filtered);
        }
      }
    }

    // Sync agent.toolCalls for remaining agents
    for (const [aid, agent] of agents) {
      const filtered = agent.toolCalls.filter(
        (tc) => !removeIds.has(nid.tool(tc.toolUseId)),
      );
      if (filtered.length !== agent.toolCalls.length) {
        agents.set(aid, { ...agent, toolCalls: filtered });
      }
    }

    const nodes = state.nodes.filter((n) => !removeIds.has(n.id));
    const edges = state.edges.filter(
      (e) => !removeIds.has(e.source) && !removeIds.has(e.target),
    );

    // Filter events for removed sessions
    const removedSessionIds = new Set<string>();
    for (const rid of removeIds) {
      if (rid.startsWith('session-')) removedSessionIds.add(rid.slice('session-'.length));
    }
    const events =
      removedSessionIds.size > 0
        ? state.events.filter((e) => !removedSessionIds.has(e.sessionId))
        : state.events;

    set({
      sessions,
      agents,
      ...buildDerivedMaps(agents),
      toolCalls,
      prompts,
      events,
      nodes,
      edges,
      selectedNodeId:
        state.selectedNodeId && removeIds.has(state.selectedNodeId)
          ? null
          : state.selectedNodeId,
    });
  },

  removeSession: (sessionId) => {
    get().removeNode(nid.session(sessionId));
  },

  // ── clearEvents / loadEvents (batched — single set()) ────

  clearEvents: () =>
    set({
      sessions: new Map(),
      agents: new Map(),
      agentsBySession: new Map(),
      childAgents: new Map(),
      toolCalls: new Map(),
      prompts: new Map(),
      activeAgents: new Map(),
      toolAgentMap: new Map(),
      events: [],
      nodes: [{ ...SPAWN_NODE }],
      edges: [],
      selectedNodeId: null,
      highlightedNodeIds: null,
      multiHighlightIds: null,
      collapsedNodes: new Set(),
    }),

  loadEvents: (events) => {
    const { showHookEvents } = get();
    const draft = createFreshDraft();
    const sorted = [...events].sort((a, b) => a.timestamp - b.timestamp);
    for (const event of sorted) {
      processEvent(event, draft, showHookEvents);
    }
    // Events stored newest-first for timeline display
    set({
      ...draft,
      ...buildDerivedMaps(draft.agents),
      events: sorted.reverse().slice(0, 1000),
      selectedNodeId: null,
      highlightedNodeIds: null,
      multiHighlightIds: null,
      collapsedNodes: new Set(),
    });
  },
}));

// ── Wire WebSocket to store ──────────────────────────────────

wsClient.setOnEvent((msg) => {
  if (msg.type === 'event') {
    const event = msg.data;
    useAgentStore.getState().addEvent(event);

    // Toast notifications for key events
    if (event.type === 'agent_start') {
      toast(`Agent started: ${event.agentType ?? 'unknown'}`, 'info');
    } else if (event.type === 'agent_stop') {
      toast(
        `Agent ${event.status === 'error' ? 'failed' : 'completed'}: ${event.agentType ?? 'unknown'}`,
        event.status === 'error' ? 'error' : 'success',
      );
    } else if (event.type === 'user_prompt') {
      const preview = (event.text ?? '').slice(0, 60);
      toast(`Prompt: ${preview}${(event.text?.length ?? 0) > 60 ? '...' : ''}`, 'info');
    }
  } else if (msg.type === 'agent_text') {
    useAgentStore.getState().addEvent({
      id: `text-${Date.now()}`,
      type: 'text_delta',
      sessionId: '',
      agentId: msg.data.agentId,
      text: msg.data.text,
      timestamp: Date.now(),
    });
  }
});

wsClient.setOnStatusChange((status) => {
  useAgentStore.getState().setConnectionStatus(status);
});

wsClient.setOnReconnect(() => {
  reloadAllEvents();
});
