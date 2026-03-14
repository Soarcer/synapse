// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Bernhard

import { useMemo } from 'react';
import type { Node, Edge } from '@xyflow/react';
import { useAgentStore } from '../store/agentStore';
import {
  nodeMatchesSearch,
  buildParentMap,
  collectAncestors,
  buildChildrenMap,
} from '../utils/graphSearch';
import type { ToolCallSummary } from '@synapse-ai/core';

// ── Types ────────────────────────────────────────────────────

export interface UseVisibleGraphOptions {
  /** Override store autoClosePrompts (mobile uses true) */
  autoClosePrompts: boolean;
  /** Override store collapsedNodes (mobile uses empty set) */
  collapsedNodes: ReadonlySet<string>;
  /** Local toolGroupDims state from the consumer component */
  toolGroupDims: Map<string, { width: number; height: number }>;
}

export interface UseVisibleGraphResult {
  visibleNodes: Node[];
  visibleEdges: Edge[];
  searchMatchCount: number | null;
}

// ── Hook ─────────────────────────────────────────────────────

/**
 * Shared visibility filtering logic: replaces leaf tools with toolGroup nodes,
 * applies search filtering, auto-close prompts, and manual collapse.
 *
 * Used by both AgentGraph (desktop) and MobileGraphView.
 */
export function useVisibleGraph(options: UseVisibleGraphOptions): UseVisibleGraphResult {
  const { autoClosePrompts, collapsedNodes, toolGroupDims } = options;

  const rawNodes = useAgentStore((s) => s.nodes);
  const rawEdges = useAgentStore((s) => s.edges);
  const graphSearchQuery = useAgentStore((s) => s.graphSearchQuery);
  const rawSelectedNodeId = useAgentStore((s) => s.selectedNodeId);
  // Only track selection changes when autoClosePrompts needs it —
  // otherwise node clicks skip the entire visibility recomputation.
  const selectedNodeId = autoClosePrompts ? rawSelectedNodeId : null;
  // showAllTools/toolGroupMode affect rendering but are already reflected in rawNodes
  // via the AgentGraph visibility memo, so no need to include them here.

  // Phase 1: Toolgroup synthesis (only depends on structure + dims).
  // Cached across selection/search changes so clicking through nodes
  // rapidly skips the O(edges) toolgroup synthesis.
  const { baseNodes, baseEdges } = useMemo(() => {
    const structuralToolIds = new Set<string>();
    for (const edge of rawEdges) {
      if (edge.source.startsWith('tool-') && edge.target.startsWith('agent-')) {
        structuralToolIds.add(edge.source);
      }
    }

    const leafToolsByParent = new Map<string, string[]>();
    const leafToolNodeIds = new Set<string>();
    for (const edge of rawEdges) {
      if (edge.target.startsWith('tool-') && !structuralToolIds.has(edge.target)) {
        leafToolNodeIds.add(edge.target);
        const list = leafToolsByParent.get(edge.source) ?? [];
        list.push(edge.target);
        leafToolsByParent.set(edge.source, list);
      }
    }

    const rawNodeById = new Map(rawNodes.map((n) => [n.id, n]));
    const syntheticNodes: Node[] = [];
    const syntheticEdges: Edge[] = [];

    for (const [parentId, toolIds] of leafToolsByParent) {
      const tools: ToolCallSummary[] = [];
      for (const tid of toolIds) {
        const node = rawNodeById.get(tid);
        if (node) {
          const tc = (node.data as Record<string, unknown>).toolCall as ToolCallSummary;
          if (tc) tools.push(tc);
        }
      }
      if (tools.length === 0) continue;
      const tgId = `toolgroup-${parentId}`;
      syntheticNodes.push({
        id: tgId,
        type: 'toolGroup',
        data: { tools, parentAgentId: parentId },
        position: { x: -9999, y: -9999 },
        style: { visibility: 'hidden' as const },
        measured: toolGroupDims.get(tgId),
      });
      syntheticEdges.push({
        id: `edge-${parentId}-toolgroup-${parentId}`,
        source: parentId,
        target: `toolgroup-${parentId}`,
      });
    }

    return {
      baseNodes: [...rawNodes.filter((n) => !leafToolNodeIds.has(n.id)), ...syntheticNodes],
      baseEdges: [...rawEdges.filter((e) => !leafToolNodeIds.has(e.target)), ...syntheticEdges],
    };
  }, [rawNodes, rawEdges, toolGroupDims]);

  // Phase 2+: Search, auto-close, collapse (depends on selection, search, etc.)
  return useMemo(() => {
    const query = graphSearchQuery.toLowerCase().trim();

    if (query) {
      const matchIds = new Set<string>();
      for (const node of baseNodes) {
        if (nodeMatchesSearch(node, query)) matchIds.add(node.id);
      }
      const parentOf = buildParentMap(baseEdges);
      const keepIds = new Set<string>(matchIds);
      for (const id of matchIds) {
        collectAncestors(id, parentOf, keepIds);
      }
      keepIds.add('__spawn__');

      return {
        visibleNodes: baseNodes.filter((n) => keepIds.has(n.id)),
        visibleEdges: baseEdges.filter((e) => keepIds.has(e.source) && keepIds.has(e.target)),
        searchMatchCount: matchIds.size,
      };
    }

    // Normal mode: auto-close prompts + manual collapse
    const hiddenIds = new Set<string>();

    if (autoClosePrompts) {
      const parentOf = buildParentMap(baseEdges);
      let expandedPrompt: string | null = null;
      if (selectedNodeId) {
        let walkStart: string | undefined = selectedNodeId;
        if (selectedNodeId.startsWith('tool-')) {
          for (const edge of rawEdges) {
            if (edge.target === selectedNodeId) {
              walkStart = `toolgroup-${edge.source}`;
              break;
            }
          }
        }
        let walk: string | undefined = walkStart;
        while (walk) {
          if (walk.startsWith('prompt-')) {
            expandedPrompt = walk;
            break;
          }
          walk = parentOf.get(walk);
        }
      }
      if (!expandedPrompt) {
        const promptNodes = baseNodes.filter((n) => n.type === 'userPrompt');
        if (promptNodes.length > 0) expandedPrompt = promptNodes[promptNodes.length - 1].id;
      }
      for (const node of baseNodes) {
        if (node.type === 'session' || node.type === 'userPrompt' || node.id === '__spawn__')
          continue;
        if (hiddenIds.has(node.id)) continue;
        let promptAncestor: string | null = null;
        let walk: string | undefined = node.id;
        while (walk) {
          if (walk.startsWith('prompt-')) {
            promptAncestor = walk;
            break;
          }
          walk = parentOf.get(walk);
        }
        if (promptAncestor && promptAncestor !== expandedPrompt) {
          hiddenIds.add(node.id);
        }
      }
    }

    if (collapsedNodes.size > 0) {
      const edgesForCollapse = baseEdges.filter((e) => !hiddenIds.has(e.target));
      const allChildrenOf = buildChildrenMap(edgesForCollapse);
      for (const cid of collapsedNodes) {
        const queue = [...(allChildrenOf.get(cid) ?? [])];
        while (queue.length > 0) {
          const id = queue.shift()!;
          if (hiddenIds.has(id)) continue;
          hiddenIds.add(id);
          for (const child of allChildrenOf.get(id) ?? []) queue.push(child);
        }
      }
    }

    return {
      visibleNodes: baseNodes.filter((n) => !hiddenIds.has(n.id)),
      visibleEdges: baseEdges.filter((e) => !hiddenIds.has(e.source) && !hiddenIds.has(e.target)),
      searchMatchCount: null as number | null,
    };
  }, [
    baseNodes,
    baseEdges,
    rawEdges,
    graphSearchQuery,
    autoClosePrompts,
    selectedNodeId,
    collapsedNodes,
  ]);
}
