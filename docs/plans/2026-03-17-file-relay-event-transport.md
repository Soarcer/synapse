# File Relay Event Transport (Option C)

**Date:** 2026-03-17
**Problem:** Every hook event spawns a new `node send_event.cjs` process (~30-50ms startup + HTTP overhead). A typical tool-heavy session fires 150–600 of these per session. Even with the circuit breaker, the _success_ path is still wasteful. The fix is to replace HTTP POST with a local file append — microseconds instead of milliseconds, zero network, zero process spawning.

---

## Approach: JSONL Relay File

Each hook script appends a single JSON line to a shared temp file. The Synapse server watches that file and ingests new lines in real time.

```
Hook process              Relay file                        Synapse server
─────────────────         ──────────────────────────────    ────────────────────────
appendFileSync(line) ──►  /tmp/synapse_relay_27246.jsonl   ◄── fs.watch + poll
                           { ...event }\n                   parse → ingestEvent()
                           { ...event }\n                   parse → ingestEvent()
```

### Why this is better than the alternatives

|                               | Option A (named pipe)       | Option B (sidecar process) | Option C (file relay)      |
| ----------------------------- | --------------------------- | -------------------------- | -------------------------- |
| Process spawning              | Zero                        | Zero                       | Zero                       |
| Works while server starting   | No (pipe doesn't exist yet) | No (sidecar not up yet)    | **Yes** (file accumulates) |
| Cross-platform                | Risky on Windows            | Fine                       | **Fine**                   |
| Events survive server restart | No                          | No                         | **Yes** (backlog replayed) |
| Complexity                    | High (pipe lifecycle)       | High (sidecar lifecycle)   | **Low**                    |
| Latency                       | <1ms                        | <1ms                       | 100–200ms (watch + poll)   |
| Backpressure                  | None needed                 | None needed                | None needed                |

The 100–200ms latency is acceptable for observability — the dashboard is not a control plane.
At high tool-call frequencies (5–10/sec), events may arrive at the broadcaster in small batches rather than one at a time. This is a known cosmetic trade-off.

**Exception:** `PermissionRequest` events are _synchronous_ (Claude waits for the HTTP response). These stay on the existing hook server HTTP path and are not affected by this change.

---

## File Layout

```
os.tmpdir()/synapse_relay_<port>.jsonl        — JSONL event queue (never deleted between restarts)
os.tmpdir()/synapse_relay_offset_<port>.json  — persisted read offset (prevents duplicate ingestion)
os.tmpdir()/synapse_cb_<port>.json            — circuit breaker (existing, kept for HTTP fallback)
```

Files are keyed by port so multiple VS Code instances with different ports don't collide.

**Assumption:** The Synapse server process (VS Code extension child) and hook processes (spawned by Claude Code) run as the same OS user, so `os.tmpdir()` resolves to the same path for both. This is true in all normal configurations. If needed, the relay path can be overridden via `SYNAPSE_RELAY_FILE` env var.

---

## Implementation Steps

### S0 — Extract `ingestEvent` from the HTTP route <!-- revised: P0 — processAndBroadcastEvent doesn't exist; must be extracted first -->

The relay needs to call the same event processing pipeline as `POST /api/events`. Currently this logic lives inline inside `createEventsRouter()`. Extract it into a standalone exported function:

```typescript
// packages/server/src/services/eventIngestion.ts (new file, or added to existing eventStore)
export async function ingestEvent(raw: unknown, broadcaster: Broadcaster): Promise<void> {
  // normalize, validate with Zod, persist to DB, broadcaster.broadcast(event)
  // Same logic currently inside the /api/events route handler
}
```

`createEventsRouter` calls `ingestEvent` internally. `FileEventRelay` also calls `ingestEvent`. No duplication.

### S1 — `packages/server/src/services/fileEventRelay.ts` (new file) <!-- revised: P0 race fix — no delete-on-startup; P1 fs.watch ENOENT fix; P1 stop() no longer deletes file; P1 ftruncate for size guard; P1 rename event restart -->

```typescript
export class FileEventRelay {
  constructor(relayPath: string, offsetPath: string, onEvent: (raw: unknown) => void);
  start(): void; // read backlog from persisted offset → watch file → poll timer
  stop(): void; // close watcher, clear timer — does NOT delete relay file
}
```

Internal logic:

**Byte-offset tracking (replaces delete-on-startup):**

- On `start()`: read persisted offset from `offsetPath` (default 0 if missing/corrupt).
- Read all bytes from `offset` to EOF — these are the backlog events (written before server started).
- Process each line, advance `offset`, persist updated offset to `offsetPath`.
- All subsequent reads start from the current `offset`. The relay file is never deleted.

**File must exist before `fs.watch`:**

- Before calling `fs.watch`, open the relay file with `fs.openSync(relayPath, 'a')` to create it if absent, then close. This prevents the `ENOENT` thrown when watching a non-existent file.

**Watch + poll:**

- `fs.watch(relayPath, { persistent: false }, handler)` — fires on each append.
- `setInterval(200ms)` safety-net poll (Windows `fs.watch` misses some appends; also catches renames).
- Both paths call the same `readNewLines()` function which is idempotent (reads from offset, skips if nothing new).

**`rename` event handling:**

- `fs.watch` emits `'rename'` when the watched file is deleted or replaced externally. When this fires: log a warning, recreate the file (`fs.openSync(path, 'a')`), reset offset to 0, close and restart the watcher on the new inode.

**`readNewLines()`:**

- Open file, seek to `offset`, read to EOF.
- Split on `\n`, parse each line as JSON, validate with Zod `AgentEventSchema`, call `onEvent`.
- Skip malformed lines with a warning log (handles extremely rare concurrent-write byte-interleave).
- Advance and persist `offset` after each successful batch.

**File size guard:**

- If file size > 5 MB: log warning, call `fs.ftruncateSync(fd, 0)` (same inode — watcher stays valid), reset `offset` to 0, persist new offset. This is a last-resort safety valve; normal operation never reaches 5 MB.

**`stop()`:**

- Close the `fs.watch` watcher.
- Clear the poll interval.
- **Do not delete the relay file.** Events written by hooks after `stop()` (e.g. `SessionEnd` fires as VS Code closes) accumulate in the file and are replayed on the next server start via the backlog read.

### S2 — Update `hooks/send_event.cjs` <!-- revised: HTTP fallback + SYNAPSE_TRANSPORT escape hatch -->

Replace the 120-line HTTP POST script with ~50 lines:

```js
// 1. Check SYNAPSE_TRANSPORT=http env var → skip relay, use HTTP POST (rollback path)
// 2. Compute relay file path: os.tmpdir()/synapse_relay_<port>.jsonl
//    (overrideable via SYNAPSE_RELAY_FILE env var)
// 3. Read stdin → parse JSON (same as now)
// 4. fs.appendFileSync(relayPath, JSON.stringify(event) + '\n')
// 5. If appendFileSync throws → fall back to HTTP POST (single attempt, existing circuit breaker)
// 6. process.exit(0)
```

**Circuit breaker role change:**

- File writes almost never fail (they'd require disk full or permissions error).
- Circuit breaker is now only active on the HTTP fallback path. Its logic is unchanged.
- `SYNAPSE_TRANSPORT=http` forces HTTP mode entirely — useful for debugging or rollback without a new `.vsix`.

### S3 — Update `hooks/send_response.cjs`

Same transport change as S2. The transcript-reading logic (`extractLastAssistantResponse`) is unchanged. Only the delivery mechanism changes from HTTP POST to `appendFileSync`.

### S4 — Wire relay into `packages/server/src/index.ts` <!-- revised: uses ingestEvent from S0; relay paths passed explicitly -->

After `initDb()`, before starting HTTP listeners:

```typescript
import { FileEventRelay } from './services/fileEventRelay.js';
import { ingestEvent } from './services/eventIngestion.js';

const relayPath = path.join(os.tmpdir(), `synapse_relay_${SYNAPSE_PORT}.jsonl`);
const offsetPath = path.join(os.tmpdir(), `synapse_relay_offset_${SYNAPSE_PORT}.json`);

const relay = new FileEventRelay(relayPath, offsetPath, (raw) => {
  ingestEvent(raw, broadcaster).catch((err) =>
    logger.error({ err }, 'FileEventRelay: failed to ingest event'),
  );
});
relay.start();
```

In `shutdown()`, call `relay.stop()` before closing HTTP servers (ensures the offset is persisted before exit).

Also: on startup, continue deleting the circuit breaker file as before (server restart = HTTP fallback resets).

### S5 — Sync built hook copies

The VS Code extension bundles hooks at `apps/vscode/resources/synapse-server/hooks/`. After updating `hooks/send_event.cjs` and `hooks/send_response.cjs`, sync both files to that directory.

Confirm `apps/vscode/esbuild.mjs` copy step covers both files — add explicit copy if not.

### S6 — `hookManager.ts`

No changes. The hook command remains `node "send_event.cjs"`. The transport change is internal to the script.

---

## Interaction with Existing Systems

| System                                          | Impact                                                                   |
| ----------------------------------------------- | ------------------------------------------------------------------------ |
| Circuit breaker (`synapse_cb_<port>.json`)      | Kept for HTTP fallback path only — no longer primary                     |
| Hook server (`POST /api/hooks/permission`)      | No change — PermissionRequest stays synchronous HTTP                     |
| HTTP `/api/events` endpoint                     | Kept for `send_gemini_event.cjs`, `send_codex_event.cjs`, external tools |
| `send_gemini_event.cjs`, `send_codex_event.cjs` | No change — these continue using HTTP                                    |
| WS broadcaster                                  | No change — relay calls `ingestEvent` which calls broadcaster internally |
| VS Code extension                               | No change — all changes are in hook scripts and server-side              |

---

## Error Handling

| Scenario                                            | Behaviour                                                                       |
| --------------------------------------------------- | ------------------------------------------------------------------------------- |
| Server not running                                  | Events accumulate in relay file; ingested on next server start via backlog read |
| Server crashes and restarts                         | Offset file preserves position; only new events ingested (no duplicates)        |
| Relay file write fails (disk full, permissions)     | Fall back to HTTP with circuit breaker                                          |
| Relay file > 5 MB                                   | `ftruncateSync` (same inode, watcher intact), offset reset, warning logged      |
| Malformed JSON line                                 | Skip line, log warning, continue (rare: concurrent write byte-interleave)       |
| `fs.watch` emits `rename` (file deleted externally) | Recreate file, reset offset, restart watcher                                    |
| `fs.watch` unavailable                              | 200ms poll handles all ingestion                                                |
| `SessionEnd` fires after `stop()`                   | Written to relay file; ingested as backlog on next server start                 |
| `SYNAPSE_TRANSPORT=http` set                        | Hook bypasses relay entirely, uses HTTP POST                                    |

---

## Files Changed

| File                                                           | Change                                                                     |
| -------------------------------------------------------------- | -------------------------------------------------------------------------- |
| `packages/server/src/services/eventIngestion.ts`               | **New** — extracted `ingestEvent()` shared by route + relay                |
| `packages/server/src/services/fileEventRelay.ts`               | **New** — relay reader service                                             |
| `packages/server/src/routes/events.ts`                         | Refactor: call `ingestEvent` instead of inline logic                       |
| `packages/server/src/index.ts`                                 | Wire in `FileEventRelay` on startup/shutdown                               |
| `hooks/send_event.cjs`                                         | Replace HTTP POST with `appendFileSync` + `SYNAPSE_TRANSPORT` escape hatch |
| `hooks/send_response.cjs`                                      | Replace HTTP POST with `appendFileSync` + `SYNAPSE_TRANSPORT` escape hatch |
| `apps/vscode/resources/synapse-server/hooks/send_event.cjs`    | Sync copy                                                                  |
| `apps/vscode/resources/synapse-server/hooks/send_response.cjs` | Sync copy                                                                  |

No changes to: `hookManager.ts`, `hookServer.ts`, `extension.ts`, `wsClient.ts`, `broadcaster.ts`, or any frontend code.

---

## Testing

1. **Unit — `FileEventRelay`**: write lines to a temp file, verify `onEvent` fires with correct payloads; verify offset persists and restarts from correct position; verify `rename` event triggers watcher restart.
2. **Unit — `ingestEvent`**: existing route tests should cover this after extraction.
3. **Integration**: run `send_event.cjs` pointing at a relay file, start `FileEventRelay`, verify events arrive at broadcaster.
4. **Backlog test**: write events to relay file before `start()`, verify all are replayed exactly once (no duplicates even across two restarts).
5. **Post-stop test**: write to relay after `stop()`, restart, verify events are ingested as backlog.
6. **Fallback test**: set `SYNAPSE_TRANSPORT=http`, verify script uses HTTP POST path.
7. **Existing tests**: all 798 tests must continue to pass (no API surface changes).

---

## Open Questions / Deferred (P2)

- **Concurrent write atomicity on Windows**: `O_APPEND` atomicity is guaranteed on Linux for small writes; Windows behaviour is implementation-defined. Malformed lines are skipped, so worst case is a silently dropped event. Acceptable for telemetry. Revisit if drop rate becomes measurable.
- **Batch update visual choppiness**: events may arrive at the broadcaster in bursts of 2–4 at high tool-call frequencies. Cosmetic only — no action needed for v1.
- **Temp file and marketplace review**: relay file contains hook payloads (tool inputs, cwd, session_id). Same sensitivity as Claude Code's own transcript files — local only. Add a comment in the implementation for clarity.
- **`os.tmpdir()` user-context mismatch**: documented as assumption above. If needed, `SYNAPSE_RELAY_FILE` env var allows explicit override.
