// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Bernhard

import { useMemo } from 'react';
import type { Node, Edge } from '@xyflow/react';

/**
 * Shared edge styling: assigns correct sourceHandle/targetHandle IDs and edge
 * types for TB layout (vertical spine + horizontal shelves).
 *
 * Thread edges (prompt→prompt visual chains) are re-routed from their original
 * `thread-out`/`thread-in` handles to `structural` handles so they render as
 * vertical spine connectors.
 *
 * Shelf edges (prompt→response, agent→toolGroup, etc.) get the `shelf` or
 * `tools` sourceHandle so they exit from the right side of the source node.
 *
 * Used by both AgentGraph (desktop) and MobileGraphView.
 */
export function useStyledEdges(visibleNodes: Node[], visibleEdges: Edge[]): Edge[] {
  return useMemo(() => {
    // Build node type lookup for handle ID assignment
    const nodeTypeMap = new Map<string, string>();
    for (const n of visibleNodes) {
      nodeTypeMap.set(n.id, n.type ?? '');
    }

    // Shelf node types receive edges from the Left handle.
    const isShelf = (type: string) =>
      type !== 'session' && type !== 'userPrompt' && type !== 'spawnAgent' && type !== '';

    return visibleEdges.map((edge) => {
      const isThread = edge.id.startsWith('thread-');

      // Assign explicit handle IDs based on node types
      const sourceType = nodeTypeMap.get(edge.source) ?? '';
      const targetType = nodeTypeMap.get(edge.target) ?? '';
      let sourceHandle: string | undefined = edge.sourceHandle ?? 'structural';
      let targetHandle: string | undefined = edge.targetHandle ?? undefined;

      // TB mode: thread edges become spine edges (re-route to structural handles)
      if (isThread) {
        sourceHandle = 'structural';
        targetHandle = undefined;
      } else if (isShelf(targetType)) {
        // Shelf edge: source handle depends on the source node type
        if (sourceType === 'agent') {
          sourceHandle = 'tools';
        } else if (sourceType === 'userPrompt' || sourceType === 'session') {
          sourceHandle = 'shelf';
        } else {
          // assistantResponse, toolCall, etc. — use default handle (no named ID)
          sourceHandle = undefined;
        }
      }

      // Shelf edges with a single sibling use straight lines (no smoothstep kinks).
      // Multi-child shelf edges and spine/thread edges use smoothstep for routing.
      const isShelfEdge = !isThread && isShelf(targetType);
      const sourceShelfCount = isShelfEdge
        ? visibleEdges.filter(
            (e) =>
              e.source === edge.source &&
              !e.id.startsWith('thread-') &&
              isShelf(nodeTypeMap.get(e.target) ?? ''),
          ).length
        : 0;
      const edgeType = isShelfEdge && sourceShelfCount === 1 ? 'straight' : 'smoothstep';

      return {
        ...edge,
        type: edgeType as 'straight' | 'smoothstep',
        ...(edgeType === 'smoothstep' ? { pathOptions: { borderRadius: 12 } } : {}),
        sourceHandle,
        targetHandle,
        // Thread edges: clear LR-era styling (blue straight line → normal structural edge)
        ...(isThread ? { markerEnd: undefined, animated: false } : {}),
      };
    });
  }, [visibleNodes, visibleEdges]);
}
