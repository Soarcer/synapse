// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Bernhard

import { create } from 'zustand';
import type { Node, Edge } from '@xyflow/react';
import type {
  AgentEvent,
  AgentNodeData,
  SessionData,
  ToolCallSummary,
  UserPromptData,
  TranscriptSummary,
  ReasoningData,
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

// ── View settings persistence ────────────────────────────────
const VIEW_SETTINGS_KEY = 'synapse-view-settings';

interface PersistedViewSettings {
  showHookEvents?: boolean;
  showAllTools?: boolean;
  toolGroupMode?: string;
  lockViewport?: boolean;
  autoClosePrompts?: boolean;
  arcadeUnlocked?: boolean;
  arcadeMode?: boolean;
  arcadeSoundEnabled?: boolean;
  arcadeVolume?: number;
}

const savedViewSettings: PersistedViewSettings = (() => {
  try {
    const raw = localStorage.getItem(VIEW_SETTINGS_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
})();

function persistViewSettings(partial: Partial<PersistedViewSettings>) {
  try {
    const current = JSON.parse(localStorage.getItem(VIEW_SETTINGS_KEY) ?? '{}');
    localStorage.setItem(VIEW_SETTINGS_KEY, JSON.stringify({ ...current, ...partial }));
  } catch {
    /* quota exceeded */
  }
}

// ── Time filter persistence ──────────────────────────────────
const TIME_FILTER_KEY = 'synapse-time-filter';

/** Recompute a fresh time range from a preset label (ranges are relative to "now"). */
function computeTimeRange(label: string): { from: number; to: number } | null {
  const now = Date.now();
  switch (label) {
    case 'Last hour':
      return { from: now - 3_600_000, to: now };
    case 'Last 4 hours':
      return { from: now - 14_400_000, to: now };
    case 'Today': {
      const d = new Date();
      d.setHours(0, 0, 0, 0);
      return { from: d.getTime(), to: now };
    }
    case 'This week': {
      const d = new Date();
      d.setHours(0, 0, 0, 0);
      d.setDate(d.getDate() - d.getDay());
      return { from: d.getTime(), to: now };
    }
    case 'Last 30 days':
      return { from: now - 30 * 86_400_000, to: now };
    default:
      return null;
  }
}

const savedTimeLabel = (() => {
  try {
    return localStorage.getItem(TIME_FILTER_KEY) ?? 'All time';
  } catch {
    return 'All time';
  }
})();

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

export function reloadAllEvents(options?: { showLoading?: boolean }): void {
  reloadAbort?.abort();
  reloadAbort = new AbortController();
  const signal = reloadAbort.signal;

  const { cwdFilter, timePresetLabel } = useAgentStore.getState();
  // Recompute fresh time range from preset label so sliding windows stay current
  const timeRange = computeTimeRange(timePresetLabel);
  useAgentStore.setState({ timeRange });
  if (options?.showLoading) {
    useAgentStore.getState().setLoading(true);
    useAgentStore.getState().setLoadError(null);
  }
  const params = new URLSearchParams({ limit: '2000' });
  if (cwdFilter) params.set('cwd', cwdFilter);
  if (timeRange) {
    params.set('from', String(timeRange.from));
    params.set('to', String(timeRange.to));
  }
  fetch(apiUrl(`/api/events?${params}`), { signal })
    .then((r) => r.json())
    .then((data) => {
      const events = Array.isArray(data) ? data : data?.events;
      if (Array.isArray(events)) {
        useAgentStore.getState().loadEvents(events);
      }
      if (options?.showLoading) {
        useAgentStore.getState().setLoading(false);
      }
    })
    .catch((err: unknown) => {
      if (err instanceof Error && err.name === 'AbortError') return;
      if (options?.showLoading) {
        useAgentStore
          .getState()
          .setLoadError(err instanceof Error ? err.message : 'Failed to connect to server');
        useAgentStore.getState().setLoading(false);
      }
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
  filter: { sessionId?: string; agentType?: string; vendor?: string };
  showSpawnDialog: boolean;
  showWorkshop: boolean;
  paused: boolean;
  showHookEvents: boolean;
  showAllTools: boolean;
  toolGroupMode: string;
  arcadeUnlocked: boolean;
  arcadeMode: boolean;
  arcadeSoundEnabled: boolean;
  arcadeVolume: number;
  lockViewport: boolean;
  autoClosePrompts: boolean;
  cwdFilter: string | null;
  timeRange: { from: number; to: number } | null;
  timePresetLabel: string;
  graphSearchQuery: string;
  collapsedNodes: Set<string>;
  transcripts: Map<string, TranscriptSummary>;
  transcriptReasoning: Map<string, ReasoningData>;
  liveNudges: CoachingNudge[];
  isLoading: boolean;
  loadError: string | null;

  // Lens Panel state
  lensVisible: boolean;
  activeLensTab: string;
  lensPanelWidth: number;
  lensSearchQuery: string;
  profileMetric: 'tokens' | 'duration' | 'count';
  paletteIndex: number;
  selectSource: 'graph' | 'lens' | null;

  // Actions
  addEvent: (event: AgentEvent) => void;
  selectNode: (id: string | null, source?: 'graph' | 'lens') => void;
  setFilter: (filter: { sessionId?: string; agentType?: string; vendor?: string }) => void;
  setConnectionStatus: (s: 'connected' | 'disconnected' | 'reconnecting' | 'failed') => void;
  setShowSpawnDialog: (show: boolean) => void;
  setShowWorkshop: (show: boolean) => void;
  setPaused: (paused: boolean) => void;
  setShowHookEvents: (show: boolean) => void;
  setShowAllTools: (show: boolean) => void;
  setToolGroupMode: (mode: string) => void;
  setArcadeUnlocked: (unlocked: boolean) => void;
  setArcadeMode: (on: boolean) => void;
  setArcadeSoundEnabled: (on: boolean) => void;
  setArcadeVolume: (vol: number) => void;
  setLockViewport: (lock: boolean) => void;
  setAutoClosePrompts: (v: boolean) => void;
  setTimeRange: (range: { from: number; to: number } | null, label: string) => void;
  setGraphSearchQuery: (query: string) => void;
  toggleCollapsed: (nodeId: string) => void;
  expandNode: (nodeId: string) => void;
  setHighlightedNodeIds: (ids: Set<string> | null) => void;
  setMultiHighlight: (ids: Set<string> | null) => void;
  setLensVisible: (visible: boolean) => void;
  setActiveLensTab: (tab: string) => void;
  setLensPanelWidth: (width: number) => void;
  setLensSearchQuery: (query: string) => void;
  setProfileMetric: (metric: 'tokens' | 'duration' | 'count') => void;
  cyclePalette: () => void;
  setTranscript: (sessionId: string, data: TranscriptSummary) => void;
  setTranscriptReasoning: (sessionId: string, data: ReasoningData) => void;
  setLoading: (loading: boolean) => void;
  setLoadError: (error: string | null) => void;
  updateNodeDimensions: (updates: Array<{ id: string; width: number; height: number }>) => void;
  removeNode: (nodeId: string) => void;
  removeSession: (sessionId: string) => void;
  addNudge: (nudge: CoachingNudge) => void;
  dismissNudge: (id: string) => void;
  undismissNudge: (id: string) => void;
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
  showWorkshop: false,
  paused: false,
  showHookEvents: savedViewSettings.showHookEvents ?? true,
  showAllTools: savedViewSettings.showAllTools ?? true,
  toolGroupMode: savedViewSettings.toolGroupMode ?? 'heatmap',
  arcadeUnlocked: savedViewSettings.arcadeUnlocked ?? savedViewSettings.arcadeMode ?? false,
  arcadeMode: savedViewSettings.arcadeMode ?? false,
  arcadeSoundEnabled: savedViewSettings.arcadeSoundEnabled ?? false,
  arcadeVolume: savedViewSettings.arcadeVolume ?? 15,
  lockViewport: savedViewSettings.lockViewport ?? false,
  autoClosePrompts: savedViewSettings.autoClosePrompts ?? false,
  cwdFilter: projectCwd,
  timeRange: computeTimeRange(savedTimeLabel),
  timePresetLabel: savedTimeLabel,
  graphSearchQuery: '',
  collapsedNodes: new Set<string>(),
  transcripts: new Map(),
  transcriptReasoning: new Map(),
  liveNudges: EMPTY_NUDGES,
  isLoading: true,
  loadError: null,

  // Lens Panel state
  lensVisible: true,
  activeLensTab: 'treemap',
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

      // Dedup: skip events already in the store (protects against WS + HTTP load races
      // and duplicate broadcasts from overlapping hook sources)
      if (event.type !== 'text_delta' && state.events.some((e) => e.id === event.id)) {
        return state;
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
        return { ...state, agents, nodes, events, ...buildDerivedMaps(agents, state.sessions) };
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
      return { ...state, ...draft, events, ...buildDerivedMaps(draft.agents, draft.sessions) };
    });
  },

  // ── Simple setters ───────────────────────────────────────

  selectNode: (id, source) =>
    set({ selectedNodeId: id, selectSource: source ?? null, multiHighlightIds: null }),

  setFilter: (filter) => set({ filter }),

  setConnectionStatus: (connectionStatus) => {
    if (connectionStatus === get().connectionStatus) return;
    set({ connectionStatus });
  },

  setShowSpawnDialog: (showSpawnDialog) => set({ showSpawnDialog }),
  setShowWorkshop: (showWorkshop) => set({ showWorkshop }),

  setLoading: (loading) => set({ isLoading: loading }),
  setLoadError: (error) => set({ loadError: error }),

  setAutoClosePrompts: (autoClosePrompts) => {
    persistViewSettings({ autoClosePrompts });
    set({ autoClosePrompts });
  },
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
  setHighlightedNodeIds: (highlightedNodeIds) => {
    if (highlightedNodeIds === get().highlightedNodeIds) return;
    set({ highlightedNodeIds });
  },
  setMultiHighlight: (multiHighlightIds) => set({ multiHighlightIds }),

  setLensVisible: (lensVisible) => set({ lensVisible }),
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

  setTranscriptReasoning: (sessionId, data) => {
    const transcriptReasoning = new Map(get().transcriptReasoning);
    transcriptReasoning.set(sessionId, data);
    set({ transcriptReasoning });
  },

  setShowHookEvents: (showHookEvents) => {
    persistViewSettings({ showHookEvents });
    set({ showHookEvents });
    reloadAllEvents();
  },

  setShowAllTools: (showAllTools) => {
    persistViewSettings({ showAllTools });
    set({ showAllTools });
  },
  setToolGroupMode: (toolGroupMode) => {
    persistViewSettings({ toolGroupMode });
    set({ toolGroupMode });
  },
  setArcadeUnlocked: (arcadeUnlocked) => {
    persistViewSettings({ arcadeUnlocked });
    set({ arcadeUnlocked });
  },
  setArcadeMode: (arcadeMode) => {
    persistViewSettings({ arcadeMode });
    set({ arcadeMode });
  },
  setArcadeSoundEnabled: (arcadeSoundEnabled) => {
    persistViewSettings({ arcadeSoundEnabled });
    set({ arcadeSoundEnabled });
  },
  setArcadeVolume: (arcadeVolume) => {
    persistViewSettings({ arcadeVolume });
    set({ arcadeVolume });
  },

  setLockViewport: (lockViewport) => {
    persistViewSettings({ lockViewport });
    set({ lockViewport });
  },

  setTimeRange: (range, label) => {
    try {
      localStorage.setItem(TIME_FILTER_KEY, label);
    } catch {
      /* quota exceeded */
    }
    set({ timeRange: range, timePresetLabel: label });
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
      const filtered = agent.toolCalls.filter((tc) => !removeIds.has(nid.tool(tc.toolUseId)));
      if (filtered.length !== agent.toolCalls.length) {
        agents.set(aid, { ...agent, toolCalls: filtered });
      }
    }

    const nodes = state.nodes.filter((n) => !removeIds.has(n.id));
    const edges = state.edges.filter((e) => !removeIds.has(e.source) && !removeIds.has(e.target));

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
      ...buildDerivedMaps(agents, sessions),
      toolCalls,
      prompts,
      events,
      nodes,
      edges,
      selectedNodeId:
        state.selectedNodeId && removeIds.has(state.selectedNodeId) ? null : state.selectedNodeId,
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

  undismissNudge: (id) =>
    set((s) => ({
      liveNudges: s.liveNudges.map((n) => (n.id === id ? { ...n, dismissed: false } : n)),
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
      transcripts: new Map(),
      transcriptReasoning: new Map(),
      liveNudges: EMPTY_NUDGES,
    });
  },

  loadEvents: (events) => {
    eventCapToastFired = false;
    const prevState = get();
    const { showHookEvents } = prevState;
    const draft = createFreshDraft();
    const sorted = [...events].sort((a, b) => a.timestamp - b.timestamp);
    // Content-based dedup: the DB may contain duplicate events from multiple hook
    // sources (same logical event stored twice with different nanoid IDs).
    const deduped = deduplicateEvents(sorted);
    for (const event of deduped) {
      processEvent(event, draft, showHookEvents);
    }

    // Preserve measured dimensions from previous state so React Flow doesn't
    // flash nodes at default sizes before re-measuring. This prevents the
    // double-layout flicker on periodic reloads (sliding time window refresh).
    const prevMeasured = new Map<string, { width: number; height: number }>();
    for (const node of prevState.nodes) {
      if (node.measured?.width && node.measured?.height) {
        prevMeasured.set(node.id, { width: node.measured.width, height: node.measured.height });
      }
    }
    if (prevMeasured.size > 0) {
      draft.nodes = draft.nodes.map((n) => {
        const m = prevMeasured.get(n.id);
        return m ? { ...n, measured: m } : n;
      });
    }

    // Events stored newest-first for timeline display
    set({
      ...draft,
      ...buildDerivedMaps(draft.agents, draft.sessions),
      events: deduped.reverse().slice(0, MAX_EVENTS),
      selectedNodeId: null,
      highlightedNodeIds: null,
      multiHighlightIds: null,
      collapsedNodes: new Set(),
      transcripts: new Map(),
      transcriptReasoning: new Map(),
      liveNudges: EMPTY_NUDGES,
    });
  },
}));

// ── Content-based event fingerprint (shared by WS dedup + loadEvents dedup) ──

function eventFingerprint(event: AgentEvent): string {
  // Use the most specific stable identifier per event type.
  // toolUseId and agentId are stable across hook sources (same stdin from Claude Code).
  if (event.toolUseId) return `${event.sessionId}:${event.type}:${event.toolUseId}`;
  if (event.agentId) return `${event.sessionId}:${event.type}:${event.agentId}`;
  // For prompts, include text so two different rapid prompts aren't falsely deduped
  if (event.type === 'user_prompt')
    return `${event.sessionId}:user_prompt:${(event.text ?? '').slice(0, 200)}`;
  // Fallback: session-level events (session_start, session_end, compact, etc.)
  return `${event.sessionId}:${event.type}`;
}

/** Filter duplicate events from a timestamp-sorted array (ascending).
 *  Two events with the same fingerprint within 2s are considered duplicates. */
const LOAD_DEDUPE_WINDOW_MS = 2000;
function deduplicateEvents(sorted: AgentEvent[]): AgentEvent[] {
  const seen = new Map<string, number>(); // fingerprint → timestamp
  return sorted.filter((event) => {
    const fp = eventFingerprint(event);
    const prev = seen.get(fp);
    if (prev !== undefined && event.timestamp - prev < LOAD_DEDUPE_WINDOW_MS) return false;
    seen.set(fp, event.timestamp);
    return true;
  });
}

// ── Content-based dedup for live WS events ──────────────────
// Two hook sources (settings.json + settings.local.json) can broadcast the same
// logical event with different nanoid() IDs. Match on session + type + timestamp.
const WS_DEDUPE_WINDOW_MS = 3000;
const recentWsEvents = new Map<string, number>(); // fingerprint → timestamp

function wsDedupeKey(event: AgentEvent): string {
  const base = `${event.sessionId}:${event.type}:${event.toolUseId ?? ''}:${event.agentId ?? ''}`;
  // For user_prompt, include text so two different rapid prompts aren't falsely deduped
  // (toolUseId and agentId are both empty for prompts)
  if (event.type === 'user_prompt') return `${base}:${(event.text ?? '').slice(0, 200)}`;
  return base;
}

function isWsDuplicate(event: AgentEvent): boolean {
  // text_delta events are high-frequency and already keyed by content
  if (event.type === 'text_delta') return false;

  const key = wsDedupeKey(event);
  const now = Date.now();

  // Prune stale entries
  if (recentWsEvents.size > 200) {
    for (const [k, ts] of recentWsEvents) {
      if (now - ts > WS_DEDUPE_WINDOW_MS) recentWsEvents.delete(k);
    }
  }

  const prev = recentWsEvents.get(key);
  if (prev && now - prev < WS_DEDUPE_WINDOW_MS) {
    return true;
  }
  recentWsEvents.set(key, now);
  return false;
}

// ── Wire WebSocket to store ──────────────────────────────────

wsClient.setOnEvent((msg) => {
  if (msg.type === 'event') {
    const event = msg.data;

    // Skip events from other projects when cwd filter is active
    const { cwdFilter, timePresetLabel } = useAgentStore.getState();
    if (cwdFilter && event.cwd && normalizeCwd(event.cwd) !== cwdFilter) return;

    // Skip events outside the active time range (fresh computation for sliding windows)
    const liveRange = computeTimeRange(timePresetLabel);
    if (liveRange && event.timestamp < liveRange.from) return;

    // Content-based dedup: catch duplicate broadcasts with different event IDs
    if (isWsDuplicate(event)) return;

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
    toast('Catching up — some events were buffered', 'info');
    reloadAllEvents();
  }
});

wsClient.setOnStatusChange((status) => {
  useAgentStore.getState().setConnectionStatus(status);
});

wsClient.setOnReconnect(() => {
  reloadAllEvents();
});

// ── Sliding time window refresh ──────────────────────────────
// Periodically reload events so relative presets ("Last hour", etc.) evict stale data.
const SLIDING_REFRESH_MS = 60_000;
setInterval(() => {
  const { timePresetLabel } = useAgentStore.getState();
  if (timePresetLabel === 'All time') return;
  reloadAllEvents();
}, SLIDING_REFRESH_MS);
