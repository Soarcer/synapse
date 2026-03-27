// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Bernhard

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
  mode: string,
): number {
  const len = tools.length;
  if (len === 0) return -1;

  if (mode === 'timeline') {
    // Timeline is horizontal — left/right step through tools
    if (key === 'ArrowLeft') return currentIndex === 0 ? -1 : currentIndex - 1;
    if (key === 'ArrowRight') return Math.min(currentIndex + 1, len - 1);
    // Up/Down: no-op for linear timeline
    return currentIndex;
  }

  if (mode === 'pillGrid') {
    const numRows = Math.min(len, PILL_MAX_ROWS);
    const col = Math.floor(currentIndex / numRows);
    const row = currentIndex % numRows;

    // Up/Down: visual — move within same column
    if (key === 'ArrowUp') {
      if (row === 0) return currentIndex; // already at top of column
      return currentIndex - 1;
    }
    if (key === 'ArrowDown') {
      if (row >= numRows - 1) return currentIndex; // at bottom of column
      return Math.min(currentIndex + 1, len - 1);
    }
    // Left/Right: visual — move across columns (same row)
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
    const rowNames: string[] = [];
    for (let i = 0; i < len; i++) {
      const name = tools[i].toolName;
      if (!byName.has(name)) rowNames.push(name);
      const list = byName.get(name) ?? [];
      list.push(i);
      byName.set(name, list);
    }

    const currentName = tools[currentIndex].toolName;
    const currentRowIndices = byName.get(currentName)!;
    const colInRow = currentRowIndices.indexOf(currentIndex);
    const rowIdx = rowNames.indexOf(currentName);

    // Left/Right: within same tool-name row
    if (key === 'ArrowLeft') {
      if (colInRow === 0) return -1; // go to parent
      return currentRowIndices[colInRow - 1];
    }
    if (key === 'ArrowRight') {
      if (colInRow >= currentRowIndices.length - 1) return currentIndex;
      return currentRowIndices[colInRow + 1];
    }
    // Up/Down: visual — move between rows (same column position or last in row)
    if (key === 'ArrowUp') {
      if (rowIdx <= 0) return currentIndex;
      const prevRow = byName.get(rowNames[rowIdx - 1])!;
      return prevRow[Math.min(colInRow, prevRow.length - 1)];
    }
    if (key === 'ArrowDown') {
      if (rowIdx >= rowNames.length - 1) return currentIndex;
      const nextRow = byName.get(rowNames[rowIdx + 1])!;
      return nextRow[Math.min(colInRow, nextRow.length - 1)];
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
    const HANDLED_KEYS = [
      'ArrowUp',
      'ArrowDown',
      'ArrowLeft',
      'ArrowRight',
      '[',
      ']', // prev/next sibling (logical navigation)
      'Enter',
      ' ',
    ];

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

          // [ / ] — logical prev/next tool (wraps around)
          if (e.key === '[' || e.key === ']') {
            const len = tg.tools.length;
            let nextIdx: number;
            if (e.key === '[') {
              nextIdx = tg.index > 0 ? tg.index - 1 : len - 1;
            } else {
              nextIdx = tg.index < len - 1 ? tg.index + 1 : 0;
            }
            if (nextIdx !== tg.index) {
              selectNode(`tool-${tg.tools[nextIdx].toolUseId}`, 'graph');
            }
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
        if (e.key === 'ArrowRight' || e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ') {
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

      // ── Default graph-level navigation (TB layout) ─────────
      // Up/Down = spine navigation (parent/child — vertical depth)
      // Left/Right = shelf navigation (siblings at same level — horizontal breadth)
      // [ / ] = logical prev/next sibling (wraps around)
      const NAV_KEYS = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', '[', ']'];
      if (!NAV_KEYS.includes(e.key)) return;

      e.preventDefault();

      const currentNode = vNodes.find((n) => n.id === currentId);
      if (!currentNode) return;
      const currentType = currentNode.type;

      let targetId: string | null = null;

      if (e.key === 'ArrowUp') {
        // Go to parent node (up the spine)
        targetId = parentOf.get(currentId) ?? null;
      } else if (e.key === 'ArrowDown') {
        // Go to first child node (down the spine)
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
      } else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        // Left/Right — navigate siblings at the same level (shelf navigation)
        const parentId = parentOf.get(currentId);
        const siblings = parentId
          ? (childrenOf.get(parentId) ?? [])
          : vNodes.filter((n) => !parentOf.has(n.id) && n.id !== '__spawn__').map((n) => n.id);

        const idx = siblings.indexOf(currentId);
        if (idx < 0 || siblings.length <= 1) return;

        if (e.key === 'ArrowLeft') {
          targetId = idx > 0 ? siblings[idx - 1] : null; // no wrap — stop at edge
        } else {
          targetId = idx < siblings.length - 1 ? siblings[idx + 1] : null;
        }
      } else {
        // [ / ] — logical prev/next sibling of same type (wraps around)
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

        if (e.key === '[') {
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
