# Implementation Prompt: Mobile/Desktop View Separation

> Paste this into a new Claude Code session to execute the plan.

---

## Task

Implement the mobile/desktop view separation for the Synapse dashboard. The full reviewed plan is at `docs/plans/spicy-baking-frost.md` (also saved as `.claude/plans/spicy-baking-frost.md`). The original design documents are at `docs/plans/2026-02-20-mobile-responsive-design.md` and `docs/plans/2026-02-20-mobile-responsive-plan.md`.

**Read the plan file first** — it contains the reviewed architecture, all 10 review findings that must be addressed, and the exact implementation steps.

**Important constraints from the review:**

- Do NOT add `mobile: boolean` to `LensContext`, `LensPanel`, `HeatmapView`, `TreemapView`, or `SankeyView`. Those files stay untouched. The `children` prop approach on `LensAdapter` is the correct architecture.
- Do NOT feed raw nodes to `MobileGraphView`. You must extract the visibility memo (tool grouping, search filtering, auto-close) from `AgentGraph.tsx` lines 75-218 into a shared `useVisibleGraph` hook first. Mobile will choke on 500+ raw nodes without this.
- MobileGraphView needs its own `toolGroupDims` state + `onNodesChange` callback (same pattern as AgentGraph lines 558-590) and its own `expandedParentId` computation (AgentGraph lines 57-71).
- Tab bar must be `z-60`. Bottom sheet backdrop must stop above tab bar (`bottom: 56px`). iOS viewport uses `h-dvh` not `h-screen`. Bottom sheet needs rAF cleanup on unmount + `onTouchCancel`. MobileStatusBar computations must use `useMemo`.
- Add `visibilitychange` listener in MobileView to reconnect WS on phone wake.

## How to work

Start building from **Step 1**. Work through each step one at a time — fully finish and verify each one works before moving on to the next. Don't skip ahead or batch steps together. After each step, confirm what you built and that it's working before continuing.

The 8 steps are:

1. **Extract `useVisibleGraph` hook** — Move AgentGraph.tsx lines 75-218 into `hooks/useVisibleGraph.ts`. Update AgentGraph to use it. Run `pnpm test`. Desktop must render identically.

2. **Viewport + App.tsx plumbing** — Update `index.html` viewport meta. Add `'mobile'` to ViewMode union, `getViewMode()` auto-detection (`pointer: coarse` + `max-width: 1024px` + `maxTouchPoints > 0`), mobile WS connect condition, skip VS Code postMessage/keyboard effects for mobile, early return in keyboard handler. Lazy import + render branch with `h-dvh` container. Create stub `MobileView.tsx`. Run `pnpm --filter @synapse-ai/dashboard build`. Verify `?view=mobile` shows placeholder.

3. **MobileTabBar + MobileStatusBar** — Create `MobileTabBar.tsx` (3 tabs, `z-60`, safe-area padding) and `MobileStatusBar.tsx` (expandable, memoized metrics). Wire into MobileView. Verify tabs switch.

4. **MobileBottomSheet** — Snap points closed/peek/full, rAF cleanup + `onTouchCancel`, backdrop stops above tab bar, `[&>div]:w-full` to override PanelShell width, renders `AgentDetailPanel`. Wire into MobileView.

5. **MobileGraphView + MobileSearchButton** — Own `ReactFlowProvider`, calls `useVisibleGraph` with mobile defaults (`showAllTools: false`, `autoClosePrompts: true`, `collapsedNodes: EMPTY_SET`). Own `toolGroupDims` state + `onNodesChange`. Own `expandedParentId`. Filters `__spawn__`, empty state, `touch-action: none`. `MobileSearchButton` as floating icon → input. Lazy load in MobileView.

6. **LensAdapter children prop + MobileLensPanel + MobileLensView** — Add `children` prop to `LensAdapter` (backward-compatible, 5 lines). Create `MobileLensPanel.tsx` (native `<select>` dropdown, renders existing view components full-width). Create `MobileLensView.tsx` wrapping `<LensAdapter fillWidth><MobileLensPanel /></LensAdapter>`.

7. **Pixel tab + WS wake handler + final assembly** — Wire PixelPage lazy into pixel tab. Add `visibilitychange` listener for WS reconnect on wake. Final MobileView with all 3 tabs, suspense boundaries, only active tab mounted. Barrel `index.ts`.

8. **Build + test verification** — `pnpm test` (all pass), `pnpm --filter @synapse-ai/dashboard build` (clean), then report the verification checklist results.

## Key files to read before starting

Read these files to understand the current code before making changes:

- `apps/dashboard/src/App.tsx` — view mode dispatch, keyboard shortcuts, WS connect
- `apps/dashboard/src/components/graph/AgentGraph.tsx` — the visibility memo (lines 75-218) you'll extract, toolGroupDims (lines 42-44, 558-590), expandedParentId (lines 57-71)
- `apps/dashboard/src/hooks/useAutoLayout.ts` — layout hook signature (line 391-394)
- `apps/dashboard/src/components/lens/LensAdapter.tsx` — current signature (line 315), return (lines 444-448)
- `apps/dashboard/src/components/lens/LensPanel.tsx` — DO NOT MODIFY this file
- `apps/dashboard/src/components/lens/LensContext.tsx` — DO NOT MODIFY this file
- `apps/dashboard/src/components/panels/AgentDetailPanel.tsx` — reused in bottom sheet (note PanelShell `w-80` at ~line 892)
- `apps/dashboard/src/store/agentStore.ts` — store selectors used by mobile components
- `apps/dashboard/src/store/wsClient.ts` — WS client for reconnect handling
- `apps/dashboard/src/hooks/useBreakpoint.ts` — existing breakpoint hook (not used by mobile, FYI only)
- `apps/dashboard/src/components/graph/nodeTypes.ts` — shared node/edge types
- `apps/dashboard/src/utils/graphSearch.ts` — `nodeMatchesSearch`, `buildParentMap`, `collectAncestors`, `buildChildrenMap` used by the visibility hook
- `apps/dashboard/index.html` — viewport meta tag
- `apps/dashboard/src/components/pixel/PixelPageLazy.tsx` — lazy export for pixel scene

Also read the reference implementations in the original plan for component code:

- `docs/plans/2026-02-20-mobile-responsive-plan.md` — Tasks 2-6 have complete code for MobileTabBar, MobileStatusBar, MobileBottomSheet, MobileGraphView, MobileSearchButton, MobileLensView

**Use those as starting points but apply the review fixes** (z-index, dvh, rAF cleanup, memoization, useVisibleGraph instead of raw nodes, children prop instead of mobile boolean, backdrop clipping, etc.).
