# Hook Controls Simplification — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the manual JSON config snippet in the Hook Controls screen with auto-detection toggles that read/write `.claude/settings.local.json` directly.

**Architecture:** New `hookConfigService` in the server reads/writes hook config files. Two new REST endpoints (`GET`/`POST /api/hook-config`) expose this to the dashboard. The frontend replaces its JSON snippet + copy button with two toggle switches (Observation Hooks, Remote Approval) that call these endpoints.

**Tech Stack:** Express 5, Zod, Vitest + supertest, React 19, Tailwind CSS 4

**Spec:** `docs/superpowers/specs/2026-03-21-hook-controls-simplification-design.md`

---

## File Map

| File                                                         | Action                        | Responsibility                                                          |
| ------------------------------------------------------------ | ----------------------------- | ----------------------------------------------------------------------- |
| `packages/server/src/services/hookConfigService.ts`          | Create                        | `validateCwd()`, `readHookStatus()`, `writeHookConfig()`, `configure()` |
| `packages/server/src/__tests__/hookConfig.test.ts`           | Create                        | Unit tests for service + integration tests for routes                   |
| `packages/server/src/routes/hookConfig.ts`                   | Create                        | `GET`/`POST /api/hook-config` route handlers                            |
| `packages/server/src/app.ts`                                 | Modify (line 117)             | Mount `createHookConfigRouter()`                                        |
| `packages/server/src/index.ts`                               | Modify (line 65)              | Call `configure()` with resolved hook script path                       |
| `apps/dashboard/src/components/settings/HookControlsTab.tsx` | Modify (full rewrite of body) | Replace JSON snippet with toggle UI                                     |

---

### Task 1: hookConfigService — validateCwd

**Files:**

- Create: `packages/server/src/services/hookConfigService.ts`
- Create: `packages/server/src/__tests__/hookConfig.test.ts`

- [ ] **Step 1: Write failing tests for validateCwd**

```typescript
// packages/server/src/__tests__/hookConfig.test.ts
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import os from 'os';
import path from 'path';
import fs from 'fs';

// Must import after setting up mocks in later tasks
import { validateCwd } from '../services/hookConfigService.js';

describe('validateCwd', () => {
  it('rejects relative paths', () => {
    expect(() => validateCwd('relative/path')).toThrow(/absolute/i);
  });

  it('rejects paths with .. segments', () => {
    expect(() => validateCwd('/foo/bar/../../../etc')).toThrow();
  });

  it('rejects home directory', () => {
    expect(() => validateCwd(os.homedir())).toThrow(/global/i);
  });

  it('rejects ~/.claude directory', () => {
    expect(() => validateCwd(path.join(os.homedir(), '.claude'))).toThrow(/global/i);
  });

  it('rejects paths where .claude/ does not exist', () => {
    const fakePath = path.join(os.tmpdir(), 'nonexistent-project-' + Date.now());
    expect(() => validateCwd(fakePath)).toThrow(/\.claude/);
  });

  it('accepts valid project with .claude/ directory', () => {
    const tmp = path.join(os.tmpdir(), 'hookconfig-test-' + Date.now());
    fs.mkdirSync(path.join(tmp, '.claude'), { recursive: true });
    try {
      expect(() => validateCwd(tmp)).not.toThrow();
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run packages/server/src/__tests__/hookConfig.test.ts`
Expected: FAIL — `validateCwd` not found

- [ ] **Step 3: Implement validateCwd**

```typescript
// packages/server/src/services/hookConfigService.ts
import fs from 'fs';
import path from 'path';
import os from 'os';

/** Resolved path to send_event.cjs — set via configure(). */
let hookScriptPath: string | null = null;

/** All hook events that get observation hooks. */
const ALL_EVENTS = [
  'SessionStart',
  'UserPromptSubmit',
  'SubagentStart',
  'SubagentStop',
  'Stop',
  'SessionEnd',
  'PreToolUse',
  'PostToolUse',
  'PostToolUseFailure',
  'PermissionRequest',
  'Notification',
  'PreCompact',
];

/**
 * Initialize the service with the resolved hook script path.
 * Called once from index.ts at startup.
 */
export function configure(scriptPath: string): void {
  hookScriptPath = scriptPath;
}

/** Return the configured hook script path (for testing). */
export function getHookScriptPath(): string | null {
  return hookScriptPath;
}

function settingsFilePath(cwd: string): string {
  return path.join(cwd, '.claude', 'settings.local.json');
}

/**
 * Validate cwd is safe to read/write hook config for.
 * Throws on invalid paths.
 */
export function validateCwd(cwd: string): void {
  // Must be absolute
  if (!path.isAbsolute(cwd)) {
    throw new Error(`Path must be absolute: ${cwd}`);
  }

  // Resolve and check for .. traversal
  const resolved = path.resolve(cwd);
  if (resolved !== path.normalize(cwd)) {
    throw new Error(`Path contains traversal segments: ${cwd}`);
  }

  // Must not be home dir or ~/.claude (global hooks break all sessions)
  const home = os.homedir();
  const resolvedNorm = resolved.replace(/\\/g, '/').toLowerCase();
  const homeNorm = home.replace(/\\/g, '/').toLowerCase();
  if (resolvedNorm === homeNorm || resolvedNorm === `${homeNorm}/.claude`) {
    throw new Error('Refusing to write global hooks — must be project-scoped');
  }

  // .claude/ directory must already exist
  const claudeDir = path.join(resolved, '.claude');
  if (!fs.existsSync(claudeDir) || !fs.statSync(claudeDir).isDirectory()) {
    throw new Error(`No .claude/ directory found in ${resolved}`);
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run packages/server/src/__tests__/hookConfig.test.ts`
Expected: All 6 tests PASS

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/services/hookConfigService.ts packages/server/src/__tests__/hookConfig.test.ts
git commit -m "feat(server): add hookConfigService with validateCwd"
```

---

### Task 2: hookConfigService — readHookStatus

**Files:**

- Modify: `packages/server/src/services/hookConfigService.ts`
- Modify: `packages/server/src/__tests__/hookConfig.test.ts`

- [ ] **Step 1: Write failing tests for readHookStatus**

Add to `hookConfig.test.ts`:

```typescript
import { readHookStatus } from '../services/hookConfigService.js';

describe('readHookStatus', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = path.join(os.tmpdir(), 'hookconfig-read-' + Date.now());
    fs.mkdirSync(path.join(tmpDir, '.claude'), { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('returns both false when no settings file exists', () => {
    const status = readHookStatus(tmpDir);
    expect(status).toEqual({ observation: false, remoteApproval: false });
  });

  it('detects observation hooks via send_event.cjs reference', () => {
    const settingsPath = path.join(tmpDir, '.claude', 'settings.local.json');
    fs.writeFileSync(
      settingsPath,
      JSON.stringify({
        hooks: {
          SessionStart: [
            {
              hooks: [{ type: 'command', command: 'node "/path/to/send_event.cjs"', async: true }],
            },
          ],
        },
      }),
    );
    const status = readHookStatus(tmpDir);
    expect(status.observation).toBe(true);
    expect(status.remoteApproval).toBe(false);
  });

  it('detects remote approval via HTTP hook on PermissionRequest', () => {
    const settingsPath = path.join(tmpDir, '.claude', 'settings.local.json');
    fs.writeFileSync(
      settingsPath,
      JSON.stringify({
        hooks: {
          PermissionRequest: [
            {
              hooks: [
                { type: 'command', command: 'node "/path/to/send_event.cjs"', async: true },
                { type: 'http', url: 'http://localhost:27247/api/hooks/permission', timeout: 1800 },
              ],
            },
          ],
        },
      }),
    );
    const status = readHookStatus(tmpDir);
    expect(status.observation).toBe(true);
    expect(status.remoteApproval).toBe(true);
  });

  it('handles malformed JSON gracefully', () => {
    const settingsPath = path.join(tmpDir, '.claude', 'settings.local.json');
    fs.writeFileSync(settingsPath, '{ broken json !!!');
    const status = readHookStatus(tmpDir);
    expect(status).toEqual({ observation: false, remoteApproval: false });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run packages/server/src/__tests__/hookConfig.test.ts`
Expected: FAIL — `readHookStatus` not found

- [ ] **Step 3: Implement readHookStatus**

Add to `hookConfigService.ts`:

```typescript
export interface HookStatus {
  observation: boolean;
  remoteApproval: boolean;
}

/**
 * Read the current hook status from a project's settings.local.json.
 * Returns { observation, remoteApproval } booleans.
 */
export function readHookStatus(cwd: string): HookStatus {
  const filePath = settingsFilePath(cwd);
  if (!fs.existsSync(filePath)) {
    return { observation: false, remoteApproval: false };
  }

  try {
    const content = fs.readFileSync(filePath, 'utf-8');

    // Quick string check for observation (matches CLI's isHooked())
    const observation = content.includes('send_event.cjs');

    // Parse for structured remoteApproval check
    let remoteApproval = false;
    if (observation) {
      const settings = JSON.parse(content);
      const permHooks = settings?.hooks?.PermissionRequest;
      if (Array.isArray(permHooks)) {
        for (const matcher of permHooks) {
          const innerHooks = Array.isArray(matcher?.hooks) ? matcher.hooks : [];
          remoteApproval = innerHooks.some(
            (h: Record<string, unknown>) =>
              h.type === 'http' &&
              typeof h.url === 'string' &&
              (h.url as string).includes('/api/hooks/permission'),
          );
          if (remoteApproval) break;
        }
      }
    }

    return { observation, remoteApproval };
  } catch {
    return { observation: false, remoteApproval: false };
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run packages/server/src/__tests__/hookConfig.test.ts`
Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/services/hookConfigService.ts packages/server/src/__tests__/hookConfig.test.ts
git commit -m "feat(server): add readHookStatus to hookConfigService"
```

---

### Task 3: hookConfigService — writeHookConfig

**Files:**

- Modify: `packages/server/src/services/hookConfigService.ts`
- Modify: `packages/server/src/__tests__/hookConfig.test.ts`

- [ ] **Step 1: Write failing tests for writeHookConfig**

Add to `hookConfig.test.ts`:

```typescript
import { writeHookConfig, configure } from '../services/hookConfigService.js';

describe('writeHookConfig', () => {
  let tmpDir: string;
  const fakeScript = path.join(os.tmpdir(), 'fake-send-event.cjs');

  beforeEach(() => {
    tmpDir = path.join(os.tmpdir(), 'hookconfig-write-' + Date.now());
    fs.mkdirSync(path.join(tmpDir, '.claude'), { recursive: true });
    // Create fake hook script so configure() validation passes
    fs.writeFileSync(fakeScript, '// fake');
    configure(fakeScript);
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    try {
      fs.unlinkSync(fakeScript);
    } catch {
      /* ok */
    }
  });

  it('creates settings.local.json with observation hooks', () => {
    writeHookConfig(tmpDir, { observation: true, remoteApproval: false });
    const status = readHookStatus(tmpDir);
    expect(status.observation).toBe(true);
    expect(status.remoteApproval).toBe(false);
  });

  it('creates settings with observation + remote approval', () => {
    writeHookConfig(tmpDir, { observation: true, remoteApproval: true });
    const status = readHookStatus(tmpDir);
    expect(status.observation).toBe(true);
    expect(status.remoteApproval).toBe(true);
  });

  it('removes observation hooks when set to false', () => {
    writeHookConfig(tmpDir, { observation: true, remoteApproval: false });
    writeHookConfig(tmpDir, { observation: false, remoteApproval: false });
    const status = readHookStatus(tmpDir);
    expect(status.observation).toBe(false);
  });

  it('preserves non-Synapse hook entries', () => {
    const settingsPath = path.join(tmpDir, '.claude', 'settings.local.json');
    fs.writeFileSync(
      settingsPath,
      JSON.stringify({
        hooks: { CustomEvent: [{ hooks: [{ type: 'command', command: 'echo hi' }] }] },
        permissions: { allow: ['Bash'] },
      }),
    );
    writeHookConfig(tmpDir, { observation: true, remoteApproval: false });
    const written = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
    expect(written.hooks.CustomEvent).toBeDefined();
    expect(written.permissions).toEqual({ allow: ['Bash'] });
  });

  it('preserves send_response.cjs hooks on Stop event', () => {
    const settingsPath = path.join(tmpDir, '.claude', 'settings.local.json');
    fs.writeFileSync(
      settingsPath,
      JSON.stringify({
        hooks: {
          Stop: [
            {
              hooks: [
                { type: 'command', command: 'node "send_event.cjs"', async: true },
                { type: 'command', command: 'node "send_response.cjs"', async: true },
              ],
            },
          ],
        },
      }),
    );
    // Re-enable observation — should keep send_response.cjs
    writeHookConfig(tmpDir, { observation: true, remoteApproval: false });
    const written = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
    const stopHooks = written.hooks.Stop[0].hooks;
    const hasResponse = stopHooks.some(
      (h: Record<string, unknown>) =>
        typeof h.command === 'string' && (h.command as string).includes('send_response.cjs'),
    );
    expect(hasResponse).toBe(true);
  });

  it('deletes file when both false and no other settings remain', () => {
    writeHookConfig(tmpDir, { observation: true, remoteApproval: false });
    writeHookConfig(tmpDir, { observation: false, remoteApproval: false });
    const settingsPath = path.join(tmpDir, '.claude', 'settings.local.json');
    expect(fs.existsSync(settingsPath)).toBe(false);
  });

  it('keeps file when both false but other settings exist', () => {
    const settingsPath = path.join(tmpDir, '.claude', 'settings.local.json');
    fs.writeFileSync(
      settingsPath,
      JSON.stringify({
        hooks: {
          SessionStart: [
            { hooks: [{ type: 'command', command: 'node "send_event.cjs"', async: true }] },
          ],
        },
        permissions: { allow: ['Bash'] },
      }),
    );
    writeHookConfig(tmpDir, { observation: false, remoteApproval: false });
    expect(fs.existsSync(settingsPath)).toBe(true);
    const written = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
    expect(written.hooks).toBeUndefined();
    expect(written.permissions).toEqual({ allow: ['Bash'] });
  });

  it('handles ENOENT gracefully on cleanup', () => {
    // No settings file exists, disabling should not throw
    expect(() =>
      writeHookConfig(tmpDir, { observation: false, remoteApproval: false }),
    ).not.toThrow();
  });

  it('throws when hook script not found', () => {
    configure('/nonexistent/path/send_event.cjs');
    expect(() => writeHookConfig(tmpDir, { observation: true, remoteApproval: false })).toThrow(
      /hook script/i,
    );
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run packages/server/src/__tests__/hookConfig.test.ts`
Expected: FAIL — `writeHookConfig` not exported or not implemented

- [ ] **Step 3: Implement writeHookConfig**

Add to `hookConfigService.ts`:

```typescript
import { HOOK_PORT } from '@synapse-ai/core/config';

/**
 * Write hook configuration to a project's settings.local.json.
 * - observation: true → add send_event.cjs for all events
 * - remoteApproval: true → add HTTP hook to PermissionRequest
 * Preserves non-Synapse entries and non-send_event.cjs Synapse hooks.
 */
export function writeHookConfig(
  cwd: string,
  opts: { observation: boolean; remoteApproval: boolean },
): void {
  const filePath = settingsFilePath(cwd);

  // Disabling both — cleanup path
  if (!opts.observation && !opts.remoteApproval) {
    if (!fs.existsSync(filePath)) return; // ENOENT is fine

    let settings: Record<string, unknown>;
    try {
      settings = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    } catch {
      return;
    }

    // Remove all Synapse hook events
    const hooks = (settings.hooks ?? {}) as Record<string, unknown>;
    for (const event of ALL_EVENTS) {
      delete hooks[event];
    }
    if (Object.keys(hooks).length === 0) delete settings.hooks;

    // Clean up file if empty
    if (Object.keys(settings).length === 0) {
      try {
        fs.unlinkSync(filePath);
      } catch {
        /* ok */
      }
    } else {
      fs.writeFileSync(filePath, JSON.stringify(settings, null, 2));
    }
    return;
  }

  // Enabling — need the hook script
  if (opts.observation && !hookScriptPath) {
    throw new Error('Hook script path not configured — call configure() first');
  }
  if (opts.observation && hookScriptPath && !fs.existsSync(hookScriptPath)) {
    throw new Error(`Hook script not found: ${hookScriptPath}`);
  }

  const hookCmd = hookScriptPath ? `node "${hookScriptPath.replace(/\\/g, '/')}"` : '';

  // Read existing settings
  let settings: Record<string, unknown> = {};
  if (fs.existsSync(filePath)) {
    try {
      settings = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    } catch {
      /* start fresh */
    }
  }

  const existingHooks = (settings.hooks ?? {}) as Record<string, unknown[]>;

  if (opts.observation) {
    // Build hook entries for each event
    for (const event of ALL_EVENTS) {
      // Collect non-send_event.cjs entries to preserve (e.g., send_response.cjs)
      const existing = Array.isArray(existingHooks[event]) ? existingHooks[event] : [];
      const preserved: Array<Record<string, unknown>> = [];

      for (const matcher of existing) {
        const m = matcher as Record<string, unknown>;
        if (Array.isArray(m.hooks)) {
          for (const h of m.hooks as Array<Record<string, unknown>>) {
            const cmd = typeof h.command === 'string' ? h.command : '';
            const isObservation = cmd.includes('send_event.cjs');
            const isHttpPermission =
              h.type === 'http' &&
              typeof h.url === 'string' &&
              (h.url as string).includes('/api/hooks/permission');
            if (!isObservation && !isHttpPermission) {
              preserved.push(h);
            }
          }
        }
      }

      const inner: Array<Record<string, unknown>> = [
        { type: 'command', command: hookCmd, async: true },
        ...preserved,
      ];

      // Add HTTP hook for PermissionRequest if remote approval enabled
      if (event === 'PermissionRequest' && opts.remoteApproval) {
        inner.push({
          type: 'http',
          url: `http://localhost:${HOOK_PORT}/api/hooks/permission`,
          timeout: 1800,
        });
      }

      existingHooks[event] = [{ hooks: inner }];
    }
  } else {
    // observation: false — remove all Synapse events
    for (const event of ALL_EVENTS) {
      delete existingHooks[event];
    }
  }

  if (Object.keys(existingHooks).length === 0) {
    delete settings.hooks;
  } else {
    settings.hooks = existingHooks;
  }

  fs.writeFileSync(filePath, JSON.stringify(settings, null, 2));
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run packages/server/src/__tests__/hookConfig.test.ts`
Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/services/hookConfigService.ts packages/server/src/__tests__/hookConfig.test.ts
git commit -m "feat(server): add writeHookConfig with merge and cleanup logic"
```

---

### Task 4: Server route + mount

**Files:**

- Create: `packages/server/src/routes/hookConfig.ts`
- Modify: `packages/server/src/app.ts` (line ~117, add import + mount)
- Modify: `packages/server/src/__tests__/hookConfig.test.ts` (add route integration tests)

- [ ] **Step 1: Write failing integration tests**

Add to `hookConfig.test.ts`:

```typescript
import request from 'supertest';
import express from 'express';
import type { Express } from 'express';

describe('hook-config routes', () => {
  let app: Express;
  let tmpDir: string;
  const fakeScript = path.join(os.tmpdir(), 'fake-send-event-route.cjs');

  beforeEach(() => {
    tmpDir = path.join(os.tmpdir(), 'hookconfig-route-' + Date.now());
    fs.mkdirSync(path.join(tmpDir, '.claude'), { recursive: true });
    fs.writeFileSync(fakeScript, '// fake');
    configure(fakeScript);
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    try {
      fs.unlinkSync(fakeScript);
    } catch {
      /* ok */
    }
  });

  // Lazy import to avoid circular issues
  beforeEach(async () => {
    const { createHookConfigRouter } = await import('../routes/hookConfig.js');
    app = express();
    app.use(express.json());
    app.use('/api/hook-config', createHookConfigRouter());
  });

  it('GET returns 400 without cwd', async () => {
    const res = await request(app).get('/api/hook-config');
    expect(res.status).toBe(400);
  });

  it('GET returns status for valid cwd', async () => {
    const res = await request(app).get('/api/hook-config').query({ cwd: tmpDir });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ observation: false, remoteApproval: false, cwd: tmpDir });
  });

  it('POST enables observation hooks', async () => {
    const res = await request(app)
      .post('/api/hook-config')
      .send({ cwd: tmpDir, observation: true, remoteApproval: false });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.observation).toBe(true);
  });

  it('POST returns 400 for invalid body', async () => {
    const res = await request(app)
      .post('/api/hook-config')
      .send({ cwd: tmpDir, observation: 'yes' }); // not boolean
    expect(res.status).toBe(400);
  });

  it('POST returns 400 for invalid cwd', async () => {
    const res = await request(app)
      .post('/api/hook-config')
      .send({ cwd: 'relative/path', observation: true, remoteApproval: false });
    expect(res.status).toBe(400);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run packages/server/src/__tests__/hookConfig.test.ts`
Expected: FAIL — `createHookConfigRouter` not found

- [ ] **Step 3: Create the route file**

```typescript
// packages/server/src/routes/hookConfig.ts
import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { validateCwd, readHookStatus, writeHookConfig } from '../services/hookConfigService.js';

const HookConfigBody = z.object({
  cwd: z.string().min(1),
  observation: z.boolean(),
  remoteApproval: z.boolean(),
});

export function createHookConfigRouter(): Router {
  const router = Router();

  // GET /api/hook-config?cwd=<path>
  router.get('/', (req: Request, res: Response) => {
    const cwd = req.query.cwd as string;
    if (!cwd) {
      res.status(400).json({ error: 'cwd query parameter required' });
      return;
    }
    try {
      validateCwd(cwd);
      const status = readHookStatus(cwd);
      res.json({ ...status, cwd });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Invalid cwd';
      res.status(400).json({ error: message });
    }
  });

  // POST /api/hook-config
  router.post('/', (req: Request, res: Response) => {
    const parsed = HookConfigBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    const { cwd, observation, remoteApproval } = parsed.data;
    try {
      validateCwd(cwd);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Invalid cwd';
      res.status(400).json({ ok: false, error: message });
      return;
    }
    try {
      writeHookConfig(cwd, { observation, remoteApproval });
      const updated = readHookStatus(cwd);
      res.json({ ok: true, ...updated });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to write hook config';
      res.status(500).json({ ok: false, error: message });
    }
  });

  return router;
}
```

- [ ] **Step 4: Mount in app.ts**

In `packages/server/src/app.ts`, add:

- Import: `import { createHookConfigRouter } from './routes/hookConfig.js';`
- Mount (after the settings router, around line 117): `app.use('/api/hook-config', createHookConfigRouter());`

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run packages/server/src/__tests__/hookConfig.test.ts`
Expected: All tests PASS

- [ ] **Step 6: Commit**

```bash
git add packages/server/src/routes/hookConfig.ts packages/server/src/app.ts packages/server/src/__tests__/hookConfig.test.ts
git commit -m "feat(server): add /api/hook-config route with Zod validation"
```

---

### Task 5: Hook script path resolution in index.ts

**Files:**

- Modify: `packages/server/src/index.ts` (after line 65, before hook server setup)

- [ ] **Step 1: Add configure() call in index.ts**

Add after the `createApp()` call (around line 65):

```typescript
// --- Hook config service setup ---
import { configure as configureHookService } from './services/hookConfigService.js';

function resolveHookScript(): string | null {
  // 1. Env var override
  if (process.env.SYNAPSE_HOOKS_DIR) {
    const p = path.join(process.env.SYNAPSE_HOOKS_DIR, 'send_event.cjs');
    if (fs.existsSync(p)) return p;
  }
  // 2. Walk up from __dirname looking for pnpm-workspace.yaml (monorepo root)
  let dir = __dirname;
  for (let i = 0; i < 10; i++) {
    if (fs.existsSync(path.join(dir, 'pnpm-workspace.yaml'))) {
      const p = path.join(dir, 'hooks', 'send_event.cjs');
      if (fs.existsSync(p)) return p;
      break;
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  // 3. VS Code bundle layout (hooks/ sibling to server.mjs)
  const bundled = path.join(__dirname, 'hooks', 'send_event.cjs');
  if (fs.existsSync(bundled)) return bundled;

  return null;
}

const hookScript = resolveHookScript();
if (hookScript) {
  configureHookService(hookScript);
  logger.info({ hookScript }, 'Hook config service initialized');
} else {
  logger.warn('Could not find send_event.cjs — hook config API will not write hooks');
}
```

- [ ] **Step 2: Verify server starts without errors**

Run: `npx tsx packages/server/src/index.ts`
Expected: Server starts, logs "Hook config service initialized" with the resolved path. Stop with Ctrl+C.

- [ ] **Step 3: Commit**

```bash
git add packages/server/src/index.ts
git commit -m "feat(server): resolve hook script path at startup for hookConfigService"
```

---

### Task 6: Frontend — Replace JSON snippet with toggle UI

**Files:**

- Modify: `apps/dashboard/src/components/settings/HookControlsTab.tsx` (full body rewrite)

**Reference:**

- `apps/dashboard/src/utils/api.ts` — `apiUrl()` helper
- `apps/dashboard/src/store/agentStore.ts` — `projectCwd` export (line 35)

- [ ] **Step 1: Rewrite HookControlsTab.tsx**

Replace the entire file content with the new toggle-based implementation. Key changes:

1. Remove: `buildConfigSnippet()`, `handleCopy`, `copied` state, JSON snippet `<pre>`, copy button
2. Remove: "Hook Server Status" section, "Permission Approval" section
3. Add: `HookSetup` section with two toggle rows
4. Add: states — Loading, Ready, Saving, Error, No Project
5. Add: `cwd` fallback via `GET /api/events/sessions?limit=1`

```tsx
// apps/dashboard/src/components/settings/HookControlsTab.tsx
import { useState, useEffect, useCallback } from 'react';
import { apiUrl } from '../../utils/api';
import { QRCodePanel } from './QRCodePanel';
import { PushSetup } from './PushSetup';
import { usePermissionStore } from '../../store/permissionStore';
import { Features } from '@synapse-ai/core';
import { projectCwd } from '../../store/agentStore';

interface Props {
  open: boolean;
  onClose: () => void;
}

interface HookConfig {
  observation: boolean;
  remoteApproval: boolean;
  cwd: string;
}

type UiState = 'loading' | 'ready' | 'saving' | 'error' | 'no-project';

export function HookControlsTab({ open, onClose }: Props) {
  const [config, setConfig] = useState<HookConfig | null>(null);
  const [hookServerRunning, setHookServerRunning] = useState(false);
  const [uiState, setUiState] = useState<UiState>('loading');
  const [error, setError] = useState<string | null>(null);
  const resolved = usePermissionStore((s) => s.resolved);

  // Resolve cwd — use projectCwd from URL, fallback to most recent session
  const resolveCwd = useCallback(async (): Promise<string | null> => {
    if (projectCwd) return projectCwd;
    try {
      // Server returns up to 500 sessions; we only need the first one
      const res = await fetch(apiUrl('/api/events/sessions'));
      if (!res.ok) return null;
      const sessions = await res.json();
      if (Array.isArray(sessions) && sessions.length > 0 && sessions[0].cwd) {
        return sessions[0].cwd;
      }
    } catch {
      /* ok */
    }
    return null;
  }, []);

  // Fetch hook config + hook server status on open
  useEffect(() => {
    if (!open) return;
    let cancelled = false;

    async function load() {
      setUiState('loading');
      setError(null);

      // Fetch hook server status in parallel
      const hookStatusP = fetch(apiUrl('/api/hook-server/status'))
        .then((r) => r.json())
        .then((d) => d.running === true)
        .catch(() => false);

      const cwd = await resolveCwd();
      if (cancelled) return;

      if (!cwd) {
        setUiState('no-project');
        setHookServerRunning(await hookStatusP);
        return;
      }

      try {
        const [hookRunning, configRes] = await Promise.all([
          hookStatusP,
          fetch(apiUrl(`/api/hook-config?cwd=${encodeURIComponent(cwd)}`)),
        ]);
        if (cancelled) return;

        setHookServerRunning(hookRunning);

        if (configRes.ok) {
          const data: HookConfig = await configRes.json();
          setConfig(data);
          setUiState('ready');
        } else {
          const err = await configRes.json().catch(() => ({ error: 'Unknown error' }));
          setError(err.error ?? 'Failed to load hook config');
          setUiState('error');
        }
      } catch {
        if (!cancelled) {
          setError('Could not reach server');
          setUiState('error');
        }
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [open, resolveCwd]);

  // Toggle handler
  const handleToggle = useCallback(
    async (field: 'observation' | 'remoteApproval') => {
      if (!config) return;

      const prev = { ...config };
      let next = { ...config, [field]: !config[field] };

      // Dependency: enabling remoteApproval auto-enables observation
      if (field === 'remoteApproval' && !config.remoteApproval) {
        next.observation = true;
      }
      // Dependency: disabling observation auto-disables remoteApproval
      if (field === 'observation' && config.observation) {
        next.remoteApproval = false;
      }

      setConfig(next);
      setUiState('saving');
      setError(null);

      try {
        const res = await fetch(apiUrl('/api/hook-config'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            cwd: config.cwd,
            observation: next.observation,
            remoteApproval: next.remoteApproval,
          }),
        });

        if (res.ok) {
          const data = await res.json();
          setConfig({
            cwd: config.cwd,
            observation: data.observation,
            remoteApproval: data.remoteApproval,
          });
          setUiState('ready');
        } else {
          const err = await res.json().catch(() => ({ error: 'Unknown error' }));
          setConfig(prev); // revert
          setError(err.error ?? 'Failed to update hooks');
          setUiState('error');
        }
      } catch {
        setConfig(prev); // revert
        setError('Could not reach server');
        setUiState('error');
      }
    },
    [config],
  );

  if (!open) return null;

  const approved = resolved.filter((r) => r.behavior === 'allow').length;
  const denied = resolved.filter((r) => r.behavior === 'deny').length;
  const isSaving = uiState === 'saving';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="bg-syn-bg-elevated border border-gray-700 rounded-xl shadow-2xl w-full max-w-lg max-h-[85vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-700/50">
          <h2 className="text-sm font-semibold text-gray-200">Hook Controls</h2>
          <button
            onClick={onClose}
            className="text-gray-500 hover:text-gray-300 transition-colors"
            aria-label="Close"
          >
            <svg
              className="w-4 h-4"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="p-5 space-y-6">
          {/* QR Code section */}
          <QRCodePanel />

          {/* Hook Setup */}
          <section>
            <h3 className="text-xs text-gray-500 uppercase tracking-wider mb-3">Hook Setup</h3>

            {uiState === 'loading' && (
              <div className="space-y-3">
                <div className="h-10 bg-gray-800/50 rounded-lg animate-pulse" />
                <div className="h-10 bg-gray-800/50 rounded-lg animate-pulse" />
              </div>
            )}

            {uiState === 'no-project' && (
              <p className="text-xs text-gray-500 italic">
                No project detected. Open Synapse from a project directory to configure hooks.
              </p>
            )}

            {(uiState === 'ready' || uiState === 'saving' || uiState === 'error') && config && (
              <div className="space-y-3">
                {/* Observation toggle */}
                <div className="flex items-center justify-between rounded-lg bg-gray-800/30 px-3 py-2.5">
                  <div className="flex items-center gap-2">
                    <span
                      className={`w-2 h-2 rounded-full ${config.observation ? 'bg-green-400' : 'bg-gray-600'}`}
                    />
                    <div>
                      <p className="text-xs text-gray-200 font-medium">Observation Hooks</p>
                      <p className="text-[10px] text-gray-500">
                        Monitor sessions, tools, and agent activity
                      </p>
                    </div>
                  </div>
                  <button
                    onClick={() => handleToggle('observation')}
                    disabled={isSaving}
                    className={`relative w-9 h-5 rounded-full transition-colors ${
                      config.observation ? 'bg-green-600' : 'bg-gray-600'
                    } ${isSaving ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
                    aria-label={
                      config.observation ? 'Disable observation hooks' : 'Enable observation hooks'
                    }
                  >
                    <span
                      className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${
                        config.observation ? 'translate-x-4' : ''
                      }`}
                    />
                  </button>
                </div>

                {/* Remote Approval toggle */}
                <div className="flex items-center justify-between rounded-lg bg-gray-800/30 px-3 py-2.5">
                  <div className="flex items-center gap-2">
                    <span
                      className={`w-2 h-2 rounded-full ${config.remoteApproval ? 'bg-green-400' : 'bg-gray-600'}`}
                    />
                    <div>
                      <p className="text-xs text-gray-200 font-medium">Remote Approval</p>
                      <p className="text-[10px] text-gray-500">
                        Route permission prompts to this dashboard
                      </p>
                    </div>
                  </div>
                  <div className="relative group">
                    <button
                      onClick={() => handleToggle('remoteApproval')}
                      disabled={isSaving || !hookServerRunning}
                      className={`relative w-9 h-5 rounded-full transition-colors ${
                        config.remoteApproval ? 'bg-green-600' : 'bg-gray-600'
                      } ${isSaving || !hookServerRunning ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
                      aria-label={
                        config.remoteApproval ? 'Disable remote approval' : 'Enable remote approval'
                      }
                    >
                      <span
                        className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${
                          config.remoteApproval ? 'translate-x-4' : ''
                        }`}
                      />
                    </button>
                    {!hookServerRunning && (
                      <div className="absolute right-0 bottom-full mb-1.5 px-2 py-1 text-[10px] text-gray-300 bg-gray-900 border border-gray-700 rounded shadow-lg whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none">
                        Start Synapse with remote approval to enable
                      </div>
                    )}
                  </div>
                </div>

                {/* Error message */}
                {error && <p className="text-[10px] text-red-400 mt-1">{error}</p>}
              </div>
            )}
          </section>

          {/* Session stats */}
          {resolved.length > 0 && (
            <section>
              <h3 className="text-xs text-gray-500 uppercase tracking-wider mb-2">Session Stats</h3>
              <div className="flex items-center gap-4 text-xs text-gray-400">
                <span className="text-green-400">{approved} approved</span>
                <span className="text-red-400">{denied} denied</span>
              </div>
            </section>
          )}

          {/* Push Notifications */}
          {Features.pushNotifications && <PushSetup />}

          {/* Bypass note */}
          <div className="bg-blue-950/20 border border-blue-800/30 rounded-lg p-3">
            <p className="text-[11px] text-blue-300/80 leading-relaxed">
              Tools in your{' '}
              <code className="text-blue-200 bg-blue-900/30 px-1 rounded">permissions.allow</code>{' '}
              list bypass this routing — they run without a prompt. Only tools not yet in your allow
              list will appear as permission cards.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verify the dashboard builds**

Run: `cd apps/dashboard && npx vite build`
Expected: Build succeeds with no TypeScript or import errors

- [ ] **Step 3: Manual smoke test**

Start server and dashboard (`pnpm dev`), open Hook Controls panel. Verify:

1. Loading shimmer shows briefly
2. Toggles reflect current `settings.local.json` state
3. Toggling observation ON writes hooks to file
4. Toggling observation OFF removes hooks
5. Remote approval toggle is disabled if hook server isn't running
6. Remote approval toggle works if hook server is running
7. Toggling Remote Approval ON auto-enables Observation
8. Toggling Observation OFF auto-disables Remote Approval

- [ ] **Step 4: Commit**

```bash
git add apps/dashboard/src/components/settings/HookControlsTab.tsx
git commit -m "feat(dashboard): replace JSON config snippet with hook toggles"
```

---

### Task 7: End-to-end verification

- [ ] **Step 1: Run full test suite**

Run: `pnpm test`
Expected: All tests pass, including the new hookConfig tests

- [ ] **Step 2: Build VS Code extension**

Run: `cd apps/vscode && pnpm run package`
Expected: Build succeeds. The extension includes the new route and service.

- [ ] **Step 3: Commit any fixes**

If any tests or builds needed fixes, commit them:

```bash
git add -A
git commit -m "fix: address test/build issues from hook controls simplification"
```
