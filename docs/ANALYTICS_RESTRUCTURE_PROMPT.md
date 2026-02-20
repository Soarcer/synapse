# Session Prompt: Analytics Restructuring

Copy everything below the line into a new Claude Code session.

---

## Task: Implement Analytics Tab Restructuring (10 → 5 tabs)

Read `docs/ANALYTICS_RESTRUCTURE.md` for the full plan, decision log, and phased implementation guide. This was scored and approved interactively. The rollback tag is `v0.9.0-pre-restructure`.

### What to do

Consolidate the analytics page from 10 tabs to 5. Execute the 6 phases in order:

**Phase 1 — Remove cut tabs**: Delete `DeepDiveExplorer`, `ComparisonLab`, `WhatIfCalculator`, `TokenVelocityView`, `ToolChainView` components. Update `AnalyticsPage.tsx` to remove their imports and TABS entries. Keep only: Executive, Session Replay, Prompt Analyzer, Insights, Live Nudges. Verify the page renders with the 5 remaining tabs.

**Phase 2 — Extract shared components**: Create `analytics/shared/TokenBreakdownBar.tsx`, `ToolBadges.tsx`, and `ModelBadge.tsx` by extracting the duplicated UI from `SessionReplay.tsx` and `PromptAnalyzer.tsx`. Both components have nearly identical token breakdown bars, tool badge rendering, and model badge rendering. Refactor both to use the shared versions. Verify no visual regression.

**Phase 3 — Merge Coach into Insights**: The Insights tab (`insights/InsightsView.tsx`) needs to absorb content from the Coach tab. Add these sections:
- **Report card summary** — Use `useCoachingData` hook to fetch report card data. Show scores/badges. Degrade gracefully when transcripts are unavailable (show "transcript unavailable" message, not an error).
- **Playbook management** — Port from `coaching/PlaybookPanel.tsx`. Allow viewing/creating/deleting playbooks.
- **Model optimization card** — Port the pricing comparison from `whatif/WhatIfCalculator.tsx` as an insight card showing "you could save X% by switching to model Y".
- **Budget tracker** — Already partially in InsightsView, ensure it's prominent.
Layout: sectioned page with insight cards grid on top, report card + playbooks in middle, model advisor + budget at bottom. Each section should be collapsible.

**Phase 4 — Create Live Nudges tab**: Create `analytics/nudges/LiveNudgesView.tsx` as a new dedicated tab. Contents:
- Nudge history timeline (from `coaching/NudgePanel.tsx`, adapted)
- Configuration UI: toggle individual nudge rules on/off, adjust thresholds (bash-streak count, file-reread threshold, latency threshold, etc.)
- Nudge effectiveness stats (fire count, dismiss rate, rule breakdown)
- Add server endpoint `GET /api/analytics/coaching/nudges/stats` for aggregate stats
Wire into `AnalyticsPage.tsx` as the 5th tab.

**Phase 5 — Graph view nudge integration**: Add live nudge delivery to the graph view during active sessions. The nudge engine already broadcasts via WebSocket (`packages/server/src/services/nudgeEngine.ts`). On the frontend:
- Listen for nudge events in the WebSocket handler (in `agentStore.ts` or a new hook)
- Show a toast/badge overlay in the graph view when a nudge fires
- Nudges should be dismissible and non-blocking
- Optionally add a nudge indicator badge on relevant graph nodes

**Phase 6 — Cleanup and testing**: Remove dead imports, unused coaching components that were fully merged. Update `apps/dashboard/e2e/analytics-tabs.spec.ts` to reflect the 5-tab structure. Run `pnpm test` and fix any failures. Verify mock data still works for all tabs.

### Key files to read first

- `docs/ANALYTICS_RESTRUCTURE.md` — The full plan (READ THIS FIRST)
- `apps/dashboard/src/components/analytics/AnalyticsPage.tsx` — Tab orchestrator (133 lines)
- `apps/dashboard/src/components/analytics/insights/InsightsView.tsx` — Insights tab (596 lines, will grow)
- `apps/dashboard/src/components/analytics/coaching/CoachingView.tsx` — Coach tab being merged (386 lines)
- `apps/dashboard/src/components/analytics/coaching/useCoachingData.ts` — Coaching data hook (114 lines)
- `apps/dashboard/src/components/analytics/replay/SessionReplay.tsx` — Has shared UI to extract (524 lines)
- `apps/dashboard/src/components/analytics/prompts/PromptAnalyzer.tsx` — Has shared UI to extract (443 lines)
- `packages/server/src/services/nudgeEngine.ts` — Nudge detection engine (288 lines)
- `packages/server/src/routes/coaching.ts` — Coaching API routes (199 lines)

### Conventions

- All shared types live in `@synapse-ai/core` — never use relative cross-package imports
- No `any` types — use `unknown` with type guards
- Zustand gotcha: `?? []` inside selectors causes infinite re-renders. Use module-level `const EMPTY: T[] = []`
- Dark theme: backgrounds are `#0d1117` (page) and `#161b22` (cards), borders `gray-800`
- Chart library: recharts (already installed)
- Run `pnpm test` after each phase to catch regressions early
- Start the dev server with `pnpm --filter dashboard dev` (port 5173) and backend with `npx tsx packages/server/src/index.ts` (port 4000)

### Definition of done

- [ ] Analytics page shows exactly 5 tabs: Executive, Session Replay, Prompts, Insights, Live Nudges
- [ ] No dead imports or references to removed components
- [ ] Insights tab includes: insight cards, report card summary, playbook management, model optimization, budget tracker
- [ ] Live Nudges tab shows history, configuration, and stats
- [ ] Graph view shows nudge toasts during live sessions
- [ ] Shared components extracted (TokenBreakdownBar, ToolBadges, ModelBadge)
- [ ] Session Replay and Prompt Analyzer use shared components
- [ ] Report card degrades gracefully when transcripts are missing
- [ ] e2e tests updated for 5-tab structure
- [ ] `pnpm test` passes
- [ ] No TypeScript errors (`pnpm -r build` or `tsc --noEmit`)
