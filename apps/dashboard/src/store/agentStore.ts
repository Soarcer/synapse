import { create } from 'zustand';
import type { Node, Edge } from '@xyflow/react';
import type {
  AgentEvent,
  AgentNodeData,
  SessionData,
  ToolCallSummary,
  UserPromptData,
  TranscriptSummary,
  CoachingNudge,
} from '@synapse-ai/core';
import { PALETTES, normalizeCwd } from '@synapse-ai/core';
import { wsClient } from './wsClient';
import { toast } from '../components/Toast';
import { t } from '../i18n';
import { apiUrl } from '../utils/api';

// Module-level empty array to avoid re-render loops (Zustand convention)
const EMPTY_NUDGES: CoachingNudge[] = [];

// ── CWD filter ────────────────────────────────────────────────
/** The project cwd from the URL (null when not embedded with ?cwd=). */
export const projectCwd: string | null = (() => {
  const raw = new URLSearchParams(window.location.search).get('cwd');
  return raw ? normalizeCwd(raw) : null;
})();

import {
  SPAWN_NODE,
  NO_GRAPH_EVENTS,
  nid,
  createFreshDraft,
  draftFromState,
  processEvent,
  buildDerivedMaps,
} from './eventHandlers';

// ── Stable selectors (defined outside functions to avoid re-creation) ────

export const selectEvents = (s: AgentStore) => s.events;
export const selectAgents = (s: AgentStore) => s.agents;
export const selectSessions = (s: AgentStore) => s.sessions;
export const selectSelectedNodeId = (s: AgentStore) => s.selectedNodeId;
export const selectConnectionStatus = (s: AgentStore) => s.connectionStatus;
export const selectIsPaused = (s: AgentStore) => s.paused;

// ── Event cap tracking ───────────────────────────────────────
export const MAX_EVENTS = 1000;
let eventCapToastFired = false;

// ── Binary-search insertion for event ordering ───────────────
function insertEventSorted(events: AgentEvent[], event: AgentEvent, maxSize: number): AgentEvent[] {
  // Events stored newest-first. Find insertion point via binary search.
  let lo = 0;
  let hi = events.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (events[mid].timestamp > event.timestamp) lo = mid + 1;
    else hi = mid;
  }
  const result = [...events.slice(0, lo), event, ...events.slice(lo)];
  if (result.length > maxSize) {
    if (!eventCapToastFired) {
      eventCapToastFired = true;
      toast(t('toast.eventLimit'), 'warning');
    }
    return result.slice(0, maxSize);
  }
  return result;
}

// ── Shared fetch-and-reload ──────────────────────────────────

let reloadAbort: AbortController | null = null;

function reloadAllEvents(): void {
  reloadAbort?.abort();
  reloadAbort = new AbortController();
  const signal = reloadAbort.signal;

  const cwdFilter = useAgentStore.getState().cwdFilter;
  const cwdParam = cwdFilter ? `&cwd=${encodeURIComponent(cwdFilter)}` : '';
  fetch(apiUrl(`/api/events?limit=2000${cwdParam}`), { signal })
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
  pendingTaskTools: Map<string, string[]>;
  taskToolAgentMap: Map<string, string>;
  events: AgentEvent[];
  pauseQueue: AgentEvent[];
  nodes: Node[];
  edges: Edge[];
  selectedNodeId: string | null;
  highlightedNodeIds: Set<string> | null;
  multiHighlightIds: Set<string> | null;
  connectionStatus: 'connected' | 'disconnected' | 'reconnecting' | 'failed';
  filter: { sessionId?: string; agentType?: string };
  showSpawnDialog: boolean;
  paused: boolean;
  layoutMode: 'graph' | 'list';
  showHookEvents: boolean;
  showAllTools: boolean;
  lockViewport: boolean;
  autoClosePrompts: boolean;
  cwdFilterActive: boolean;
  cwdFilter: string | null;
  graphSearchQuery: string;
  collapsedNodes: Set<string>;
  transcripts: Map<string, TranscriptSummary>;
  liveNudges: CoachingNudge[];
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
  setConnectionStatus: (s: 'connected' | 'disconnected' | 'reconnecting' | 'failed') => void;
  setShowSpawnDialog: (show: boolean) => void;
  setPaused: (paused: boolean) => void;
  setLayoutMode: (mode: 'graph' | 'list') => void;
  setShowHookEvents: (show: boolean) => void;
  setShowAllTools: (show: boolean) => void;
  setLockViewport: (lock: boolean) => void;
  setAutoClosePrompts: (v: boolean) => void;
  setCwdFilterActive: (active: boolean) => void;
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
  updateNodeDimensions: (updates: Array<{ id: string; width: number; height: number }>) => void;
  removeNode: (nodeId: string) => void;
  removeSession: (sessionId: string) => void;
  addNudge: (nudge: CoachingNudge) => void;
  dismissNudge: (id: string) => void;
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
  pendingTaskTools: new Map(),
  taskToolAgentMap: new Map(),
  events: [],
  pauseQueue: [],
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
  cwdFilterActive: projectCwd !== null,
  cwdFilter: projectCwd,
  graphSearchQuery: '',
  collapsedNodes: new Set<string>(),
  transcripts: new Map(),
  liveNudges: EMPTY_NUDGES,
  isLoading: true,
  loadError: null,

  // Lens Panel state
  activeLensTab: 'tree',
  lensPanelWidth: 320,
  lensSearchQuery: '',
  profileMetric: 'count',
  paletteIndex: 0,
  selectSource: null,

  // ── addEvent ─────────────────────────────────────────────

  addEvent: (event) => {
    set((state) => {
      // Queue events while paused (don't discard)
      if (state.paused) {
        return { ...state, pauseQueue: [...state.pauseQueue, event] };
      }

      // Fast path: text_delta — only copy agents Map + nodes array
      if (event.type === 'text_delta') {
        const agentId = event.agentId ?? '';
        const agent = state.agents.get(agentId);
        const events = insertEventSorted(state.events, event, MAX_EVENTS);
        if (!agent) {
          return { ...state, events };
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
        return { ...state, agents, nodes, events, ...buildDerivedMaps(agents) };
      }

      const events = insertEventSorted(state.events, event, MAX_EVENTS);

      // Hidden hook events: store event, skip graph processing
      if (event.eventSource === 'hook' && !state.showHookEvents) {
        return { ...state, events };
      }

      // No-op events: store event, skip graph processing
      if (NO_GRAPH_EVENTS.has(event.type)) {
        return { ...state, events };
      }

      const draft = draftFromState(state);
      processEvent(event, draft, state.showHookEvents);
      return { ...state, ...draft, events, ...buildDerivedMaps(draft.agents) };
    });
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

  setCwdFilterActive: (active) => {
    const newFilter = active ? projectCwd : null;
    set({ cwdFilterActive: active, cwdFilter: newFilter });
    reloadAllEvents();
  },

  setPaused: (paused) => {
    if (!paused) {
      // Replay queued events in order, then clear queue
      const queued = get().pauseQueue;
      set({ paused: false, pauseQueue: [] });
      for (const event of queued) {
        get().addEvent(event);
      }
    } else {
      set({ paused: true });
    }
  },

  // ── updateNodeDimensions (from React Flow measurement) ───

  updateNodeDimensions: (updates) => {
    set((state) => {
      const updateMap = new Map(updates.map((u) => [u.id, u]));
      let changed = false;
      const nodes = state.nodes.map((node) => {
        const u = updateMap.get(node.id);
        if (!u) return node;
        if (node.measured?.width === u.width && node.measured?.height === u.height) return node;
        changed = true;
        return { ...node, measured: { width: u.width, height: u.height } };
      });
      return changed ? { nodes } : {};
    });
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
        for (const [, pList] of prompts) {
          const filtered = pList.filter((p) => p.id !== pid);
          if (filtered.length !== pList.length) prompts.set(pList[0]?.id ?? '', filtered);
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

  // ── Coaching nudges ─────────────────────────────────────────

  addNudge: (nudge) =>
    set((s) => {
      const updated = [...s.liveNudges, nudge];
      // Cap at 50 nudges to prevent unbounded growth
      return { liveNudges: updated.length > 50 ? updated.slice(-50) : updated };
    }),

  dismissNudge: (id) =>
    set((s) => ({
      liveNudges: s.liveNudges.map((n) => (n.id === id ? { ...n, dismissed: true } : n)),
    })),

  // ── clearEvents / loadEvents (batched — single set()) ────

  clearEvents: () => {
    eventCapToastFired = false;
    set({
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
      pauseQueue: [],
      nodes: [{ ...SPAWN_NODE }],
      edges: [],
      selectedNodeId: null,
      highlightedNodeIds: null,
      multiHighlightIds: null,
      collapsedNodes: new Set(),
      liveNudges: EMPTY_NUDGES,
    });
  },

  loadEvents: (events) => {
    eventCapToastFired = false;
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
      events: sorted.reverse().slice(0, MAX_EVENTS),
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

    // Skip events from other projects when cwd filter is active
    const cwdFilter = useAgentStore.getState().cwdFilter;
    if (cwdFilter && event.cwd && normalizeCwd(event.cwd) !== cwdFilter) return;

    useAgentStore.getState().addEvent(event);

    // Toast notifications for key events (with nodeId for click-to-focus)
    if (event.type === 'agent_start') {
      const agentId = event.agentId ?? event.id;
      toast(`Agent started: ${event.agentType ?? 'unknown'}`, 'info', nid.agent(agentId));
    } else if (event.type === 'agent_stop') {
      const agentId = event.agentId ?? event.id;
      toast(
        `Agent ${event.status === 'error' ? 'failed' : 'completed'}: ${event.agentType ?? 'unknown'}`,
        event.status === 'error' ? 'error' : 'success',
        nid.agent(agentId),
      );
    } else if (event.type === 'user_prompt') {
      const preview = (event.text ?? '').slice(0, 60);
      toast(
        `Prompt: ${preview}${(event.text?.length ?? 0) > 60 ? '...' : ''}`,
        'info',
        nid.prompt(event.id),
      );
    }
  } else if (msg.type === 'agent_text') {
    // Look up the agent's sessionId for proper filtering
    const agentData = useAgentStore.getState().agents.get(msg.data.agentId);
    const sessionId = agentData?.sessionId ?? '';
    useAgentStore.getState().addEvent({
      id: `text-${Date.now()}`,
      type: 'text_delta',
      sessionId,
      agentId: msg.data.agentId,
      text: msg.data.text,
      timestamp: Date.now(),
    });
  } else if (msg.type === 'coaching_nudge') {
    useAgentStore.getState().addNudge(msg.data);
    toast(`Coach: ${msg.data.title}`, msg.data.severity === 'warning' ? 'warning' : 'info');
  } else if (msg.type === 'stale') {
    // Server signals missed events due to backpressure — do full reload
    reloadAllEvents();
  }
});

wsClient.setOnStatusChange((status) => {
  useAgentStore.getState().setConnectionStatus(status);
});

wsClient.setOnReconnect(() => {
  reloadAllEvents();
});
