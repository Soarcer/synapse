# Config Single Source of Truth

**Date:** 2026-03-13
**Status:** Reviewed
**Branch:** feat/config-single-source-of-truth

## Problem

Port numbers, TLS settings, and proxy URLs are scattered across 10+ files with independent derivation logic. When one piece changes (e.g., TLS enabled in `.env`), others don't adapt, causing silent failures — "socket hang up", 404s, or wrong protocol. This has broken the dev setup multiple times across sessions.

### Current State

| Setting        | Defined in        | Default                    | Problem                                                      |
| -------------- | ----------------- | -------------------------- | ------------------------------------------------------------ |
| Server port    | `server/index.ts` | `27246`                    | `.env.example` says `4000`, Vite plugin falls back to `4000` |
| Hook port      | `hookServer.ts`   | `27247` via env var        | `HookControlsTab.tsx` hardcodes `27247`                      |
| TLS detection  | `server/index.ts` | checks cert+key+exists     | `vite.config.ts` only checks cert env var                    |
| Proxy protocol | `vite.config.ts`  | `http` (was hardcoded)     | Didn't match when server used HTTPS                          |
| Port discovery | `synapsePort.ts`  | file → file → env → `4000` | Stale `.synapse-port` files cause silent misrouting          |

Six env vars control ports (`PORT`, `SYNAPSE_PORT`, `SYNAPSE_HOOK_PORT`, `VITE_DEV_PORT`, `SYNAPSE_URL`, `VITE_API_ORIGIN`), three of which overlap. The `.synapse-port` file mechanism adds a coordination layer that breaks when the server crashes without cleanup.

## Solution

**One config module, one env var for ports, one env var pair for TLS.** Every component reads from the same source. No file-based port discovery. Fail loudly if a port is busy.

## Design

### 1. New Module: `packages/core/src/config.ts`

```typescript
/**
 * Single source of truth for Synapse network configuration.
 * Server-side / build-time only — do NOT import from browser code.
 * All port/TLS constants derived from at most 3 env vars.
 */

/** Base port — all service ports derive from this. */
export const SYNAPSE_PORT = parseAndValidatePort(process.env.SYNAPSE_PORT || '27246'); // <!-- revised: P1 — validate port range to prevent NaN/privileged ports -->

/** Hook server port (PermissionRequest blocking endpoint). */
export const HOOK_PORT = SYNAPSE_PORT + 1;

/** HTTP fallback for mobile Safari (only used when TLS enabled). */
export const HTTP_FALLBACK_PORT = SYNAPSE_PORT + 2;

/** Vite dev server port (only relevant in development). */
export const DEV_PORT = parseInt(process.env.VITE_DEV_PORT || '5173', 10);

/** Whether TLS is configured. Both cert and key must be set. */
export const USE_TLS = !!(process.env.SYNAPSE_TLS_CERT && process.env.SYNAPSE_TLS_KEY);

/** Protocol string for URL construction. */
export const PROTOCOL = USE_TLS ? 'https' : 'http';

/** WebSocket protocol string. */
export const WS_PROTOCOL = USE_TLS ? 'wss' : 'ws';

/** Parse and validate a port string. Throws on invalid/privileged ports. */
function parseAndValidatePort(raw: string): number {
  const port = parseInt(raw, 10);
  if (!Number.isFinite(port) || port < 1024 || port > 65533) {
    throw new Error(`Invalid SYNAPSE_PORT="${raw}". Must be 1024–65533 (need +2 headroom).`);
  }
  return port;
}
```

Export from `packages/core/src/index.ts` via the main barrel.

**Important:** This module reads `process.env` and must only be imported in Node.js contexts (server, build-time config, CLI). Never import in browser-side dashboard code — the dashboard uses relative URLs and the Vite proxy, so it has no need for port/TLS constants.

**Two-layer TLS check:** `config.ts` provides intent (`USE_TLS` = env vars are set). The server's `index.ts` additionally validates that the cert files exist on disk via `fs.existsSync()`. This separation is intentional — `config.ts` must stay free of `fs` dependencies since it's in the shared `@synapse-ai/core` package.

### 2. Files to Modify

#### `packages/server/src/index.ts`

**Before:** Reads `process.env.PORT || '27246'`, runs `tryListen()` auto-increment loop (20 retries), writes `.synapse-port` file on success.

**After:**

- Import `SYNAPSE_PORT, HOOK_PORT, HTTP_FALLBACK_PORT, USE_TLS` from `@synapse-ai/core`
- Bind to `SYNAPSE_PORT` directly
- On `EADDRINUSE`: log error with instructions, `process.exit(1)`
- Remove `tryListen()` function
- Remove `.synapse-port` file write
- Remove `.synapse-port` cleanup on shutdown

**Fail-loud error message:**

```
ERROR: Port 27246 is already in use.
Is another Synapse instance running?

To use a different port:
  $env:SYNAPSE_PORT=27300; .\start-server.ps1

All three services will shift together:
  Server:   27300
  Hooks:    27301
  Fallback: 27302
```

#### `packages/server/src/hookServer.ts`

**Before:** `parseInt(process.env.SYNAPSE_HOOK_PORT ?? '27247', 10)`, `mainPort = 27246` in deps interface.

**After:**

- Import `HOOK_PORT` from `@synapse-ai/core`
- Remove `SYNAPSE_HOOK_PORT` env var read
- Remove `mainPort` from `HookAppDeps` — use `SYNAPSE_PORT` from config
- Export `HOOK_PORT` for use in index.ts listen call

#### `apps/dashboard/vite.config.ts`

**Before:** Imports `readServerPort` and `synapsePortWatcher` from local plugin. Derives protocol from `SYNAPSE_TLS_CERT` env var independently.

**After:**

```typescript
import { SYNAPSE_PORT, DEV_PORT, PROTOCOL, WS_PROTOCOL } from '@synapse-ai/core';

const proxyTarget = `${PROTOCOL}://127.0.0.1:${SYNAPSE_PORT}`;
const wsTarget = `${WS_PROTOCOL}://127.0.0.1:${SYNAPSE_PORT}`;

export default defineConfig({
  root: import.meta.dirname,
  plugins: [react(), tailwindcss()],
  server: {
    port: DEV_PORT,
    host: true,
    proxy: {
      '/api': { target: proxyTarget, secure: false },
      '/ws': { target: wsTarget, ws: true, secure: false },
    },
  },
  // ... build config unchanged
});
```

No more `synapsePortWatcher()` plugin.

#### `apps/dashboard/vite-plugins/synapsePort.ts`

**Delete this file entirely.** Its two responsibilities (port discovery and file watching) are eliminated by the fixed-port approach.

#### `hooks/send_event.cjs`

This is a plain CJS script with zero dependencies — it cannot import from `@synapse-ai/core`. It reads env vars directly.

**Before:** Three-step file discovery chain (`.synapse-port` → `~/.synapse/port` → CLI arg → `4000` default).

**After:**

```javascript
// <!-- revised: P1 — detect TLS to avoid protocol mismatch with HTTPS server -->
const port = process.env.SYNAPSE_PORT || '27246';
const protocol = process.env.SYNAPSE_TLS_CERT ? 'https' : 'http';
const url = process.env.SYNAPSE_URL || `${protocol}://localhost:${port}/api/events`;
```

Three lines. No file I/O. `SYNAPSE_URL` kept as an escape hatch for unusual setups.

**Note on env var availability:** Hook scripts run in Claude Code's process, not Synapse's. Claude Code does NOT load Synapse's `.env`. For the default port (27246) with no TLS, this works out of the box since the fallback is correct. For non-default ports or TLS, the user must either: (a) set `SYNAPSE_PORT`/`SYNAPSE_TLS_CERT` in their shell profile, or (b) use `SYNAPSE_URL` in the `.claude/settings.json` hook config's `command` field as an env prefix. Document this in the migration path.

#### `apps/vscode/src/serverManager.ts`

**Before:** Reads port from VS Code settings, writes `~/.synapse/port` and `.claude/.synapse-port` files, has `writePortFile`/`readPortFile` functions.

**After:**

- Import `SYNAPSE_PORT, HOOK_PORT` from `@synapse-ai/core`
- Remove `writePortFile()` and all port file writes
- Remove port file cleanup from `dispose()`
- Server binds to `SYNAPSE_PORT` directly (same fail-loud behavior)

#### `apps/vscode/src/hookManager.ts`

**Before:** Writes `.synapse-port` in workspace `.claude/` directory.

**After:** Remove `writePortFile()` call. Port is known statically.

#### `apps/dashboard/src/components/settings/HookControlsTab.tsx`

**Before:** Hardcoded `27247` in config snippet and fallback.

**After:** Fetch hook port from `GET /api/hook-server/status` (already returns `port`). Use that in the config snippet dynamically. Instant fallback: derive as `parseInt(window.location.port) + 1` to avoid blank loading state while the API call completes. <!-- revised: P1 — avoid loading spinner for config snippet -->

#### `hooks/send_gemini_event.cjs` and `hooks/send_codex_event.cjs`

Same change as `send_event.cjs` — replace file discovery chain with two-line env var read. These are separate hook scripts for Gemini CLI and Codex CLI adapters.

#### `packages/cli/src/daemon.ts`

**Before:** Passes `PORT` and `CLIENT_ORIGIN` env vars to spawned server, writes `~/.synapse/port`.

**After:**

- Pass `SYNAPSE_PORT` instead of `PORT` to spawned server process
- Remove `CLIENT_ORIGIN` (server always uses `*` for CORS)
- Remove port file write (`~/.synapse/port`)

#### `packages/cli/src/paths.ts`

**Before:** Exports `GLOBAL_PORT_FILE` and `projectPortFile()`.

**After:** Remove both exports. Update any callers to use `SYNAPSE_PORT` from config.

#### `packages/cli/src/hookSetup.ts`

**Before:** Calls `projectPortFile(cwd)` to write `.synapse-port`.

**After:** Remove the write call. Port is known statically from `SYNAPSE_PORT`.

#### `bin/synapse.mjs`

Update help text: change `PORT` default from `4000` to `SYNAPSE_PORT` default `27246`. Update `SYNAPSE_URL` default to `localhost:27246`.

#### `apps/vscode/package.json`

Update `synapse.port` setting default from `4000` to `27246`. The VS Code setting is kept as an override (passed as `SYNAPSE_PORT` env var to spawned server, not `PORT`).

#### `apps/vscode/src/serverManager.ts` (additional detail)

**Before:** Reads port from VS Code setting `synapse.port` (default `4000`), passes `PORT: String(this._port)` to spawned server, parses `SYNAPSE_PORT=X` from stdout.

**After:**

- Pass `SYNAPSE_PORT` instead of `PORT` to spawned server env
- Default from VS Code setting updated to `27246`
- Stdout parsing of `SYNAPSE_PORT=X` kept for startup confirmation logging (but not used for discovery — port is already known)

#### `packages/server/src/app.ts`

**Before:** CORS origin chain: `deps.corsOrigins || process.env.CORS_ORIGIN || process.env.CLIENT_ORIGIN || '*'`

**After:** Simplify to `deps.corsOrigins || '*'`. Remove `CORS_ORIGIN` and `CLIENT_ORIGIN` env var reads. The server is always localhost-only; CORS wildcard is correct.

#### `apps/dashboard/src/App.tsx`

Remove `synapse:port-changing` HMR event listener (dead code after deleting the Vite plugin that emitted it).

#### `apps/dashboard/src/components/graph/AgentGraph.tsx`

Remove `synapse:port-changing` HMR event listener (saves viewport to sessionStorage — dead code after plugin removal).

#### `apps/dashboard/src/store/wsClient.ts`

No change needed — already derives protocol from `window.location.protocol` at runtime, which is correct for both dev (Vite proxy) and production (direct HTTPS). Remove `VITE_WS_URL` env var check (vestigial escape hatch that's never used).

#### `apps/dashboard/src/utils/api.ts`

No change needed — already uses relative URLs (`/api/...`) which go through the Vite proxy in dev.

### 3. Files to Delete

| File                                              | Reason                                           |
| ------------------------------------------------- | ------------------------------------------------ |
| `apps/dashboard/vite-plugins/synapsePort.ts`      | Port discovery and file watcher no longer needed |
| `apps/dashboard/vite-plugins/synapsePort.test.ts` | Tests for deleted file                           |

### 4. Env Vars: Before and After

#### Removed

| Variable            | Was used by    | Replaced by                                              |
| ------------------- | -------------- | -------------------------------------------------------- |
| `PORT`              | server, daemon | `SYNAPSE_PORT`                                           |
| `SYNAPSE_HOOK_PORT` | hook server    | `SYNAPSE_PORT + 1` (automatic)                           |
| `SYNAPSE_URL`       | hook script    | Kept as escape hatch only                                |
| `VITE_API_ORIGIN`   | dashboard      | Eliminated (uses Vite proxy)                             |
| `VITE_WS_ORIGIN`    | unused         | Eliminated                                               |
| `VITE_WS_URL`       | wsClient.ts    | Eliminated (derives from `window.location`)              |
| `CLIENT_ORIGIN`     | server CORS    | Eliminated (always `*` for localhost server)             |
| `CORS_ORIGIN`       | server CORS    | Eliminated (always `*` for localhost server)             |
| `AGENTVIZ_URL`      | send_event.cjs | Eliminated (legacy name, use `SYNAPSE_URL` escape hatch) |

#### Unchanged (out of scope)

| Variable            | Used by      | Notes                                                   |
| ------------------- | ------------ | ------------------------------------------------------- |
| `HOST`              | server       | Keep — controls bind address (`0.0.0.0` vs `127.0.0.1`) |
| `SYNAPSE_API_KEY`   | server       | Keep — API authentication, unrelated to ports/TLS       |
| `SYNAPSE_DEBUG`     | hook scripts | Keep — debug logging, unrelated to ports/TLS            |
| `ANTHROPIC_API_KEY` | Agent SDK    | Keep — needed for agent spawning                        |

#### Kept

| Variable            | Used by        | Default | Purpose                               |
| ------------------- | -------------- | ------- | ------------------------------------- |
| `SYNAPSE_PORT`      | all components | `27246` | Base port (hooks = +1, fallback = +2) |
| `SYNAPSE_TLS_CERT`  | server, vite   | none    | Path to TLS certificate               |
| `SYNAPSE_TLS_KEY`   | server, vite   | none    | Path to TLS private key               |
| `VITE_DEV_PORT`     | vite           | `5173`  | Dev server port                       |
| `VAPID_PUBLIC_KEY`  | server         | none    | Push notification VAPID key           |
| `VAPID_PRIVATE_KEY` | server         | none    | Push notification VAPID key           |
| `VAPID_SUBJECT`     | server         | none    | Push notification VAPID subject       |

### 5. `.env.example` (Updated)

```env
# ── Agent SDK (optional, needed for spawning agents) ──
# ANTHROPIC_API_KEY=sk-ant-...

# ── Synapse Server ────────────────────────────────────
# Base port. Hooks = +1, HTTP fallback = +2.
SYNAPSE_PORT=27246

# ── TLS (optional, needed for push notifications on LAN) ──
# Generate with: mkcert <your-lan-ip> localhost 127.0.0.1 ::1
# SYNAPSE_TLS_CERT=./packages/server/192.168.1.99+3.pem
# SYNAPSE_TLS_KEY=./packages/server/192.168.1.99+3-key.pem

# ── Push Notifications (optional) ─────────────────────
# Generate with: npx web-push generate-vapid-keys
# VAPID_PUBLIC_KEY=
# VAPID_PRIVATE_KEY=
# VAPID_SUBJECT=mailto:you@example.com

# ── Development ───────────────────────────────────────
# Vite dev server port (only used by start-client.ps1)
# VITE_DEV_PORT=5173
```

### 6. Port File Removal Checklist

| Location                     | Action                                                           |
| ---------------------------- | ---------------------------------------------------------------- |
| `.claude/.synapse-port`      | Stop writing; add to `.gitignore` comment explaining it's legacy |
| `~/.synapse/port`            | Stop writing in VS Code extension                                |
| `server/index.ts` write      | Remove                                                           |
| `serverManager.ts` write     | Remove                                                           |
| `hookManager.ts` write       | Remove                                                           |
| `synapsePort.ts` read        | Delete file                                                      |
| `send_event.cjs` read        | Replace with env var                                             |
| `send_gemini_event.cjs` read | Replace with env var                                             |
| `send_codex_event.cjs` read  | Replace with env var                                             |
| `daemon.ts` write            | Remove                                                           |
| `hookSetup.ts` write         | Remove                                                           |
| `paths.ts` exports           | Remove `GLOBAL_PORT_FILE`, `projectPortFile()`                   |

### 7. Risk Assessment

| Risk                                                  | Mitigation                                                 |
| ----------------------------------------------------- | ---------------------------------------------------------- |
| Existing `.synapse-port` files confuse old clients    | Old files are inert — nothing reads them after this change |
| `send_event.cjs` can't import from `@synapse-ai/core` | Reads `SYNAPSE_PORT` env var directly (2 lines)            |
| User has `PORT=4000` in their `.env`                  | Migration: rename to `SYNAPSE_PORT` in `.env`, update docs |
| Two instances needed (rare)                           | Error message explains `SYNAPSE_PORT` override             |
| VS Code extension settings had configurable port      | Default to `27246`, honor `SYNAPSE_PORT` env var if set    |

### 8. Testing Strategy

- **Unit test `config.ts`**: verify defaults, verify `SYNAPSE_PORT` override shifts all three ports, verify TLS detection requires both cert and key
- **Unit test `send_event.cjs`**: with `SYNAPSE_PORT=27300`, verify the hook POSTs to port 27300
- **Integration smoke test script** (`scripts/smoke-test-dev.ts`): start server, verify all three ports respond, verify Vite proxy connects, verify WS upgrade works. Run this in CI and before infrastructure commits.
- **VS Code extension**: verify `SYNAPSE_PORT` env var reaches the spawned server process (check spawned env in `serverManager.ts`)
- **Update existing tests**: replace any hardcoded `4000` port references with `27246`
- **Manual test**: `start-server.ps1` + `start-client.ps1` + browser — dashboard loads, WS connects, no proxy errors

### 8a. esbuild Consideration <!-- revised: P0 — esbuild inlining risk -->

The VS Code extension bundles `server.mjs` via esbuild. After this change, `packages/server/src/index.ts` imports from `@synapse-ai/core/config`. The esbuild step must resolve `@synapse-ai/core` imports — this already works for existing imports like `normalizeCwd`.

**Critical:** esbuild must NOT inline `process.env.SYNAPSE_PORT` as a build-time constant. Since the server bundle uses `platform: 'node'`, `process.env` reads are preserved as runtime calls (esbuild only replaces `process.env.X` when `define` is explicitly configured). Verify this by:

1. Building the extension: `cd apps/vscode && pnpm run package`
2. Grepping the bundle: `grep 'process.env.SYNAPSE_PORT' resources/synapse-server/server.mjs`
3. Confirming it appears as a runtime read, not a baked-in `"27246"`

Add this as an automated check in the smoke test script.

### 8b. Multi-port EADDRINUSE <!-- revised: P1 — check all three ports -->

The fail-loud approach must check all three ports, not just the main one. If port+1 or port+2 is busy (occupied by an unrelated service), the error must be equally clear:

```
ERROR: Port 27247 (hook server) is already in use.
This is SYNAPSE_PORT (27246) + 1.
```

Implementation: attempt to bind all three ports before starting any services. If any fails, report which one and exit.

### 9. Acceptance Criteria <!-- revised: P1 — missing success metric -->

After this change:

- A fresh clone → `pnpm install` → `start-server.ps1` + `start-client.ps1` works with zero configuration
- With TLS: adding `SYNAPSE_TLS_CERT` and `SYNAPSE_TLS_KEY` to `.env` is the only extra step
- `SYNAPSE_PORT=27300` shifts all three services consistently across server, hooks, Vite proxy, and hook scripts
- Wrong port value (`SYNAPSE_PORT=abc`) fails immediately with a clear error
- Port busy fails immediately with a clear error naming the exact port

### 10. Migration Path

This is a breaking change for anyone with a custom `.env` using `PORT` instead of `SYNAPSE_PORT`. Since this is pre-release, the migration is:

1. Update `.env`: rename `PORT` → `SYNAPSE_PORT` (or remove — default is `27246`)
2. Remove `SYNAPSE_HOOK_PORT` if set (now automatic)
3. Delete stale `.claude/.synapse-port` and `~/.synapse/port` files (optional, they're just ignored)
4. For non-default ports with hook scripts: set `SYNAPSE_PORT` in shell profile or use `SYNAPSE_URL` in hook config

### 11. Out of Scope

- Changing the three-port architecture itself
- Moving TLS cert files to a different location
- Adding service discovery or mDNS
- Multi-instance support (explicit non-goal; use `SYNAPSE_PORT` override)

### Open Questions / Deferred (P2)

- **Dead `SYNAPSE_PORT=X` stdout protocol line**: After removing auto-increment, the stdout line is redundant (consumers already know the port). Consider removing it and simplifying the parsers in `serverManager.ts` and `daemon.ts`, or keep it for backward compatibility. Low risk either way.
- **Error message is PowerShell-specific**: The fail-loud message shows `$env:SYNAPSE_PORT=27300; .\start-server.ps1`. Future macOS/Linux users would need `SYNAPSE_PORT=27300 ./start-server.sh`. Could detect OS and show appropriate syntax, or show both. Minor polish.
- **`vite-plugins/` directory**: After deleting `synapsePort.ts` and its test, the directory may be empty. Delete it if so.
