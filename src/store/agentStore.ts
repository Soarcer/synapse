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

// ── Constants ────────────────────────────────────────────────

const SESSION_W = 220;
const SESSION_H = 80;
const PROMPT_W = 240;
const PROMPT_H = 130;
const AGENT_W = 200;
const AGENT_H = 110;
const TOOL_W = 150;
const TOOL_H = 32;

const SPAWN_NODE: Node = {
  id: '__spawn__',
  type: 'spawnAgent',
  position: { x: 300, y: 100 },
  data: {},
  draggable: true,
};

/** Event types that are stored in the timeline but don't produce graph nodes */
const NO_GRAPH_EVENTS = new Set<string>([
  'stop',
  'permission_request',
  'notification',
]);

// ── Node / Edge ID helpers ───────────────────────────────────

const nid = {
  session: (id: string) => `session-${id}`,
  agent: (id: string) => `agent-${id}`,
  tool: (id: string) => `tool-${id}`,
  prompt: (id: string) => `prompt-${id}`,
} as const;

function eid(source: string, target: string): string {
  return `edge-${source}-${target}`;
}

// ── Array mutation helpers (mutate draft arrays in place) ────

function updateNode(nodes: Node[], id: string, data: Record<string, unknown>): void {
  const idx = nodes.findIndex((n) => n.id === id);
  if (idx >= 0) nodes[idx] = { ...nodes[idx], data };
}

function updateEdgesByTarget(edges: Edge[], target: string, changes: Partial<Edge>): void {
  for (let i = 0; i < edges.length; i++) {
    if (edges[i].target === target) {
      edges[i] = { ...edges[i], ...changes };
    }
  }
}

// ── Mutable draft for batch event processing ─────────────────

interface StateDraft {
  sessions: Map<string, SessionData>;
  agents: Map<string, AgentNodeData>;
  toolCalls: Map<string, ToolCallSummary[]>;
  prompts: Map<string, UserPromptData[]>;
  activeAgents: Map<string, string[]>;
  toolAgentMap: Map<string, string>;
  nodes: Node[];
  edges: Edge[];
}

function createFreshDraft(): StateDraft {
  return {
    sessions: new Map(),
    agents: new Map(),
    toolCalls: new Map(),
    prompts: new Map(),
    activeAgents: new Map(),
    toolAgentMap: new Map(),
    nodes: [{ ...SPAWN_NODE }],
    edges: [],
  };
}

function draftFromState(state: StateDraft): StateDraft {
  return {
    sessions: new Map(state.sessions),
    agents: new Map(state.agents),
    toolCalls: new Map(state.toolCalls),
    prompts: new Map(state.prompts),
    activeAgents: new Map(state.activeAgents),
    toolAgentMap: new Map(state.toolAgentMap),
    nodes: [...state.nodes],
    edges: [...state.edges],
  };
}

// ── Session helper ───────────────────────────────────────────

function ensureSession(
  sessionId: string,
  timestamp: number,
  draft: StateDraft,
  event?: AgentEvent,
): void {
  if (draft.sessions.has(sessionId)) return;

  const session: SessionData = {
    sessionId,
    startTime: timestamp,
    agentCount: 0,
    status: 'running',
    placeholder: true,
    model: event?.model,
    cwd: event?.cwd,
  };
  draft.sessions.set(sessionId, session);
  draft.nodes.push({
    id: nid.session(sessionId),
    type: 'session',
    position: { x: 0, y: 0 },
    data: { session },
    width: SESSION_W,
    height: SESSION_H,
  });
}

// ── Per-event-type handlers (mutate draft in place) ──────────

function handleSessionStart(event: AgentEvent, draft: StateDraft): void {
  const existing = draft.sessions.get(event.sessionId);
  const session: SessionData = {
    sessionId: event.sessionId,
    startTime: event.timestamp,
    agentCount: existing?.agentCount ?? 0,
    status: 'running',
    model: event.model,
    source: event.source,
    cwd: event.cwd,
    placeholder: false,
  };
  draft.sessions.set(event.sessionId, session);

  if (existing) {
    updateNode(draft.nodes, nid.session(event.sessionId), { session });
  } else {
    draft.nodes.push({
      id: nid.session(event.sessionId),
      type: 'session',
      position: { x: 0, y: 0 },
      data: { session },
      width: SESSION_W,
      height: SESSION_H,
    });
  }
}

function handleSessionEnd(event: AgentEvent, draft: StateDraft): void {
  ensureSession(event.sessionId, event.timestamp, draft, event);
  const session = draft.sessions.get(event.sessionId);
  if (!session) return;

  const updated = { ...session, endTime: event.timestamp, status: 'ended' as const };
  draft.sessions.set(event.sessionId, updated);
  updateNode(draft.nodes, nid.session(event.sessionId), { session: updated });
}

function handleUserPrompt(event: AgentEvent, draft: StateDraft): void {
  ensureSession(event.sessionId, event.timestamp, draft, event);
  const sessionPrompts = draft.prompts.get(event.sessionId) ?? [];
  const prompt: UserPromptData = {
    id: event.id,
    sessionId: event.sessionId,
    text: event.text ?? '',
    timestamp: event.timestamp,
  };
  draft.prompts.set(event.sessionId, [...sessionPrompts, prompt]);

  draft.nodes.push({
    id: nid.prompt(event.id),
    type: 'userPrompt',
    position: { x: 0, y: 0 },
    data: { prompt },
    width: PROMPT_W,
    height: PROMPT_H,
  });
  draft.edges.push({
    id: eid(nid.session(event.sessionId), nid.prompt(event.id)),
    source: nid.session(event.sessionId),
    target: nid.prompt(event.id),
    type: 'smoothstep',
  });
}

function handleAgentStart(event: AgentEvent, draft: StateDraft): void {
  ensureSession(event.sessionId, event.timestamp, draft, event);
  const agentId = event.agentId ?? event.id;
  const agent: AgentNodeData = {
    agentId,
    agentType: event.agentType ?? 'unknown',
    sessionId: event.sessionId,
    parentAgentId: event.parentAgentId,
    status: 'running',
    toolCalls: [],
    tokenUsage: { input: 0, output: 0 },
    startTime: event.timestamp,
  };
  draft.agents.set(agentId, agent);

  // Track active agent for tool→agent inference
  const sessionActive = draft.activeAgents.get(event.sessionId) ?? [];
  draft.activeAgents.set(event.sessionId, [...sessionActive, agentId]);

  // Update session agent count
  const session = draft.sessions.get(event.sessionId);
  if (session) {
    const updatedSession = { ...session, agentCount: session.agentCount + 1 };
    draft.sessions.set(event.sessionId, updatedSession);
    updateNode(draft.nodes, nid.session(event.sessionId), { session: updatedSession });
  }

  draft.nodes.push({
    id: nid.agent(agentId),
    type: 'agent',
    position: { x: 0, y: 0 },
    data: { agent },
    width: AGENT_W,
    height: AGENT_H,
  });

  // Edge: parent agent, or latest prompt, or session
  let parentNodeId: string;
  if (event.parentAgentId) {
    parentNodeId = nid.agent(event.parentAgentId);
  } else {
    const sessionPrompts = draft.prompts.get(event.sessionId);
    const latestPrompt = sessionPrompts?.[sessionPrompts.length - 1];
    parentNodeId = latestPrompt
      ? nid.prompt(latestPrompt.id)
      : nid.session(event.sessionId);
  }
  draft.edges.push({
    id: eid(parentNodeId, nid.agent(agentId)),
    source: parentNodeId,
    target: nid.agent(agentId),
    type: 'animated',
    animated: true,
    data: { status: 'running' },
  });
}

function handleAgentStop(event: AgentEvent, draft: StateDraft): void {
  const agentId = event.agentId ?? event.id;

  // Remove from active agents
  const sessionActive = draft.activeAgents.get(event.sessionId) ?? [];
  draft.activeAgents.set(event.sessionId, sessionActive.filter((id) => id !== agentId));

  const agent = draft.agents.get(agentId);
  if (!agent) return;

  const updated = {
    ...agent,
    status: (event.status ?? 'success') as AgentNodeData['status'],
    endTime: event.timestamp,
    tokenUsage: event.tokenUsage ?? agent.tokenUsage,
  };
  draft.agents.set(agentId, updated);
  updateNode(draft.nodes, nid.agent(agentId), { agent: updated });
  updateEdgesByTarget(draft.edges, nid.agent(agentId), {
    animated: false,
    data: { status: 'done' },
  });
}

function handleToolStart(event: AgentEvent, draft: StateDraft): void {
  ensureSession(event.sessionId, event.timestamp, draft, event);
  const toolUseId = event.toolUseId ?? event.id;

  // Infer agentId (hooks don't include agent_id on tool events)
  let agentId = event.agentId ?? '';
  if (!agentId) {
    const sessionActive = draft.activeAgents.get(event.sessionId) ?? [];
    if (sessionActive.length > 0 && event.toolName !== 'Task') {
      agentId = sessionActive[sessionActive.length - 1];
    }
  }
  draft.toolAgentMap.set(toolUseId, agentId);

  const tc: ToolCallSummary = {
    toolUseId,
    toolName: event.toolName ?? 'unknown',
    status: 'running',
    startTime: event.timestamp,
    inputPreview: event.toolInput
      ? JSON.stringify(event.toolInput).slice(0, 100)
      : undefined,
    toolInput: event.toolInput,
  };
  draft.toolCalls.set(agentId, [...(draft.toolCalls.get(agentId) ?? []), tc]);

  // Update agent's toolCalls
  const agent = draft.agents.get(agentId);
  if (agent) {
    const updated = { ...agent, toolCalls: [...agent.toolCalls, tc] };
    draft.agents.set(agentId, updated);
    updateNode(draft.nodes, nid.agent(agentId), { agent: updated });
  }

  draft.nodes.push({
    id: nid.tool(toolUseId),
    type: 'toolCall',
    position: { x: 0, y: 0 },
    data: { toolCall: tc },
    width: TOOL_W,
    height: TOOL_H,
  });

  // Edge: agent → tool, or latest prompt, or session
  let toolParent: string;
  if (agentId && draft.nodes.some((n) => n.id === nid.agent(agentId))) {
    toolParent = nid.agent(agentId);
  } else {
    const sessionPrompts = draft.prompts.get(event.sessionId);
    const latestPrompt = sessionPrompts?.[sessionPrompts.length - 1];
    toolParent = latestPrompt
      ? nid.prompt(latestPrompt.id)
      : nid.session(event.sessionId);
  }
  draft.edges.push({
    id: eid(toolParent, nid.tool(toolUseId)),
    source: toolParent,
    target: nid.tool(toolUseId),
    type: 'animated',
    animated: true,
    style: { strokeDasharray: '5,5', strokeWidth: 1 },
    data: { status: 'running' },
  });
}

/** Shared finalization for tool_end and tool_error */
function finalizeToolCall(
  event: AgentEvent,
  draft: StateDraft,
  status: 'success' | 'error',
  extras: Partial<ToolCallSummary> = {},
): void {
  const toolUseId = event.toolUseId ?? '';
  const agentId = event.agentId || draft.toolAgentMap.get(toolUseId) || '';
  const patch: Partial<ToolCallSummary> = { status, endTime: event.timestamp, ...extras };

  // Update toolCalls Map
  const agentTools = draft.toolCalls.get(agentId);
  if (agentTools) {
    draft.toolCalls.set(
      agentId,
      agentTools.map((tc) => (tc.toolUseId === toolUseId ? { ...tc, ...patch } : tc)),
    );
  }

  // Update agent.toolCalls
  const agent = draft.agents.get(agentId);
  if (agent) {
    const updated = {
      ...agent,
      toolCalls: agent.toolCalls.map((tc) =>
        tc.toolUseId === toolUseId ? { ...tc, ...patch } : tc,
      ),
    };
    draft.agents.set(agentId, updated);
    updateNode(draft.nodes, nid.agent(agentId), { agent: updated });
  }

  // Update tool node
  const updatedTc = draft.toolCalls.get(agentId)?.find((tc) => tc.toolUseId === toolUseId);
  if (updatedTc) {
    updateNode(draft.nodes, nid.tool(toolUseId), { toolCall: updatedTc });
  }

  // Update edge
  updateEdgesByTarget(draft.edges, nid.tool(toolUseId), {
    animated: false,
    data: { status: status === 'success' ? 'done' : 'error' },
  });
}

function handleToolEnd(event: AgentEvent, draft: StateDraft): void {
  finalizeToolCall(event, draft, 'success', {
    duration: event.duration,
    toolResponse: event.toolResponse,
  });

  // Task tool response → link child agent to this tool node
  if (event.toolName !== 'Task' || !event.toolResponse) return;

  const toolUseId = event.toolUseId ?? '';
  const childAgentId = (event.toolResponse as Record<string, unknown>).agentId as
    | string
    | undefined;
  if (!childAgentId) return;

  const toolNodeId = nid.tool(toolUseId);
  const agentNodeId = nid.agent(childAgentId);

  // Re-point the child agent's incoming edge to this Task tool
  for (let i = 0; i < draft.edges.length; i++) {
    if (draft.edges[i].target === agentNodeId) {
      draft.edges[i] = {
        ...draft.edges[i],
        id: eid(toolNodeId, agentNodeId),
        source: toolNodeId,
      };
    }
  }

  // Extract token usage from Task response
  const resp = event.toolResponse as Record<string, unknown>;
  const usage = resp.usage as Record<string, number> | undefined;
  if (!usage) return;

  const childAgent = draft.agents.get(childAgentId);
  if (!childAgent || childAgent.tokenUsage.input !== 0 || childAgent.tokenUsage.output !== 0)
    return;

  const tokenUsage = {
    input:
      (usage.input_tokens ?? 0) +
      (usage.cache_read_input_tokens ?? 0) +
      (usage.cache_creation_input_tokens ?? 0),
    output: usage.output_tokens ?? 0,
  };
  const updated = { ...childAgent, tokenUsage };
  draft.agents.set(childAgentId, updated);
  updateNode(draft.nodes, agentNodeId, { agent: updated });
}

function handleToolError(event: AgentEvent, draft: StateDraft): void {
  finalizeToolCall(event, draft, 'error');
}

function handleResult(event: AgentEvent, draft: StateDraft): void {
  const agentId = event.agentId ?? '';
  const agent = draft.agents.get(agentId);
  if (!agent) return;

  const updated = {
    ...agent,
    status: (event.status ?? 'success') as AgentNodeData['status'],
    endTime: event.timestamp,
    tokenUsage: event.tokenUsage ?? agent.tokenUsage,
  };
  draft.agents.set(agentId, updated);
  updateNode(draft.nodes, nid.agent(agentId), { agent: updated });
}

function handleCompact(event: AgentEvent, draft: StateDraft): void {
  const sessionPrompts = draft.prompts.get(event.sessionId);
  if (!sessionPrompts || sessionPrompts.length === 0) return;

  const latestPrompt = sessionPrompts[sessionPrompts.length - 1];
  if (latestPrompt.compactedAfter) return;

  const updatedPrompt = { ...latestPrompt, compactedAfter: true };
  const updatedList = [...sessionPrompts];
  updatedList[updatedList.length - 1] = updatedPrompt;
  draft.prompts.set(event.sessionId, updatedList);
  updateNode(draft.nodes, nid.prompt(latestPrompt.id), { prompt: updatedPrompt });
}

// ── Event dispatcher ─────────────────────────────────────────

function processEvent(event: AgentEvent, draft: StateDraft, showHookEvents: boolean): void {
  if (event.eventSource === 'hook' && !showHookEvents) return;

  switch (event.type) {
    case 'session_start':
      handleSessionStart(event, draft);
      break;
    case 'session_end':
      handleSessionEnd(event, draft);
      break;
    case 'user_prompt':
      handleUserPrompt(event, draft);
      break;
    case 'agent_start':
      handleAgentStart(event, draft);
      break;
    case 'agent_stop':
      handleAgentStop(event, draft);
      break;
    case 'tool_start':
      handleToolStart(event, draft);
      break;
    case 'tool_end':
      handleToolEnd(event, draft);
      break;
    case 'tool_error':
      handleToolError(event, draft);
      break;
    case 'result':
      handleResult(event, draft);
      break;
    case 'compact':
      handleCompact(event, draft);
      break;
    // text_delta: handled as fast path in addEvent (skips draft creation)
    // stop, permission_request, notification: event stored, no graph changes
  }
}

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
    .catch((err) => {
      if (err?.name === 'AbortError') return;
    });
}

// ── Derived map helpers ──────────────────────────────────────

function buildDerivedMaps(agents: Map<string, AgentNodeData>) {
  const agentsBySession = new Map<string, AgentNodeData[]>();
  const childAgents = new Map<string, AgentNodeData[]>();
  for (const a of agents.values()) {
    // Group by sessionId
    const sessionList = agentsBySession.get(a.sessionId);
    if (sessionList) sessionList.push(a);
    else agentsBySession.set(a.sessionId, [a]);
    // Group by parentAgentId
    if (a.parentAgentId) {
      const childList = childAgents.get(a.parentAgentId);
      if (childList) childList.push(a);
      else childAgents.set(a.parentAgentId, [a]);
    }
  }
  return { agentsBySession, childAgents };
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
