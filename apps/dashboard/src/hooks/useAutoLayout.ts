// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Bernhard

import { useMemo } from 'react';
import type { Node, Edge } from '@xyflow/react';
// Custom tree layout — no external layout library needed

// ── Fallback dimensions (used before DOM measurement) ────────

const NODE_DEFAULTS: Record<string, { width: number; height: number }> = {
  session: { width: 220, height: 65 },
  userPrompt: { width: 240, height: 150 }, // worst case: 3-line preview + compaction + stats ≈ 127px + margin
  agent: { width: 200, height: 100 }, // accounts for tokens + tool count badge
  toolCall: { width: 150, height: 28 },
  toolGroup: { width: 280, height: 120 }, // composite tool group (pill grid default)
  spawnAgent: { width: 50, height: 50 },
};

// ── Spacing constants ────────────────────────────────────────

const GAP_X = 120; // horizontal gap between ranks (dagre ranksep)
const GAP_Y = 32; // vertical gap between sibling structural nodes (dagre nodesep)
const ROOT_GAP = 24; // extra vertical gap between independent root trees
const MARGIN = 20; // canvas margin
const TOOL_GAP_X = 56; // horizontal gap between parent and tool stack

// ── Tool layout constants ────────────────────────────────────

const STACK_OVERLAP_FRACTION = 0.75; // offset = 75% of tool height (25% overlap)
const MAX_STACK_PER_COL = 10; // max tools per stacking column before cascading
const MAX_GRID_ROWS = 10; // max tools per column before adding another column
const GRID_GAP_X = 20; // horizontal gap between grid columns
const GRID_GAP_Y = 6; // vertical gap between grid rows

// ── Helpers ──────────────────────────────────────────────────

function nodeDims(node: Node): { width: number; height: number } {
  const m = node.measured;
  if (m?.width && m?.height) return { width: m.width, height: m.height };
  return NODE_DEFAULTS[node.type ?? ''] ?? { width: 180, height: 80 };
}

// ── Timestamp extraction (shared by graph + list layouts) ────

function nodeTimestampFromNode(n: Node): number {
  const d = n.data as Record<string, unknown> | undefined;
  if (!d) return 0;
  const session = d.session as { startTime?: number } | undefined;
  if (session?.startTime) return session.startTime;
  const prompt = d.prompt as { timestamp?: number } | undefined;
  if (prompt?.timestamp) return prompt.timestamp;
  const agent = d.agent as { startTime?: number } | undefined;
  if (agent?.startTime) return agent.startTime;
  const toolCall = d.toolCall as { startTime?: number } | undefined;
  if (toolCall?.startTime) return toolCall.startTime;
  return 0;
}

// ── Dagre hybrid layout (LR) ────────────────────────────────
// Uses dagre for structural nodes (sessions, prompts, agents,
// structural tools) and a custom post-pass for leaf tool stacking.

/** @internal Exported for testing */
export function computeGraphLayout(
  graphNodes: Node[],
  edges: Edge[],
  expandedParentId: string | null,
): { positions: Map<string, { x: number; y: number }>; zIndexMap: Map<string, number> } {
  // ── Step 0: Build adjacency structures ──────────────────────
  const childrenOf = new Map<string, string[]>();
  const parentOf = new Map<string, string>();
  const nodeById = new Map<string, Node>();

  for (const n of graphNodes) nodeById.set(n.id, n);

  for (const edge of edges) {
    if (!nodeById.has(edge.source) || !nodeById.has(edge.target)) continue;
    parentOf.set(edge.target, edge.source);
    const kids = childrenOf.get(edge.source) ?? [];
    kids.push(edge.target);
    childrenOf.set(edge.source, kids);
  }

  // ── Step 0b: Sort children chronologically (oldest first → top) ──
  function nodeTimestamp(id: string): number {
    const n = nodeById.get(id);
    return n ? nodeTimestampFromNode(n) : 0;
  }

  for (const [parentId, kids] of childrenOf) {
    kids.sort((a, b) => nodeTimestamp(a) - nodeTimestamp(b));
    childrenOf.set(parentId, kids);
  }

  // ── Step 1: Classify leaf tools vs structural nodes ─────────
  const leafToolsByParent = new Map<string, string[]>();
  const structuralNodeIds = new Set<string>();

  for (const node of graphNodes) {
    const kids = childrenOf.get(node.id);
    const isLeafTool = node.type === 'toolCall' && (!kids || kids.length === 0);
    if (isLeafTool) {
      const pid = parentOf.get(node.id);
      if (pid) {
        const list = leafToolsByParent.get(pid) ?? [];
        list.push(node.id);
        leafToolsByParent.set(pid, list);
      } else {
        // Orphan tool with no parent — treat as structural for dagre
        structuralNodeIds.add(node.id);
      }
    } else {
      structuralNodeIds.add(node.id);
    }
  }

  // Sort leaf tools under each parent chronologically (oldest first)
  for (const [, tools] of leafToolsByParent) {
    tools.sort((a, b) => nodeTimestamp(a) - nodeTimestamp(b));
  }

  // ── Step 2: Compute tool stack heights for dagre inflation ──
  function computeToolStackHeight(pid: string, tools: string[]): number {
    let maxToolH = 0;
    for (const tid of tools) {
      const tn = nodeById.get(tid);
      if (tn) maxToolH = Math.max(maxToolH, nodeDims(tn).height);
    }
    const toolH = maxToolH || NODE_DEFAULTS.toolCall.height;

    if (pid === expandedParentId) {
      // Grid layout height
      const maxRows = Math.min(tools.length, MAX_GRID_ROWS);
      const numCols = Math.ceil(tools.length / MAX_GRID_ROWS);
      const cascadeY = toolH / 2;
      return maxRows * (toolH + GRID_GAP_Y) - GRID_GAP_Y + (numCols - 1) * cascadeY;
    }
    // Stacked layout height
    const offset = toolH * STACK_OVERLAP_FRACTION;
    return toolH + (tools.length - 1) * offset;
  }

  // ── Step 3: Find roots and collect subtrees ─────────────────
  const roots = graphNodes
    .filter((n) => !parentOf.has(n.id))
    .sort((a, b) => nodeTimestamp(a.id) - nodeTimestamp(b.id));

  function collectSubtree(rootId: string): Set<string> {
    const result = new Set<string>();
    const queue = [rootId];
    while (queue.length > 0) {
      const id = queue.shift()!;
      if (result.has(id)) continue;
      result.add(id);
      for (const kid of childrenOf.get(id) ?? []) queue.push(kid);
    }
    return result;
  }

  // ── Step 4: Custom tree layout per root tree ────────────────
  const positions = new Map<string, { x: number; y: number }>();
  const zIndexMap = new Map<string, number>();
  let globalOffsetY = MARGIN;

  for (const root of roots) {
    const subtreeIds = collectSubtree(root.id);

    // ── Custom tree layout: parent centered over children ────────
    // Guarantees single children align with parent, multiple children
    // fan out evenly, and no edge crossings.

    // Build structural-children map for this subtree
    const structKids = new Map<string, string[]>();
    for (const id of subtreeIds) {
      if (!structuralNodeIds.has(id)) continue;
      const kids = (childrenOf.get(id) ?? []).filter(
        (k) => structuralNodeIds.has(k) && subtreeIds.has(k),
      );
      structKids.set(id, kids);
    }

    // Compute ranks (depth from root) via BFS
    const nodeRank = new Map<string, number>();
    nodeRank.set(root.id, 0);
    const bfs: string[] = [root.id];
    while (bfs.length > 0) {
      const id = bfs.shift()!;
      for (const kid of structKids.get(id) ?? []) {
        if (!nodeRank.has(kid)) {
          nodeRank.set(kid, nodeRank.get(id)! + 1);
          bfs.push(kid);
        }
      }
    }

    // Effective width per node: node width + tool stack overhang
    function nodeEffectiveWidth(nodeId: string): number {
      const node = nodeById.get(nodeId)!;
      const dims = nodeDims(node);
      let w = dims.width;
      const tools = leafToolsByParent.get(nodeId);
      if (tools && tools.length > 0) {
        let maxToolW = 0;
        for (const tid of tools) {
          const tn = nodeById.get(tid);
          if (tn) maxToolW = Math.max(maxToolW, nodeDims(tn).width);
        }
        const toolW = maxToolW || NODE_DEFAULTS.toolCall.width;
        if (nodeId === expandedParentId) {
          const numCols = Math.ceil(tools.length / MAX_GRID_ROWS);
          w += TOOL_GAP_X + numCols * (toolW + GRID_GAP_X);
        } else {
          w += TOOL_GAP_X + toolW;
        }
      }
      return w;
    }

    // Max effective width per rank → rank x-starts
    const rankMaxW = new Map<number, number>();
    let maxRank = 0;
    for (const [id, r] of nodeRank) {
      maxRank = Math.max(maxRank, r);
      rankMaxW.set(r, Math.max(rankMaxW.get(r) ?? 0, nodeEffectiveWidth(id)));
    }
    const rankX = new Map<number, number>();
    rankX.set(0, 0);
    for (let r = 1; r <= maxRank; r++) {
      rankX.set(r, rankX.get(r - 1)! + (rankMaxW.get(r - 1) ?? 0) + GAP_X);
    }

    // Subtree heights (bottom-up)
    const subH = new Map<string, number>();
    function computeSubH(nodeId: string): number {
      if (subH.has(nodeId)) return subH.get(nodeId)!;
      const node = nodeById.get(nodeId)!;
      let selfH = nodeDims(node).height;
      const tools = leafToolsByParent.get(nodeId);
      if (tools && tools.length > 0) {
        selfH = Math.max(selfH, computeToolStackHeight(nodeId, tools));
      }
      const kids = structKids.get(nodeId) ?? [];
      if (kids.length === 0) {
        subH.set(nodeId, selfH);
        return selfH;
      }
      let childrenH = 0;
      for (const kid of kids) childrenH += computeSubH(kid);
      childrenH += (kids.length - 1) * GAP_Y;
      const h = Math.max(selfH, childrenH);
      subH.set(nodeId, h);
      return h;
    }
    computeSubH(root.id);

    // Assign positions: children first, then parent at midpoint of
    // first/last child center — straight lines for single children,
    // balanced fan-out for multiple children.
    function assignPos(nodeId: string, yTop: number) {
      const node = nodeById.get(nodeId)!;
      const dims = nodeDims(node);
      const r = nodeRank.get(nodeId)!;
      const x = MARGIN + (rankX.get(r) ?? 0);
      const totalH = subH.get(nodeId) ?? dims.height;

      const kids = structKids.get(nodeId) ?? [];

      if (kids.length === 0) {
        // Leaf: center in subtree slot
        positions.set(nodeId, {
          x,
          y: yTop + totalH / 2 - dims.height / 2,
        });
        return;
      }

      // Position children first
      let childrenH = 0;
      for (const kid of kids) childrenH += subH.get(kid) ?? 0;
      childrenH += (kids.length - 1) * GAP_Y;

      let childY = yTop + totalH / 2 - childrenH / 2;
      for (const kid of kids) {
        assignPos(kid, childY);
        childY += (subH.get(kid) ?? 0) + GAP_Y;
      }

      // Place parent at midpoint of first and last child's vertical center
      const fc = positions.get(kids[0])!.y + nodeDims(nodeById.get(kids[0])!).height / 2;
      const lc =
        positions.get(kids[kids.length - 1])!.y +
        nodeDims(nodeById.get(kids[kids.length - 1])!).height / 2;
      const mid = (fc + lc) / 2;

      // Clamp so node + tool stack stay within subtree slot
      let selfH = dims.height;
      const tools = leafToolsByParent.get(nodeId);
      if (tools && tools.length > 0) {
        selfH = Math.max(selfH, computeToolStackHeight(nodeId, tools));
      }
      const minY = yTop + selfH / 2 - dims.height / 2;
      const maxY = yTop + totalH - selfH / 2 - dims.height / 2;

      positions.set(nodeId, {
        x,
        y: Math.max(minY, Math.min(maxY, mid - dims.height / 2)),
      });
    }
    assignPos(root.id, globalOffsetY);

    // ── Post-pass: position leaf tools for parents in this subtree ──
    for (const nodeId of subtreeIds) {
      const tools = leafToolsByParent.get(nodeId);
      if (!tools) continue;

      const parentPos = positions.get(nodeId);
      const parentNode = nodeById.get(nodeId);
      if (!parentPos || !parentNode) continue;

      const parentDims = nodeDims(parentNode);
      const toolX = parentPos.x + parentDims.width + TOOL_GAP_X;

      // Get representative tool dimensions
      let maxToolH = 0;
      let maxToolW = 0;
      for (const tid of tools) {
        const tn = nodeById.get(tid);
        if (tn) {
          const d = nodeDims(tn);
          maxToolH = Math.max(maxToolH, d.height);
          maxToolW = Math.max(maxToolW, d.width);
        }
      }
      const toolH = maxToolH || NODE_DEFAULTS.toolCall.height;
      const toolW = maxToolW || NODE_DEFAULTS.toolCall.width;

      if (nodeId === expandedParentId) {
        // ── Grid layout (expanded) ──
        const colWidth = toolW + GRID_GAP_X;
        const cascadeY = toolH / 2;
        for (let i = 0; i < tools.length; i++) {
          const col = Math.floor(i / MAX_GRID_ROWS);
          const row = i % MAX_GRID_ROWS;
          positions.set(tools[i], {
            x: toolX + col * colWidth,
            y: parentPos.y + row * (toolH + GRID_GAP_Y) + col * cascadeY,
          });
        }
      } else {
        // ── Stacked layout (collapsed, 25% overlap) ──
        const offset = toolH * STACK_OVERLAP_FRACTION;
        const stackTotalH = toolH + (tools.length - 1) * offset;
        const parentCenterY = parentPos.y + parentDims.height / 2;
        const stackStartY = parentCenterY - stackTotalH / 2;

        for (let i = 0; i < tools.length; i++) {
          const col = Math.floor(i / MAX_STACK_PER_COL);
          const row = i % MAX_STACK_PER_COL;
          positions.set(tools[i], {
            x: toolX + col * (toolW + GRID_GAP_X),
            y: stackStartY + row * offset + col * (toolH / 2),
          });
          zIndexMap.set(tools[i], i + 1);
        }
      }
    }

    // Advance globalOffsetY past this subtree (including tools)
    let subtreeBottom = globalOffsetY;
    for (const nodeId of subtreeIds) {
      const pos = positions.get(nodeId);
      const node = nodeById.get(nodeId);
      if (pos && node) {
        subtreeBottom = Math.max(subtreeBottom, pos.y + nodeDims(node).height);
      }
    }
    globalOffsetY = subtreeBottom + ROOT_GAP;
  }

  // ── Step 5: Handle orphan nodes ─────────────────────────────
  for (const node of graphNodes) {
    if (!positions.has(node.id)) {
      positions.set(node.id, { x: MARGIN, y: globalOffsetY });
      globalOffsetY += nodeDims(node).height + GAP_Y;
    }
  }

  return { positions, zIndexMap };
}

// ── List layout (indented outline) ──────────────────────────

// ── Hook ─────────────────────────────────────────────────────

export function useAutoLayout(
  nodes: Node[],
  edges: Edge[],
  expandedParentId: string | null = null,
): Node[] {
  // Memoize fingerprint to skip O(nodes×id_len) hash on non-structural renders
  // (e.g., selection changes, search input). The inner useMemo on `key` still
  // correctly gates computeGraphLayout via the string comparison.
  const key = useMemo(() => {
    let idHash = 0;
    let dimHash = 0;
    for (const n of nodes) {
      for (let i = 0; i < n.id.length; i++) {
        idHash = ((idHash << 5) - idHash + n.id.charCodeAt(i)) | 0;
      }
      if (n.measured?.width) {
        dimHash = ((dimHash << 5) - dimHash + (n.measured.width | 0)) | 0;
        dimHash = ((dimHash << 5) - dimHash + ((n.measured.height ?? 0) | 0)) | 0;
      }
    }
    // Note: expandedParentId intentionally excluded from layout key.
    // Tool expansion is handled by toolGroup component sizing, not full re-layout.
    // Including it caused O(n) dagre recomputation on every node click.
    return `${nodes.length}:${edges.length}:${idHash}:${dimHash}`;
  }, [nodes, edges]);

  const { positions, zIndexMap } = useMemo(() => {
    const graphNodes = nodes.filter((n) => n.id !== '__spawn__');
    const spawnNode = nodes.find((n) => n.id === '__spawn__');

    if (graphNodes.length === 0) {
      return {
        positions: new Map<string, { x: number; y: number }>(),
        zIndexMap: new Map<string, number>(),
      };
    }

    const result = computeGraphLayout(graphNodes, edges, expandedParentId);
    const positions = result.positions;
    const zIndexMap = result.zIndexMap;

    // Position spawn node at bottom-right of graph
    if (spawnNode) {
      let maxX = 0;
      let maxY = 0;
      for (const [id, pos] of positions) {
        const node = graphNodes.find((n) => n.id === id);
        const w = node ? nodeDims(node).width : 200;
        maxX = Math.max(maxX, pos.x + w);
        maxY = Math.max(maxY, pos.y);
      }
      positions.set('__spawn__', { x: maxX + 60, y: maxY / 2 });
    }

    return { positions, zIndexMap };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- key encodes all layout inputs
  }, [key]);

  return useMemo(
    () =>
      nodes.map((node) => {
        const pos = positions.get(node.id);
        if (!pos) {
          // Safety: if layout didn't assign a position but node is stuck offscreen,
          // reveal it at (0,0) rather than leaving it invisible at (-9999,-9999)
          if (node.position.x === -9999 && node.position.y === -9999) {
            return {
              ...node,
              position: { x: 0, y: 0 },
              style: { ...node.style, visibility: 'visible' as const },
              zIndex: 1,
            };
          }
          return node;
        }
        const zIndex = zIndexMap.get(node.id) ?? 1;
        // Reveal nodes that were created hidden (visibility:'hidden' in eventHandlers)
        const style =
          node.style?.visibility === 'hidden'
            ? { ...node.style, visibility: 'visible' as const }
            : node.style;
        return { ...node, position: pos, zIndex, style };
      }),
    [nodes, positions, zIndexMap],
  );
}
