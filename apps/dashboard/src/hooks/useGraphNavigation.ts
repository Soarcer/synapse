// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Synapse Contributors

import { useEffect, useLayoutEffect, useRef } from 'react';
import { useAgentStore } from '../store/agentStore';
import type { Node, Edge } from '@xyflow/react';
import type { ToolCallSummary } from '@synapse-ai/core';
import { PILL_MAX_ROWS, type ToolGroupData } from '../components/graph/nodes/ToolGroupNode';

// ── Tool-level navigation algorithm ──────────────────────────

/**
 * Compute the next tool index within a tool group.
 * Returns the new index, or -1 to navigate to the parent node.
 */
export function getNextToolIndex(
  tools: ToolCallSummary[],
  currentIndex: number,
  key: string,
  mode: 'pillGrid' | 'timeline' | 'heatmap' | 'bubbles' | 'tetris',
): number {
  const len = tools.length;
  if (len === 0) return -1;

  if (mode === 'timeline') {
    if (key === 'ArrowLeft') return currentIndex === 0 ? -1 : currentIndex - 1;
    if (key === 'ArrowRight') return Math.min(currentIndex + 1, len - 1);
    // Up/Down: no-op for linear timeline
    return currentIndex;
  }

  if (mode === 'pillGrid') {
    const numRows = Math.min(len, PILL_MAX_ROWS);
    const col = Math.floor(currentIndex / numRows);
    const row = currentIndex % numRows;

    // Up/Down: chronological (prev/next in flat array)
    if (key === 'ArrowUp') {
      return currentIndex > 0 ? currentIndex - 1 : currentIndex;
    }
    if (key === 'ArrowDown') {
      return currentIndex < len - 1 ? currentIndex + 1 : currentIndex;
    }
    // Left/Right: grid-based (across columns)
    if (key === 'ArrowLeft') {
      if (col === 0) return -1; // go to parent
      const target = (col - 1) * numRows + row;
      return target < len ? target : currentIndex;
    }
    if (key === 'ArrowRight') {
      const target = (col + 1) * numRows + row;
      return target < len ? target : currentIndex;
    }
  }

  if (mode === 'heatmap') {
    // Build row structure: toolName → indices in the flat tools array
    const byName = new Map<string, number[]>();
    for (let i = 0; i < len; i++) {
      const name = tools[i].toolName;
      const list = byName.get(name) ?? [];
      list.push(i);
      byName.set(name, list);
    }

    const currentName = tools[currentIndex].toolName;
    const currentRowIndices = byName.get(currentName)!;
    const colInRow = currentRowIndices.indexOf(currentIndex);

    // Left/Right: within same tool-name row
    if (key === 'ArrowLeft') {
      if (colInRow === 0) return -1; // go to parent
      return currentRowIndices[colInRow - 1];
    }
    if (key === 'ArrowRight') {
      if (colInRow >= currentRowIndices.length - 1) return currentIndex;
      return currentRowIndices[colInRow + 1];
    }
    // Up/Down: chronological (prev/next in flat array)
    if (key === 'ArrowUp') {
      return currentIndex > 0 ? currentIndex - 1 : currentIndex;
    }
    if (key === 'ArrowDown') {
      return currentIndex < len - 1 ? currentIndex + 1 : currentIndex;
    }
  }

  return currentIndex;
}

// ── Find the toolGroup node containing a tool-* ID ───────────

function findToolGroup(
  toolId: string,
  nodes: Node[],
): { node: Node; tools: ToolCallSummary[]; index: number } | null {
  const suffix = toolId.replace(/^tool-/, '');
  for (const n of nodes) {
    if (n.type !== 'toolGroup') continue;
    const { tools } = n.data as unknown as ToolGroupData;
    const idx = tools.findIndex((t) => t.toolUseId === suffix);
    if (idx >= 0) return { node: n, tools, index: idx };
  }
  return null;
}

// ── Hook ─────────────────────────────────────────────────────

export function useGraphNavigation(
  visibleNodes: Node[],
  visibleEdges: Edge[],
  selectNode: (id: string | null, source?: 'graph' | 'lens') => void,
  fitView: (options?: { nodes?: { id: string }[]; padding?: number; duration?: number }) => void,
) {
  const visibleNodesRef = useRef(visibleNodes);
  const visibleEdgesRef = useRef(visibleEdges);
  useLayoutEffect(() => {
    visibleNodesRef.current = visibleNodes;
    visibleEdgesRef.current = visibleEdges;
  }, [visibleNodes, visibleEdges]);

  useEffect(() => {
    const HANDLED_KEYS = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Enter', ' '];

    const handleKeyNav = (e: KeyboardEvent) => {
      if (!HANDLED_KEYS.includes(e.key)) return;

      const tag = document.activeElement?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;

      const currentId = useAgentStore.getState().selectedNodeId;
      if (!currentId || currentId === '__spawn__') return;

      const vNodes = visibleNodesRef.current;
      const vEdges = visibleEdgesRef.current;

      // Build parent/children maps
      const parentOf = new Map<string, string>();
      const childrenOf = new Map<string, string[]>();
      for (const edge of vEdges) {
        parentOf.set(edge.target, edge.source);
        const kids = childrenOf.get(edge.source) ?? [];
        kids.push(edge.target);
        childrenOf.set(edge.source, kids);
      }

      // ── Scenario A: navigating within a tool group ─────────
      if (currentId.startsWith('tool-')) {
        const tg = findToolGroup(currentId, vNodes);

        if (tg) {
          const { toolGroupMode, showAllTools } = useAgentStore.getState();
          if (!showAllTools) return;

          e.preventDefault();
          e.stopImmediatePropagation(); // prevent App.tsx Space/pause handler

          // Enter/Space: confirm selection (currently same as click)
          if (e.key === 'Enter' || e.key === ' ') {
            selectNode(currentId, 'graph');
            return;
          }

          const nextIndex = getNextToolIndex(tg.tools, tg.index, e.key, toolGroupMode);

          if (nextIndex === -1) {
            // Navigate to parent agent node
            const parentId = parentOf.get(tg.node.id) ?? null;
            if (parentId) {
              selectNode(parentId, 'graph');
              setTimeout(() => {
                fitView({ nodes: [{ id: parentId }], duration: 200, padding: 0.8 });
              }, 50);
            }
            return;
          }

          if (nextIndex !== tg.index) {
            selectNode(`tool-${tg.tools[nextIndex].toolUseId}`, 'graph');
          }
          return;
        }

        // Standalone tool node (e.g. Task tool not in a group) —
        // Enter/Space opens detail panel, arrow keys fall through
        // to default graph navigation below
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          e.stopImmediatePropagation();
          selectNode(currentId, 'graph');
          return;
        }
      }

      // ── Scenario B: entering a toolGroup from itself ───────
      if (currentId.startsWith('toolgroup-')) {
        if (e.key === 'ArrowRight' || e.key === 'Enter' || e.key === ' ') {
          const tgNode = vNodes.find((n) => n.id === currentId);
          if (tgNode && useAgentStore.getState().showAllTools) {
            const { tools } = tgNode.data as unknown as ToolGroupData;
            if (tools.length > 0) {
              e.preventDefault();
              selectNode(`tool-${tools[0].toolUseId}`, 'graph');
              return;
            }
          }
        }
        // Fall through to default graph navigation for other keys
      }

      // ── Default graph-level navigation ─────────────────────
      if (!['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) return;

      e.preventDefault();

      const currentNode = vNodes.find((n) => n.id === currentId);
      if (!currentNode) return;
      const currentType = currentNode.type;

      let targetId: string | null = null;

      if (e.key === 'ArrowLeft') {
        // Go to parent node
        targetId = parentOf.get(currentId) ?? null;
      } else if (e.key === 'ArrowRight') {
        // Go to first child node
        const kids = childrenOf.get(currentId) ?? [];
        targetId = kids[0] ?? null;

        // Scenario C: transparent toolGroup entry
        if (targetId?.startsWith('toolgroup-') && useAgentStore.getState().showAllTools) {
          const tgNode = vNodes.find((n) => n.id === targetId);
          if (tgNode) {
            const { tools } = tgNode.data as unknown as ToolGroupData;
            if (tools.length > 0) {
              selectNode(`tool-${tools[0].toolUseId}`, 'graph');
              return;
            }
          }
        }
      } else {
        // ArrowUp / ArrowDown — navigate siblings of same type
        const parentId = parentOf.get(currentId);
        const sameTypeSiblings = parentId
          ? (childrenOf.get(parentId) ?? []).filter((id) => {
              const n = vNodes.find((nd) => nd.id === id);
              return n?.type === currentType;
            })
          : vNodes
              .filter((n) => n.type === currentType && !parentOf.has(n.id) && n.id !== '__spawn__')
              .map((n) => n.id);

        const idx = sameTypeSiblings.indexOf(currentId);
        if (idx < 0 || sameTypeSiblings.length <= 1) return;

        if (e.key === 'ArrowUp') {
          targetId = sameTypeSiblings[idx > 0 ? idx - 1 : sameTypeSiblings.length - 1];
        } else {
          targetId = sameTypeSiblings[idx < sameTypeSiblings.length - 1 ? idx + 1 : 0];
        }
      }

      if (targetId && targetId !== currentId) {
        selectNode(targetId, 'graph');
        setTimeout(() => {
          fitView({ nodes: [{ id: targetId! }], duration: 200, padding: 0.8 });
        }, 50);
      }
    };

    window.addEventListener('keydown', handleKeyNav);
    return () => window.removeEventListener('keydown', handleKeyNav);
  }, [selectNode, fitView]);
}
