# MCP Tool Visual Differentiation — Design Spec

> Status: Roadmap (not yet implemented)
> Effort: High (~15-20 files)
> Created: 2026-02-10

---

## Problem

All tool calls in the Synapse graph look identical. A native `Read` call and an MCP tool like `notion_create_page` are both rendered as the same purple pill node, with the same icon style, the same color in every lens view, and no indication of where the tool came from.

When agents use MCP servers (Notion, Sentry, GitHub, custom tools), there's no way to visually distinguish those calls from built-in Claude Code tools. This makes it hard to understand tool provenance, debug MCP issues, or get a feel for which external services an agent is actually touching.

## Goal

Make MCP tools visually distinct **everywhere** — graph nodes, lens views, detail panels, edges — so you can instantly see *where* a tool came from, not just *what* it did.

## Existing Infrastructure

The codebase already has pieces that support this but they don't flow through to tool nodes:

- **`VENDOR_COLORS`** in `packages/core/src/utils/format.ts` — color palette for anthropic, openai, google, groq, etc.
- **`getVendorColor()`** — returns hex color by vendor name
- **`AgentNode`** — already renders a vendor-colored left border when vendor info is present
- **`AgentEvent.vendor`** and **`AgentEvent.eventSource`** fields in `packages/core/src/types/agent.ts` — exist but never propagated to `ToolCallSummary`
- **`SpawnAgentRequest.mcpServers`** — the API already accepts MCP server configs

The gap: **`ToolCallSummary` has no provider field**, and the `eventHandlers.handleToolStart()` function drops all vendor/provider info when creating tool call entries.

---

## Design

### 1. Data Layer — Carry provider info through the pipeline

**Files to modify:**
- `packages/core/src/types/agent.ts` — `ToolCallSummary`
- `packages/server/src/services/eventStore.ts` — `normalizeHookPayload()`
- `packages/server/src/services/agentManager.ts` — `handleStreamEvent()`
- `packages/server/src/db.ts` — SQLite schema
- `apps/dashboard/src/store/eventHandlers.ts` — `handleToolStart()`

**Changes:**

Add to `ToolCallSummary`:
```typescript
toolProvider?: string;      // 'native' | 'mcp:<server-name>' | 'custom'
mcpServerName?: string;     // Human-readable MCP server name (e.g., 'notion')
```

Add to SQLite `events` table:
```sql
ALTER TABLE events ADD COLUMN tool_provider TEXT;
```

In `normalizeHookPayload()`: detect MCP tools from hook payload. Claude Code hook events use namespaced tool names like `mcp__notion__create_page`. Parse the prefix.

In `handleStreamEvent()` (agentManager): extract MCP info from SDK stream `content_block_start` events when available.

In `handleToolStart()` (eventHandlers): read `toolProvider` from `AgentEvent` and copy it to the new `ToolCallSummary`.

### 2. Detection Heuristic

How to classify a tool as native vs MCP:

1. **Name pattern**: MCP tools from Claude Code hooks arrive as `mcp__<server>__<tool>` — parse the double-underscore prefix to extract server name and tool name
2. **Known native list**: Maintain a `NATIVE_TOOLS` set:
   ```typescript
   const NATIVE_TOOLS = new Set([
     'Read', 'Write', 'Edit', 'Bash', 'Glob', 'Grep',
     'WebSearch', 'WebFetch', 'Task', 'NotebookEdit',
     'TodoWrite', 'AskUserQuestion', 'EnterPlanMode', 'ExitPlanMode',
   ]);
   ```
   Anything not in this set is likely MCP or custom.
3. **SDK metadata**: Agent SDK stream events may include tool source in the content block.
4. **Spawn config**: If an agent was spawned with `mcpServers` config, tools matching those server names are definitively MCP.
5. **Fallback**: Unknown tools get `toolProvider: 'custom'` with neutral styling.

### 3. Graph Nodes — ToolCallNode visual differentiation

**File:** `apps/dashboard/src/components/graph/nodes/ToolCallNode.tsx`

- **Left border accent**: 3px left border colored by MCP server (same pattern `AgentNode` uses for vendor). Color auto-generated from server name hash (deterministic HSL with fixed saturation/lightness for dark theme readability). Native tools: no left border (unchanged).
- **Badge/chip**: Small pill badge below the tool name showing MCP server name (e.g., `notion`, `sentry`). Only shown for MCP tools. Native tools show no badge.
- **Icon**: MCP tools display a plug icon (or similar) instead of the standard `TOOL_ICONS` lookup. Alternatively, keep the tool-specific icon but add a small colored dot indicator.
- **Tooltip**: On hover, show full provider info: `"MCP Server: notion-workspace (localhost:3001)"`

**Color scheme:**
- Native tools: current purple status colors (unchanged)
- MCP tools: status colors still drive the background, but add colored left border + badge using per-server color

### 4. Edge Styling

**File:** `apps/dashboard/src/components/graph/edges/AnimatedEdge.tsx`

- MCP tool edges: use the MCP server's accent color at 40% opacity instead of default blue
- Optional: slightly different dash pattern (longer dashes) for accessibility — not color-only differentiation

### 5. Lens Views — Filter and group by provider

**Files:** `apps/dashboard/src/components/lens/LensContext.tsx`, `LensAdapter.tsx`, individual lens views

Add `toolProvider?: string` to `LensTreeNode`.

| Lens | MCP Enhancement |
|------|----------------|
| **Tree** | MCP badge inline with tool name. Filter toggle: All / Native / MCP |
| **Heatmap** | Option to group Y-axis by MCP server instead of tool name |
| **Treemap** | MCP tools use server accent color as rect fill instead of uniform purple |
| **Sankey** | Optional 5th layer: Sessions → Prompts → Agents → **MCP Servers** → Tools |
| **Cost** | Tag rows with provider badge |
| **Compaction** | No change needed |

### 6. Detail Panel

**File:** `apps/dashboard/src/components/panels/AgentDetailPanel.tsx`

- In tool call list: add provider badge next to each tool name
- In expanded tool detail: show Provider type (Native / MCP), MCP server name and command, server connection status if trackable

### 7. Spawn Dialog — MCP server config UI

**File:** `apps/dashboard/src/components/panels/SpawnAgentDialog.tsx`

- Add "MCP Servers" section under Advanced options
- UI to add MCP server configs (command, args, env vars)
- Show configured servers as colored chips
- Completes the loop: spawn with MCP → see MCP tools differentiated in graph

### 8. Format Utilities — New helpers

**File:** `packages/core/src/utils/format.ts`

```typescript
getMcpServerColor(serverName: string): string
  // Deterministic color from server name hash → HSL

getMcpServerIcon(serverName: string): string
  // Map known servers to icons, fallback to plug icon

formatToolProvider(provider?: string): { label: string; color: string; icon: string }
  // Unified formatting for any provider string

isNativeTool(toolName: string): boolean
  // Check against NATIVE_TOOLS set

parseMcpToolName(toolName: string): { serverName: string; toolName: string } | null
  // Parse 'mcp__server__tool' format, return null if not MCP
```

---

## File Manifest

All files that need modification:

| File | Change |
|------|--------|
| `packages/core/src/types/agent.ts` | Add `toolProvider`, `mcpServerName` to `ToolCallSummary` |
| `packages/core/src/utils/format.ts` | Add 5 new MCP utility functions |
| `packages/server/src/db.ts` | Add `tool_provider` column |
| `packages/server/src/services/eventStore.ts` | MCP detection in `normalizeHookPayload()` |
| `packages/server/src/services/agentManager.ts` | Extract MCP info from SDK stream events |
| `apps/dashboard/src/store/eventHandlers.ts` | Pass provider to `ToolCallSummary` in `handleToolStart()` |
| `apps/dashboard/src/components/graph/nodes/ToolCallNode.tsx` | Left border, badge, icon, tooltip |
| `apps/dashboard/src/components/graph/edges/AnimatedEdge.tsx` | MCP accent color + dash pattern |
| `apps/dashboard/src/components/lens/LensContext.tsx` | Add `toolProvider` to `LensTreeNode` |
| `apps/dashboard/src/components/lens/LensAdapter.tsx` | Pass provider through tree building |
| `apps/dashboard/src/components/lens/tree/TreeRow.tsx` | MCP badge in tree |
| `apps/dashboard/src/components/lens/tree/TreeView.tsx` | Filter toggle |
| `apps/dashboard/src/components/lens/heatmap/HeatmapView.tsx` | Group-by-server option |
| `apps/dashboard/src/components/lens/treemap/TreemapView.tsx` | Server accent colors |
| `apps/dashboard/src/components/lens/sankey/SankeyView.tsx` | Optional 5th MCP layer |
| `apps/dashboard/src/components/lens/cost/CostWaterfallView.tsx` | Provider badge on rows |
| `apps/dashboard/src/components/panels/AgentDetailPanel.tsx` | Provider info in tool list + detail |
| `apps/dashboard/src/components/panels/SpawnAgentDialog.tsx` | MCP server config UI |

---

## Verification

1. Spawn an agent with `mcpServers` configured via API → verify MCP tools show colored borders and server badges in graph
2. Run a Claude Code session that uses MCP tools → verify hook events correctly detect `mcp__<server>__<tool>` naming and tag them
3. Check all 6 lens views render MCP provider info correctly
4. Verify native tools are visually unchanged (no regression)
5. Test detection heuristic edge cases: unknown tools, tools with similar names to natives, tools without `mcp__` prefix
6. Test spawn dialog MCP server configuration and verify the config flows to the agent
