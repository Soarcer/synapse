# Implementation Prompt: MCP Tool Visual Differentiation

> Copy everything below the line into a new AI coding session.

---

## Task

Implement MCP tool visual differentiation for the Synapse dashboard. The full design spec is in `docs/MCP_TOOL_DIFFERENTIATION.md` — read it first before writing any code. The CLAUDE.md file has project conventions and structure.

## Context

Synapse is a real-time agent observability dashboard that visualizes Claude Code sessions as interactive node graphs. Currently, all tool calls (native Claude Code tools like Read/Edit/Bash AND MCP-provided tools like notion_create_page or sentry_search_issues) render as identical purple pill nodes. There is no way to tell where a tool came from.

The goal: make MCP tools visually distinct everywhere — graph nodes, lens views, detail panels, edges — using colored borders, badges, icons, and provider metadata.

## Key Constraint

The project uses a monorepo layout. The paths in CLAUDE.md are outdated — the actual structure is:

```
packages/core/src/types/agent.ts      — shared types (ToolCallSummary lives here)
packages/core/src/utils/format.ts     — formatting helpers (VENDOR_COLORS, getKindColor, TOOL_ICONS live here)
packages/server/src/db.ts             — SQLite schema
packages/server/src/services/         — agentManager.ts, eventStore.ts, broadcaster.ts
apps/dashboard/src/store/             — agentStore.ts, eventHandlers.ts, wsClient.ts
apps/dashboard/src/components/graph/  — nodes/, edges/, AgentGraph.tsx
apps/dashboard/src/components/lens/   — all 6 lens views
apps/dashboard/src/components/panels/ — AgentDetailPanel.tsx, SpawnAgentDialog.tsx
```

## Implementation Order

Do this in phases. After each phase, verify the build compiles (`npm run build`) and the dashboard renders without errors.

### Phase 1: Data layer (types + detection + persistence)

1. Read `packages/core/src/types/agent.ts`. Add `toolProvider?: string` and `mcpServerName?: string` to `ToolCallSummary`.
2. Read `packages/core/src/utils/format.ts`. Add these utilities:
   - `NATIVE_TOOLS` set (Read, Write, Edit, Bash, Glob, Grep, WebSearch, WebFetch, Task, NotebookEdit, TodoWrite, AskUserQuestion, EnterPlanMode, ExitPlanMode)
   - `parseMcpToolName(toolName: string): { serverName: string; toolName: string } | null` — parses `mcp__<server>__<tool>` format
   - `isNativeTool(toolName: string): boolean`
   - `getMcpServerColor(serverName: string): string` — deterministic HSL from name hash, fixed saturation/lightness for dark theme
   - `getMcpServerIcon(serverName: string): string` — known server icons, fallback to plug symbol
   - `formatToolProvider(provider?: string): { label: string; color: string; icon: string }`
3. Read `packages/server/src/db.ts`. Add `tool_provider TEXT` column to the events table schema.
4. Read `packages/server/src/services/eventStore.ts`. In `normalizeHookPayload()`, detect MCP tools by parsing tool_name for `mcp__` prefix. Set `toolProvider` on the AgentEvent.
5. Read `packages/server/src/services/agentManager.ts`. In `handleStreamEvent()`, when processing `content_block_start` with `tool_use`, run the detection heuristic and set `toolProvider` on the broadcast event.
6. Read `apps/dashboard/src/store/eventHandlers.ts`. In `handleToolStart()`, copy `toolProvider` and `mcpServerName` from the AgentEvent to the new ToolCallSummary fields.

### Phase 2: Graph node rendering

1. Read `apps/dashboard/src/components/graph/nodes/ToolCallNode.tsx`. Currently uses only status-based colors.
2. Add: 3px left border colored by `getMcpServerColor()` when `toolProvider` starts with `'mcp:'`. No border for native tools.
3. Add: small badge/pill below tool name showing MCP server name. Only render for MCP tools.
4. Add: tooltip on hover showing full provider info.
5. Read `apps/dashboard/src/components/graph/nodes/AgentNode.tsx` for the vendor border pattern — replicate the same approach.

### Phase 3: Edge styling

1. Read `apps/dashboard/src/components/graph/edges/AnimatedEdge.tsx`.
2. When the target node is an MCP tool, use the server's accent color (at 40% opacity) instead of default blue.
3. Optional: longer dash pattern for MCP edges (accessibility — not color-only).

### Phase 4: Lens views

Work through each lens. Read each file first to understand the current rendering, then add provider awareness.

1. `apps/dashboard/src/components/lens/LensContext.tsx` — add `toolProvider?: string` to `LensTreeNode`
2. `apps/dashboard/src/components/lens/LensAdapter.tsx` — pass `toolProvider` through `makeLensNode()` for tool kind nodes
3. `apps/dashboard/src/components/lens/tree/TreeRow.tsx` — MCP badge inline
4. `apps/dashboard/src/components/lens/tree/TreeView.tsx` — filter toggle (All / Native / MCP)
5. `apps/dashboard/src/components/lens/heatmap/HeatmapView.tsx` — group-by-server option
6. `apps/dashboard/src/components/lens/treemap/TreemapView.tsx` — server accent colors for MCP rects
7. `apps/dashboard/src/components/lens/sankey/SankeyView.tsx` — optional 5th MCP Server layer
8. `apps/dashboard/src/components/lens/cost/CostWaterfallView.tsx` — provider badge on rows

### Phase 5: Detail panel + spawn dialog

1. Read `apps/dashboard/src/components/panels/AgentDetailPanel.tsx`. Add provider badge in tool call list. Show provider info in expanded tool detail.
2. Read `apps/dashboard/src/components/panels/SpawnAgentDialog.tsx`. Add "MCP Servers" section under Advanced options — UI to add server configs (command, args, env). Show as colored chips.

## Style Guidelines

- Dark theme throughout (bg grays in #161b22 / #1a1f2b range)
- Tailwind CSS 4 utility classes
- 11px/12px font sizes for badges and secondary text
- MCP badge style: small rounded pill, colored background at low opacity, colored text. Example: `bg-cyan-900/40 text-cyan-300 text-[10px] px-1.5 py-0.5 rounded-full`
- Follow existing patterns: look at how AgentNode renders vendor borders, how TreeRow renders kind icons, how Heatmap renders cell colors. Don't invent new patterns — extend existing ones.

## Testing

After implementation:
1. Start the servers: `.\start-server.ps1` and `.\start-client.ps1`
2. Run simulation: `npx tsx scripts/simulate_session.ts`
3. Verify native tools render exactly as before (no visual regression)
4. To test MCP rendering, either:
   - Modify the simulation script to include events with `mcp__notion__create_page` style tool names
   - Or POST a manual test event: `curl -X POST http://localhost:4000/api/events -H "Content-Type: application/json" -d '{"hook_event_name":"PreToolUse","session_id":"test-mcp","tool_name":"mcp__notion__create_page","tool_use_id":"tu_test1"}'`
5. Check all 6 lens views for correct MCP rendering
6. Verify build: `npm run build`
