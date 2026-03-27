# Remote Approval + Prompt Interceptor — Design Spec

**Date:** 2026-03-11
**Status:** Revised (P0+P1+P2 incorporated, round 3)
**Feature set:** Permission Approval UI · Prompt Interceptor · Web Push Notifications

---

## Problem Statement

Claude Code's permission system is terminal-only. When Claude needs a new permission mid-session, it blocks and shows a yes/no prompt in the terminal. If the user has walked away — to another room, to bed, to a meeting — the session stalls indefinitely. The user returns hours later to find a frozen terminal, a half-completed job, and wasted time.

This spec covers three tightly related features that solve this problem end-to-end:

1. **Remote Permission Approval** — approve or deny Claude's permission prompts from the Synapse dashboard, on any device, from anywhere on the local network.
2. **Prompt Interceptor** — automatically inject live project context into prompts before Claude processes them, using the existing Prompt Lab coaching engine.
3. **Web Push Notifications** — alert the user's phone when Claude is blocked, so they can respond without being at their computer.

Together: _start a big job, walk away, receive a phone notification if Claude gets blocked, tap Approve, job continues._

---

## Key Research Findings

### 1. HTTP Hooks — The Right Integration Point

Claude Code supports **HTTP hooks** (`"type": "http"`) in addition to command hooks.

With an HTTP hook:

- Claude Code **directly POSTs** the hook event JSON to a URL
- It **blocks and waits** for the HTTP response (configurable timeout, up to 10 minutes)
- The response body is the hook's decision — no custom hook script needed

**Constraint:** The HTTP hook URL is a static string in `settings.json`, evaluated at Claude Code startup — it cannot read `.synapse-port` at request time. Permission hooks require a **fixed port**. A dedicated fixed port (`SYNAPSE_HOOK_PORT`, default `27247`) runs alongside the main server. See Decision 1.

### 2. Exact Hook Response Formats (from official Claude Code docs)

**PermissionRequest** — allow:

```json
{
  "hookSpecificOutput": {
    "hookEventName": "PermissionRequest",
    "decision": { "behavior": "allow" }
  }
}
```

**PermissionRequest** — deny:

```json
{
  "hookSpecificOutput": {
    "hookEventName": "PermissionRequest",
    "decision": {
      "behavior": "deny",
      "message": "Denied from Synapse dashboard",
      "interrupt": false
    }
  }
}
```

<!-- revised: timeout response — changed from empty {} which has undefined behavior -->

**PermissionRequest — on timeout:** respond with explicit deny rather than `{}` (undefined behavior):

```json
{
  "hookSpecificOutput": {
    "hookEventName": "PermissionRequest",
    "decision": {
      "behavior": "deny",
      "message": "Synapse approval timed out. Re-run the task or approve in terminal."
    }
  }
}
```

> ⚠️ **Open Question 1:** Empirically test whether timeout deny causes Claude to log a visible error. If a "fall through to terminal" signal exists, switch to it. This must be resolved before Phase A gate is signed off.

**UserPromptSubmit** — inject context (cannot modify prompt text):

```json
{
  "hookSpecificOutput": {
    "hookEventName": "UserPromptSubmit",
    "additionalContext": "Branch: main. Last commit: fix auth. Open: auth.ts"
  }
}
```

**UserPromptSubmit** — block:

```json
{
  "decision": "block",
  "reason": "Estimated cost exceeds $0.50 budget threshold"
}
```

**PreToolUse** — note: different schema from PermissionRequest (string, not nested object):

```json
{
  "hookSpecificOutput": {
    "hookEventName": "PreToolUse",
    "permissionDecision": "deny",
    "permissionDecisionReason": "Denied from Synapse dashboard"
  }
}
```

### 3. GitHub Issue #4362 Was User Error, Not a Bug

The reported `approve: false` being ignored was the wrong format. Correct: `hookSpecificOutput.permissionDecision = "deny"`. No workarounds needed.

### 4. No Existing Solution

Three hobby projects exist (owl-afk/Telegram, claude-on-the-go/WhatsApp, discord-hook/Discord) — messaging-bot based, no dashboard, no session context, no history. Synapse fills a genuine gap.

### 5. Transport: Deferred Response (HTTP hook native blocking)

- **Hook → server**: HTTP hook. Claude Code POSTs and waits. No custom hook script.
- **Server → dashboard**: WebSocket broadcast of `pendingPermission` event (new `WsServerMessage` variant in `@synapse-ai/core`).
- **Dashboard → server**: `PUT /api/permissions/:id/decision` (REST).
- **Server → hook**: Resolve the held Express response with the decision JSON.

### 6. Web Push

- `web-push` npm v3.6.x for server-side sending
- VAPID keys: generated once, stored in env vars
- Service worker with action buttons (Approve/Deny without opening app) — works on Android Chrome
- iOS 16.4+: requires Add to Home Screen; action buttons unreliable — fallback to open-app + hydration endpoint
- `vite-plugin-pwa` with `injectManifest` strategy

---

## Architecture

### Deployment Constraint: Single-Process

<!-- revised: made explicit per P1 finding -->

The hook server and main server **must run in the same Node.js process**. They share state via a module singleton (`permissionState.ts`). Clustering and multi-process deployments are incompatible with this design in v1.

### System Flow — Permission Approval

```
Claude Code terminal
       │
       │  HTTP POST (blocking, waits up to 30min)
       ▼
POST /api/hooks/permission          ← hook server, port 27247 (fixed, held open)
       │
       ├─ Validate: max 50 concurrent pending (429 if exceeded*)
       ├─ Store pending: permissionState.pending.set(id, { res, event, timer })
       ├─ WS broadcast: { type: "pendingPermission", ... }  → dashboard card
       └─ pushService.sendToAll(...).catch(logger.error)    → phone (fire-and-forget)
       │
       │  (response held — Claude Code paused)
       │
       │  User taps Approve/Deny on phone OR clicks card in dashboard
       ▼
PUT /api/permissions/:id/decision   ← main server, port 27246
       │
       ├─ const id = String(req.params.id)
       ├─ Look up permissionState.pending (shared module singleton)
       ├─ Not found → 404 "already resolved" (client dismisses silently)
       ├─ clearTimeout(entry.timer)
       ├─ permissionState.decisions.set(id, { behavior, expiresAt: now+30s })
       ├─ Purge expired decisions (lazy cleanup)
       ├─ WS broadcast: { type: "permissionResolved", id, behavior }
       └─ entry.res.json({ hookSpecificOutput: { ... } })
       │
       ▼
Claude Code resumes (allow) or aborts (deny) ✅

* 429 behavior from Claude Code HTTP hooks requires empirical testing (Open Question 2)
```

### System Flow — Dashboard Reconnect / Hydration

```
User opens app after tap on push notification (missed WS broadcast)
       │
       ▼
1. WebSocket connects → "connected" message
2. Client calls GET /api/permissions/pending
3. PermissionApprovalCard rendered for each pending item
4. User approves/denies from freshly-opened dashboard
```

### System Flow — Prompt Interceptor

```
User types prompt → UserPromptSubmit HTTP hook fires (5s timeout)
       │
       ▼
POST /api/hooks/prompt (hook server, port 27247, fast-path)
       │
       ├─ Check settingsService.get('promptInterceptorEnabled')
       │   └─ false → respond {} immediately
       │
       ├─ Prompt length < 10 tokens → passthrough
       ├─ Run LOCAL heuristic scorer (no DB — avoids race with parallel command hook)
       ├─ Score < threshold → inject context only
       └─ Score ≥ threshold → inject context + coaching note
       │
       ▼
{ hookSpecificOutput: { hookEventName: "UserPromptSubmit", additionalContext: "..." } }
```

> **Open Question 3:** Does Claude Code support registering both a command hook AND an HTTP hook for the same event (`UserPromptSubmit`)? If only one fires, the HTTP hook must also POST to the main server for observational recording.

### System Flow — Web Push

```
permission blocked event
       │
       ▼
pushService.sendToAll(payload)
  payload: {
    title: "⏸ Synapse — Bash permission",
    body: "rm -rf build/  ·  synapse  ·  29:00 remaining",
    requestId, url, actions: [Approve, Deny]
  }
       │
       ├─ Fan out to push_subscriptions SQLite table
       ├─ TTL: 3600s, urgency: "high"
       ├─ 410/404 → delete subscription (expired)
       └─ Other error → log, don't fail permission flow
       │
       ▼
Android: Approve/Deny buttons in notification shade
  └─ Tap action → SW POSTs PUT /api/permissions/:id/decision (CORS whitelisted)

iOS: Tap notification body → opens PWA
  └─ GET /api/permissions/pending → card shown
```

---

## Shared State Module

<!-- revised: extracted to dedicated module to make cross-server sharing explicit -->

All shared state lives in a single module imported by both servers:

```typescript
// packages/server/src/state/permissionState.ts
import { Response } from 'express';
import type { ClaudeHookEvent } from '@synapse-ai/core';

interface PendingEntry {
  res: Response;
  event: ClaudeHookEvent;
  timer: NodeJS.Timeout;
  createdAt: number;
}

interface DecisionEntry {
  behavior: 'allow' | 'deny';
  expiresAt: number;
}

export const pending = new Map<string, PendingEntry>();
export const decisions = new Map<string, DecisionEntry>();
export const MAX_PENDING = 50;

/** Default 30 min. Overridable via env var; settings UI writes back via PUT /api/settings. */
export const PERMISSION_TIMEOUT_MS = parseInt(
  process.env.SYNAPSE_PERMISSION_TIMEOUT_MS ?? '1800000',
  10,
);

export function purgeExpiredDecisions() {
  const now = Date.now();
  for (const [id, d] of decisions.entries()) {
    if (d.expiresAt < now) decisions.delete(id);
  }
}
```

> **New type in `@synapse-ai/core`:** `ClaudeHookEvent` — defines the known fields from Claude Code hook payloads:
>
> ```typescript
> // packages/core/src/types/hooks.ts
> export interface ClaudeHookEvent {
>   session_id: string;
>   tool_name?: string;
>   tool_input?: unknown;
>   hook_event_name: string;
>   [key: string]: unknown; // extensible for future fields
> }
> ```

Both `hookServer.ts` and `permissionRouter.ts` import from this module. The singleton is guaranteed by Node.js module cache within a single process.

---

## Fixed Port Architecture

```
Port 27246 (dynamic) → main server: dashboard API, WebSocket, events
Port 27247 (fixed)   → hook server: POST /api/hooks/permission, POST /api/hooks/prompt
```

If port 27247 is in use on startup:

- Log warning at `pino` WARN level
- Skip hook server registration
- Main server exposes `GET /api/hook-server/status → { running: false, port: 27247 }`
- Dashboard settings tab shows: `● Hook server unavailable — permissions use terminal fallback`

`settings.json` HTTP hooks point to `http://localhost:27247` — fixed, never changes.

---

## Components to Build

### Backend

| Component                      | Path                                              | Description                                                                                                                                                                              |
| ------------------------------ | ------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Shared state**               | `packages/server/src/state/permissionState.ts`    | `pending`, `decisions` Maps + `purgeExpiredDecisions()` + `PERMISSION_TIMEOUT_MS` constant. Single-process singleton.                                                                    |
| **Hook server**                | `packages/server/src/hookServer.ts`               | Express app on port 27247 (fixed). `server.timeout = 0`. No auth, no dynamic port.                                                                                                       |
| **Permission router**          | `packages/server/src/routes/permissions.ts`       | `POST /api/hooks/permission` (deferred), `PUT /api/permissions/:id/decision`, `GET /api/permissions/pending`, `GET /api/hook-server/status`                                              |
| **Prompt router**              | `packages/server/src/routes/prompt.ts`            | `POST /api/hooks/prompt` — toggle check + local heuristic + context injection                                                                                                            |
| **Push service (stub → real)** | `packages/server/src/services/pushService.ts`     | Phase A1: no-op stub (`sendToAll = async () => {}`). Phase B: real implementation with VAPID init, `sendToAll()` (fire-and-forget safe), subscription CRUD, 410/404 cleanup.             |
| **Push routes**                | `packages/server/src/routes/push.ts`              | `GET /api/push/vapid-key`, `POST /api/push/subscriptions`, `DELETE /api/push/subscriptions/:endpoint`                                                                                    |
| **push_subscriptions table**   | new migration                                     | `(id, endpoint, keys_p256dh, keys_auth, user_agent, created_at)` — Phase A prerequisite                                                                                                  |
| **permission_events table**    | new migration                                     | `(id, session_id, tool_name, tool_input, behavior, latency_ms, created_at)` — analytics. **`session_id` is required** (extracted from `entry.event.session_id`) for session correlation. |
| **`ClaudeHookEvent` type**     | `packages/core/src/types/hooks.ts`                | Interface for Claude Code hook payloads: `session_id`, `tool_name`, `tool_input`, `hook_event_name` + index signature. Used by `PendingEntry.event`.                                     |
| **Core type update**           | `packages/core/src/types/agent.ts`                | Add `pendingPermission` + `permissionResolved` to `WsServerMessage` union                                                                                                                |
| **Graceful shutdown**          | `packages/server/src/index.ts`                    | On SIGTERM/SIGINT: drain pending → deny all → `pending.clear()` before `server.close()`                                                                                                  |
| **Settings update**            | `packages/server/src/services/settingsService.ts` | Add `promptInterceptorEnabled` boolean (server-side source of truth, default `false`)                                                                                                    |
| **Auth exemption**             | `packages/server/src/app.ts`                      | Exempt `/api/permissions`, `/api/hooks/*`, `/api/push/*` from `apiKeyAuth` middleware                                                                                                    |

### Frontend

| Component                        | Path                                                                   | Description                                                                                                                                                                                                                                                                                                                                  |
| -------------------------------- | ---------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **`PermissionApprovalCard`**     | `apps/dashboard/src/components/permissions/PermissionApprovalCard.tsx` | Tool, truncated input (80 chars + expand), agent/session context, countdown timer, Approve/Deny, "Always allow (v2)" disabled placeholder. 404 on decision → silent dismiss. Timer expiry → amber "Timed out — Claude fell back to terminal" state.                                                                                          |
| **`permissionStore`** (Zustand)  | `apps/dashboard/src/store/permissionStore.ts`                          | `pending[]`, `resolved[]`, `approve(id)`, `deny(id)`. Hydrates via `GET /api/permissions/pending` on WS connect.                                                                                                                                                                                                                             |
| **`PushSetup`**                  | `apps/dashboard/src/components/settings/PushSetup.tsx`                 | Enable push, device list, test notification, iOS Add to Home Screen guide                                                                                                                                                                                                                                                                    |
| **`PromptInterceptorSettings`**  | `apps/dashboard/src/components/settings/PromptInterceptorSettings.tsx` | Toggle (writes to `PUT /api/settings` — server-side), threshold slider, context injection checkboxes, "Last injection: X ago" status line                                                                                                                                                                                                    |
| **`PromptInterceptorLog`**       | `apps/dashboard/src/components/toollog/PromptInterceptorLog.tsx`       | Shows what was injected per prompt — surfaces in ToolLogPanel (not settings). Settings shows summary line only.                                                                                                                                                                                                                              |
| **Hook Controls tab**            | new settings tab                                                       | Replaces separate settings sections — permission approval status, interceptor, push                                                                                                                                                                                                                                                          |
| **Hook server status indicator** | in Hook Controls tab                                                   | `GET /api/hook-server/status` poll on tab open → green/red badge                                                                                                                                                                                                                                                                             |
| **`QRCodePanel`**                | `apps/dashboard/src/components/settings/QRCodePanel.tsx`               | Displays local network URL as scannable QR code. Uses `GET /api/network/local-url` (see Decision 12 for LAN IP heuristic). Fetches on every render (not once on mount) + "Refresh QR" button — handles port changes on server restart. Rendered via `qrcode` npm package (canvas or SVG). "Open on your phone" section in Hook Controls tab. |
| **Service worker**               | `apps/dashboard/public/sw.js`                                          | Push handler with enriched payload, `notificationclick` (action buttons + open-app fallback), `pushsubscriptionchange`                                                                                                                                                                                                                       |
| **PWA manifest**                 | `apps/dashboard/public/manifest.json`                                  | `display: standalone`, icons — required for iOS push                                                                                                                                                                                                                                                                                         |
| **`usePush.ts`**                 | `apps/dashboard/src/hooks/usePush.ts`                                  | VAPID subscription, double-prompt pattern (custom dialog before browser prompt), register/unregister                                                                                                                                                                                                                                         |

### Config

| Item                                                     | Description                                                                                                                        |
| -------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `.claude/settings.json`                                  | Add `"type": "http"` hooks for `PermissionRequest` + `UserPromptSubmit` → port 27247. Keep command hooks for observational events. |
| `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` | Env vars, generated once via `npx web-push generate-vapid-keys`                                                                    |
| `SYNAPSE_HOOK_PORT`                                      | Default `27247`. Fixed port for hook server.                                                                                       |

---

## Detailed Design Decisions

### Decision 1: Two-Server Architecture

HTTP hooks require static URL. Main server uses dynamic port. Hook server on fixed port `27247`, same process, shared state via `permissionState.ts` module singleton.

If `27247` in use: warn, skip, degrade gracefully (terminal fallback still works).

### Decision 2: Deferred Response — Corrected

<!-- revised: fixed variable scoping bugs and push error handling from P0 review -->

```typescript
// POST /api/hooks/permission (hook server, port 27247)
import { pending, decisions, MAX_PENDING, PERMISSION_TIMEOUT_MS } from '../state/permissionState';
import type { ClaudeHookEvent } from '@synapse-ai/core';

app.post('/api/hooks/permission', async (req, res) => {
  if (pending.size >= MAX_PENDING) {
    // Note: Claude Code 429 behavior requires empirical testing (Open Question 2)
    return res.status(429).json({ error: 'Too many pending permissions' });
  }

  const id = crypto.randomUUID();
  const createdAt = Date.now();

  const timer = setTimeout(() => {
    pending.delete(id);
    res.json({
      hookSpecificOutput: {
        hookEventName: 'PermissionRequest',
        decision: { behavior: 'deny', message: 'Synapse approval timed out.' },
      },
    });
  }, PERMISSION_TIMEOUT_MS);

  pending.set(id, { res, event: req.body, timer, createdAt });

  broadcaster.broadcast({ type: 'pendingPermission', id, event: req.body });

  // Fire-and-forget — push errors must never fail the permission response
  pushService
    .sendToAll({
      title: `⏸ Synapse — ${req.body.tool_name ?? 'Permission'} request`,
      body: `${String(req.body.tool_input ?? '').slice(0, 60)}  ·  ${Math.round(PERMISSION_TIMEOUT_MS / 60000)}:00 remaining`,
      requestId: id,
      url: '/',
    })
    .catch((err) => logger.error({ err }, 'Push send failed'));

  // res intentionally NOT called here — held until decision arrives
});
```

```typescript
// PUT /api/permissions/:id/decision (main server, port 27246)
import { pending, decisions, purgeExpiredDecisions } from '../state/permissionState';
import { analyticsExecute } from '../db.js'; // db.ts exports helpers, not the raw db object

app.put('/api/permissions/:id/decision', (req, res) => {
  const id = String(req.params.id); // explicit variable — avoids scope bug
  purgeExpiredDecisions(); // lazy cleanup of expired cache entries

  const entry = pending.get(id);
  if (!entry) {
    // Already resolved — client should dismiss card silently (not an error)
    return res.status(404).json({ error: 'already resolved or not found' });
  }

  const behavior = req.body.behavior as 'allow' | 'deny';
  const latencyMs = Date.now() - entry.createdAt;

  clearTimeout(entry.timer);
  pending.delete(id);
  decisions.set(id, { behavior, expiresAt: Date.now() + 30_000 });

  // Store analytics event (session_id included for session correlation)
  analyticsExecute(
    'INSERT INTO permission_events (id, session_id, tool_name, tool_input, behavior, latency_ms, created_at) VALUES (?,?,?,?,?,?,?)',
    [
      id,
      entry.event.session_id,
      entry.event.tool_name ?? '',
      String(entry.event.tool_input ?? '').slice(0, 500),
      behavior,
      latencyMs,
      Date.now(),
    ],
  );

  broadcaster.broadcast({ type: 'permissionResolved', id, behavior });

  entry.res.json({
    hookSpecificOutput: {
      hookEventName: 'PermissionRequest',
      decision: { behavior },
    },
  });

  res.json({ ok: true });
});
```

### Decision 3: Auth Exemptions + CORS

Hook server (27247): no auth middleware — Claude Code cannot send Bearer tokens. Localhost-only trust.

Main server exemptions in `app.ts`:

```typescript
app.use('/api', (req, res, next) => {
  const exempt = ['/api/hooks/', '/api/permissions', '/api/push/'];
  if (exempt.some((p) => req.path.startsWith(p))) return next();
  return apiKeyAuth(req, res, next);
});
```

CORS: the service worker origin (PWA installed origin) must be whitelisted for `PUT /api/permissions/:id/decision`. Add PWA origin to the existing `allowedOrigins` array. For the hook server, no CORS needed (only Claude Code calls it).

### Decision 4: Prompt Interceptor — Server-Side Toggle

`settingsService.get('promptInterceptorEnabled')` is the source of truth. Default: `false`. The UI writes to `PUT /api/settings`. The HTTP hook checks this per request — if disabled, responds immediately with `{}` (< 1ms overhead).

### Decision 5: Prompt Interceptor — Local Scoring

Does NOT read from DB (race with parallel command hook). Runs a local word-count/vagueness heuristic. Threshold configurable, default 70. Injected context: `git log --oneline -3`, current branch, CLAUDE.md first paragraph.

### Decision 6: Graceful Shutdown

```typescript
process.on('SIGTERM', async () => {
  // Drain pending permissions before closing
  for (const [, entry] of pending.entries()) {
    clearTimeout(entry.timer);
    entry.res.json({
      hookSpecificOutput: {
        hookEventName: 'PermissionRequest',
        decision: { behavior: 'deny', message: 'Synapse server is shutting down.' },
      },
    });
  }
  pending.clear();
  // server.close() is callback-based — wrap in Promise to actually wait for drain
  await new Promise<void>((resolve) => hookServer.close(() => resolve()));
  await new Promise<void>((resolve) => mainServer.close(() => resolve()));
  process.exit(0);
});
```

### Decision 7: Push Subscriptions in SQLite (Phase B Blocker)

`push_subscriptions` table created in Phase A migration (schema only). Used in Phase B. In-memory storage is explicitly forbidden — server restarts lose subscriptions.

### Decision 8: Max Concurrent Pending + Rate Limiting

50 concurrent max (`MAX_PENDING`). Additionally, add `express-rate-limit` on the hook server: 60 requests/min. Both prevent resource exhaustion from runaway sessions.

### Decision 9: iOS Support

iOS requires Add to Home Screen for Web Push. Settings tab shows step-by-step instructions. No action buttons on iOS — fallback to open-app + `GET /api/permissions/pending` hydration.

### Decision 10: Feature Defaults

<!-- revised: changed from ON to OFF per P1 product finding; "Configure automatically" → "Copy config snippet" per round 3 -->

- **Permission Approval**: OFF by default. Settings tab shows setup instructions for `.claude/settings.json` HTTP hooks + a **"Copy config snippet"** button that copies the JSON to the clipboard, plus a link to setup docs. Auto-write via HookManager is deferred to v2 (requires file-merging logic, restart handling, and `.claude/settings.json` vs global distinction).
- **Prompt Interceptor**: OFF by default.
- **Push notifications**: OFF until user explicitly enables (browser permission prompt requires user gesture anyway).

> **Important note for settings UI:** Tools in the user's `permissions.allow` list (in `.claude/settings.json`) are pre-approved by Claude Code and **bypass the PermissionRequest hook entirely** — they run silently without triggering a card. The settings tab should display: _"Tools in your permissions.allow list bypass this routing — they run without a prompt."_ The setup instructions should also note: _"Only tools not yet in your allow list will appear as permission cards."_

### Decision 11: Analytics

`permission_events` table enables: approval latency, denial rate by tool, session completion correlation. Data written on every `PUT /api/permissions/:id/decision`. Feeds existing analytics endpoints. The `session_id` column (included in the migration) enables correlation to session cost and completion metrics.

### Decision 12: LAN IP Selection Heuristic

<!-- added: round 3, per P1 finding about os.networkInterfaces() returning many interfaces -->

`GET /api/network/local-url` uses `os.networkInterfaces()` which returns all interfaces (loopback, Docker bridges, VPN tunnels, link-local, WiFi). Selection rule:

1. Filter to IPv4 only (`family === 'IPv4'` or `family === 4`)
2. Exclude loopback (`127.x.x.x`)
3. Exclude Docker bridges (`172.17.x.x` – `172.31.x.x`)
4. Exclude Tailscale (`100.x.x.x`)
5. Exclude link-local (`169.254.x.x`)
6. Prefer `192.168.x.x` or `10.x.x.x` (typical home/office LAN)
7. Return the first match
8. If no match: return `localhost` and include `{ warning: 'No LAN interface detected' }` in the response — QRCodePanel shows an amber warning: "Could not detect LAN IP — QR code uses localhost"

### Decision 13: Pending Permissions Response Shape

<!-- added: round 3, per P2 finding about unbounded response payload -->

`GET /api/permissions/pending` returns a **summary shape**, not raw hook events:

```typescript
interface PendingSummary {
  id: string;
  tool_name: string;
  tool_input_preview: string; // truncated to 200 chars
  createdAt: number;
  expiresAt: number;
}
```

The full `tool_input` is available via `GET /api/permissions/:id` if the card needs to expand it (the `[+]` expand button). This prevents multi-KB payloads in the list endpoint.

### Decision 14: PromptInterceptorLog Location

<!-- added: round 3, per P2 UX finding -->

The `PromptInterceptorLog` component surfaces in the **ToolLogPanel** (or as an annotation on the `UserPromptSubmit` node in the graph), not buried in the settings tab. When a prompt is enhanced, the user is looking at the session/graph — not settings. The settings tab shows only a summary line: _"Last injection: 2 min ago → view in Tool Log"_.

---

## Settings Panel — "Hook Controls" Tab

<!-- revised: added hook server status indicator, setup instructions for first-time users -->

```
┌─────────────────────────────────────────────────────┐
│  Hook Controls                                       │
│                                                      │
│  ── Open on your phone ────────────────────────── │
│  ┌──────────┐  Scan to open Synapse on any device   │
│  │ ▓▓░░▓▓░░ │  on your home network.                │
│  │ ░░▓▓░░▓▓ │                                        │
│  │ ▓░▓░▓░▓░ │  http://192.168.1.214:27246            │
│  └──────────┘  [Copy link]                          │
│                                                      │
│  ── Hook Server Status ─────────────────────────── │
│  ● Running on port 27247              [● green]     │
│  (or: ● Unavailable — using terminal fallback)      │
│                                                      │
│  ── Permission Approval ──────────────────────────  │
│  Route permission prompts to this dashboard          │
│  ● Enabled                             [OFF ○]      │
│  Timeout before fallback                [30 min]    │
│                                                      │
│  Add to .claude/settings.json:                      │
│  ┌──────────────────────────────────────────────┐   │
│  │ "PermissionRequest": [{ "hooks": [{          │   │
│  │   "type": "http",                            │   │
│  │   "url": "http://localhost:27247/..."        │   │
│  │ }]}]                                         │   │
│  └──────────────────────────────────────────────┘   │
│  [📋 Copy config snippet]   Setup docs ↗            │
│                                                      │
│  ℹ Tools in your permissions.allow list bypass       │
│    this routing — they run without a prompt.          │
│                                                      │
│  ── Prompt Interceptor ───────────────────────────  │
│  Inject project context into prompts                 │
│  ● Enabled                             [OFF ○]      │
│  Enhancement threshold (vagueness ≥)       [70]     │
│  ☑ Git branch + recent commits                      │
│  ☑ Open files (via VS Code extension)               │
│  ☐ Recent tool errors                               │
│  Cost warning if estimated >              [$0.50]   │
│  Last injection: added 3 lines 2 min ago → Tool Log │
│                                                      │
│  ── Push Notifications ───────────────────────────  │
│  Get notified on your phone when Claude blocks      │
│  [Enable Push Notifications]                        │
│  Devices: iPhone (3 days ago) · [Remove]            │
│  [Send test notification]                           │
│  iOS: Add Synapse to Home Screen first ↗            │
└─────────────────────────────────────────────────────┘
```

---

## Mobile UX — Permission Approval Card

<!-- revised: added expiry state, input expansion, disabled v2 placeholder -->

```
┌─────────────────────────────────────────────────────┐
│  🔐 Permission Request                      [29:45] │
│─────────────────────────────────────────────────────│
│  Tool:    Bash                                       │
│  Input:   rm -rf build/dist && npm run build  [+]  │
│           (tap [+] to expand full command)          │
│  Agent:   subagent-3 (refactor auth module)         │
│  Session: main · 12 tools run · $0.23               │
│                                                      │
│  [  Deny  ]      [Always allow ✗]   [  Approve  ]  │
│                  (coming in v2)                      │
└─────────────────────────────────────────────────────┘

On timeout expiry (timer hits 0:00):
┌─────────────────────────────────────────────────────┐
│  🔐 Permission Request                      [0:00]  │
│─────────────────────────────────────────────────────│
│  ⏱ Timed out — Claude denied and fell back          │
│  to terminal. You can retry the task.               │
│                                    [Dismiss]        │
└─────────────────────────────────────────────────────┘
```

- Countdown: `permissionResolved` WS event drives state (approved → green, denied → red, timeout → amber)
- Multiple pending: stacked cards, numbered in order of arrival, individually actionable
- 404 on decision PUT: silent dismiss (race — already resolved)
- Input field: 80 chars max, `[+]` expands to scrollable monospace block

---

## Implementation Phases

### Phase A1 — Backend (no frontend dependency)

0. Create no-op stub `packages/server/src/services/pushService.ts` with `export const sendToAll = async () => {}` — Phase B replaces with real implementation. Without this stub, Phase A1 code that imports `pushService.sendToAll()` will fail to compile.
1. Create `ClaudeHookEvent` interface in `packages/core/src/types/hooks.ts` (`session_id`, `tool_name`, `tool_input`, `hook_event_name`, index signature for extensibility)
2. Create `packages/server/src/state/permissionState.ts` (shared Maps, typed `PendingEntry.event` as `ClaudeHookEvent`, `PERMISSION_TIMEOUT_MS` constant)
3. Create migrations: `push_subscriptions` + `permission_events` tables — **`permission_events` must include `session_id`** for session correlation analytics
4. Add `pendingPermission` + `permissionResolved` to `WsServerMessage` in `@synapse-ai/core`
5. Create `hookServer.ts` (port 27247, `server.timeout = 0`, rate limiter)
6. Build `POST /api/hooks/permission` (deferred response, push fire-and-forget, graceful shutdown drain)
7. Build `PUT /api/permissions/:id/decision` — correct `id` scoping, lazy purge, analytics write via `analyticsExecute()` from `db.ts` (not raw `db` — it is module-private)
8. Build `GET /api/permissions/pending` (returns summary shape, not raw events — see Decision 13) + `GET /api/hook-server/status`
9. Add auth exemptions in `app.ts`
10. Add HTTP hooks to `.claude/settings.json`
11. **Gate A1:** `curl POST http://localhost:27247/api/hooks/permission` → holds → `curl PUT http://localhost:27246/api/permissions/:id/decision` → resolves. No frontend needed.

### Phase A2 — Frontend

1. Build `permissionStore` (Zustand) with WS listener + hydration on connect
2. Build `PermissionApprovalCard` (timer, expand input, expiry state, 404 dismiss)
3. Add Hook Controls settings tab (status indicator, setup instructions, "Copy config snippet" button — see Decision 10 revised)
4. Build `GET /api/network/local-url` endpoint — LAN IP heuristic (see Decision 12)
5. Build `QRCodePanel` — fetches URL on every render (not once on mount), includes "Refresh QR" button, live-updating URL display below QR code
6. Create `public/manifest.json` (`display: standalone`, icons, `name: "Synapse"`) — moved up from Phase B so QR→iOS "Add to Home Screen" gives a named app with icon immediately
7. **Gate A2:** Full end-to-end — Claude blocked → card in dashboard → Approve → Claude continues. **Note:** gate requires phone browser to already be open (push notifications are Phase B).
8. Empirically verify: timeout deny behavior (Open Question 1), 429 fallback behavior (Open Question 2)

### Phase B — Web Push

Prerequisites: Phase A complete, `push_subscriptions` table from Phase A1

1. Generate VAPID keys, add to `.env`, `pnpm add web-push` to server
2. Replace `pushService.ts` stub (from Phase A1 step 0) with real implementation (fire-and-forget safe `sendToAll`, 410/404 cleanup)
3. Build push subscription routes + DB persistence
4. Create `public/sw.js` (enriched push payload, action buttons, `pushsubscriptionchange`)
5. ~~Create `public/manifest.json`~~ — already created in Phase A2 step 6. Add service worker registration to existing manifest if needed.
6. Link manifest in `index.html` (if not already linked in Phase A2)
7. Build `usePush.ts` (double-prompt pattern) + `PushSetup` settings section
8. Whitelist PWA origin in CORS for `PUT /api/permissions/:id/decision`
9. Wire Phase A permission event → `pushService.sendToAll()` (already fire-and-forget in Phase A1 code, now backed by real implementation)
10. **Gate B:** Android push received (app closed) → Approve button → Claude continues.
11. **Gate B (iOS):** Tap notification → open PWA → card visible → Approve.

### Phase C — Prompt Interceptor

Prerequisites: Phase A (hookServer running)

1. Add `UserPromptSubmit` HTTP hook to `.claude/settings.json`
2. Verify: can command hook + HTTP hook coexist for same event? (Open Question 3)
3. Build `POST /api/hooks/prompt` (toggle check + local heuristic + context injection)
4. Build `PromptInterceptorSettings` (toggle → `PUT /api/settings`, threshold, context checkboxes, last-injection status)
5. Build `PromptInterceptorLog` — surfaces in ToolLogPanel (or as annotation on UserPromptSubmit graph node), **not** buried in settings. Settings tab shows summary line only: "Last injection: 2 min ago → view in Tool Log"
6. **Gate C:** Submit vague prompt → Claude receives enriched context → log shows injection.

---

## Out of Scope (v1)

- Internet-accessible approval (ngrok/Tailscale) — user's own setup
- Authentication on hook endpoints
- Pattern-based auto-approval rules ("always allow Bash(git \*)") — v2
- Prompt text replacement (Claude Code API limitation)
- `PreToolUse` per-call approval — high volume, fatigue risk, v2
- Declarative Web Push (Apple iOS 18.4+)
- Clustering / multi-process deployment
- Auto-write hooks via HookManager (v2 — requires file-merging logic)

---

## Open Questions (Must Resolve During Implementation)

1. **Timeout deny behavior:** Does explicit `behavior: "deny"` on timeout cause Claude to log a visible error or interrupt the session? Is there a documented "fall through to terminal" signal? **Resolve in Phase A2 gate.**

2. **Claude Code behavior on 429 from HTTP hook:** Does it treat it as non-blocking (fall through to terminal) or a hard error? **Resolve in Phase A1 gate.**

3. **Multiple hooks same event type:** Can a command hook and an HTTP hook both be registered for `UserPromptSubmit`? If only one fires, the HTTP hook must replicate the observational POST. **Resolve before Phase C step 2.**

4. **Hook server port conflict UX:** When port 27247 is in use — warn + degrade (current design) or prompt user to free the port? **Design: warn + degrade. Validate UX in Phase A2.**

---

## Deferred / P2 Notes

- _Push notification text specificity:_ Payload includes `toolName` + first 60 chars of input — implemented in Phase A1 `sendToAll` stub. Exact truncation/formatting to be refined in Phase B.
- _"Remember this decision" placeholder:_ Disabled button in card mockup, labelled "coming in v2".
- _Prompt Interceptor before/after visibility:_ `PromptInterceptorLog` shows what was injected per prompt + "Last injection: X ago" in settings tab.
- _Success metrics:_ `permission_events` table (latency, denial rate) feeds analytics. Approval rate dashboard view deferred to post-launch.
- _Configurable timeout default:_ 30 minutes chosen. If user feedback indicates desk-use fatigue, consider 10 min default with "extend" button on card.

---

## Gates Summary

| Phase | Gate Condition                                                                                                                                                            |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A1    | `curl` end-to-end: POST holds → PUT resolves → correct JSON returned                                                                                                      |
| A2    | Full browser flow: Claude blocked → dashboard card → Approve → Claude continues. **Requires phone browser already open** — push (Phase B) needed for closed-app use case. |
| B     | Android push: native notification (app closed) → Approve button → Claude continues                                                                                        |
| C     | Vague prompt → enriched context in Claude → injection visible in log                                                                                                      |
