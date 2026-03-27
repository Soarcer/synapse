# OpenClaw Plugin Migration — Modern `register(api)` Pattern

**Date:** 2026-03-17
**Status:** Plan (revised after review)
**Branch:** `experiment/prompt-threading` (or new `feat/openclaw-modern-api`)

---

## Problem Statement

The Synapse OpenClaw plugin (`packages/openclaw`) uses the **legacy `init(config, deps)` pattern** with TypeBox schemas, manual child-process server spawning, and hand-rolled tool definitions. The current OpenClaw plugin SDK (v2026.3.x) has moved to:

- **`register(api: OpenClawPluginApi)`** entry point
- **`openclaw.plugin.json`** manifest with JSON Schema `configSchema`
- **`api.registerTool()`** for tool registration (JSON Schema params, `(runId, params) => ToolResult` execute signature)
- **`api.registerHook()`** for lifecycle hooks
- **`openclaw/plugin-sdk/core`** subpath imports (the old `openclaw/plugin-sdk` root import is deprecated)
- **`openclaw/plugin-sdk/test-utils`** for plugin testing

### What's Already Done (core import sync)

- `openclawJsonl.ts` — local `AgentEvent` interface replaced with `import type { AgentEvent } from '@synapse-ai/core'`
- `openclawJsonl.ts` — duplicate `inferVendor` and `PRICING` table replaced with `import { inferVendor, getPrice, computeCostUsd } from '@synapse-ai/core'`
- `providerWrapper.ts` — duplicate `DEFAULT_PRICING` table and `inferVendor` replaced with core imports
- Both files now use cache-aware `computeCostUsd` instead of simple `(input * rate + output * rate) / 1M`

### What Still Needs Migration

| Area                   | Current (Legacy)                                   | Target (Modern)                                                     |
| ---------------------- | -------------------------------------------------- | ------------------------------------------------------------------- |
| Entry point            | `export default { id, slot, schema, init() }`      | `export default (api) => { api.register*() }`                       |
| Manifest               | `"openclaw"` field in `package.json`               | Separate `openclaw.plugin.json`                                     |
| Config schema          | `@sinclair/typebox` `Type.Object()`                | JSON Schema in manifest                                             |
| Tool registration      | Return `{ tools: OpenClawTool[] }` from `init()`   | `api.registerTool({ name, description, parameters, execute })`      |
| Tool execute signature | `(params) => Promise<unknown>`                     | `(runId, params) => Promise<{ content: [{ type: "text", text }] }>` |
| Lifecycle / dispose    | Manual `process.on('SIGINT', cleanup)`             | `api.on('shutdown', cleanup)`                                       |
| Server spawn           | `child_process.spawn('npx', ['tsx', serverEntry])` | Pre-built server bundle via esbuild, configurable path              |
| Config access          | `init(config, deps)` parameter                     | `api.pluginConfig` + `api.logger`                                   |
| SDK import             | `openclaw` peer dep (untyped)                      | `openclaw/plugin-sdk/core` subpath                                  |
| Testing                | None                                               | `openclaw/plugin-sdk/test-utils`                                    |

---

## Implementation Plan

<!-- revised: added Step 0 per Services Architect P1 — pre-build server bundle to eliminate tsx cold-start -->

### Step 0: Pre-build server bundle for plugin use

The current plugin spawns `npx tsx packages/server/src/index.ts` at runtime — that's a full TypeScript compilation on every cold start (5-15s, ~100MB). Instead, esbuild the server into a single pre-built `.mjs` that the plugin can spawn directly.

**Approach:**

- Add a `build:server-bundle` script to `packages/openclaw/esbuild.mjs` that builds `packages/server/src/index.ts` → `packages/openclaw/dist/synapse-server.mjs`
- The plugin spawns `node dist/synapse-server.mjs` instead of `npx tsx ...`
- This eliminates the `tsx` runtime dependency and cuts cold start to <1s

```typescript
// In esbuild.mjs — second build target
await build({
  entryPoints: ['../server/src/index.ts'],
  bundle: true,
  outfile: 'dist/synapse-server.mjs',
  format: 'esm',
  platform: 'node',
  target: 'node20',
  sourcemap: true,
  external: ['better-sqlite3'], // sql.js is bundled
});
```

**Files:** `packages/openclaw/esbuild.mjs` (edit)

### Step 1: Create `openclaw.plugin.json` manifest

Create `packages/openclaw/openclaw.plugin.json` — the static manifest that OpenClaw reads before executing plugin code.

<!-- revised: added serverPath to configSchema per Principal Eng P0 — server path must be configurable -->

```json
{
  "id": "synapse-monitor",
  "name": "Synapse — AI Monitor",
  "description": "Real-time AI agent monitoring dashboard for OpenClaw",
  "version": "0.2.0",
  "configSchema": {
    "type": "object",
    "properties": {
      "port": {
        "type": "number",
        "default": 27246,
        "description": "Dashboard server port"
      },
      "serverPath": {
        "type": "string",
        "description": "Path to pre-built server .mjs (default: bundled dist/synapse-server.mjs)"
      },
      "dbPath": {
        "type": "string",
        "description": "SQLite database path (default: plugin data dir)"
      },
      "layers": {
        "type": "object",
        "properties": {
          "transcriptWatcher": {
            "type": "boolean",
            "default": true,
            "description": "Watch JSONL transcripts for events"
          },
          "agentTools": {
            "type": "boolean",
            "default": true,
            "description": "Register synapse_query/metrics/dashboard tools"
          },
          "providerWrapper": {
            "type": "boolean",
            "default": false,
            "description": "Wrap providers for deep monitoring"
          }
        },
        "additionalProperties": false
      },
      "wrappedProviders": {
        "type": "array",
        "items": { "type": "string" },
        "default": [],
        "description": "Provider IDs to wrap when providerWrapper is true"
      },
      "watchPaths": {
        "type": "array",
        "items": { "type": "string" },
        "default": [],
        "description": "Additional directories to watch for JSONL transcripts"
      }
    },
    "additionalProperties": false
  }
}
```

**Files:** `packages/openclaw/openclaw.plugin.json` (new)

### Step 2: Migrate entry point to `register(api)` pattern

Rewrite `src/plugin.ts` from the legacy `export default { id, slot, schema, init }` object to the modern function form.

<!-- revised: lazy server startup per Principal Eng P1 — don't block register() for 10s -->
<!-- revised: port collision detection per Services Architect P1 — probe before spawn -->
<!-- revised: configurable server path per Principal Eng P0 — resolve from plugin dist -->

**Key design decisions:**

1. **Lazy server startup**: Start the server process but don't `await` health in `register()`. Tools check readiness on first call.
2. **Port collision detection**: Before spawning, probe the port. If already listening, check `/api/health` for `mode: 'openclaw'` — reuse if ours, fail if foreign.
3. **Configurable server path**: Default to `dist/synapse-server.mjs` relative to the plugin's own `__dirname`. Override via `config.serverPath`.

```typescript
import type { OpenClawPluginApi } from 'openclaw/plugin-sdk/core';
import type { SynapseConfig } from './types.js';
import { JsonlBridge } from './layers/jsonlBridge.js';
import { registerSynapseTools } from './layers/agentTools.js';
import { ProviderWrapper } from './layers/providerWrapper.js';
import { spawn, type ChildProcess } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default async (api: OpenClawPluginApi) => {
  const config = api.pluginConfig as SynapseConfig;
  const logger = api.logger;
  const port = config.port || 27246;

  // ── 1. Detect port collision before spawning ──
  let serverProcess: ChildProcess | undefined;
  const existing = await probePort(port);
  if (existing === 'foreign') {
    throw new Error(
      `[Synapse] Port ${port} is in use by a non-Synapse process. Change the port in plugin config.`,
    );
  }
  if (existing === 'synapse') {
    logger.info(`[Synapse] Reusing existing server on port ${port}`);
  } else {
    // ── 2. Start server (non-blocking) ──
    const serverEntry = config.serverPath ?? path.join(__dirname, 'synapse-server.mjs');
    serverProcess = spawnServer(serverEntry, port, config, logger);
    // Don't await — tools will check readiness lazily
    logger.info(`[Synapse] Server starting on port ${port} (pid: ${serverProcess.pid})`);
  }

  // ── 3. Layer 1: JSONL Bridge ──
  let jsonlBridge: JsonlBridge | undefined;
  if (config.layers?.transcriptWatcher !== false) {
    jsonlBridge = new JsonlBridge(port, logger);
    const watchPaths = config.watchPaths?.length
      ? config.watchPaths
      : [path.join(api.resolvePath('.'), 'agents')];
    for (const wp of watchPaths) jsonlBridge.watchAgentsDir(wp);
    logger.info(`[Synapse] Layer 1: Transcript watcher active (${watchPaths.length} path(s))`);
  }

  // ── 4. Layer 2: Agent Tools (via api.registerTool) ──
  if (config.layers?.agentTools !== false) {
    registerSynapseTools(api, port);
    logger.info('[Synapse] Layer 2: Agent tools registered');
  }

  // ── 5. Layer 3: Provider Wrapper ──
  let providerWrapper: ProviderWrapper | undefined;
  if (config.layers?.providerWrapper && config.wrappedProviders?.length) {
    providerWrapper = new ProviderWrapper(port, config.wrappedProviders, logger);
    logger.info(`[Synapse] Layer 3: Provider wrapper for ${config.wrappedProviders.join(', ')}`);
  }

  // ── 6. Register /synapse command for discoverability ──
  if (typeof api.registerCommand === 'function') {
    api.registerCommand({
      name: 'synapse',
      description: 'Show Synapse dashboard URL and status',
      handler: async () => {
        try {
          const res = await fetch(`http://localhost:${port}/api/health`);
          const h = (await res.json()) as Record<string, unknown>;
          return {
            text: `Synapse dashboard: http://localhost:${port}  (status: ${h.ok ? 'running' : 'error'}, clients: ${h.clients})`,
          };
        } catch {
          return { text: `Synapse dashboard: http://localhost:${port}  (status: unreachable)` };
        }
      },
    });
  }

  // ── 7. Cleanup via lifecycle hook ──
  api.on('shutdown', () => {
    jsonlBridge?.stop();
    providerWrapper?.stop();
    if (serverProcess?.pid && !serverProcess.killed) {
      serverProcess.kill('SIGTERM');
    }
  });
};

// ── Helpers ──────────────────────────────────────────────────

function spawnServer(
  entry: string,
  port: number,
  config: SynapseConfig,
  logger: { info: Function; warn: Function; error: Function },
): ChildProcess {
  const env: Record<string, string> = {
    ...(process.env as Record<string, string>),
    PORT: String(port),
    SYNAPSE_MODE: 'openclaw',
  };
  if (config.dbPath) env.SYNAPSE_DB_PATH = config.dbPath;

  const proc = spawn('node', [entry], {
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  proc.stdout?.on('data', (d: Buffer) => logger.info(`[Synapse Server] ${d.toString().trim()}`));
  proc.stderr?.on('data', (d: Buffer) => logger.warn(`[Synapse Server] ${d.toString().trim()}`));
  proc.on('error', (err) => logger.error(`[Synapse] Server error: ${err.message}`));
  proc.on('exit', (code) => {
    if (code && code !== 0) logger.error(`[Synapse] Server exited: ${code}`);
  });
  return proc;
}

/** Probe a port to detect existing servers. Returns 'synapse' | 'foreign' | 'free'. */
async function probePort(port: number): Promise<'synapse' | 'foreign' | 'free'> {
  try {
    const res = await fetch(`http://localhost:${port}/api/health`, {
      signal: AbortSignal.timeout(1000),
    });
    if (!res.ok) return 'foreign';
    const body = (await res.json()) as Record<string, unknown>;
    return body.mode === 'openclaw' || body.ok ? 'synapse' : 'foreign';
  } catch {
    return 'free';
  }
}

/** Wait for server to become healthy (used by tool execute on first call). */
export async function ensureServerReady(port: number, timeoutMs = 10_000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(`http://localhost:${port}/api/health`);
      if (res.ok) return;
    } catch {
      /* not ready */
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error(`Synapse server not ready on port ${port} after ${timeoutMs}ms`);
}
```

**Files:** `packages/openclaw/src/plugin.ts` (rewrite)

### Step 3: Migrate tool registration to `api.registerTool()`

Move tool definitions from `agentTools.ts` return array to `api.registerTool()` calls with the modern execute signature.

<!-- revised: tools check server readiness lazily per Principal Eng P1 -->

**Key changes:**

- Execute signature: `(params) => unknown` → `(runId, params) => { content: [{ type: "text", text }] }`
- Parameter schema stays as JSON Schema objects (already compatible)
- Mark tools as `{ optional: true }` since they have side effects (HTTP calls to Synapse server)
- Each tool's `execute` calls `ensureServerReady(port)` on first invocation (cached after first success)

```typescript
import type { OpenClawPluginApi } from 'openclaw/plugin-sdk/core';
import { ensureServerReady } from '../plugin.js';

let serverChecked = false;

export function registerSynapseTools(api: OpenClawPluginApi, port: number): void {
  const baseUrl = `http://localhost:${port}`;

  async function requireServer(): Promise<void> {
    if (serverChecked) return;
    await ensureServerReady(port);
    serverChecked = true;
  }

  api.registerTool(
    {
      name: 'synapse_query',
      description: 'Query AI usage events from the Synapse monitoring dashboard.',
      parameters: {
        /* same JSON Schema as current */
      },
      async execute(_runId, params) {
        await requireServer();
        // ... same query logic ...
        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
      },
    },
    { optional: true },
  );

  api.registerTool({ name: 'synapse_metrics' /* ... */ }, { optional: true });
  api.registerTool({ name: 'synapse_dashboard' /* ... */ }, { optional: true });
}
```

**Files:** `packages/openclaw/src/layers/agentTools.ts` (rewrite)

### Step 4: Update types — remove legacy interfaces, add SDK types

- Remove `PluginDeps` interface (replaced by `OpenClawPluginApi`)
- Remove `OpenClawTool` interface (replaced by SDK's `ToolConfig`)
- Add optional `serverPath` to `SynapseConfig` <!-- revised: per Principal Eng P0 -->
- Keep `PluginLogger` (matches `api.logger` signature)
- Keep `TranscriptLine` / `TranscriptContentBlock` (our own transcript parsing types)

**Files:** `packages/openclaw/src/types.ts` (edit)

### Step 5: Delete `config.ts` — schema now lives in manifest

The TypeBox `SynapseConfigSchema` in `config.ts` is replaced by JSON Schema in `openclaw.plugin.json`.

**Files:** `packages/openclaw/src/config.ts` (delete)

### Step 6: Update `package.json`

<!-- revised: remove better-sqlite3 per Services Architect P2 — plugin doesn't use it directly -->
<!-- revised: bump version to 0.2.0, add CHANGELOG note per Product Manager P1 -->

```diff
  "version": "0.2.0",

- "openclaw": {
-   "extensions": [{ "id": "synapse-monitor", "entry": "./dist/plugin.js" }]
- },
+ // manifest is now openclaw.plugin.json (auto-discovered)

  "peerDependencies": {
-   "openclaw": "*"
+   "openclaw": ">=2026.3.0"
  },

  "files": [
-   "dist/"
+   "dist/",
+   "openclaw.plugin.json"
  ],

  "dependencies": {
    "@synapse-ai/core": "workspace:*",
-   "better-sqlite3": "^11.8.0",
-   "express": "^5.1.0",
    "nanoid": "^5.1.0",
-   "ws": "^8.18.0"
  },

  "devDependencies": {
-   "@sinclair/typebox": "^0.34.0",
    "esbuild": "^0.24.0",
+   "openclaw": "^2026.3.0",
    "tsx": "^4.19.0",
    "typescript": "^5.7.0"
  }
```

Also add a `CHANGELOG.md` entry:

```markdown
## 0.2.0 (2026-03-17)

### Breaking Changes

- Requires OpenClaw >= 2026.3.0 (modern `register(api)` plugin pattern)
- Legacy `init(config, deps)` entry point removed

### Migration from 0.1.x

1. Update OpenClaw to >= 2026.3.0
2. Update plugin: `openclaw plugins install @synapse-ai/openclaw@0.2.0`
3. Config format unchanged — no config migration needed
```

**Files:** `packages/openclaw/package.json` (edit), `packages/openclaw/CHANGELOG.md` (new)

### Step 7: Update esbuild config

<!-- revised: add server bundle build per Step 0 -->

```typescript
import { build } from 'esbuild';

// 1. Plugin entry point
await build({
  entryPoints: ['src/plugin.ts'],
  bundle: true,
  outfile: 'dist/plugin.js',
  format: 'esm',
  platform: 'node',
  target: 'node20',
  sourcemap: true,
  external: ['openclaw', 'openclaw/plugin-sdk/core'],
});

// 2. Bundled server (eliminates tsx runtime dependency)
await build({
  entryPoints: ['../server/src/index.ts'],
  bundle: true,
  outfile: 'dist/synapse-server.mjs',
  format: 'esm',
  platform: 'node',
  target: 'node20',
  sourcemap: true,
  external: ['better-sqlite3'],
});

console.log('  Plugin built: dist/plugin.js + dist/synapse-server.mjs');
```

**Files:** `packages/openclaw/esbuild.mjs` (rewrite)

### Step 8: Add plugin tests

<!-- revised: test strategy with server decoupling per Principal Eng P1 -->

Tests must work without spawning a real server. Strategy:

- Extract `spawnServer`, `probePort`, `ensureServerReady` so they can be mocked
- Test tool registration in isolation by calling `registerSynapseTools` directly with a mock api
- Test tool execute functions with a mock HTTP server (msw or vi.stubGlobal fetch)

```typescript
// src/__tests__/plugin.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { registerSynapseTools } from '../layers/agentTools.js';

function createMockApi() {
  const tools: Array<{ name: string; execute: Function }> = [];
  return {
    pluginConfig: {
      port: 0, // unused in tool registration
      layers: { agentTools: true, transcriptWatcher: false, providerWrapper: false },
      wrappedProviders: [],
      watchPaths: [],
    },
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
    registerTool: vi.fn((config: any) => tools.push(config)),
    registerCommand: vi.fn(),
    on: vi.fn(),
    resolvePath: (p: string) => p,
    id: 'synapse-monitor',
    _tools: tools,
  };
}

describe('synapse-monitor tools', () => {
  it('registers 3 tools', () => {
    const api = createMockApi();
    registerSynapseTools(api as any, 27246);
    expect(api.registerTool).toHaveBeenCalledTimes(3);

    const names = api.registerTool.mock.calls.map((c: any) => c[0].name);
    expect(names).toEqual(['synapse_query', 'synapse_metrics', 'synapse_dashboard']);
  });

  it('all tools marked as optional', () => {
    const api = createMockApi();
    registerSynapseTools(api as any, 27246);

    for (const call of api.registerTool.mock.calls) {
      expect(call[1]).toEqual({ optional: true });
    }
  });

  it('synapse_dashboard returns content array format', async () => {
    const api = createMockApi();
    registerSynapseTools(api as any, 27246);

    // Mock fetch for health check + ensureServerReady
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ ok: true, clients: 0, mode: 'openclaw' }),
      }),
    );

    const dashboardTool = api._tools.find((t: any) => t.name === 'synapse_dashboard');
    const result = await dashboardTool!.execute('test-run', {});
    expect(result).toHaveProperty('content');
    expect(result.content[0]).toHaveProperty('type', 'text');

    vi.unstubAllGlobals();
  });
});
```

**Files:** `packages/openclaw/src/__tests__/plugin.test.ts` (new)

### Step 9: Build verification and smoke test

<!-- revised: concrete pass/fail criteria per Product Manager P1 -->

**Build checks:**

1. `cd packages/openclaw && pnpm build` — produces `dist/plugin.js` + `dist/synapse-server.mjs`
2. `pnpm test` — all new tests pass

**Smoke test criteria (pass/fail):**

| #   | Check                                                | Pass condition                                  |
| --- | ---------------------------------------------------- | ----------------------------------------------- |
| SM1 | `openclaw plugins install ./packages/openclaw`       | Exits 0, no errors                              |
| SM2 | `openclaw plugins list`                              | Shows `synapse-monitor (0.2.0)`                 |
| SM3 | `openclaw config`                                    | `synapse-monitor` section with defaults visible |
| SM4 | `openclaw start` + `curl localhost:27246/api/health` | Returns `{ "ok": true, "mode": "openclaw" }`    |
| SM5 | `openclaw run "use synapse_dashboard"`               | Returns content with `status: "running"`        |
| SM6 | Create a JSONL transcript file in watch dir          | Events appear on dashboard within 5s            |
| SM7 | `openclaw run "use synapse_metrics"`                 | Returns non-empty aggregation                   |

---

## File Change Summary

| File                                             | Action                                                              |
| ------------------------------------------------ | ------------------------------------------------------------------- |
| `packages/openclaw/openclaw.plugin.json`         | **Create** — static manifest                                        |
| `packages/openclaw/src/plugin.ts`                | **Rewrite** — `register(api)` pattern, lazy startup, port detection |
| `packages/openclaw/src/layers/agentTools.ts`     | **Rewrite** — `api.registerTool()` calls with lazy readiness        |
| `packages/openclaw/src/types.ts`                 | **Edit** — remove `PluginDeps`, `OpenClawTool`, add `serverPath`    |
| `packages/openclaw/src/config.ts`                | **Delete** — replaced by manifest                                   |
| `packages/openclaw/package.json`                 | **Edit** — manifest, deps cleanup, version bump                     |
| `packages/openclaw/CHANGELOG.md`                 | **Create** — migration notes for 0.1.x users                        |
| `packages/openclaw/esbuild.mjs`                  | **Rewrite** — dual build (plugin + server bundle)                   |
| `packages/openclaw/src/__tests__/plugin.test.ts` | **Create** — unit tests with mocked server                          |

**Layers unchanged:** `jsonlBridge.ts`, `providerWrapper.ts`, `openclawJsonl.ts` — internal implementation, already synced with `@synapse-ai/core`.

---

## Risks & Mitigations

| Risk                                                     | Mitigation                                                                                             |
| -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| OpenClaw SDK types may differ from research              | Pin `openclaw` dev dep to exact version; fall back to `any` cast + `// TODO: tighten` if type mismatch |
| Server spawn may conflict with OpenClaw's own lifecycle  | Keep existing `spawn` approach; OpenClaw plugins run in-process and can spawn child processes          |
| Port already in use by another process                   | `probePort()` detects and distinguishes Synapse vs foreign servers before spawning                     |
| `api.registerCommand` may not exist on all versions      | Guard with `typeof api.registerCommand === 'function'`                                                 |
| `{ optional: true }` tools require user config allowlist | Document in CHANGELOG: add `"tools": { "allow": ["synapse-monitor"] }` to agent config                 |
| Users on OpenClaw < 2026.3.0 will break                  | `peerDependencies` enforces `>=2026.3.0`; CHANGELOG documents migration path                           |

---

## How to Install & Test

### Install as OpenClaw plugin

```bash
# From Synapse monorepo root
cd packages/openclaw
pnpm build

# Install in OpenClaw (links local build)
openclaw plugins install ./packages/openclaw

# Or via npm (after publishing)
openclaw plugins install @synapse-ai/openclaw
```

### Verify installation

```bash
openclaw plugins list
# Should show: synapse-monitor (0.2.0) — Real-time AI agent monitoring dashboard

openclaw config
# Verify synapse-monitor section appears with default config
```

### Enable tools in agent config

```json
{
  "agents": {
    "list": [
      {
        "tools": { "allow": ["synapse-monitor"] }
      }
    ]
  },
  "plugins": {
    "synapse-monitor": {
      "port": 27246,
      "layers": {
        "transcriptWatcher": true,
        "agentTools": true,
        "providerWrapper": false
      }
    }
  }
}
```

### Run and verify

```bash
# Start OpenClaw with plugin
openclaw start

# In another terminal, check Synapse dashboard
curl http://localhost:27246/api/health

# Use /synapse command for quick status
/synapse

# Test tool via OpenClaw CLI
openclaw run "Use synapse_dashboard to check the monitoring dashboard status"
```

---

## Open Questions / Deferred

<!-- P2 findings from review — address incrementally -->

- **SIGINT listener leak on fallback path**: If `api.on('shutdown')` is unavailable and we fall back to `process.on('SIGINT')`, the listener should be stored and removed on dispose. Low risk since we require OpenClaw >= 2026.3.0.
- **Tool output format**: Currently returns `JSON.stringify(result, null, 2)` inside `{ content: [{ type: "text", text }] }`. Could be improved to structured markdown tables for better agent readability. Deferred to a follow-up UX pass.
- **`better-sqlite3` removal verification**: Plan removes it from deps. Verify no transitive import pulls it in during the server bundle build — if esbuild warns, add it back as external.
