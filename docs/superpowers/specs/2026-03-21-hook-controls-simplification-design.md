# Hook Controls Simplification

**Date**: 2026-03-21
**Status**: Reviewed

## Problem

The Hook Controls screen shows a raw JSON config snippet and asks the user to manually copy it into `.claude/settings.json`. This is confusing and unnecessary — the CLI's `configureHooks()` already auto-configures everything. Users shouldn't need to understand hook JSON to enable permission routing.

## Goals

1. Replace the manual JSON snippet with auto-detection and one-click toggles
2. Let users choose between observation-only hooks and observation + remote approval
3. Keep the screen simple — no implementation details exposed to the user

## Non-Goals

- Changing the underlying hook mechanism (still `settings.local.json`)
- Supporting multiple projects in a single toggle view (one `cwd` at a time)
- Modifying the QR code, session stats, push notifications, or bypass note sections

## Design

### Backend: Hook Config API

Two new endpoints on the main server (not the hook server), mounted at `/api/hook-config`.

> **Why not `/api/hooks/config`?** The auth middleware in `app.ts` exempts all paths starting with `/api/hooks/` (Claude Code can't send Bearer tokens). A filesystem-write endpoint must NOT bypass auth. Mounting at `/api/hook-config` keeps it under normal API key auth.

#### `GET /api/hook-config?cwd=<path>`

Reads the project's `.claude/settings.local.json` and returns the current hook state.

**Response:**

```json
{
  "observation": true,
  "remoteApproval": false,
  "cwd": "c:/Workspace/Coding/Prototypes/Synapse"
}
```

**Detection logic:**

- `observation: true` if any hook entry references `send_event.cjs` (same check as CLI's `isHooked()`). Note: partial configurations (e.g., only 3 of 12 events hooked) still return `true`. Re-enabling normalizes to the full event set — this is intentional and matches CLI behavior.
- `remoteApproval: true` if the `PermissionRequest` hook array contains an entry with `"type": "http"` pointing at the hook server's `/api/hooks/permission` endpoint

#### `POST /api/hook-config`

Enables or disables hooks by writing to `.claude/settings.local.json`.

**Request body (Zod-validated):**

```typescript
const HookConfigBody = z.object({
  cwd: z.string().min(1),
  observation: z.boolean(),
  remoteApproval: z.boolean(),
});
```

```json
{
  "cwd": "c:/Workspace/Coding/Prototypes/Synapse",
  "observation": true,
  "remoteApproval": true
}
```

**Behavior:**

- `observation: true` — add `send_event.cjs` command hooks for every event type (SessionStart, UserPromptSubmit, SubagentStart, SubagentStop, Stop, SessionEnd, PreToolUse, PostToolUse, PostToolUseFailure, PermissionRequest, Notification, PreCompact). All are `async: true`.
- `observation: false` — remove all `send_event.cjs` command hooks
- `remoteApproval: true` — add the synchronous HTTP hook entry to the PermissionRequest event (`{ "type": "http", "url": "http://localhost:{hookPort}/api/hooks/permission", "timeout": 1800 }`)
- `remoteApproval: false` — remove the HTTP hook entry from PermissionRequest (keep the observation command hook if observation is still enabled)
- **Merge rules**: Non-Synapse hook entries are preserved. Additionally, non-`send_event.cjs` Synapse hooks (e.g., `send_response.cjs` on the Stop event) are preserved — the write logic only touches `send_event.cjs` command entries and the HTTP permission entry.
- If `settings.local.json` doesn't exist, create it on first enable
- **Cleanup**: If both toggles are `false` and no non-Synapse hooks remain, delete the `hooks` key. If the file is then empty (`{}`), delete it entirely (same behavior as CLI's `removeHooks()`). Handle `ENOENT` gracefully on cleanup (no-op if file already gone).

**Response:**

```json
{
  "ok": true,
  "observation": true,
  "remoteApproval": true
}
```

**Error response (e.g., file permission denied):**

```json
{
  "ok": false,
  "error": "EACCES: permission denied"
}
```

### Shared Logic

The core hook detection and configuration logic is extracted into `packages/server/src/services/hookConfigService.ts` rather than importing from the CLI package (which has its own build pipeline and path assumptions). The logic is small (~80 lines):

- `readHookStatus(cwd: string): { observation: boolean; remoteApproval: boolean }` — reads and parses `settings.local.json`
- `writeHookConfig(cwd: string, opts: { observation: boolean; remoteApproval: boolean }): void` — merges hook entries and writes the file
- `validateCwd(cwd: string): void` — throws if `cwd` fails safety checks (see Security section)

#### Hook script path resolution

The hook command string needs an absolute path to `send_event.cjs`. Rather than fragile relative `__dirname` paths (the service file is deeply nested at `packages/server/src/services/`), the server entry point (`index.ts`) computes the hooks directory at startup and exposes it as a module-level export or passes it as a dependency:

<!-- revised: P1 — process.cwd() is unreliable; use env var with marker-file fallback -->

- **Env var override**: If `SYNAPSE_HOOKS_DIR` is set, use it directly
- **Dev layout fallback**: Walk up from `__dirname` looking for `pnpm-workspace.yaml` (monorepo root marker), then resolve `hooks/send_event.cjs` relative to that root
- **VS Code bundle**: `path.resolve(__dirname, './hooks/send_event.cjs')` — hooks are copied to `resources/synapse-server/hooks/` during build

The `hookConfigService` receives the resolved hook script path via a `configure()` init function called from `index.ts` at startup. It validates `fs.existsSync()` at write time; if the path doesn't exist, the write fails with a clear error.

#### Hook entry structure

Claude Code hooks use a nested matcher structure. Each event maps to an array of matcher objects, each with a `hooks` array:

```json
{
  "Stop": [
    {
      "hooks": [
        { "type": "command", "command": "node \"/path/to/send_event.cjs\"", "async": true },
        { "type": "command", "command": "node \"/path/to/send_response.cjs\"", "async": true }
      ]
    }
  ]
}
```

The service must read and write this exact shape — NOT a flat array. See `packages/cli/src/hookSetup.ts` as the canonical reference for this format.

Port values come from `@synapse-ai/core/config`.

### Server Route

New file: `packages/server/src/routes/hookConfig.ts`

```typescript
export function createHookConfigRouter(): Router {
  const router = Router();

  router.get('/', (req, res) => {
    const cwd = req.query.cwd as string;
    if (!cwd) {
      res.status(400).json({ error: 'cwd required' });
      return;
    }
    try {
      validateCwd(cwd);
      const status = readHookStatus(cwd);
      res.json({ ...status, cwd });
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  router.post('/', (req, res) => {
    const parsed = HookConfigBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    const { cwd, observation, remoteApproval } = parsed.data;
    try {
      validateCwd(cwd);
      writeHookConfig(cwd, { observation, remoteApproval });
      const updated = readHookStatus(cwd);
      res.json({ ok: true, ...updated });
    } catch (err) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  return router;
}
```

Mounted in `app.ts` as `app.use('/api/hook-config', createHookConfigRouter())`.

### Frontend: Simplified HookControlsTab

The "Hook Server Status" and "Permission Approval" sections are replaced with a single **"Hook Setup"** section.

#### Layout

<!-- revised: P1 — removed port number from warning, use user-friendly language -->

```
HOOK SETUP
┌──────────────────────────────────────────────────────┐
│  ● Observation Hooks                    [toggle: ON] │
│  Monitor sessions, tools, and agent activity         │
│                                                      │
│  ○ Remote Approval                     [toggle: OFF] │
│  Route permission prompts to this dashboard          │
│  (disabled tooltip: "Start Synapse with --approval   │
│   to enable remote approval")                        │
└──────────────────────────────────────────────────────┘
```

#### States

<!-- revised: P1 — added loading state; P0 — added cwd fallback from recent sessions -->

| State          | What the user sees                                                                                               |
| -------------- | ---------------------------------------------------------------------------------------------------------------- |
| **Loading**    | Both toggles disabled + shimmer/skeleton, label: "Checking hook status..."                                       |
| **Ready**      | Toggles reflect current config, enabled for interaction                                                          |
| **Saving**     | The toggled switch is disabled with a spinner until POST completes (prevents race conditions from rapid clicks)  |
| **Error**      | Inline error message below the affected toggle, toggle reverts to previous state                                 |
| **No project** | Both toggles disabled, message: "No project detected. Open Synapse from a project directory to configure hooks." |

#### Behavior

- **On mount**: `GET /api/hook-config?cwd={cwdFilter}` to fetch current state. Show loading state until response arrives.
- **`cwd` resolution fallback**: If `cwdFilter` is null (dashboard opened without `?cwd=`), attempt to infer from the most recent session: `GET /api/sessions?limit=1` → use its `cwd` field. If no sessions exist either, show the "No project" state.
- **Toggle**: `POST /api/hook-config` with updated booleans. Disable the toggle during the request to prevent race conditions. Refresh state from response.
- **Status dots**: green when enabled, gray when disabled
- **Remote Approval toggle**: disabled (grayed out with tooltip: "Start Synapse with remote approval to enable") when hook server is not running. The hook server status is still fetched from the main server's `GET /api/hook-server/status` proxy endpoint (port 27246, not the hook server directly) — it's no longer displayed as its own section, only used to gate the Remote Approval toggle.
- **Error on write**: inline error message below the toggle, toggle reverts to previous state

#### Dependencies

- The `remoteApproval` toggle depends on the `observation` toggle — you can't have remote approval without observation hooks (the PermissionRequest event also needs the `send_event.cjs` command hook to show up in the graph). Enabling remote approval auto-enables observation. Disabling observation auto-disables remote approval.

### What Changes

| Current section                                  | Action                                                |
| ------------------------------------------------ | ----------------------------------------------------- |
| QR Code                                          | Keep                                                  |
| Hook Server Status (section)                     | **Remove** — status absorbed into Remote Approval row |
| Permission Approval (JSON snippet + copy button) | **Remove** — replaced by toggles                      |
| Session Stats                                    | Keep                                                  |
| Bypass note                                      | Keep                                                  |
| Push Notifications                               | Keep                                                  |

### Files Changed

| File                                                         | Change                                                                 |
| ------------------------------------------------------------ | ---------------------------------------------------------------------- |
| `packages/server/src/services/hookConfigService.ts`          | **New** — `readHookStatus()`, `writeHookConfig()`, `validateCwd()`     |
| `packages/server/src/routes/hookConfig.ts`                   | **New** — GET/POST `/api/hook-config`                                  |
| `packages/server/src/app.ts`                                 | Mount the new router at `/api/hook-config`                             |
| `apps/dashboard/src/components/settings/HookControlsTab.tsx` | Replace JSON snippet section with toggle UI                            |
| `packages/server/src/__tests__/hookConfig.test.ts`           | **New** — unit tests for `hookConfigService` + route integration tests |

### Security

The `cwd` parameter is user-controlled. The `validateCwd()` function enforces:

1. **Must be absolute path** — rejects relative paths
2. **No `..` segments** after `path.resolve()` — prevents path traversal
3. **Must not be the user's home directory** or `~/.claude/` — mirrors the CLI's `assertNotGlobal()` guard (global hooks cause all Claude sessions to hang)
4. **`.claude/` directory must already exist** within the target — we don't create `.claude/` in arbitrary directories, only the `settings.local.json` file within an existing `.claude/` dir

Additional safeguards:

- The server only reads/writes `.claude/settings.local.json` — never `settings.json` (which is version-controlled)
- Rate limiting on the main server already applies to these endpoints
- The route is NOT exempt from API key auth (mounted at `/api/hook-config`, not `/api/hooks/`)
<!-- revised: P1 — clarify auth is defense-in-depth -->
- **Note on auth**: `apiKeyAuth` is a no-op when `SYNAPSE_API_KEY` is not set (common for local dev). The `validateCwd()` checks are the primary defense; API key auth is defense-in-depth for deployments that set a key.

## Open Questions / Deferred

<!-- P2 findings from plan review — address incrementally -->

- **P2 — Duplicated logic between CLI and server**: The `hookConfigService` duplicates ~80 lines from the CLI's `hookSetup.ts`. Pragmatic for now, but if a third consumer appears, extract shared logic into `@synapse-ai/core`.
- **P2 — No success feedback after toggle**: Consider adding a brief flash/checkmark or subtle "Hooks updated" text when a toggle POST succeeds. Builds trust for a config-writing operation.
- **P2 — Toggle usage analytics**: Track which toggle combination users land on to inform whether remote approval should default to on in future versions.
