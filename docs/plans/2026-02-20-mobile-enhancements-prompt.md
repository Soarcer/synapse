# Implementation Prompt: Mobile Enhancements

Implement the 3 mobile features described in `docs/plans/2026-02-20-mobile-enhancements.md`. Read that file first for the full plan, store types, reusable imports, and reference patterns.

## Critical constraints

- **Do NOT modify any desktop or VS Code extension files.** All changes go in `apps/dashboard/src/components/mobile/` only. The store actions (`setPaused`, `setFilter`), the `useAnalyticsData` hook, and the shared analytics components (`KpiCard`, `TokenBreakdownBar`, `ModelBadge`, `fmtTokens`) are all imported as-is — never modified.
- Match existing mobile component conventions: SPDX license headers, `useAgentStore` for store access, dark theme colors (`bg-[#161b22]`, `border-gray-800`, `text-gray-400`), `text-xs`/`text-[10px]` sizing.
- The `MobileSessionSelector` should use a native `<select>` element (same pattern as the lens dropdown in `MobileLensPanel.tsx`).
- The `MobileAnalyticsView` should NOT import Recharts or any chart components — keep it lightweight with just KPI cards, token breakdown bar, model badges, and a session list.

## Implementation steps

### Step 1: Pause/Resume Toggle
1. In `MobileSettingsButton.tsx`: add `const paused = useAgentStore((s) => s.paused)` and a `<Toggle label="Pause updates" checked={paused} onChange={(v) => useAgentStore.getState().setPaused(v)} />` after the Lock viewport toggle.
2. In `MobileStatusBar.tsx`: add `const paused = useAgentStore((s) => s.paused)` and render a yellow "Paused" badge next to the connection status label when `paused === true`.

### Step 2: Session Selector
1. Create `MobileSessionSelector.tsx` — a native `<select>` dropdown. Read `sessions`, `filter`, `events` from the store. Compute a sorted session list (newest first) with event counts. Options: "All sessions" + each session with status/time/duration/events. On change: `setFilter({ ...filter, sessionId })`. Use `formatRelativeTime` and `formatDuration` from `@synapse-ai/core`.
2. In `MobileStatusBar.tsx`: import and render `<MobileSessionSelector />` in the collapsed bar after the token count. Only show when `sessions.size > 1`.

### Step 3: Analytics Tab
1. In `MobileTabBar.tsx`: extend `MobileTab` to `'graph' | 'lenses' | 'analytics'`. Add tab: `{ id: 'analytics', label: 'Stats', icon: '\u2261' }`.
2. Create `MobileAnalyticsView.tsx`:
   - Use `useAnalyticsData({ timeRange, sessionId: filter.sessionId })` where `timeRange` is mapped from `timePresetLabel` ("Last hour"→'1h', "Last 4h"→'6h', "Today"→'24h', "This week"→'7d', "All time"→'all').
   - Layout: 2x2 KpiCard grid (cost, tokens, sessions, tools) → TokenBreakdownBar → model badges row → scrollable session list.
   - Session list rows: status dot, relative time, model badge, cost, token count. Tap → `setFilter({ sessionId })`.
   - Handle loading/error/empty states.
3. In `MobileView.tsx`: lazy-import `MobileAnalyticsView`, add render branch for `activeTab === 'analytics'`.
4. In `index.ts`: export `MobileAnalyticsView` and `MobileSessionSelector`.

### Step 4: Build & Verify
1. `pnpm --filter @synapse-ai/dashboard build` — must succeed with no type errors.
2. Kill the running server process and restart: `npx tsx packages/server/src/index.ts`.
3. `pnpm test` — all tests must pass.
4. Manual verification on phone at `http://<local-ip>:4000`:
   - Gear menu → Pause toggle works, status bar shows "Paused" badge
   - Session selector appears when multiple sessions exist
   - Stats tab shows KPIs, token bar, model badges, session list
   - Time range in settings affects analytics data
