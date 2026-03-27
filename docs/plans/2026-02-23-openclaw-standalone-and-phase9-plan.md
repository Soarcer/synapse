# OpenClaw Standalone + Phase 9.3/9.4 Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make `@synapse-ai/openclaw` independently distributable (zero native deps, bundled server + dashboard), and complete the Phase 9.3/9.4 multi-vendor gaps.

**Architecture:** The OpenClaw plugin bundles the entire Synapse server as a single `server.mjs` file (using sql.js instead of better-sqlite3), spawns it as a child process, and includes pre-built dashboard assets. Phase 9 adds o4-mini pricing, Codex text recovery, a Codex JSONL file watcher, and multi-vendor UI to the dashboard.

**Tech Stack:** esbuild, sql.js, Express 5, Node.js 20+, React 19, Recharts, Zustand

---

## Task 1: Add `o4-mini` Pricing

**Files:**

- Modify: `packages/server/src/services/costService.ts:36` (after `o3-mini` line)

**Step 1: Add the price entry**

In `packages/server/src/services/costService.ts`, add after the `o3-mini` line (line 36):

```typescript
  { model: 'o4-mini',                       vendor: 'openai',     effectiveFrom: 0, inputPer1M: 1.1,   cachedInputPer1M: 0.55,   outputPer1M: 4.4 },
```

**Step 2: Verify tests still pass**

Run: `cd packages/server && npx vitest run src/__tests__/costService.test.ts`
Expected: All existing tests PASS (new price doesn't break anything)

**Step 3: Commit**

```bash
git add packages/server/src/services/costService.ts
git commit -m "feat(server): add o4-mini pricing for Codex sessions"
```

---

## Task 2: Fix Codex Text Recovery in `rowToAgentEvent`

**Files:**

- Modify: `packages/server/src/services/eventStore.ts:170-183`
- Test: `packages/server/src/__tests__/eventStore.test.ts` (or `eventPipeline.test.ts`)

**Step 1: Write a failing test**

Add to `packages/server/src/__tests__/eventPipeline.test.ts`:

```typescript
describe('rowToAgentEvent Codex text recovery', () => {
  it('recovers user text from Codex event_msg payload', () => {
    const row = makeRow({
      event_type: 'user_prompt',
      hook_event_name: 'codex',
      raw_payload: JSON.stringify({
        type: 'event_msg',
        payload: { type: 'user_message', message: 'Fix the login bug' },
      }),
    });
    const event = rowToAgentEvent(row);
    expect(event.text).toBe('Fix the login bug');
  });

  it('recovers result text from Codex notify hook', () => {
    const row = makeRow({
      event_type: 'result',
      hook_event_name: 'codex',
      raw_payload: JSON.stringify({
        type: 'agent-turn-complete',
        'last-assistant-message': 'I fixed the login bug by updating auth.ts',
      }),
    });
    const event = rowToAgentEvent(row);
    expect(event.text).toBe('I fixed the login bug by updating auth.ts');
  });
});
```

Where `makeRow` creates a minimal `EventRow` with defaults. Check existing tests for the helper — create one if absent.

**Step 2: Run test to verify it fails**

Run: `cd packages/server && npx vitest run src/__tests__/eventPipeline.test.ts -t "Codex text recovery"`
Expected: FAIL — `event.text` is undefined

**Step 3: Add Codex text recovery to `rowToAgentEvent`**

In `packages/server/src/services/eventStore.ts`, inside the raw_payload try block (after the `if (raw.message && event.type === 'notification')` line ~179), add:

```typescript
// Codex: recover user text from event_msg wrapper
if (!event.text && raw.payload && typeof raw.payload === 'object') {
  const payload = raw.payload as Record<string, unknown>;
  if (typeof payload.message === 'string') event.text = payload.message;
}
// Codex: recover assistant text from notify hook
if (!event.text) {
  const lastMsg = raw['last-assistant-message'] ?? raw.last_assistant_message;
  if (typeof lastMsg === 'string') event.text = lastMsg;
}
```

**Step 4: Run test to verify it passes**

Run: `cd packages/server && npx vitest run src/__tests__/eventPipeline.test.ts -t "Codex text recovery"`
Expected: PASS

**Step 5: Commit**

```bash
git add packages/server/src/services/eventStore.ts packages/server/src/__tests__/eventPipeline.test.ts
git commit -m "fix(server): recover Codex user/result text from raw_payload on DB reload"
```

---

## Task 3: Create CodexFileWatcher

**Files:**

- Create: `packages/server/src/services/codexWatcher.ts`
- Modify: `packages/server/src/index.ts` (start watcher if env var set)
- Test: `packages/server/src/__tests__/codexWatcher.test.ts`

**Step 1: Write the watcher test**

Create `packages/server/src/__tests__/codexWatcher.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { CodexWatcher } from '../services/codexWatcher.js';

describe('CodexWatcher', () => {
  let tmpDir: string;
  let watcher: CodexWatcher;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-watcher-test-'));
  });

  afterEach(() => {
    watcher?.stop();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('detects new JSONL lines in a session file', async () => {
    const events: unknown[] = [];
    const onEvent = vi.fn((raw: Record<string, unknown>) => events.push(raw));

    watcher = new CodexWatcher({ basePath: tmpDir, pollIntervalMs: 200, onEvent });
    watcher.start();

    // Create a session file
    const dayDir = path.join(tmpDir, '2026', '02', '23');
    fs.mkdirSync(dayDir, { recursive: true });
    const sessionFile = path.join(dayDir, 'rollout-abc123.jsonl');

    // Write a line
    fs.writeFileSync(
      sessionFile,
      JSON.stringify({
        type: 'event_msg',
        payload: { type: 'user_message', message: 'hello' },
      }) + '\n',
    );

    // Wait for poll
    await new Promise((r) => setTimeout(r, 500));

    expect(onEvent).toHaveBeenCalled();
    expect(events.length).toBeGreaterThanOrEqual(1);
    const first = events[0] as Record<string, unknown>;
    expect(first.codex_source).toBe('watcher');
    expect(first.session_id).toBe('abc123');
  });

  it('tracks byte offset to avoid re-reading', async () => {
    const events: unknown[] = [];
    const onEvent = vi.fn((raw: Record<string, unknown>) => events.push(raw));

    watcher = new CodexWatcher({ basePath: tmpDir, pollIntervalMs: 200, onEvent });

    const dayDir = path.join(tmpDir, '2026', '02', '23');
    fs.mkdirSync(dayDir, { recursive: true });
    const sessionFile = path.join(dayDir, 'rollout-def456.jsonl');

    // Pre-populate
    fs.writeFileSync(
      sessionFile,
      JSON.stringify({ type: 'event_msg', payload: { type: 'user_message', message: 'line1' } }) +
        '\n',
    );

    watcher.start();
    await new Promise((r) => setTimeout(r, 500));

    const countAfterFirst = onEvent.mock.calls.length;

    // Append second line
    fs.appendFileSync(
      sessionFile,
      JSON.stringify({ type: 'event_msg', payload: { type: 'user_message', message: 'line2' } }) +
        '\n',
    );
    await new Promise((r) => setTimeout(r, 500));

    // Should have exactly one more call (not re-reading line1)
    expect(onEvent.mock.calls.length).toBe(countAfterFirst + 1);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd packages/server && npx vitest run src/__tests__/codexWatcher.test.ts`
Expected: FAIL — module not found

**Step 3: Implement CodexWatcher**

Create `packages/server/src/services/codexWatcher.ts`:

```typescript
// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Synapse Contributors

import fs from 'fs';
import path from 'path';
import os from 'os';
import { logger } from '../lib/logger.js';

export interface CodexWatcherOptions {
  /** Base path to Codex sessions directory. Default: ~/.codex/sessions */
  basePath?: string;
  /** Poll interval in ms. Default: 2000 */
  pollIntervalMs?: number;
  /** Callback when a new JSONL line is parsed. Receives the raw object with session_id + codex_source injected. */
  onEvent: (raw: Record<string, unknown>) => void;
  /** Max concurrent file watches. Default: 20 */
  maxFiles?: number;
}

const DEFAULT_BASE = () => {
  const home = os.homedir();
  return path.join(home, '.codex', 'sessions');
};

export class CodexWatcher {
  private readonly basePath: string;
  private readonly pollMs: number;
  private readonly onEvent: (raw: Record<string, unknown>) => void;
  private readonly maxFiles: number;

  /** Byte offset per file path — tracks where we left off reading */
  private readonly offsets = new Map<string, number>();
  private timer: ReturnType<typeof setInterval> | null = null;
  private stopped = false;

  constructor(opts: CodexWatcherOptions) {
    this.basePath = opts.basePath ?? DEFAULT_BASE();
    this.pollMs = opts.pollIntervalMs ?? 2000;
    this.onEvent = opts.onEvent;
    this.maxFiles = opts.maxFiles ?? 20;
  }

  start(): void {
    this.stopped = false;
    // Initial scan
    this.scan();
    // Periodic poll
    this.timer = setInterval(() => this.scan(), this.pollMs);
  }

  stop(): void {
    this.stopped = true;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.offsets.clear();
  }

  private scan(): void {
    if (this.stopped) return;
    try {
      const files = this.discoverFiles();
      for (const filePath of files) {
        this.tailFile(filePath);
      }
    } catch (err) {
      // Base directory may not exist yet — that's fine
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
        logger.warn({ err }, '[CodexWatcher] Scan error');
      }
    }
  }

  /**
   * Find .jsonl files in today's directory (and yesterday's for sessions spanning midnight).
   * Returns up to maxFiles paths sorted by mtime descending (most recent first).
   */
  private discoverFiles(): string[] {
    const files: Array<{ path: string; mtime: number }> = [];

    for (const date of this.recentDates()) {
      const dayDir = path.join(this.basePath, date);
      if (!fs.existsSync(dayDir)) continue;

      for (const entry of fs.readdirSync(dayDir)) {
        if (!entry.endsWith('.jsonl')) continue;
        const fullPath = path.join(dayDir, entry);
        try {
          const stat = fs.statSync(fullPath);
          files.push({ path: fullPath, mtime: stat.mtimeMs });
        } catch {
          // File may have been deleted between readdir and stat
        }
      }
    }

    // Most recently modified first, limited to maxFiles
    return files
      .sort((a, b) => b.mtime - a.mtime)
      .slice(0, this.maxFiles)
      .map((f) => f.path);
  }

  /** Return date directory paths for today and yesterday. */
  private recentDates(): string[] {
    const now = new Date();
    const today = this.formatDate(now);
    const yesterday = new Date(now.getTime() - 86_400_000);
    return [today, this.formatDate(yesterday)];
  }

  private formatDate(d: Date): string {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return path.join(String(y), m, day);
  }

  /** Read new bytes from a file starting at the last known offset. */
  private tailFile(filePath: string): void {
    const offset = this.offsets.get(filePath) ?? 0;
    let stat: fs.Stats;
    try {
      stat = fs.statSync(filePath);
    } catch {
      return; // File gone
    }

    if (stat.size <= offset) return; // No new data

    const fd = fs.openSync(filePath, 'r');
    try {
      const buf = Buffer.alloc(stat.size - offset);
      fs.readSync(fd, buf, 0, buf.length, offset);
      this.offsets.set(filePath, stat.size);

      const sessionId = this.extractSessionId(filePath);
      const text = buf.toString('utf-8');

      for (const line of text.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        try {
          const raw = JSON.parse(trimmed) as Record<string, unknown>;
          raw.codex_source = 'watcher';
          raw.session_id = sessionId;
          this.onEvent(raw);
        } catch {
          // Malformed JSON line — skip
        }
      }
    } finally {
      fs.closeSync(fd);
    }
  }

  /** Extract session ID from filename: rollout-<id>.jsonl → <id> */
  private extractSessionId(filePath: string): string {
    const base = path.basename(filePath, '.jsonl');
    // Common patterns: rollout-<id>, session-<id>, or just <id>
    const match = base.match(/^(?:rollout|session)-(.+)$/);
    return match ? match[1] : base;
  }
}
```

**Step 4: Run test to verify it passes**

Run: `cd packages/server && npx vitest run src/__tests__/codexWatcher.test.ts`
Expected: PASS

**Step 5: Wire into server startup**

In `packages/server/src/index.ts`, add after the `startPruneTimer()` call (~line 33):

```typescript
// --- Codex JSONL watcher (opt-in via env var) ---
import { CodexWatcher } from './services/codexWatcher.js';
import { CodexAdapter } from './adapters/codex.js';
import { storeNormalized } from './services/eventStore.js';

if (process.env.SYNAPSE_CODEX_WATCH === '1') {
  const codexAdapter = new CodexAdapter();
  const codexWatcher = new CodexWatcher({
    onEvent: (raw) => {
      try {
        const event = codexAdapter.normalize(raw);
        storeNormalized(event, broadcaster, {
          hookEventName: 'codex',
          rawPayload: raw,
        });
      } catch (err) {
        logger.warn({ err }, '[CodexWatcher] Failed to process event');
      }
    },
  });
  codexWatcher.start();
  logger.info('[CodexWatcher] Watching ~/.codex/sessions/ for JSONL files');
}
```

Note: The `broadcaster` reference means this block must go AFTER `const broadcaster = new Broadcaster();` (line 37). Move the import to the top of the file, and the startup block after broadcaster creation.

**Step 6: Commit**

```bash
git add packages/server/src/services/codexWatcher.ts packages/server/src/__tests__/codexWatcher.test.ts packages/server/src/index.ts
git commit -m "feat(server): add CodexFileWatcher for ~/.codex/sessions JSONL tailing"
```

---

## Task 4: Add OpenAI + Google Models to Dashboard Constants

**Files:**

- Modify: `apps/dashboard/src/components/analytics/shared/constants.ts:6-20`
- Modify: `apps/dashboard/src/components/analytics/executive/ExecutiveOverview.tsx:27-37`

**Step 1: Update shared constants**

In `apps/dashboard/src/components/analytics/shared/constants.ts`, replace the `MODEL_COLORS` and `MODEL_LABELS` objects:

```typescript
export const MODEL_COLORS: Record<string, string> = {
  // Anthropic
  'claude-opus-4-6': '#e8956a',
  'claude-sonnet-4-5': '#3b82f6',
  'claude-sonnet-4-5-20250929': '#3b82f6',
  'claude-haiku-4-5': '#22d3ee',
  'claude-haiku-4-5-20251001': '#22d3ee',
  // OpenAI
  'o4-mini': '#10b981',
  'o3-mini': '#059669',
  o1: '#047857',
  'gpt-4o': '#34d399',
  'gpt-4o-mini': '#6ee7b7',
  // Google
  'gemini-2.5-pro': '#3b82f6',
  'gemini-2.5-flash': '#60a5fa',
};

export const MODEL_LABELS: Record<string, string> = {
  // Anthropic
  'claude-opus-4-6': 'Opus 4.6',
  'claude-sonnet-4-5': 'Sonnet 4.5',
  'claude-sonnet-4-5-20250929': 'Sonnet 4.5',
  'claude-haiku-4-5': 'Haiku 4.5',
  'claude-haiku-4-5-20251001': 'Haiku 4.5',
  // OpenAI
  'o4-mini': 'o4-mini',
  'o3-mini': 'o3-mini',
  o1: 'o1',
  'gpt-4o': 'GPT-4o',
  'gpt-4o-mini': 'GPT-4o Mini',
  // Google
  'gemini-2.5-pro': 'Gemini 2.5 Pro',
  'gemini-2.5-flash': 'Gemini 2.5 Flash',
};
```

**Step 2: Update ExecutiveOverview local copy**

In `apps/dashboard/src/components/analytics/executive/ExecutiveOverview.tsx`, replace the local `MODEL_COLORS` and `MODEL_LABELS` with imports from shared constants:

Replace lines 27-37:

```typescript
import { MODEL_COLORS, MODEL_LABELS } from '../shared/constants';
```

And remove the local `const MODEL_COLORS` and `const MODEL_LABELS` declarations.

**Step 3: Commit**

```bash
git add apps/dashboard/src/components/analytics/shared/constants.ts apps/dashboard/src/components/analytics/executive/ExecutiveOverview.tsx
git commit -m "feat(dashboard): add OpenAI + Google models to color/label maps"
```

---

## Task 5: Wire Vendor Filter to Analytics API

**Files:**

- Modify: `apps/dashboard/src/components/analytics/useAnalyticsData.ts:198`

**Step 1: Add vendor to URL params**

In `apps/dashboard/src/components/analytics/useAnalyticsData.ts`, after the `if (filters.cwd)` line (~198), add:

```typescript
if (filters.vendor) params.set('vendor', filters.vendor);
```

**Step 2: Add vendor to useCallback deps**

Find the dependency array of the `fetchData` useCallback and add `filters.vendor` to it.

**Step 3: Commit**

```bash
git add apps/dashboard/src/components/analytics/useAnalyticsData.ts
git commit -m "fix(dashboard): wire vendor filter to analytics API requests"
```

---

## Task 6: Render VendorBreakdown + Vendor Filter UI

**Files:**

- Modify: `apps/dashboard/src/components/analytics/executive/ExecutiveOverview.tsx`

**Step 1: Import VendorBreakdown**

Add at the top of `ExecutiveOverview.tsx`:

```typescript
import { VendorBreakdown } from './VendorBreakdown';
```

**Step 2: Compute vendors from session data**

Inside the component, add a useMemo:

```typescript
const vendors = useMemo(() => {
  const set = new Set(data.sessions.map((s) => s.vendor || 'anthropic'));
  return [...set].sort();
}, [data.sessions]);
```

**Step 3: Render VendorBreakdown conditionally**

After the tertiary row (after the closing `</div>` of the `grid-cols-2` section, before the component's closing `</div>`), add:

```tsx
{
  /* Vendor Breakdown — shown when sessions span multiple vendors */
}
{
  vendors.length > 1 && (
    <VendorBreakdown sessions={data.sessions} dailyRollups={data.dailyRollups} />
  );
}
```

**Step 4: Commit**

```bash
git add apps/dashboard/src/components/analytics/executive/ExecutiveOverview.tsx
git commit -m "feat(dashboard): render VendorBreakdown and vendor filter in analytics"
```

---

## Task 7: Create `openclaw.plugin.json` Manifest

**Files:**

- Create: `packages/openclaw/openclaw.plugin.json`

**Step 1: Create the manifest**

Create `packages/openclaw/openclaw.plugin.json`:

```json
{
  "id": "synapse-monitor",
  "name": "Synapse — AI Agent Monitor",
  "description": "Real-time visual dashboard for monitoring AI agent sessions, tool calls, costs, and performance",
  "version": "0.1.0",
  "configSchema": {
    "type": "object",
    "additionalProperties": false,
    "properties": {
      "port": {
        "type": "number",
        "default": 4000,
        "description": "Dashboard server port"
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
        }
      },
      "wrappedProviders": {
        "type": "array",
        "items": { "type": "string" },
        "default": [],
        "description": "Provider IDs to wrap (e.g., [\"anthropic\", \"openai\"])"
      },
      "watchPaths": {
        "type": "array",
        "items": { "type": "string" },
        "default": [],
        "description": "Additional directories to watch for JSONL transcripts"
      }
    }
  },
  "uiHints": {
    "port": { "label": "Server Port" },
    "dbPath": { "label": "Database Path" }
  }
}
```

**Step 2: Commit**

```bash
git add packages/openclaw/openclaw.plugin.json
git commit -m "feat(openclaw): add openclaw.plugin.json manifest"
```

---

## Task 8: Rewrite OpenClaw Build Pipeline

**Files:**

- Rewrite: `packages/openclaw/esbuild.mjs`

**Step 1: Rewrite esbuild.mjs**

Replace `packages/openclaw/esbuild.mjs` with:

```javascript
// SPDX-License-Identifier: AGPL-3.0-only
// Build pipeline for standalone @synapse-ai/openclaw distribution.
// Produces: dist/plugin.js, dist/server.mjs, dist/dashboard/

import * as esbuild from 'esbuild';
import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';

const ROOT = path.resolve(import.meta.dirname, '..', '..');
const DIST = path.resolve(import.meta.dirname, 'dist');

// ── 1. Bundle plugin entry ──────────────────────────────────────────

fs.mkdirSync(DIST, { recursive: true });

await esbuild.build({
  entryPoints: ['src/plugin.ts'],
  bundle: true,
  outfile: path.join(DIST, 'plugin.js'),
  format: 'esm',
  platform: 'node',
  target: 'node20',
  sourcemap: true,
  minify: false,
  external: [
    'openclaw', // peer dep — provided by host
    'openclaw/*', // any openclaw sub-imports
  ],
  banner: {
    js: [
      'import { createRequire as __createRequire } from "module";',
      'import { fileURLToPath as __fileURLToPath } from "url";',
      'import { dirname as __pathDirname } from "path";',
      'const require = __createRequire(import.meta.url);',
      'const __filename = __fileURLToPath(import.meta.url);',
      'const __dirname = __pathDirname(__filename);',
    ].join('\n'),
  },
});

console.log('[1/4] Plugin bundle complete: dist/plugin.js');

// ── 2. Bundle the Synapse server (pure JS — sql.js, no native modules) ──

const sqlJsPath = (() => {
  // Try workspace location first, then node_modules
  const candidates = [
    path.join(ROOT, 'packages', 'server', 'node_modules', 'sql.js', 'dist', 'sql-asm.js'),
    path.join(ROOT, 'node_modules', 'sql.js', 'dist', 'sql-asm.js'),
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  throw new Error('sql.js not found — run pnpm install in packages/server');
})();

await esbuild.build({
  entryPoints: [path.join(ROOT, 'packages', 'server', 'src', 'index.ts')],
  bundle: true,
  outfile: path.join(DIST, 'server.mjs'),
  format: 'esm',
  platform: 'node',
  target: 'node20',
  sourcemap: false,
  minify: true,
  plugins: [
    {
      name: 'sql-js-asm',
      setup(build) {
        build.onResolve({ filter: /^sql\.js$/ }, () => ({
          path: sqlJsPath,
        }));
      },
    },
  ],
  banner: {
    js: [
      'import { createRequire as __createRequire } from "module";',
      'import { fileURLToPath as __fileURLToPath } from "url";',
      'import { dirname as __pathDirname } from "path";',
      'const require = __createRequire(import.meta.url);',
      'const __filename = __fileURLToPath(import.meta.url);',
      'const __dirname = __pathDirname(__filename);',
    ].join('\n'),
  },
});

console.log('[2/4] Server bundle complete: dist/server.mjs');

// ── 3. Build dashboard frontend ─────────────────────────────────────

const dashboardOut = path.join(DIST, 'dashboard');
try {
  console.log('[3/4] Building dashboard frontend...');
  execSync('pnpm --filter @synapse-ai/dashboard build', {
    cwd: ROOT,
    stdio: 'inherit',
  });

  const dashboardDist = path.join(ROOT, 'apps', 'dashboard', 'dist');
  if (fs.existsSync(dashboardDist)) {
    if (fs.existsSync(dashboardOut)) {
      fs.rmSync(dashboardOut, { recursive: true });
    }
    copyDirSync(dashboardDist, dashboardOut);
    console.log('[3/4] Dashboard built and copied to dist/dashboard/');
  } else {
    console.warn('[3/4] WARNING: Dashboard dist not found after build');
  }
} catch (err) {
  console.error('[3/4] Dashboard build failed:', err.message);
  console.warn('Plugin will work but the dashboard UI will show a status page instead.');
}

// ── 4. Copy manifest ────────────────────────────────────────────────

fs.copyFileSync(
  path.join(import.meta.dirname, 'openclaw.plugin.json'),
  path.join(DIST, '..', 'openclaw.plugin.json'),
);
console.log('[4/4] Manifest copied.');

console.log('\nBuild complete. Package with: npm pack');

// ── Helper ──────────────────────────────────────────────────────────

function copyDirSync(src, dst) {
  fs.mkdirSync(dst, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const srcPath = path.join(src, entry.name);
    const dstPath = path.join(dst, entry.name);
    if (entry.isDirectory()) {
      copyDirSync(srcPath, dstPath);
    } else {
      fs.copyFileSync(srcPath, dstPath);
    }
  }
}
```

**Step 2: Commit**

```bash
git add packages/openclaw/esbuild.mjs
git commit -m "feat(openclaw): rewrite build pipeline — bundle server + dashboard"
```

---

## Task 9: Update Plugin to Spawn Bundled Server

**Files:**

- Modify: `packages/openclaw/src/plugin.ts`

**Step 1: Replace the server spawn logic**

Replace the server spawn section in `packages/openclaw/src/plugin.ts` (lines 30-67). The key changes:

- Use `node` instead of `npx tsx`
- Path is `path.join(__dirname, 'server.mjs')` (co-located in dist/)
- Set `SYNAPSE_DASHBOARD_DIR` to `path.join(__dirname, 'dashboard')`

Replace the full file:

```typescript
// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Synapse Contributors

import { SynapseConfigSchema } from './config.js';
import type { SynapseConfig, PluginDeps, OpenClawTool } from './types.js';
import { JsonlBridge } from './layers/jsonlBridge.js';
import { createAgentTools } from './layers/agentTools.js';
import { ProviderWrapper } from './layers/providerWrapper.js';
import { spawn } from 'child_process';
import path from 'path';

// __dirname is injected by the esbuild banner (works in both dev and bundled)
declare const __dirname: string;

export default {
  id: 'synapse-monitor',
  slot: 'tool' as const,
  metadata: {
    name: 'Synapse — AI Monitor',
    description: 'Real-time AI agent monitoring dashboard for OpenClaw',
  },
  schema: SynapseConfigSchema,

  init: async (config: SynapseConfig, deps: PluginDeps) => {
    const { logger, configDir } = deps;
    const port = config.port || 4000;

    logger.info(`[Synapse] Initializing on port ${port}`);

    // ── 1. Start Synapse server ──
    // In production (bundled): dist/server.mjs is co-located with dist/plugin.js
    // In development: falls back to npx tsx for the monorepo source
    const bundledServer = path.join(__dirname, 'server.mjs');
    const dashboardDir = path.join(__dirname, 'dashboard');

    const env: Record<string, string> = {
      ...(process.env as Record<string, string>),
      PORT: String(port),
      SYNAPSE_MODE: 'openclaw',
      SYNAPSE_DASHBOARD_DIR: dashboardDir,
    };

    if (config.dbPath) {
      env.SYNAPSE_DB_PATH = config.dbPath;
    }

    // Determine how to start the server
    const { existsSync } = await import('fs');
    const useBundled = existsSync(bundledServer);

    const cmd = useBundled ? process.execPath : 'npx';
    const args = useBundled
      ? [bundledServer]
      : ['tsx', path.resolve(__dirname, '..', 'packages', 'server', 'src', 'index.ts')];

    const serverProcess = spawn(cmd, args, {
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: !useBundled, // shell only needed for npx in dev
    });

    serverProcess.stdout?.on('data', (data: Buffer) => {
      logger.info(`[Synapse Server] ${data.toString().trim()}`);
    });

    serverProcess.stderr?.on('data', (data: Buffer) => {
      logger.warn(`[Synapse Server] ${data.toString().trim()}`);
    });

    serverProcess.on('error', (err) => {
      logger.error(`[Synapse] Server process error: ${err.message}`);
    });

    serverProcess.on('exit', (code) => {
      if (code !== 0 && code !== null) {
        logger.error(`[Synapse] Server exited with code ${code}`);
      }
    });

    // Wait for server to be ready
    await waitForServer(port, 15_000);
    logger.info(`[Synapse] Server ready at http://localhost:${port}`);

    // ── 2. Layer 1: JSONL Transcript Watcher ──
    let jsonlBridge: JsonlBridge | undefined;
    if (config.layers.transcriptWatcher) {
      jsonlBridge = new JsonlBridge(port, logger);
      const watchPaths =
        config.watchPaths.length > 0 ? config.watchPaths : [path.join(configDir, 'agents')];

      for (const watchPath of watchPaths) {
        jsonlBridge.watchAgentsDir(watchPath);
      }
      logger.info(`[Synapse] Layer 1: Transcript watcher active (${watchPaths.length} path(s))`);
    }

    // ── 3. Layer 2: Agent Tools ──
    let tools: OpenClawTool[] = [];
    if (config.layers.agentTools) {
      tools = createAgentTools(port);
      logger.info(`[Synapse] Layer 2: ${tools.length} agent tools registered`);
    }

    // ── 4. Layer 3: Provider Wrapper ──
    let providerWrapper: ProviderWrapper | undefined;
    if (config.layers.providerWrapper && config.wrappedProviders.length > 0) {
      providerWrapper = new ProviderWrapper(port, config.wrappedProviders, logger);
      logger.info(`[Synapse] Layer 3: Provider wrapper for ${config.wrappedProviders.join(', ')}`);
    }

    // ── Cleanup on shutdown ──
    const cleanup = () => {
      jsonlBridge?.stop();
      providerWrapper?.stop();
      if (serverProcess.pid && !serverProcess.killed) {
        serverProcess.kill('SIGTERM');
      }
    };

    process.on('SIGINT', cleanup);
    process.on('SIGTERM', cleanup);

    return {
      tools,
      dispose: cleanup,
    };
  },
};

async function waitForServer(port: number, timeoutMs: number): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(`http://localhost:${port}/api/health`);
      if (res.ok) return;
    } catch {
      // Server not ready yet
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`Synapse server did not start within ${timeoutMs}ms`);
}
```

**Step 2: Commit**

```bash
git add packages/openclaw/src/plugin.ts
git commit -m "feat(openclaw): spawn bundled server.mjs with dashboard dir"
```

---

## Task 10: Update `package.json` for Standalone Distribution

**Files:**

- Modify: `packages/openclaw/package.json`

**Step 1: Rewrite package.json**

Replace the full file:

```json
{
  "name": "@synapse-ai/openclaw",
  "version": "0.1.0",
  "description": "Real-time AI agent monitoring dashboard for OpenClaw",
  "license": "AGPL-3.0-or-later",
  "type": "module",
  "main": "dist/plugin.js",
  "types": "dist/plugin.d.ts",
  "openclaw": {
    "extensions": [
      {
        "id": "synapse-monitor",
        "entry": "./dist/plugin.js"
      }
    ]
  },
  "exports": {
    ".": {
      "types": "./dist/plugin.d.ts",
      "import": "./dist/plugin.js"
    }
  },
  "files": ["dist/", "openclaw.plugin.json"],
  "scripts": {
    "build": "node esbuild.mjs",
    "clean": "rm -rf dist",
    "pack": "npm pack"
  },
  "peerDependencies": {
    "openclaw": "*"
  },
  "devDependencies": {
    "@sinclair/typebox": "^0.34.0",
    "esbuild": "^0.24.0",
    "typescript": "^5.7.0"
  }
}
```

Key changes:

- Removed all `dependencies` (server is bundled, `@synapse-ai/core` was never used)
- Removed `tsx` from devDeps (no longer needed at runtime)
- Added `openclaw.plugin.json` to `files`
- Added `pack` script

**Step 2: Commit**

```bash
git add packages/openclaw/package.json
git commit -m "feat(openclaw): zero runtime deps — everything bundled"
```

---

## Task 11: Build, Test, and Pack

**Step 1: Run the OpenClaw build**

```bash
cd packages/openclaw && pnpm run build
```

Expected output:

```
[1/4] Plugin bundle complete: dist/plugin.js
[2/4] Server bundle complete: dist/server.mjs
[3/4] Dashboard built and copied to dist/dashboard/
[4/4] Manifest copied.
```

**Step 2: Verify dist contents**

```bash
ls -la packages/openclaw/dist/
# Should contain: plugin.js, plugin.js.map, server.mjs, dashboard/
ls packages/openclaw/dist/dashboard/
# Should contain: index.html, assets/
```

**Step 3: Smoke test — spawn server from dist**

```bash
node packages/openclaw/dist/server.mjs
# Should start on port 4000, serve dashboard
# Visit http://localhost:4000 — should see the Synapse dashboard
# Ctrl+C to stop
```

**Step 4: Create the tarball**

```bash
cd packages/openclaw && npm pack
# Produces: synapse-ai-openclaw-0.1.0.tgz
```

**Step 5: Verify tarball contents**

```bash
tar tzf packages/openclaw/synapse-ai-openclaw-0.1.0.tgz | head -20
# Should show:
# package/dist/plugin.js
# package/dist/server.mjs
# package/dist/dashboard/index.html
# package/dist/dashboard/assets/...
# package/openclaw.plugin.json
# package/package.json
```

**Step 6: Commit**

```bash
git add -A packages/openclaw/
git commit -m "feat(openclaw): standalone distributable package — v0.1.0"
```

---

## Task 12: Update ROADMAP

**Files:**

- Modify: `docs/ROADMAP.md`

Update Phase 5e to 100% DONE (PacMan intentionally dropped), Phase 9.3 and 9.4 statuses, and add the OpenClaw standalone milestone.

**Commit:**

```bash
git add docs/ROADMAP.md
git commit -m "docs: update ROADMAP — Phase 5e done, 9.3/9.4 progress, OpenClaw standalone"
```

---

## Task 13: Deploy to VPS for Testing

Not a code task — manual steps for deploying the `.tgz` to openclaw.campkzb.com:

```bash
# On your local machine, copy the tarball to the VPS
scp packages/openclaw/synapse-ai-openclaw-0.1.0.tgz user@your-vps:~/

# On the VPS (via Hostinger terminal)
openclaw plugins install ~/synapse-ai-openclaw-0.1.0.tgz

# Or if using dev-link mode:
# Extract and link
mkdir -p ~/synapse-plugin && cd ~/synapse-plugin
tar xzf ~/synapse-ai-openclaw-0.1.0.tgz --strip-components=1
openclaw plugins install -l ~/synapse-plugin
```

Then restart OpenClaw and check if the dashboard is accessible at `http://localhost:4000` (or whatever port you configure).
