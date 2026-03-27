# Config Single Source of Truth — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Consolidate scattered port/TLS/proxy configuration (10+ files, 6+ env vars) into one `config.ts` module in `@synapse-ai/core` with fixed ports and fail-loud behavior. Remove `.synapse-port` file discovery mechanism entirely.

**Architecture:** A new `packages/core/src/config.ts` module becomes the single source of truth for all port/TLS constants. All server-side consumers import from `@synapse-ai/core`. Hook scripts (plain CJS, no imports) read `SYNAPSE_PORT` env var directly. The `.synapse-port` file discovery chain and `synapsePort.ts` Vite plugin are deleted.

**Tech Stack:** TypeScript, Node.js, Vitest, Express 5, Vite 6, esbuild

**Spec:** `docs/superpowers/specs/2026-03-13-config-single-source-of-truth-design.md`

**Key Risks:**

- **P0:** esbuild must preserve `process.env.SYNAPSE_PORT` as a runtime read in the VS Code extension bundle (not inline it). Verify after implementation.
- **P1:** Hook scripts run in Claude Code's process — TLS detection needs `SYNAPSE_TLS_CERT` check in `send_event.cjs`.
- **P1:** Multi-port EADDRINUSE — spec section 8b says pre-check all three ports. **Deviation:** This plan only fail-louds the main server port. Hook server and HTTP fallback use graceful degradation (warn, continue) because they are secondary services — matching existing behavior. This avoids killing the entire server when only a secondary port is blocked.
- **P1:** Hook scripts with TLS — if the server uses TLS, hooks in Claude Code's process won't have `SYNAPSE_TLS_CERT` set. Users must set `SYNAPSE_URL=https://localhost:27246/api/events` in their shell profile or hook config. Document this in migration path.
- **Constraint:** Do NOT modify infrastructure files beyond what the spec explicitly calls for. See `feedback_no_infra_changes.md`.

---

## Chunk 1: Core Config Module + Tests

### Task 1: Create `config.ts` with port/TLS constants

**Files:**

- Create: `packages/core/src/config.ts`
- Modify: `packages/core/src/index.ts`
- Test: `packages/core/src/__tests__/config.test.ts`

- [ ] **Step 1: Write failing tests for `config.ts`**

Create `packages/core/src/__tests__/config.test.ts`:

```typescript
// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Bernhard

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

describe('config', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    // Clear all relevant env vars before each test
    delete process.env.SYNAPSE_PORT;
    delete process.env.SYNAPSE_TLS_CERT;
    delete process.env.SYNAPSE_TLS_KEY;
    delete process.env.VITE_DEV_PORT;
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  // Helper: reset module cache so top-level const re-evaluates with new env vars
  async function loadConfig() {
    vi.resetModules();
    return import('../config.js');
  }

  describe('SYNAPSE_PORT', () => {
    it('defaults to 27246 when env var is not set', async () => {
      const config = await loadConfig();
      expect(config.SYNAPSE_PORT).toBe(27246);
    });

    it('reads SYNAPSE_PORT from env var', async () => {
      process.env.SYNAPSE_PORT = '27300';
      const config = await loadConfig();
      expect(config.SYNAPSE_PORT).toBe(27300);
    });

    it('throws on non-numeric SYNAPSE_PORT', async () => {
      process.env.SYNAPSE_PORT = 'abc';
      await expect(loadConfig()).rejects.toThrow('Invalid SYNAPSE_PORT="abc"');
    });

    it('throws on privileged port (< 1024)', async () => {
      process.env.SYNAPSE_PORT = '80';
      await expect(loadConfig()).rejects.toThrow('Invalid SYNAPSE_PORT="80"');
    });

    it('throws on port too high (> 65533, needs +2 headroom)', async () => {
      process.env.SYNAPSE_PORT = '65534';
      await expect(loadConfig()).rejects.toThrow('Invalid SYNAPSE_PORT="65534"');
    });

    it('accepts port at upper boundary (65533)', async () => {
      process.env.SYNAPSE_PORT = '65533';
      const config = await loadConfig();
      expect(config.SYNAPSE_PORT).toBe(65533);
    });

    it('accepts port at lower boundary (1024)', async () => {
      process.env.SYNAPSE_PORT = '1024';
      const config = await loadConfig();
      expect(config.SYNAPSE_PORT).toBe(1024);
    });
  });

  describe('derived ports', () => {
    it('HOOK_PORT is SYNAPSE_PORT + 1', async () => {
      process.env.SYNAPSE_PORT = '27300';
      const config = await loadConfig();
      expect(config.HOOK_PORT).toBe(27301);
    });

    it('HTTP_FALLBACK_PORT is SYNAPSE_PORT + 2', async () => {
      process.env.SYNAPSE_PORT = '27300';
      const config = await loadConfig();
      expect(config.HTTP_FALLBACK_PORT).toBe(27302);
    });
  });

  describe('TLS detection', () => {
    it('USE_TLS is false when neither env var is set', async () => {
      const config = await loadConfig();
      expect(config.USE_TLS).toBe(false);
    });

    it('USE_TLS is false when only cert is set', async () => {
      process.env.SYNAPSE_TLS_CERT = './cert.pem';
      const config = await loadConfig();
      expect(config.USE_TLS).toBe(false);
    });

    it('USE_TLS is false when only key is set', async () => {
      process.env.SYNAPSE_TLS_KEY = './key.pem';
      const config = await loadConfig();
      expect(config.USE_TLS).toBe(false);
    });

    it('USE_TLS is true when both cert and key are set', async () => {
      process.env.SYNAPSE_TLS_CERT = './cert.pem';
      process.env.SYNAPSE_TLS_KEY = './key.pem';
      const config = await loadConfig();
      expect(config.USE_TLS).toBe(true);
    });
  });

  describe('protocol strings', () => {
    it('PROTOCOL is "http" without TLS', async () => {
      const config = await loadConfig();
      expect(config.PROTOCOL).toBe('http');
    });

    it('PROTOCOL is "https" with TLS', async () => {
      process.env.SYNAPSE_TLS_CERT = './cert.pem';
      process.env.SYNAPSE_TLS_KEY = './key.pem';
      const config = await loadConfig();
      expect(config.PROTOCOL).toBe('https');
    });

    it('WS_PROTOCOL is "ws" without TLS', async () => {
      const config = await loadConfig();
      expect(config.WS_PROTOCOL).toBe('ws');
    });

    it('WS_PROTOCOL is "wss" with TLS', async () => {
      process.env.SYNAPSE_TLS_CERT = './cert.pem';
      process.env.SYNAPSE_TLS_KEY = './key.pem';
      const config = await loadConfig();
      expect(config.WS_PROTOCOL).toBe('wss');
    });
  });

  describe('DEV_PORT', () => {
    it('defaults to 5173', async () => {
      const config = await loadConfig();
      expect(config.DEV_PORT).toBe(5173);
    });

    it('reads VITE_DEV_PORT from env var', async () => {
      process.env.VITE_DEV_PORT = '3000';
      const config = await loadConfig();
      expect(config.DEV_PORT).toBe(3000);
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/core && npx vitest run src/__tests__/config.test.ts`
Expected: FAIL — `../config.js` does not exist

- [ ] **Step 3: Create `packages/core/src/config.ts`**

```typescript
// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Bernhard

/**
 * Single source of truth for Synapse network configuration.
 * Server-side / build-time only — do NOT import from browser code.
 * All port/TLS constants derived from at most 3 env vars.
 */

/** Parse and validate a port string. Throws on invalid/privileged ports. */
function parseAndValidatePort(raw: string): number {
  const port = parseInt(raw, 10);
  if (!Number.isFinite(port) || port < 1024 || port > 65533) {
    throw new Error(`Invalid SYNAPSE_PORT="${raw}". Must be 1024–65533 (need +2 headroom).`);
  }
  return port;
}

/** Base port — all service ports derive from this. */
export const SYNAPSE_PORT = parseAndValidatePort(process.env.SYNAPSE_PORT || '27246');

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
```

- [ ] **Step 4: Export config from barrel**

In `packages/core/src/index.ts`, add at the end:

```typescript
// Network configuration (server-side only — do NOT import in browser code)
export {
  SYNAPSE_PORT,
  HOOK_PORT,
  HTTP_FALLBACK_PORT,
  DEV_PORT,
  USE_TLS,
  PROTOCOL,
  WS_PROTOCOL,
} from './config.js';
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd packages/core && npx vitest run src/__tests__/config.test.ts`
Expected: All 19 tests PASS

- [ ] **Step 6: Run full test suite to check no regressions**

Run: `pnpm test`
Expected: All existing tests still pass

- [ ] **Step 7: Commit**

```bash
git add packages/core/src/config.ts packages/core/src/__tests__/config.test.ts packages/core/src/index.ts
git commit -m "feat(core): add config.ts single source of truth for port/TLS constants"
```

---

## Chunk 2: Server + Hook Server Migration

### Task 2: Migrate `packages/server/src/index.ts` to use config

**Files:**

- Modify: `packages/server/src/index.ts:27,129-206,209,163`

This is the highest-risk file. The spec explicitly calls for changes here. Changes:

1. Replace `PORT` env var read with import from `@synapse-ai/core`
2. Replace `tryListen()` auto-increment with fail-loud bind
3. Remove `.synapse-port` file write
4. Update `HTTP_FALLBACK_PORT` to use imported constant
5. Remove `mainPort` from `createHookApp` call

- [ ] **Step 1: Replace port constant and imports**

In `packages/server/src/index.ts`, replace line 27:

```typescript
const PORT = parseInt(process.env.PORT || '27246', 10);
```

with:

```typescript
import {
  SYNAPSE_PORT,
  HOOK_PORT as CONFIG_HOOK_PORT,
  HTTP_FALLBACK_PORT,
  USE_TLS,
} from '@synapse-ai/core';
```

Note: Import as `CONFIG_HOOK_PORT` to avoid conflict with the existing `HOOK_PORT` imported from `./hookServer.js` on line 21. We will update that import in Task 3.

Also remove `import os from 'os';` (line 10) — it's only used in the HTTP fallback section which now uses the imported constant. Actually, keep it — it's still used for `selectLanIp(os.networkInterfaces())` on line 182.

- [ ] **Step 2: Replace `tryListen()` with fail-loud bind**

Remove the entire `tryListen` function (lines 129-155) and replace with a direct bind that exits on EADDRINUSE. Replace lines 127-160 with:

```typescript
// --- Start (fail-loud — no port auto-increment) ---

function failLoudBind(
  srv: import('http').Server,
  port: number,
  host: string,
  label: string,
): Promise<void> {
  return new Promise((resolve, reject) => {
    srv.once('error', (err: NodeJS.ErrnoException) => {
      if (err.code === 'EADDRINUSE') {
        logger.error({ port, label }, `Port ${port} (${label}) is already in use`);
        console.error(`
ERROR: Port ${port} (${label}) is already in use.
Is another Synapse instance running?

To use a different port:
  $env:SYNAPSE_PORT=${port + 100}; .\\start-server.ps1

All three services will shift together:
  Server:   ${port + 100}
  Hooks:    ${port + 101}
  Fallback: ${port + 102}
`);
        process.exit(1);
      }
      reject(err);
    });
    srv.once('listening', resolve);
    srv.listen(port, host);
  });
}

await failLoudBind(server, SYNAPSE_PORT, HOST, 'main server');
// Stdout protocol: VS Code extension parses this to learn the port
process.stdout.write(`SYNAPSE_PORT=${SYNAPSE_PORT}\n`);
logger.info({ host: HOST, port: SYNAPSE_PORT }, 'Synapse server started');
```

- [ ] **Step 3: Update HTTP fallback section**

Replace lines 162-195 (the HTTP fallback section). Change:

- `const HTTP_FALLBACK_PORT = actualPort + 2;` → remove (imported from config)
- Replace all `actualPort` references with `SYNAPSE_PORT`
- Use `failLoudBind` for the fallback server too, but with graceful degradation (warn, don't exit):

```typescript
// --- HTTP fallback for mobile Safari (self-signed certs block ES module loads in CORS mode) ---
if (httpFallbackServer) {
  try {
    await new Promise<void>((resolve, reject) => {
      httpFallbackServer!.once('error', (err: NodeJS.ErrnoException) => {
        if (err.code === 'EADDRINUSE') {
          logger.warn(
            { port: HTTP_FALLBACK_PORT },
            'HTTP fallback port in use — mobile may not load',
          );
          resolve();
        } else {
          reject(err);
        }
      });
      httpFallbackServer!.once('listening', resolve);
      httpFallbackServer!.listen(HTTP_FALLBACK_PORT, HOST);
    });
    if (httpFallbackServer.listening) {
      const lanIp = selectLanIp(os.networkInterfaces());
      const mobileUrl = lanIp
        ? `http://${lanIp}:${HTTP_FALLBACK_PORT}`
        : `http://localhost:${HTTP_FALLBACK_PORT}`;
      logger.info(
        { host: HOST, port: HTTP_FALLBACK_PORT, mobileUrl },
        'HTTP fallback started — use this URL on mobile Safari',
      );
    }
  } catch (err) {
    logger.error({ err }, 'HTTP fallback server failed to start');
    httpFallbackServer = null;
  }
}
```

- [ ] **Step 4: Remove `.synapse-port` file write**

Delete lines 197-206:

```typescript
// Write port file for hook scripts and Vite dev server auto-discovery.
// ...
try {
  const claudeDir = path.join(process.cwd(), '.claude');
  fs.mkdirSync(claudeDir, { recursive: true });
  fs.writeFileSync(path.join(claudeDir, '.synapse-port'), String(actualPort));
} catch {
  logger.warn('Could not write .synapse-port — port auto-discovery may not work');
}
```

- [ ] **Step 5: Update hook server creation**

Replace line 209:

```typescript
const hookApp = createHookApp({ broadcaster, mainPort: actualPort });
```

with:

```typescript
const hookApp = createHookApp({ broadcaster });
```

And update ALL remaining `HOOK_PORT` references to use `CONFIG_HOOK_PORT`:

- Line 218: `{ port: HOOK_PORT }` in the warn log → `{ port: CONFIG_HOOK_PORT }`
- Line 230: `hookHttpServer.listen(HOOK_PORT, HOST)` → `hookHttpServer.listen(CONFIG_HOOK_PORT, HOST)`
- Line 233: `logger.info({ host: HOST, port: HOOK_PORT }` → `logger.info({ host: HOST, port: CONFIG_HOOK_PORT }`
- Line 56: `res.json({ running: hookServerRunning, port: HOOK_PORT, ...` → `res.json({ running: hookServerRunning, port: CONFIG_HOOK_PORT, ...`

- [ ] **Step 6: Clean up unused imports**

After all changes, check if `path` is still needed (yes — for `__dirname` and dashboard paths). Check if `fs` is still needed (yes — for TLS cert reads and dashboard static serving). Remove any now-unused imports.

Also, the `HOOK_PORT` import from `./hookServer.js` on line 21 can be removed since we now import from `@synapse-ai/core`. Update line 21:

```typescript
import { createHookApp } from './hookServer.js';
```

- [ ] **Step 7: Run tests**

Run: `pnpm test`
Expected: All tests pass

- [ ] **Step 8: Commit**

```bash
git add packages/server/src/index.ts
git commit -m "refactor(server): use config.ts for ports, fail-loud on EADDRINUSE, remove port file"
```

### Task 3: Migrate `packages/server/src/hookServer.ts` to use config

**Files:**

- Modify: `packages/server/src/hookServer.ts:14,16-19,29,100-102,131`

- [ ] **Step 1: Replace port constant with config import**

Replace line 14:

```typescript
const HOOK_PORT = parseInt(process.env.SYNAPSE_HOOK_PORT ?? '27247', 10);
```

with:

```typescript
import { HOOK_PORT, SYNAPSE_PORT, PROTOCOL } from '@synapse-ai/core';
```

- [ ] **Step 2: Remove `mainPort` from `HookAppDeps`**

In the `HookAppDeps` interface (lines 16-22), remove the `mainPort` field:

```typescript
export interface HookAppDeps {
  broadcaster: Broadcaster;
  /** Disable rate limiting (useful for tests) */
  disableRateLimiting?: boolean;
}
```

- [ ] **Step 3: Update `createHookApp` to use config constants**

Replace line 29:

```typescript
const { broadcaster, mainPort = 27246 } = deps;
```

with:

```typescript
const { broadcaster } = deps;
```

Replace lines 100-102 (push notification URL construction):

```typescript
const lanIp = selectLanIp(os.networkInterfaces()) ?? 'localhost';
const protocol = process.env.SYNAPSE_TLS_CERT ? 'https' : 'http';
const baseUrl = `${protocol}://${lanIp}:${mainPort}`;
```

with:

```typescript
const lanIp = selectLanIp(os.networkInterfaces()) ?? 'localhost';
const baseUrl = `${PROTOCOL}://${lanIp}:${SYNAPSE_PORT}`;
```

- [ ] **Step 4: Remove the re-export of `HOOK_PORT`**

Delete line 131:

```typescript
export { HOOK_PORT };
```

(It's now exported from `@synapse-ai/core`. Consumers import from there.)

- [ ] **Step 5: Run tests**

Run: `pnpm test`
Expected: All tests pass (hookServer tests may need `mainPort` removed from test fixtures)

- [ ] **Step 6: Fix any test fixtures**

Search for `mainPort` in test files:

```bash
grep -r "mainPort" packages/server/src/__tests__/
```

Update any test that passes `mainPort` to `createHookApp()` — remove the field from deps.

- [ ] **Step 7: Commit**

```bash
git add packages/server/src/hookServer.ts
git commit -m "refactor(server): hookServer uses config.ts, remove SYNAPSE_HOOK_PORT env var"
```

### Task 4: Simplify CORS in `packages/server/src/app.ts`

**Files:**

- Modify: `packages/server/src/app.ts:48-49`

- [ ] **Step 1: Simplify CORS origin chain**

Replace lines 48-49:

```typescript
const clientOrigin =
  deps.corsOrigins || process.env.CORS_ORIGIN || process.env.CLIENT_ORIGIN || '*';
```

with:

```typescript
const clientOrigin = deps.corsOrigins || '*';
```

- [ ] **Step 2: Run tests**

Run: `pnpm test`
Expected: All tests pass

- [ ] **Step 3: Commit**

```bash
git add packages/server/src/app.ts
git commit -m "refactor(server): simplify CORS to deps.corsOrigins || '*', remove env var reads"
```

---

## Chunk 3: Hook Scripts + Vite Config + Dashboard Cleanup

### Task 5: Simplify `hooks/send_event.cjs`

**Files:**

- Modify: `hooks/send_event.cjs:12-63`

- [ ] **Step 1: Replace port discovery chain with env var read**

Replace lines 12-63 (everything from the `os` require through the `SERVER_URL` IIFE) with:

```javascript
// Note: if the server uses TLS, set SYNAPSE_TLS_CERT in your shell profile
// or use SYNAPSE_URL=https://localhost:27246/api/events
const port = process.env.SYNAPSE_PORT || '27246';
const protocol = process.env.SYNAPSE_TLS_CERT ? 'https' : 'http';
const SERVER_URL = process.env.SYNAPSE_URL || `${protocol}://localhost:${port}/api/events`;
const DEBUG = process.env.SYNAPSE_DEBUG === '1';
const DEBUG_LOG = path.join(__dirname, '..', 'hook_debug.log');
```

Keep `fs` require (still needed by `debugLog` → `fs.appendFileSync`). Keep `path` require (used for `DEBUG_LOG`). Remove `os` require.

This removes:

- `os` require (no longer needed — no home dir lookup)
- `getCliPort()` function
- `getPortFromFile()` function
- `getGlobalPort()` function
- `AGENTVIZ_URL` deprecation warning
- The multi-step discovery IIFE

- [ ] **Step 2: Verify the rest of the file still works**

The `main()` function (lines 74-115) is unchanged — it reads stdin and POSTs to `SERVER_URL`. No modifications needed.

- [ ] **Step 3: Commit**

```bash
git add hooks/send_event.cjs
git commit -m "refactor(hooks): send_event.cjs uses SYNAPSE_PORT env var, remove file discovery"
```

### Task 6: Simplify `hooks/send_gemini_event.cjs`

**Files:**

- Modify: `hooks/send_gemini_event.cjs`

- [ ] **Step 1: Replace port discovery with env var read**

Same pattern as Task 5. Replace `getPortFromFile()`, `getGlobalPort()`, `getCliPort()` functions, and the `SERVER_URL` IIFE with:

```javascript
// Note: if the server uses TLS, set SYNAPSE_TLS_CERT in your shell profile
// or use SYNAPSE_URL=https://localhost:27246/api/events
const port = process.env.SYNAPSE_PORT || '27246';
const protocol = process.env.SYNAPSE_TLS_CERT ? 'https' : 'http';
const SERVER_URL = process.env.SYNAPSE_URL || `${protocol}://localhost:${port}/api/events`;
```

Keep `fs` (needed by `debugLog`) and `path` (needed for `DEBUG_LOG`). Remove `os` require.

- [ ] **Step 2: Commit**

```bash
git add hooks/send_gemini_event.cjs
git commit -m "refactor(hooks): send_gemini_event.cjs uses SYNAPSE_PORT env var, remove file discovery"
```

### Task 7: Simplify `hooks/send_codex_event.cjs`

**Files:**

- Modify: `hooks/send_codex_event.cjs`

- [ ] **Step 1: Replace port discovery with env var read**

Same pattern. Replace `getPortFromFile()` and the `SERVER_URL` IIFE with:

```javascript
// Note: if the server uses TLS, set SYNAPSE_TLS_CERT in your shell profile
// or use SYNAPSE_URL=https://localhost:27246/api/events
const port = process.env.SYNAPSE_PORT || '27246';
const protocol = process.env.SYNAPSE_TLS_CERT ? 'https' : 'http';
const SERVER_URL = process.env.SYNAPSE_URL || `${protocol}://localhost:${port}/api/events`;
```

Keep `fs` (needed by `debugLog`). Remove `os` require if no longer used.

- [ ] **Step 2: Commit**

```bash
git add hooks/send_codex_event.cjs
git commit -m "refactor(hooks): send_codex_event.cjs uses SYNAPSE_PORT env var, remove file discovery"
```

### Task 8: Migrate `apps/dashboard/vite.config.ts` to use config

**Files:**

- Modify: `apps/dashboard/vite.config.ts:7,13-16,20`

- [ ] **Step 1: Replace synapsePort import with config import**

Replace line 7:

```typescript
import { readServerPort, synapsePortWatcher } from './vite-plugins/synapsePort';
```

with:

```typescript
import { SYNAPSE_PORT, DEV_PORT, PROTOCOL, WS_PROTOCOL } from '@synapse-ai/core';
```

- [ ] **Step 2: Replace port/TLS derivation**

Replace lines 9-16:

```typescript
const devPort = Number.parseInt(process.env.VITE_DEV_PORT || '5173', 10);

// Read the initial server port at startup. The synapsePortWatcher plugin will
// call server.restart() if this changes while the dev server is running.
const serverPort = readServerPort();
const useTls = !!process.env.SYNAPSE_TLS_CERT;
const proxyTarget = `${useTls ? 'https' : 'http'}://127.0.0.1:${serverPort}`;
const wsTarget = `${useTls ? 'wss' : 'ws'}://127.0.0.1:${serverPort}`;
```

with:

```typescript
const proxyTarget = `${PROTOCOL}://127.0.0.1:${SYNAPSE_PORT}`;
const wsTarget = `${WS_PROTOCOL}://127.0.0.1:${SYNAPSE_PORT}`;
```

- [ ] **Step 3: Remove `synapsePortWatcher()` from plugins and update server.port**

Replace line 20:

```typescript
plugins: [react(), tailwindcss(), synapsePortWatcher()],
```

with:

```typescript
plugins: [react(), tailwindcss()],
```

Replace line 22:

```typescript
port: Number.isNaN(devPort) ? 5173 : devPort,
```

with:

```typescript
port: DEV_PORT,
```

- [ ] **Step 4: Commit**

```bash
git add apps/dashboard/vite.config.ts
git commit -m "refactor(dashboard): vite.config uses @synapse-ai/core config, remove port watcher"
```

### Task 9: Delete `synapsePort.ts` and its test

**Files:**

- Delete: `apps/dashboard/vite-plugins/synapsePort.ts`
- Delete: `apps/dashboard/vite-plugins/synapsePort.test.ts`

- [ ] **Step 1: Delete both files**

```bash
rm apps/dashboard/vite-plugins/synapsePort.ts
rm apps/dashboard/vite-plugins/synapsePort.test.ts
```

- [ ] **Step 2: Check if `vite-plugins/` directory is now empty**

```bash
ls apps/dashboard/vite-plugins/
```

If empty, delete the directory:

```bash
rmdir apps/dashboard/vite-plugins
```

- [ ] **Step 3: Commit**

```bash
git add -u apps/dashboard/vite-plugins/
git commit -m "refactor(dashboard): delete synapsePort.ts and its tests (replaced by config.ts)"
```

### Task 10: Remove HMR port-changing listeners from dashboard

**Files:**

- Modify: `apps/dashboard/src/App.tsx:102-110`
- Modify: `apps/dashboard/src/components/graph/AgentGraph.tsx:103-123`

- [ ] **Step 1: Remove port-changing HMR listener from App.tsx**

Remove lines 102-110 (the `useEffect` that listens for `synapse:port-changing`):

```typescript
// Inform the user when the Vite proxy is about to restart due to a server port change.
// The synapse:port-changing HMR event is sent by the synapsePortWatcher Vite plugin.
useEffect(() => {
  if (!import.meta.hot) return; // No-op in production builds
  const cleanup = import.meta.hot.on('synapse:port-changing', (data: { port: string }) => {
    toast(`Server restarted on port ${data.port} — reconnecting…`, 'info');
  });
  return cleanup;
}, []);
```

- [ ] **Step 2: Remove port-changing listeners from AgentGraph.tsx**

Remove lines 103-123 (two `useEffect` blocks — viewport restore and viewport save):

```typescript
// Restore viewport if we just returned from a port-change proxy restart.
useEffect(() => {
  const saved = sessionStorage.getItem('synapse-viewport');
  // ...
}, [setViewport]);

// Save viewport just before the Vite proxy restarts.
useEffect(() => {
  if (!import.meta.hot) return;
  const cleanup = import.meta.hot.on('synapse:port-changing', () => {
    sessionStorage.setItem('synapse-viewport', JSON.stringify(getViewport()));
  });
  return cleanup;
}, [getViewport]);
```

- [ ] **Step 3: Remove `VITE_WS_URL` env var check from `wsClient.ts`**

In `apps/dashboard/src/store/wsClient.ts`, replace lines 212-221:

```typescript
// Determine WS URL: allow override via VITE_WS_URL.
// Always use window.location.host (includes port), which routes through the
// Vite proxy in dev and hits the real origin in production. Never hardcode
// the backend port here — that bypassed the proxy and broke port auto-discovery.
const envWsUrl = import.meta.env.VITE_WS_URL as string | undefined;
const wsUrl = envWsUrl?.trim()
  ? envWsUrl
  : `ws${window.location.protocol === 'https:' ? 's' : ''}://${window.location.host}/ws`;

export const wsClient = new WSClient(wsUrl);
```

with:

```typescript
// WS URL: always use window.location.host (goes through Vite proxy in dev,
// hits real origin in production). Never hardcode the backend port here.
const wsUrl = `ws${window.location.protocol === 'https:' ? 's' : ''}://${window.location.host}/ws`;

export const wsClient = new WSClient(wsUrl);
```

- [ ] **Step 4: Run tests**

Run: `pnpm test`
Expected: All tests pass

- [ ] **Step 5: Commit**

```bash
git add apps/dashboard/src/App.tsx apps/dashboard/src/components/graph/AgentGraph.tsx apps/dashboard/src/store/wsClient.ts
git commit -m "refactor(dashboard): remove port-changing HMR listeners and VITE_WS_URL (dead code)"
```

### Task 11: Make `HookControlsTab.tsx` use dynamic port from API

**Files:**

- Modify: `apps/dashboard/src/components/settings/HookControlsTab.tsx:21-34,51`

- [ ] **Step 1: Replace hardcoded CONFIG_SNIPPET with dynamic version**

Replace the static `CONFIG_SNIPPET` constant (lines 21-34) with a function that takes a port:

```typescript
function buildConfigSnippet(hookPort: number): string {
  return JSON.stringify(
    {
      hooks: {
        PermissionRequest: [
          {
            type: 'http',
            url: `http://localhost:${hookPort}/api/hooks/permission`,
          },
        ],
      },
    },
    null,
    2,
  );
}
```

- [ ] **Step 2: Verify fallback port is correct**

Line 51 already uses `27247` as the fallback, which is `SYNAPSE_PORT(27246) + 1`. This is correct for the default port. In dev mode, `window.location.port` is `5173` (Vite), not the backend port, so deriving from it would give the wrong value. Keep the existing fallback as-is:

```typescript
if (!cancelled) setStatus({ running: false, port: 27247 });
```

The dynamic snippet (`buildConfigSnippet`) will use the correct port once the API call succeeds.

- [ ] **Step 3: Update handleCopy to use dynamic snippet**

Replace the `handleCopy` callback to use the dynamic snippet:

```typescript
const configSnippet = buildConfigSnippet(status?.port ?? 27247);

const handleCopy = useCallback(async () => {
  try {
    await navigator.clipboard.writeText(configSnippet);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  } catch {
    // Fallback — clipboard API unavailable
  }
}, [configSnippet]);
```

Also update any JSX that references `CONFIG_SNIPPET` to use `configSnippet` instead.

- [ ] **Step 4: Run tests**

Run: `pnpm test`
Expected: All tests pass

- [ ] **Step 5: Commit**

```bash
git add apps/dashboard/src/components/settings/HookControlsTab.tsx
git commit -m "refactor(dashboard): HookControlsTab uses dynamic port from API instead of hardcoded 27247"
```

---

## Chunk 4: VS Code Extension + CLI + Docs + Verification

### Task 12: Migrate `apps/vscode/src/serverManager.ts`

**Files:**

- Modify: `apps/vscode/src/serverManager.ts:11-35,65,101-118,139,155-163,219-222,260`

- [ ] **Step 1: Remove port file functions**

Delete lines 11-35 (the `SYNAPSE_HOME`, `GLOBAL_PORT_FILE`, `readPortFile()`, `writePortFile()`, `deletePortFile()` functions). These are replaced by static config.

- [ ] **Step 2: Update constructor default port**

Replace line 65:

```typescript
this._port = cfg.get('port', 4000);
```

with:

```typescript
this._port = cfg.get('port', 27246);
```

Also replace line 139 (same pattern in `start()`):

```typescript
this._port = cfg.get('port', 4000);
```

with:

```typescript
this._port = cfg.get('port', 27246);
```

- [ ] **Step 3: Remove daemon attachment logic**

Replace lines 100-118 (Step 1: Try to attach to existing CLI daemon) with a comment:

```typescript
// Port is known statically — no daemon attachment or port file discovery needed.
```

Or simply remove the block. The `start()` method should go straight to "start our own server".

- [ ] **Step 4: Update spawned server env vars**

Replace lines 155-163 (the `env` object):

```typescript
const env = {
  ...process.env,
  HOST: this._host,
  SYNAPSE_PORT: String(this._port),
  NODE_ENV: 'production',
  SYNAPSE_DASHBOARD_DIR: dashboardDir,
  SYNAPSE_DB_PATH: dbPath,
};
```

Changes: `PORT` → `SYNAPSE_PORT`, removed `CLIENT_ORIGIN: '*'`.

- [ ] **Step 5: Remove port file write after startup**

Replace lines 217-222:

```typescript
this._mode = 'owned';
// Write port file so CLI can discover this VS Code–managed server
writePortFile(this._port);
this.outputChannel.appendLine(
  `Wrote port file ${GLOBAL_PORT_FILE} (port ${this._port}) for CLI discovery`,
);
```

with:

```typescript
this._mode = 'owned';
```

- [ ] **Step 6: Remove port file delete from stop()**

Remove `deletePortFile();` from the `stop()` method (line 260).

- [ ] **Step 7: Remove unused os import**

Remove `import * as os from 'os';` if no longer used.

- [ ] **Step 8: Clean up dead `attached` mode code**

After removing daemon attachment, `_mode` will never be `'attached'`. Clean up:

- Remove the `'attached'` branch from `stop()` (lines 232-241)
- Remove the `isExternalServer` getter (lines 84-87) — it's marked deprecated
- Change `_mode` type from `'owned' | 'attached' | null` to `'owned' | null`
- Check `extension.ts` for references to `mode === 'attached'` and update (status bar labels like `(daemon)` should be removed)

- [ ] **Step 9: Commit**

```bash
git add apps/vscode/src/serverManager.ts apps/vscode/src/extension.ts
git commit -m "refactor(vscode): serverManager uses SYNAPSE_PORT env var, remove port file I/O and daemon attachment"
```

### Task 13: Migrate `apps/vscode/src/hookManager.ts`

**Files:**

- Modify: `apps/vscode/src/hookManager.ts:51,58-66,109-117`

- [ ] **Step 1: Remove `writePortFile` call**

Remove the call at line 51:

```typescript
this.writePortFile(claudeDir, port);
```

- [ ] **Step 2: Remove `writePortFile` method**

Delete the method at lines 58-66:

```typescript
writePortFile(claudeDir: string, port: number): void {
  try {
    fs.mkdirSync(claudeDir, { recursive: true });
    fs.writeFileSync(path.join(claudeDir, '.synapse-port'), String(port));
  } catch {
    /* best effort */
  }
}
```

- [ ] **Step 3: Remove port file read in `getHookStatus`**

Remove lines 109-117 (the fallback port file read in `getHookStatus`):

```typescript
// If no --port in command, read from port file
if (detectedPort === null) {
  try {
    const portFile = path.join(workspaceFolder.uri.fsPath, '.claude', '.synapse-port');
    const content = fs.readFileSync(portFile, 'utf-8').trim();
    detectedPort = parseInt(content, 10) || null;
  } catch {
    /* no port file */
  }
}
```

- [ ] **Step 4: Commit**

```bash
git add apps/vscode/src/hookManager.ts
git commit -m "refactor(vscode): hookManager removes port file writes and reads"
```

### Task 14: Update `apps/vscode/package.json` default port

**Files:**

- Modify: `apps/vscode/package.json`

- [ ] **Step 1: Update `synapse.port` setting default**

Find the `synapse.port` configuration in the `contributes.configuration` section and change the default from `4000` to `27246`.

- [ ] **Step 2: Commit**

```bash
git add apps/vscode/package.json
git commit -m "refactor(vscode): update default port from 4000 to 27246"
```

### Task 15: Migrate CLI (`packages/cli/`)

**Files:**

- Modify: `packages/cli/src/daemon.ts:10,12,30-37,44-47,49-60,142-149,176,195-205,275-290`
- Modify: `packages/cli/src/paths.ts:10,26-28`
- Modify: `packages/cli/src/hookSetup.ts:9,43-45`
- Modify: `bin/synapse.mjs:64,67-68,161,173-175`

- [ ] **Step 1: Update `paths.ts` — remove port file exports**

Remove line 10 and lines 26-28:

```typescript
export const GLOBAL_PORT_FILE = path.join(SYNAPSE_HOME, 'port');
// ...
export function projectPortFile(cwd: string): string {
  return path.join(projectClaudeDir(cwd), '.synapse-port');
}
```

Keep `SYNAPSE_HOME`, `GLOBAL_PID_FILE`, `GLOBAL_DB_PATH`, `projectClaudeDir`, `projectSettingsFile`, and all `DIST_DIR`/`SERVER_ENTRY`/etc.

- [ ] **Step 2: Update `daemon.ts` — remove port file I/O**

Remove import of `GLOBAL_PORT_FILE` from line 12.

Remove `readPort()` function (lines 30-37).

Remove `writePort()` function (lines 44-47).

Update `cleanupFiles()` (lines 49-60) — remove the `GLOBAL_PORT_FILE` unlink:

```typescript
function cleanupFiles(): void {
  try {
    fs.unlinkSync(GLOBAL_PID_FILE);
  } catch {
    /* ok */
  }
}
```

Add import at the top of `daemon.ts`:

```typescript
import { SYNAPSE_PORT } from '@synapse-ai/core';
```

Update `status()` — remove `readPort()` call, use `SYNAPSE_PORT` from config:

```typescript
export async function status(): Promise<{
  running: boolean;
  pid: number | null;
  port: number;
}> {
  const pid = readPid();

  if (pid && !isProcessAlive(pid)) {
    cleanupFiles();
    return { running: false, pid: null, port: SYNAPSE_PORT };
  }

  const healthy = await healthCheck(SYNAPSE_PORT);
  if (healthy) return { running: true, pid, port: SYNAPSE_PORT };

  if (pid) return { running: true, pid, port: SYNAPSE_PORT };

  return { running: false, pid: null, port: SYNAPSE_PORT };
}
```

Note: `@synapse-ai/core` must be added as a dependency of `packages/cli/package.json` if not already present.

Update `start()` env vars (lines 142-149):

```typescript
const env: Record<string, string> = {
  ...(process.env as Record<string, string>),
  HOST: 'localhost',
  SYNAPSE_PORT: String(preferredPort),
  NODE_ENV: 'production',
  SYNAPSE_DB_PATH: GLOBAL_DB_PATH,
};
```

Remove `CLIENT_ORIGIN: '*'` and change `PORT` to `SYNAPSE_PORT`.

Remove all `writePort()` calls (lines 176, 203, 221).

Simplify `waitForServer` — no port scanning, just check the one port:

```typescript
async function waitForServer(port: number, timeoutMs: number): Promise<number> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const ok = await healthCheck(port);
    if (ok) return port;
    await new Promise((r) => setTimeout(r, 500));
  }
  console.warn('Server did not respond to health check in time; assuming port', port);
  return port;
}
```

- [ ] **Step 3: Update `hookSetup.ts` — remove port file write**

Remove import of `projectPortFile` from line 9.

Remove lines 43-45 (the port file write in `configureHooks()`):

```typescript
// Write port file so hook scripts find the daemon
fs.mkdirSync(claudeDir, { recursive: true });
fs.writeFileSync(projectPortFile(cwd), String(port));
```

The `fs.mkdirSync(claudeDir, { recursive: true })` call should stay — it's needed for the settings file write on line 73.

- [ ] **Step 4: Update `bin/synapse.mjs` — fix defaults and help text**

Replace line 64:

```typescript
process.env.PORT = process.argv[portIdx + 1];
```

with:

```typescript
process.env.SYNAPSE_PORT = process.argv[portIdx + 1];
```

Replace line 67:

```typescript
const port = process.env.PORT || '4000';
```

with:

```typescript
const port = process.env.SYNAPSE_PORT || '27246';
```

Update help text (lines 161, 173-175):

```
    start [--port <port>]  Start the dashboard server (default: 27246)
```

```
    SYNAPSE_URL      Hook target URL (default: http://localhost:27246/api/events)
    SYNAPSE_PORT     Server port (default: 27246)
```

Remove the `PORT` line from environment section.

- [ ] **Step 5: Run tests**

Run: `pnpm test`
Expected: All tests pass

- [ ] **Step 6: Commit**

```bash
git add packages/cli/src/daemon.ts packages/cli/src/paths.ts packages/cli/src/hookSetup.ts bin/synapse.mjs
git commit -m "refactor(cli): use SYNAPSE_PORT, remove port file I/O and auto-increment scanning"
```

### Task 16: Update `.env.example`

**Files:**

- Modify: `.env.example`

- [ ] **Step 1: Replace `.env.example` content**

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

- [ ] **Step 2: Commit**

```bash
git add .env.example
git commit -m "docs: update .env.example — remove dead env vars, document SYNAPSE_PORT"
```

### Task 17: P0 Verification — esbuild bundle check

**Files:** (read-only verification)

- [ ] **Step 1: Build the VS Code extension**

Run: `cd apps/vscode && pnpm run package`

- [ ] **Step 2: Verify `process.env.SYNAPSE_PORT` is a runtime read**

Run: `grep 'process.env.SYNAPSE_PORT' apps/vscode/resources/synapse-server/server.mjs`

Expected: Should appear as `process.env.SYNAPSE_PORT` (runtime read), NOT as a baked-in `"27246"` string.

If it's inlined, check the esbuild config in the VS Code extension build for `define` overrides and fix them.

- [ ] **Step 3: Verify `process.env.SYNAPSE_TLS_CERT` is also preserved**

Run: `grep 'process.env.SYNAPSE_TLS' apps/vscode/resources/synapse-server/server.mjs`

Expected: Both `SYNAPSE_TLS_CERT` and `SYNAPSE_TLS_KEY` appear as runtime reads.

- [ ] **Step 4: Verify old `PORT` env var is gone**

Run: `grep -E 'process\.env\.PORT[^_]' apps/vscode/resources/synapse-server/server.mjs`

Expected: No matches — the old `process.env.PORT` should be fully replaced by `process.env.SYNAPSE_PORT`.

### Task 18: Manual smoke test

- [ ] **Step 1: Start server and verify all three ports**

Run: `.\start-server.ps1`
Expected output includes:

- `SYNAPSE_PORT=27246`
- Hook server started on 27247
- (HTTP fallback only if TLS configured)

- [ ] **Step 2: Start client and verify proxy connects**

Run: `.\start-client.ps1`
Navigate to `http://localhost:5173` — dashboard should load, WS should connect (green indicator).

- [ ] **Step 3: Test fail-loud behavior**

In a second terminal, run `.\start-server.ps1` again.
Expected: Immediate exit with error message:

```
ERROR: Port 27246 (main server) is already in use.
```

- [ ] **Step 4: Test SYNAPSE_PORT override**

Run: `$env:SYNAPSE_PORT=27300; .\start-server.ps1`
Expected: Server starts on 27300, hook server on 27301.

- [ ] **Step 5: Test invalid port**

Run: `$env:SYNAPSE_PORT='abc'; .\start-server.ps1`
Expected: Immediate crash with `Invalid SYNAPSE_PORT="abc"` error.

### Task 19: Final test suite run

- [ ] **Step 1: Run all tests**

Run: `pnpm test`
Expected: All tests pass with no regressions.

- [ ] **Step 2: Search for stale port references**

Run: `grep -r "4000" --include="*.ts" --include="*.mjs" --include="*.cjs" --include="*.json" -l`
Check for any remaining hardcoded `4000` port references that should now be `27246`.

Exceptions (OK to keep):

- Test files that explicitly test the old default
- Package version numbers
- Unrelated numeric values

- [ ] **Step 3: Final commit (if any fixups needed)**

```bash
git add -A
git commit -m "fix: clean up remaining stale port references"
```
