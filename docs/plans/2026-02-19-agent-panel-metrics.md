# Enhance Agent Detail Panel to Match Prompt Panel Richness

## Context

The prompt detail panel (`PromptDetailView`) has rich computed metrics — cost, token breakdown bar, tool badges, model badge, cache hit rate — displayed via `MetricCard` grid and visual components. The agent detail panel is comparatively basic: raw input/output token numbers via `Stat`, a plain tool call list, and no computed metrics. Both panels live in the same file and share the same building blocks (`PanelShell`, `Detail`, `Stat`, `Divider`, `MetricCard`, `TokenBreakdownBar`, `ToolBadges`, `ModelBadge`). The goal is to bring the agent panel's information density up to match the prompt panel, while keeping the agent-specific features (streaming text, send message, stop/remove controls, individual tool list).

## Side-by-Side Comparison

| Feature | Prompt Panel | Agent Panel |
|---------|:---:|:---:|
| MetricCard grid (Cost, Tokens, Cache, Latency) | Yes | **No** |
| TokenBreakdownBar | Yes | **No** |
| Tool Badges (aggregated summary) | Yes | **No** |
| Model Badge | Yes | **No** |
| Header status/type badge | Category pill | **No** |
| Individual tool call list | No | Yes (keep) |
| Streaming text | No | Yes (keep) |
| Send message / Stop controls | No | Yes (keep) |
| Children token rollup | No | Yes (keep) |

## Implementation Plan

### File: `apps/dashboard/src/components/panels/AgentDetailPanel.tsx`

All changes are in the agent detail view section (lines 553–707).

#### 1. Add header status badge (title right)

Change `PanelShell` from:
```tsx
<PanelShell title={agent.agentType} onClose={() => selectNode(null)}>
```
To include a `titleRight` with a status-colored badge (matching StatusBadge style) and optional vendor/model chip:
```tsx
<PanelShell
  title={agent.agentType}
  titleRight={<StatusBadge status={agent.status} />}
  onClose={() => selectNode(null)}
>
```

#### 2. Add computed metrics block (after basic info, before tool list)

Compute derived metrics from `agent.tokenUsage` + child agents (already computed inline for the rollup). Use the same utilities already imported for the prompt panel:

- `computeCostUsd(input, output, cacheRead, model)` — from `promptUtils.ts`
- `computeCacheRate(input, cacheRead)` — from `promptUtils.ts`
- `fmtTokens()` — from `constants.ts`

**Metrics to show** (2-col `MetricCard` grid):
| Card | Value | Condition |
|------|-------|-----------|
| Cost | `$X.XXXX` | `totalTokens > 0` |
| Total Tokens | formatted count | `totalTokens > 0` |
| Cache Hit | `XX%` | `totalTokens > 0` |
| Duration | `Xs` / `Xm` | always |
| Tools | count | `agent.toolCalls.length > 0` |
| Children | count | `childAgents.length > 0` |

#### 3. Add TokenBreakdownBar (after metric cards)

Reuse the existing `TokenBreakdownBar` component (already imported for prompt panel). Gate on `totalTokens > 0`. Data comes from `agent.tokenUsage` (self) merged with child agent totals.

#### 4. Add Tool Badges summary (after token bar, before individual tool list)

Reuse `ToolBadges` component (already imported). Compute `toolNames` and `toolCounts` from `agent.toolCalls` the same way the prompt panel does:
```ts
const toolCountMap = new Map<string, number>();
for (const tc of agent.toolCalls) {
  toolCountMap.set(tc.toolName, (toolCountMap.get(tc.toolName) ?? 0) + 1);
}
```

#### 5. Add Model Badge (after tool badges)

Reuse `ModelBadge` component (already imported). Show when `agent.model` is available.

#### 6. Refactor: extract agent metrics into a useMemo

The current agent panel computes child agent tokens inside an IIFE `(() => {...})()` at render time. Refactor this into a `useMemo` that computes all metrics at once (cost, cache rate, total tokens, child rollup, tool summary). This mirrors the prompt panel's `metrics` useMemo pattern.

This requires extracting the agent detail section into its own component (like `PromptDetailView` was extracted) so that hooks can be used. Currently it's inline in the main `AgentDetailPanel` function body with early returns above it.

### Extraction approach

Extract a new `AgentDetailView` component with props:
```ts
{ agent, agents, selectNode, onRemove, onStop, onSendMessage, dialogs }
```

This is the same pattern used for `PromptDetailView` — keep the main component as a router that delegates to type-specific views.

## Existing utilities to reuse (no new code needed)

- `MetricCard` — `AgentDetailPanel.tsx:1066`
- `TokenBreakdownBar` — `apps/dashboard/src/components/analytics/shared/TokenBreakdownBar.tsx`
- `ToolBadges` — `apps/dashboard/src/components/analytics/shared/ToolBadges.tsx`
- `ModelBadge` — `apps/dashboard/src/components/analytics/shared/ModelBadge.tsx`
- `computeCostUsd` — `apps/dashboard/src/components/analytics/shared/promptUtils.ts`
- `computeCacheRate` — `apps/dashboard/src/components/analytics/shared/promptUtils.ts`
- `fmtTokens` — `apps/dashboard/src/components/analytics/shared/constants.ts`
- `StatusBadge` — `AgentDetailPanel.tsx:801`

## Layout order (top to bottom)

1. **Header**: agent type + status badge
2. **Basic info**: Status, Duration, Agent ID, Session, Parent, Started/Ended (unchanged)
3. **Divider**
4. **MetricCard grid** (2-col): Cost, Total Tokens, Cache Hit, Duration, Tools, Children
5. **TokenBreakdownBar** (if tokens > 0)
6. **Tool Badges** (if tools > 0) + **Model Badge** (if model known)
7. **Divider**
8. **Children token rollup** (if children exist) — keep existing, but move below metrics since the summary cards already show aggregate
9. **Tool call list** (unchanged — clickable individual tools)
10. **Streaming text** (unchanged)
11. **Actions footer**: Send message, Stop, Remove (unchanged)

## Verification

1. `pnpm test` — all existing tests pass
2. Run simulation: `npx tsx scripts/simulate_all_nodes.ts`
3. Click an agent node → verify MetricCard grid, TokenBreakdownBar, ToolBadges, ModelBadge all render
4. Click agent with no token data → verify graceful degradation (no token cards, but tool badges and duration still show)
5. Click running agent → verify Send/Stop controls still work
6. Click agent with children → verify children rollup still shows
