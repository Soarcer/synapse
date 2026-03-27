# Reference Appendix — Annotated Code Excerpts from Synapse

> Companion to `reference-architecture-prompt.md`. These are real working code
> excerpts showing how the patterns look in production.

## A1. StateDraft Shape (eventHandlers.ts)

```typescript
export interface StateDraft {
  sessions: Map<string, SessionData>;
  agents: Map<string, AgentNodeData>;
  toolCalls: Map<string, ToolCallSummary[]>;
  prompts: Map<string, UserPromptData[]>;
  activeAgents: Map<string, string[]>; // sessionId → running agentIds
  toolAgentMap: Map<string, string>; // toolUseId → agentId (inference)
  pendingTaskTools: Map<string, string[]>; // sessionId → FIFO queue of Task tool_use_ids
  taskToolAgentMap: Map<string, string>; // taskToolUseId → childAgentId
  nodes: Node[];
  edges: Edge[];
}
```

**Your equivalent**: Replace sessions→experiments, agents→stories, toolCalls→chapters.
The correlation maps (activeAgents, toolAgentMap) become activeStories, chapterStoryMap.

## A2. Event Handler — Agent Start (your "Story Start")

```typescript
function handleAgentStart(event: AgentEvent, draft: StateDraft): void {
  ensureSession(event.sessionId, event.timestamp, draft, event);
  const agentId = event.agentId ?? event.id;
  const agent: AgentNodeData = {
    agentId,
    agentType: event.agentType ?? 'unknown',
    sessionId: event.sessionId,
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
    const updated = { ...session, agentCount: session.agentCount + 1 };
    draft.sessions.set(event.sessionId, updated);
    updateNode(draft.nodes, nid.session(event.sessionId), { session: updated });
  }

  draft.nodes.push({
    id: nid.agent(agentId),
    type: 'agent',
    position: { x: -9999, y: -9999 },
    style: { visibility: 'hidden' as const },
    data: { agent },
  });

  // Edge: determine parent → this agent
  // Priority: explicit parentAgentId → pending Task tool → latest prompt → session
  let parentNodeId = /* ... priority chain logic ... */;

  draft.edges.push({
    id: eid(parentNodeId, nid.agent(agentId)),
    source: parentNodeId,
    target: nid.agent(agentId),
    type: 'animated',
    animated: true,
    data: { status: 'running' },
  });
}
```

## A3. Composite Node Synthesis (useVisibleGraph.ts)

This runs in a `useMemo` — it replaces individual tool nodes with grouped composite nodes.

```typescript
const { baseNodes, baseEdges } = useMemo(() => {
  // 1. Find "structural" tools (tools that parent an agent — keep as individuals)
  const structuralToolIds = new Set<string>();
  for (const edge of rawEdges) {
    if (edge.source.startsWith('tool-') && edge.target.startsWith('agent-')) {
      structuralToolIds.add(edge.source);
    }
  }

  // 2. Find leaf tools and group by parent
  const leafToolsByParent = new Map<string, string[]>();
  for (const edge of rawEdges) {
    if (edge.target.startsWith('tool-') && !structuralToolIds.has(edge.target)) {
      const list = leafToolsByParent.get(edge.source) ?? [];
      list.push(edge.target);
      leafToolsByParent.set(edge.source, list);
    }
  }

  // 3. Create synthetic composite nodes
  const syntheticNodes: Node[] = [];
  const syntheticEdges: Edge[] = [];
  for (const [parentId, toolIds] of leafToolsByParent) {
    const tools = toolIds.map((tid) => rawNodeById.get(tid)?.data.toolCall).filter(Boolean);
    const tgId = `toolgroup-${parentId}`;
    syntheticNodes.push({
      id: tgId,
      type: 'toolGroup',
      data: { tools, parentAgentId: parentId },
      position: OFFSCREEN,
    });
    syntheticEdges.push({
      id: `edge-${parentId}-${tgId}`,
      source: parentId,
      target: tgId,
    });
  }

  // 4. Return: structural nodes + synthetics, minus individual leaf tools
  return {
    baseNodes: rawNodes.filter((n) => !leafToolNodeIds.has(n.id)).concat(syntheticNodes),
    baseEdges: rawEdges.filter((e) => !leafToolNodeIds.has(e.target)).concat(syntheticEdges),
  };
}, [rawNodes, rawEdges]);
```

## A4. Composite Node Component — Collapsed vs Expanded

```typescript
// Collapsed state (your "chapter strip summary")
if (!showAllTools) {
  return (
    <div className="flex items-center gap-2 text-xs">
      <Handle type="target" position={target} />
      <span>[{tools.length}] tools</span>
      <span className="flex gap-0.5">
        {tools.slice(0, 8).map((t, i) => (
          <span key={i} className={`w-1.5 h-1.5 rounded-full ${STATUS_DOT[t.status]}`} />
        ))}
      </span>
    </div>
  );
}

// Expanded state: render as pill grid, timeline, or heatmap
return (
  <div>
    <Handle type="target" position={target} />
    {mode === 'pillGrid' && <PillGridView tools={tools} />}
    {mode === 'timeline' && <TimelineView tools={tools} />}
  </div>
);
```

## A5. Node Type Registration

```typescript
export const nodeTypes: NodeTypes = {
  session: SessionNode,
  agent: AgentNode,
  toolCall: ToolCallNode,
  toolGroup: ToolGroupNode, // composite
  userPrompt: UserPromptNode,
};
```

## A6. WebSocket Batcher

```typescript
export function createEventBatcher(
  onBatch: (events: WsServerMessage[]) => void,
  onImmediate?: (event: WsServerMessage) => void,
) {
  let queue: WsServerMessage[] = [];
  let scheduled = false;

  return {
    batchEvent(msg: WsServerMessage) {
      if (msg.type !== 'event') {
        // non-event messages bypass batching
        onImmediate?.(msg);
        return;
      }
      queue.push(msg);
      if (!scheduled) {
        scheduled = true;
        queueMicrotask(() => {
          const batch = queue;
          queue = [];
          scheduled = false;
          if (batch.length > 0) onBatch(batch);
        });
      }
    },
  };
}
```

## A7. Helper Utilities

```typescript
// Update a node's data in the draft array (by ID)
function updateNode(nodes: Node[], id: string, data: Record<string, unknown>): void {
  const idx = nodes.findIndex((n) => n.id === id);
  if (idx >= 0) nodes[idx] = { ...nodes[idx], data };
}

// Update all edges targeting a specific node
function updateEdgesByTarget(edges: Edge[], target: string, changes: Partial<Edge>): void {
  for (let i = 0; i < edges.length; i++) {
    if (edges[i].target === target) {
      edges[i] = { ...edges[i], ...changes };
    }
  }
}

// Offscreen constants (used before layout positions nodes)
const OFFSCREEN = { x: -9999, y: -9999 };
const HIDDEN_STYLE = { visibility: 'hidden' as const };
```
