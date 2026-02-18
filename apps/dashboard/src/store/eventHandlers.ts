import type { Node, Edge } from '@xyflow/react';
import type {
  AgentEvent,
  AgentNodeData,
  SessionData,
  ToolCallSummary,
  UserPromptData,
} from '@synapse-ai/core';

// ── Constants ────────────────────────────────────────────────

const SESSION_W = 220;
const SESSION_H = 65;
const PROMPT_W = 240;
const PROMPT_H = 95;
const AGENT_W = 200;
const AGENT_H = 80;
const TOOL_W = 150;
const TOOL_H = 28;

/** Offscreen position + hidden so new nodes aren't visible before layout runs */
const OFFSCREEN = { x: -9999, y: -9999 };
const HIDDEN_STYLE = { visibility: 'hidden' as const };

export const SPAWN_NODE: Node = {
  id: '__spawn__',
  type: 'spawnAgent',
  position: { x: 300, y: 100 },
  data: {},
  draggable: true,
};

/** Event types that are stored in the timeline but don't produce graph nodes */
export const NO_GRAPH_EVENTS = new Set<string>([
  'stop',
  'permission_request',
  'notification',
]);

// ── Node / Edge ID helpers ───────────────────────────────────

export const nid = {
  session: (id: string) => `session-${id}`,
  agent: (id: string) => `agent-${id}`,
  tool: (id: string) => `tool-${id}`,
  prompt: (id: string) => `prompt-${id}`,
} as const;

export function eid(source: string, target: string): string {
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

export interface StateDraft {
  sessions: Map<string, SessionData>;
  agents: Map<string, AgentNodeData>;
  toolCalls: Map<string, ToolCallSummary[]>;
  prompts: Map<string, UserPromptData[]>;
  activeAgents: Map<string, string[]>;
  toolAgentMap: Map<string, string>;
  /** sessionId → FIFO queue of running Task tool_use_ids (for Task→Agent correlation) */
  pendingTaskTools: Map<string, string[]>;
  /** taskToolUseId → childAgentId (set when SubagentStart links to a Task tool) */
  taskToolAgentMap: Map<string, string>;
  nodes: Node[];
  edges: Edge[];
}

export function createFreshDraft(): StateDraft {
  return {
    sessions: new Map(),
    agents: new Map(),
    toolCalls: new Map(),
    prompts: new Map(),
    activeAgents: new Map(),
    toolAgentMap: new Map(),
    pendingTaskTools: new Map(),
    taskToolAgentMap: new Map(),
    nodes: [{ ...SPAWN_NODE }],
    edges: [],
  };
}

export function draftFromState(state: StateDraft): StateDraft {
  return {
    sessions: new Map(state.sessions),
    agents: new Map(state.agents),
    toolCalls: new Map(state.toolCalls),
    prompts: new Map(state.prompts),
    activeAgents: new Map(state.activeAgents),
    toolAgentMap: new Map(state.toolAgentMap),
    pendingTaskTools: new Map(
      Array.from(state.pendingTaskTools, ([k, v]) => [k, [...v]]),
    ),
    taskToolAgentMap: new Map(state.taskToolAgentMap),
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
    position: OFFSCREEN,
    style: HIDDEN_STYLE,
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
      position: OFFSCREEN,
      style: HIDDEN_STYLE,
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

  // Guard: skip if this prompt node already exists (dedup safety net)
  if (draft.nodes.some((n) => n.id === nid.prompt(event.id))) return;

  // Content-based dedup: two hook sources can produce the same prompt with different
  // event IDs. Skip if a prompt with identical text already exists in this session
  // within a 3-second window.
  const sessionPrompts = draft.prompts.get(event.sessionId) ?? [];
  const promptText = event.text ?? '';
  if (sessionPrompts.some(
    (p) => p.text === promptText && Math.abs(p.timestamp - event.timestamp) < 3000,
  )) return;
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
    position: OFFSCREEN,
    style: HIDDEN_STYLE,
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
    position: OFFSCREEN,
    style: HIDDEN_STYLE,
    data: { agent },
    width: AGENT_W,
    height: AGENT_H,
  });

  // ── Determine parent node for the agent edge ──
  // Priority: parentAgentId (if valid) → pending Task tool → latest prompt → session
  let parentNodeId: string | undefined;

  // 1. Explicit parent agent (for nested subagents)
  if (event.parentAgentId) {
    const parentExists = draft.nodes.some((n) => n.id === nid.agent(event.parentAgentId!));
    if (parentExists) {
      parentNodeId = nid.agent(event.parentAgentId);
    }
    // If parent agent doesn't exist yet (out-of-order events), fall through
  }

  // 2. Pending Task tool — SubagentStart arriving after PreToolUse(Task)
  if (!parentNodeId) {
    const pending = draft.pendingTaskTools.get(event.sessionId);
    if (pending && pending.length > 0) {
      // Prefer explicit toolUseId match (hooks provide tool_use_id on SubagentStart)
      // Fall back to FIFO only when toolUseId is unavailable
      let taskToolUseId: string | undefined;
      if (event.toolUseId && pending.includes(event.toolUseId)) {
        taskToolUseId = event.toolUseId;
        const idx = pending.indexOf(event.toolUseId);
        pending.splice(idx, 1);
      } else {
        taskToolUseId = pending.shift();
      }
      if (pending.length === 0) draft.pendingTaskTools.delete(event.sessionId);
      if (taskToolUseId) {
        const taskToolNodeId = nid.tool(taskToolUseId);
        if (draft.nodes.some((n) => n.id === taskToolNodeId)) {
          parentNodeId = taskToolNodeId;
          // Record mapping so handleToolEnd can also do re-pointing for SDK events
          draft.taskToolAgentMap.set(taskToolUseId, agentId);
        }
      }
    }
  }

  // 3. Latest prompt or session fallback
  if (!parentNodeId) {
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

  // Track running Task tools so SubagentStart can link to them
  if (event.toolName === 'Task') {
    const pending = draft.pendingTaskTools.get(event.sessionId) ?? [];
    draft.pendingTaskTools.set(event.sessionId, [...pending, toolUseId]);
  }

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
    position: OFFSCREEN,
    style: HIDDEN_STYLE,
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

  // If tool_end arrived before tool_start (async hook race), create the tool
  // node now so the completion isn't silently lost.
  const toolNodeExists = draft.nodes.some((n) => n.id === nid.tool(toolUseId));
  if (!toolNodeExists && toolUseId) {
    handleToolStart(
      {
        ...event,
        type: 'tool_start',
        status: 'running',
      },
      draft,
    );
  }

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

  if (event.toolName !== 'Task') return;

  const toolUseId = event.toolUseId ?? '';

  // Consume from pendingTaskTools if this Task wasn't consumed by SubagentStart
  // (happens when PostToolUse(Task) arrives but no SubagentStart was processed)
  const pending = draft.pendingTaskTools.get(event.sessionId);
  if (pending) {
    const idx = pending.indexOf(toolUseId);
    if (idx >= 0) {
      pending.splice(idx, 1);
      if (pending.length === 0) draft.pendingTaskTools.delete(event.sessionId);
    }
  }

  // Resolve child agent: try toolResponse.agentId (SDK), then taskToolAgentMap (hooks)
  const childAgentId =
    ((event.toolResponse as Record<string, unknown> | undefined)?.agentId as string | undefined) ??
    draft.taskToolAgentMap.get(toolUseId);
  if (!childAgentId) return;

  const toolNodeId = nid.tool(toolUseId);
  const agentNodeId = nid.agent(childAgentId);

  // Re-point the child agent's incoming edge to this Task tool
  // (only needed if handleAgentStart didn't already link to the Task tool, e.g. SDK path)
  for (let i = 0; i < draft.edges.length; i++) {
    if (draft.edges[i].target === agentNodeId && draft.edges[i].source !== toolNodeId) {
      draft.edges[i] = {
        ...draft.edges[i],
        id: eid(toolNodeId, agentNodeId),
        source: toolNodeId,
      };
    }
  }

  // Extract token usage from Task response (SDK path)
  if (!event.toolResponse) return;
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

export function processEvent(event: AgentEvent, draft: StateDraft, showHookEvents: boolean): void {
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

// ── Derived map helpers ──────────────────────────────────────

export function buildDerivedMaps(agents: Map<string, AgentNodeData>) {
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
