# Plan: Tool Call Grouping Visualizations

## Context

When an agent makes 20+ tool calls, the individual tool nodes crowd the graph. This plan replaces individual leaf-tool nodes with a single **composite group node** per parent agent that renders one of three visualization modes: **Pill Grid**, **Timeline Strip**, or **Heatmap Matrix**. The existing detail panel continues working unchanged — clicking any tool inside the group calls `selectNode('tool-{useId}')` which triggers the same right-side panel.

**Key decisions:**
- Old stacked/individual tool view is removed (no "Classic" mode)
- `F` key toggles collapse/expand of group nodes globally
- Global mode toggle in ViewSettingsDropdown (Pill Grid / Timeline / Heatmap)
- Structural tools (Task→child agent) remain as individual `toolCall` nodes
- Pill Grid uses max **6 items per column**

## Files to Modify/Create

| File | Action |
|------|--------|
| `apps/dashboard/src/store/agentStore.ts` | Add `toolGroupMode` state + setter |
| `apps/dashboard/src/components/graph/nodes/ToolGroupNode.tsx` | **NEW** — composite node with 3 modes |
| `apps/dashboard/src/components/graph/nodeTypes.ts` | Register `toolGroup` type |
| `apps/dashboard/src/components/graph/AgentGraph.tsx` | Replace leaf tools with synthetic `toolGroup` nodes |
| `apps/dashboard/src/hooks/useAutoLayout.ts` | Add `toolGroup` to dimension defaults + dynamic sizing |
| `apps/dashboard/src/components/layout/ViewSettingsDropdown.tsx` | Replace "Show All Tools" toggle, add mode selector |
| `apps/dashboard/src/utils/graphSearch.ts` | Add `toolGroup` case to `nodeMatchesSearch` |

## Step-by-Step

### Step 1: Store — add `toolGroupMode`

**File:** `agentStore.ts`

- Add to interface (after line 178): `toolGroupMode: 'pillGrid' | 'timeline' | 'heatmap';`
- Add action: `setToolGroupMode: (mode: 'pillGrid' | 'timeline' | 'heatmap') => void;`
- Initialize: `toolGroupMode: 'pillGrid' as const,`
- Add setter: `setToolGroupMode: (toolGroupMode) => set({ toolGroupMode }),`
- Repurpose `showAllTools`: now means "group node expanded" (true) vs "collapsed chip" (false). The boolean, setter, and F key handler stay as-is.

### Step 2: Create `ToolGroupNode.tsx`

**New file:** `apps/dashboard/src/components/graph/nodes/ToolGroupNode.tsx`

A single memoized React Flow node component that reads `toolGroupMode` and `showAllTools` from the store and renders one of four states:

#### Data shape (passed via `node.data`):
```typescript
interface ToolGroupData {
  tools: ToolCallSummary[];
  parentAgentId: string;
}
```

#### Collapsed state (showAllTools = false):
A compact chip ~180x36: `"[14] tools  ●●●●●●"` with mini status dots. The whole chip is the node — no internal click targets.

#### PillGrid mode (expanded):
- CSS grid: `grid-template-columns: repeat(auto-fill, minmax(110px, 1fr))`
- **Max 6 rows per column**, then wraps to next column
- Each pill: colored bg by tool type, shows icon + name + duration text + status icon
- Pill click: `selectNode('tool-' + tc.toolUseId, 'graph')`
- Selected pill gets ring highlight when `selectedNodeId === 'tool-' + tc.toolUseId`
- Header row: "TOOL CALLS" label + `"12 ok · 2 err"` stats

#### Timeline mode (expanded):
- Horizontal flex bar, ~500px wide × 60px tall
- Segments proportional to duration: `Math.max(duration / totalDuration * 100, 3)%` with 3% minimum for clickability
- Color by tool name (deterministic color map)
- Error segments: diagonal stripe overlay
- Hover: tooltip with name + duration + status
- Click: `selectNode('tool-' + tc.toolUseId, 'graph')`
- Time axis below bar with labels
- Legend row showing tool name → color

#### Heatmap mode (expanded):
- Rows = distinct `toolName` values (sorted alphabetically)
- Columns = Nth sequential invocation of that tool type
- Cell 28×28, color = status (teal/red/purple), opacity = normalized duration
- Row labels on left (56px wide)
- Click cell: `selectNode('tool-' + tc.toolUseId, 'graph')`
- Legend: color scale + status legend

#### Tool color map (shared across modes):
```
Read → teal-600, Edit → violet-600, Bash → orange-600,
Grep → blue-600, Glob → cyan-600, Write → purple-600,
Task → emerald-600, WebSearch → amber-600, default → gray-600
```

### Step 3: Register node type

**File:** `nodeTypes.ts`

```typescript
import { ToolGroupNode } from './nodes/ToolGroupNode';

toolGroup: ToolGroupNode,  // add to nodeTypes object
```

Keep `toolCall` — still used for structural tools (Task→child agent).

### Step 4: Refactor AgentGraph visibility memo

**File:** `AgentGraph.tsx` — the `useMemo` at line 69-204

This is the core change. Instead of selectively hiding leaf tools, we **replace** them with synthetic `toolGroup` nodes.

**New logic in normal mode (after structuralToolIds + leafToolsByParent are built):**

1. Collect all leaf tool node IDs into a `leafToolNodeIds` Set
2. For each entry in `leafToolsByParent`:
   - Look up `ToolCallSummary` from each tool node's data
   - Create a synthetic `toolGroup` node: `{ id: 'toolgroup-' + parentId, type: 'toolGroup', data: { tools, parentAgentId }, position: OFFSCREEN, style: HIDDEN_STYLE }`
   - Create an edge: `{ source: parentId, target: 'toolgroup-' + parentId, type: 'smoothstep' }`
3. Filter `rawNodes` to remove all `leafToolNodeIds`
4. Filter `rawEdges` to remove edges targeting leaf tools
5. Append synthetic nodes and edges to the filtered sets
6. Remove `stackedEdgeTargets` logic entirely (no longer needed)

**Also update:**
- Add `toolGroupMode` to dependency array of the memo
- The `expandedParentId` memo (line 54-65) — add a case: if `selectedNodeId` starts with `toolgroup-`, extract the parent from the ID
- Auto-pan effect (line 442-483): update `edge.target.startsWith('tool-')` check to also handle `toolgroup-*`
- `onNodesChange` (line 498-509): skip dimension updates for `toolgroup-*` IDs (they're synthetic, not in the store's `nodes` array)

### Step 5: Update layout dimensions

**File:** `useAutoLayout.ts`

- Add to `NODE_DEFAULTS` (line 7): `toolGroup: { width: 280, height: 120 }`
- Add `toolGroupDims(node)` function that computes dynamic dimensions based on tool count and mode:
  - Collapsed: `{ width: 180, height: 36 }`
  - PillGrid: width = `ceil(count / 6) * 120 + 16`, height = `min(count, 6) * 28 + 32`
  - Timeline: `{ width: 500, height: 72 }`
  - Heatmap: width = `maxColsPerType * 32 + 80`, height = `uniqueToolTypes * 32 + 32`
- Update `nodeDims(node)` (line 34): if `node.type === 'toolGroup'` call `toolGroupDims(node)`
- The existing leaf-tool post-pass (line 288-343) becomes a no-op since `leafToolsByParent` will be empty for parents that have a toolgroup — it's still correct for any edge case where a structural tool has siblings.

### Step 6: Update ViewSettingsDropdown

**File:** `ViewSettingsDropdown.tsx`

- Add store selectors: `toolGroupMode`, `setToolGroupMode`
- Change the F-key toggle label from "Show All Tools" to "Expand Tools"
- Add a "Tool View" section after the toggles with 3 radio-style buttons:
  - Pill Grid (blue dot when active)
  - Timeline
  - Heatmap
- Follow existing styling pattern (green/blue dot + label)

### Step 7: Update graph search

**File:** `graphSearch.ts`

Add case in `nodeMatchesSearch` (line 30-35):
```typescript
case 'toolGroup': {
  const tools = (d as Record<string, unknown>).tools as ToolCallSummary[] | undefined;
  return tools?.some(t => [t.toolName, t.inputPreview].some(v => v?.toLowerCase().includes(query))) ?? false;
}
```

### Step 8: Update MiniMap

**File:** `AgentGraph.tsx` line 588-600

Add case: `case 'toolGroup': return '#a855f7';` (purple, same as toolCall)

## Edge Cases

1. **Structural tools (Task→child agent):** Excluded from grouping by existing `structuralToolIds` logic. They remain as individual `toolCall` nodes with source handles.

2. **Zero leaf tools:** If an agent has only structural tools, no `toolGroup` node is created for it.

3. **Synthetic node dimension updates:** `onNodesChange` skips `toolgroup-*` IDs since they aren't in `store.nodes`. React Flow measures them, but the measurement is used only by the layout hook's `nodeDims` which prefers `node.measured` first.

4. **Selected tool inside group:** When `selectedNodeId = 'tool-xyz'`, the detail panel finds the tool data via the existing agent search. The `toolGroup` node component highlights the matching pill/segment/cell by comparing against `selectedNodeId`.

5. **Search mode:** `toolGroup` nodes match via `nodeMatchesSearch`. In search mode, the toolGroup node is shown if any contained tool matches. The ancestors are collected normally.

6. **Connected IDs for highlighting:** When a `toolgroup-*` node is part of `connectedIds`, it dims correctly. When a `tool-*` ID is selected (from clicking inside a group), we need to add the `toolgroup-*` parent to the connected set — update the `connectedIds` memo to check if `selectedNodeId` starts with `tool-` and walk edges to find the `toolgroup-` node as well.

## Verification

1. `pnpm test` — all existing tests should pass (layout tests still work since structural tools are unchanged)
2. Start server + dashboard: `.\start-server.ps1` and `.\start-client.ps1`
3. Run `npx tsx scripts/simulate_all_nodes.ts` to generate events with many tool calls
4. Verify:
   - Tool calls appear as grouped pill grid (default)
   - F key toggles between collapsed chip and expanded grid
   - Clicking any pill opens the right-side detail panel with full tool info
   - Toggle to Timeline mode in settings — segments appear proportional to duration
   - Toggle to Heatmap mode — matrix with rows by tool type
   - Task tools (structural) still appear as individual nodes with edges to child agents
   - Graph search finds tools by name inside group nodes
   - Arrow key navigation works through toolgroup nodes
