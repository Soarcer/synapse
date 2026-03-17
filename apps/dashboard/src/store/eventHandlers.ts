// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Bernhard

import type { Node, Edge } from '@xyflow/react';
import type {
  AgentEvent,
  AgentNodeData,
  AssistantResponseData,
  SessionData,
  ToolCallSummary,
  UserPromptData,
} from '@synapse-ai/core';

// ── Constants ────────────────────────────────────────────────

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
export const NO_GRAPH_EVENTS = new Set<string>(['stop', 'permission_request', 'notification']);

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
  /** sessionId → assistant responses for that session */
  responses: Map<string, AssistantResponseData[]>;
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
    responses: new Map(),
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
    responses: new Map(state.responses),
    activeAgents: new Map(state.activeAgents),
    toolAgentMap: new Map(state.toolAgentMap),
    pendingTaskTools: new Map(Array.from(state.pendingTaskTools, ([k, v]) => [k, [...v]])),
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
    vendor: event?.vendor,
  };
  draft.sessions.set(sessionId, session);
  draft.nodes.push({
    id: nid.session(sessionId),
    type: 'session',
    position: OFFSCREEN,
    style: HIDDEN_STYLE,
    data: { session },
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
    // Preserve title/topTools from existing session (may have been set before SessionStart)
    title: existing?.title,
    gitBranch: event.gitBranch ?? existing?.gitBranch,
    topTools: existing?.topTools,
    vendor: event.vendor ?? existing?.vendor,
  };
  draft.sessions.set(event.sessionId, session);

  // Backfill model on agents created before SessionStart arrived (out-of-order events)
  if (event.model) {
    for (const [agentId, agent] of draft.agents) {
      if (agent.sessionId === event.sessionId && !agent.model) {
        const updated = { ...agent, model: event.model };
        draft.agents.set(agentId, updated);
        updateNode(draft.nodes, nid.agent(agentId), { agent: updated });
      }
    }
  }

  if (existing) {
    updateNode(draft.nodes, nid.session(event.sessionId), { session });
  } else {
    draft.nodes.push({
      id: nid.session(event.sessionId),
      type: 'session',
      position: OFFSCREEN,
      style: HIDDEN_STYLE,
      data: { session },
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
  if (
    sessionPrompts.some(
      (p) => p.text === promptText && Math.abs(p.timestamp - event.timestamp) < 3000,
    )
  )
    return;
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
  });
  const isFirstPrompt = sessionPrompts.length === 0;
  draft.edges.push({
    id: eid(nid.session(event.sessionId), nid.prompt(event.id)),
    source: nid.session(event.sessionId),
    target: nid.prompt(event.id),
    type: 'smoothstep',
    // Hide session→prompt edge for non-first prompts (kept for layout, invisible to user)
    ...(isFirstPrompt ? {} : { hidden: true }),
  });

  // Thread edge: chain consecutive prompts to show conversation flow.
  // The session→prompt edge above stays for layout (keeps prompts in same rank).
  // This thread edge is purely visual — shows "prompt 1, then prompt 2, then prompt 3".
  if (!isFirstPrompt) {
    const prevPrompt = sessionPrompts[sessionPrompts.length - 1];
    draft.edges.push({
      id: `thread-${nid.prompt(prevPrompt.id)}-${nid.prompt(event.id)}`,
      source: nid.prompt(prevPrompt.id),
      target: nid.prompt(event.id),
      sourceHandle: 'thread-out',
      targetHandle: 'thread-in',
      type: 'straight',
      markerEnd: {
        type: 'arrowclosed' as const,
        color: 'rgba(59, 130, 246, 0.4)',
        width: 12,
        height: 12,
      },
      style: { stroke: 'rgba(59, 130, 246, 0.35)', strokeWidth: 1.5 },
    });
  }

  // Set session title from first prompt text (if not already set)
  const session = draft.sessions.get(event.sessionId);
  if (session && !session.title && event.text) {
    const maxLen = 48;
    session.title =
      event.text.length > maxLen ? event.text.slice(0, maxLen - 3) + '...' : event.text;
    updateNode(draft.nodes, nid.session(event.sessionId), { session });
  }
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
    model: event.model ?? draft.sessions.get(event.sessionId)?.model,
    vendor: event.vendor ?? draft.sessions.get(event.sessionId)?.vendor,
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
        // Validate FIFO match: compare Task prompt with agent description
        const agentPrompt = event.text;
        if (taskToolUseId && agentPrompt) {
          const taskToolNode = draft.nodes.find((n) => n.id === nid.tool(taskToolUseId!));
          const taskPrompt = (taskToolNode?.data as { toolCall?: ToolCallSummary })?.toolCall
            ?.toolInput?.prompt as string | undefined;
          if (
            taskPrompt &&
            !agentPrompt.includes(taskPrompt.slice(0, 30)) &&
            !taskPrompt.includes(agentPrompt.slice(0, 30))
          ) {
            console.warn(
              `[Synapse] FIFO mismatch: Task tool "${taskToolUseId}" prompt "${taskPrompt.slice(0, 50)}..." ` +
                `does not match agent "${agentId}" prompt "${agentPrompt.slice(0, 50)}..."`,
            );
          }
        }
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
    parentNodeId = latestPrompt ? nid.prompt(latestPrompt.id) : nid.session(event.sessionId);
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
  draft.activeAgents.set(
    event.sessionId,
    sessionActive.filter((id) => id !== agentId),
  );

  const agent = draft.agents.get(agentId);
  if (!agent) return;

  // Merge tokenUsage: event provides {input, output} but agent may already have
  // richer cache/thinking data from Task tool_end — preserve those fields
  const mergedTokenUsage = event.tokenUsage
    ? {
        ...event.tokenUsage,
        cacheRead: agent.tokenUsage.cacheRead,
        cacheCreation: agent.tokenUsage.cacheCreation,
        thinking: agent.tokenUsage.thinking,
      }
    : agent.tokenUsage;

  const updated = {
    ...agent,
    status: (event.status ?? 'success') as AgentNodeData['status'],
    endTime: event.timestamp,
    tokenUsage: mergedTokenUsage,
    model: event.model ?? agent.model,
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

  // Guard: skip duplicate tool_start for the same toolUseId
  const toolNodeId = nid.tool(toolUseId);
  if (draft.nodes.some((n) => n.id === toolNodeId)) return;

  const tc: ToolCallSummary = {
    toolUseId,
    toolName: event.toolName ?? 'unknown',
    status: 'running',
    startTime: event.timestamp,
    inputPreview: event.toolInput ? JSON.stringify(event.toolInput).slice(0, 100) : undefined,
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
  });

  // Edge: agent → tool, or latest prompt, or session
  let toolParent: string;
  if (agentId && draft.nodes.some((n) => n.id === nid.agent(agentId))) {
    toolParent = nid.agent(agentId);
  } else {
    const sessionPrompts = draft.prompts.get(event.sessionId);
    const latestPrompt = sessionPrompts?.[sessionPrompts.length - 1];
    toolParent = latestPrompt ? nid.prompt(latestPrompt.id) : nid.session(event.sessionId);
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

  // Compute duration from timestamps when the event doesn't provide it
  // (Claude Code hooks never send event.duration)
  if (patch.duration == null && patch.endTime != null) {
    const existing = draft.toolCalls.get(agentId)?.find((tc) => tc.toolUseId === toolUseId);
    if (existing?.startTime) {
      patch.duration = patch.endTime - existing.startTime;
    }
  }

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

  // Re-point the child agent's incoming edge to this Task tool and tag it
  // (re-pointing only needed if handleAgentStart didn't already link to the Task tool, e.g. SDK path)
  for (let i = 0; i < draft.edges.length; i++) {
    if (draft.edges[i].target === agentNodeId) {
      const needsRepoint = draft.edges[i].source !== toolNodeId;
      draft.edges[i] = {
        ...draft.edges[i],
        ...(needsRepoint ? { id: eid(toolNodeId, agentNodeId), source: toolNodeId } : {}),
        data: {
          ...((draft.edges[i].data as Record<string, unknown>) ?? {}),
          isTaskEdge: true,
        },
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

  const cacheRead = usage.cache_read_input_tokens ?? 0;
  const cacheCreation = usage.cache_creation_input_tokens ?? 0;
  const tokenUsage = {
    input: Math.max(0, (usage.input_tokens ?? 0) - cacheRead),
    output: usage.output_tokens ?? 0,
    cacheRead,
    cacheCreation,
    thinking: usage.thinking_tokens ?? 0,
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

  // Preserve cache/thinking data from earlier Task tool_end
  const mergedTokenUsage = event.tokenUsage
    ? {
        ...event.tokenUsage,
        cacheRead: agent.tokenUsage.cacheRead,
        cacheCreation: agent.tokenUsage.cacheCreation,
        thinking: agent.tokenUsage.thinking,
      }
    : agent.tokenUsage;

  const updated = {
    ...agent,
    status: (event.status ?? 'success') as AgentNodeData['status'],
    endTime: event.timestamp,
    tokenUsage: mergedTokenUsage,
    model: event.model ?? agent.model,
  };
  draft.agents.set(agentId, updated);
  updateNode(draft.nodes, nid.agent(agentId), { agent: updated });
}

function handleCompact(event: AgentEvent, draft: StateDraft): void {
  // Increment compaction count on the latest active agent (always, even if prompt already marked)
  const sessionActive = draft.activeAgents.get(event.sessionId);
  if (sessionActive && sessionActive.length > 0) {
    const agentId = sessionActive[sessionActive.length - 1];
    const agentData = draft.agents.get(agentId);
    if (agentData) {
      const updated = { ...agentData, compactionCount: (agentData.compactionCount ?? 0) + 1 };
      draft.agents.set(agentId, updated);
      updateNode(draft.nodes, nid.agent(agentId), { agent: updated });
    }
  }

  // Mark latest prompt as compacted (only once per prompt)
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

function handleAssistantResponse(event: AgentEvent, draft: StateDraft): void {
  if (!event.text) return;

  // Find the last prompt with timestamp <= response timestamp
  const sessionPrompts = draft.prompts.get(event.sessionId) ?? [];
  let promptId = '';
  for (let i = sessionPrompts.length - 1; i >= 0; i--) {
    if (sessionPrompts[i].timestamp <= event.timestamp) {
      promptId = sessionPrompts[i].id;
      break;
    }
  }

  const response: AssistantResponseData = {
    id: event.id,
    sessionId: event.sessionId,
    text: event.text,
    timestamp: event.timestamp,
    promptId,
  };

  const existing = draft.responses.get(event.sessionId) ?? [];
  draft.responses.set(event.sessionId, [...existing, response]);
}

// ── Event dispatcher ─────────────────────────────────────────

export function processEvent(event: AgentEvent, draft: StateDraft, showHookEvents: boolean): void {
  // assistant_response bypasses hook visibility — it's conversation data via hook transport
  if (event.eventSource === 'hook' && !showHookEvents && event.type !== 'assistant_response')
    return;

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
    case 'assistant_response':
      handleAssistantResponse(event, draft);
      break;
    // text_delta: handled as fast path in addEvent (skips draft creation)
    // stop, permission_request, notification: event stored, no graph changes
  }
}

// ── Derived map helpers ──────────────────────────────────────

// Cache: only rebuild derived maps when the agents Map reference changes.
// This prevents creating new Map instances (and triggering Zustand subscriber
// re-renders) when reloadAllEvents rebuilds state with identical data.
let _prevAgentsRef: Map<string, AgentNodeData> | null = null;
let _prevSessionsRef: Map<string, SessionData> | undefined | null = null;
let _cachedDerived: {
  agentsBySession: Map<string, AgentNodeData[]>;
  childAgents: Map<string, AgentNodeData[]>;
} | null = null;

export function buildDerivedMaps(
  agents: Map<string, AgentNodeData>,
  sessions?: Map<string, SessionData>,
) {
  if (agents === _prevAgentsRef && sessions === _prevSessionsRef && _cachedDerived) {
    return _cachedDerived;
  }

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

  // Compute topTools per session
  if (sessions) {
    for (const [sessionId, sessionAgents] of agentsBySession) {
      const counts = new Map<string, number>();
      for (const a of sessionAgents) {
        for (const tc of a.toolCalls) {
          counts.set(tc.toolName, (counts.get(tc.toolName) ?? 0) + 1);
        }
      }
      const top3 = [...counts.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3)
        .map(([name]) => name);
      const session = sessions.get(sessionId);
      if (session && top3.length > 0) session.topTools = top3;
    }
  }

  _prevAgentsRef = agents;
  _prevSessionsRef = sessions;
  _cachedDerived = { agentsBySession, childAgents };
  return _cachedDerived;
}
