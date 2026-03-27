# Remote Approval — Phase B: Web Push Notifications Design

**Date:** 2026-03-11
**Status:** Reviewed (P0+P1+P2 incorporated, 4 review passes — latest 2026-03-12)
**Parent spec:** [Remote Approval & Prompt Interceptor Design](2026-03-11-remote-approval-and-prompt-interceptor-design.md)
**Prerequisites:** Phase A1 (backend) and A2 (frontend) complete and committed

---

## Goal

Replace the no-op `pushService.ts` stub with a real Web Push implementation so that when Claude Code blocks on a permission request, the user's phone receives a push notification — even if the browser/PWA is closed. On Android, the user can approve/deny directly from the notification shade. On iOS, tapping the notification opens the PWA where the approval card is waiting.

**Gate B (Android):** Native push notification received (app closed) → tap Approve action button → confirmation notification shown → Claude continues.
**Gate B (iOS):** Tap notification → PWA opens → card visible → Approve → Claude continues.

---

<!-- revised: P0 — HTTPS/secure context blocker for LAN IP access -->

## Prerequisite: HTTPS on LAN (Secure Context)

**Web Push requires a secure context.** `navigator.serviceWorker.register()` and `pushManager.subscribe()` both throw on insecure origins. `localhost` is exempt, but `http://192.168.x.x` is **not**.

Since the primary use case is accessing the dashboard from a phone on LAN IP, HTTPS is a hard prerequisite for push to work.

### Recommended approach: mkcert (local CA)

[mkcert](https://github.com/nicedmitry/mkcert) generates locally-trusted certificates with zero configuration:

```powershell
# One-time setup on the dev machine
choco install mkcert          # or: scoop install mkcert
mkcert -install               # installs local CA into system trust store

# Generate cert for LAN IP (adjust IP to match your network)
cd packages/server
mkcert 192.168.1.214 localhost 127.0.0.1 ::1
# Creates: 192.168.1.214+3.pem and 192.168.1.214+3-key.pem
```

**Server HTTPS support:** Add optional TLS to `index.ts`. When cert files are present (via env vars or convention), use `https.createServer()` instead of `http.createServer()`:

```env
# packages/server/.env
SYNAPSE_TLS_CERT=./192.168.1.214+3.pem
SYNAPSE_TLS_KEY=./192.168.1.214+3-key.pem
```

```typescript
// index.ts — HTTPS creation (simplified)
import { createServer as createHttpsServer } from 'https';
import { createServer as createHttpServer } from 'http';

const tlsCert = process.env.SYNAPSE_TLS_CERT;
const tlsKey = process.env.SYNAPSE_TLS_KEY;

const server =
  tlsCert && tlsKey
    ? createHttpsServer({ cert: fs.readFileSync(tlsCert), key: fs.readFileSync(tlsKey) }, app)
    : createHttpServer(app);

if (tlsCert && tlsKey) {
  logger.info('HTTPS enabled — push notifications available on LAN');
} else {
  logger.info('HTTP mode — push notifications only work on localhost');
}
```

**iOS requirement:** Install the mkcert root CA on the phone:

1. Email or AirDrop the CA cert (`mkcert -CAROOT` shows the path → `rootCA.pem`)
2. iPhone: Settings → General → VPN & Device Management → install profile
3. Settings → General → About → Certificate Trust Settings → enable full trust

**Fallback (no HTTPS):** Push is disabled. The dashboard still works over HTTP — WS-based approval cards remain the primary channel. `PushSetup.tsx` shows "HTTPS required for push notifications on LAN" when not in a secure context.

### Why not other approaches?

| Approach                                                 | Problem                                          |
| -------------------------------------------------------- | ------------------------------------------------ |
| Chrome `--unsafely-treat-insecure-origin-as-secure` flag | Per-device, not available on iOS, fragile        |
| Tunneling (ngrok/cloudflared)                            | External dependency, latency, free tier limits   |
| Public push relay proxy                                  | Adds cloud infrastructure for a local-first tool |

---

## Design Decisions

### 1. VAPID Key Management — Manual-Only

Developer runs `npx web-push generate-vapid-keys` and pastes the output into `.env`:

```env
VAPID_PUBLIC_KEY=BNx...
VAPID_PRIVATE_KEY=abc...
VAPID_SUBJECT=mailto:dev@localhost
```

If keys are not set, `pushService.ts` initializes in disabled mode — `sendToAll()` returns immediately (same as current stub behavior). Server logs a `pino` info message: `"Push notifications disabled — VAPID keys not configured"`.

**Why manual:** VAPID keys are cryptographic identity material. Auto-generating and writing to disk is surprising. Push is opt-in anyway — the user must explicitly enable it in settings. One shell command is trivial setup cost.

**Setup documentation:** `packages/server/.env.example` already exists with all three VAPID vars commented out, so developers discover the setup path without reading this spec.

### 2. Service Worker — Plain Static File

Hand-written `public/sw.js`, plain JavaScript, no build step, no `vite-plugin-pwa`. Registered manually via `navigator.serviceWorker.register('/sw.js')` in `usePush.ts`.

**Why plain:** The SW does exactly three things: handle `push` events, handle `notificationclick`, and handle `pushsubscriptionchange`. That's ~100 lines. Adding `vite-plugin-pwa` + Workbox for this is unnecessary complexity.

### 3. Push Permission UX — Inline in Settings

The "Enable Push Notifications" button in Hook Controls > Push Notifications section IS the first prompt (double-prompt pattern). Clicking it calls `Notification.requestPermission()` directly. No separate modal or confirmation dialog.

- **Granted:** Immediately subscribes via `pushManager.subscribe()`, POSTs to server, shows "Enabled" state with device info.
- **Denied:** Shows "Blocked — reset in browser settings" with instructions.
- **Default (dismissed):** Button remains available to try again.

**Why inline:** The settings tab is where users expect to configure notifications. A separate modal adds UI surface for a one-time action. The button click satisfies the browser's user-gesture requirement.

<!-- revised: P1-U1 — enable() must surface errors to UI -->

**Error surfacing:** `usePush.enable()` must expose errors to the UI, not silently swallow them. Key failure modes:

- VAPID keys not configured on server → check `/api/push/vapid-key` response `enabled: false` → show "Push not configured on server — see .env.example"
- Not in secure context → `pushManager.subscribe()` throws `DOMException` → show "HTTPS required for push notifications on LAN"
- General failure → show "Push setup failed — check console"

The hook returns an `error` state (`string | null`) alongside the existing `PushState`.

<!-- revised: P1-U2 — iOS standalone gate -->

**iOS standalone gate:** On iOS, if the page is NOT running in standalone mode (`window.matchMedia('(display-mode: standalone)').matches === false`), replace the "Enable" button with Add to Home Screen instructions. Only show the "Enable" button when in standalone mode. This prevents users from hitting a silent failure after granting permission in Safari.

### 4. CORS — Default to Wildcard via Existing Mechanism

The default `corsOrigins` in `app.ts` is already `'*'`. The existing CORS middleware handles `*` as a special case (lines 58-60 of `app.ts`) — no change needed.

**Why:** The server is never internet-exposed (localhost/LAN only). The existing mechanism already supports `*`. Predicting the PWA's installed origin (e.g., `https://192.168.1.214:27246`) adds fragile complexity for zero security benefit.

### 5. Service Worker Actions — Hybrid (SW Fetch + Open Fallback)

**Android Chrome:** Notification includes `actions: [{action: 'approve', title: 'Approve'}, {action: 'deny', title: 'Deny'}]`. Tapping an action button triggers `fetch('PUT /api/permissions/:id/decision')` directly from the SW — no app open required.

<!-- revised: P1-E2 — show confirmation notification after successful approve/deny -->

**Confirmation feedback:** After a successful action fetch, the SW shows a brief replacement notification: `"Approved — Claude is continuing"` (or `"Denied"`), tagged with the same `permission-${requestId}` so it replaces the original. Auto-closes after 4 seconds via `setTimeout` + `notification.close()`. On fetch failure, the SW opens the PWA as fallback (existing behavior).

**iOS / fallback:** Action buttons are unreliable on iOS. Tapping the notification body triggers `clients.openWindow(url)` which opens the PWA. The PWA hydrates pending cards via `GET /api/permissions/pending`.

---

## Architecture

### Push Flow

```
Permission blocked (hookServer.ts)
       │
       ├─ WS broadcast: pendingPermission (existing)
       └─ pushService.sendToAll(payload)     ← Phase B replaces stub
              │
              ├─ Read all subscriptions from push_subscriptions table
              ├─ For each: webpush.sendNotification(sub, JSON.stringify(payload))
              │     ├─ 410 Gone / 404 → DELETE subscription from DB (expired)
              │     ├─ Other error → logger.warn (don't fail)
              │     └─ Success → continue
              └─ Returns void (fire-and-forget, errors caught internally)
              │
              ▼
Android notification shade:
  [⏸ Synapse — Bash permission]
  [rm -rf build/  ·  29:00 remaining]
  [Approve]  [Deny]
       │
       ├─ Action tap → SW fetch: PUT /api/permissions/:id/decision
       │     └─ Success → replacement notification: "✓ Approved — Claude is continuing"
       └─ Body tap → clients.openWindow('/') → PWA hydration
```

### Component Map

#### Server (`packages/server/`)

| Component              | Path                          | Description                                                                                                                                         |
| ---------------------- | ----------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| **pushService (real)** | `src/services/pushService.ts` | Replace stub. Init with VAPID keys from env. `sendToAll(payload)` fans out to all subscriptions. Auto-cleanup on 410/404. Disabled mode if no keys. |
| **Push routes**        | `src/routes/push.ts`          | `GET /api/push/vapid-key`, `POST /api/push/subscriptions`, `DELETE /api/push/subscriptions` (endpoint in body)                                      |
| **HTTPS support**      | `src/index.ts`                | Optional TLS via `SYNAPSE_TLS_CERT` + `SYNAPSE_TLS_KEY` env vars                                                                                    |
| **PWA icons**          | `public/icons/`               | `icon-192.png`, `icon-512.png`, `badge-72.png` — required for notification icons and iOS Add to Home Screen                                         |

#### Frontend (`apps/dashboard/`)

| Component          | Path                                    | Description                                                                                               |
| ------------------ | --------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| **Service worker** | `public/sw.js`                          | Push handler, notification click (action buttons + confirmation + open fallback), pushsubscriptionchange  |
| **usePush hook**   | `src/hooks/usePush.ts`                  | SW registration, VAPID subscription, server sync, enable/disable lifecycle, error surfacing               |
| **PushSetup**      | `src/components/settings/PushSetup.tsx` | Enable button (with iOS standalone gate), device list, test notification, error display, iOS instructions |

---

## Detailed Component Design

### index.ts — HTTPS Support

<!-- revised: P0 — add optional TLS to server startup -->

```typescript
// In index.ts, replace createServer with conditional HTTPS:
import { createServer as createHttpsServer } from 'https';
import { createServer as createHttpServer } from 'http';

const tlsCert = process.env.SYNAPSE_TLS_CERT;
const tlsKey = process.env.SYNAPSE_TLS_KEY;

let server: import('http').Server;
if (tlsCert && tlsKey && fs.existsSync(tlsCert) && fs.existsSync(tlsKey)) {
  server = createHttpsServer({ cert: fs.readFileSync(tlsCert), key: fs.readFileSync(tlsKey) }, app);
  logger.info('HTTPS enabled — push notifications available on LAN');
} else {
  server = createHttpServer(app);
  if (tlsCert || tlsKey) {
    logger.warn('TLS cert/key specified but files not found — falling back to HTTP');
  }
}
```

Also update the `baseUrl` construction in `hookServer.ts` to use `https://` when TLS is active:

```typescript
const protocol = process.env.SYNAPSE_TLS_CERT ? 'https' : 'http';
const baseUrl = `${protocol}://${lanIp}:${mainPort}`;
```

### pushService.ts — Real Implementation

```typescript
// packages/server/src/services/pushService.ts
import webpush from 'web-push';
import { analyticsQueryAll, analyticsExecute } from '../db.js';
import { logger } from '../lib/logger.js';

export interface PushPayload {
  title: string;
  body: string;
  requestId: string;
  /** Full absolute URL to the decision endpoint */
  decisionUrl: string;
  /** Full absolute URL to open the PWA */
  url: string;
}

interface PushSubscriptionRow {
  id: string;
  endpoint: string;
  keys_p256dh: string;
  keys_auth: string;
}

let enabled = false;

export function initPush(): void {
  const publicKey = process.env.VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  const subject = process.env.VAPID_SUBJECT ?? 'mailto:dev@localhost';

  if (!publicKey || !privateKey) {
    logger.info('Push notifications disabled — VAPID keys not configured');
    enabled = false; // explicit reset — safe for hot-reload / re-init
    return;
  }

  webpush.setVapidDetails(subject, publicKey, privateKey);
  enabled = true;
  logger.info('Push notifications enabled');
}

export function isEnabled(): boolean {
  return enabled;
}

export function getVapidPublicKey(): string | undefined {
  return process.env.VAPID_PUBLIC_KEY;
}

export async function sendToAll(payload: PushPayload): Promise<void> {
  if (!enabled) return;

  const subs = analyticsQueryAll(
    'SELECT id, endpoint, keys_p256dh, keys_auth FROM push_subscriptions',
  ) as unknown as PushSubscriptionRow[];

  if (subs.length === 0) return;

  const body = JSON.stringify({
    title: payload.title,
    body: payload.body,
    data: {
      requestId: payload.requestId,
      decisionUrl: payload.decisionUrl,
      url: payload.url,
      actions: ['approve', 'deny'],
    },
  });

  const options: webpush.RequestOptions = {
    TTL: 3600,
    urgency: 'high' as const,
  };

  await Promise.allSettled(
    subs.map(async (sub) => {
      try {
        await webpush.sendNotification(
          {
            endpoint: sub.endpoint,
            keys: { p256dh: sub.keys_p256dh, auth: sub.keys_auth },
          },
          body,
          options,
        );
      } catch (err: unknown) {
        const statusCode = (err as { statusCode?: number }).statusCode;
        if (statusCode === 410 || statusCode === 404) {
          // Subscription expired — remove from DB
          analyticsExecute('DELETE FROM push_subscriptions WHERE id = ?', [sub.id]);
          logger.info({ endpoint: sub.endpoint }, 'Removed expired push subscription');
        } else {
          logger.warn({ err, endpoint: sub.endpoint }, 'Push send failed');
        }
      }
    }),
  );
}
```

**Key behaviors:**

- `initPush()` called once at server startup (in `index.ts`), before any push can fire
- `sendToAll()` returns immediately if disabled — same as current stub
- `Promise.allSettled()` ensures one failed subscription doesn't block others
- 410/404 cleanup is inline — no separate cleanup job needed
- All errors caught internally — caller never sees a rejection

### Push Routes — `routes/push.ts`

```typescript
// GET /api/push/vapid-key
// Returns: { publicKey: string, enabled: boolean }
// Client needs the public key to call pushManager.subscribe()

// POST /api/push/subscriptions
// Body: { endpoint, keys: { p256dh, auth }, userAgent? }
// Upserts by endpoint (UNIQUE constraint). Returns 201.
// Zod-validated at boundary.

// DELETE /api/push/subscriptions
// Body: { endpoint: string }
// Deletes subscription by endpoint. Returns 204.
// Uses body (not URL param) because push endpoints are full URLs
// containing slashes that break Express path segment decoding.
// Used by usePush.ts on unsubscribe.
```

**Zod schema for subscription body:**

```typescript
const PushSubscriptionSchema = z.object({
  endpoint: z.string().url(),
  keys: z.object({
    p256dh: z.string().min(1),
    auth: z.string().min(1),
  }),
  userAgent: z.string().optional(),
});
```

### Service Worker — `public/sw.js`

```javascript
// ─── Push Event ──────────────────────────────────────────────
self.addEventListener('push', (event) => {
  const payload = event.data?.json() ?? {};
  const { title, body, data } = payload;

  // Skip action buttons for test notifications (no decisionUrl)
  const actions = data?.decisionUrl
    ? [
        { action: 'approve', title: 'Approve' },
        { action: 'deny', title: 'Deny' },
      ]
    : [];

  event.waitUntil(
    self.registration.showNotification(title || 'Synapse', {
      body: body || 'Permission request pending',
      icon: '/icons/icon-192.png',
      badge: '/icons/badge-72.png',
      tag: data?.requestId ? `permission-${data.requestId}` : 'synapse',
      renotify: true,
      data: data,
      actions,
    }),
  );
});

// ─── Notification Click ─────────────────────────────────────
self.addEventListener('notificationclick', (event) => {
  const { action, notification } = event;
  const { decisionUrl, requestId, url } = notification.data || {};
  notification.close();

  if ((action === 'approve' || action === 'deny') && decisionUrl) {
    // Direct action from notification button (Android)
    // Uses absolute decisionUrl from payload — avoids relative URL breakage on port drift
    event.waitUntil(
      fetch(decisionUrl, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ behavior: action === 'approve' ? 'allow' : 'deny' }),
      })
        .then(() => {
          // Show confirmation notification (replaces the original via same tag)
          const verb = action === 'approve' ? 'Approved' : 'Denied';
          return self.registration.showNotification(`${verb} — Claude is continuing`, {
            icon: '/icons/icon-192.png',
            badge: '/icons/badge-72.png',
            tag: requestId ? `permission-${requestId}` : 'synapse',
            data: {},
          });
        })
        .then((/* notification shown */) => {
          // Auto-close confirmation after 4 seconds
          return new Promise((resolve) => setTimeout(resolve, 4000));
        })
        .then(() => {
          // Close the confirmation notification
          return self.registration.getNotifications({
            tag: requestId ? `permission-${requestId}` : 'synapse',
          });
        })
        .then((notifications) => {
          notifications.forEach((n) => n.close());
        })
        .catch(() => {
          // If fetch fails (e.g., server unreachable), open PWA as fallback
          return self.clients.openWindow(url || '/');
        }),
    );
  } else {
    // Body tap or no action — open PWA (iOS fallback)
    const openUrl = url || '/';
    event.waitUntil(
      self.clients.matchAll({ type: 'window' }).then((clients) => {
        // Focus existing window if open
        for (const client of clients) {
          if ('focus' in client) {
            return client.focus();
          }
        }
        return self.clients.openWindow(openUrl);
      }),
    );
  }
});

// ─── Subscription Change ────────────────────────────────────
self.addEventListener('pushsubscriptionchange', (event) => {
  // Browser rotated keys — delete old subscription, re-subscribe with fresh VAPID key.
  const oldEndpoint = event.oldSubscription?.endpoint;

  event.waitUntil(
    Promise.resolve()
      // Step 1: Delete old subscription from server if we have the endpoint
      .then(() => {
        if (oldEndpoint) {
          return fetch('/api/push/subscriptions', {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ endpoint: oldEndpoint }),
          }).catch(() => {}); // best-effort cleanup
        }
      })
      // Step 2: Fetch fresh VAPID key and re-subscribe
      .then(() => fetch('/api/push/vapid-key'))
      .then((r) => r.json())
      .then(({ publicKey }) => {
        // Convert URL-safe base64 VAPID key to Uint8Array
        const padding = '='.repeat((4 - (publicKey.length % 4)) % 4);
        const raw = atob(publicKey.replace(/-/g, '+').replace(/_/g, '/') + padding);
        const key = new Uint8Array(raw.length);
        for (let i = 0; i < raw.length; i++) key[i] = raw.charCodeAt(i);

        return self.registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: key,
        });
      })
      .then((newSub) => {
        const p256dh = newSub.getKey('p256dh');
        const auth = newSub.getKey('auth');
        if (!p256dh || !auth) throw new Error('Missing subscription keys');
        return fetch('/api/push/subscriptions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            endpoint: newSub.endpoint,
            keys: {
              p256dh: btoa(String.fromCharCode(...new Uint8Array(p256dh))),
              auth: btoa(String.fromCharCode(...new Uint8Array(auth))),
            },
          }),
        });
      })
      .catch(() => {
        // Re-subscribe failed — user can re-enable in settings.
        // usePush.ts onMount check will detect the missing subscription.
      }),
  );
});
```

**Key behaviors:**

- `tag: permission-${requestId}` — replaces existing notification for same request (e.g., if push fires twice)
- `renotify: true` — vibrate/sound even when replacing
- Action buttons: only shown when `decisionUrl` is present (real permissions, not test notifications)
- Approve/deny action: fires fetch, then shows confirmation notification that auto-dismisses after 4s
- Body tap: focuses existing PWA window or opens new one
- `pushsubscriptionchange`: deletes old subscription, then re-subscribes and syncs new one to server

### usePush.ts Hook

```typescript
// apps/dashboard/src/hooks/usePush.ts
// State: 'unsupported' | 'default' | 'denied' | 'granted' | 'subscribed'
// Error: string | null — surfaced to UI
//
// enable():
//   1. Check secure context: if (!window.isSecureContext) → set error
//   2. Register SW: navigator.serviceWorker.register('/sw.js')
//   3. Fetch VAPID key: GET /api/push/vapid-key → if !enabled, set error
//   4. Request permission: Notification.requestPermission()
//   5. If granted: pushManager.subscribe({ userVisibleOnly: true, applicationServerKey })
//   6. POST subscription to /api/push/subscriptions
//   7. Update state to 'subscribed'
//
// disable():
//   1. Get existing subscription: pushManager.getSubscription()
//   2. subscription.unsubscribe()
//   3. DELETE /api/push/subscriptions (endpoint in body)
//   4. Update state to 'granted' (permission still granted, just unsubscribed)
//
// On mount:
//   - Check navigator.serviceWorker support → 'unsupported' if missing
//   - Check Notification.permission → 'denied' | 'default' | 'granted'
//   - If granted, check pushManager.getSubscription() → 'subscribed' if exists
//
// sendTest():
//   POST /api/push/test → server sends a test notification to all subscriptions
```

**Error handling in enable():**

```typescript
// Key error cases surfaced via `error` return value:
if (!window.isSecureContext) {
  setError('HTTPS required for push notifications on LAN');
  return;
}

const vapidRes = await fetch(apiUrl('/api/push/vapid-key'));
const { publicKey, enabled: serverEnabled } = await vapidRes.json();
if (!serverEnabled || !publicKey) {
  setError('Push not configured on server — add VAPID keys to .env');
  return;
}

// ... on catch:
setError('Push setup failed — check browser console');
```

**VAPID public key:** Fetched from `GET /api/push/vapid-key` and cached in a ref. Must be converted from URL-safe base64 string to `Uint8Array` before passing to `pushManager.subscribe()` — raw base64 strings throw `DOMException`.

```typescript
// Helper: convert URL-safe base64 VAPID key to Uint8Array
function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  const arr = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i);
  return arr;
}
```

### PushSetup.tsx Component

Located in Hook Controls tab > "Push Notifications" section:

```
── Push Notifications ───────────────────────────
Get notified on your phone when Claude blocks

State: unsupported
  "Your browser doesn't support push notifications"

State: error (from usePush)
  "⚠ {error message}"  [Dismiss]

State: iOS + not standalone
  "iOS requires 'Add to Home Screen' for push notifications"
  Step-by-step instructions
  (Enable button is HIDDEN — replaced by instructions)

State: default (not yet asked)
  [Enable Push Notifications]

State: denied
  "Push notifications blocked — reset in browser settings"
  Instructions for Chrome/Safari reset

State: subscribed
  ● Enabled
  Devices: Chrome Android (2 hours ago) · [Remove]
  [Send test notification]  [Disable]

iOS notice (always shown on iOS, even when subscribed):
  "Tip: keep the PWA on your home screen for reliable notifications"
```

**Note:** "Remove" in the device list is for removing _other_ devices' subscriptions (e.g., old phone). To unsubscribe the _current_ device, the user should use "Disable". If the user removes their own subscription via "Remove", the `usePush` state will remain `subscribed` until the next mount check — this is acceptable for v1 since the user has "Disable" for the correct flow.

**iOS detection:** The `isIOS` check uses `navigator.userAgent` plus a fallback: `navigator.maxTouchPoints > 0 && /Mac/.test(navigator.platform)` to catch iPad desktop mode.

**iOS standalone check:** `window.matchMedia('(display-mode: standalone)').matches` or `navigator.standalone` (Safari-specific). When iOS + not standalone, the "Enable" button is hidden and replaced with Add to Home Screen instructions.

---

## Push Payload Format

Sent from server to push service, received by SW:

```json
{
  "title": "⏸ Synapse — Bash permission",
  "body": "rm -rf build/  ·  29:00 remaining",
  "data": {
    "requestId": "550e8400-e29b-41d4-a716-446655440000",
    "decisionUrl": "https://192.168.1.214:27246/api/permissions/550e8400-e29b-41d4-a716-446655440000/decision",
    "url": "https://192.168.1.214:27246/",
    "actions": ["approve", "deny"]
  }
}
```

- **title:** Tool name from hook event, prefixed with pause emoji
- **body:** First 60 chars of tool input + timeout remaining
- **data.requestId:** UUID for the PUT decision endpoint
- **data.decisionUrl:** Full absolute URL for the decision PUT endpoint — the SW uses this directly instead of constructing a relative URL. This avoids breakage if the main server port drifts between restarts. Built server-side using the LAN IP from `selectLanIp()` + bound port. Protocol is `https` when TLS is active, `http` otherwise.
- **data.url:** Full absolute URL to open the PWA on body tap
- **data.actions:** Hint for SW to show action buttons (SW checks `decisionUrl` presence to decide; this field confirms intent)

---

## Error Handling

| Scenario                               | Behavior                                                                                                                                                                                                                                      |
| -------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| VAPID keys not configured              | `sendToAll()` returns immediately. Push disabled. Info log on startup.                                                                                                                                                                        |
| No subscriptions in DB                 | `sendToAll()` returns immediately. No error.                                                                                                                                                                                                  |
| Push service returns 410/404           | Delete stale subscription from DB. Log at info level.                                                                                                                                                                                         |
| Push service returns other error       | Log at warn level. Don't fail. Continue to next subscription.                                                                                                                                                                                 |
| `sendToAll()` throws                   | Already wrapped in `.catch(logger.error)` at call site in hookServer.ts. Note: `sendToAll()` internally catches all errors via `Promise.allSettled()`, so the call-site `.catch()` is redundant but harmless — leave it for defense-in-depth. |
| SW fetch to decision endpoint fails    | SW catches error, opens PWA as fallback.                                                                                                                                                                                                      |
| Browser denies notification permission | PushSetup shows "Blocked" state with reset instructions.                                                                                                                                                                                      |
| Not a secure context (HTTP on LAN)     | `usePush.enable()` detects `!window.isSecureContext`, sets error: "HTTPS required for push notifications on LAN". Push button still visible but error shown on click.                                                                         |
| VAPID keys not on server               | `usePush.enable()` checks `/api/push/vapid-key` → `enabled: false` → sets error: "Push not configured on server".                                                                                                                             |
| `pushsubscriptionchange` fails         | SW catches error silently. User can re-enable in settings.                                                                                                                                                                                    |
| Test notification action tap           | SW skips action buttons for test payloads (`!decisionUrl`). Body tap opens PWA.                                                                                                                                                               |

**Principle:** Push is a best-effort enhancement. It must never block, fail, or degrade the core permission approval flow (dashboard cards + WS remain the primary channel).

**Dev mode limitation:** The SW's `pushsubscriptionchange` handler fetches `/api/push/vapid-key` as a relative URL. In Vite dev mode (SW served from `:5173`, API on `:27246`), this won't resolve correctly. Push subscription auto-recovery only works when the dashboard is served directly from the server (production/PWA mode). This is acceptable for v1 — subscription changes are rare and dev mode is not the target for push.

---

## Integration Points

### hookServer.ts (already implemented)

Lines 94-104 already call `sendToAll()` fire-and-forget with absolute URLs built from `selectLanIp()` + `mainPort`. Phase B updates:

<!-- revised: P0 — use protocol from TLS env var -->

```typescript
// Build absolute URLs using the LAN IP heuristic + TLS-aware protocol
const lanIp = selectLanIp(os.networkInterfaces()) ?? 'localhost';
const protocol = process.env.SYNAPSE_TLS_CERT ? 'https' : 'http';
const baseUrl = `${protocol}://${lanIp}:${mainPort}`;

sendToAll({
  title: `⏸ Synapse — ${toolName || 'Permission'} request`,
  body: `${toolInput.slice(0, 60)}  ·  ${Math.round(PERMISSION_TIMEOUT_MS / 60000)}:00 remaining`,
  requestId: id,
  decisionUrl: `${baseUrl}/api/permissions/${id}/decision`,
  url: baseUrl,
}).catch((err) => logger.error({ err }, 'Push send failed'));
```

### index.ts (already implemented — needs HTTPS addition)

`initPush()` is already called in the startup sequence after `startPruneTimer()` and before `createApp()`. Phase B adds HTTPS support to the server creation (see §HTTPS Support above).

The startup order becomes: `initDb()` → `registerAllRules()` → `seedBuiltInTemplates()` → `startPruneTimer()` → `initPush()` → services → `createApp()` → **HTTPS/HTTP server** → port listen → `createHookApp()` → hook listen.

> **Note:** The parent spec's Decision 3 auth exempt list shows `['/api/hooks/', '/api/permissions', '/api/push/']` but the live `app.ts` line 78 already includes all of these plus `/api/hook-server/`. No Phase B change needed — implementers should reference the live code.

### app.ts (route registration — already done)

- CORS: already defaults to `*`
- Push routes: `app.use('/api/push', createPushRouter())` already registered

### manifest.json (already done)

Already exists with `display: standalone` and icon entries. Icons exist in `apps/dashboard/public/icons/`.

### .env.example (already done)

`packages/server/.env.example` already has VAPID vars documented.

### index.html (no changes needed)

Already links manifest and has iOS meta tags from A2.

---

## Testing Strategy

| Test                  | Type         | Description                                                                                                                                                                                    |
| --------------------- | ------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pushService.test.ts` | Unit         | Already exists. Tests: disabled mode, enabled mode with mocked webpush, 410 cleanup, 404 cleanup, error swallowing                                                                             |
| `pushRoutes.test.ts`  | Integration  | VAPID key endpoint, subscription CRUD, Zod validation                                                                                                                                          |
| `sw.test.ts`          | Unit (jsdom) | Push event → showNotification (with/without actions for test vs real), notificationclick → fetch + confirmation notification or openWindow, pushsubscriptionchange → delete old + re-subscribe |
| `usePush.test.ts`     | Unit         | Error surfacing: no secure context, server push disabled, general failure                                                                                                                      |
| HTTPS startup         | Integration  | Server starts with TLS cert → HTTPS, without → HTTP, with bad path → warning + HTTP fallback                                                                                                   |
| Gate B manual         | E2E          | Android: receive notification with app closed → Approve → confirmation shown → Claude resumes                                                                                                  |
| Gate B iOS manual     | E2E          | Tap notification → PWA opens → card visible → Approve                                                                                                                                          |

### Gate B Manual Test Checklist

1. Server starts with VAPID keys → "Push notifications enabled" log
2. Server starts with TLS cert → "HTTPS enabled" log
3. Phone accesses `https://192.168.x.x:27246` → no cert warning (mkcert CA installed)
4. Dashboard shows "Enable Push Notifications" button in settings
5. Click Enable → browser permission prompt → grant → "Enabled" state with device info
6. Trigger permission from Claude Code (any tool) → notification received on phone (app closed)
7. Notification shows tool name, input preview, Approve/Deny buttons
8. Tap Approve → confirmation notification "Approved — Claude is continuing" → auto-dismisses
9. Claude Code resumes within 5s of approval
10. iOS: not standalone → instructions shown instead of Enable button
11. iOS: add to home screen → open PWA → Enable button now visible → same flow as above
12. Test notification: no action buttons shown, body tap opens PWA

---

## Open Questions / Deferred (P2)

- **`web-push` dependency:** Verify `web-push` is listed in `packages/server/package.json` dependencies (not just devDependencies). If missing, add it.
- **Type assertion in `analyticsQueryAll`:** The `as unknown as PushSubscriptionRow[]` double-cast bypasses type safety. A typed query helper or Zod parse would be more robust, but is consistent with existing codebase patterns. Defer to a broader DB typing cleanup.
- **Device label parsing:** `PushSetup.tsx` shows raw UA fragments like `Safari/604.1`. A simple parser mapping to human-friendly labels ("iPhone Safari", "Android Chrome") would improve UX. Low priority for v1.
- **Subscription cap:** No limit on total subscriptions in DB. For a single-user tool this is fine. If multi-user support is ever added, add a per-user cap.
- **Rate limiting on subscription endpoints:** `/api/push/subscriptions` POST is auth-exempt with only the global 300 req/min limit. A LAN-only tool has a small trust boundary, but a tighter per-endpoint limit (10/min/IP) could be added later.
- **Synchronous DB read:** `analyticsQueryAll` blocks the event loop. Acceptable for < 10 subscriptions. Would need async DB access at scale.
