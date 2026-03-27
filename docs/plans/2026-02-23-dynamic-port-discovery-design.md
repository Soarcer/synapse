# Dynamic Port Discovery for Vite Dev Server

**Date:** 2026-02-23
**Status:** Approved

## Problem

The Vite dev server proxy targets are set at startup and never update. When the Synapse backend restarts on a different port (auto-increment due to busy port, or manual change), the frontend loses connectivity. Additionally, the WebSocket client in dev mode hardcodes `ws://localhost:4000/ws`, bypassing the Vite proxy entirely.

The server already writes its actual port to `.claude/.synapse-port`, and the hook script reads it dynamically — but the frontend doesn't use this mechanism.

## Requirements

- Frontend auto-reconnects when server port changes (no manual env vars or browser refresh)
- Works regardless of restart order (server-only, client-only, or both)
- Minimal code changes

## Design

### Change 1: Fix WebSocket hardcoding in `wsClient.ts`

**File:** `apps/dashboard/src/store/wsClient.ts:157`

**Before:**

```typescript
import.meta.env.DEV
  ? `ws://${window.location.hostname}:4000/ws`
```

**After:**

```typescript
import.meta.env.DEV
  ? `ws://${window.location.host}/ws`
```

Using `window.location.host` (which includes the port) routes the WebSocket through the Vite dev server proxy, just like `/api` requests already do. In production, the existing logic is unchanged.

### Change 2: Port-watcher Vite plugin in `vite.config.ts`

An inline Vite plugin (~25 lines) added to the `plugins` array:

1. **Startup:** Reads `.claude/.synapse-port` to determine the initial proxy target. Falls back to `SYNAPSE_PORT` env var → `PORT` env var → `4000`.
2. **Watch:** Uses `fs.watchFile()` on `.claude/.synapse-port` to detect port changes.
3. **React:** On file change, reads new port and calls `server.restart()` to reload the Vite dev server with the updated proxy target.
4. **Cleanup:** Removes the file watcher on server close.

The `server.restart()` triggers an HMR full-reload in the browser (~2 seconds), which reinitializes the WebSocket connection through the new proxy target.

## Runtime Flow

1. Backend starts on port 4027 → writes `4027` to `.claude/.synapse-port`
2. Vite starts → plugin reads file → proxy targets set to `localhost:4027`
3. Frontend loads → `/ws` WebSocket goes through Vite proxy → connects to backend
4. Backend restarts on port 4028 → writes `4028` to `.claude/.synapse-port`
5. Plugin detects file change → `server.restart()` → proxy targets now `localhost:4028`
6. Browser gets HMR reload → WebSocket reconnects through new proxy

## Files Changed

| File                                   | Change                                                                         |
| -------------------------------------- | ------------------------------------------------------------------------------ |
| `apps/dashboard/src/store/wsClient.ts` | Replace `hostname}:4000` with `host}` (1 line)                                 |
| `apps/dashboard/vite.config.ts`        | Add `synapsePortWatcher` plugin (~25 lines), refactor port reading to use file |

## What This Doesn't Change

- Production builds (no Vite proxy involved — uses `VITE_API_ORIGIN` / `VITE_WS_URL`)
- VS Code extension (has its own port management)
- Hook script (already reads `.synapse-port`)
- Server startup logic (already writes `.synapse-port`)
