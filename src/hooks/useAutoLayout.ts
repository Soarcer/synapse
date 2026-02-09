import { useEffect, useRef } from 'react';
import type { Node, Edge } from '@xyflow/react';

// ── Fallback dimensions (used before DOM measurement) ────────

const NODE_DEFAULTS: Record<string, { width: number; height: number }> = {
  session: { width: 220, height: 80 },
  userPrompt: { width: 240, height: 130 },
  agent: { width: 200, height: 110 },
  toolCall: { width: 150, height: 44 },
  spawnAgent: { width: 50, height: 50 },
};

// ── Spacing constants ────────────────────────────────────────
// Tuned for readability: gap ≈ 0.25× node width horizontally,
// tight siblings vertically so parent-child grouping is clear.

const GAP_X = 50; // horizontal gap between parent right edge and child left edge
const GAP_Y = 14; // vertical gap between sibling nodes
const GAP_Y_TOOL = 10; // tighter gap between tool call nodes
const ROOT_GAP = 40; // extra vertical gap between independent root trees
const MARGIN = 30; // canvas margin

// ── Helpers ──────────────────────────────────────────────────

function nodeDims(node: Node): { width: number; height: number } {
  const m = node.measured;
  if (m?.width && m?.height) return { width: m.width, height: m.height };
  return NODE_DEFAULTS[node.type ?? ''] ?? { width: 180, height: 80 };
}

// ── Custom tree layout (LR) ─────────────────────────────────
// Purpose-built for agent hierarchies. Each parent is vertically
// centered relative to its children. No rank detection, no edge
// routing inflation, no compaction passes — positions are exact.

function computeGraphLayout(
  graphNodes: Node[],
  edges: Edge[],
): Map<string, { x: number; y: number }> {
  // Build tree structure
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

  const roots = graphNodes.filter((n) => !parentOf.has(n.id));

  // Gap before a sibling — tighter for tool nodes
  function gapBefore(nodeId: string): number {
    return nodeById.get(nodeId)?.type === 'toolCall' ? GAP_Y_TOOL : GAP_Y;
  }

  // Total height of a list of children including inter-sibling gaps
  function childrenHeight(kids: string[]): number {
    if (kids.length === 0) return 0;
    let total = subtreeHeight(kids[0]);
    for (let i = 1; i < kids.length; i++) {
      total += gapBefore(kids[i]) + subtreeHeight(kids[i]);
    }
    return total;
  }

  // Phase 1: bottom-up — compute subtree heights
  const stCache = new Map<string, number>();

  function subtreeHeight(nodeId: string): number {
    const cached = stCache.get(nodeId);
    if (cached !== undefined) return cached;

    const node = nodeById.get(nodeId);
    if (!node) return 0;

    const myH = nodeDims(node).height;
    const kids = childrenOf.get(nodeId);

    if (!kids || kids.length === 0) {
      stCache.set(nodeId, myH);
      return myH;
    }

    const h = Math.max(myH, childrenHeight(kids));
    stCache.set(nodeId, h);
    return h;
  }

  // Phase 2: top-down — assign positions
  // Each node is vertically centered within its subtree allocation.
  // Children are placed to the right, stacked vertically and centered
  // as a group within the same allocation.
  const positions = new Map<string, { x: number; y: number }>();

  function layout(nodeId: string, x: number, yStart: number): void {
    const node = nodeById.get(nodeId);
    if (!node) return;

    const dims = nodeDims(node);
    const stH = subtreeHeight(nodeId);
    const kids = childrenOf.get(nodeId) ?? [];

    // Center this node vertically within its subtree band
    const myY = yStart + (stH - dims.height) / 2;
    positions.set(nodeId, { x, y: myY });

    if (kids.length === 0) return;

    // Center children block within subtree band
    const kidsTotal = childrenHeight(kids);
    const childX = x + dims.width + GAP_X;
    let childY = yStart + (stH - kidsTotal) / 2;

    for (let i = 0; i < kids.length; i++) {
      if (i > 0) childY += gapBefore(kids[i]);
      layout(kids[i], childX, childY);
      childY += subtreeHeight(kids[i]);
    }
  }

  // Layout each root tree
  let y = MARGIN;
  for (const root of roots) {
    layout(root.id, MARGIN, y);
    y += subtreeHeight(root.id) + ROOT_GAP;
  }

  // Orphan nodes (no edges at all)
  for (const node of graphNodes) {
    if (!positions.has(node.id)) {
      positions.set(node.id, { x: MARGIN, y });
      y += nodeDims(node).height + GAP_Y;
    }
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

  const roots = graphNodes.filter((n) => !hasParent.has(n.id));

  const positions = new Map<string, { x: number; y: number }>();
  let y = 40;

  function dfs(nodeId: string, depth: number) {
    const node = nodeById.get(nodeId);
    if (!node) return;
    const dims = nodeDims(node);
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

  // Orphan nodes
  for (const node of graphNodes) {
    if (!positions.has(node.id)) {
      positions.set(node.id, { x: 40, y });
      y += nodeDims(node).height + LIST_ROW_GAP;
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

  // Fingerprint: recompute when structure or measurements change
  let idHash = 0;
  for (const n of nodes) {
    for (let i = 0; i < n.id.length; i++) {
      idHash = ((idHash << 5) - idHash + n.id.charCodeAt(i)) | 0;
    }
  }
  const hasMeasured = nodes.some((n) => n.measured?.width);
  const key = `${layoutMode}:${nodes.length}:${edges.length}:${idHash}:${hasMeasured}`;
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

  // Separate spawn node — positioned after layout
  const graphNodes = nodes.filter((n) => n.id !== '__spawn__');
  const spawnNode = nodes.find((n) => n.id === '__spawn__');

  if (graphNodes.length === 0) return nodes;

  const positions =
    layoutMode === 'list'
      ? computeListLayout(graphNodes, edges)
      : computeGraphLayout(graphNodes, edges);

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
