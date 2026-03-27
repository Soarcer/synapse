# Multi-Channel Notifications Design

**Date:** 2026-02-23
**Status:** Approved (rev 2 — post-review fixes applied)
**Author:** Bernhard + Claude

## Problem Statement

Synapse's coaching nudges, budget alerts, and session lifecycle events are only visible inside the dashboard or VS Code extension. When a developer kicks off a long-running Claude Code session and steps away, there is no way to know what happened until they return and open the UI. High-severity events (security issues, budget threshold crossings, error spirals) should reach the user wherever they are — Slack, Discord, or any webhook-connected service.

## Goals

- Push coaching nudges, budget alerts, and session-end summaries to external channels
- Support Slack, Discord, and generic webhooks in v1
- Filter events per-channel by severity and event type (nudge/budget/session-end)
- Configuration via dashboard settings panel (VS Code settings UI deferred to v2)
- Zero new dependencies (native `fetch()` + `crypto`)
- Fire-and-forget delivery with a debug log and circuit breaker — no retry queues
- Webhook URLs masked in API responses — data stays private

## Non-Goals (v1)

- Email notifications (future — requires SMTP config complexity)
- Per-rule filtering (`filterRules`) — severity-level filtering is sufficient for v1
- VS Code extension settings UI (deferred — dashboard config is sufficient)
- Two-way interaction (replying to a Slack message to control the agent)
- Message queuing or guaranteed delivery
- Batching/digest mode (future — aggregate multiple nudges into one message)

## Architecture: Notification Dispatcher Service

```
nudgeEngine ──────┐
eventStore ───────┼──→ notificationDispatcher (singleton) ──→ SlackChannel ──→ fetch()
(session end)     │          │                             ──→ DiscordChannel ──→ fetch()
                  │          │                             ──→ WebhookChannel ──→ fetch()
                  │          └── delivery_log (SQLite)
budgetService     │
(on cost write) ──┘
```

The dispatcher is a **module-level singleton** (`export const notificationDispatcher`), ensuring one shared rate-limit map across all callers. It reads channel config from the settings table, applies filters, formats messages, dispatches in parallel via `Promise.allSettled`, and logs results. It never throws — all errors are caught and logged at `warn` level.

**Privacy note:** Webhook URLs are stored in the settings table and masked in all API read responses (last 6 chars only). Users see `••••••••••••6eXYZ` — the URL is never returned in plaintext via the API.

**Consent:** On first channel enable, the UI shows a one-time notice: "Session data (nudge text, cost, session IDs) will be sent to the configured external service." Stored in localStorage.

## 1. Data Model & Configuration

### Channel Config

Stored in `settings` table under key `notification_channels` as JSON. Validated with Zod on every read and write.

```typescript
// Defined in packages/core/src/schemas.ts (Zod) and packages/core/src/types/coaching.ts (TS)

interface NotificationChannelConfig {
  slack?: {
    enabled: boolean;
    webhookUrl: string; // https://hooks.slack.com/services/...
    filterSeverity: NudgeSeverity[] | null; // null = all severities
    notifyBudget: boolean;
    notifySessionEnd: boolean;
  };
  discord?: {
    enabled: boolean;
    webhookUrl: string; // https://discord.com/api/webhooks/...
    filterSeverity: NudgeSeverity[] | null;
    notifyBudget: boolean;
    notifySessionEnd: boolean;
  };
  webhooks?: Array<{
    name: string; // user-defined label
    enabled: boolean;
    url: string; // HTTPS required in production
    secret?: string; // HMAC-SHA256 signing key
    filterSeverity: NudgeSeverity[] | null;
    notifyBudget: boolean;
    notifySessionEnd: boolean;
  }>;
}
```

Note: `filterRules` (per-rule-ID filtering) is intentionally omitted from v1. Rule IDs are not user-friendly. Severity-based filtering covers the primary use case.

### Delivery Log (new table)

```sql
CREATE TABLE notification_delivery_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  channel TEXT NOT NULL,        -- 'slack' | 'discord' | 'webhook:<name>'
  event_type TEXT NOT NULL,     -- 'nudge' | 'budget_alert' | 'session_end'
  event_id TEXT NOT NULL,       -- nudge_id or session_id
  status TEXT NOT NULL,         -- 'sent' | 'failed' | 'skipped'
  status_code INTEGER,          -- HTTP response code (null for skipped/network error)
  error TEXT,                   -- error message or skip reason ('rate_limited', 'severity_filtered')
  sent_at INTEGER NOT NULL
);
```

- Auto-purge entries older than 7 days (on every 50th dispatch, not on every write)
- `skipped` status logged with reason — visible in delivery log UI

## 2. Dispatcher Architecture

### Singleton Export

```typescript
// packages/server/src/services/notificationDispatcher.ts

export class NotificationDispatcher {
  // Shared rate-limit map — ONE instance enforces limits across all callers
  private readonly rateLimitMap = new Map<string, number>();
  private readonly failureMap = new Map<string, number>(); // circuit breaker
  private dispatchCount = 0;

  async dispatchNudge(nudge: CoachingNudge): Promise<void>;
  async dispatchBudgetAlert(alert: BudgetAlert): Promise<void>;
  async dispatchSessionEnd(summary: SessionEndSummary): Promise<void>;
}

// Module-level singleton — imported everywhere
export const notificationDispatcher = new NotificationDispatcher();
```

### Rate Limiting

- **Standard rate limit:** Max 1 notification per channel per 60 seconds for the same event type
- **Warning burst cap:** Max 5 warning notifications per channel per 60 seconds (warnings are not fully exempt — they get a higher cap, not unlimited)
- Implemented as in-memory `Map<string, number>` keyed by `channelKey:eventType`
- `skipped` entries logged to delivery log with reason `'rate_limited'`

### Circuit Breaker

- Per-channel consecutive failure counter tracked in `failureMap`
- After **5 consecutive failures**, channel is auto-disabled in-memory (not persisted — resets on server restart)
- Reset to 0 on any success
- On disable: log at `error` level: `"Slack channel auto-disabled after 5 consecutive failures — check webhook URL"`
- `skipped` entries logged with reason `'circuit_open'`

### Integration Points

Budget dispatch is **event-driven** (triggered when new cost is recorded), not query-driven (not triggered when budget status is read).

| Location             | Trigger                                                                         | Addition                                                                                                         |
| -------------------- | ------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `nudgeEngine.ts:552` | After `broadcastNudge(nudge)`                                                   | `notificationDispatcher.dispatchNudge(nudge).catch(err => logger.warn({ err }, 'Notification dispatch failed'))` |
| `eventStore.ts`      | On `agent_stop` with no `parentAgentId`                                         | Build `SessionEndSummary` from DB, call `notificationDispatcher.dispatchSessionEnd(summary)`                     |
| `budgetService.ts`   | New function `checkBudgetThresholdsOnWrite()` called from `updateDailyRollup()` | Tracks last-notified threshold per period, dispatches only on new crossings                                      |

**Critical:** Budget notification must NOT be called from `buildPeriod()` or `getBudgetStatus()`. These are read operations called on every dashboard poll. Budget notifications must only fire when new cost data is written.

## 3. Channel Formatters

Standalone functions (not an interface-based class hierarchy — the interface is dead code without consumers). Shared `postJson()` utility eliminates duplication between Slack and Discord senders.

```typescript
// Shared in channels/types.ts
async function postJson(
  url: string,
  payload: unknown,
  timeout = 5000,
): Promise<{ status: number; error?: string }>;
```

5-second timeout for all channels (Slack/Discord respond in <500ms normally; 10s was unnecessarily generous and wastes connections on dead endpoints).

### Severity Colors

| Severity     | Hex       | Discord decimal |
| ------------ | --------- | --------------- |
| `info`       | `#3498db` | `3448539`       |
| `suggestion` | `#f39c12` | `15981330`      |
| `warning`    | `#e74c3c` | `15158332`      |

### Slack (Block Kit)

Header block + fields section (session ID, severity) + recommendation text section. Colored sidebar attachment.

### Discord (Embeds)

Same hierarchy — title, description, color, inline fields, ISO timestamp.

### Generic Webhook

JSON with `X-Synapse-Signature: sha256=<hmac>` header (only when `secret` configured):

```json
{ "type": "nudge", "timestamp": 1740321000000, "data": { ...CoachingNudge } }
```

### Session End (all channels)

```
✅ Session Complete — sess_abc123
Duration: 12m 34s | Tools: 47 | Cost: $2.14
Nudges: 0 info, 1 suggestion, 2 warnings
```

## 4. API Routes

```
GET    /api/notifications/config          — current config (webhook URLs masked)
PUT    /api/notifications/config          — update config (Zod-validated)
POST   /api/notifications/test/:channel   — send test to THAT channel only
GET    /api/notifications/log             — recent delivery log (last 50)
DELETE /api/notifications/log             — clear delivery log
```

### Validation (Zod on PUT)

- Slack URLs: must match `^https://hooks\.slack\.com/services/`
- Discord URLs: must match `^https://discord\.com/api/webhooks/`
- Generic webhook URLs: HTTPS required in production, HTTP allowed in dev
- `filterSeverity`: `z.array(z.enum(['info', 'suggestion', 'warning'])).nullable()`
- Entire config validated with `NotificationChannelConfigSchema` before saving

### URL Masking (GET)

Webhook URLs returned from API as masked strings: `••••••••••••6eXYZ` (last 6 chars). Full URL never exposed via API — only written via PUT.

### Test Endpoint

`POST /api/notifications/test/:channel` sends a test nudge to **only** the specified channel (`:channel` = `slack` | `discord` | `webhook:<name>`). Does not send to all channels.

## 5. Settings UI

### Dashboard (v1)

New "Notifications" tab in the existing settings panel (`SettingsPanel.tsx`), sized `max-w-xl` (not `max-w-md` — the notification config complexity needs the extra width).

**Empty state:** If no channels are configured, show `EmptyState` component:

- Title: "Stay informed when you step away"
- Body: "Get notified in Slack, Discord, or any webhook when your agent hits a warning, crosses a budget threshold, or finishes a session."
- CTA: "Add Slack" / "Add Discord" / "Add Webhook" buttons

**Per-channel card** (collapsed by default):

- Enable/disable toggle
- Webhook URL input (password-masked, never shows full URL after save)
- **Test button** with loading spinner (disabled while pending, 5s timeout, inline ✅/❌ feedback)
- Severity filter: checkbox group (info / suggestion / warning), default all checked
- Event type toggles: nudges / budget alerts / session summaries
- Generic webhooks: "Add webhook" → name + URL + optional HMAC secret

**First-enable consent notice** (one-time, stored in localStorage):

> "Session data including nudge text, cost amounts, and session IDs will be sent to the configured external service. This data leaves your local machine."

**Delivery log section** (below channel cards):

- Compact table: timestamp, channel, event type, status badge (sent/failed/skipped), error text on hover
- "Clear log" button
- Max 20 rows shown, "View all" collapses/expands

### VS Code Extension (v2)

Deferred. The dashboard config is sufficient for v1. The VS Code extension's settings panel will be extended in a follow-up to read/write the same `/api/notifications/config` endpoint.

**Zero-config VS Code notification (v2 consideration):** `vscode.window.showWarningMessage()` for warnings requires zero webhook setup — worth ~10 lines in `wsClient.ts`. Deferred but easy win for v2.

## 6. Testing Strategy

### Unit Tests (~28 cases)

- **Formatters** (~9): Slack Block Kit structure, Discord embed shape, webhook payload shape per event type
- **Dispatcher** (~11): Channel filtering, rate limiting, warning burst cap, circuit breaker, `.catch()` logging, rate limit expiration via fake timers, concurrent dispatch, HMAC header in webhook call, disabled channel skipped, empty config no-ops
- **Validation** (~5): URL format acceptance/rejection, HMAC computation determinism
- **DB helpers** (~3): insert/retrieve/prune delivery log

### Integration Tests (~7 cases)

- **API routes** (~5): CRUD on config, test endpoint targets only specified channel, delivery log CRUD
- **End-to-end** (~2): Store nudge event → verify `fetch()` called with correct payload

### Manual Testing

- `scripts/simulate_all_nodes.ts` triggers warning nudge → fires dispatcher with real webhook
- `POST /api/notifications/test/slack` with real Slack URL = primary verification

## 7. File Plan

### New Files

```
packages/core/src/schemas/notifications.ts                — Zod schema
packages/server/src/services/notificationDispatcher.ts    — core dispatcher + singleton
packages/server/src/services/channels/types.ts            — shared postJson(), color constants
packages/server/src/services/channels/slackChannel.ts     — Slack formatter
packages/server/src/services/channels/discordChannel.ts   — Discord formatter
packages/server/src/services/channels/webhookChannel.ts   — Generic webhook + HMAC
packages/server/src/routes/notifications.ts               — API routes
packages/server/src/__tests__/channelFormatters.test.ts
packages/server/src/__tests__/notificationDispatcher.test.ts
packages/server/src/__tests__/notificationRoutes.test.ts
```

### Modified Files

```
packages/core/src/types/coaching.ts             — add SessionEndSummary, BudgetAlert, channel config types
packages/core/src/schemas.ts                    — add NotificationChannelConfigSchema
packages/core/src/index.ts                      — re-export new types and schema
packages/server/src/db.ts                       — add delivery_log table, insertDeliveryLog/getDeliveryLog/clearDeliveryLog/pruneDeliveryLog
packages/server/src/app.ts                      — register /api/notifications router
packages/server/src/services/settingsService.ts — add NOTIFICATION_CHANNELS key
packages/server/src/services/nudgeEngine.ts     — call notificationDispatcher.dispatchNudge
packages/server/src/services/budgetService.ts   — add checkBudgetThresholdsOnWrite()
packages/server/src/services/eventStore.ts      — call dispatchSessionEnd on agent_stop
apps/dashboard/src/components/analytics/shared/SettingsPanel.tsx — Notifications tab
```

### Zero new dependencies

- `fetch()` native in Node 20+
- `crypto.createHmac()` built-in
- Zod already in `@synapse-ai/core`
