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
import type { ToolCallSummary, AssistantResponseData } from '@synapse-ai/core';

// ── Types ────────────────────────────────────────────────────

export interface UseVisibleGraphOptions {
  /** Override store autoClosePrompts (mobile uses true) */
  autoClosePrompts: boolean;
  /** Override store collapsedNodes (mobile uses empty set) */
  collapsedNodes: ReadonlySet<string>;
  /** Local toolGroupDims state from the consumer component */
  toolGroupDims: Map<string, { width: number; height: number }>;
  /** Local responseDims state — synthetic response nodes need measured dims fed back */
  responseDims?: Map<string, { width: number; height: number }>;
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
  const { autoClosePrompts, collapsedNodes, toolGroupDims, responseDims } = options;

  const allNodes = useAgentStore((s) => s.nodes);
  const allEdges = useAgentStore((s) => s.edges);
  const filterSessionId = useAgentStore((s) => s.filter.sessionId);
  const graphSearchQuery = useAgentStore((s) => s.graphSearchQuery);
  const selectedNodeId = useAgentStore((s) => s.selectedNodeId);
  const expandedTurns = useAgentStore((s) => s.expandedTurns);
  const responses = useAgentStore((s) => s.responses);
  // showAllTools/toolGroupMode affect rendering but are already reflected in rawNodes
  // via the AgentGraph visibility memo, so no need to include them here.

  // Phase 0: Session filtering — when a session is selected, keep only its nodes/edges.
  // We walk the edge graph from the session root to find all reachable nodes,
  // since not all node data objects carry a sessionId (e.g. toolCall nodes).
  const { rawNodes, rawEdges } = useMemo(() => {
    if (!filterSessionId) return { rawNodes: allNodes, rawEdges: allEdges };

    // Build adjacency: source → targets
    const children = new Map<string, string[]>();
    for (const e of allEdges) {
      const list = children.get(e.source) ?? [];
      list.push(e.target);
      children.set(e.source, list);
    }

    // BFS from the session root node
    const rootId = `session-${filterSessionId}`;
    const reachable = new Set<string>();
    const queue = [rootId];
    while (queue.length > 0) {
      const id = queue.pop()!;
      if (reachable.has(id)) continue;
      reachable.add(id);
      for (const child of children.get(id) ?? []) {
        queue.push(child);
      }
    }

    const filteredNodes = allNodes.filter((n) => reachable.has(n.id));
    const filteredEdges = allEdges.filter(
      (e) => reachable.has(e.source) && reachable.has(e.target),
    );
    return { rawNodes: filteredNodes, rawEdges: filteredEdges };
  }, [allNodes, allEdges, filterSessionId]);

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

  // Phase 1.5: Response node synthesis — always visible in TB layout.
  // Responses fan out as rows below the prompt's shelf area.
  // Each response owns children attributed by timestamp window.
  const { phase15Nodes, phase15Edges } = useMemo(() => {
    // Group ALL responses by promptId (always synthesize, not gated by expandedTurns)
    const promptResponses = new Map<string, AssistantResponseData[]>();
    const responseEntries = filterSessionId
      ? responses.get(filterSessionId)
        ? [responses.get(filterSessionId)!]
        : []
      : [...responses.values()];
    for (const sessionResponses of responseEntries) {
      for (const resp of sessionResponses) {
        const promptNodeId = `prompt-${resp.promptId}`;
        const list = promptResponses.get(promptNodeId) ?? [];
        list.push(resp);
        promptResponses.set(promptNodeId, list);
      }
    }

    if (promptResponses.size === 0) {
      return { phase15Nodes: baseNodes, phase15Edges: baseEdges };
    }

    // Build node lookup for timestamp extraction
    const nodeById = new Map(baseNodes.map((n) => [n.id, n]));
    function childTimestamp(nodeId: string): number {
      const n = nodeById.get(nodeId);
      if (!n?.data) return 0;
      const d = n.data as Record<string, unknown>;
      const agent = d.agent as { startTime?: number } | undefined;
      if (agent?.startTime) return agent.startTime;
      const tc = d.toolCall as { startTime?: number } | undefined;
      if (tc?.startTime) return tc.startTime;
      // Toolgroups: use earliest tool startTime
      const tools = d.tools as Array<{ startTime?: number }> | undefined;
      if (tools?.[0]?.startTime) return tools[0].startTime;
      return 0;
    }

    const syntheticNodes: Node[] = [];
    const syntheticEdges: Edge[] = [];
    const reparentedEdgeIds = new Set<string>();

    for (const [promptNodeId, respList] of promptResponses) {
      if (respList.length === 0) continue;

      // Sort responses by timestamp (oldest first)
      respList.sort((a, b) => a.timestamp - b.timestamp);

      // Create synthetic response nodes
      for (let i = 0; i < respList.length; i++) {
        const resp = respList[i];
        const nodeId = `response-${resp.id}`;
        const dims = responseDims?.get(nodeId);
        syntheticNodes.push({
          id: nodeId,
          type: 'assistantResponse',
          data: { response: resp, index: i, total: respList.length },
          position: { x: -9999, y: -9999 },
          style: { visibility: 'hidden' as const },
          ...(dims ? { measured: dims } : {}),
        });
      }

      // Fan-out edges: prompt → each response (siblings, not chain)
      for (const resp of respList) {
        syntheticEdges.push({
          id: `edge-${promptNodeId}-response-${resp.id}`,
          source: promptNodeId,
          target: `response-${resp.id}`,
          type: 'straight',
        });
      }

      // Collect children of the prompt (toolgroups, agents, structural tools)
      const childEdges = baseEdges.filter(
        (e) =>
          e.source === promptNodeId &&
          !e.target.startsWith('prompt-') &&
          !e.target.startsWith('session-'),
      );

      // Attribute each child to the response whose timestamp window contains it.
      // Window for response[i]: [response[i].timestamp, response[i+1].timestamp)
      // Last response gets everything remaining.
      for (const edge of childEdges) {
        reparentedEdgeIds.add(edge.id);
        const ts = childTimestamp(edge.target);
        let ownerResp = respList[respList.length - 1]; // default: last response
        for (let i = 0; i < respList.length - 1; i++) {
          if (ts <= respList[i].timestamp) {
            ownerResp = respList[i];
            break;
          }
        }
        syntheticEdges.push({
          ...edge,
          id: `reparented-${edge.id}`,
          source: `response-${ownerResp.id}`,
        });
      }
    }

    return {
      phase15Nodes: [...baseNodes, ...syntheticNodes],
      phase15Edges: [...baseEdges.filter((e) => !reparentedEdgeIds.has(e.id)), ...syntheticEdges],
    };
  }, [baseNodes, baseEdges, expandedTurns, responses, responseDims, filterSessionId]);

  // Phase 2+: Search, auto-close, collapse (depends on selection, search, etc.)
  return useMemo(() => {
    const query = graphSearchQuery.toLowerCase().trim();

    if (query) {
      const matchIds = new Set<string>();
      for (const node of phase15Nodes) {
        if (nodeMatchesSearch(node, query)) matchIds.add(node.id);
      }
      const parentOf = buildParentMap(phase15Edges);
      const keepIds = new Set<string>(matchIds);
      for (const id of matchIds) {
        collectAncestors(id, parentOf, keepIds);
      }
      keepIds.add('__spawn__');

      return {
        visibleNodes: phase15Nodes.filter((n) => keepIds.has(n.id)),
        visibleEdges: phase15Edges.filter((e) => keepIds.has(e.source) && keepIds.has(e.target)),
        searchMatchCount: matchIds.size,
      };
    }

    // Normal mode: auto-close prompts + manual collapse
    const hiddenIds = new Set<string>();

    if (autoClosePrompts) {
      const parentOf = buildParentMap(phase15Edges);
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
        const promptNodes = phase15Nodes.filter((n) => n.type === 'userPrompt');
        if (promptNodes.length > 0) expandedPrompt = promptNodes[promptNodes.length - 1].id;
      }
      for (const node of phase15Nodes) {
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
      const edgesForCollapse = phase15Edges.filter((e) => !hiddenIds.has(e.target));
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
      visibleNodes: phase15Nodes.filter((n) => !hiddenIds.has(n.id)),
      visibleEdges: phase15Edges.filter(
        (e) => !hiddenIds.has(e.source) && !hiddenIds.has(e.target),
      ),
      searchMatchCount: null as number | null,
    };
  }, [
    phase15Nodes,
    phase15Edges,
    rawEdges,
    graphSearchQuery,
    autoClosePrompts,
    selectedNodeId,
    collapsedNodes,
  ]);
}
