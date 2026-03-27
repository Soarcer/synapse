# File Relay Testing & Smart Lightweight Hooks Fallback Plan

## Status: PLAN — awaiting approval

## Context

The file relay transport (Option C) is already implemented and live:

- `hooks/send_event.cjs` + `send_response.cjs` → `fs.appendFileSync` to `$TEMP/synapse_relay_<port>.jsonl`
- `packages/server/src/services/fileEventRelay.ts` → `fs.watch` + 200ms poll reads new lines
- `packages/server/src/services/eventIngestion.ts` → shared pipeline for both HTTP and relay

### Measured Performance (this session, 20 events)

| Phase                             | Min      | Avg      | Max      | Notes                               |
| --------------------------------- | -------- | -------- | -------- | ----------------------------------- |
| Stdin read (process start → body) | 9ms      | 12ms     | 17ms     | Node spawn + Claude pipes stdin     |
| File write (body → appended)      | 1ms      | 2ms      | 3ms      | `appendFileSync` — essentially free |
| **Total hook-side**               | **11ms** | **14ms** | **20ms** | Was 30-50ms + 3s timeout with HTTP  |
| Server poll interval              | —        | 200ms    | 200ms    | `setInterval` safety net            |
| End-to-end (hook → dashboard)     | ~14ms    | ~214ms   | ~220ms   | Hook + poll + WS broadcast          |

**Key insight:** The file write is 2ms. The 12ms stdin read is irreducible (Claude Code pipes JSON to the hook process). The 200ms server poll is the dominant latency factor now.

## Part 1: Testing & Observability (implement now)

### T1. Add timing instrumentation to FileEventRelay

Add per-batch metrics logging to `readNewLines()`:

- Count of lines processed per batch
- Time to parse + ingest batch
- Log at `debug` level (won't appear unless `LOG_LEVEL=debug`)

**File:** `packages/server/src/services/fileEventRelay.ts`

### T2. Add `/api/relay/status` endpoint

Exposes relay health for debugging:

```json
{
  "relayPath": "/tmp/synapse_relay_27246.jsonl",
  "fileSize": 570663,
  "offset": 570663,
  "behind": 0,
  "eventsIngested": 247,
  "lastIngestAt": "2026-03-18T03:46:34.261Z",
  "pollIntervalMs": 200
}
```

**File:** `packages/server/src/routes/settings.ts` (or new `relay.ts`)

### T3. Reduce poll interval from 200ms to 50ms

The 200ms was conservative. On Windows, `fs.watch` is unreliable for file-level changes, so the poll is the primary mechanism. 50ms gives near-real-time delivery without meaningful CPU cost (one `fs.statSync` call = ~0.1ms).

**File:** `packages/server/src/services/fileEventRelay.ts` — change `POLL_INTERVAL_MS` constant

### T4. Circuit breaker: permanent trip until server restart

Current breaker trips after 3 failures in 30s, then resets after 60s. Change to:

- Trip permanently (no auto-reset)
- Server clears CB file on startup (already done in `index.ts`)
- Hook checks for CB file existence — if exists, skip immediately (no JSON parse needed)

This makes the hook script even cheaper when the server is down: one `fs.existsSync` call (~0.5ms) then exit.

**Files:** `hooks/send_event.cjs`, `hooks/send_response.cjs`

## Part 2: Smart Lightweight Hooks (Option B-lite) — fallback plan

**Only implement if** the file relay proves insufficient (unlikely given measurements).

### Problem Option B-lite solves

The remaining 12ms per event is Node process startup + stdin reading. With 150-600 events per session, that's 1.8-7.2 seconds of cumulative CPU time spawning processes. Not blocking (all async), but wasteful.

### Design: Named Pipe Relay

Replace process-per-event with a persistent named pipe. Hook scripts connect, write JSON, disconnect. No process spawn overhead.

#### Architecture

```
Claude Code ──stdin──→ hook process ──net.connect──→ Named Pipe ──→ Synapse Server
                        (still spawned)              \\.\pipe\synapse-27246
                        but write is ~1ms             /tmp/synapse_27246.sock
                        vs 12ms stdin read
```

Wait — this doesn't actually help. Claude Code still spawns the hook process and pipes stdin. The 12ms is in Claude Code's process, not ours. A named pipe would only save the `appendFileSync` (2ms → ~1ms), which is negligible.

#### Revised analysis: Why Option B-lite doesn't help

The hook execution model is:

1. Claude Code spawns `node send_event.cjs` (our hook) — **we can't control this**
2. Claude Code writes JSON to stdin — **we can't control this** (~12ms)
3. Our hook reads stdin, writes to relay file — **2ms, already optimal**

A named pipe replaces step 3's `appendFileSync` with a socket write. Savings: ~1ms. Not worth the complexity.

The only way to eliminate process spawning is if Claude Code supported:

- **Native HTTP hooks** (type: "http" for all events, not just PermissionRequest) — they already do for PermissionRequest
- **File-based hooks** (Claude Code writes events to a file directly) — not currently supported

### Conclusion: Option B-lite is not worth implementing

The file relay is already near-optimal given the constraints of Claude Code's hook model. The real bottleneck is:

1. Claude Code spawning a Node process per event (12ms, unavoidable)
2. Our poll interval (200ms → reducing to 50ms in T3)

### If we ever need sub-10ms end-to-end

The only path is to use Claude Code's native `type: "http"` hook (currently only available for `PermissionRequest`). If Anthropic extends this to all events, we could receive events directly on the hook server without any process spawning. Monitor Claude Code changelog for this.

## Implementation Order

1. **T4** — Permanent circuit breaker (simplest, most impactful for failure case)
2. **T3** — Reduce poll to 50ms (one constant change, biggest latency improvement)
3. **T1** — Timing instrumentation (helps validate T3)
4. **T2** — Status endpoint (nice for debugging, low priority)

## Files to modify

| Task | File                                                  | Change                                               |
| ---- | ----------------------------------------------------- | ---------------------------------------------------- |
| T1   | `packages/server/src/services/fileEventRelay.ts`      | Add timing metrics to `readNewLines()`               |
| T2   | `packages/server/src/routes/settings.ts` or new route | Add `/api/relay/status` GET endpoint                 |
| T3   | `packages/server/src/services/fileEventRelay.ts`      | `POLL_INTERVAL_MS = 50`                              |
| T4   | `hooks/send_event.cjs`                                | Simplify CB to permanent trip, `fs.existsSync` check |
| T4   | `hooks/send_response.cjs`                             | Same CB simplification                               |
