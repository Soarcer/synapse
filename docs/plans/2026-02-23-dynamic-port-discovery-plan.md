# Dynamic Port Discovery Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make the Vite dev server automatically discover and track the backend server port so the frontend reconnects without manual configuration when the server port changes — regardless of restart order, regardless of what started the server.

**Architecture:** (1) Fix WebSocket hardcoding so dev-mode WS routes through the Vite proxy like `/api` already does. (2) Have the server itself write its own port file on startup so discovery works even without the VS Code extension. (3) Extract port-discovery logic into a tested, standalone plugin module that watches both the project-local and global port files using `fs.watch` (event-driven, not polling), with debounce and proper cleanup. (4) Send an HMR event to the browser before triggering `server.restart()` so the user sees a toast notification and the viewport position can be saved to `sessionStorage` for restore after reload.

**Tech Stack:** Vite 6 plugin API (`configureServer`, `server.ws.send`), Node.js `fs.watch` / `fs.watchFile`, `node:os`, Vitest 4

---

### Task 1: Fix WebSocket URL hardcoding in wsClient.ts

**Files:**

- Modify: `apps/dashboard/src/store/wsClient.ts:151-160`

**Step 1: Replace the dev-mode hardcoded URL**

In `apps/dashboard/src/store/wsClient.ts`, replace lines 151–160:

```typescript
// Determine WS URL: allow override via VITE_WS_URL
const envWsUrl = import.meta.env.VITE_WS_URL as string | undefined;
const wsUrl = envWsUrl?.trim()
  ? envWsUrl
  : import.meta.env.DEV
    ? `ws://${window.location.hostname}:4000/ws`
    : `ws${window.location.protocol === 'https:' ? 's' : ''}://${window.location.host}/ws`;

export const wsClient = new WSClient(wsUrl);
```

With:

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

**Why:** In dev mode, `window.location.host` is `localhost:5173` (Vite's port). Requests to `/ws` at that origin go through the Vite proxy, which forwards to the backend. The old `hostname:4000` bypassed the proxy entirely, so port changes were invisible to the frontend.

**Step 2: Verify no type errors**

Run: `pnpm --filter @synapse-ai/dashboard exec tsc --noEmit`
Expected: exits 0, no output

**Step 3: Commit**

```bash
git add apps/dashboard/src/store/wsClient.ts
git commit -m "fix: route dev WebSocket through Vite proxy instead of hardcoded port 4000"
```

---

### Task 2: Server writes its own port file on startup

**Files:**

- Modify: `packages/server/src/index.ts:122-125`

**Background:** Currently only the VS Code extension writes `.claude/.synapse-port`. When the server is started directly (`.\start-server.ps1`) without the extension, nothing writes the file, so the Vite plugin can't discover the port. The server itself must own this write.

**Step 1: Add port file write after the server binds its port**

`path` and `fs` are already imported at the top of `packages/server/src/index.ts` (lines 7–8). After line 125 (`logger.info({ host: HOST, port: actualPort }, 'Synapse server started')`), add:

```typescript
// Write port file for hook scripts and Vite dev server auto-discovery.
// process.cwd() is the monorepo root when started via start-server.ps1 or pnpm dev.
// Best-effort: if the write fails (e.g. read-only FS), log a warning and continue.
try {
  const claudeDir = path.join(process.cwd(), '.claude');
  fs.mkdirSync(claudeDir, { recursive: true });
  fs.writeFileSync(path.join(claudeDir, '.synapse-port'), String(actualPort));
} catch {
  logger.warn('Could not write .synapse-port — port auto-discovery may not work');
}
```

**Step 2: Verify server still starts correctly**

Run: `npx tsx packages/server/src/index.ts`
Expected:

- Server starts (prints `SYNAPSE_PORT=XXXX` to stdout)
- `.claude/.synapse-port` file contains the port number
- No error messages in the log

Stop with Ctrl+C.

**Step 3: Commit**

```bash
git add packages/server/src/index.ts
git commit -m "feat: server writes .synapse-port on startup for tool and Vite auto-discovery"
```

---

### Task 3: Extract port-discovery plugin into a testable module

**Files:**

- Create: `apps/dashboard/vite-plugins/synapsePort.ts`
- Create: `apps/dashboard/vite-plugins/synapsePort.test.ts`

**Why a separate file:** Functions in `vite.config.ts` can't be imported by test files. Extracting them lets us unit-test the port-reading and watcher logic without running Vite.

**Step 1: Write the failing tests first**

Create `apps/dashboard/vite-plugins/synapsePort.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock node:fs BEFORE importing the module under test
vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  return {
    ...actual,
    readFileSync: vi.fn(),
    watch: vi.fn(),
    watchFile: vi.fn(),
    unwatchFile: vi.fn(),
  };
});

import fs from 'node:fs';
import { readServerPort, synapsePortWatcher } from './synapsePort';

describe('readServerPort', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.SYNAPSE_PORT;
  });

  it('returns port from project port file when valid', () => {
    vi.mocked(fs.readFileSync)
      .mockReturnValueOnce('4027') // project file
      .mockReturnValueOnce('9999'); // global file (should not be reached)
    expect(readServerPort()).toBe('4027');
  });

  it('falls back to global port file when project file is missing', () => {
    vi.mocked(fs.readFileSync)
      .mockImplementationOnce(() => {
        throw Object.assign(new Error(), { code: 'ENOENT' });
      })
      .mockReturnValueOnce('4028');
    expect(readServerPort()).toBe('4028');
  });

  it('falls back to SYNAPSE_PORT env var when both files are missing', () => {
    vi.mocked(fs.readFileSync).mockImplementation(() => {
      throw Object.assign(new Error(), { code: 'ENOENT' });
    });
    process.env.SYNAPSE_PORT = '4100';
    expect(readServerPort()).toBe('4100');
  });

  it('falls back to 4000 when nothing is configured', () => {
    vi.mocked(fs.readFileSync).mockImplementation(() => {
      throw Object.assign(new Error(), { code: 'ENOENT' });
    });
    expect(readServerPort()).toBe('4000');
  });

  it('rejects non-numeric file content', () => {
    vi.mocked(fs.readFileSync)
      .mockReturnValueOnce('not-a-port')
      .mockImplementation(() => {
        throw Object.assign(new Error(), { code: 'ENOENT' });
      });
    expect(readServerPort()).toBe('4000');
  });

  it('rejects privileged ports (<= 1023)', () => {
    vi.mocked(fs.readFileSync)
      .mockReturnValueOnce('80')
      .mockImplementation(() => {
        throw Object.assign(new Error(), { code: 'ENOENT' });
      });
    expect(readServerPort()).toBe('4000');
  });

  it('rejects ports above 65535', () => {
    vi.mocked(fs.readFileSync)
      .mockReturnValueOnce('99999')
      .mockImplementation(() => {
        throw Object.assign(new Error(), { code: 'ENOENT' });
      });
    expect(readServerPort()).toBe('4000');
  });
});

describe('synapsePortWatcher plugin', () => {
  it('returns a Vite plugin with the correct name', () => {
    const plugin = synapsePortWatcher();
    expect(plugin.name).toBe('synapse-port-watcher');
    expect(typeof plugin.configureServer).toBe('function');
  });

  it('sets up a directory watcher in configureServer', () => {
    vi.mocked(fs.watch).mockReturnValue({ close: vi.fn() } as unknown as fs.FSWatcher);
    vi.mocked(fs.readFileSync).mockReturnValue('4027');

    const mockHttpServer = { once: vi.fn() };
    const mockServer = {
      ws: { send: vi.fn() },
      httpServer: mockHttpServer,
      restart: vi.fn(),
    };

    const plugin = synapsePortWatcher();
    (plugin.configureServer as (s: typeof mockServer) => void)(mockServer);

    expect(fs.watch).toHaveBeenCalled();
  });

  it('falls back to watchFile when directory watch throws', () => {
    vi.mocked(fs.watch).mockImplementation(() => {
      throw new Error('ENOENT');
    });
    vi.mocked(fs.readFileSync).mockReturnValue('4027');

    const mockServer = {
      ws: { send: vi.fn() },
      httpServer: { once: vi.fn() },
      restart: vi.fn(),
    };

    const plugin = synapsePortWatcher();
    expect(() =>
      (plugin.configureServer as (s: typeof mockServer) => void)(mockServer),
    ).not.toThrow();

    expect(fs.watchFile).toHaveBeenCalled();
  });
});
```

**Step 2: Run tests — expect them to fail with "Cannot find module './synapsePort'"**

Run: `pnpm test --filter @synapse-ai/dashboard -- vite-plugins/synapsePort`
Expected: FAIL — module doesn't exist yet

**Step 3: Create the plugin module**

Create `apps/dashboard/vite-plugins/synapsePort.ts`:

```typescript
// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Synapse Contributors

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import type { Plugin, ViteDevServer } from 'vite';

// Project-local port file — written by the server and VS Code extension.
const PROJECT_PORT_FILE = path.resolve(process.cwd(), '.claude', '.synapse-port');
// Global port file — written by the standalone CLI daemon.
const GLOBAL_PORT_FILE = path.join(os.homedir(), '.synapse', 'port');

/** Read and validate a port number from a file. Returns null if unreadable or invalid. */
function tryReadPortFile(filePath: string): string | null {
  try {
    const content = fs.readFileSync(filePath, 'utf-8').trim();
    const port = parseInt(content, 10);
    if (/^\d+$/.test(content) && port > 1023 && port < 65536) return String(port);
  } catch {
    // File doesn't exist or is unreadable — not an error in this context
  }
  return null;
}

/**
 * Read the server port from the port discovery chain:
 *   1. .claude/.synapse-port  (project-local, written by server + VS Code extension)
 *   2. ~/.synapse/port         (global, written by standalone CLI daemon)
 *   3. SYNAPSE_PORT env var    (explicit override)
 *   4. 4000                    (hardcoded default)
 *
 * Intentionally does NOT fall back to the generic PORT env var — that variable
 * is set by many unrelated tools (Docker, cloud CLIs, etc.) and causes silent misrouting.
 */
export function readServerPort(): string {
  return (
    tryReadPortFile(PROJECT_PORT_FILE) ??
    tryReadPortFile(GLOBAL_PORT_FILE) ??
    process.env.SYNAPSE_PORT ??
    '4000'
  );
}

// Module-level so `lastPort` survives across server.restart() calls
// (configureServer re-runs on each restart, but module scope persists).
let lastPort = '';
let debounceTimer: ReturnType<typeof setTimeout> | null = null;

function handlePortFileChange(server: ViteDevServer): void {
  // Debounce: the VS Code extension may write the file multiple times in quick
  // succession (once per hook config pass). Wait 300 ms for writes to settle.
  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => {
    debounceTimer = null;
    const newPort = readServerPort();
    if (newPort === lastPort) return; // No real change — ignore
    console.log(
      `\n[Synapse] Server port changed: ${lastPort} → ${newPort} — restarting Vite proxy…\n`,
    );
    lastPort = newPort;
    // Notify the browser first so it can show a toast and save viewport state.
    // The 300 ms grace period ensures the message reaches the client before the
    // WS connection is torn down by server.restart().
    server.ws.send({ type: 'custom', event: 'synapse:port-changing', data: { port: newPort } });
    setTimeout(() => server.restart(), 300);
  }, 300);
}

/**
 * Vite plugin that watches port discovery files and automatically restarts the
 * dev server proxy when the backend server port changes.
 *
 * Uses fs.watch (event-driven) on the .claude/ directory with fs.watchFile
 * (polling) as a fallback for environments where fs.watch is unreliable.
 */
export function synapsePortWatcher(): Plugin {
  return {
    name: 'synapse-port-watcher',
    configureServer(server) {
      lastPort = readServerPort();

      const portDir = path.dirname(PROJECT_PORT_FILE);
      const portFileName = path.basename(PROJECT_PORT_FILE);
      let dirWatcher: fs.FSWatcher | null = null;

      try {
        // Watch the .claude/ directory — more reliable than watching the file
        // directly (handles the case where the file doesn't exist yet on first start).
        dirWatcher = fs.watch(portDir, { persistent: false }, (event, filename) => {
          if (filename === portFileName) handlePortFileChange(server);
        });
      } catch {
        // .claude/ directory doesn't exist yet (very rare — server creates it on startup).
        // Fall back to polling both files at 1s intervals.
        for (const file of [PROJECT_PORT_FILE, GLOBAL_PORT_FILE]) {
          fs.watchFile(file, { interval: 1000, persistent: false }, () =>
            handlePortFileChange(server),
          );
        }
      }

      // Register cleanup AFTER the HTTP server has bound its port.
      // httpServer may be null during configureServer execution (before listen()).
      server.httpServer?.once('listening', () => {
        server.httpServer!.once('close', () => {
          dirWatcher?.close();
          for (const file of [PROJECT_PORT_FILE, GLOBAL_PORT_FILE]) {
            fs.unwatchFile(file);
          }
          if (debounceTimer) {
            clearTimeout(debounceTimer);
            debounceTimer = null;
          }
        });
      });
    },
  };
}
```

**Step 4: Run tests — expect them to pass**

Run: `pnpm test --filter @synapse-ai/dashboard -- vite-plugins/synapsePort`
Expected: All 9 tests PASS

**Step 5: Commit**

```bash
git add apps/dashboard/vite-plugins/synapsePort.ts apps/dashboard/vite-plugins/synapsePort.test.ts
git commit -m "feat: extract port-discovery Vite plugin with tests (fs.watch, debounce, dual-file)"
```

---

### Task 4: Wire the plugin into vite.config.ts

**Files:**

- Modify: `apps/dashboard/vite.config.ts`

**Step 1: Replace vite.config.ts entirely**

```typescript
// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Synapse Contributors

import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { readServerPort, synapsePortWatcher } from './vite-plugins/synapsePort';

const devPort = Number.parseInt(process.env.VITE_DEV_PORT || '5173', 10);

// Read the initial server port at startup. The synapsePortWatcher plugin will
// call server.restart() if this changes while the dev server is running.
const serverPort = readServerPort();
const proxyTarget = `http://localhost:${serverPort}`;
const wsTarget = `ws://localhost:${serverPort}`;

export default defineConfig({
  plugins: [react(), tailwindcss(), synapsePortWatcher()],
  server: {
    port: Number.isNaN(devPort) ? 5173 : devPort,
    proxy: {
      '/api': proxyTarget,
      '/ws': {
        target: wsTarget,
        ws: true,
      },
    },
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          'vendor-xyflow': ['@xyflow/react'],
          'vendor-recharts': ['recharts'],
        },
      },
    },
  },
});
```

**Step 2: Verify TypeScript compiles**

Run: `pnpm --filter @synapse-ai/dashboard exec tsc --noEmit`
Expected: exits 0

**Step 3: Commit**

```bash
git add apps/dashboard/vite.config.ts
git commit -m "refactor: wire synapsePortWatcher plugin into vite.config.ts"
```

---

### Task 5: Show a toast notification before the proxy restarts

**Files:**

- Modify: `apps/dashboard/src/App.tsx`

**Background:** When the Vite plugin detects a port change it sends a `synapse:port-changing` HMR event to the browser, waits 300 ms, then calls `server.restart()` which reloads the page. Without this task the user sees a silent sudden reload. With it, they see an informative toast for ~300 ms before the page reloads.

**Step 1: Add the HMR event listener in App.tsx**

`App.tsx` already imports `toast` from `'./components/Toast'` and has a `useEffect` section. Add this `useEffect` immediately after the existing `wsClient.connect()` effect (after line ~92):

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

**Why `useEffect` with `[]`:** The listener is registered once on mount. `import.meta.hot.on` returns a cleanup function that unregisters the listener.

**Step 2: Run existing tests to check for regressions**

Run: `pnpm test`
Expected: All existing tests still pass (this change adds a no-op effect in test environments where `import.meta.hot` is undefined)

**Step 3: Commit**

```bash
git add apps/dashboard/src/App.tsx
git commit -m "feat: show toast notification before Vite proxy restarts on port change"
```

---

### Task 6: Preserve viewport position across proxy restarts

**Files:**

- Modify: `apps/dashboard/src/components/graph/AgentGraph.tsx`

**Background:** `server.restart()` does a full page reload, which resets all React state. If the user was zoomed into a specific part of the graph, they lose their position. This task saves the React Flow viewport to `sessionStorage` when the port-change event fires and restores it after the reload.

`sessionStorage` (not `localStorage`) is correct here: it's cleared when the browser tab is closed, so stale viewport positions don't persist across separate work sessions.

**Step 1: Read the current viewport-related code in AgentGraph.tsx**

Before making changes, read the file to understand the React Flow instance access pattern:

```
Read apps/dashboard/src/components/graph/AgentGraph.tsx
```

Locate the `useReactFlow` import and find the component body. Identify where other `useEffect` hooks live.

**Step 2: Add viewport save + restore logic**

Inside the `AgentGraph` component (or whichever component calls `useReactFlow()`), add two `useEffect` hooks:

```typescript
const { getViewport, setViewport } = useReactFlow();

// Restore viewport if we just returned from a port-change proxy restart.
useEffect(() => {
  const saved = sessionStorage.getItem('synapse-viewport');
  if (!saved) return;
  sessionStorage.removeItem('synapse-viewport');
  try {
    setViewport(JSON.parse(saved) as Viewport);
  } catch {
    // Corrupt data — silently ignore
  }
}, [setViewport]);

// Save viewport just before the Vite proxy restarts.
// The plugin sends synapse:port-changing ~300 ms before server.restart().
useEffect(() => {
  if (!import.meta.hot) return;
  const cleanup = import.meta.hot.on('synapse:port-changing', () => {
    sessionStorage.setItem('synapse-viewport', JSON.stringify(getViewport()));
  });
  return cleanup;
}, [getViewport]);
```

`Viewport` is already in scope if `@xyflow/react` is imported. Check the existing imports and add `Viewport` to the import list if it's not there:

```typescript
import { ..., useReactFlow, type Viewport } from '@xyflow/react';
```

**Step 3: Verify TypeScript**

Run: `pnpm --filter @synapse-ai/dashboard exec tsc --noEmit`
Expected: exits 0

**Step 4: Commit**

```bash
git add apps/dashboard/src/components/graph/AgentGraph.tsx
git commit -m "feat: preserve React Flow viewport in sessionStorage across Vite proxy restarts"
```

---

### Task 7: Final verification

**Step 1: Run the full test suite**

Run: `pnpm test`
Expected: All tests pass

**Step 2: Verify production build is clean**

Run: `pnpm -r build`
Expected: Build succeeds. The `synapsePortWatcher` plugin's `configureServer` hook is not called during build — no watcher is registered, no side effects.

**Step 3: Smoke test the full flow**

1. Start the server: `.\start-server.ps1`
   - Check `.claude/.synapse-port` was written: `cat .claude/.synapse-port`

2. Start the client: `.\start-client.ps1`
   - Vite terminal should show the port it's proxying to

3. Open `http://localhost:5173`, verify the dashboard connects (green dot)

4. Zoom into a specific part of the graph

5. Stop the server (Ctrl+C in its terminal)

6. Start the server with a different port: `PORT=4028 npx tsx packages/server/src/index.ts`
   - Check `.claude/.synapse-port` was updated to `4028`

7. Watch the Vite terminal:
   - Should print `[Synapse] Server port changed: XXXX → 4028 — restarting Vite proxy…`

8. Watch the browser:
   - Should briefly show the "reconnecting" toast
   - Page should reload automatically
   - Graph viewport position should be restored to where you left it
   - Dashboard should reconnect (green dot)

---

### Summary of changes

| File                                                 | What changed                                                | Why                                                                                  |
| ---------------------------------------------------- | ----------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| `apps/dashboard/src/store/wsClient.ts`               | Remove `hostname:4000` hardcode, use `window.location.host` | Fixes the root cause — WS was bypassing the Vite proxy                               |
| `packages/server/src/index.ts`                       | Write `.synapse-port` after binding port                    | Discovery works without VS Code extension                                            |
| `apps/dashboard/vite-plugins/synapsePort.ts`         | New — `readServerPort()` + `synapsePortWatcher()` plugin    | Extracted for testability; uses `fs.watch` + debounce + dual-file + HMR notification |
| `apps/dashboard/vite-plugins/synapsePort.test.ts`    | New — 9 unit tests                                          | Covers valid ports, fallback chain, invalid values, watcher setup                    |
| `apps/dashboard/vite.config.ts`                      | Import + wire the plugin                                    | Wires everything together; drops `PORT` fallback to avoid env var collisions         |
| `apps/dashboard/src/App.tsx`                         | Add HMR `synapse:port-changing` listener                    | Shows toast before page reloads                                                      |
| `apps/dashboard/src/components/graph/AgentGraph.tsx` | Save/restore viewport to `sessionStorage`                   | Prevents jarring viewport loss on proxy restart                                      |

### Issues intentionally deferred

- **Shared port-discovery utility in `packages/core`:** The hook script is plain CJS with zero dependencies and cannot import from core. Sharing logic would require either duplicating the CJS version or adding a build step to the hook script. The Vite plugin and server are already independent and correct — the extraction effort is not worth it yet.
- **Remote dev environments (Codespaces, Dev Containers):** Port files are local-filesystem-only. Documented as a known limitation — a future `GET /__synapse/port` HTTP endpoint would solve it properly.
- **Consistent log prefix convention:** `[Synapse]` is used in the new plugin. Existing logs use `[hook]`, `[wsClient]` etc. A full audit and rename is a separate task.
