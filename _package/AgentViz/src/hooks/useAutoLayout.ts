import { useEffect, useRef } from 'react';
import dagre from 'dagre';
import type { Node, Edge } from '@xyflow/react';

const NODE_DEFAULTS: Record<string, { width: number; height: number }> = {
  session: { width: 220, height: 80 },
  userPrompt: { width: 240, height: 130 },
  agent: { width: 200, height: 110 },
  toolCall: { width: 150, height: 44 },
  spawnAgent: { width: 50, height: 50 },
};

// ── Graph layout (dagre LR) ─────────────────────────────────

function computeGraphLayout(
  graphNodes: Node[],
  edges: Edge[],
): Map<string, { x: number; y: number }> {
  const g = new dagre.graphlib.Graph();
  g.setDefaultEdgeLabel(() => ({}));
  g.setGraph({
    rankdir: 'LR',
    ranksep: 100,
    nodesep: 2,
    marginx: 40,
    marginy: 40,
    align: 'UL',
    ranker: 'tight-tree',
  });

  for (const node of graphNodes) {
    const dims = NODE_DEFAULTS[node.type ?? ''] ?? { width: 180, height: 80 };
    g.setNode(node.id, { width: dims.width, height: dims.height });
  }

  for (const edge of edges) {
    if (g.hasNode(edge.source) && g.hasNode(edge.target)) {
      g.setEdge(edge.source, edge.target);
    }
  }

  dagre.layout(g);

  const positions = new Map<string, { x: number; y: number }>();
  for (const node of graphNodes) {
    const dn = g.node(node.id);
    if (dn) {
      const dims = NODE_DEFAULTS[node.type ?? ''] ?? { width: 180, height: 80 };
      positions.set(node.id, {
        x: dn.x - dims.width / 2,
        y: dn.y - dims.height / 2,
      });
    }
  }

  // Compact vertical gaps while preserving dagre order
  const MIN_VERTICAL_GAP = 6;
  const sorted = graphNodes
    .map((n) => ({
      id: n.id,
      y: positions.get(n.id)?.y ?? 0,
      height: (NODE_DEFAULTS[n.type ?? ''] ?? { height: 80 }).height,
    }))
    .sort((a, b) => a.y - b.y);

  let cursor = sorted.length > 0 ? sorted[0].y : 0;
  for (let i = 0; i < sorted.length; i++) {
    const item = sorted[i];
    if (i === 0) {
      cursor = item.y;
    } else {
      cursor = Math.min(item.y, cursor + sorted[i - 1].height + MIN_VERTICAL_GAP);
    }
    const pos = positions.get(item.id);
    if (pos) positions.set(item.id, { ...pos, y: cursor });
  }

  return positions;
}

// ── List layout (indented outline) ──────────────────────────

const LIST_INDENT = 36;
const LIST_ROW_GAP = 8;

function computeListLayout(
  graphNodes: Node[],
  edges: Edge[],
): Map<string, { x: number; y: number }> {
  // Build adjacency: parent → children (preserving insertion order)
  const childrenOf = new Map<string, string[]>();
  const hasParent = new Set<string>();
  const nodeById = new Map<string, Node>();

  for (const n of graphNodes) nodeById.set(n.id, n);

  for (const edge of edges) {
    if (!nodeById.has(edge.source) || !nodeById.has(edge.target)) continue;
    const kids = childrenOf.get(edge.source) ?? [];
    kids.push(edge.target);
    childrenOf.set(edge.source, kids);
    hasParent.add(edge.target);
  }

  // Roots = nodes with no parent
  const roots = graphNodes.filter((n) => !hasParent.has(n.id));

  const positions = new Map<string, { x: number; y: number }>();
  let y = 40;

  function dfs(nodeId: string, depth: number) {
    const node = nodeById.get(nodeId);
    if (!node) return;
    const dims = NODE_DEFAULTS[node.type ?? ''] ?? { width: 180, height: 80 };
    positions.set(nodeId, { x: 40 + depth * LIST_INDENT, y });
    y += dims.height + LIST_ROW_GAP;

    const kids = childrenOf.get(nodeId) ?? [];
    for (const kid of kids) {
      dfs(kid, depth + 1);
    }
  }

  for (const root of roots) {
    dfs(root.id, 0);
  }

  // Any orphan nodes not in the tree
  for (const node of graphNodes) {
    if (!positions.has(node.id)) {
      const dims = NODE_DEFAULTS[node.type ?? ''] ?? { width: 180, height: 80 };
      positions.set(node.id, { x: 40, y });
      y += dims.height + LIST_ROW_GAP;
    }
  }

  return positions;
}

// ── Hook ─────────────────────────────────────────────────────

export function useAutoLayout(
  nodes: Node[],
  edges: Edge[],
  layoutMode: 'graph' | 'list' = 'graph',
): Node[] {
  const positionsRef = useRef<Map<string, { x: number; y: number }>>(new Map());
  const prevKeyRef = useRef('');

  // Recompute when node set or layout mode changes (fingerprint includes IDs)
  let idHash = 0;
  for (const n of nodes) {
    for (let i = 0; i < n.id.length; i++) {
      idHash = ((idHash << 5) - idHash + n.id.charCodeAt(i)) | 0;
    }
  }
  const key = `${layoutMode}:${nodes.length}:${edges.length}:${idHash}`;
  const needsLayout = key !== prevKeyRef.current;

  useEffect(() => {
    prevKeyRef.current = key;
  }, [key]);

  if (!needsLayout && positionsRef.current.size > 0) {
    return nodes.map((node) => {
      const pos = positionsRef.current.get(node.id);
      return pos ? { ...node, position: pos } : node;
    });
  }

  // Separate spawn node
  const graphNodes = nodes.filter((n) => n.id !== '__spawn__');
  const spawnNode = nodes.find((n) => n.id === '__spawn__');

  if (graphNodes.length === 0) return nodes;

  const positions =
    layoutMode === 'list'
      ? computeListLayout(graphNodes, edges)
      : computeGraphLayout(graphNodes, edges);

  // Position spawn node
  if (spawnNode) {
    let maxX = 0;
    let maxY = 0;
    for (const [, pos] of positions) {
      maxX = Math.max(maxX, pos.x + 200);
      maxY = Math.max(maxY, pos.y);
    }
    if (layoutMode === 'list') {
      positions.set('__spawn__', { x: 40, y: maxY + 40 });
    } else {
      positions.set('__spawn__', { x: maxX + 60, y: maxY / 2 });
    }
  }

  positionsRef.current = positions;

  return nodes.map((node) => {
    const pos = positions.get(node.id);
    return pos ? { ...node, position: pos } : node;
  });
}
