# Top-to-Bottom Layout Direction — Detailed Design

**Date:** 2026-03-27
**Status:** Design (revised after plan review)
**Branch:** `experiment/tb-layout`
**Depends on:** None (isolated refactor)
**Merge criteria:** Visual QA passes with 1-3 sessions of real data. Layout feels natural for comparing session depth at a glance. If not, keep on experiment branch. <!-- revised: P1-7 — define explicit merge criteria -->

---

## 1. Problem Statement

The current left-to-right (LR) layout makes it hard to:

- **Compare sessions** — they stack vertically, requiring scrolling to see which ran longer
- **Read chronology** — depth (time) runs horizontally, which conflicts with western reading order for timelines
- **Gauge conversation depth** — a long discussion looks wide, not tall, so you can't glance at the graph and see "that session went deep"
- **Use the compaction lens** — the sawtooth pattern maps to depth, which would be much more intuitive on the Y-axis

A top-to-bottom (TB) layout puts sessions in a horizontal row at the top (oldest left, newest right), with conversation depth flowing downward. Tall trees = long conversations. Short trees = quick jobs. You can compare at a glance.

## 2. Target Layout

<!-- revised: P0-3 — corrected layout model: only session→prompt is vertical, everything else fans right -->

The layout uses a **vertical spine with horizontal shelves** model:

- **Vertical axis = conversation depth** — session → prompt₁ → prompt₂ → prompt₃ (sequential turns)
- **Horizontal axis = turn breadth** — at each prompt: response, agent(s), tool groups fan out to the right

```
SESSION₁ (oldest)              SESSION₂                SESSION₃ (newest)
   │                              │                        │
PROMPT₁ ─── RESP               PROMPT₁ ─── RESP         PROMPT₁ ─── RESP
   │         ── AGENT──tools      │                        │         ── AGENT──tools
   │                              │                        │
PROMPT₂ ─── RESP               PROMPT₂ ─── RESP         PROMPT₂ ─── RESP
   │         ── AGENT──tools      │         ── AGENT                  ── AGENT──tools
   │                              │              ├──tools
PROMPT₃ ─── RESP               PROMPT₃ ─── RESP
                                  │
                                PROMPT₄ ─── RESP
```

### Key Spatial Rules

| Relationship           | Spatial mapping                                           |
| ---------------------- | --------------------------------------------------------- |
| Session → first prompt | Directly below (vertical spine)                           |
| Prompt → next prompt   | Directly below (vertical spine)                           |
| Prompt → response      | Right of prompt, same Y (horizontal shelf)                |
| Prompt → agent         | Right of prompt, same Y, past response (horizontal shelf) |
| Agent → tool group     | Right of agent, same Y (horizontal shelf continues)       |
| Multiple sessions      | Horizontal row at top, oldest-left → newest-right         |

### Why This Hybrid Model

This is **not** a simple X↔Y axis swap of the current LR layout. It's a purpose-built hybrid:

1. **The vertical spine** (session → prompt chain) shows **conversation depth**. This is the primary dimension users want to compare across sessions — "which session went deeper?"
2. **The horizontal shelves** (prompt → response/agent/tools) show **turn breadth**. Each prompt's children fan out rightward at the same Y-level, keeping each "turn" on a single row.

The result: you can scan the left edge of the graph to read the conversation flow, and scan rightward at any prompt to see what happened during that turn.

### Thread Edges in TB Mode

<!-- revised: P1-5 — thread edges become redundant when prompts already stack vertically -->

In LR layout, thread edges (dashed blue) connect vertically-stacked prompts to show conversation flow. In TB layout, prompts already stack vertically via the structural parent-child edges. Thread edges would visually duplicate the structural edges.

**Decision:** Hide thread edges in TB mode. The structural edge already communicates conversation flow. If a future LR/TB toggle is added, thread edges re-enable in LR mode.

This also eliminates the P0-1 handle collision problem — with no thread edges rendered, there's no need for `thread-in`/`thread-out` handles on UserPromptNode in TB mode.

## 3. Layout Model

### 3.1 Coordinate System

<!-- revised: P0-3 — this is a hybrid model, not a simple axis swap -->

| Concept            | LR (current)                              | TB (target)                              |
| ------------------ | ----------------------------------------- | ---------------------------------------- |
| Conversation depth | X increases rightward                     | Y increases downward                     |
| Turn breadth       | Not separated — all children share Y-axis | X increases rightward (horizontal shelf) |
| Root separation    | Vertical (`globalOffsetY`)                | Horizontal (`globalOffsetX`)             |

The key difference from a naive axis swap: in LR, all children of a node (prompts, responses, agents, tools) are placed at the next rank rightward. In TB, only **prompt children** advance to the next rank downward. Response and agent children fan out **horizontally at the same rank** as their parent prompt.

### 3.2 Node Classification

Nodes are classified into two layout categories:

| Category        | Node types                                            | Placement rule                                            |
| --------------- | ----------------------------------------------------- | --------------------------------------------------------- |
| **Spine nodes** | `session`, `userPrompt`                               | Placed on the vertical spine (Y increases with rank)      |
| **Shelf nodes** | `assistantResponse`, `agent`, `toolGroup`, `toolCall` | Placed on the horizontal shelf at their parent prompt's Y |

This classification drives the layout algorithm: spine nodes participate in rank assignment and subtree width computation. Shelf nodes are positioned in a post-pass, fanning rightward from their parent prompt.

### 3.3 Handle Positions

<!-- revised: P0-1, P0-2 — explicit handle IDs on all edges, ToolGroupNode overrides global hook -->

**Structural handles** (via `useHandlePositions()` hook):

| Handle                                | TB position       |
| ------------------------------------- | ----------------- |
| Source (spine: to child prompt below) | `Position.Bottom` |
| Target (spine: from parent above)     | `Position.Top`    |

**Shelf handles** (hardcoded per-component, not from hook):

| Node                    | Source                                     | Target                 | Notes                                                               |
| ----------------------- | ------------------------------------------ | ---------------------- | ------------------------------------------------------------------- |
| `UserPromptNode`        | `Position.Bottom` (spine, id=`structural`) | `Position.Top` (spine) | Also: `Position.Right` (shelf, id=`shelf`) for response/agent edges |
| `AgentNode`             | `Position.Right` (id=`tools`)              | `Position.Left`        | Agent is on the shelf; tools continue rightward                     |
| `AssistantResponseNode` | —                                          | `Position.Left`        | Response is on the shelf                                            |
| `ToolGroupNode`         | —                                          | `Position.Left`        | Overrides `useHandlePositions()` — stays Left                       |
| `ToolCallNode`          | —                                          | `Position.Left`        | Overrides `useHandlePositions()` — stays Left                       |
| `SessionNode`           | `Position.Bottom` (id=`structural`)        | —                      | Only spine connection downward                                      |

**Handle ID convention** (required for all edges): <!-- revised: P1-3 — systematic handle IDs on all edges -->

| Edge type                 | sourceHandle | targetHandle |
| ------------------------- | ------------ | ------------ |
| Session → Prompt          | `structural` | (default)    |
| Prompt → Prompt (spine)   | `structural` | (default)    |
| Prompt → Response (shelf) | `shelf`      | (default)    |
| Prompt → Agent (shelf)    | `shelf`      | (default)    |
| Agent → ToolGroup (shelf) | `tools`      | (default)    |
| Agent → ToolCall (shelf)  | `tools`      | (default)    |

### 3.4 Effective Size Calculations

<!-- revised: P1-1 — explicit distinction between rank sizing (plain height) and sibling spread (effective width) -->

| Helper                        | What it returns                    | Used for                                  |
| ----------------------------- | ---------------------------------- | ----------------------------------------- |
| `nodeEffectiveWidth(id)`      | `nodeW + toolOverhang` (UNCHANGED) | Subtree width / horizontal sibling spread |
| Plain `nodeDims(node).height` | Node height without inflation      | Rank sizing (Y-spacing between ranks)     |

**Important:** Rank sizing (`rankMaxH`) uses **plain node height** — tools fan horizontally and don't add vertical depth. Subtree width (`computeSubW`) uses `nodeEffectiveWidth` because tool overhang consumes horizontal space that siblings must avoid.

## 4. Algorithm Changes — `useAutoLayout.ts`

### 4.1 Constants

```typescript
// Rename for clarity — values unchanged
const RANK_GAP = 120; // was GAP_X — vertical gap between depth ranks
const SIBLING_GAP = 32; // was GAP_Y — horizontal gap between sibling spine nodes
const SHELF_GAP = 16; // NEW — horizontal gap between shelf nodes at same Y
const ROOT_GAP = 24; // horizontal gap between root session trees
const MARGIN = 20;
const TOOL_GAP_X = 56; // gap between agent and tool stack (horizontal)
const STACK_OVERLAP_FRACTION = 0.75;
```

### 4.2 Phase 1 — Classification

Node classification into structural vs leaf-tool is unchanged. Additionally, classify nodes into **spine** vs **shelf**:

```typescript
// Spine nodes: session and userPrompt — these stack vertically
const isSpineNode = (type: string) => type === 'session' || type === 'userPrompt';

// Shelf nodes: everything else — these fan out horizontally from their parent prompt
const isShelfNode = (type: string) => !isSpineNode(type);
```

### 4.3 Phase 2 — Per-Root Tree Layout

#### Step A: Build Spine Tree

Extract the spine subtree (session → prompt chains only). Shelf nodes are excluded from the tree and positioned in a post-pass.

```typescript
// Build spine-only children map
const spineKids = new Map<string, string[]>();
for (const id of subtreeIds) {
  if (!structuralNodeIds.has(id)) continue;
  const node = nodeById.get(id)!;
  if (!isSpineNode(node.type ?? '')) continue;
  const kids = (childrenOf.get(id) ?? []).filter((k) => {
    const kn = nodeById.get(k);
    return kn && isSpineNode(kn.type ?? '') && subtreeIds.has(k);
  });
  spineKids.set(id, kids);
}
```

#### Step B: Rank Computation (BFS on spine only)

Ranks are assigned via BFS on the **spine tree only**. Shelf nodes don't get their own rank — they share their parent prompt's Y-level.

#### Step C: Rank Sizing

For each rank, find the **tallest** spine node → `rankMaxH[r]`. Use **plain node height**, not effective height (tools don't add vertical depth). <!-- revised: P1-1 -->

```typescript
const rankMaxH = new Map<number, number>();
for (const [id, rank] of nodeRank) {
  const h = nodeDims(nodeById.get(id)!).height; // plain height, no tool inflation
  rankMaxH.set(rank, Math.max(rankMaxH.get(rank) ?? 0, h));
}

let cumY = MARGIN;
const rankY = new Map<number, number>();
for (let r = 0; r <= maxRank; r++) {
  rankY.set(r, cumY);
  cumY += (rankMaxH.get(r) ?? 0) + RANK_GAP;
}
```

**But wait** — the rank height must also accommodate shelf nodes. A prompt's shelf (response + agent + tools) may be taller than the prompt itself. Adjust `rankMaxH` to account for the tallest element on any shelf at that rank:

```typescript
// After initial rankMaxH from spine nodes, inflate for shelf nodes
for (const [id, rank] of nodeRank) {
  const shelfChildren = (childrenOf.get(id) ?? []).filter((k) => {
    const kn = nodeById.get(k);
    return kn && isShelfNode(kn.type ?? '');
  });
  for (const kid of shelfChildren) {
    const kh = nodeDims(nodeById.get(kid)!).height;
    // Include tool stack height for agents
    const tools = leafToolsByParent.get(kid);
    const totalH = tools ? Math.max(kh, computeToolStackHeight(kid, tools)) : kh;
    rankMaxH.set(rank, Math.max(rankMaxH.get(rank) ?? 0, totalH));
  }
}
```

#### Step D: Subtree Width Computation (spine nodes only)

`computeSubW(id)` returns the total width a spine subtree occupies, accounting for shelf overhang:

```typescript
function shelfWidth(promptId: string): number {
  // Total horizontal space: prompt + response + agent(s) + tools
  const promptW = nodeDims(nodeById.get(promptId)!).width;
  const shelfChildren = (childrenOf.get(promptId) ?? []).filter((k) => {
    const kn = nodeById.get(k);
    return kn && isShelfNode(kn.type ?? '');
  });
  if (shelfChildren.length === 0) return promptW;
  let totalW = promptW;
  for (const kid of shelfChildren) {
    totalW += SHELF_GAP + nodeEffectiveWidth(kid); // includes tool overhang
  }
  return totalW;
}

function computeSubW(nodeId: string): number {
  const kids = spineKids.get(nodeId) ?? [];
  const selfW = shelfWidth(nodeId);
  if (kids.length === 0) return selfW;
  const childrenTotalW =
    kids.reduce((sum, c) => sum + computeSubW(c), 0) + SIBLING_GAP * (kids.length - 1);
  return Math.max(selfW, childrenTotalW);
}
```

#### Step E: Position Assignment (spine nodes)

```typescript
function assignPos(nodeId: string, xStart: number) {
  const rank = nodeRank.get(nodeId)!;
  const nodeY = rankY.get(rank)!;
  const kids = spineKids.get(nodeId) ?? [];
  const totalW = computeSubW(nodeId);

  if (kids.length === 0) {
    // Leaf spine node: center in allocated horizontal band
    const selfW = shelfWidth(nodeId);
    positions.set(nodeId, { x: xStart + (totalW - selfW) / 2, y: nodeY });
    return;
  }

  // Position spine children left-to-right
  let childX = xStart;
  for (const kid of kids) {
    const kidSubW = computeSubW(kid);
    assignPos(kid, childX);
    childX += kidSubW + SIBLING_GAP;
  }

  // Center parent over children midpoint (or left-align for sessions)
  const node = nodeById.get(nodeId)!;
  const firstChildX = positions.get(kids[0])!.x;
  const lastChild = kids[kids.length - 1];
  const lastChildX = positions.get(lastChild)!.x;
  const lastChildW = nodeDims(nodeById.get(lastChild)!).width;

  if (node.type === 'session') {
    positions.set(nodeId, { x: firstChildX, y: nodeY });
  } else {
    const midX = (firstChildX + lastChildX + lastChildW) / 2;
    const nodeW = nodeDims(node).width;
    positions.set(nodeId, { x: midX - nodeW / 2, y: nodeY });
  }
}
```

#### Step F: Shelf Positioning Post-Pass

<!-- revised: P1-6 — response nodes are horizontally offset, not centered -->

After spine nodes are placed, position shelf nodes (response, agent, tools) to the right of their parent prompt:

```typescript
for (const [promptId, rank] of nodeRank) {
  const promptPos = positions.get(promptId);
  if (!promptPos) continue;
  const promptNode = nodeById.get(promptId)!;
  const promptW = nodeDims(promptNode).width;

  // Collect shelf children, sorted: responses first, then agents
  const shelfChildren = (childrenOf.get(promptId) ?? []).filter((k) => {
    const kn = nodeById.get(k);
    return kn && isShelfNode(kn.type ?? '');
  });
  if (shelfChildren.length === 0) continue;

  // Place shelf nodes left-to-right starting from prompt's right edge
  let shelfX = promptPos.x + promptW + SHELF_GAP;
  for (const kid of shelfChildren) {
    const kidNode = nodeById.get(kid)!;
    const kidH = nodeDims(kidNode).height;
    // Vertically center shelf node with prompt
    const promptMidY = promptPos.y + nodeDims(promptNode).height / 2;
    positions.set(kid, {
      x: shelfX,
      y: promptMidY - kidH / 2,
    });
    shelfX += nodeEffectiveWidth(kid) + SHELF_GAP;
  }
}
```

#### Step G: Tool Positioning Post-Pass (MINIMAL CHANGE)

Tool stacking logic is nearly identical to current — tools fan out to the right of their parent agent at the same Y-level. The only consideration: `nodeEffectiveWidth` must still account for tool overhang so that `computeSubW` prevents sibling overlap. <!-- revised: P1-2 — tool width accounted for via nodeEffectiveWidth in computeSubW/shelfWidth -->

#### Step H: Root Tree Placement

```typescript
let globalOffsetX = MARGIN;
for (const root of sortedRoots) {
  assignPos(root, globalOffsetX);
  globalOffsetX += computeSubW(root) + ROOT_GAP;
}
```

### 4.4 Spawn Node

Position at bottom-center of the graph:

```typescript
const spawnX = (minX + maxX) / 2 - 25;
const spawnY = maxY + RANK_GAP;
```

## 5. Node Component Changes

### 5.1 `useHandlePositions.ts`

Returns the **spine** handle positions (Bottom/Top). Shelf nodes override as needed.

```typescript
export function useHandlePositions(): HandleConfig {
  return { source: Position.Bottom, target: Position.Top };
}
```

### 5.2 Per-Component Handle Changes

<!-- revised: P0-1, P0-2 — explicit handle IDs, ToolGroupNode overrides hook -->

| Component               | Handles                                                                   | Implementation                                  |
| ----------------------- | ------------------------------------------------------------------------- | ----------------------------------------------- |
| `SessionNode`           | source: Bottom (id=`structural`)                                          | Uses hook                                       |
| `UserPromptNode`        | target: Top, source: Bottom (id=`structural`), source: Right (id=`shelf`) | Hook + explicit Right handle                    |
| `AgentNode`             | target: Left, source: Right (id=`tools`)                                  | **Overrides hook** — agent is a shelf node      |
| `AssistantResponseNode` | target: Left                                                              | **Overrides hook** — response is a shelf node   |
| `ToolGroupNode`         | target: Left                                                              | **Overrides hook** — tool group is a shelf node |
| `ToolCallNode`          | target: Left                                                              | **Overrides hook** — tool call is a shelf node  |
| `SpawnAgentNode`        | target: Top                                                               | Uses hook                                       |

**Key insight:** Shelf nodes (response, agent, toolGroup, toolCall) all receive edges from the **left** because they're positioned to the right of their parent. They must **not** use `useHandlePositions()` — they hardcode `Position.Left` for their target handle.

Only `UserPromptNode` needs **both** a spine handle (Bottom, for the next prompt) and a shelf handle (Right, for response/agent edges).

### 5.3 Thread Handles — Removed in TB

<!-- revised: P1-5 — thread edges hidden, handles removed -->

In TB mode, the `thread-in` and `thread-out` handles on `UserPromptNode` are not rendered. The structural spine edges already show conversation flow. This eliminates the handle collision problem (P0-1) entirely.

```typescript
// UserPromptNode — TB mode: no thread handles
// The structural target (Top) and source (Bottom, id="structural") handles
// plus the shelf source (Right, id="shelf") are sufficient.
```

If a future LR/TB toggle is added, thread handles conditionally render in LR mode only.

## 6. Edge Changes

### 6.1 Edge Builder — `AgentGraph.tsx`

<!-- revised: P1-3 — all edges get explicit handle IDs -->

Every edge must specify `sourceHandle` and `targetHandle` to avoid ambiguity:

```typescript
function buildEdge(source: string, target: string, type: EdgeType): Edge {
  const sourceNode = nodeById.get(source);
  const targetNode = nodeById.get(target);
  const sourceType = sourceNode?.type ?? '';
  const targetType = targetNode?.type ?? '';

  // Determine handle IDs based on node types
  let sourceHandle = 'structural'; // default: spine connection
  let targetHandle: string | undefined = undefined; // default: top handle

  // Shelf edges: source uses "shelf" handle, target uses left
  if (isShelfNode(targetType)) {
    sourceHandle = sourceType === 'agent' ? 'tools' : 'shelf';
    // targetHandle stays default (Left handle on shelf nodes)
  }

  return { id: `${source}-${target}`, source, target, sourceHandle, targetHandle, ...styling };
}
```

### 6.2 Thread Edges

Thread edges are not built in TB mode. The edge builder skips them:

```typescript
// In TB mode, thread edges are redundant — structural edges show conversation flow
// Skip thread edge creation entirely
```

### 6.3 Edge Rendering

`AnimatedEdge.tsx` uses `getSmoothStepPath()` which adapts to handle positions. No changes needed.

## 7. Viewport & Zoom

### 7.1 Aspect Ratio

- **LR:** Wide graph (~1200px+ wide, ~400-800px tall)
- **TB:** Moderate width (~600-1200px), tall (~800-1500px+)

The `fitView` call works automatically. Clamp zoom:

```typescript
{ padding: 0.1, minZoom: 0.3, maxZoom: 1.5 }
```

### 7.2 MiniMap

Bottom-right positioning works for TB. No change needed.

## 8. Test Changes

### 8.1 Existing Tests — Updated Assertions

| Test                                             | LR assertion                      | TB assertion                               |
| ------------------------------------------------ | --------------------------------- | ------------------------------------------ |
| "children below parent" (was "to the right")     | `child.x > parent.x`              | `child.y > parent.y` (spine children only) |
| "horizontally centers parent" (was "vertically") | `parent.y ≈ midpoint(children.y)` | `parent.x ≈ midpoint(children.x)`          |
| "deep chain progressively down" (was "right")    | `each.x > prev.x`                 | `each.y > prev.y`                          |
| "tool grid to the right"                         | `tool.x > parent.x`               | `tool.x > parent.x` (UNCHANGED)            |
| "prevents horizontal overlap" (was "vertical")   | siblings don't overlap on Y       | siblings don't overlap on X                |
| "chronological order"                            | siblings ordered by Y             | siblings ordered by X                      |
| "sessions chronological"                         | roots ordered by Y                | roots ordered by X                         |

### 8.2 New Tests

- **TB1:** "sessions share same Y, spread horizontally" — all roots at `rankY[0]`, ordered by X
- **TB2:** "response and agent on same Y as parent prompt" — shelf nodes match prompt's Y (centered)
- **TB3:** "tool groups to the right of agent at same Y" — `toolGroup.x > agent.x`, `toolGroup.y ≈ agent.y`
- **TB4:** "spine children use Top/Bottom handles, shelf children use Left handle"
- **TB5:** "spawn node centered below deepest rank" — `spawn.x ≈ midX`, `spawn.y > maxY`
- **TB6:** "no thread edges in TB mode" — edge list contains no `thread-` prefixed edges
- **TB7:** "shelf width accounts for tool overhang — no horizontal overlap between sibling prompts"

## 9. Implementation Sequence

### Step 1: Branch & Scaffolding (15 min)

- Create `experiment/tb-layout` branch
- Rename constants (`GAP_X` → `RANK_GAP`, `GAP_Y` → `SIBLING_GAP`)
- Add `SHELF_GAP` constant
- Add `isSpineNode()` / `isShelfNode()` classification helpers
- Verify tests still pass after rename

### Step 2: Core Algorithm — Spine Layout (1.5 hours)

- Build spine-only children map (`spineKids`)
- Rank computation on spine tree only
- Rank sizing with shelf-height inflation
- `shelfWidth()` helper — total horizontal space per prompt
- `computeSubW()` — subtree width for horizontal sibling spread
- `assignPos()` — Y from rank, X from horizontal band, center/left-align
- Root placement with `globalOffsetX`

### Step 3: Shelf Post-Pass (1 hour)

- Position response/agent nodes to the right of their parent prompt at same Y
- Tool stacking post-pass (mostly unchanged — tools right of agent)
- Clamping: ensure shelf nodes don't overflow rank height <!-- revised: P1-2 -->

### Step 4: Handle & Edge Updates (45 min)

- Update `useHandlePositions()` → Bottom/Top
- Shelf nodes override to `Position.Left` target: AgentNode, AssistantResponseNode, ToolGroupNode, ToolCallNode
- Add `shelf` source handle (Position.Right) to UserPromptNode
- Add `tools` source handle (Position.Right) to AgentNode
- Edge builder: explicit `sourceHandle`/`targetHandle` on all edges <!-- revised: P1-3 -->
- Remove thread edge creation in TB mode <!-- revised: P1-5 -->
- Remove thread handles from UserPromptNode in TB mode

### Step 5: Test Rewrite (1 hour)

- Update 11 existing tests for TB assertions
- Add 7 new TB-specific tests (TB1–TB7)
- Run full test suite

### Step 6: Visual QA (1 hour)

- Run `simulate_all_nodes.ts` — verify every node type
- Check: session row, prompt depth, shelf alignment, tool fans
- Check: minimap, fitView, zoom
- Check: tool group modes (pill grid, timeline, heatmap)
- Check: expanded tool view (F key)
- Check: mobile portrait mode (may benefit from TB) <!-- P2-3 -->
- **Success check:** With 3 sessions of varying depth (2, 5, 10 prompts), can you identify the deepest session within 2 seconds without scrolling? <!-- revised: P2-4 — concrete success metric -->

### Step 7: Polish & Edge Cases (30 min)

- Single-session graph (center, not left-align)
- Very deep conversation (10+ prompts)
- Wide tool fans (many parallel tool calls)
- Empty state / spawn-only view

**Total estimate: ~6 hours**

## 10. Future: LR/TB Toggle

This design hardcodes TB. A future enhancement could add a toggle:

```typescript
// In agentStore persisted view settings
layoutDirection: 'LR' | 'TB'; // default: 'TB'

// In useHandlePositions
const dir = useAgentStore((s) => s.viewSettings.layoutDirection);
return dir === 'TB'
  ? { source: Position.Bottom, target: Position.Top }
  : { source: Position.Right, target: Position.Left };

// In useAutoLayout — memoization key must include direction
const key = `${nodes.length}:${edges.length}:${idHash}:${dimHash}:${expandedParentId}:${dir}`;
```

If toggle is added:

- Thread handles/edges re-enable in LR mode
- Shelf nodes use Right/Left handles in both modes (no change)
- Spine nodes switch between Bottom/Top (TB) and Right/Left (LR)
- Layout direction persisted in localStorage with other view settings <!-- revised: P1-4 -->

Deferred — ship TB first, validate the UX, then consider the toggle if users request LR back.

## 11. Risks & Mitigations

| Risk                                                  | Impact               | Mitigation                                                            |
| ----------------------------------------------------- | -------------------- | --------------------------------------------------------------------- |
| Shelf nodes taller than prompt — rank height wrong    | High                 | Inflate `rankMaxH` by scanning shelf children (Step C)                |
| Handle ID missing on an edge → wrong routing          | High                 | Systematic convention: all edges specify sourceHandle/targetHandle    |
| Shelf node uses `useHandlePositions()` → wrong target | High                 | Shelf nodes hardcode `Position.Left`, don't use hook                  |
| Wide tool fans overlap sibling prompt's shelf         | Medium               | `shelfWidth()` in `computeSubW()` accounts for full horizontal extent |
| Tool group grid layout breaks                         | Medium — visual only | Tool grid stays horizontal, minimal change needed                     |
| Tall graphs need more scrolling                       | Low                  | fitView + minZoom 0.3                                                 |
| Edge routing looks weird                              | Low                  | smooth-step adapts; QA step catches issues                            |

## 12. Non-Goals

- **No LR/TB toggle in this pass** — hardcode TB, validate first
- **No node dimension changes** — keep existing widths/heights
- **No new node types** — purely a layout direction change
- **No edge style changes** — keep smooth-step with existing colors
- **No store schema changes** — no new persisted settings (yet)

## 13. Open Questions / Deferred

<!-- P2 findings — not blocking, address incrementally -->

- **P2-1:** Memoization key doesn't include layout direction — only matters if toggle is added (Section 10 already notes this)
- **P2-2:** With 10+ concurrent sessions, the horizontal row gets very wide and fitView zooms out aggressively. Consider a max-sessions-visible threshold with horizontal scrolling if this becomes a real issue
- **P2-3:** Mobile portrait mode may benefit from TB layout — worth testing during QA but not blocking
- **P2-4:** Success metric defined in Step 6 of implementation sequence: "identify deepest session within 2 seconds without scrolling with 3 sessions of varying depth"
