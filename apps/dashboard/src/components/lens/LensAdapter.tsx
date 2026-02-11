import { useMemo, useCallback, useEffect, useRef } from 'react';
import type { Node, Edge } from '@xyflow/react';
import { useAgentStore } from '../../store/agentStore';
import { getKindColor } from '@synapse-ai/core';
import type {
  SessionData,
  AgentNodeData,
  UserPromptData,
  ToolCallSummary,
  AgentEvent,
  TranscriptSummary,
} from '@synapse-ai/core';
import { apiUrl } from '../../utils/api';
import {
  LensProvider,
  type LensContextValue,
  type LensTreeNode,
  type LensTab,
  type ProfileMetric,
  type WaterfallSpan,
  type HeatmapData,
  type HeatmapCell,
  type SankeyData,
  type SankeyNode,
  type SankeyLink,
  type CompactEvent,
  type CostTurn,
} from './LensContext';
import { LensPanel } from './LensPanel';

/** Extract the numeric value from a tree node for the given metric */
function nodeMetricValue(node: LensTreeNode, metric: ProfileMetric): number {
  if (metric === 'tokens') return node.tokens;
  if (metric === 'duration') return node.duration;
  return node.count;
}

// ── Tree data derivation (from graph topology) ──────────────

type NodeKind = 'session' | 'prompt' | 'agent' | 'tool';

const TYPE_TO_KIND: Record<string, NodeKind> = {
  session: 'session',
  userPrompt: 'prompt',
  agent: 'agent',
  toolCall: 'tool',
};

/**
 * Derive the lens tree hierarchy directly from the React Flow graph
 * nodes and edges. This ensures the treemap/sankey/heatmap
 * views show the exact same hierarchy as the main node graph —
 * no temporal heuristics, no duplication, correct Task→sub-agent links.
 */
function buildTreeRoots(
  graphNodes: Node[],
  graphEdges: Edge[],
  transcripts?: Map<string, TranscriptSummary>,
  storePrompts?: Map<string, UserPromptData[]>,
): LensTreeNode[] {
  // Build adjacency and lookup maps
  const childrenOf = new Map<string, string[]>();
  const hasParent = new Set<string>();
  const nodeById = new Map<string, Node>();

  for (const n of graphNodes) {
    if (n.id === '__spawn__') continue;
    nodeById.set(n.id, n);
  }

  for (const edge of graphEdges) {
    if (!nodeById.has(edge.source) || !nodeById.has(edge.target)) continue;
    const kids = childrenOf.get(edge.source) ?? [];
    kids.push(edge.target);
    childrenOf.set(edge.source, kids);
    hasParent.add(edge.target);
  }

  // Roots = graph nodes with no incoming edge
  const roots = [...nodeById.values()].filter((n) => !hasParent.has(n.id));

  const visited = new Set<string>();

  /** Recursively collect LensTreeNode children for a given parent node.
   *  Unknown-type parents are "transparent": their children are promoted up. */
  function collectChildren(parentId: string, depth: number): LensTreeNode[] {
    const childIds = childrenOf.get(parentId) ?? [];
    const result: LensTreeNode[] = [];
    for (const cid of childIds) {
      if (visited.has(cid)) continue;
      visited.add(cid);
      const cn = nodeById.get(cid);
      if (!cn) continue;
      const kind = TYPE_TO_KIND[cn.type ?? ''];
      if (!kind) {
        // Unknown node type — skip it but promote its children
        result.push(...collectChildren(cid, depth));
        continue;
      }
      const children = groupToolChildren(collectChildren(cid, depth + 1));
      const node = makeLensNode(cn, kind, children, depth);
      if (node) result.push(node);
    }
    return result;
  }

  /** Build a LensTreeNode from a graph node + pre-built children. */
  function makeLensNode(
    gNode: Node,
    kind: NodeKind,
    children: LensTreeNode[],
    depth: number,
  ): LensTreeNode | null {
    const data = gNode.data as Record<string, unknown>;
    const childTokens = children.reduce((s, c) => s + c.tokens, 0);
    const childCount = children.reduce((s, c) => s + c.count, 0);

    if (kind === 'session') {
      const session = data.session as SessionData;
      let tokens = childTokens;
      // Fallback: if children have no tokens, use transcript totals
      if (tokens === 0 && transcripts) {
        const t = transcripts.get(session.sessionId);
        if (t) tokens = t.totalInputTokens + t.totalOutputTokens;
      }
      return {
        id: gNode.id,
        kind: 'session',
        label: session.sessionId.slice(0, 8),
        status: session.status === 'running' ? 'running' : 'ended',
        tokens,
        count: Math.max(childCount, 1),
        startTime: session.startTime,
        endTime: session.endTime,
        duration: (session.endTime ?? Date.now()) - session.startTime,
        depth,
        children,
      };
    }

    if (kind === 'prompt') {
      const prompt = data.prompt as UserPromptData;
      let endTime: number | undefined;
      for (const c of children) {
        const cEnd = c.endTime ?? c.startTime;
        if (!endTime || cEnd > endTime) endTime = cEnd;
      }

      let tokens = childTokens;
      let count = Math.max(childCount, 1);
      let duration = Math.max((endTime ?? Date.now()) - prompt.timestamp, 1);

      // Enrich with transcript data when child tokens are 0
      if (tokens === 0 && transcripts && storePrompts) {
        const sessionPrompts = storePrompts.get(prompt.sessionId);
        const transcript = transcripts.get(prompt.sessionId);
        if (sessionPrompts && transcript) {
          const idx = sessionPrompts.findIndex((p) => p.id === prompt.id);
          const next = sessionPrompts[idx + 1];
          const windowStart = prompt.timestamp - 2000;
          const windowEnd = next ? next.timestamp : prompt.timestamp + 600_000;
          const assistantTurns = transcript.turns.filter(
            (t) => t.type === 'assistant' && t.timestamp >= windowStart && t.timestamp < windowEnd,
          );
          for (const at of assistantTurns) {
            tokens += at.totalInputTokens + at.outputTokens;
          }
          const txToolCount = assistantTurns.reduce((s, t) => s + t.toolUseCount, 0);
          if (txToolCount > 0) count = txToolCount;
          // Better duration from transcript timestamps
          if (assistantTurns.length > 0) {
            const lastTurn = assistantTurns[assistantTurns.length - 1];
            const txEnd = lastTurn.timestamp;
            if (txEnd > prompt.timestamp) {
              duration = txEnd - prompt.timestamp;
              if (!endTime || txEnd > endTime) endTime = txEnd;
            }
          }
        }
      }

      return {
        id: gNode.id,
        kind: 'prompt',
        label: prompt.text.length > 40 ? prompt.text.slice(0, 40) + '...' : prompt.text || '(empty)',
        status: 'success',
        tokens,
        count,
        startTime: prompt.timestamp,
        endTime,
        duration,
        depth,
        children,
      };
    }

    if (kind === 'agent') {
      const agent = data.agent as AgentNodeData;
      const selfTokens = agent.tokenUsage.input + agent.tokenUsage.output;
      return {
        id: gNode.id,
        kind: 'agent',
        label: agent.agentType,
        status: agent.status,
        tokens: selfTokens + childTokens,
        count: Math.max(childCount, 1),
        startTime: agent.startTime,
        endTime: agent.endTime,
        duration: (agent.endTime ?? Date.now()) - agent.startTime,
        depth,
        children,
      };
    }

    // kind === 'tool'
    const tc = data.toolCall as ToolCallSummary;
    return {
      id: gNode.id,
      kind: 'tool',
      label: tc.toolName,
      status: tc.status,
      tokens: childTokens,
      count: Math.max(childCount, 1),
      startTime: tc.startTime,
      endTime: tc.endTime,
      duration: (tc.endTime ?? Date.now()) - tc.startTime,
      depth,
      children,
    };
  }

  // Pass 1: build tree from roots
  const result: LensTreeNode[] = [];
  for (const root of roots) {
    if (visited.has(root.id)) continue;
    visited.add(root.id);
    const kind = TYPE_TO_KIND[root.type ?? ''];
    if (!kind) {
      // Unknown root type — promote its children as roots
      result.push(...collectChildren(root.id, 0));
      continue;
    }
    const children = groupToolChildren(collectChildren(root.id, 1));
    const node = makeLensNode(root, kind, children, 0);
    if (node) result.push(node);
  }

  // Pass 2: rescue orphaned nodes (edges to missing parents, multi-parent, etc.)
  for (const [id, gNode] of nodeById) {
    if (visited.has(id)) continue;
    visited.add(id);
    const kind = TYPE_TO_KIND[gNode.type ?? ''];
    if (!kind) continue;
    const children = groupToolChildren(collectChildren(id, 1));
    const node = makeLensNode(gNode, kind, children, 0);
    if (node) result.push(node);
  }

  return result;
}

/** Group consecutive same-name leaf tool nodes into "ToolName xN" entries */
function groupToolChildren(children: LensTreeNode[]): LensTreeNode[] {
  if (children.length === 0) return children;

  const result: LensTreeNode[] = [];
  let i = 0;

  while (i < children.length) {
    const child = children[i];

    // Only group leaf tools (tools with children like Task→agent stay ungrouped)
    if (child.kind !== 'tool' || child.children.length > 0) {
      result.push(child);
      i++;
      continue;
    }

    // Count consecutive same-label leaf tools
    let groupEnd = i + 1;
    while (
      groupEnd < children.length &&
      children[groupEnd].kind === 'tool' &&
      children[groupEnd].children.length === 0 &&
      children[groupEnd].label === child.label
    ) {
      groupEnd++;
    }

    const count = groupEnd - i;
    if (count === 1) {
      result.push(child);
      i++;
      continue;
    }

    // Group them
    const grouped = children.slice(i, groupEnd);
    const ids = grouped.map((t) => t.id);

    result.push({
      id: child.id,
      kind: 'tool',
      label: `${child.label} x${count}`,
      status: grouped.every((t) => t.status === 'success')
        ? 'success'
        : grouped.some((t) => t.status === 'error')
          ? 'error'
          : grouped.some((t) => t.status === 'running')
            ? 'running'
            : 'success',
      tokens: 0,
      count,
      startTime: child.startTime,
      endTime: grouped[grouped.length - 1].endTime,
      duration: (grouped[grouped.length - 1].endTime ?? Date.now()) - child.startTime,
      depth: child.depth,
      children: grouped.map((t) => ({ ...t, depth: child.depth + 1 })),
      groupCount: count,
      groupedIds: ids,
    });
    i = groupEnd;
  }

  return result;
}

// ── Waterfall derivation ────────────────────────────────────

function buildWaterfallSpans(treeRoots: LensTreeNode[], paletteIndex = 0): WaterfallSpan[] {
  const spans: WaterfallSpan[] = [];

  function flatten(node: LensTreeNode, parentId?: string) {
    const color = getKindColor(node.kind, node.label, paletteIndex);

    spans.push({
      id: node.id,
      label: node.label,
      kind: node.kind,
      status: node.status,
      startTime: node.startTime,
      endTime: node.endTime,
      depth: node.depth,
      color,
      parentId,
      tokens: node.tokens,
    });

    for (const child of node.children) {
      flatten(child, node.id);
    }
  }

  for (const root of treeRoots) {
    flatten(root);
  }
  return spans;
}

function computeTimeRange(spans: WaterfallSpan[]) {
  if (spans.length === 0) {
    const now = Date.now();
    return { min: now, max: now + 1000, duration: 1000 };
  }
  const min = Math.min(...spans.map((s) => s.startTime));
  const max = Math.max(...spans.map((s) => s.endTime ?? Date.now()));
  return { min, max, duration: Math.max(max - min, 1000) };
}

// ── Heatmap derivation ──────────────────────────────────────

const BUCKET_COUNT = 20;

function buildHeatmapData(
  waterfallSpans: WaterfallSpan[],
  timeRange: { min: number; max: number; duration: number },
): HeatmapData {
  const empty: HeatmapData = { actions: [], bucketLabels: [], grid: [], maxCount: 0, tokenGrid: [], maxTokens: 0 };
  // Only consider tool and agent spans
  const actionSpans = waterfallSpans.filter((s) => s.kind === 'tool' || s.kind === 'agent');
  if (actionSpans.length === 0) return empty;

  const bucketSize = timeRange.duration / BUCKET_COUNT;

  // Count + collect IDs + tokens per action per bucket
  const actionBuckets = new Map<string, { count: number; ids: string[]; tokens: number }[]>();
  const actionTotals = new Map<string, number>();

  for (const span of actionSpans) {
    const name = span.label.replace(/ x\d+$/, ''); // strip group suffix
    if (!actionBuckets.has(name)) {
      actionBuckets.set(
        name,
        Array.from({ length: BUCKET_COUNT }, () => ({ count: 0, ids: [] as string[], tokens: 0 })),
      );
      actionTotals.set(name, 0);
    }
    const buckets = actionBuckets.get(name)!;
    const startBucket = Math.min(
      BUCKET_COUNT - 1,
      Math.max(0, Math.floor((span.startTime - timeRange.min) / bucketSize)),
    );
    const endTime = span.endTime ?? Date.now();
    const endBucket = Math.min(
      BUCKET_COUNT - 1,
      Math.max(0, Math.floor((endTime - timeRange.min) / bucketSize)),
    );
    // Mark all buckets this span covers
    for (let b = startBucket; b <= endBucket; b++) {
      buckets[b].count++;
      buckets[b].ids.push(span.id);
      buckets[b].tokens += span.tokens;
    }
    actionTotals.set(name, (actionTotals.get(name) ?? 0) + 1);
  }

  // Sort actions by total count desc
  const actions = [...actionBuckets.keys()].sort(
    (a, b) => (actionTotals.get(b) ?? 0) - (actionTotals.get(a) ?? 0),
  );

  // Build grids (count + token)
  let maxCount = 0;
  let maxTokens = 0;
  const grid: HeatmapCell[][] = [];
  const tokenGrid: number[][] = [];

  for (const action of actions) {
    const buckets = actionBuckets.get(action)!;
    const countRow: HeatmapCell[] = [];
    const tokenRow: number[] = [];
    for (const cell of buckets) {
      if (cell.count > maxCount) maxCount = cell.count;
      if (cell.tokens > maxTokens) maxTokens = cell.tokens;
      countRow.push({ count: cell.count, ids: cell.ids });
      tokenRow.push(cell.tokens);
    }
    grid.push(countRow);
    tokenGrid.push(tokenRow);
  }

  // Bucket labels (relative time from start)
  const bucketLabels: string[] = [];
  for (let i = 0; i < BUCKET_COUNT; i++) {
    const ms = i * bucketSize;
    if (ms < 1000) bucketLabels.push(`${Math.round(ms)}ms`);
    else if (ms < 60000) bucketLabels.push(`${(ms / 1000).toFixed(0)}s`);
    else bucketLabels.push(`${(ms / 60000).toFixed(1)}m`);
  }

  return { actions, bucketLabels, grid, maxCount, tokenGrid, maxTokens };
}

// ── Sankey derivation ───────────────────────────────────────

function buildSankeyData(
  treeRoots: LensTreeNode[],
  metric: ProfileMetric,
  paletteIndex = 0,
): SankeyData {
  const nodes: SankeyNode[] = [];
  const links: SankeyLink[] = [];
  const seen = new Set<string>();

  function layerFor(node: LensTreeNode): number {
    return Math.min(node.depth, 3);
  }

  function addNode(node: LensTreeNode) {
    if (seen.has(node.id)) return;
    seen.add(node.id);
    const value = nodeMetricValue(node, metric);
    nodes.push({
      id: node.id,
      label: node.kind === 'tool' && node.groupCount ? `${node.label}` : node.label,
      kind: node.kind,
      layer: layerFor(node),
      value,
      color: getKindColor(node.kind, node.label, paletteIndex),
    });
  }

  function walk(node: LensTreeNode) {
    addNode(node);
    for (const child of node.children) {
      // Skip individual tools inside a grouped tool
      if (node.kind === 'tool' && child.kind === 'tool') continue;

      addNode(child);
      const value = nodeMetricValue(child, metric);
      links.push({ source: node.id, target: child.id, value: Math.max(value, 1) });
      walk(child);
    }
  }

  for (const root of treeRoots) walk(root);
  return { nodes, links };
}

// ── Compaction & cost derivation ─────────────────────────────

function buildCompactEvents(events: AgentEvent[]): CompactEvent[] {
  return events
    .filter((e) => e.type === 'compact')
    .map((e) => ({
      id: e.id,
      sessionId: e.sessionId,
      timestamp: e.timestamp,
      trigger: e.compactTrigger,
    }))
    .sort((a, b) => a.timestamp - b.timestamp);
}

function buildCostPerTurn(
  prompts: Map<string, UserPromptData[]>,
  agents: Map<string, AgentNodeData>,
  compactEvents: CompactEvent[],
  transcripts: Map<string, TranscriptSummary>,
): CostTurn[] {
  const turns: CostTurn[] = [];

  for (const [sessionId, sessionPrompts] of prompts) {
    const sorted = [...sessionPrompts].sort((a, b) => a.timestamp - b.timestamp);
    let cumInput = 0;
    let cumOutput = 0;

    // Get transcript turns for this session (if available)
    const transcript = transcripts.get(sessionId);
    const tTurns = transcript?.turns.filter((t) => t.type === 'assistant') ?? [];

    for (let i = 0; i < sorted.length; i++) {
      const prompt = sorted[i];
      const next = sorted[i + 1];

      // Sum tokens and tool calls from agents active during this turn (hook data)
      let turnInput = 0;
      let turnOutput = 0;
      let turnToolCount = 0;
      for (const a of agents.values()) {
        if (
          a.sessionId === sessionId &&
          a.startTime >= prompt.timestamp &&
          (!next || a.startTime < next.timestamp)
        ) {
          turnInput += a.tokenUsage.input;
          turnOutput += a.tokenUsage.output;
          turnToolCount += a.toolCalls.length;
        }
      }

      // Try transcript data: find assistant turns between this prompt and next
      let cacheReadTokens: number | undefined;
      let cacheCreationTokens: number | undefined;
      let model: string | undefined;
      let responseLatencyMs: number | undefined;
      let thinkingLength: number | undefined;
      let textLength: number | undefined;
      let dataSource: 'hook' | 'transcript' = 'hook';

      if (tTurns.length > 0) {
        // Find transcript assistant turns in this prompt's time window
        // Use a tolerance window: prompt timestamp -2s to next prompt timestamp (or +10min)
        const windowStart = prompt.timestamp - 2000;
        const windowEnd = next ? next.timestamp : prompt.timestamp + 600_000;
        const matched = tTurns.filter(
          (t) => t.timestamp >= windowStart && t.timestamp < windowEnd,
        );

        if (matched.length > 0) {
          let txInput = 0;
          let txOutput = 0;
          let txCacheRead = 0;
          let txCacheCreation = 0;
          let txThinking = 0;
          let txText = 0;
          let txToolCount = 0;

          for (const m of matched) {
            txInput += m.totalInputTokens;
            txOutput += m.outputTokens;
            txCacheRead += m.cacheReadTokens;
            txCacheCreation += m.cacheCreationTokens;
            txThinking += m.thinkingLength;
            txText += m.textLength;
            txToolCount += m.toolUseCount;
          }

          // Override with transcript data
          turnInput = txInput;
          turnOutput = txOutput;
          cacheReadTokens = txCacheRead;
          cacheCreationTokens = txCacheCreation;
          model = matched[0].model;
          thinkingLength = txThinking;
          textLength = txText;
          dataSource = 'transcript';
          if (turnToolCount === 0) turnToolCount = txToolCount;

          // Compute response latency (first assistant response after prompt)
          const firstAssistant = matched[0];
          if (firstAssistant.timestamp > prompt.timestamp) {
            responseLatencyMs = firstAssistant.timestamp - prompt.timestamp;
          }
        }
      }

      cumInput += turnInput;
      cumOutput += turnOutput;

      // Check if a compaction happened between previous turn and this one
      const prevTime = i > 0 ? sorted[i - 1].timestamp : 0;
      const compactionBefore = compactEvents.some(
        (c) => c.sessionId === sessionId && c.timestamp > prevTime && c.timestamp <= prompt.timestamp,
      );

      turns.push({
        promptId: prompt.id,
        promptText: prompt.text,
        sessionId,
        timestamp: prompt.timestamp,
        turnIndex: i,
        inputTokens: turnInput,
        outputTokens: turnOutput,
        cumulativeInput: cumInput,
        cumulativeOutput: cumOutput,
        toolCount: turnToolCount,
        compactionBefore,
        cacheReadTokens,
        cacheCreationTokens,
        model,
        responseLatencyMs,
        thinkingLength,
        textLength,
        dataSource,
      });
    }
  }

  return turns.sort((a, b) => a.timestamp - b.timestamp);
}

// ── Adapter component ───────────────────────────────────────

export function LensAdapter() {
  const graphNodes = useAgentStore((s) => s.nodes);
  const graphEdges = useAgentStore((s) => s.edges);
  const agents = useAgentStore((s) => s.agents);
  const prompts = useAgentStore((s) => s.prompts);
  const events = useAgentStore((s) => s.events);
  const selectedNodeId = useAgentStore((s) => s.selectedNodeId);
  const activeLensTab = useAgentStore((s) => s.activeLensTab);
  const lensPanelWidth = useAgentStore((s) => s.lensPanelWidth);
  const lensSearchQuery = useAgentStore((s) => s.lensSearchQuery);
  const profileMetric = useAgentStore((s) => s.profileMetric);
  const paletteIndex = useAgentStore((s) => s.paletteIndex);
  const sessions = useAgentStore((s) => s.sessions);

  // ── Transcript fetching ────────────────────────────────────
  const transcripts = useAgentStore((s) => s.transcripts);
  const fetchedRef = useRef(new Set<string>());

  useEffect(() => {
    for (const sessionId of sessions.keys()) {
      if (fetchedRef.current.has(sessionId)) continue;
      fetchedRef.current.add(sessionId);

      fetch(apiUrl(`/api/transcript/${sessionId}`))
        .then((r) => (r.ok ? r.json() : null))
        .then((data: TranscriptSummary | null) => {
          if (data && data.turns.length > 0) {
            useAgentStore.getState().setTranscript(sessionId, data);
          }
        })
        .catch(() => {
          // Transcript not available — hook-only session
        });
    }
  }, [sessions]);

  // Derive tree from graph topology (single source of truth)
  const treeRoots = useMemo(
    () => buildTreeRoots(graphNodes, graphEdges, transcripts, prompts),
    [graphNodes, graphEdges, transcripts, prompts],
  );

  // Derive waterfall data
  const waterfallSpans = useMemo(() => buildWaterfallSpans(treeRoots, paletteIndex), [treeRoots, paletteIndex]);
  const timeRange = useMemo(() => computeTimeRange(waterfallSpans), [waterfallSpans]);

  // Derive heatmap data
  const heatmapData = useMemo(
    () => buildHeatmapData(waterfallSpans, timeRange),
    [waterfallSpans, timeRange],
  );

  // Derive sankey data
  const sankeyData = useMemo(
    () => buildSankeyData(treeRoots, profileMetric, paletteIndex),
    [treeRoots, profileMetric, paletteIndex],
  );

  // Derive compaction events
  const compactEvents = useMemo(() => buildCompactEvents(events), [events]);

  // Derive cost per turn (enhanced with transcript data when available)
  const costPerTurn = useMemo(
    () => buildCostPerTurn(prompts, agents, compactEvents, transcripts),
    [prompts, agents, compactEvents, transcripts],
  );

  // Check if any agent has non-zero token data (from hooks/SDK or transcripts)
  const hasTokenData = useMemo(() => {
    for (const a of agents.values()) {
      if (a.tokenUsage.input > 0 || a.tokenUsage.output > 0) return true;
    }
    // Also check if transcript data provides tokens
    for (const t of transcripts.values()) {
      if (t.totalInputTokens > 0 || t.totalOutputTokens > 0) return true;
    }
    return false;
  }, [agents, transcripts]);

  // Status counts
  const statusCounts = useMemo(() => {
    const counts = { running: 0, success: 0, error: 0, stopped: 0 };
    for (const a of agents.values()) {
      if (a.status in counts) counts[a.status as keyof typeof counts]++;
    }
    return counts;
  }, [agents]);

  // Callbacks
  const onSelect = useCallback((id: string | null) => {
    useAgentStore.getState().selectNode(id, 'lens');
  }, []);

  const onTabChange = useCallback((tab: LensTab) => {
    useAgentStore.getState().setActiveLensTab(tab);
  }, []);

  const onSearchChange = useCallback((query: string) => {
    useAgentStore.getState().setLensSearchQuery(query);
  }, []);

  const onProfileMetricChange = useCallback((m: ProfileMetric) => {
    useAgentStore.getState().setProfileMetric(m);
  }, []);

  const onWidthChange = useCallback((w: number) => {
    useAgentStore.getState().setLensPanelWidth(w);
  }, []);

  const onSpawnClick = useCallback(() => {
    useAgentStore.getState().setShowSpawnDialog(true);
  }, []);

  const contextValue: LensContextValue = useMemo(
    () => ({
      treeRoots,
      heatmapData,
      sankeyData,
      compactEvents,
      costPerTurn,
      transcripts,
      selectedId: selectedNodeId,
      onSelect,
      activeTab: activeLensTab as LensTab,
      onTabChange,
      searchQuery: lensSearchQuery,
      onSearchChange,
      profileMetric,
      onProfileMetricChange,
      hasTokenData,
      statusCounts,
      onSpawnClick,
    }),
    [
      treeRoots,
      heatmapData,
      sankeyData,
      compactEvents,
      costPerTurn,
      transcripts,
      selectedNodeId,
      onSelect,
      activeLensTab,
      onTabChange,
      lensSearchQuery,
      onSearchChange,
      profileMetric,
      onProfileMetricChange,
      hasTokenData,
      statusCounts,
      onSpawnClick,
    ],
  );

  return (
    <LensProvider value={contextValue}>
      <LensPanel width={lensPanelWidth} onWidthChange={onWidthChange} />
    </LensProvider>
  );
}
