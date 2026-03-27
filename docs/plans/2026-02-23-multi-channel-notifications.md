# Multi-Channel Notifications Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Push coaching nudges, budget alerts, and session-end summaries to Slack, Discord, and generic webhooks.

**Architecture:** Module-level singleton `NotificationDispatcher` between event sources (nudge engine, event store on session-end, budget service on cost-write) and delivery channels. Zod-validated config. Circuit breaker per channel. 5s timeouts. Delivery log with skipped-entry support. Dashboard settings tab with empty state, loading states, and masked URLs.

**Tech Stack:** Node.js native `fetch()`, `crypto.createHmac()`, Zod (already in core), Express 5 routes, sql.js, Vitest.

**Design Doc:** `docs/plans/2026-02-23-multi-channel-notifications-design.md`

**Review fixes applied from:** Principal Engineer, Services Architect, UI/UX Designer reviews (2026-02-23).

---

## Task 1: Types + Zod Schema in `@synapse-ai/core`

**Files:**

- Modify: `packages/core/src/types/coaching.ts` (after `NudgeCandidate` ~line 91)
- Modify: `packages/core/src/schemas.ts` (add `NotificationChannelConfigSchema`)
- Modify: `packages/core/src/index.ts` (re-export new types + schema)

**Step 1: Add types to coaching.ts**

After the `NudgeCandidate` interface (around line 91), add:

```typescript
// ─── Notification Types ──────────────────────────────────────────────
// NOTE: "SessionEndSummary" — distinct from the existing "SessionSummary" (coaching report
// type at line ~217) and the DB row type in server/db.ts. Different shapes, different purposes.

export interface SlackChannelConfig {
  enabled: boolean;
  webhookUrl: string;
  filterSeverity: NudgeSeverity[] | null; // null = all severities
  notifyBudget: boolean;
  notifySessionEnd: boolean;
}

export interface DiscordChannelConfig {
  enabled: boolean;
  webhookUrl: string;
  filterSeverity: NudgeSeverity[] | null;
  notifyBudget: boolean;
  notifySessionEnd: boolean;
}

export interface WebhookChannelConfig {
  name: string;
  enabled: boolean;
  url: string;
  secret?: string; // HMAC-SHA256 signing key
  filterSeverity: NudgeSeverity[] | null;
  notifyBudget: boolean;
  notifySessionEnd: boolean;
}

export interface NotificationChannelConfig {
  slack?: SlackChannelConfig;
  discord?: DiscordChannelConfig;
  webhooks?: WebhookChannelConfig[];
}

export interface BudgetAlert {
  period: 'daily' | 'weekly' | 'monthly';
  threshold: number; // e.g. 0.9 = 90%
  percentUsed: number;
  spent: number;
  limit: number;
  message: string;
}

export interface SessionEndSummary {
  sessionId: string;
  durationMs: number;
  toolCount: number;
  costUsd: number;
  nudgeCounts: { info: number; suggestion: number; warning: number };
  model?: string;
}
```

**Step 2: Add Zod schema to schemas.ts**

In `packages/core/src/schemas.ts`, add (near other complex schemas):

```typescript
export const NotificationChannelConfigSchema = z.object({
  slack: z
    .object({
      enabled: z.boolean(),
      webhookUrl: z.string(),
      filterSeverity: z.array(z.enum(['info', 'suggestion', 'warning'])).nullable(),
      notifyBudget: z.boolean(),
      notifySessionEnd: z.boolean(),
    })
    .optional(),
  discord: z
    .object({
      enabled: z.boolean(),
      webhookUrl: z.string(),
      filterSeverity: z.array(z.enum(['info', 'suggestion', 'warning'])).nullable(),
      notifyBudget: z.boolean(),
      notifySessionEnd: z.boolean(),
    })
    .optional(),
  webhooks: z
    .array(
      z.object({
        name: z.string().min(1),
        enabled: z.boolean(),
        url: z.string().url(),
        secret: z.string().optional(),
        filterSeverity: z.array(z.enum(['info', 'suggestion', 'warning'])).nullable(),
        notifyBudget: z.boolean(),
        notifySessionEnd: z.boolean(),
      }),
    )
    .optional(),
});

export type NotificationChannelConfigFromSchema = z.infer<typeof NotificationChannelConfigSchema>;
```

**Step 3: Re-export from core index.ts**

In `packages/core/src/index.ts`, add exports alongside existing ones:

```typescript
export type {
  SlackChannelConfig,
  DiscordChannelConfig,
  WebhookChannelConfig,
  NotificationChannelConfig,
  BudgetAlert,
  SessionEndSummary,
} from './types/coaching.js';

export { NotificationChannelConfigSchema } from './schemas.js';
```

**Step 4: Type-check**

Run: `cd packages/core && npx tsc --noEmit`
Expected: PASS — no errors.

**Step 5: Commit**

```bash
git add packages/core/src/types/coaching.ts packages/core/src/schemas.ts packages/core/src/index.ts
git commit -m "feat(core): add notification types (SessionEndSummary, BudgetAlert, channel configs) and Zod schema"
```

---

## Task 2: Delivery Log DB Table & Helpers

**Files:**

- Modify: `packages/server/src/db.ts`
- Create: `packages/server/src/__tests__/notificationDb.test.ts`

**Step 1: Read the test setup pattern**

Before writing tests, read ONE existing test file to understand the project's test setup pattern:

```bash
cat packages/server/src/__tests__/routes.test.ts | head -30
```

Key pattern: tests set `process.env.SYNAPSE_DB_PATH` to a temp path BEFORE importing db.ts:

```typescript
import path from 'path';
import os from 'os';
// Must be before any import of db.ts
process.env.SYNAPSE_DB_PATH = path.join(os.tmpdir(), `synapse-notif-db-test-${Date.now()}.db`);
```

**Step 2: Write failing tests**

Create `packages/server/src/__tests__/notificationDb.test.ts`:

```typescript
import path from 'path';
import os from 'os';
process.env.SYNAPSE_DB_PATH = path.join(os.tmpdir(), `synapse-notif-db-test-${Date.now()}.db`);

import { describe, it, expect, beforeAll } from 'vitest';
import {
  initDb,
  insertDeliveryLog,
  getDeliveryLog,
  clearDeliveryLog,
  pruneDeliveryLog,
} from '../db.js';

beforeAll(async () => {
  await initDb();
});

describe('notification delivery log', () => {
  it('inserts and retrieves a sent entry', () => {
    insertDeliveryLog({
      channel: 'slack',
      event_type: 'nudge',
      event_id: 'nudge-abc',
      status: 'sent',
      status_code: 200,
      error: null,
    });
    const logs = getDeliveryLog(50);
    expect(logs.length).toBeGreaterThanOrEqual(1);
    const entry = logs.find((l) => l.event_id === 'nudge-abc');
    expect(entry).toMatchObject({
      channel: 'slack',
      event_type: 'nudge',
      status: 'sent',
      status_code: 200,
    });
    expect(entry!.sent_at).toBeGreaterThan(0);
  });

  it('inserts a skipped entry with reason', () => {
    insertDeliveryLog({
      channel: 'discord',
      event_type: 'nudge',
      event_id: 'nudge-skipped',
      status: 'skipped',
      status_code: null,
      error: 'rate_limited',
    });
    const logs = getDeliveryLog(50);
    const entry = logs.find((l) => l.event_id === 'nudge-skipped');
    expect(entry?.status).toBe('skipped');
    expect(entry?.error).toBe('rate_limited');
  });

  it('clears all delivery logs', () => {
    insertDeliveryLog({
      channel: 'discord',
      event_type: 'budget_alert',
      event_id: 'b1',
      status: 'sent',
      status_code: 200,
      error: null,
    });
    clearDeliveryLog();
    expect(getDeliveryLog(50)).toHaveLength(0);
  });

  it('prunes entries older than N days', () => {
    // Insert a fresh entry
    insertDeliveryLog({
      channel: 'slack',
      event_type: 'session_end',
      event_id: 'sess-fresh',
      status: 'sent',
      status_code: 200,
      error: null,
    });
    // Prune with 0-day cutoff — nothing should survive
    pruneDeliveryLog(0);
    const remaining = getDeliveryLog(50);
    expect(remaining.find((r) => r.event_id === 'sess-fresh')).toBeUndefined();
  });
});
```

**Step 3: Run to verify it fails**

Run: `npx vitest run packages/server/src/__tests__/notificationDb.test.ts`
Expected: FAIL — `insertDeliveryLog` not found.

**Step 4: Add table + helpers to db.ts**

**4a: Add table creation** in `initDb()`, after the settings table (after line 317):

```typescript
// ── Notification delivery log ──────────────────────────────────────
db.run(`
    CREATE TABLE IF NOT EXISTS notification_delivery_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      channel TEXT NOT NULL,
      event_type TEXT NOT NULL,
      event_id TEXT NOT NULL,
      status TEXT NOT NULL,
      status_code INTEGER,
      error TEXT,
      sent_at INTEGER NOT NULL
    )
  `);
db.run('CREATE INDEX IF NOT EXISTS idx_notif_log_time ON notification_delivery_log(sent_at)');
```

**4b: Add helper functions** near the other write helpers (~line 1260):

```typescript
// ─── Notification Delivery Log ────────────────────────────────────────

export function insertDeliveryLog(params: {
  channel: string;
  event_type: string;
  event_id: string;
  status: string;
  status_code: number | null;
  error: string | null;
}): void {
  execute(
    `INSERT INTO notification_delivery_log (channel, event_type, event_id, status, status_code, error, sent_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      params.channel,
      params.event_type,
      params.event_id,
      params.status,
      params.status_code,
      params.error,
      Date.now(),
    ],
  );
  scheduleSave();
}

export function getDeliveryLog(limit: number): Array<{
  id: number;
  channel: string;
  event_type: string;
  event_id: string;
  status: string;
  status_code: number | null;
  error: string | null;
  sent_at: number;
}> {
  return queryAll(
    'SELECT id, channel, event_type, event_id, status, status_code, error, sent_at FROM notification_delivery_log ORDER BY sent_at DESC LIMIT ?',
    [limit],
  ) as Array<{
    id: number;
    channel: string;
    event_type: string;
    event_id: string;
    status: string;
    status_code: number | null;
    error: string | null;
    sent_at: number;
  }>;
}

export function clearDeliveryLog(): void {
  execute('DELETE FROM notification_delivery_log');
  scheduleSave();
}

export function pruneDeliveryLog(maxAgeDays: number): void {
  const cutoff = Date.now() - maxAgeDays * 24 * 60 * 60 * 1000;
  execute('DELETE FROM notification_delivery_log WHERE sent_at < ?', [cutoff]);
  scheduleSave();
}
```

Note: Use `execute()` (not `getDb().run()`) and call `scheduleSave()` — this matches every other write function in `db.ts` and ensures in-memory changes are persisted to disk.

**Step 5: Run to verify it passes**

Run: `npx vitest run packages/server/src/__tests__/notificationDb.test.ts`
Expected: PASS — 4 tests green.

**Step 6: Commit**

```bash
git add packages/server/src/db.ts packages/server/src/__tests__/notificationDb.test.ts
git commit -m "feat(server): add notification delivery log table (insert/get/clear/prune)"
```

---

## Task 3: Shared Channel Utilities + Formatters

**Files:**

- Create: `packages/server/src/services/channels/types.ts`
- Create: `packages/server/src/services/channels/slackChannel.ts`
- Create: `packages/server/src/services/channels/discordChannel.ts`
- Create: `packages/server/src/services/channels/webhookChannel.ts`
- Create: `packages/server/src/__tests__/channelFormatters.test.ts`

**Step 1: Write failing tests**

Create `packages/server/src/__tests__/channelFormatters.test.ts`:

```typescript
import path from 'path';
import os from 'os';
process.env.SYNAPSE_DB_PATH = path.join(os.tmpdir(), `synapse-formatter-test-${Date.now()}.db`);

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { CoachingNudge, BudgetAlert, SessionEndSummary } from '@synapse-ai/core';
import {
  formatSlackNudge,
  formatSlackBudgetAlert,
  formatSlackSessionEnd,
} from '../services/channels/slackChannel.js';
import {
  formatDiscordNudge,
  formatDiscordBudgetAlert,
  formatDiscordSessionEnd,
} from '../services/channels/discordChannel.js';
import { formatWebhookPayload, computeHmacSignature } from '../services/channels/webhookChannel.js';
import { postJson } from '../services/channels/types.js';

const nudge: CoachingNudge = {
  id: 'nudge-1',
  sessionId: 'sess-abc',
  detectorId: 'security.api-key',
  severity: 'warning',
  title: 'API Key Exposure',
  message: 'A potential API key was detected.',
  recommendation: 'Use environment variables instead.',
  firedAt: 1000000,
  dismissed: false,
};

const infoNudge: CoachingNudge = {
  ...nudge,
  id: 'nudge-info',
  severity: 'info',
  title: 'Info nudge',
};
const suggestionNudge: CoachingNudge = {
  ...nudge,
  id: 'nudge-sug',
  severity: 'suggestion',
  title: 'Suggestion nudge',
};

const budget: BudgetAlert = {
  period: 'daily',
  threshold: 0.9,
  percentUsed: 0.92,
  spent: 46,
  limit: 50,
  message: '90% of daily budget used ($46.00 / $50.00)',
};

const session: SessionEndSummary = {
  sessionId: 'sess-abc',
  durationMs: 754_000,
  toolCount: 47,
  costUsd: 2.14,
  nudgeCounts: { info: 0, suggestion: 1, warning: 2 },
  model: 'claude-opus-4-6',
};

describe('Slack formatter', () => {
  it('uses red color for warning severity', () => {
    const p = formatSlackNudge(nudge);
    expect(p.attachments[0].color).toBe('#e74c3c');
  });
  it('uses blue color for info severity', () => {
    const p = formatSlackNudge(infoNudge);
    expect(p.attachments[0].color).toBe('#3498db');
  });
  it('uses amber color for suggestion severity', () => {
    const p = formatSlackNudge(suggestionNudge);
    expect(p.attachments[0].color).toBe('#f39c12');
  });
  it('includes title in header block', () => {
    const p = formatSlackNudge(nudge);
    expect(p.attachments[0].blocks[0].text.text).toContain('API Key Exposure');
  });
  it('formats budget alert with percentage', () => {
    const p = formatSlackBudgetAlert(budget);
    expect(JSON.stringify(p)).toContain('90%');
    expect(JSON.stringify(p)).toContain('$46.00');
  });
  it('formats session end with tool count and cost', () => {
    const p = formatSlackSessionEnd(session);
    expect(JSON.stringify(p)).toContain('47');
    expect(JSON.stringify(p)).toContain('$2.14');
  });
});

describe('Discord formatter', () => {
  it('uses correct decimal color for warning', () => {
    const p = formatDiscordNudge(nudge);
    expect(p.embeds[0].color).toBe(0xe74c3c);
  });
  it('includes title in embed', () => {
    const p = formatDiscordNudge(nudge);
    expect(p.embeds[0].title).toContain('API Key Exposure');
  });
  it('formats budget alert', () => {
    const p = formatDiscordBudgetAlert(budget);
    expect(JSON.stringify(p)).toContain('90%');
  });
  it('formats session end', () => {
    const p = formatDiscordSessionEnd(session);
    expect(JSON.stringify(p)).toContain('sess-abc');
  });
});

describe('Webhook formatter', () => {
  it('includes type field', () => {
    const p = formatWebhookPayload('nudge', nudge);
    expect(p.type).toBe('nudge');
    expect(p.timestamp).toBeGreaterThan(0);
  });
  it('HMAC signature is deterministic', () => {
    const body = JSON.stringify({ test: true });
    const sig1 = computeHmacSignature(body, 'secret');
    const sig2 = computeHmacSignature(body, 'secret');
    expect(sig1).toBe(sig2);
    expect(sig1).toMatch(/^[a-f0-9]{64}$/);
  });
  it('HMAC signature differs with different secret', () => {
    const body = JSON.stringify({ test: true });
    expect(computeHmacSignature(body, 'secret-a')).not.toBe(computeHmacSignature(body, 'secret-b'));
  });
});

describe('postJson', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('returns status 200 on success', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, status: 200, text: async () => 'ok' }),
    );
    const result = await postJson('https://hooks.slack.com/test', { foo: 'bar' });
    expect(result.status).toBe(200);
    expect(result.error).toBeUndefined();
  });

  it('returns error on non-ok response', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: false, status: 404, text: async () => 'Not found' }),
    );
    const result = await postJson('https://hooks.slack.com/test', { foo: 'bar' });
    expect(result.status).toBe(404);
    expect(result.error).toContain('Not found');
  });

  it('uses 5s timeout by default', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, text: async () => 'ok' });
    vi.stubGlobal('fetch', fetchMock);
    await postJson('https://example.com', {});
    const callArgs = fetchMock.mock.calls[0][1];
    // AbortSignal.timeout(5000) is used — we verify it's present in the options
    expect(callArgs.signal).toBeDefined();
  });
});
```

**Step 2: Run to verify they fail**

Run: `npx vitest run packages/server/src/__tests__/channelFormatters.test.ts`
Expected: FAIL — modules not found.

**Step 3: Create types.ts (shared utilities)**

Create `packages/server/src/services/channels/types.ts`:

```typescript
// SPDX-License-Identifier: AGPL-3.0-or-later
import type { NudgeSeverity } from '@synapse-ai/core';

export const SEVERITY_COLORS = {
  info: { hex: '#3498db', decimal: 0x3498db },
  suggestion: { hex: '#f39c12', decimal: 0xf39c12 },
  warning: { hex: '#e74c3c', decimal: 0xe74c3c },
} as const satisfies Record<NudgeSeverity, { hex: string; decimal: number }>;

export const SEVERITY_EMOJI: Record<NudgeSeverity, string> = {
  info: 'ℹ️',
  suggestion: '💡',
  warning: '⚠️',
};

export function formatDuration(ms: number): string {
  const totalSec = Math.floor(ms / 1000);
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  return `${min}m ${sec}s`;
}

/**
 * Shared HTTP sender for all channels.
 * 5-second timeout — Slack/Discord respond in <500ms normally.
 * Additional headers (e.g. HMAC signature) passed via `extraHeaders`.
 */
export async function postJson(
  url: string,
  payload: unknown,
  extraHeaders?: Record<string, string>,
  timeoutMs = 5_000,
): Promise<{ status: number; error?: string }> {
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...extraHeaders },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      return { status: res.status, error: text.slice(0, 200) };
    }
    return { status: res.status };
  } catch (err) {
    const name = err instanceof Error ? err.name : 'UnknownError';
    const message =
      name === 'AbortError'
        ? `Request timed out after ${timeoutMs}ms`
        : err instanceof Error
          ? err.message
          : 'Unknown fetch error';
    return { status: 0, error: message };
  }
}
```

**Step 4: Create slackChannel.ts**

Create `packages/server/src/services/channels/slackChannel.ts`:

```typescript
// SPDX-License-Identifier: AGPL-3.0-or-later
import type { CoachingNudge, BudgetAlert, SessionEndSummary } from '@synapse-ai/core';
import { SEVERITY_COLORS, SEVERITY_EMOJI, formatDuration, postJson } from './types.js';

export function formatSlackNudge(nudge: CoachingNudge) {
  const color = SEVERITY_COLORS[nudge.severity].hex;
  const emoji = SEVERITY_EMOJI[nudge.severity];
  return {
    attachments: [
      {
        color,
        blocks: [
          {
            type: 'header',
            text: { type: 'plain_text', text: `${emoji} ${nudge.title}`, emoji: true },
          },
          {
            type: 'section',
            fields: [
              { type: 'mrkdwn', text: `*Session:* \`${nudge.sessionId.slice(0, 12)}\`` },
              { type: 'mrkdwn', text: `*Severity:* ${nudge.severity}` },
              { type: 'mrkdwn', text: `*Rule:* ${nudge.detectorId}` },
            ],
          },
          { type: 'section', text: { type: 'mrkdwn', text: nudge.recommendation.slice(0, 2000) } },
        ],
      },
    ],
  };
}

export function formatSlackBudgetAlert(alert: BudgetAlert) {
  const pct = Math.round(alert.percentUsed * 100);
  const color = pct >= 90 ? '#e74c3c' : pct >= 75 ? '#f39c12' : '#3498db';
  return {
    attachments: [
      {
        color,
        blocks: [
          {
            type: 'header',
            text: { type: 'plain_text', text: `💰 Budget Alert: ${alert.period}`, emoji: true },
          },
          {
            type: 'section',
            fields: [
              { type: 'mrkdwn', text: `*Used:* ${pct}%` },
              {
                type: 'mrkdwn',
                text: `*Spent:* $${alert.spent.toFixed(2)} / $${alert.limit.toFixed(2)}`,
              },
            ],
          },
          { type: 'section', text: { type: 'mrkdwn', text: alert.message } },
        ],
      },
    ],
  };
}

export function formatSlackSessionEnd(summary: SessionEndSummary) {
  const { info, suggestion, warning } = summary.nudgeCounts;
  return {
    attachments: [
      {
        color: '#2ecc71',
        blocks: [
          {
            type: 'header',
            text: { type: 'plain_text', text: '✅ Session Complete', emoji: true },
          },
          {
            type: 'section',
            fields: [
              { type: 'mrkdwn', text: `*Session:* \`${summary.sessionId.slice(0, 12)}\`` },
              { type: 'mrkdwn', text: `*Duration:* ${formatDuration(summary.durationMs)}` },
              { type: 'mrkdwn', text: `*Tools:* ${summary.toolCount}` },
              { type: 'mrkdwn', text: `*Cost:* $${summary.costUsd.toFixed(2)}` },
            ],
          },
          {
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: `Nudges: ${info} info · ${suggestion} suggestion · ${warning} warning`,
            },
          },
        ],
      },
    ],
  };
}

export const sendSlack = (url: string, payload: unknown) => postJson(url, payload);
```

**Step 5: Create discordChannel.ts**

Create `packages/server/src/services/channels/discordChannel.ts`:

```typescript
// SPDX-License-Identifier: AGPL-3.0-or-later
import type { CoachingNudge, BudgetAlert, SessionEndSummary } from '@synapse-ai/core';
import { SEVERITY_COLORS, SEVERITY_EMOJI, formatDuration, postJson } from './types.js';

export function formatDiscordNudge(nudge: CoachingNudge) {
  const emoji = SEVERITY_EMOJI[nudge.severity];
  return {
    embeds: [
      {
        title: `${emoji} ${nudge.title}`,
        description: nudge.recommendation.slice(0, 2000),
        color: SEVERITY_COLORS[nudge.severity].decimal,
        fields: [
          { name: 'Session', value: `\`${nudge.sessionId.slice(0, 12)}\``, inline: true },
          { name: 'Severity', value: nudge.severity, inline: true },
          { name: 'Rule', value: nudge.detectorId, inline: true },
        ],
        timestamp: new Date(nudge.firedAt).toISOString(),
      },
    ],
  };
}

export function formatDiscordBudgetAlert(alert: BudgetAlert) {
  const pct = Math.round(alert.percentUsed * 100);
  const color = pct >= 90 ? 0xe74c3c : pct >= 75 ? 0xf39c12 : 0x3498db;
  return {
    embeds: [
      {
        title: `💰 Budget Alert: ${alert.period}`,
        description: alert.message,
        color,
        fields: [
          { name: 'Used', value: `${pct}%`, inline: true },
          {
            name: 'Spent',
            value: `$${alert.spent.toFixed(2)} / $${alert.limit.toFixed(2)}`,
            inline: true,
          },
        ],
        timestamp: new Date().toISOString(),
      },
    ],
  };
}

export function formatDiscordSessionEnd(summary: SessionEndSummary) {
  const { info, suggestion, warning } = summary.nudgeCounts;
  return {
    embeds: [
      {
        title: '✅ Session Complete',
        color: 0x2ecc71,
        fields: [
          { name: 'Session', value: `\`${summary.sessionId.slice(0, 12)}\``, inline: true },
          { name: 'Duration', value: formatDuration(summary.durationMs), inline: true },
          { name: 'Tools', value: `${summary.toolCount}`, inline: true },
          { name: 'Cost', value: `$${summary.costUsd.toFixed(2)}`, inline: true },
          {
            name: 'Nudges',
            value: `${info} info · ${suggestion} suggestion · ${warning} warning`,
            inline: false,
          },
        ],
        timestamp: new Date().toISOString(),
      },
    ],
  };
}

export const sendDiscord = (url: string, payload: unknown) => postJson(url, payload);
```

**Step 6: Create webhookChannel.ts**

Create `packages/server/src/services/channels/webhookChannel.ts`:

```typescript
// SPDX-License-Identifier: AGPL-3.0-or-later
import { createHmac } from 'crypto';
import type { CoachingNudge, BudgetAlert, SessionEndSummary } from '@synapse-ai/core';
import { postJson } from './types.js';

export function formatWebhookPayload(
  type: 'nudge' | 'budget_alert' | 'session_end',
  data: CoachingNudge | BudgetAlert | SessionEndSummary,
) {
  return { type, timestamp: Date.now(), data };
}

export function computeHmacSignature(body: string, secret: string): string {
  return createHmac('sha256', secret).update(body).digest('hex');
}

export async function sendWebhook(
  url: string,
  payload: unknown,
  secret?: string,
): Promise<{ status: number; error?: string }> {
  const body = JSON.stringify(payload);
  const extraHeaders: Record<string, string> = {};
  if (secret) {
    extraHeaders['X-Synapse-Signature'] = `sha256=${computeHmacSignature(body, secret)}`;
  }
  // postJson re-stringifies — pass pre-serialized body via raw fetch for exact HMAC match
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...extraHeaders },
    body,
    signal: AbortSignal.timeout(5_000),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    return { status: res.status, error: text.slice(0, 200) };
  }
  return { status: res.status };
}
```

**Step 7: Run tests to verify pass**

Run: `npx vitest run packages/server/src/__tests__/channelFormatters.test.ts`
Expected: PASS — all 15 tests green.

**Step 8: Commit**

```bash
git add packages/server/src/services/channels/ packages/server/src/__tests__/channelFormatters.test.ts
git commit -m "feat(server): add Slack/Discord/webhook channel formatters with shared postJson utility"
```

---

## Task 4: NotificationDispatcher (Singleton + Circuit Breaker)

**Files:**

- Modify: `packages/server/src/services/settingsService.ts` (add `NOTIFICATION_CHANNELS` key)
- Create: `packages/server/src/services/notificationDispatcher.ts`
- Create: `packages/server/src/__tests__/notificationDispatcher.test.ts`

**Step 1: Add settings key**

In `packages/server/src/services/settingsService.ts`, add to `SETTINGS_KEYS`:

```typescript
  NOTIFICATION_CHANNELS: 'notification_channels',
```

**Step 2: Write failing tests**

Create `packages/server/src/__tests__/notificationDispatcher.test.ts`:

```typescript
import path from 'path';
import os from 'os';
process.env.SYNAPSE_DB_PATH = path.join(os.tmpdir(), `synapse-dispatcher-test-${Date.now()}.db`);

import { describe, it, expect, vi, beforeEach, beforeAll, afterEach } from 'vitest';
import { initDb, setSetting, getDeliveryLog, clearDeliveryLog } from '../db.js';
import { SETTINGS_KEYS } from '../services/settingsService.js';
import { NotificationDispatcher } from '../services/notificationDispatcher.js';
import type {
  CoachingNudge,
  BudgetAlert,
  SessionEndSummary,
  NotificationChannelConfig,
} from '@synapse-ai/core';

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

const warnNudge: CoachingNudge = {
  id: 'n-warn',
  sessionId: 'sess-1',
  detectorId: 'security.api-key',
  severity: 'warning',
  title: 'API Key',
  message: 'msg',
  recommendation: 'rec',
  firedAt: Date.now(),
  dismissed: false,
};
const infoNudge: CoachingNudge = { ...warnNudge, id: 'n-info', severity: 'info', title: 'Info' };
const budget: BudgetAlert = {
  period: 'daily',
  threshold: 0.9,
  percentUsed: 0.92,
  spent: 46,
  limit: 50,
  message: '90% used',
};
const sessionEnd: SessionEndSummary = {
  sessionId: 'sess-1',
  durationMs: 60_000,
  toolCount: 10,
  costUsd: 1.0,
  nudgeCounts: { info: 0, suggestion: 0, warning: 1 },
};

function cfg(config: NotificationChannelConfig) {
  setSetting(SETTINGS_KEYS.NOTIFICATION_CHANNELS, JSON.stringify(config));
}
function okFetch() {
  mockFetch.mockResolvedValue({ ok: true, status: 200, text: async () => 'ok' });
}

beforeAll(async () => {
  await initDb();
});
beforeEach(() => {
  mockFetch.mockReset();
  okFetch();
  clearDeliveryLog();
});
afterEach(() => {
  setSetting(SETTINGS_KEYS.NOTIFICATION_CHANNELS, '{}');
});

describe('NotificationDispatcher', () => {
  // Use a FRESH dispatcher per-describe so rate limit state doesn't bleed between tests
  let d: NotificationDispatcher;
  beforeEach(() => {
    d = new NotificationDispatcher();
  });

  it('does nothing when config is empty', async () => {
    cfg({});
    await d.dispatchNudge(warnNudge);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('sends to Slack when enabled', async () => {
    cfg({
      slack: {
        enabled: true,
        webhookUrl: 'https://hooks.slack.com/services/T/B/X',
        filterSeverity: null,
        notifyBudget: true,
        notifySessionEnd: true,
      },
    });
    await d.dispatchNudge(warnNudge);
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(mockFetch.mock.calls[0][0]).toBe('https://hooks.slack.com/services/T/B/X');
  });

  it('sends to Discord when enabled', async () => {
    cfg({
      discord: {
        enabled: true,
        webhookUrl: 'https://discord.com/api/webhooks/123/abc',
        filterSeverity: null,
        notifyBudget: true,
        notifySessionEnd: true,
      },
    });
    await d.dispatchNudge(warnNudge);
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('filters by severity — info nudge excluded when only warnings allowed', async () => {
    cfg({
      slack: {
        enabled: true,
        webhookUrl: 'https://hooks.slack.com/services/T/B/X',
        filterSeverity: ['warning'],
        notifyBudget: true,
        notifySessionEnd: true,
      },
    });
    await d.dispatchNudge(infoNudge);
    expect(mockFetch).not.toHaveBeenCalled();
    // Check delivery log has skipped entry
    const logs = getDeliveryLog(10);
    expect(logs.some((l) => l.status === 'skipped' && l.error === 'severity_filtered')).toBe(true);
  });

  it('skips budget alert when notifyBudget is false', async () => {
    cfg({
      slack: {
        enabled: true,
        webhookUrl: 'https://hooks.slack.com/services/T/B/X',
        filterSeverity: null,
        notifyBudget: false,
        notifySessionEnd: true,
      },
    });
    await d.dispatchBudgetAlert(budget);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('skips session end when notifySessionEnd is false', async () => {
    cfg({
      slack: {
        enabled: true,
        webhookUrl: 'https://hooks.slack.com/services/T/B/X',
        filterSeverity: null,
        notifyBudget: true,
        notifySessionEnd: false,
      },
    });
    await d.dispatchSessionEnd(sessionEnd);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('rate-limits info nudges to 1 per 60s per channel', async () => {
    cfg({
      slack: {
        enabled: true,
        webhookUrl: 'https://hooks.slack.com/services/T/B/X',
        filterSeverity: null,
        notifyBudget: true,
        notifySessionEnd: true,
      },
    });
    await d.dispatchNudge(infoNudge);
    await d.dispatchNudge({ ...infoNudge, id: 'n-info-2' });
    expect(mockFetch).toHaveBeenCalledTimes(1);
    const logs = getDeliveryLog(10);
    expect(logs.some((l) => l.status === 'skipped' && l.error === 'rate_limited')).toBe(true);
  });

  it('rate-limit resets after 60s', async () => {
    vi.useFakeTimers();
    cfg({
      slack: {
        enabled: true,
        webhookUrl: 'https://hooks.slack.com/services/T/B/X',
        filterSeverity: null,
        notifyBudget: true,
        notifySessionEnd: true,
      },
    });
    await d.dispatchNudge(infoNudge);
    vi.advanceTimersByTime(61_000);
    await d.dispatchNudge({ ...infoNudge, id: 'n-info-3' });
    expect(mockFetch).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });

  it('warning nudges get burst cap (max 5 per 60s), not unlimited', async () => {
    cfg({
      slack: {
        enabled: true,
        webhookUrl: 'https://hooks.slack.com/services/T/B/X',
        filterSeverity: null,
        notifyBudget: true,
        notifySessionEnd: true,
      },
    });
    for (let i = 0; i < 7; i++) {
      await d.dispatchNudge({ ...warnNudge, id: `n-warn-${i}` });
    }
    // First 5 should go through, remaining 2 rate-limited
    expect(mockFetch).toHaveBeenCalledTimes(5);
  });

  it('circuit breaker disables channel after 5 consecutive failures', async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 404, text: async () => 'gone' });
    cfg({
      slack: {
        enabled: true,
        webhookUrl: 'https://hooks.slack.com/services/T/B/X',
        filterSeverity: null,
        notifyBudget: true,
        notifySessionEnd: true,
      },
    });
    for (let i = 0; i < 6; i++) {
      await d.dispatchNudge({ ...warnNudge, id: `n-warn-cb-${i}` });
    }
    // 6 attempts: first 5 hit network (and fail), 6th skipped (circuit open)
    expect(mockFetch).toHaveBeenCalledTimes(5);
    const logs = getDeliveryLog(20);
    expect(logs.some((l) => l.status === 'skipped' && l.error === 'circuit_open')).toBe(true);
  });

  it('logs delivery to DB with correct status', async () => {
    cfg({
      slack: {
        enabled: true,
        webhookUrl: 'https://hooks.slack.com/services/T/B/X',
        filterSeverity: null,
        notifyBudget: true,
        notifySessionEnd: true,
      },
    });
    await d.dispatchNudge(warnNudge);
    const logs = getDeliveryLog(10);
    expect(logs.some((l) => l.channel === 'slack' && l.status === 'sent')).toBe(true);
  });

  it('logs failed delivery with error', async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 500, text: async () => 'internal error' });
    cfg({
      slack: {
        enabled: true,
        webhookUrl: 'https://hooks.slack.com/services/T/B/X',
        filterSeverity: null,
        notifyBudget: true,
        notifySessionEnd: true,
      },
    });
    await d.dispatchNudge(warnNudge);
    const logs = getDeliveryLog(10);
    expect(logs.some((l) => l.channel === 'slack' && l.status === 'failed')).toBe(true);
  });

  it('includes X-Synapse-Signature header for webhooks with secret', async () => {
    cfg({
      webhooks: [
        {
          name: 'my-hook',
          enabled: true,
          url: 'https://example.com/hook',
          secret: 'my-secret',
          filterSeverity: null,
          notifyBudget: true,
          notifySessionEnd: true,
        },
      ],
    });
    await d.dispatchNudge(warnNudge);
    const callHeaders = mockFetch.mock.calls[0][1].headers;
    expect(callHeaders['X-Synapse-Signature']).toMatch(/^sha256=[a-f0-9]{64}$/);
  });
});
```

**Step 3: Run to verify they fail**

Run: `npx vitest run packages/server/src/__tests__/notificationDispatcher.test.ts`
Expected: FAIL — `NotificationDispatcher` not found.

**Step 4: Implement NotificationDispatcher**

Create `packages/server/src/services/notificationDispatcher.ts`:

```typescript
// SPDX-License-Identifier: AGPL-3.0-or-later
import type {
  CoachingNudge,
  BudgetAlert,
  SessionEndSummary,
  NotificationChannelConfig,
  NudgeSeverity,
} from '@synapse-ai/core';
import { NotificationChannelConfigSchema } from '@synapse-ai/core';
import { getSetting, insertDeliveryLog, pruneDeliveryLog } from '../db.js';
import { SETTINGS_KEYS } from './settingsService.js';
import {
  formatSlackNudge,
  formatSlackBudgetAlert,
  formatSlackSessionEnd,
  sendSlack,
} from './channels/slackChannel.js';
import {
  formatDiscordNudge,
  formatDiscordBudgetAlert,
  formatDiscordSessionEnd,
  sendDiscord,
} from './channels/discordChannel.js';
import { formatWebhookPayload, sendWebhook } from './channels/webhookChannel.js';
import { logger } from '../lib/logger.js';

const RATE_LIMIT_MS = 60_000;
const WARNING_BURST_CAP = 5; // warnings get this many sends per RATE_LIMIT_MS window
const CIRCUIT_BREAKER_THRESHOLD = 5; // consecutive failures before disabling channel

export class NotificationDispatcher {
  /** channelKey:eventType → last sent timestamp (for non-warning rate limiting) */
  private readonly rateLimitMap = new Map<string, number>();
  /** channelKey:eventType → warning send count within current window */
  private readonly warningBurstMap = new Map<string, { count: number; windowStart: number }>();
  /** channelKey → consecutive failure count */
  private readonly failureMap = new Map<string, number>();
  /** channelKey → true if circuit is open (channel disabled) */
  private readonly circuitOpen = new Set<string>();
  private dispatchCount = 0;

  // ── Public API ─────────────────────────────────────────────────────

  async dispatchNudge(nudge: CoachingNudge): Promise<void> {
    const config = this.getConfig();
    const sends: Promise<void>[] = [];

    if (config.slack?.enabled && config.slack.webhookUrl) {
      sends.push(
        this.handleNudge('slack', config.slack.filterSeverity, nudge, () =>
          sendSlack(config.slack!.webhookUrl, formatSlackNudge(nudge)),
        ),
      );
    }
    if (config.discord?.enabled && config.discord.webhookUrl) {
      sends.push(
        this.handleNudge('discord', config.discord.filterSeverity, nudge, () =>
          sendDiscord(config.discord!.webhookUrl, formatDiscordNudge(nudge)),
        ),
      );
    }
    for (const wh of config.webhooks ?? []) {
      if (!wh.enabled || !wh.url) continue;
      sends.push(
        this.handleNudge(`webhook:${wh.name}`, wh.filterSeverity, nudge, () =>
          sendWebhook(wh.url, formatWebhookPayload('nudge', nudge), wh.secret),
        ),
      );
    }

    await Promise.allSettled(sends);
    this.maybePrune();
  }

  async dispatchBudgetAlert(alert: BudgetAlert): Promise<void> {
    const config = this.getConfig();
    const sends: Promise<void>[] = [];

    if (config.slack?.enabled && config.slack.webhookUrl && config.slack.notifyBudget) {
      sends.push(
        this.handleStandard('slack', 'budget_alert', `${alert.period}-${alert.threshold}`, () =>
          sendSlack(config.slack!.webhookUrl, formatSlackBudgetAlert(alert)),
        ),
      );
    }
    if (config.discord?.enabled && config.discord.webhookUrl && config.discord.notifyBudget) {
      sends.push(
        this.handleStandard('discord', 'budget_alert', `${alert.period}-${alert.threshold}`, () =>
          sendDiscord(config.discord!.webhookUrl, formatDiscordBudgetAlert(alert)),
        ),
      );
    }
    for (const wh of config.webhooks ?? []) {
      if (!wh.enabled || !wh.url || !wh.notifyBudget) continue;
      sends.push(
        this.handleStandard(
          `webhook:${wh.name}`,
          'budget_alert',
          `${alert.period}-${alert.threshold}`,
          () => sendWebhook(wh.url, formatWebhookPayload('budget_alert', alert), wh.secret),
        ),
      );
    }

    await Promise.allSettled(sends);
  }

  async dispatchSessionEnd(summary: SessionEndSummary): Promise<void> {
    const config = this.getConfig();
    const sends: Promise<void>[] = [];

    if (config.slack?.enabled && config.slack.webhookUrl && config.slack.notifySessionEnd) {
      sends.push(
        this.handleStandard('slack', 'session_end', summary.sessionId, () =>
          sendSlack(config.slack!.webhookUrl, formatSlackSessionEnd(summary)),
        ),
      );
    }
    if (config.discord?.enabled && config.discord.webhookUrl && config.discord.notifySessionEnd) {
      sends.push(
        this.handleStandard('discord', 'session_end', summary.sessionId, () =>
          sendDiscord(config.discord!.webhookUrl, formatDiscordSessionEnd(summary)),
        ),
      );
    }
    for (const wh of config.webhooks ?? []) {
      if (!wh.enabled || !wh.url || !wh.notifySessionEnd) continue;
      sends.push(
        this.handleStandard(`webhook:${wh.name}`, 'session_end', summary.sessionId, () =>
          sendWebhook(wh.url, formatWebhookPayload('session_end', summary), wh.secret),
        ),
      );
    }

    await Promise.allSettled(sends);
  }

  // ── Internals ──────────────────────────────────────────────────────

  private async handleNudge(
    channelKey: string,
    filterSeverity: NudgeSeverity[] | null,
    nudge: CoachingNudge,
    sender: () => Promise<{ status: number; error?: string }>,
  ): Promise<void> {
    // Severity filter
    if (filterSeverity !== null && !filterSeverity.includes(nudge.severity)) {
      this.logSkip(channelKey, 'nudge', nudge.id, 'severity_filtered');
      return;
    }
    // Circuit breaker
    if (this.circuitOpen.has(channelKey)) {
      this.logSkip(channelKey, 'nudge', nudge.id, 'circuit_open');
      return;
    }
    // Rate limiting: warnings get burst cap, others get 1-per-window
    if (nudge.severity === 'warning') {
      if (!this.checkWarningBurst(channelKey)) {
        this.logSkip(channelKey, 'nudge', nudge.id, 'rate_limited');
        return;
      }
    } else {
      if (this.isRateLimited(channelKey, 'nudge')) {
        this.logSkip(channelKey, 'nudge', nudge.id, 'rate_limited');
        return;
      }
    }
    await this.sendAndLog(channelKey, 'nudge', nudge.id, sender);
  }

  private async handleStandard(
    channelKey: string,
    eventType: string,
    eventId: string,
    sender: () => Promise<{ status: number; error?: string }>,
  ): Promise<void> {
    if (this.circuitOpen.has(channelKey)) {
      this.logSkip(channelKey, eventType, eventId, 'circuit_open');
      return;
    }
    if (this.isRateLimited(channelKey, eventType)) {
      this.logSkip(channelKey, eventType, eventId, 'rate_limited');
      return;
    }
    await this.sendAndLog(channelKey, eventType, eventId, sender);
  }

  private async sendAndLog(
    channel: string,
    eventType: string,
    eventId: string,
    sender: () => Promise<{ status: number; error?: string }>,
  ): Promise<void> {
    try {
      const result = await sender();
      const failed = result.status === 0 || !!result.error;
      insertDeliveryLog({
        channel,
        event_type: eventType,
        event_id: eventId,
        status: failed ? 'failed' : 'sent',
        status_code: result.status || null,
        error: result.error ?? null,
      });
      if (failed) {
        this.recordFailure(channel);
        logger.warn(
          { channel, eventType, eventId, status: result.status, error: result.error },
          'Notification delivery failed',
        );
      } else {
        this.failureMap.delete(channel); // reset circuit breaker on success
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      insertDeliveryLog({
        channel,
        event_type: eventType,
        event_id: eventId,
        status: 'failed',
        status_code: null,
        error: message,
      });
      this.recordFailure(channel);
      logger.warn({ channel, eventType, err }, 'Notification send threw');
    }
  }

  private logSkip(channel: string, eventType: string, eventId: string, reason: string): void {
    insertDeliveryLog({
      channel,
      event_type: eventType,
      event_id: eventId,
      status: 'skipped',
      status_code: null,
      error: reason,
    });
  }

  private isRateLimited(channelKey: string, eventType: string): boolean {
    const key = `${channelKey}:${eventType}`;
    const last = this.rateLimitMap.get(key);
    if (last !== undefined && Date.now() - last < RATE_LIMIT_MS) return true;
    this.rateLimitMap.set(key, Date.now());
    return false;
  }

  private checkWarningBurst(channelKey: string): boolean {
    const key = `${channelKey}:warning_burst`;
    const now = Date.now();
    const existing = this.warningBurstMap.get(key);
    if (!existing || now - existing.windowStart >= RATE_LIMIT_MS) {
      this.warningBurstMap.set(key, { count: 1, windowStart: now });
      return true;
    }
    if (existing.count >= WARNING_BURST_CAP) return false;
    existing.count++;
    return true;
  }

  private recordFailure(channel: string): void {
    const count = (this.failureMap.get(channel) ?? 0) + 1;
    this.failureMap.set(channel, count);
    if (count >= CIRCUIT_BREAKER_THRESHOLD) {
      this.circuitOpen.add(channel);
      logger.error(
        { channel },
        `Notification channel auto-disabled after ${CIRCUIT_BREAKER_THRESHOLD} consecutive failures — check your webhook URL`,
      );
    }
  }

  private getConfig(): NotificationChannelConfig {
    const raw = getSetting(SETTINGS_KEYS.NOTIFICATION_CHANNELS);
    if (!raw) return {};
    const parsed = NotificationChannelConfigSchema.safeParse(
      JSON.parse(raw).catch
        ? {}
        : (() => {
            try {
              return JSON.parse(raw);
            } catch {
              return {};
            }
          })(),
    );
    return parsed.success ? parsed.data : {};
  }

  private maybePrune(): void {
    this.dispatchCount++;
    if (this.dispatchCount % 50 === 0) pruneDeliveryLog(7);
  }
}

/** Module-level singleton — import this everywhere instead of new NotificationDispatcher() */
export const notificationDispatcher = new NotificationDispatcher();
```

Note: Fix the `getConfig` method — the nested try/catch above is awkward. Clean version:

```typescript
  private getConfig(): NotificationChannelConfig {
    const raw = getSetting(SETTINGS_KEYS.NOTIFICATION_CHANNELS);
    if (!raw) return {};
    try {
      const parsed = NotificationChannelConfigSchema.safeParse(JSON.parse(raw));
      return parsed.success ? parsed.data : {};
    } catch {
      return {};
    }
  }
```

**Step 5: Run to verify they pass**

Run: `npx vitest run packages/server/src/__tests__/notificationDispatcher.test.ts`
Expected: PASS — all 12 tests green.

**Step 6: Commit**

```bash
git add packages/server/src/services/notificationDispatcher.ts packages/server/src/services/settingsService.ts packages/server/src/__tests__/notificationDispatcher.test.ts
git commit -m "feat(server): add NotificationDispatcher with circuit breaker, burst cap, and Zod-validated config"
```

---

## Task 5: API Routes

**Files:**

- Create: `packages/server/src/routes/notifications.ts`
- Modify: `packages/server/src/app.ts` (register routes)
- Create: `packages/server/src/__tests__/notificationRoutes.test.ts`

**Step 1: Write failing tests**

Create `packages/server/src/__tests__/notificationRoutes.test.ts`:

```typescript
import path from 'path';
import os from 'os';
process.env.SYNAPSE_DB_PATH = path.join(os.tmpdir(), `synapse-routes-test-${Date.now()}.db`);

import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import { initDb } from '../db.js';
import { createApp } from '../app.js';
import { Broadcaster } from '../services/broadcaster.js';
import { AgentManager } from '../services/agentManager.js';

let app: ReturnType<typeof createApp>;

beforeAll(async () => {
  await initDb();
  const broadcaster = new Broadcaster();
  const agentManager = new AgentManager(broadcaster);
  app = createApp({ broadcaster, agentManager, disableRateLimiting: true });
});

describe('GET /api/notifications/config', () => {
  it('returns empty config by default', async () => {
    const res = await request(app).get('/api/notifications/config');
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({});
  });
});

describe('PUT /api/notifications/config', () => {
  it('saves valid Slack config', async () => {
    const config = {
      slack: {
        enabled: true,
        webhookUrl: 'https://hooks.slack.com/services/T/B/X',
        filterSeverity: null,
        notifyBudget: true,
        notifySessionEnd: true,
      },
    };
    const put = await request(app).put('/api/notifications/config').send(config);
    expect(put.status).toBe(200);
    expect(put.body.ok).toBe(true);
  });

  it('returns masked URL on subsequent GET', async () => {
    const get = await request(app).get('/api/notifications/config');
    expect(get.status).toBe(200);
    // URL should be masked — should NOT contain the full token
    expect(JSON.stringify(get.body.data)).not.toContain('hooks.slack.com/services/T/B/X');
    // Should contain masking indicator
    expect(JSON.stringify(get.body.data)).toContain('••');
  });

  it('rejects invalid Slack URL', async () => {
    const config = {
      slack: {
        enabled: true,
        webhookUrl: 'https://notslack.com/bad',
        filterSeverity: null,
        notifyBudget: true,
        notifySessionEnd: true,
      },
    };
    const res = await request(app).put('/api/notifications/config').send(config);
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('Slack');
  });

  it('rejects invalid Discord URL', async () => {
    const config = {
      discord: {
        enabled: true,
        webhookUrl: 'https://notdiscord.com/bad',
        filterSeverity: null,
        notifyBudget: true,
        notifySessionEnd: true,
      },
    };
    const res = await request(app).put('/api/notifications/config').send(config);
    expect(res.status).toBe(400);
  });
});

describe('GET /api/notifications/log', () => {
  it('returns array', async () => {
    const res = await request(app).get('/api/notifications/log');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
  });
});

describe('DELETE /api/notifications/log', () => {
  it('clears log and returns ok', async () => {
    const res = await request(app).delete('/api/notifications/log');
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });
});
```

**Step 2: Run to verify they fail**

Run: `npx vitest run packages/server/src/__tests__/notificationRoutes.test.ts`
Expected: FAIL — 404 on notification routes.

**Step 3: Create notifications router**

Create `packages/server/src/routes/notifications.ts`:

```typescript
// SPDX-License-Identifier: AGPL-3.0-or-later
import { Router, type Request, type Response } from 'express';
import { logger } from '../lib/logger.js';
import { getSetting, setSetting, getDeliveryLog, clearDeliveryLog } from '../db.js';
import { SETTINGS_KEYS } from '../services/settingsService.js';
import { notificationDispatcher } from '../services/notificationDispatcher.js';
import { NotificationChannelConfigSchema } from '@synapse-ai/core';
import type { NotificationChannelConfig } from '@synapse-ai/core';

const SLACK_URL_RE = /^https:\/\/hooks\.slack\.com\/services\//;
const DISCORD_URL_RE = /^https:\/\/discord\.com\/api\/webhooks\//;

function maskUrl(url: string): string {
  if (url.length <= 6) return '••••••';
  return `${'•'.repeat(Math.max(0, url.length - 6))}${url.slice(-6)}`;
}

function maskConfig(config: NotificationChannelConfig): NotificationChannelConfig {
  const masked = structuredClone(config) as NotificationChannelConfig;
  if (masked.slack?.webhookUrl) masked.slack.webhookUrl = maskUrl(masked.slack.webhookUrl);
  if (masked.discord?.webhookUrl) masked.discord.webhookUrl = maskUrl(masked.discord.webhookUrl);
  for (const wh of masked.webhooks ?? []) {
    if (wh.url) wh.url = maskUrl(wh.url);
  }
  return masked;
}

function validateUrls(config: NotificationChannelConfig): string | null {
  if (config.slack?.webhookUrl && !SLACK_URL_RE.test(config.slack.webhookUrl)) {
    return 'Invalid Slack webhook URL — must start with https://hooks.slack.com/services/';
  }
  if (config.discord?.webhookUrl && !DISCORD_URL_RE.test(config.discord.webhookUrl)) {
    return 'Invalid Discord webhook URL — must start with https://discord.com/api/webhooks/';
  }
  for (const wh of config.webhooks ?? []) {
    if (
      wh.enabled &&
      wh.url &&
      !wh.url.startsWith('https://') &&
      process.env.NODE_ENV === 'production'
    ) {
      return `Webhook "${wh.name}" requires HTTPS in production`;
    }
  }
  return null;
}

export function createNotificationsRouter(): Router {
  const router = Router();

  router.get('/config', (_req: Request, res: Response) => {
    try {
      const raw = getSetting(SETTINGS_KEYS.NOTIFICATION_CHANNELS);
      const config: NotificationChannelConfig = raw ? JSON.parse(raw) : {};
      res.json({ data: maskConfig(config) });
    } catch (err) {
      logger.error({ err }, 'Error fetching notification config');
      res.status(500).json({ error: 'Failed to fetch config' });
    }
  });

  router.put('/config', (req: Request, res: Response) => {
    try {
      // Zod parse for schema validation
      const schemaResult = NotificationChannelConfigSchema.safeParse(req.body);
      if (!schemaResult.success) {
        res.status(400).json({ error: 'Invalid config', details: schemaResult.error.flatten() });
        return;
      }
      // URL format validation
      const urlError = validateUrls(schemaResult.data);
      if (urlError) {
        res.status(400).json({ error: urlError });
        return;
      }
      setSetting(SETTINGS_KEYS.NOTIFICATION_CHANNELS, JSON.stringify(schemaResult.data));
      res.json({ ok: true });
    } catch (err) {
      logger.error({ err }, 'Error saving notification config');
      res.status(500).json({ error: 'Failed to save config' });
    }
  });

  // Send test notification to ONE specific channel
  router.post('/test/:channel', async (req: Request, res: Response) => {
    try {
      const channelParam = req.params.channel as string; // 'slack' | 'discord' | 'webhook:<name>'
      const raw = getSetting(SETTINGS_KEYS.NOTIFICATION_CHANNELS);
      const config: NotificationChannelConfig = raw ? JSON.parse(raw) : {};

      const testNudge = {
        id: `test-${Date.now()}`,
        sessionId: 'test-session',
        detectorId: 'test.notification-test',
        severity: 'info' as const,
        title: 'Test Notification from Synapse',
        message: 'This is a test notification to verify your webhook configuration.',
        recommendation: 'If you see this message, your notification channel is working correctly!',
        firedAt: Date.now(),
        dismissed: false,
      };

      // Dispatch to the specific channel only — build a config with only that channel
      const testConfig: NotificationChannelConfig = {};
      if (channelParam === 'slack' && config.slack) {
        testConfig.slack = config.slack;
      } else if (channelParam === 'discord' && config.discord) {
        testConfig.discord = config.discord;
      } else if (channelParam.startsWith('webhook:')) {
        const name = channelParam.slice('webhook:'.length);
        const wh = config.webhooks?.find((w) => w.name === name);
        if (wh) testConfig.webhooks = [wh];
      }

      if (!testConfig.slack && !testConfig.discord && !testConfig.webhooks?.length) {
        res.status(400).json({ error: `Channel "${channelParam}" not found or not configured` });
        return;
      }

      // Use a fresh dispatcher with just the target channel config for the test
      const { NotificationDispatcher } = await import('../services/notificationDispatcher.js');
      const testDispatcher = new NotificationDispatcher();
      setSetting(SETTINGS_KEYS.NOTIFICATION_CHANNELS, JSON.stringify(testConfig));
      await testDispatcher.dispatchNudge(testNudge);
      setSetting(SETTINGS_KEYS.NOTIFICATION_CHANNELS, JSON.stringify(config)); // restore

      res.json({ ok: true, channel: channelParam });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      res.json({ ok: false, error: message });
    }
  });

  router.get('/log', (_req: Request, res: Response) => {
    try {
      res.json({ data: getDeliveryLog(50) });
    } catch (err) {
      logger.error({ err }, 'Error fetching delivery log');
      res.status(500).json({ error: 'Failed to fetch log' });
    }
  });

  router.delete('/log', (_req: Request, res: Response) => {
    try {
      clearDeliveryLog();
      res.json({ ok: true });
    } catch (err) {
      logger.error({ err }, 'Error clearing delivery log');
      res.status(500).json({ error: 'Failed to clear log' });
    }
  });

  return router;
}
```

**Step 4: Register route in app.ts**

Add import after existing route imports (around line 17):

```typescript
import { createNotificationsRouter } from './routes/notifications.js';
```

Add after line 106:

```typescript
app.use('/api/notifications', createNotificationsRouter());
```

**Step 5: Run to verify they pass**

Run: `npx vitest run packages/server/src/__tests__/notificationRoutes.test.ts`
Expected: PASS — all 7 tests green.

**Step 6: Commit**

```bash
git add packages/server/src/routes/notifications.ts packages/server/src/app.ts packages/server/src/__tests__/notificationRoutes.test.ts
git commit -m "feat(server): add /api/notifications routes (config CRUD, masked URLs, targeted test endpoint)"
```

---

## Task 6: Wire Dispatcher Into Event Sources

**Files:**

- Modify: `packages/server/src/services/nudgeEngine.ts`
- Modify: `packages/server/src/services/eventStore.ts`
- Modify: `packages/server/src/services/budgetService.ts`

**Step 1: Wire into nudge engine**

In `packages/server/src/services/nudgeEngine.ts`, add import:

```typescript
import { notificationDispatcher } from './notificationDispatcher.js';
```

After line 552 (`broadcaster.broadcastNudge(nudge);`), add:

```typescript
notificationDispatcher.dispatchNudge(nudge).catch((err) => {
  logger.warn({ err }, 'Notification dispatch failed');
});
```

**Step 2: Wire into event store for session end**

In `packages/server/src/services/eventStore.ts`, add import:

```typescript
import { notificationDispatcher } from './notificationDispatcher.js';
import type { SessionEndSummary } from '@synapse-ai/core';
```

After the `checkNudges(event, broadcaster)` call (line 125), add:

```typescript
// Session end notification (top-level agent only)
if (event.type === 'agent_stop' && !event.parentAgentId) {
  void buildAndDispatchSessionEnd(event.sessionId, event.model);
}
```

Add helper function (below `storeNormalized`):

```typescript
async function buildAndDispatchSessionEnd(sessionId: string, model?: string): Promise<void> {
  try {
    // Use analyticsQueryGet (exported) not the private queryGet
    const summary = analyticsQueryGet<{
      event_count: number;
      tool_count: number;
      first_event: number;
      last_event: number;
    }>(
      'SELECT event_count, tool_count, first_event, last_event FROM session_summary WHERE session_id = ?',
      [sessionId],
    );
    if (!summary) return;

    // Count nudges by severity — use analyticsQueryAll (exported)
    const nudgeRows = analyticsQueryAll<{ severity: string }>(
      'SELECT severity FROM coaching_nudges WHERE session_id = ?',
      [sessionId],
    );
    const nudgeCounts = { info: 0, suggestion: 0, warning: 0 };
    for (const row of nudgeRows) {
      if (row.severity in nudgeCounts) nudgeCounts[row.severity as keyof typeof nudgeCounts]++;
    }

    const sessionEnd: SessionEndSummary = {
      sessionId,
      durationMs: summary.last_event - summary.first_event,
      toolCount: summary.tool_count,
      costUsd: 0, // Cost is tracked in analytics_daily, not session_summary — use 0 for now
      nudgeCounts,
      model,
    };
    await notificationDispatcher.dispatchSessionEnd(sessionEnd);
  } catch (err) {
    logger.warn({ err, sessionId }, 'Session end notification failed');
  }
}
```

**Important:** Use `analyticsQueryGet` and `analyticsQueryAll` — these are the exported wrapper functions. Do NOT use `queryGet` or `queryAll` directly, which are private to `db.ts`.

**Step 3: Wire budget alerts — event-driven only**

In `packages/server/src/services/budgetService.ts`, add import:

```typescript
import { notificationDispatcher } from './notificationDispatcher.js';
import type { BudgetAlert } from '@synapse-ai/core';
```

Add a tracking map to detect _new_ threshold crossings (not re-fire on every read):

```typescript
/** Tracks which thresholds have already triggered notifications, keyed by period */
const notifiedThresholds = new Map<string, Set<number>>();
```

Add a new exported function called from `updateDailyRollup()` (NOT from `buildPeriod` or `getBudgetStatus`):

```typescript
/**
 * Check budget thresholds and dispatch notifications for NEW crossings.
 * Call this ONLY after writing new cost data, not on reads.
 */
export function checkBudgetThresholdsOnWrite(): void {
  try {
    const status = getBudgetStatus();
    const periods = ['daily', 'weekly', 'monthly'] as const;
    for (const period of periods) {
      const p = status[period];
      if (!notifiedThresholds.has(period)) notifiedThresholds.set(period, new Set());
      const already = notifiedThresholds.get(period)!;

      for (const threshold of budgetConfig.alertThresholds) {
        if (p.percentUsed >= threshold && !already.has(threshold)) {
          already.add(threshold);
          const alert: BudgetAlert = {
            period,
            threshold,
            percentUsed: p.percentUsed,
            spent: p.spent,
            limit: p.limit,
            message:
              p.activeAlerts[p.activeAlerts.length - 1] ??
              `${Math.round(threshold * 100)}% of ${period} budget used`,
          };
          notificationDispatcher.dispatchBudgetAlert(alert).catch((err) => {
            logger.warn({ err, period, threshold }, 'Budget alert notification failed');
          });
        }
        // Reset if dropped below threshold (e.g. new day/week/month)
        if (p.percentUsed < threshold) already.delete(threshold);
      }
    }
  } catch (err) {
    logger.warn({ err }, 'checkBudgetThresholdsOnWrite failed');
  }
}
```

Then in `eventStore.ts` (or wherever `updateDailyRollup` is called), add after the rollup:

```typescript
import { checkBudgetThresholdsOnWrite } from './budgetService.js';
// ...after updateDailyRollup():
checkBudgetThresholdsOnWrite();
```

**Step 4: Run full test suite**

Run: `npx vitest run`
Expected: All existing tests pass. No regressions.

**Step 5: Commit**

```bash
git add packages/server/src/services/nudgeEngine.ts packages/server/src/services/eventStore.ts packages/server/src/services/budgetService.ts
git commit -m "feat(server): wire notification dispatcher into nudge engine, session end, and budget cost-write events"
```

---

## Task 7: Settings UI — Notifications Tab (Dashboard)

**Files:**

- Modify: `apps/dashboard/src/components/analytics/shared/SettingsPanel.tsx`
- (Reference existing UI patterns in the same file for toggle, input, section components)

**Step 1: Read SettingsPanel.tsx before editing**

Read the full file first to understand existing patterns for:

- Section components and collapsible cards
- Form inputs and toggles
- How settings are fetched/saved via API

**Step 2: Add NotificationsPanel component**

Add a new `NotificationsPanel.tsx` in the same directory (keep SettingsPanel clean):

```typescript
// apps/dashboard/src/components/analytics/shared/NotificationsPanel.tsx

// Component structure (implement using existing patterns from SettingsPanel.tsx):
// 1. Empty state (if no channels configured)
//    - Title: "Stay informed when you step away"
//    - Body: description
//    - CTA buttons: "Add Slack" / "Add Discord" / "Add Webhook"
// 2. Per-channel cards (Slack, Discord, Webhooks section)
//    - Enable toggle
//    - URL input (type="password" so browser masks it)
//    - Test button with loading state (disabled while pending, shows ✅/❌ inline)
//    - Severity filter checkboxes
//    - Event type toggles (nudges / budget / session end)
// 3. Delivery log table (last 20 entries, compact)
//    - Columns: time, channel, type, status badge, error tooltip
//    - Clear button
```

Key UX requirements from review:

- **Test button** must show a loading spinner while pending (5s max). Disable the button during the request. Show inline success/failure — not a toast.
- **URL input** use `type="password"` so browser doesn't autofill/leak URLs. On save, the API returns a masked version — display that.
- **Empty state** use the project's existing `EmptyState` component if available.
- **First-enable consent** check `localStorage.getItem('synapse_notification_consent')`. If not set, show a dismissible notice before enabling any channel. On dismiss, set it.
- **Settings panel size** must be `max-w-xl` or wider for this section — ensure the parent container accommodates it.

**Step 3: Integrate into SettingsPanel.tsx**

Add a "Notifications" tab/section in `SettingsPanel.tsx` that renders `<NotificationsPanel />`.

**Step 4: Manual test**

Start the server and dashboard, open settings, verify:

- Empty state shows when no channels configured
- Can add Slack URL, see it masked after save
- Test button shows loading, then inline result
- Delivery log updates after test
- Consent notice appears on first enable

**Step 5: Commit**

```bash
git add apps/dashboard/src/components/analytics/shared/NotificationsPanel.tsx apps/dashboard/src/components/analytics/shared/SettingsPanel.tsx
git commit -m "feat(dashboard): add Notifications settings tab with empty state, masked URLs, and delivery log"
```

---

## Task 8: Final Verification

**Step 1: Run full test suite**

Run: `npx vitest run`
Expected: All tests pass.

**Step 2: Type check all packages**

Run: `pnpm -r --parallel exec tsc --noEmit`
Expected: No type errors.

**Step 3: Manual end-to-end smoke test**

1. Start server + dashboard
2. Configure a real Slack or Discord webhook in Settings → Notifications
3. Run: `npx tsx scripts/simulate_all_nodes.ts`
4. Verify notification arrives in Slack/Discord
5. Check delivery log in UI shows `sent` entry
6. Disable channel — verify no more notifications
7. Check circuit breaker: configure bad URL, run simulation 6 times, verify channel shows as disabled in logs

**Step 4: Commit any remaining fixes**

```bash
git add -A
git commit -m "chore: final verification for multi-channel notifications"
```

---

## Summary

| Task | What                                                       | New Tests  |
| ---- | ---------------------------------------------------------- | ---------- |
| 1    | Types + Zod schema in `@synapse-ai/core`                   | typecheck  |
| 2    | Delivery log DB table + helpers                            | 4          |
| 3    | Channel formatters + shared `postJson`                     | 15         |
| 4    | `NotificationDispatcher` singleton + circuit breaker       | 12         |
| 5    | API routes (masked URLs, targeted test, Zod validation)    | 7          |
| 6    | Wire into nudge engine, session-end, budget cost-write     | regression |
| 7    | Dashboard notifications tab (empty state, loading, log UI) | manual     |
| 8    | Full verification                                          | all        |

**Total: ~38 new test cases, 10 new files, ~7 modified files, 0 new dependencies.**

**Critical review fixes incorporated:**

- ✅ Zod validation on all config reads and writes
- ✅ Module-level singleton — one shared rate-limit map
- ✅ Circuit breaker after 5 consecutive failures
- ✅ Warning burst cap (5/60s) instead of unlimited bypass
- ✅ `.catch(err => logger.warn(...))` instead of swallowing errors
- ✅ Budget dispatch event-driven (cost-write only, not on reads)
- ✅ Correct test pattern (`SYNAPSE_DB_PATH` env var, not `initDb(':memory:')`)
- ✅ `execute()` + `scheduleSave()` in DB helpers
- ✅ `analyticsQueryGet`/`analyticsQueryAll` (exported) not private `queryGet`/`queryAll`
- ✅ Webhook URLs masked in API responses
- ✅ Test endpoint targets only the specified channel
- ✅ `filterRules` removed from v1 (severity-only filtering)
- ✅ Skipped dispatches logged with reason (`rate_limited`, `severity_filtered`, `circuit_open`)
- ✅ 5-second timeout (down from 10s)
- ✅ Shared `postJson` utility (no Slack/Discord duplication)
- ✅ Empty state + loading state + delivery log UI
- ✅ Panel size `max-w-xl` for notification config
- ✅ First-enable consent notice
