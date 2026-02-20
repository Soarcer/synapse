# System Metrics Monitoring — Implementation Plan

**Date**: 2026-02-18
**Branch**: fix/review-findings
**Research**: [docs/SYSTEM_METRICS_RESEARCH.md](../SYSTEM_METRICS_RESEARCH.md)
**Status**: Planned (not yet implemented)

## Context

Synapse has rich API-level observability (tokens, cost, duration, cache hit rate, efficiency scoring) but **zero machine-level observability**. We cannot correlate resource-heavy tool calls with CPU/memory spikes, detect event loop starvation in the server, or see how much RAM a Claude Code session actually consumes. This plan adds real-time system metrics collection, persistence, and visualization as a new "Sys" lens tab.

**Scope decisions**:
- GPU monitoring: **deferred** (NVIDIA-only, adds complexity)
- Persistence: **full** (SQLite + rollups + REST endpoint)
- PID discovery: **modify hook script** (add `process.ppid`)
- External dependency: **one** — `pidusage` (36 KB, 0 deps)

## New Dependency

```
pidusage@^3.0.2  →  packages/server/package.json
```

36 KB, zero dependencies, 3M weekly downloads. Cross-platform per-PID CPU/memory via procfs (Linux), ps (macOS), wmic (Windows). Lazily imported so server starts even if missing.

**Risk**: `pidusage` and `pidtree` use `wmic.exe` on Windows, which is being removed in Windows 11 25H2 (2026). Monitor upstream for PowerShell migration or prepare a fallback.

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│  Claude Code Process (PID discovered via hook ppid)         │
│  └─ hook script → POST /api/events { ..., ppid: N }        │
└────────────────────────────┬────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────┐
│  Synapse Server                                             │
│                                                             │
│  ┌──────────────────┐  ┌────────────────┐                  │
│  │ eventStore.ts     │  │ MetricsCollector│                  │
│  │ extracts ppid     │→ │ polls pidusage  │                  │
│  │ on session_start  │  │ + os module     │                  │
│  └──────────────────┘  │ + perf_hooks    │                  │
│                         └───────┬────────┘                  │
│                                 │ onSample()                │
│                         ┌───────▼────────┐                  │
│                         │ broadcaster.ts  │                  │
│                         │ broadcastMetrics│                  │
│                         └───────┬────────┘                  │
│                                 │                           │
│  ┌──────────────────┐          │  ┌────────────────┐       │
│  │ db.ts             │◄─────────┤  │ /api/metrics   │       │
│  │ metric_samples    │          │  │ (REST query)   │       │
│  │ metric_rollups_1m │          │  └────────────────┘       │
│  └──────────────────┘          │                           │
└────────────────────────────────┼───────────────────────────┘
                                 │ WS: { type: 'metrics' }
                                 ▼
┌─────────────────────────────────────────────────────────────┐
│  Dashboard (React)                                          │
│                                                             │
│  agentStore.ts                                              │
│  ├─ metricsSamples: MetricSample[] (ring buffer, 300 max)  │
│  └─ addMetricsSamples()                                     │
│                                                             │
│  Lens Tab "Sys" (key 7)                                     │
│  ├─ KPI row: CPU %, Memory, Event Loop delay                │
│  ├─ CPU chart (Recharts AreaChart — system + process)       │
│  ├─ Memory chart (server RSS + process)                     │
│  └─ Monitored processes table                               │
└─────────────────────────────────────────────────────────────┘
```

### Key Constraint: Subagents Are Threads

Claude Code's Task tool spawns subagents as **threads** (async API call loops) within the same Node.js process — NOT separate OS processes. We can only monitor the aggregate Claude Code process. Individual subagent attribution requires time-window correlation with `SubagentStart`/`SubagentStop` events.

---

## Implementation Steps

### Step 1 — Core types and schema (`@synapse-ai/core`)

**New file**: `packages/core/src/types/metrics.ts`

```ts
export interface MetricSample {
  timestamp: number;        // epoch ms
  sessionId?: string;       // null for system-only samples
  server: {
    heapUsedMB: number;
    heapTotalMB: number;
    rssMB: number;
    cpuUser: number;        // microseconds delta since last sample
    cpuSystem: number;
    eventLoopDelayMs: number; // p99 from perf_hooks histogram
  };
  system: {
    cpuPercent: number;     // 0-100
    memoryUsedMB: number;
    memoryTotalMB: number;
    loadAvg1m: number;      // 0 on Windows
  };
  process?: {               // present only when PID is tracked
    pid: number;
    cpuPercent: number;
    memoryMB: number;
    elapsed: number;
  };
}

export interface MetricRollup {
  bucketStart: number;
  sessionId?: string;
  sampleCount: number;
  avgServerRssMB: number;
  avgServerElDelayMs: number;
  avgSystemCpuPercent: number;
  avgSystemMemoryUsedMB: number;
  maxSystemCpuPercent: number;
  maxSystemMemoryUsedMB: number;
  avgProcessCpuPercent?: number;
  avgProcessMemoryMB?: number;
}

export interface MetricsQuery {
  sessionId?: string;
  from?: number;
  to?: number;
  resolution?: 'raw' | '1m';
  limit?: number;
}
```

**Modify**: `packages/core/src/types/agent.ts`
- Extend `WsServerMessage` union: `| { type: 'metrics'; data: MetricSample[] }`
- Extend `WsClientMessage` union: `| { type: 'metrics:subscribe'; resolution?: number } | { type: 'metrics:unsubscribe' }`

**Modify**: `packages/core/src/schemas.ts`
- Add `MetricsQuerySchema` (Zod: sessionId optional, from/to coerced ints, resolution enum, limit 1..5000)

**Modify**: `packages/core/src/index.ts`
- Export new types and schema

### Step 2 — Hook script PID injection

**Modify**: `hooks/send_event.cjs` (line ~57, after `JSON.parse(body)`)

```js
const parsed = JSON.parse(body);
parsed.ppid = process.ppid;  // Claude Code's PID (parent of hook)
const enrichedBody = JSON.stringify(parsed);
// Use enrichedBody in fetch() call
```

One-line addition. `process.ppid` is a built-in Node.js property — the hook runs as a child of Claude Code, so ppid = Claude Code PID.

### Step 3 — Database tables and helpers

**Modify**: `packages/server/src/db.ts`

Add two new tables in `initDb()`:

```sql
-- Raw samples (kept 1 hour, then rolled up)
CREATE TABLE IF NOT EXISTS metric_samples (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  timestamp INTEGER NOT NULL,
  session_id TEXT,
  server_heap_mb REAL,
  server_rss_mb REAL,
  server_cpu_user INTEGER,
  server_cpu_system INTEGER,
  server_el_delay_ms REAL,
  system_cpu_percent REAL,
  system_memory_used_mb REAL,
  system_memory_total_mb REAL,
  process_pid INTEGER,
  process_cpu_percent REAL,
  process_memory_mb REAL
);

-- 1-minute rollups (kept 7 days)
CREATE TABLE IF NOT EXISTS metric_rollups_1m (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  bucket_start INTEGER NOT NULL,
  session_id TEXT,
  sample_count INTEGER DEFAULT 0,
  avg_server_rss_mb REAL,
  avg_server_el_delay_ms REAL,
  avg_system_cpu_percent REAL,
  avg_system_memory_used_mb REAL,
  max_system_cpu_percent REAL,
  max_system_memory_used_mb REAL,
  avg_process_cpu_percent REAL,
  avg_process_memory_mb REAL,
  UNIQUE(bucket_start, session_id)
);
```

Add exported helpers following existing patterns:
- `insertMetricSample(sample: MetricSample)` — parameterized INSERT + scheduleSave()
- `queryMetricSamples(params)` — dynamic WHERE clause, ORDER BY timestamp ASC, LIMIT
- `queryMetricRollups(params)` — same pattern for rollup table
- `rollupAndPurgeMetrics()` — aggregate raw > 10 min into 1m buckets, purge raw > 1 hr, purge rollups > 7 days

### Step 4 — MetricsCollector service

**New file**: `packages/server/src/services/metricsCollector.ts`

ES6 class with lifecycle (matches `Broadcaster` pattern):

```
Constructor: init event loop histogram (perf_hooks), capture initial CPU baseline
trackPid(sessionId, pid): start monitoring a Claude Code process
untrackPid(sessionId): stop monitoring
subscribe(): increase subscriber count, switch to 1s polling
unsubscribe(): decrease subscribers, revert to 5s or stop
collect(): async — gather server self-metrics + system-wide + per-PID via pidusage
destroy(): stop all timers, disable histogram, clear state
```

Key design:
- **Adaptive polling**: 5s default → 1s when subscribers > 0 → off when no PIDs and no subscribers
- **pidusage lazy import**: `await import('pidusage')` with try/catch — graceful degradation if not installed
- **System CPU**: computed from `os.cpus()` deltas (idle vs total across all cores)
- **Event loop delay**: `monitorEventLoopDelay({ resolution: 20 })` → p99 in ms, reset each sample
- **onSample callback**: constructor option, called with `MetricSample[]` each poll cycle
- **Timer.unref()**: timers don't prevent Node.js from exiting

### Step 5 — PID extraction from events

**Modify**: `packages/server/src/services/eventStore.ts`

Add module-level setter for MetricsCollector (avoids circular deps):

```ts
import type { MetricsCollector } from './metricsCollector.js';
let _mc: MetricsCollector | null = null;
export function setMetricsCollector(mc: MetricsCollector): void { _mc = mc; }
```

In `storeAndBroadcast()`, after normalization (line ~180):
```ts
if (event.type === 'session_start' && typeof raw.ppid === 'number') {
  _mc?.trackPid(event.sessionId, raw.ppid);
}
if (event.type === 'session_end') {
  _mc?.untrackPid(event.sessionId);
}
```

### Step 6 — Broadcaster extension

**Modify**: `packages/server/src/services/broadcaster.ts`

Add one method after existing `broadcastText()`:

```ts
broadcastMetrics(samples: MetricSample[]): void {
  if (this.clients.size === 0) return;
  const payload = JSON.stringify({ type: 'metrics', data: samples });
  for (const client of this.clients) this.safeSend(client, payload);
}
```

### Step 7 — REST endpoint

**New file**: `packages/server/src/routes/metrics.ts`

Router factory following existing pattern:
- `GET /api/metrics` — validates with `MetricsQuerySchema`
- Auto-selects rollups when `resolution=1m` or time range > 10 min
- Returns `{ resolution: 'raw'|'1m', data: [...] }`

**Modify**: `packages/server/src/app.ts`
- Import and register: `app.use('/api/metrics', createMetricsRouter())`

### Step 8 — Server wiring

**Modify**: `packages/server/src/index.ts`

```ts
// After broadcaster + agentManager creation:
const metricsCollector = new MetricsCollector({
  onSample: (samples) => {
    for (const s of samples) insertMetricSample(s);
    broadcaster.broadcastMetrics(samples);
  },
});
setMetricsCollector(metricsCollector);

// Rollup timer (every 5 min):
const rollupTimer = setInterval(() => rollupAndPurgeMetrics(), 5 * 60_000);
if (rollupTimer.unref) rollupTimer.unref();

// In wss.on('connection'): handle metrics:subscribe / metrics:unsubscribe messages
// In ws.on('close'): call metricsCollector.unsubscribe()
// In shutdown(): metricsCollector.destroy(), clearInterval(rollupTimer)
```

### Step 9 — Frontend store

**Modify**: `apps/dashboard/src/store/agentStore.ts`

New state:
```ts
metricsEnabled: boolean;       // default true, persisted to localStorage
metricsSamples: MetricSample[]; // ring buffer, max 300
```

New actions:
```ts
setMetricsEnabled(enabled: boolean): void;
addMetricsSamples(samples: MetricSample[]): void;  // append + trim to 300
```

WS subscription: managed by the SystemMetricsView component via `wsClient.send()` on mount/unmount.

In WS message handler (where `msg.type === 'event'` etc.):
```ts
} else if (msg.type === 'metrics') {
  useAgentStore.getState().addMetricsSamples(msg.data);
}
```

In `clearEvents`: also clear `metricsSamples: []`.

### Step 10 — System Metrics lens tab

**Modify**: `apps/dashboard/src/components/lens/LensContext.tsx`
- Add `'sys'` to `LensTab` union

**Modify**: `apps/dashboard/src/components/lens/LensTabBar.tsx`
- Add `{ key: 'sys', label: 'Sys' }` to TABS array

**Modify**: `apps/dashboard/src/components/lens/LensPanel.tsx`
- Import and render: `{activeTab === 'sys' && <SystemMetricsView />}`

**New file**: `apps/dashboard/src/components/lens/sys/SystemMetricsView.tsx`

Layout:
```
┌─────────────────────────────┐
│  CPU: 32%  │ Mem: 8.2 GB  │ EL: 1.2ms  │  ← KPI row (KpiMini chips)
├─────────────────────────────┤
│  CPU Usage          [chart] │  ← Recharts AreaChart (sys + process)
├─────────────────────────────┤
│  Memory             [chart] │  ← Recharts AreaChart (server RSS + process)
├─────────────────────────────┤
│  Monitored Processes        │  ← Per-session PID list with live stats
│  sess-abc1  PID 12345  25%  │
└─────────────────────────────┘
```

- `useEffect` subscribes on mount (`wsClient.send({ type: 'metrics:subscribe' })`), unsubscribes on unmount
- Charts use `isAnimationActive={false}` for real-time streaming (no animation lag)
- Module-level `EMPTY_SAMPLES` constant to prevent Zustand re-render loops
- System CPU area: blue; Claude process area: amber overlay
- Empty state: "Waiting for metrics..."
- Disabled state: "System metrics disabled" with enable button

### Step 11 — Keyboard shortcut

**Modify**: `apps/dashboard/src/App.tsx`
- Add `'sys'` to `tabKeys` array so key `7` switches to Sys tab

**Modify**: `apps/dashboard/src/components/layout/KeyboardShortcutsTooltip.tsx`
- Change `1-6` → `1-7` in shortcuts display

---

## Files Summary

| # | File | Action | What Changes |
|---|------|--------|-------------|
| 1 | `packages/core/src/types/metrics.ts` | **CREATE** | MetricSample, MetricRollup, MetricsQuery types |
| 2 | `packages/core/src/types/agent.ts` | MODIFY | WsServerMessage + WsClientMessage unions |
| 3 | `packages/core/src/schemas.ts` | MODIFY | MetricsQuerySchema |
| 4 | `packages/core/src/index.ts` | MODIFY | Export new types + schema |
| 5 | `hooks/send_event.cjs` | MODIFY | Add `ppid: process.ppid` to payload |
| 6 | `packages/server/package.json` | MODIFY | Add `pidusage` dependency |
| 7 | `packages/server/src/db.ts` | MODIFY | 2 tables + 4 helper functions |
| 8 | `packages/server/src/services/metricsCollector.ts` | **CREATE** | Core collector class (~200 lines) |
| 9 | `packages/server/src/services/eventStore.ts` | MODIFY | PID extraction from session events |
| 10 | `packages/server/src/services/broadcaster.ts` | MODIFY | broadcastMetrics() method |
| 11 | `packages/server/src/routes/metrics.ts` | **CREATE** | GET /api/metrics endpoint |
| 12 | `packages/server/src/app.ts` | MODIFY | Register metrics route |
| 13 | `packages/server/src/index.ts` | MODIFY | Wire collector, WS handling, rollup timer, shutdown |
| 14 | `apps/dashboard/src/store/agentStore.ts` | MODIFY | Metrics state slice + actions |
| 15 | `apps/dashboard/src/components/lens/LensContext.tsx` | MODIFY | LensTab union |
| 16 | `apps/dashboard/src/components/lens/LensTabBar.tsx` | MODIFY | TABS array |
| 17 | `apps/dashboard/src/components/lens/LensPanel.tsx` | MODIFY | Render SystemMetricsView |
| 18 | `apps/dashboard/src/components/lens/sys/SystemMetricsView.tsx` | **CREATE** | Metrics UI (~200 lines) |
| 19 | `apps/dashboard/src/App.tsx` | MODIFY | tabKeys array |
| 20 | `apps/dashboard/src/components/layout/KeyboardShortcutsTooltip.tsx` | MODIFY | 1-7 shortcut label |

**New files**: 4 (types, collector, route, UI)
**Modified files**: 16
**New dependency**: 1 (`pidusage`)

---

## Tests

| # | File | Action | Covers |
|---|------|--------|--------|
| T1 | `packages/server/src/__tests__/metricsCollector.test.ts` | **CREATE** | Polling lifecycle, adaptive resolution, PID track/untrack, sample structure, pidusage mock, destroy cleanup |
| T2 | `packages/server/src/__tests__/metricsStorage.test.ts` | **CREATE** | Insert, query with filters, rollup aggregation, purge thresholds |
| T3 | `packages/server/src/__tests__/metricsRoute.test.ts` | **CREATE** | GET /api/metrics with supertest: 200 response, resolution auto-select, query validation |

Pattern: isolated temp DB per file (matching `db.test.ts`), `vi.mock('pidusage')` for collector tests, `supertest(app)` for route tests.

---

## Verification Plan

1. **Unit tests**: `pnpm test` — all existing 356+ tests pass, plus ~15 new metrics tests
2. **Server start**: `npx tsx packages/server/src/index.ts` — no crashes, "Synapse server started" log
3. **Self-monitoring**: Open http://localhost:5173, click lens tab 7 (Sys) — KPI row shows live server CPU/memory/event loop delay, charts update every 1s
4. **Hook PID tracking**: Run a Claude Code session in the project — `session_start` event logs "Tracking Claude Code process PID: ..." on server, Sys tab shows process overlay on charts
5. **Session end**: End the Claude Code session — server logs "Untracking", process metrics disappear from Sys tab
6. **Persistence**: Reload the dashboard page — GET /api/metrics returns historical samples
7. **Rollups**: Wait 10+ minutes, check `metric_rollups_1m` has aggregated data, raw samples older than 1hr are purged
8. **Adaptive polling**: Close the Sys tab — server poll drops to 5s (visible in debug logs). Re-open — back to 1s.
9. **Graceful degradation**: Remove `pidusage` from node_modules — server starts, collects self+system metrics only (no per-PID), logs warning
10. **Build check**: `pnpm -r build` completes without errors

---

## Future Enhancements (Deferred)

- **GPU monitoring**: NVIDIA-only via `nvidia-smi` parsing, behind `SYNAPSE_GPU_METRICS=1` env flag
- **Sparkline overlays**: CPU/memory mini-charts on agent nodes showing resource usage during that agent's lifetime
- **Metric alerting**: CPU > 90% or memory > 80% thresholds as coaching nudges
- **Cross-session comparison**: System metrics in the analytics page
- **Subagent attribution**: Proportional resource attribution via SubagentStart/SubagentStop time windows
