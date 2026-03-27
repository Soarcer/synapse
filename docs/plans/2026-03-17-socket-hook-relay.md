# Socket Hook Relay (Option B-lite)

**Date:** 2026-03-17
**Status:** Standby — implement this if Option C (file relay) latency or reliability is unacceptable in testing.

---

## Problem with Option C

`fs.watch` + 200ms poll means events arrive at the dashboard in batches with 100–200ms lag. On Windows, `fs.watch` is unreliable and the poll is the real guarantee. If this makes the graph feel choppy or unresponsive during a live session, switch to this plan.

---

## Approach: Unix Socket / Named Pipe

The Synapse server opens a local socket. Hook scripts connect, write one JSON line, disconnect. No process spawning, no file polling, no HTTP — sub-millisecond delivery.

```
Hook process            Socket                    Synapse server
─────────────           ─────────────────         ─────────────────────
net.connect()  ──────►  /tmp/synapse_27246.sock   net.createServer()
write(json\n)           (Windows: \\.\pipe\...)    → ingestEvent()
disconnect
```

**Platform socket paths:**

- Unix/macOS: `path.join(os.tmpdir(), 'synapse_<port>.sock')`
- Windows: `\\\\.\\pipe\\synapse-<port>`

Node's `net` module handles both transparently — the path format determines which transport is used.

---

## Why this beats Option C

|                             | Option C (file relay)             | Option B-lite (socket)                 |
| --------------------------- | --------------------------------- | -------------------------------------- |
| Latency                     | 100–200ms (poll)                  | <1ms (direct)                          |
| Ordering guarantee          | File append order                 | Connection order                       |
| Works during server startup | Yes (file accumulates)            | No (ECONNREFUSED)                      |
| Server-side complexity      | Medium (offset tracking, watcher) | Low (net.createServer)                 |
| Hook script complexity      | Low (appendFileSync)              | Low (net.connect)                      |
| Windows reliability         | `fs.watch` unreliable             | Named pipes solid                      |
| Fallback when server down   | File accumulates                  | ECONNREFUSED → fall back to file relay |

**The one trade-off:** events written before the server socket exists are lost unless we fall back to Option C. The fallback strategy (below) handles this.

---

## Fallback Strategy

Hook scripts try in order:

1. **Socket** — `net.connect(SOCKET_PATH)`, 500ms timeout. If connects: write JSON line, done.
2. **File relay** — `fs.appendFileSync(RELAY_PATH, ...)`. Used when socket unavailable (server starting, server down).
3. **HTTP** — existing circuit-breaker path. Used when file write also fails (disk full, permissions).

The server reads any backlog from the relay file on startup (same as Option C), so events written during startup are not lost.

This means Option B-lite is a superset of Option C — we implement C first, then add the socket layer on top.

---

## Implementation Steps

### S0 — Prerequisite: Option C must be implemented first

Option B-lite reuses `FileEventRelay`, `ingestEvent`, and the hook fallback chain from Option C. Do not implement B-lite without C in place.

### S1 — `packages/server/src/services/hookSocketRelay.ts` (new file)

```typescript
import net from 'net';
import { logger } from '../lib/logger.js';
import type { Broadcaster } from './broadcaster.js';
import { ingestEvent } from './eventIngestion.js';

export class HookSocketRelay {
  private server: net.Server;
  private socketPath: string;

  constructor(port: number, broadcaster: Broadcaster) {
    this.socketPath =
      process.platform === 'win32'
        ? `\\\\.\\pipe\\synapse-${port}`
        : path.join(os.tmpdir(), `synapse_${port}.sock`);

    this.server = net.createServer((socket) => {
      let buf = '';
      socket.on('data', (chunk) => {
        buf += chunk.toString();
      });
      socket.on('end', () => {
        for (const line of buf.split('\n')) {
          const trimmed = line.trim();
          if (!trimmed) continue;
          try {
            ingestEvent(JSON.parse(trimmed), broadcaster).catch((err) =>
              logger.error({ err }, 'HookSocketRelay: ingest failed'),
            );
          } catch {
            logger.warn({ line: trimmed.slice(0, 80) }, 'HookSocketRelay: malformed line');
          }
        }
      });
      socket.on('error', () => {
        /* client disconnected abruptly — fine */
      });
    });
  }

  start(): void {
    // Remove stale socket file from previous run (Unix only — Windows pipes are ephemeral)
    if (process.platform !== 'win32') {
      try {
        fs.unlinkSync(this.socketPath);
      } catch {
        /* didn't exist */
      }
    }
    this.server.listen(this.socketPath, () => {
      logger.info({ path: this.socketPath }, 'Hook socket relay listening');
    });
    this.server.on('error', (err) => {
      logger.error({ err }, 'Hook socket relay error — hooks fall back to file relay');
    });
  }

  stop(): void {
    this.server.close();
    if (process.platform !== 'win32') {
      try {
        fs.unlinkSync(this.socketPath);
      } catch {
        /* already gone */
      }
    }
  }

  get path(): string {
    return this.socketPath;
  }
}
```

### S2 — Update `hooks/send_event.cjs`

Add socket as primary path before the file relay fallback:

```js
const SOCKET_PATH =
  process.platform === 'win32'
    ? `\\\\.\\pipe\\synapse-${basePort}`
    : path.join(os.tmpdir(), `synapse_${basePort}.sock`);
const RELAY_PATH =
  process.env.SYNAPSE_RELAY_FILE || path.join(os.tmpdir(), `synapse_relay_${basePort}.jsonl`);

async function trySendSocket(line) {
  return new Promise((resolve, reject) => {
    const client = net.connect(SOCKET_PATH);
    client.setTimeout(500);
    client.on('connect', () => {
      client.end(line + '\n');
      resolve();
    });
    client.on('timeout', () => {
      client.destroy();
      reject(new Error('timeout'));
    });
    client.on('error', reject);
  });
}

async function main() {
  // ... read stdin, parse JSON (same as now) ...
  const line = JSON.stringify(event);

  // 1. Try socket
  try {
    await trySendSocket(line);
    return;
  } catch {
    /* fall through */
  }

  // 2. Try file relay
  try {
    fs.appendFileSync(RELAY_PATH, line + '\n');
    return;
  } catch {
    /* fall through */
  }

  // 3. HTTP fallback with circuit breaker (existing logic)
  await trySendHttp(line);
}
```

### S3 — Update `hooks/send_response.cjs`

Same three-tier fallback as S2.

### S4 — Wire socket relay into `packages/server/src/index.ts`

```typescript
import { HookSocketRelay } from './services/hookSocketRelay.js';

const socketRelay = new HookSocketRelay(SYNAPSE_PORT, broadcaster);
socketRelay.start(); // after relay.start()
```

In `shutdown()`: `socketRelay.stop()` before `relay.stop()`.

### S5 — Sync hook copies to `apps/vscode/resources/synapse-server/hooks/`

Same as Option C S5.

---

## Files Changed (incremental over Option C)

| File                                                           | Change                                                 |
| -------------------------------------------------------------- | ------------------------------------------------------ |
| `packages/server/src/services/hookSocketRelay.ts`              | **New** — socket listener                              |
| `packages/server/src/index.ts`                                 | Wire in `HookSocketRelay`                              |
| `hooks/send_event.cjs`                                         | Add socket as primary path (file relay becomes tier 2) |
| `hooks/send_response.cjs`                                      | Same                                                   |
| `apps/vscode/resources/synapse-server/hooks/send_event.cjs`    | Sync copy                                              |
| `apps/vscode/resources/synapse-server/hooks/send_response.cjs` | Sync copy                                              |

No other changes — `hookManager.ts`, frontend, WS, extension all unchanged.

---

## Testing

1. **Socket delivery**: send event via `net.connect`, verify `onEvent` fires in < 5ms.
2. **Fallback to file relay**: stop socket relay, send event, verify it appears in relay file.
3. **Backlog replay**: write to relay file while socket is down, start socket relay, verify backlog ingested on server start.
4. **Stale socket cleanup**: leave a stale `.sock` file, restart server, verify it starts cleanly.
5. **Windows named pipe**: manual test on Windows — verify hook connects and delivers.
6. **All 798 existing tests**: must continue to pass.

---

## When to Switch

Switch from Option C to Option B-lite if:

- Dashboard graph updates feel choppy during live sessions (batch arrivals visible)
- `fs.watch` misses events on a specific OS/filesystem (observed via missing nodes)
- Per-event latency in the output channel shows > 200ms consistently

Option B-lite is a strict superset — Option C stays in place as the fallback layer.
