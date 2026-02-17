# Analytics V2 Implementation Prompt

Copy everything below the line into a new Claude Code session.

---

Implement the Analytics Dashboard v2 plan documented in `docs/ANALYTICS_V2_PLAN.md`. This is a HIGH EFFORT task with 8 phases.

## What was already done
- Analytics page restructured from 10 → 5 tabs (branch `fix/review-findings`)
- Current 5 tabs: Executive, Session Replay, Prompts, Insights, Live Nudges
- Shared components created: TokenBreakdownBar, ToolBadges, ModelBadge, constants.ts
- NudgeBadge overlay added to graph view
- All dead code from removed tabs deleted

## What to implement now

Read `docs/ANALYTICS_V2_PLAN.md` for the full plan. It has 8 phases:

1. **Phase 1 [XL]**: AI Coaching Backend — settingsService, aiCoachService (Haiku 4.5 via raw fetch), settings routes, settings UI. This unblocks phases 5-8.
2. **Phase 2 [L]**: Global Filtering — dual-handle time range slider, project dropdown (from cwd), session multi-select
3. **Phase 3 [S]**: UI Fixes — tooltip colors (white not black), scatter click-to-highlight, recommendation bullet lists, dimension tooltips, playbook rename to "Session Templates" + 3 built-in examples, reusable InfoTooltip component
4. **Phase 4 [M]**: Budget Tracker — auto-detect Claude plan from ~/.claude/, plan selector, usage vs plan limits
5. **Phase 5 [XL]**: AI-Enhanced Tabs — executive AI summary + ROI metrics, prompt AI analysis (score/rewrite/savings), actionable AI insights with session examples, report card AI recommendations
6. **Phase 6 [L]**: Session Replay — ArtifactPanel (files/tests/errors), MiniTimeline (SVG), AI session summary, Global/Focused chart toggle
7. **Phase 7 [M]**: Model Optimization — what-if calculator, concrete switching examples per turn, savings projections
8. **Phase 8 [XL]**: Live AI Coaching — aiNudgeEscalator, periodic checks every N tool calls, smart triggers (error spiral, cost spike), sensitivity config (Low/Medium/High), AI-enriched nudges

## Execution order

- Start with Phase 3 (quick wins, independent, immediate visual impact)
- Then Phase 1 (critical infrastructure for AI features)
- Then Phase 2 (filtering improves all tabs)
- Then Phase 4 (budget, independent)
- Then Phases 5, 6, 7 (depend on Phase 1)
- Finally Phase 8 (most complex, depends on everything)

## Key constraints

- Branch: `fix/review-findings`
- Servers: `.\start-server.ps1` (port 4000), `.\start-client.ps1` (port 5173)
- After each phase: run `pnpm test` and `npx tsc --noEmit -p apps/dashboard/tsconfig.json`
- Follow conventions in CLAUDE.md (dark theme, Recharts, Zustand empty array pattern, Zod at boundaries, pino logging, no `any`)
- Graceful degradation: all AI features must work without API key (show "configure in Settings" message, fall back to rule-based)
- Existing pre-existing test failure in `coachingRoutes.test.ts` (playbook test isolation) — ignore it

## Key files to read first
- `docs/ANALYTICS_V2_PLAN.md` — the full plan (READ THIS FIRST)
- `CLAUDE.md` — project conventions
- `apps/dashboard/src/components/analytics/AnalyticsPage.tsx` — tab structure
- `apps/dashboard/src/components/analytics/useAnalyticsData.ts` — data fetching hook
- `packages/server/src/db.ts` — database schema
- `packages/server/src/services/nudgeEngine.ts` — existing 8 rule-based detectors
- `packages/server/src/services/reportCardEngine.ts` — 40+ coaching detectors
- `packages/server/src/app.ts` — route mounting
- `apps/dashboard/src/store/agentStore.ts` — Zustand store (has cwd filter state already)
