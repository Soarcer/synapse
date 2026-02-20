# System Metrics Feasibility Research

**Date**: 2026-02-18
**Status**: Research complete
**Branch**: fix/review-findings

---

## Executive Summary

Capturing per-process system metrics (CPU, memory, GPU, network) from Synapse-monitored processes is **feasible with caveats**. The strongest coverage is CPU and memory via `pidusage` + `systeminformation`. GPU monitoring is NVIDIA-only. Per-process network traffic is **not feasible cross-platform** from pure JavaScript. A critical constraint: Claude Code subagents are **threads within a single process**, not separate OS processes, so individual subagent resource attribution requires time-window correlation rather than direct PID monitoring.

### Quick Decision Matrix

| Metric | Feasible? | Cross-Platform? | Library | Effort |
|--------|-----------|-----------------|---------|--------|
| Per-process CPU % | Yes | Yes (Windows less accurate) | `pidusage` | Low |
| Per-process memory (RSS) | Yes | Yes | `pidusage` | Low |
| System CPU load | Yes | Yes | `os` module / `systeminformation` | Low |
| System memory | Yes | Yes | `os` module / `systeminformation` | Low |
| Process tree discovery | Yes | Yes (wmic risk on Win) | `pidtree` | Low |
| GPU utilization | Partial | NVIDIA only | `nvidia-smi` parse / `systeminformation` | Medium |
| Per-process GPU memory | Partial | NVIDIA only | `nvidia-smi --query-compute-apps` | Medium |
| Per-process network I/O | No | N/A | None viable | N/A |
| System network throughput | Yes | Yes | `systeminformation` | Low |
| Disk I/O | Yes | Yes | `systeminformation` | Low |
| Event loop health | Yes | Yes (current process only) | `perf_hooks` built-in | Low |

---

## 1. What Synapse Already Captures (API-Level)

The current system has rich **API-level observability** but zero **machine-level observability**.

### Existing Metrics

| Category | Metrics | Source |
|----------|---------|--------|
| **Tokens** | input, output, cache_read, cache_creation, thinking | Hook events + transcript parsing |
| **Cost** | Per-turn USD, per-model rates, vendor-specific pricing | `costService.ts` — computed from tokens |
| **Timing** | Tool duration_ms, agent duration, avg response latency | Events table + transcript |
| **Efficiency** | tokens/min, cost/min, context utilization, cache hit rate | `velocityService.ts` — composite scoring |
| **Analytics** | Daily rollups by cwd/model/vendor, per-tool stats | `analytics_daily` + `analytics_tool_daily` tables |
| **Hierarchy** | Session → Agent → Tool call tree, parent_agent_id | Event schema + graph visualization |

### What's Missing

| Category | Gap |
|----------|-----|
| **Machine resources** | No CPU, memory, disk, or network metrics at all |
| **Process health** | No visibility into Node.js heap, GC pauses, event loop lag |
| **System context** | No total/available memory, CPU core count, or disk space |
| **GPU** | No GPU utilization or VRAM tracking |
| **Correlation** | Cannot link token-heavy operations to resource spikes |

---

## 2. Process Model Analysis

### Claude Code Session Architecture

Understanding how processes map to the entities Synapse monitors:

```
┌─────────────────────────────────────────────┐
│  Claude Code Process (single Node.js PID)   │
│                                             │
│  ┌─────────────┐  ┌─────────────────────┐  │
│  │ Main Agent   │  │ Subagent (Task)     │  │
│  │ (thread)     │  │ (thread, not PID)   │  │
│  └─────────────┘  └─────────────────────┘  │
│                                             │
│  Hook scripts spawned as child processes:   │
│  └─ send_event.cjs (fire-and-forget)        │
└─────────────────────────────────────────────┘
         │
         │ POST /api/events
         ▼
┌─────────────────────────────────────────────┐
│  Synapse Server (separate Node.js PID)      │
│  packages/server/src/index.ts               │
│                                             │
│  ┌──────────────┐  ┌─────────────────────┐ │
│  │ AgentManager  │  │ Agent SDK spawn     │ │
│  │ (SDK agents)  │  │ (API call loops,    │ │
│  │              │  │  not separate PIDs)  │ │
│  └──────────────┘  └─────────────────────┘ │
└─────────────────────────────────────────────┘
```

### Key Insight: Subagents Are NOT Separate Processes

- Claude Code's Task tool spawns subagents as **threads** (async API call loops) within the same Node.js process
- Each subagent gets its own context window but shares the process's CPU/memory
- Up to 10 concurrent subagents per session
- **Implication**: You cannot get per-subagent CPU/memory from the OS. You can only monitor the aggregate Claude Code process

### What Can Be Monitored by PID

| Entity | Has Own PID? | Can Monitor Directly? |
|--------|-------------|----------------------|
| Claude Code main process | Yes | Yes — `pidusage(pid)` |
| Subagents (Task tool) | No (threads) | No — correlate via time windows |
| Hook scripts (send_event.cjs) | Yes (ephemeral) | Technically yes, but too short-lived |
| Synapse server | Yes | Yes — `process.memoryUsage()` |
| SDK-spawned agents (AgentManager) | No (async loops) | No — correlate via time windows |

### Attribution Strategy for Subagents

Since subagents share a process, attribute resource usage via temporal correlation:

1. Capture system metrics at high resolution (1s) with timestamps
2. Use `SubagentStart`/`SubagentStop` hook events to define time windows
3. When only one subagent is active: all resource delta → that subagent
4. When multiple subagents overlap: proportional attribution (e.g., by token throughput ratio)
5. Display as "estimated" to set user expectations

---

## 3. Available Monitoring Tools

### Recommended Stack

| Layer | Tool | Purpose | Size | Downloads/week |
|-------|------|---------|------|----------------|
| **Per-PID metrics** | `pidusage` | CPU %, memory (bytes) per PID | 36 kB, 0 deps | ~3M |
| **System-wide** | `systeminformation` | Full system context + GPU + processes | 842 kB, 0 deps | ~3.7M |
| **Process tree** | `pidtree` | Find child PIDs recursively | tiny, 0 deps | ~7.6M |
| **Self-monitoring** | Node.js built-ins | `process.memoryUsage()`, `perf_hooks` | 0 | built-in |

### Node.js Built-in Capabilities

**`process.cpuUsage([previousValue])`** — Current process only
```ts
// Returns { user: number, system: number } in microseconds
// Compute delta between two calls, divide by wall time for CPU %
const start = process.cpuUsage();
// ... work ...
const delta = process.cpuUsage(start);
const cpuPercent = (delta.user + delta.system) / (elapsedMs * 1000) * 100;
```

**`process.memoryUsage()`** — Current process only
```ts
interface MemoryUsage {
  rss: number;          // Resident Set Size (total physical memory)
  heapTotal: number;    // V8 heap allocated
  heapUsed: number;     // V8 heap used
  external: number;     // C++ objects bound to JS
  arrayBuffers: number; // ArrayBuffer + SharedArrayBuffer
}
```

**`process.resourceUsage()`** — Rich stats (wraps `uv_getrusage`)
- `maxRSS` (peak memory in KB), `fsRead`/`fsWrite` (I/O ops), page faults, context switches
- **Windows caveat**: Many fields return `0` (partial libuv implementation)

**`perf_hooks`** — Event loop and GC monitoring
- `monitorEventLoopDelay({ resolution })` — histogram of event loop delays (ns)
- `performance.eventLoopUtilization()` — `{ idle, active, utilization }` (0-1 ratio)
- `PerformanceObserver` for GC events, HTTP timing, DNS lookups
- Only applies to the current process

**`os` module** — System-wide (not per-process)
- `os.cpus()` — per-core times (user, nice, sys, idle, irq)
- `os.freemem()` / `os.totalmem()` — system memory
- `os.loadavg()` — returns `[0, 0, 0]` on Windows

### `pidusage` — Per-PID CPU and Memory

```ts
import pidusage from 'pidusage';

// Single or multiple PIDs
const stats = await pidusage([pid1, pid2]);
// Returns per PID: { cpu, memory, pid, ppid, ctime, elapsed, timestamp }

pidusage.clear(); // purge internal cache
```

| Platform | CPU Accuracy | Memory Accuracy | Method |
|----------|-------------|-----------------|--------|
| Linux | Accurate | Accurate | Parses `/proc/<pid>/stat` |
| macOS | Accurate | Accurate | `ps -o pcpu,rss,ppid` |
| Windows | **Not accurate** | Accurate | `wmic` (deprecated!) |

**Critical risk**: Uses `wmic.exe` on Windows, which is being **removed in Windows 11 25H2** (2026). The WMI infrastructure remains — only the CLI tool is gone. Libraries must migrate to PowerShell `Get-CimInstance`. Monitor for updates or prepare patches.

### `systeminformation` — Comprehensive System Info

Key functions for Synapse:

| Function | Returns | Per-Process? |
|----------|---------|-------------|
| `si.currentLoad()` | System CPU %, per-core breakdown | No |
| `si.mem()` | total, free, used, active, swap | No |
| `si.processes()` | All processes: CPU%, mem%, RSS, VSZ, command | Yes |
| `si.processLoad('node')` | Aggregated metrics for named process | Yes (by name) |
| `si.graphics()` | GPU controllers, VRAM, utilization (NVIDIA) | No |
| `si.networkStats()` | Bytes rx/tx per interface | No |
| `si.networkConnections()` | Active connections with PIDs | Yes (connections, not bytes) |
| `si.fsSize()` | Disk usage per mount | No |
| `si.dockerContainerStats()` | Container CPU, memory, network | Per container |

**Warning**: `si.processes()` enumerates ALL system processes — expensive on busy systems. Use `pidusage` with targeted PIDs for monitoring specific processes.

### `pidtree` — Process Tree Discovery

```ts
import pidtree from 'pidtree';

const children: number[] = await pidtree(claudeCodePid, { root: true });
// Returns all PIDs in the process tree

const detailed = await pidtree(claudeCodePid, { advanced: true });
// Returns: Array<{ pid: number, ppid: number }>
```

- Same `wmic` deprecation risk on Windows
- Orphaned processes (parent dies) are lost from the tree
- Short-lived children may be missed between polls

---

## 4. GPU Monitoring

### Cross-Platform Support

| Metric | NVIDIA (`nvidia-smi`) | AMD (`rocm-smi`) | Intel | Apple Silicon |
|--------|----------------------|-------------------|-------|---------------|
| GPU utilization % | Yes | Linux only | No | No |
| GPU temperature | Yes | Linux only | No | No |
| VRAM total/used/free | Yes | Linux only | Partial | No |
| Per-PID GPU memory | Yes | No | No | No |
| Per-PID GPU utilization | No | No | No | No |
| Power draw | Yes | Linux only | No | No |
| Fan speed | Yes | Linux only | No | No |

### NVIDIA Monitoring (Best Support)

```ts
// Overall GPU stats
exec('nvidia-smi --query-gpu=gpu_name,utilization.gpu,utilization.memory,memory.total,memory.used,memory.free,temperature.gpu,power.draw --format=csv,noheader,nounits',
  (err, stdout) => {
    const [name, gpuUtil, memUtil, memTotal, memUsed, memFree, temp, power] =
      stdout.trim().split(', ');
  }
);

// Per-process GPU memory
exec('nvidia-smi --query-compute-apps=pid,used_memory,gpu_name --format=csv,noheader,nounits',
  (err, stdout) => { /* per-PID GPU memory usage */ }
);
```

### `systeminformation` GPU Integration

```ts
const graphics = await si.graphics();
// graphics.controllers[0] includes (NVIDIA only):
// utilizationGpu, utilizationMemory, temperatureGpu,
// memoryTotal, memoryUsed, memoryFree, powerDraw,
// clockCore, clockMemory, driverVersion
```

### Recommendation

For Synapse: Use `systeminformation.graphics()` as the cross-platform baseline. If NVIDIA is detected (check `controllers[0].vendor`), enable detailed metrics via `nvidia-smi` parsing for utilization, temperature, and per-process VRAM. Do not attempt AMD/Intel/Apple GPU monitoring — the tooling does not exist.

---

## 5. Network Traffic Monitoring

### Per-Process: Not Feasible Cross-Platform

This is the hardest metric to capture. Summary by platform:

| Approach | Linux | macOS | Windows | From Node.js? |
|----------|-------|-------|---------|---------------|
| `/proc/<pid>/io` (all I/O, not network-only) | Yes | No | No | Easy but imprecise |
| `nethogs` (requires root) | Yes | Partial | No | Shell out only |
| eBPF/bpftrace | Yes | No | No | Needs native addon |
| `GetPerTcpConnectionEStats` | No | No | Yes | Needs native addon |
| `nettop -P -L 1` | No | Yes | No | Fragile parsing |
| ETW with Pktmon | No | No | Yes | Extremely complex |

### What IS Feasible

- **System-wide network throughput**: `si.networkStats()` — bytes rx/tx per interface (easy, cross-platform)
- **Connection-to-PID mapping**: `si.networkConnections()` — which PIDs have active connections (no byte counts)
- **Proxy-level measurement**: Since all Claude API traffic goes through known endpoints, you could measure it at the HTTP client level (request/response size) rather than the OS level. Synapse already tracks token counts, which approximate data volume.

### Recommendation

Skip per-process network monitoring. Instead:
1. Use `si.networkStats()` for system-wide context
2. Compute **estimated API bytes** from token counts (input tokens × ~4 bytes, output tokens × ~4 bytes, plus JSON overhead)
3. Display as "API data transfer" alongside system network activity for context

---

## 6. Correlation Strategy

### How to Link System Metrics to Agent Events

Since subagents share a process, correlation must be time-based:

```
Timeline:
                 ToolCall A              ToolCall B
             ┌──────────────┐     ┌──────────────────┐
Agent 1:     │ Bash (4.2s)  │     │ Read file (0.3s) │
             └──────────────┘     └──────────────────┘
                          Subagent spawned
             ─────────────┬──────────────────────────────
Agent 2:                  │      Grep (1.1s)  Write (0.5s)
                          └──────────────────────────────

CPU %:  ████░░████████████████████░░░░░░░░████░░░░░░
         12%    45%   38%   52%     8%      35%   5%
Memory: ─────────────────/‾‾‾‾‾‾‾‾‾‾‾‾‾\──────────
         180MB          320MB            240MB
```

### Implementation Pattern

```ts
interface MetricSample {
  timestamp: number;       // epoch ms
  sessionId: string;
  pid: number;
  cpu: number;             // percentage
  memoryRss: number;       // bytes
  memoryHeap?: number;     // bytes (if self-monitoring)
  activeEventIds: string[];// tool calls in progress at this moment
  activeAgentIds: string[];// agents running at this moment
}
```

For each metric sample, tag with the currently-active events (known from store state). This creates explicit event-to-metric links rather than relying solely on temporal proximity.

### Industry Patterns

| Tool | Correlation Approach |
|------|---------------------|
| **Sentry** | Attaches CPU/memory samples to active transaction spans |
| **Datadog** | Tags metrics with trace_id/span_id via exemplars |
| **W&B** | Samples at fixed interval, correlates by timestamp in UI |
| **OpenTelemetry** | Exemplars — individual metric data points carry trace context |

**Recommended for Synapse**: Hybrid approach:
1. **Explicit tagging** — each metric sample carries `activeEventIds[]`
2. **Time-window fallback** — for historical data without tags, use containment matching
3. **Proportional attribution** — when multiple agents overlap, split by token throughput

---

## 7. Real-Time Streaming Architecture

### Adaptive Resolution (Datadog Pattern)

| State | Poll Interval | Trigger |
|-------|--------------|---------|
| Dashboard closed / metrics panel hidden | 5s | Default |
| Metrics panel visible | 1s | Panel mount |
| Zoomed into specific tool call | 500ms | Zoom event |
| No active sessions | Disabled | Session count = 0 |

### WebSocket Integration

Synapse already uses WebSocket for event streaming. Add a `metrics` channel:

```ts
// Server → Client message types (extend existing WS protocol)
type MetricMessage = {
  type: 'metrics';
  samples: MetricSample[];  // batched (multiple samples per message)
};

type MetricSubscribe = {
  type: 'metrics:subscribe';
  resolution: 500 | 1000 | 5000;  // ms
  pids?: number[];                  // specific PIDs or all
};

type MetricUnsubscribe = {
  type: 'metrics:unsubscribe';
};
```

### Storage Schema

```sql
-- Raw samples (1s resolution, keep 1 hour)
CREATE TABLE metric_samples (
    timestamp   INTEGER NOT NULL,  -- epoch ms
    session_id  TEXT NOT NULL,
    pid         INTEGER NOT NULL,
    cpu_percent REAL,
    memory_rss  INTEGER,           -- bytes
    memory_heap INTEGER,           -- bytes (Synapse server only)
    gpu_util    REAL,              -- NVIDIA only, nullable
    gpu_vram    INTEGER,           -- bytes, nullable
    UNIQUE(timestamp, session_id, pid)
);
CREATE INDEX idx_metrics_session_time ON metric_samples(session_id, timestamp);

-- 1-minute rollups (keep 24 hours)
CREATE TABLE metric_rollups_1m (
    timestamp   INTEGER NOT NULL,  -- epoch ms, rounded to minute
    session_id  TEXT NOT NULL,
    pid         INTEGER NOT NULL,
    cpu_avg     REAL,
    cpu_max     REAL,
    memory_avg  INTEGER,
    memory_max  INTEGER,
    sample_count INTEGER,
    UNIQUE(timestamp, session_id, pid)
);

-- System-wide context (sampled less frequently)
CREATE TABLE system_metrics (
    timestamp       INTEGER PRIMARY KEY,
    cpu_load        REAL,          -- system-wide %
    memory_total    INTEGER,       -- bytes
    memory_available INTEGER,      -- bytes
    net_rx_bytes    INTEGER,       -- cumulative
    net_tx_bytes    INTEGER,       -- cumulative
    gpu_util        REAL,          -- NVIDIA only
    gpu_temp        REAL           -- NVIDIA only
);
```

### Data Volume Estimates

| Resolution | Metrics/row | Rows/hour | Size/hour | Size/day |
|-----------|-------------|-----------|-----------|----------|
| 1s (raw) | ~7 fields | 3,600 | ~140 KB | ~3.4 MB |
| 1m (rollup) | ~7 fields | 60 | ~2.4 KB | ~58 KB |
| 5m (historical) | ~7 fields | 12 | ~480 B | ~12 KB |

Trivially small for SQLite. No compression or special handling needed.

---

## 8. Recommended Implementation Approach

### Phase 1: Foundation (Low Effort)

**Goal**: Monitor the Synapse server process itself + system-wide context

- Use `process.memoryUsage()` + `process.cpuUsage()` for server self-monitoring
- Use `os.cpus()` + `os.freemem()` / `os.totalmem()` for system context
- Use `perf_hooks.monitorEventLoopDelay()` for event loop health
- Stream over existing WebSocket, display in a new "System" lens tab
- **Dependencies**: None (all built-in)
- **New code**: ~200 lines (collector service + WS messages)

### Phase 2: Per-Process Monitoring (Medium Effort)

**Goal**: Monitor Claude Code process by PID

- Add `pidusage` dependency for per-PID CPU/memory
- Add `pidtree` dependency for process tree discovery
- Detect Claude Code PID from hook events (`session_start` + process lookup)
- Poll at adaptive resolution (1s active, 5s idle)
- Correlate metric samples with active tool calls via timestamps
- **Dependencies**: `pidusage` (36 KB), `pidtree` (tiny)
- **New code**: ~400 lines (metric collector, PID resolver, correlation logic)
- **Risk**: `pidusage` and `pidtree` use deprecated `wmic` on Windows

### Phase 3: GPU + System Dashboard (Higher Effort)

**Goal**: Full system observability with GPU and historical trends

- Add `systeminformation` dependency for GPU, disk, network context
- Parse `nvidia-smi` for detailed NVIDIA metrics when available
- Add `metric_samples` + `metric_rollups_1m` tables to SQLite
- Implement downsampling cron (raw → 1m rollups hourly, purge raw after 1h)
- Build dashboard visualizations (sparklines on nodes, system metrics lens)
- **Dependencies**: `systeminformation` (842 KB)
- **New code**: ~800 lines (GPU collector, storage, downsampling, UI)

### Phase 4: Advanced Correlation (Future)

**Goal**: Deep integration between system metrics and agent analytics

- Tag each metric sample with `activeEventIds[]` for explicit correlation
- Proportional attribution when multiple subagents overlap
- Overlay CPU/memory charts on the agent timeline
- Anomaly detection (flag tool calls that coincide with unusual resource spikes)
- Cost-per-compute estimation (API cost + estimated electricity/compute cost)

---

## 9. Constraints and Limitations

### Hard Limitations

| Constraint | Impact | Mitigation |
|-----------|--------|------------|
| Subagents are threads, not processes | Cannot monitor individual subagent resources | Time-window correlation with explicit tagging |
| Per-process network I/O not feasible | Cannot track API data transfer per PID | Estimate from token counts (~4 bytes/token) |
| GPU monitoring NVIDIA-only | AMD, Intel, Apple Silicon have no tooling | Detect GPU vendor, show "N/A" for non-NVIDIA |
| Windows CPU accuracy is low | `pidusage` CPU readings unreliable on Windows | Document limitation, prefer memory metrics on Windows |
| `wmic` deprecated on Windows 11 25H2 | `pidusage` and `pidtree` may break | Monitor upstream libraries; prepare PowerShell fallback |

### Operational Constraints

| Constraint | Impact | Mitigation |
|-----------|--------|------------|
| Polling overhead | High-frequency polling adds CPU load | Adaptive resolution; disable when no sessions active |
| `si.processes()` is expensive | Enumerates ALL processes on the system | Use `pidusage` with targeted PIDs instead |
| Hook scripts are ephemeral | Cannot monitor hook process resource usage | Not meaningful — hooks are fire-and-forget (<100ms) |
| Claude Code PID not in hook data | Must discover PID externally | Match by `cwd` + process name, or add PID to hook events |

### Missing PID in Hook Events

The hook event schema does not include the Claude Code process PID. Strategies to discover it:

1. **Process table scan**: `si.processes()` → find `node` processes with matching `cwd`
2. **pidtree from server**: If Synapse server is spawned by OpenClaw plugin, walk up the tree
3. **Transcript path**: Hook events include `transcriptPath` — parse the session ID and correlate with process listing
4. **Enhancement request**: Add `process.pid` to hook event payload in `send_event.cjs`

The simplest and most reliable approach is option 4: modify `send_event.cjs` to include `process.ppid` (the parent process, which is Claude Code). This is a one-line change to the hook script.

---

## 10. Industry Benchmarks

### What Other AI Observability Tools Capture

| Tool | System Metrics? | Per-Process? | GPU? | Resolution |
|------|----------------|-------------|------|------------|
| **Sentry** | CPU + memory via profiling | Transaction-scoped | No | 100ms (during transactions) |
| **Datadog** | Full system + per-process | Yes (by name/PID) | Yes (NVIDIA) | 10s default, 2s real-time |
| **W&B** | CPU, memory, disk, network, GPU | Process-level | Yes (NVIDIA, AMD, Apple, TPU) | 10s default (configurable) |
| **LangSmith** | No system metrics | No | No | N/A |
| **MLflow** | No system metrics | No | No | N/A |
| **Grafana/Prometheus** | Full system via node_exporter | By name pattern | Limited | 15s scrape interval |

### Recommended Benchmarks for Synapse

Based on industry practice, the minimum viable set:

1. **Per-process CPU %** (like Datadog, W&B)
2. **Per-process memory RSS** (like Datadog, W&B, Sentry)
3. **System CPU load** (like Prometheus, Datadog)
4. **System memory available** (like Prometheus, Datadog)
5. **GPU utilization** (like W&B — NVIDIA only)
6. **Event loop delay** (unique to Node.js — no industry equivalent)

---

## Appendix A: Package Comparison

| | pidusage | systeminformation | node-os-utils | os-utils |
|--|---------|-------------------|---------------|----------|
| Per-PID CPU/memory | **Yes** | Yes (via `processes()`) | No | No |
| System CPU | No | **Yes** | Yes | Yes |
| System memory | No | **Yes** | Yes | Yes |
| Disk info | No | **Yes** | Yes | No |
| Network stats | No | **Yes** | Yes | No |
| GPU info | No | **Yes** | No | No |
| Docker | No | **Yes** | No | No |
| Bundle size | **36 KB** | 842 KB | 1.14 MB | tiny |
| Dependencies | **0** | 0 | 0 | 0 |
| Maintenance | Active | **Very active** | Active | Abandoned (2013) |
| TypeScript | Yes | Yes | Yes (v2) | No |
| Weekly downloads | ~3M | ~3.7M | ~93K | ~31K |

## Appendix B: Windows Monitoring Future-Proofing

Since `wmic.exe` removal is imminent (Windows 11 25H2, 2026), any Windows monitoring code should use PowerShell:

```ts
// Future-proof Windows per-process metrics
import { exec } from 'child_process';

function getProcessMetrics(pid: number): Promise<{ cpu: number; memory: number }> {
  return new Promise((resolve, reject) => {
    exec(
      `powershell -NoProfile -Command "Get-CimInstance Win32_PerfFormattedData_PerfProc_Process | Where-Object { $_.IDProcess -eq ${pid} } | Select-Object PercentProcessorTime, WorkingSet | ConvertTo-Json"`,
      (err, stdout) => {
        if (err) return reject(err);
        const data = JSON.parse(stdout);
        resolve({
          cpu: data.PercentProcessorTime,
          memory: data.WorkingSet,
        });
      }
    );
  });
}
```

**Overhead**: PowerShell cold start is ~200-400ms. Subsequent calls in a reused session are faster. For 1s polling, consider keeping a persistent PowerShell child process with stdin/stdout communication.

## Appendix C: Discoverable Claude Code PID

Add to `hooks/send_event.cjs`:

```js
// In the payload construction, add:
const payload = {
  ...existingPayload,
  pid: process.ppid,  // Claude Code's PID (parent of the hook script)
};
```

This gives Synapse the Claude Code process PID with zero additional system calls, since `process.ppid` is a built-in Node.js property available in every hook invocation.
