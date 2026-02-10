import { useEffect, useRef } from 'react';
import type { Node, Edge } from '@xyflow/react';

// ── Fallback dimensions (used before DOM measurement) ────────

const NODE_DEFAULTS: Record<string, { width: number; height: number }> = {
  session: { width: 220, height: 80 },
  userPrompt: { width: 240, height: 130 },
  agent: { width: 200, height: 110 },
  toolCall: { width: 150, height: 32 },
  spawnAgent: { width: 50, height: 50 },
};

// ── Spacing constants ────────────────────────────────────────

const GAP_X = 50; // horizontal gap between parent right edge and child left edge
const GAP_Y = 14; // vertical gap between sibling nodes
const GAP_Y_TOOL = 6; // tighter gap between tool call nodes
const ROOT_GAP = 40; // extra vertical gap between independent root trees
const MARGIN = 30; // canvas margin

// ── Tool layout constants ────────────────────────────────────

const STACK_OFFSET_Y = 14; // vertical offset between stacked cards
const MAX_STACKED_PREVIEW = 5; // max visible tools in stacked mode (must match AgentGraph.tsx)
const MAX_GRID_ROWS = 10; // max tools per column before adding another column
const GRID_GAP_X = 20; // horizontal gap between grid columns
const GRID_GAP_Y = 6; // vertical gap between grid rows

// ── Helpers ──────────────────────────────────────────────────

function nodeDims(node: Node): { width: number; height: number } {
  const m = node.measured;
  if (m?.width && m?.height) return { width: m.width, height: m.height };
  return NODE_DEFAULTS[node.type ?? ''] ?? { width: 180, height: 80 };
}

// ── Custom tree layout (LR) ─────────────────────────────────
// Purpose-built for agent hierarchies with hybrid tool layouts:
// - Non-tool children: standard vertical stacking with centering
// - Leaf tools (stacked): overlapping cards for compact preview
// - Leaf tools (expanded): 2-column grid for scannable access

function computeGraphLayout(
  graphNodes: Node[],
  edges: Edge[],
  expandedParentId: string | null,
): { positions: Map<string, { x: number; y: number }>; zIndexMap: Map<string, number> } {
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

  // Classify children: leaf tools vs everything else
  function classifyChildren(parentId: string): { tools: string[]; others: string[] } {
    const kids = childrenOf.get(parentId) ?? [];
    const tools: string[] = [];
    const others: string[] = [];
    for (const kid of kids) {
      const node = nodeById.get(kid);
      const kidChildren = childrenOf.get(kid);
      // Leaf tool = toolCall node with no children of its own
      if (node?.type === 'toolCall' && (!kidChildren || kidChildren.length === 0)) {
        tools.push(kid);
      } else {
        others.push(kid);
      }
    }
    return { tools, others };
  }

  // Height of tool children based on layout mode
  function toolsHeight(tools: string[], parentId: string): number {
    if (tools.length === 0) return 0;
    const toolH = NODE_DEFAULTS.toolCall.height;

    if (parentId === expandedParentId) {
      // Grid: max MAX_GRID_ROWS per column, each new column cascades lower
      const rows = Math.min(tools.length, MAX_GRID_ROWS);
      const cols = Math.ceil(tools.length / MAX_GRID_ROWS);
      const cascade = (cols - 1) * (toolH / 2); // cumulative offset of last column
      return rows * toolH + (rows - 1) * GRID_GAP_Y + cascade;
    } else {
      // Stacked: overlapping cards
      const visible = Math.min(tools.length, MAX_STACKED_PREVIEW);
      return (visible - 1) * STACK_OFFSET_Y + toolH;
    }
  }

  // Gap before a non-tool sibling
  function gapBefore(nodeId: string): number {
    return nodeById.get(nodeId)?.type === 'toolCall' ? GAP_Y_TOOL : GAP_Y;
  }

  // Height of non-tool children including inter-sibling gaps
  function othersHeight(others: string[]): number {
    if (others.length === 0) return 0;
    let total = subtreeHeight(others[0]);
    for (let i = 1; i < others.length; i++) {
      total += gapBefore(others[i]) + subtreeHeight(others[i]);
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
    const { tools, others } = classifyChildren(nodeId);

    if (tools.length === 0 && others.length === 0) {
      stCache.set(nodeId, myH);
      return myH;
    }

    const oH = othersHeight(others);
    const tH = toolsHeight(tools, nodeId);

    // Combined children height
    let totalChildrenH = oH;
    if (tH > 0) {
      totalChildrenH = oH > 0 ? oH + GAP_Y + tH : tH;
    }

    const h = Math.max(myH, totalChildrenH);
    stCache.set(nodeId, h);
    return h;
  }

  // Phase 2: top-down — assign positions
  const positions = new Map<string, { x: number; y: number }>();
  const zIndexMap = new Map<string, number>();

  function layout(nodeId: string, x: number, yStart: number): void {
    const node = nodeById.get(nodeId);
    if (!node) return;

    const dims = nodeDims(node);
    const stH = subtreeHeight(nodeId);
    const { tools, others } = classifyChildren(nodeId);

    // Center this node vertically within its subtree band
    const myY = yStart + (stH - dims.height) / 2;
    positions.set(nodeId, { x, y: myY });

    if (tools.length === 0 && others.length === 0) return;

    // Compute combined children height for centering
    const oH = othersHeight(others);
    const tH = toolsHeight(tools, nodeId);
    let totalChildrenH = oH;
    if (tH > 0) {
      totalChildrenH = oH > 0 ? oH + GAP_Y + tH : tH;
    }

    const childX = x + dims.width + GAP_X;
    let childY = yStart + (stH - totalChildrenH) / 2;

    // Position non-tool children normally
    for (let i = 0; i < others.length; i++) {
      if (i > 0) childY += gapBefore(others[i]);
      layout(others[i], childX, childY);
      childY += subtreeHeight(others[i]);
    }

    // Gap between others and tools
    if (others.length > 0 && tools.length > 0) {
      childY += GAP_Y;
    }

    // Position tools (stacked or grid)
    if (tools.length > 0) {
      const isExpanded = nodeId === expandedParentId;
      const toolStartY = childY;

      if (isExpanded) {
        // Dynamic columns — max MAX_GRID_ROWS per column, each column cascades lower
        const toolW = NODE_DEFAULTS.toolCall.width;
        const colWidth = toolW + GRID_GAP_X;
        const toolH = NODE_DEFAULTS.toolCall.height;
        const cascadeY = toolH / 2; // each column shifts down progressively

        for (let i = 0; i < tools.length; i++) {
          const col = Math.floor(i / MAX_GRID_ROWS);
          const row = i % MAX_GRID_ROWS;
          positions.set(tools[i], {
            x: childX + col * colWidth,
            y: toolStartY + row * (toolH + GRID_GAP_Y) + col * cascadeY,
          });
        }
      } else {
        // Stacked card layout (overlapping)
        for (let i = 0; i < tools.length; i++) {
          positions.set(tools[i], {
            x: childX,
            y: toolStartY + i * STACK_OFFSET_Y,
          });
          // z-index: later cards on top
          zIndexMap.set(tools[i], i + 1);
        }
      }
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

  return { positions, zIndexMap };
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
  expandedParentId: string | null = null,
): Node[] {
  const positionsRef = useRef<Map<string, { x: number; y: number }>>(new Map());
  const zIndexRef = useRef<Map<string, number>>(new Map());
  const prevKeyRef = useRef('');

  // Fingerprint: recompute when structure or measurements change
  let idHash = 0;
  for (const n of nodes) {
    for (let i = 0; i < n.id.length; i++) {
      idHash = ((idHash << 5) - idHash + n.id.charCodeAt(i)) | 0;
    }
  }
  const hasMeasured = nodes.some((n) => n.measured?.width);
  const key = `${layoutMode}:${nodes.length}:${edges.length}:${idHash}:${hasMeasured}:${expandedParentId}`;
  const needsLayout = key !== prevKeyRef.current;

  useEffect(() => {
    prevKeyRef.current = key;
  }, [key]);

  if (!needsLayout && positionsRef.current.size > 0) {
    return nodes.map((node) => {
      const pos = positionsRef.current.get(node.id);
      if (!pos) return node;
      const zIndex = zIndexRef.current.get(node.id) ?? 1;
      return { ...node, position: pos, zIndex };
    });
  }

  // Separate spawn node — positioned after layout
  const graphNodes = nodes.filter((n) => n.id !== '__spawn__');
  const spawnNode = nodes.find((n) => n.id === '__spawn__');

  if (graphNodes.length === 0) return nodes;

  let positions: Map<string, { x: number; y: number }>;
  let zIndexMap = new Map<string, number>();

  if (layoutMode === 'list') {
    positions = computeListLayout(graphNodes, edges);
  } else {
    const result = computeGraphLayout(graphNodes, edges, expandedParentId);
    positions = result.positions;
    zIndexMap = result.zIndexMap;
  }

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
  zIndexRef.current = zIndexMap;

  return nodes.map((node) => {
    const pos = positions.get(node.id);
    if (!pos) return node;
    const zIndex = zIndexMap.get(node.id) ?? 1; // all nodes above edges (z:0)
    return { ...node, position: pos, zIndex };
  });
}
