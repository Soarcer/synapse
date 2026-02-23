// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Synapse Contributors

import { useMemo, useCallback, useEffect, useRef } from 'react';
import type { Node, Edge } from '@xyflow/react';
import { useAgentStore } from '../../store/agentStore';
import type {
  SessionData,
  AgentNodeData,
  UserPromptData,
  TranscriptSummary,
} from '@synapse-ai/core';
import { apiUrl } from '../../utils/api';
import { extractUserMessage } from '../../utils/promptText';
import {
  LensProvider,
  type LensContextValue,
  type LensTreeNode,
  type LensTab,
  type ProfileMetric,
} from './LensContext';
import { LensPanel } from './LensPanel';

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
        label: session.title ?? session.sessionId.slice(0, 8),
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
        label: (() => {
          const t = extractUserMessage(prompt.text);
          return t.length > 40 ? t.slice(0, 40) + '...' : t || '(empty)';
        })(),
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

// ── Adapter component ───────────────────────────────────────

export function LensAdapter({
  fillWidth,
  children,
}: { fillWidth?: boolean; children?: React.ReactNode } = {}) {
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
    const unfetched: string[] = [];
    for (const sessionId of sessions.keys()) {
      if (fetchedRef.current.has(sessionId)) continue;
      fetchedRef.current.add(sessionId);
      unfetched.push(sessionId);
    }

    if (unfetched.length === 0) return;

    fetch(apiUrl('/api/transcript/batch'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionIds: unfetched }),
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((data: Record<string, TranscriptSummary | null> | null) => {
        if (!data) return;
        const store = useAgentStore.getState();
        for (const [sessionId, summary] of Object.entries(data)) {
          if (summary && summary.turns.length > 0) {
            store.setTranscript(sessionId, summary);
          }
        }
      })
      .catch(() => {
        // Transcripts not available
      });
  }, [sessions]);

  // Derive tree from graph topology (single source of truth)
  const treeRoots = useMemo(
    () => buildTreeRoots(graphNodes, graphEdges, transcripts, prompts),
    [graphNodes, graphEdges, transcripts, prompts],
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
      transcripts,
      agents,
      events,
      prompts,
      paletteIndex,
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
      transcripts,
      agents,
      events,
      prompts,
      paletteIndex,
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
      {children ?? (
        <LensPanel width={lensPanelWidth} onWidthChange={onWidthChange} fillWidth={fillWidth} />
      )}
    </LensProvider>
  );
}
