// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Bernhard

import { useMemo } from 'react';
import type { Node, Edge } from '@xyflow/react';
// Custom tree layout — vertical spine + horizontal shelves (TB)

// ── Fallback dimensions (used before DOM measurement) ────────

const NODE_DEFAULTS: Record<string, { width: number; height: number }> = {
  session: { width: 220, height: 65 },
  userPrompt: { width: 260, height: 150 }, // fixed width (matches w-[260px] in UserPromptNode)
  agent: { width: 200, height: 100 }, // accounts for tokens + tool count badge
  toolCall: { width: 150, height: 28 },
  toolGroup: { width: 280, height: 120 }, // composite tool group (pill grid default)
  assistantResponse: { width: 200, height: 80 }, // response node between prompt and tools
  spawnAgent: { width: 50, height: 50 },
};

// ── Spacing constants ────────────────────────────────────────

const RANK_GAP = 50; // vertical gap between depth ranks (was GAP_X)
const SIBLING_GAP = 32; // horizontal gap between sibling spine nodes (was GAP_Y)
const SHELF_GAP = 75; // horizontal gap between all shelf nodes (prompt→response, response→agent, agent→toolgroup)
const ROOT_GAP = 150; // horizontal gap between root session trees
const MARGIN = 20; // canvas margin
const TOOL_GAP_X = 56; // horizontal gap between parent and tool stack

// ── Tool layout constants ────────────────────────────────────

const STACK_OVERLAP_FRACTION = 0.75; // offset = 75% of tool height (25% overlap)
const MAX_STACK_PER_COL = 10; // max tools per stacking column before cascading
const MAX_GRID_ROWS = 10; // max tools per column before adding another column
const GRID_GAP_X = 20; // horizontal gap between grid columns
const GRID_GAP_Y = 6; // vertical gap between grid rows

// ── Node classification ──────────────────────────────────────

// Spine nodes stack vertically (session → prompt chains)
function isSpineNode(type: string): boolean {
  return type === 'session' || type === 'userPrompt';
}

// Shelf nodes fan out horizontally from their parent prompt
function isShelfNode(type: string): boolean {
  return !isSpineNode(type);
}

// ── Helpers ──────────────────────────────────────────────────

function nodeDims(node: Node): { width: number; height: number } {
  const m = node.measured;
  // Force even heights so h/2 is always a whole number → pixel-perfect handle centering
  if (m?.width && m?.height) {
    return { width: m.width, height: m.height % 2 === 0 ? m.height : m.height + 1 };
  }
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
  const response = d.response as { timestamp?: number } | undefined;
  if (response?.timestamp) return response.timestamp;
  return 0;
}

// ── TB hybrid layout (vertical spine + horizontal shelves) ───
// Spine nodes (session, userPrompt) stack vertically.
// Shelf nodes (response, agent, toolGroup, toolCall) fan out
// horizontally from their parent prompt at the same Y level.

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

  // ── Step 0b: Sort children chronologically (oldest first) ──
  function nodeTimestamp(id: string): number {
    const n = nodeById.get(id);
    return n ? nodeTimestampFromNode(n) : 0;
  }

  for (const [, kids] of childrenOf) {
    kids.sort((a, b) => nodeTimestamp(a) - nodeTimestamp(b));
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
        // Orphan tool with no parent — treat as structural
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

  // ── Step 2: Compute tool stack heights for rank inflation ──
  function computeToolStackHeight(pid: string, tools: string[]): number {
    let maxToolH = 0;
    for (const tid of tools) {
      const tn = nodeById.get(tid);
      if (tn) maxToolH = Math.max(maxToolH, nodeDims(tn).height);
    }
    const toolH = maxToolH || NODE_DEFAULTS.toolCall.height;

    if (pid === expandedParentId) {
      const maxRows = Math.min(tools.length, MAX_GRID_ROWS);
      const numCols = Math.ceil(tools.length / MAX_GRID_ROWS);
      const cascadeY = toolH / 2;
      return maxRows * (toolH + GRID_GAP_Y) - GRID_GAP_Y + (numCols - 1) * cascadeY;
    }
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

  // ── Step 4: TB layout per root tree ─────────────────────────
  const positions = new Map<string, { x: number; y: number }>();
  const zIndexMap = new Map<string, number>();
  let globalOffsetX = MARGIN;

  for (const root of roots) {
    const subtreeIds = collectSubtree(root.id);

    // ── Step 4a: Build spine-only children map ──────────────
    // Spine = session + userPrompt; shelf nodes are excluded from the tree.
    // Key transformation: when a node has multiple prompt children (e.g. session
    // with all prompts as direct children), chain them vertically instead of
    // treating them as siblings. This creates the spine: session → prompt₁ → prompt₂ → ...
    const spineKids = new Map<string, string[]>();

    // First pass: collect raw spine children per node
    const rawSpineKids = new Map<string, string[]>();
    for (const id of subtreeIds) {
      if (!structuralNodeIds.has(id)) continue;
      const node = nodeById.get(id)!;
      if (!isSpineNode(node.type ?? '')) continue;
      const kids = (childrenOf.get(id) ?? []).filter((k) => {
        const kn = nodeById.get(k);
        return kn && isSpineNode(kn.type ?? '') && subtreeIds.has(k);
      });
      rawSpineKids.set(id, kids);
    }

    // Second pass: chain multiple prompt siblings into vertical sequences
    const chained = new Set<string>(); // nodes already placed in a chain
    for (const [id, kids] of rawSpineKids) {
      if (chained.has(id)) continue; // already placed by a parent's chain
      if (kids.length > 1) {
        // Chain: this node → first kid, first kid → second kid, ...
        spineKids.set(id, [kids[0]]);
        for (let i = 0; i < kids.length - 1; i++) {
          spineKids.set(kids[i], [kids[i + 1]]);
          chained.add(kids[i]);
        }
        // Last kid: use its own raw children (if any), otherwise empty
        const lastKid = kids[kids.length - 1];
        chained.add(lastKid);
        spineKids.set(lastKid, rawSpineKids.get(lastKid) ?? []);
      } else {
        spineKids.set(id, kids);
      }
    }

    // ── Step 4b: Rank computation (BFS on spine only) ───────
    const nodeRank = new Map<string, number>();
    nodeRank.set(root.id, 0);
    const bfs: string[] = [root.id];
    while (bfs.length > 0) {
      const id = bfs.shift()!;
      for (const kid of spineKids.get(id) ?? []) {
        if (!nodeRank.has(kid)) {
          nodeRank.set(kid, nodeRank.get(id)! + 1);
          bfs.push(kid);
        }
      }
    }

    // ── Step 4c: Rank sizing (Y-spacing) ────────────────────
    // rankMaxH = tallest element at each rank (including stacked shelf rows)
    const rankMaxH = new Map<number, number>();
    let maxRank = 0;
    for (const [id, r] of nodeRank) {
      maxRank = Math.max(maxRank, r);
      // Use shelfTotalHeight which accounts for all stacked shelf rows
      rankMaxH.set(r, Math.max(rankMaxH.get(r) ?? 0, shelfTotalHeight(id)));
    }

    let cumY = MARGIN;
    const rankY = new Map<number, number>();
    for (let r = 0; r <= maxRank; r++) {
      rankY.set(r, cumY);
      cumY += (rankMaxH.get(r) ?? 0) + RANK_GAP;
    }

    // ── Step 4d: Effective width per node ───────────────────
    // nodeEffectiveWidth includes tool stack overhang (horizontal)
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
          w += TOOL_GAP_X + numCols * toolW + (numCols - 1) * GRID_GAP_X;
        } else {
          w += TOOL_GAP_X + toolW;
        }
      }
      return w;
    }

    // ── Step 4e: Shelf helpers ─────────────────────────────
    // Get direct shelf children of any node
    function getShelfChildren(parentId: string): string[] {
      return (childrenOf.get(parentId) ?? []).filter((k) => {
        const kn = nodeById.get(k);
        return kn && isShelfNode(kn.type ?? '') && structuralNodeIds.has(k) && subtreeIds.has(k);
      });
    }

    // Width of a single shelf chain starting from a node (rightward)
    function shelfChainWidth(nodeId: string): number {
      const w = nodeEffectiveWidth(nodeId);
      const kids = getShelfChildren(nodeId);
      if (kids.length === 0) return w;
      // Multiple children → take the widest chain (they stack vertically)
      let maxKidChainW = 0;
      for (const kid of kids) {
        maxKidChainW = Math.max(maxKidChainW, shelfChainWidth(kid));
      }
      return w + SHELF_GAP + maxKidChainW;
    }

    // Height of a shelf row starting from a node (accounts for stacked children)
    function shelfChainHeight(nodeId: string): number {
      const selfH = nodeDims(nodeById.get(nodeId)!).height;
      const tools = leafToolsByParent.get(nodeId);
      let h = tools ? Math.max(selfH, computeToolStackHeight(nodeId, tools)) : selfH;
      const kids = getShelfChildren(nodeId);
      if (kids.length <= 1) {
        // Single child chain → row height = max of self and child chain
        if (kids.length === 1) h = Math.max(h, shelfChainHeight(kids[0]));
        return h;
      }
      // Multiple children → they stack vertically, sum their heights
      let totalKidH = 0;
      for (const kid of kids) totalKidH += shelfChainHeight(kid);
      totalKidH += (kids.length - 1) * SHELF_GAP;
      return Math.max(h, totalKidH);
    }

    // Total shelf height for a spine node (all rows stacked)
    function shelfTotalHeight(spineId: string): number {
      const selfH = nodeDims(nodeById.get(spineId)!).height;
      const shelfKids = getShelfChildren(spineId);
      if (shelfKids.length === 0) return selfH;
      let totalH = 0;
      for (const kid of shelfKids) totalH += shelfChainHeight(kid);
      totalH += (shelfKids.length - 1) * SHELF_GAP;
      return Math.max(selfH, totalH);
    }

    // Shelf width: prompt width + gap + widest chain
    function shelfWidth(spineId: string): number {
      const node = nodeById.get(spineId)!;
      const ownW = nodeDims(node).width;
      const shelfKids = getShelfChildren(spineId);
      if (shelfKids.length === 0) return ownW;
      let maxChainW = 0;
      for (const kid of shelfKids) {
        maxChainW = Math.max(maxChainW, shelfChainWidth(kid));
      }
      return ownW + SHELF_GAP + maxChainW;
    }

    // ── Step 4f: Subtree width (horizontal sibling spread) ──
    const subW = new Map<string, number>();
    function computeSubW(nodeId: string): number {
      if (subW.has(nodeId)) return subW.get(nodeId)!;
      const kids = spineKids.get(nodeId) ?? [];
      const selfW = shelfWidth(nodeId);
      if (kids.length === 0) {
        subW.set(nodeId, selfW);
        return selfW;
      }
      let childrenTotalW = 0;
      for (const kid of kids) childrenTotalW += computeSubW(kid);
      childrenTotalW += SIBLING_GAP * (kids.length - 1);
      const w = Math.max(selfW, childrenTotalW);
      subW.set(nodeId, w);
      return w;
    }
    computeSubW(root.id);

    // ── Step 4g: Position assignment (spine nodes) ──────────
    // Y from rank, X from horizontal band centering
    function assignPos(nodeId: string, xStart: number) {
      const node = nodeById.get(nodeId)!;
      const dims = nodeDims(node);
      const rank = nodeRank.get(nodeId)!;
      const nodeY = rankY.get(rank)!;
      const kids = spineKids.get(nodeId) ?? [];
      const totalW = computeSubW(nodeId);

      if (kids.length === 0) {
        // Leaf spine node: center in allocated horizontal band
        const selfW = shelfWidth(nodeId);
        positions.set(nodeId, {
          x: xStart + (totalW - selfW) / 2,
          y: nodeY,
        });
        return;
      }

      // Position spine children left-to-right
      let childX = xStart;
      for (const kid of kids) {
        const kidSubW = computeSubW(kid);
        assignPos(kid, childX);
        childX += kidSubW + SIBLING_GAP;
      }

      // Center-align parent with first child for straight vertical spine edges.
      // The bottom handle (center of parent) must be directly above the top handle (center of child).
      const firstChild = kids[0];
      const firstChildX = positions.get(firstChild)!.x;
      const firstChildW = nodeDims(nodeById.get(firstChild)!).width;
      const childCenterX = firstChildX + firstChildW / 2;
      positions.set(nodeId, { x: childCenterX - dims.width / 2, y: nodeY });
    }
    assignPos(root.id, globalOffsetX);

    // ── Step 4h: Shelf positioning post-pass ────────────────
    // Each spine node's shelf children stack vertically as rows.
    // Within each row, child chains extend rightward.

    // Recursive: position a shelf node and its shelf children rightward.
    // parentMidY = the vertical center of the parent node's handle (for straight edges).
    function layoutShelfChain(nodeId: string, x: number, parentHandleY: number) {
      const node = nodeById.get(nodeId)!;
      const h = nodeDims(node).height;
      // Align this node's handle center with the parent's handle center.
      // No rounding — both parent and child must share the exact same fractional
      // center Y so React Flow draws a perfectly straight horizontal edge.
      const y = parentHandleY - h / 2;
      positions.set(nodeId, { x, y });
      // This node's handle center (for positioning its children)
      const myHandleY = parentHandleY; // exact same value, no drift

      const kids = getShelfChildren(nodeId);
      if (kids.length === 0) return;

      const nextX = x + nodeEffectiveWidth(nodeId) + SHELF_GAP;

      if (kids.length === 1) {
        // Single child: continue rightward, aligned to this node's actual handle center
        layoutShelfChain(kids[0], nextX, myHandleY);
      } else {
        // Multiple children: stack them vertically at the next X position
        let totalKidH = 0;
        for (const kid of kids) totalKidH += shelfChainHeight(kid);
        totalKidH += (kids.length - 1) * SHELF_GAP;

        let kidY = myHandleY - totalKidH / 2;
        for (const kid of kids) {
          const kidRowH = shelfChainHeight(kid);
          layoutShelfChain(kid, nextX, kidY + kidRowH / 2);
          kidY += kidRowH + SHELF_GAP;
        }
      }
    }

    for (const [spineId] of nodeRank) {
      const spinePos = positions.get(spineId);
      if (!spinePos) continue;
      const spineNode = nodeById.get(spineId)!;
      const spineW = nodeDims(spineNode).width;
      const spineH = nodeDims(spineNode).height;

      const shelfKids = getShelfChildren(spineId);
      if (shelfKids.length === 0) continue;

      const shelfStartX = spinePos.x + spineW + SHELF_GAP;

      const spineMidY = spinePos.y + spineH / 2;

      // First shelf child aligns its center with the spine node's center.
      // Subsequent children stack below.
      let rowMidY = spineMidY;
      for (const kid of shelfKids) {
        const rowH = shelfChainHeight(kid);
        layoutShelfChain(kid, shelfStartX, rowMidY);
        rowMidY += rowH + SHELF_GAP;
      }
    }

    // ── Step 4i: Leaf tool post-pass ────────────────────────
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

    // Advance globalOffsetX past this subtree (including tools)
    let subtreeRight = globalOffsetX;
    for (const nodeId of subtreeIds) {
      const pos = positions.get(nodeId);
      const node = nodeById.get(nodeId);
      if (pos && node) {
        subtreeRight = Math.max(subtreeRight, pos.x + nodeDims(node).width);
      }
    }
    globalOffsetX = subtreeRight + ROOT_GAP;
  }

  // ── Step 5: Handle orphan nodes ─────────────────────────────
  for (const node of graphNodes) {
    if (!positions.has(node.id)) {
      positions.set(node.id, { x: globalOffsetX, y: MARGIN });
      globalOffsetX += nodeDims(node).width + SIBLING_GAP;
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
    return `${nodes.length}:${edges.length}:${idHash}:${dimHash}:${expandedParentId}`;
  }, [nodes, edges, expandedParentId]);

  const { positions, zIndexMap } = useMemo(() => {
    const graphNodes = nodes.filter((n) => n.id !== '__spawn__');
    const spawnNode = nodes.find((n) => n.id === '__spawn__');

    if (graphNodes.length === 0) {
      return {
        positions: new Map<string, { x: number; y: number }>(),
        zIndexMap: new Map<string, number>(),
      };
    }

    // Thread edges are visual-only (conversation flow between prompts).
    // Exclude them from layout so they don't create false parent-child relationships.
    const layoutEdges = edges.filter((e) => !e.id.startsWith('thread-'));
    const result = computeGraphLayout(graphNodes, layoutEdges, expandedParentId);
    const positions = result.positions;
    const zIndexMap = result.zIndexMap;

    // Position spawn node at bottom-center of graph
    if (spawnNode) {
      let minX = Infinity;
      let maxX = 0;
      let maxY = 0;
      for (const [id, pos] of positions) {
        const node = graphNodes.find((n) => n.id === id);
        const w = node ? nodeDims(node).width : 200;
        const h = node ? nodeDims(node).height : 100;
        minX = Math.min(minX, pos.x);
        maxX = Math.max(maxX, pos.x + w);
        maxY = Math.max(maxY, pos.y + h);
      }
      if (minX === Infinity) minX = MARGIN;
      positions.set('__spawn__', {
        x: (minX + maxX) / 2 - 25,
        y: maxY + RANK_GAP,
      });
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
