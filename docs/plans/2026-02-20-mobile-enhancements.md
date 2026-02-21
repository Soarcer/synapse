# Mobile Enhancements: Session Selector, Analytics Tab, Pause/Resume

## Context

The mobile view currently lacks three features that would significantly improve the monitoring experience:
1. **Session selector** — all sessions' nodes are shown simultaneously with no way to focus on one
2. **Analytics summary** — no cost/token/model visibility; users must switch to desktop
3. **Pause/resume** — no way to freeze the graph while inspecting current state

All three exist on desktop. The goal is to bring them to mobile using **new mobile-only files** without modifying desktop or VS Code extension components.

---

## Feature 1: Pause/Resume Toggle

**Effort: Small (1 toggle)**

### What to change

**`apps/dashboard/src/components/mobile/MobileSettingsButton.tsx`** — add a Pause toggle:
- Read `paused` from `useAgentStore((s) => s.paused)`
- Add a `<Toggle label="Pause updates" checked={paused} onChange={...} />` after "Lock viewport"
- Action: `useAgentStore.getState().setPaused(v)`
- Events queue in `pauseQueue` while paused; replay on resume (existing store logic handles this)

**`apps/dashboard/src/components/mobile/MobileStatusBar.tsx`** — show paused indicator:
- Read `paused` from store
- When `paused === true`, show a yellow "Paused" badge inline next to connection status
- This gives visual feedback that live updates are frozen without opening settings

### No other files modified
- `setPaused` action already exists in `agentStore.ts` (line 433)
- `pauseQueue` buffering already works in `addEvent` (line 319)

---

## Feature 2: Session Selector

**Effort: Medium (new component + status bar integration)**

### New file: `apps/dashboard/src/components/mobile/MobileSessionSelector.tsx`

A native `<select>` dropdown (matches MobileLensPanel pattern) that:
- Reads `sessions` (Map), `filter`, `events` from `useAgentStore`
- Computes `sessionList` sorted by `startTime` desc (same logic as desktop `SessionSelector.tsx` lines 28-45)
- Each option shows: status (running/ended), relative time, duration, event count
- "All sessions" option (default) = `filter.sessionId: undefined`
- On change: calls `useAgentStore.getState().setFilter({ ...filter, sessionId })`
- Uses `formatRelativeTime` and `formatDuration` from `@synapse-ai/core`

### Integration in `MobileStatusBar.tsx`

- Import and render `<MobileSessionSelector />` below the token count in the **collapsed** status bar
- Only show when `sessions.size > 1` (no selector needed for a single session)
- Highlight when a specific session is selected (cyan text like desktop)

### Store dependency (existing, no changes needed)
- `filter: { sessionId?: string }` — `agentStore.ts` line 205
- `setFilter(filter)` — `agentStore.ts` line 374
- Note: `filter.sessionId` currently only affects export scope on desktop. The graph still shows all nodes. This is acceptable for mobile too — the selector acts as a **visual focus indicator** and scopes the analytics data. Graph-level filtering would require changes to `useVisibleGraph` which is shared with desktop and out of scope.

---

## Feature 3: Mobile Analytics Tab

**Effort: Medium-Large (new tab + new component)**

### Step 3a: Add 'analytics' tab to tab bar

**`apps/dashboard/src/components/mobile/MobileTabBar.tsx`**:
- Extend `MobileTab` union: `'graph' | 'lenses' | 'analytics'`
- Add tab entry: `{ id: 'analytics', label: 'Stats', icon: '\u2261' }` (hamburger/bars icon for stats)

**`apps/dashboard/src/components/mobile/MobileView.tsx`**:
- Import new `MobileAnalyticsView` (lazy-loaded)
- Add render branch: `{activeTab === 'analytics' && <Suspense><MobileAnalyticsView /></Suspense>}`

### Step 3b: Create `MobileAnalyticsView.tsx`

New file: `apps/dashboard/src/components/mobile/MobileAnalyticsView.tsx`

**Data source**: Reuse `useAnalyticsData` hook directly — it fetches from `/api/analytics/*` endpoints and handles loading/error/mock-data fallback. Pass time range from store's `timePresetLabel`.

**Layout** (vertical scroll, full width):

```
[ KPI Row: 2x2 grid ]
  - Total Cost ($xx.xx)     | Total Tokens (xxk)
  - Sessions (N)            | Tool Calls (N)

[ Token Breakdown Bar ]
  - input / output / cached segments

[ Model Breakdown ]
  - Horizontal list of ModelBadge + cost for each model

[ Session List ]
  - Scrollable list of recent sessions
  - Each row: status dot, relative time, model badge, cost, token count
  - Tap a session → set filter.sessionId (connects to session selector)

[ Loading / Error / Empty states ]
```

**Reusable imports from existing analytics/shared/**:
- `KpiCard` from `../analytics/shared/KpiCard` — works as-is, just use 2-column grid
- `TokenBreakdownBar` from `../analytics/shared/TokenBreakdownBar`
- `ModelBadge` from `../analytics/shared/ModelBadge`
- `fmtTokens` from `../analytics/shared/constants`
- `formatUsd` — from core or inline

**NOT importing** (too complex for mobile):
- Recharts charts (cost over time, tool usage bar chart, cache rate area chart)
- AI summary banner (requires API key, slow)
- Prompt analyzer, workshop, insights tabs

### Step 3c: Wire analytics data to time range

The `useAnalyticsData` hook accepts `{ timeRange: string }` filter. Map from the store's `timePresetLabel`:
- "Last hour" → '1h'
- "Last 4h" → '6h' (closest match)
- "Today" → '24h'
- "This week" → '7d'
- "Last 30 days" → '30d'
- "All time" → 'all'

This mapping lives in `MobileAnalyticsView.tsx` only — no desktop changes.

### Step 3d: Update barrel export

**`apps/dashboard/src/components/mobile/index.ts`**:
- Add: `export { MobileAnalyticsView } from './MobileAnalyticsView';`
- Add: `export { MobileSessionSelector } from './MobileSessionSelector';`

---

## Files Modified (mobile-only)

| File | Change |
|------|--------|
| `mobile/MobileSettingsButton.tsx` | Add pause toggle |
| `mobile/MobileStatusBar.tsx` | Add paused badge + session selector |
| `mobile/MobileTabBar.tsx` | Add 'analytics' to tab union + tab entry |
| `mobile/MobileView.tsx` | Add analytics tab render branch |
| `mobile/index.ts` | Export new components |

## New Files (all in `apps/dashboard/src/components/mobile/`)

| File | Purpose |
|------|---------|
| `MobileSessionSelector.tsx` | Native `<select>` dropdown for session filtering |
| `MobileAnalyticsView.tsx` | Compact KPI + token + model + session list view |

## Desktop/Extension Files NOT Modified

- `agentStore.ts` — no changes (all actions already exist)
- `SessionSelector.tsx` — untouched (desktop-only)
- `AnalyticsPage.tsx` — untouched (desktop-only)
- `useAnalyticsData.ts` — used as-is, no modifications
- All `apps/vscode/` files — untouched
- `useVisibleGraph.ts` — untouched

---

## Implementation Order

1. **Pause toggle** in MobileSettingsButton + paused badge in MobileStatusBar
2. **Session selector** component + integration in MobileStatusBar
3. **Analytics tab** — tab bar update, MobileAnalyticsView, MobileView wiring
4. **Build + restart** and verify all 3 features on phone
5. **Run tests** (`pnpm test`) to ensure no regressions

---

## Verification

1. **Pause/resume**: Open mobile, start a Claude session, tap gear → toggle Pause. Confirm status bar shows "Paused" badge. Confirm new events don't appear on graph. Toggle off → confirm queued events replay.
2. **Session selector**: Run 2+ sessions. Confirm dropdown shows in status bar. Select one session → confirm analytics tab scopes to it. Select "All sessions" → confirm reset.
3. **Analytics tab**: Tap Stats tab. Confirm KPI cards show cost, tokens, sessions, tool calls. Confirm token breakdown bar renders. Confirm model badges appear. Confirm session list is scrollable and tappable. Change time range in settings → confirm analytics data updates.
4. **Build**: `pnpm --filter @synapse-ai/dashboard build` succeeds with no type errors.
5. **Tests**: `pnpm test` passes with no regressions.

---

## Key Store Types & Actions (Reference)

### SessionData (from `@synapse-ai/core`)
```typescript
interface SessionData {
  sessionId: string;
  startTime: number;
  endTime?: number;
  agentCount: number;
  status: 'running' | 'ended';
  model?: string;
  source?: string;
  cwd?: string;
  vendor?: string;
}
```

### Store actions used (all existing, no changes needed)
```typescript
// Pause/resume
paused: boolean                    // store state
setPaused(paused: boolean)         // toggles pause, replays pauseQueue on resume

// Session filtering
filter: { sessionId?: string }     // store state
setFilter(filter)                  // sets filter object

// Analytics data
useAnalyticsData(filters)          // hook in analytics/useAnalyticsData.ts
  // filters: { timeRange: '1h'|'6h'|'24h'|'7d'|'30d'|'all', cwd?, sessionId? }
  // returns: { overview, timeseries, sessions, tools, models, isLoading, error }
```

### Reusable shared components (import paths from MobileAnalyticsView)
```typescript
import { KpiCard } from '../analytics/shared/KpiCard';
import { TokenBreakdownBar } from '../analytics/shared/TokenBreakdownBar';
import { ModelBadge } from '../analytics/shared/ModelBadge';
import { fmtTokens, MODEL_COLORS, MODEL_LABELS } from '../analytics/shared/constants';
```

### Desktop SessionSelector reference pattern (lines 28-45)
```typescript
const sessionList = useMemo(() => {
  const list = [...sessions.values()];
  list.sort((a, b) => b.startTime - a.startTime);
  const eventCounts = new Map<string, number>();
  for (const event of events) {
    eventCounts.set(event.sessionId, (eventCounts.get(event.sessionId) ?? 0) + 1);
  }
  return list.map((s) => ({
    ...s,
    duration: (s.endTime ?? Date.now()) - s.startTime,
    eventCount: eventCounts.get(s.sessionId) ?? 0,
    isRunning: s.status === 'running',
  }));
}, [sessions, events]);
```
