# Remote Approval for AI Agents: An Architecture Walkthrough

**How Synapse intercepts, routes, and auto-dismisses Claude Code permission requests from any device on your network.**

---

## The Scenario

You start a big refactoring task in Claude Code. "Migrate every API route from Express 4 to Express 5." Claude gets to work. You walk to the couch.

Ten minutes later, Claude hits a `Bash` command it hasn't been pre-approved for. It shows a permission prompt in the terminal. You're not at the terminal. The session blocks. Thirty minutes later, it times out.

The obvious fix: let users approve from anywhere — a phone, a tablet, another laptop. The less obvious problem: what happens when the user answers locally _and_ has a remote dashboard open? Now you have two interfaces to the same blocking resource, and the one that wasn't used has a stale card.

This post walks through Synapse's architecture for solving both problems.

---

## 1. The Hook System

Claude Code supports **HTTP hooks** — you configure a URL in `.claude/settings.json`, and Claude Code POSTs the hook event JSON directly to that URL. For most hook events (`PreToolUse`, `PostToolUse`, `Stop`, etc.), this is fire-and-forget. But for `PermissionRequest`, Claude Code **blocks and waits for the HTTP response**. The response body contains the decision: allow or deny.

This is the foundation. An HTTP endpoint that receives a blocking request becomes a remote control.

### The Hook Script

For non-blocking events (observability — tool calls, session lifecycle, agent spawning), a lightweight hook script reads JSON from stdin and POSTs it to the server:

```javascript
// hooks/send_event.cjs — no dependencies, fire-and-forget
const controller = new AbortController();
const timer = setTimeout(() => controller.abort(), 3000);

const resp = await fetch(SERVER_URL, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body,
  signal: controller.signal,
});
clearTimeout(timer);
```

3-second timeout, exit 0 regardless. Never blocks Claude Code. This script POSTs to the main Synapse server on port 27246.

### The Permission Hook

For `PermissionRequest`, a separate mechanism is needed. The hook is configured as `"type": "http"` in `.claude/settings.json`, pointing at a **dedicated hook server on a fixed port** (27247). This is a separate Express app from the main API server — a fixed port is required because Claude Code evaluates the hook URL at startup, before dynamic port discovery can run.

Claude Code POSTs the request and **holds the connection open** until the server responds (up to 10 minutes).

The server receives the request and _doesn't respond_. It stores the pending entry, broadcasts a WebSocket message to all connected dashboards, and waits for a human decision:

```typescript
// hookServer.ts — holds response open
app.post('/api/hooks/permission', (req, res) => {
  const id = crypto.randomUUID();
  const timer = setTimeout(() => {
    // Timeout after 30 min → deny
    pending.delete(id);
    res.json({
      hookSpecificOutput: {
        hookEventName: 'PermissionRequest',
        decision: {
          behavior: 'deny',
          message: 'Synapse approval timed out. Re-run the task or approve in terminal.',
        },
      },
    });
  }, PERMISSION_TIMEOUT_MS);

  // Store the held response — do NOT call res.json() yet
  pending.set(id, { res, event: req.body, timer, createdAt: Date.now() });

  // Broadcast to all dashboard clients
  broadcaster.broadcastRaw({
    type: 'pendingPermission',
    data: { id, tool_name: req.body.tool_name, ... },
  });
});
```

When a user taps "Allow" on the dashboard (from any device), the server resolves the held HTTP response:

```typescript
// PUT /api/permissions/:id/decision
entry.res.json({
  hookSpecificOutput: {
    hookEventName: 'PermissionRequest',
    decision: { behavior: 'allow' },
  },
});
```

Claude Code receives the response, unblocks, and continues.

---

## 2. The Deny+Message Trick

Permission requests are straightforward — allow or deny. But Claude Code also has `AskUserQuestion`, which presents multiple-choice questions to the user. How do you relay answers remotely?

The hook API has an important asymmetry:

| Field              | On `"allow"` | On `"deny"`             |
| ------------------ | ------------ | ----------------------- |
| `decision.message` | **Ignored**  | **Forwarded to Claude** |

When you allow a tool, any message you attach is silently discarded. When you deny a tool, the message is injected into Claude's context. This means the only way to pass information back to Claude through the hook system is to **deny** the tool with the answer embedded in the message.

```typescript
// permissions.ts — the relay trick
if (hasAnswers) {
  const answerLines = Object.entries(answers)
    .map(([q, a]) => `Q: ${q}\nA: ${a}`)
    .join('\n\n');

  // Override to "deny" so Claude actually reads the message
  hookDecision.behavior = 'deny';
  hookDecision.message =
    `The user answered this question remotely via the Synapse dashboard. ` +
    `Do NOT re-ask this question. Use these answers and continue:\n\n` +
    answerLines;
}
```

Claude receives the "denial," reads the embedded answers, and continues without re-asking. The denial is the delivery mechanism, not a rejection.

Is this a hack? Absolutely. Does it work reliably? Yes. The key is the instruction prefix: "Do NOT re-ask this question." Without it, some models treat the denial as a signal to retry.

---

## 3. Push Notifications

Standard Web Push via a service worker. When Claude blocks on a permission, the server fires a push notification to all subscribed devices:

```typescript
const title = isQuestion ? `💬 Claude needs your input` : `🔒 Approve ${toolName || 'action'}?`;
const body = isQuestion ? toolInput.slice(0, 120) : `${toolInput.slice(0, 100)}\n⏱ 30m to respond`;

sendToAll({ title, body, requestId: id, url: baseUrl });
```

Your phone buzzes. You tap the notification. The dashboard opens. You tap Allow. Claude continues. Total latency: however fast you can unlock your phone.

---

## 4. The Auto-Dismiss Problem

Everything above works great — until the user answers locally.

Picture this: Claude asks for permission. The dashboard shows a card. A push notification fires. But the user is already at their terminal and types "y" before checking their phone. Claude continues. The dashboard still shows the card. It will sit there for 30 minutes until the timeout fires.

This is a distributed state problem. Two interfaces (terminal + dashboard) to the same blocking resource (the held HTTP response). When one interface resolves it, the other needs to know — but there's no callback from Claude Code saying "the user answered locally."

We solved this with a three-layer defense. Each layer detects "answered locally" through a different signal, and they're independent — any one layer succeeding is sufficient.

### Layer 1: Event Matching

When Claude Code proceeds after a local answer, it fires subsequent hook events — `PostToolUse` (tool completed), `PostToolUseFailure` (tool denied), or `Stop` (session ended). These arrive at the events endpoint as separate HTTP requests. If a pending permission exists for the same `session_id`, it's resolved:

```typescript
// events.ts
const RESOLVE_EVENTS = new Set([
  'PostToolUse', // Tool executed successfully → allow
  'PostToolUseFailure', // Tool was rejected → deny
  'Stop', // Session ended → allow (moot)
]);

function resolveIfSessionAdvanced(raw, broadcaster) {
  if (pending.size === 0) return;

  const hookName = raw.hook_event_name;
  if (!hookName || !RESOLVE_EVENTS.has(hookName)) return;

  const sessionId = raw.session_id;
  if (!sessionId) return;

  for (const [id, entry] of pending) {
    if (entry.event.session_id !== sessionId) continue;

    const behavior = hookName === 'PostToolUseFailure' ? 'deny' : 'allow';
    clearTimeout(entry.timer);
    pending.delete(id);
    entry.res.json({
      /* hook response */
    });
    broadcaster.broadcastRaw({ type: 'permissionResolved', data: { id, behavior } });
  }
}
```

**Why only these events?** Earlier versions resolved on _any_ event, but that caused false dismissals. `PreToolUse` can fire for a different tool while a permission is legitimately pending. `UserPromptSubmit` can flow in multi-turn conversations. Only completion signals prove the blocked tool moved past the permission check.

### Layer 2a: Socket Close Detection

When the user answers locally, Claude Code proceeds and eventually **drops the HTTP connection** to the hook server. The `res.on('close')` event fires:

```typescript
// hookServer.ts
res.on('close', () => {
  const entry = pending.get(id);
  if (!entry) return; // Already resolved by another layer
  clearTimeout(entry.timer);
  pending.delete(id);
  broadcaster.broadcastRaw({ type: 'permissionResolved', data: { id, behavior: 'allow' } });
});
```

This is often the **fastest** layer — it fires the instant Claude Code drops the connection, sometimes before `PostToolUse` even arrives. On Windows, `res.on('close')` can be delayed 10-30s, which is why this isn't the only layer.

### Layer 2b: DB Completion Check

A 2-second polling interval checks every pending permission against the database:

```typescript
// permissionState.ts
connectionMonitor = setInterval(() => {
  for (const [id, entry] of pending) {
    const socketDead = entry.res.socket?.destroyed ?? false;
    const writableEnded = entry.res.writableEnded ?? false;
    const sessionAdvanced = hasCompletionForSessionSince(entry.event.session_id, entry.createdAt);

    if (socketDead || writableEnded || sessionAdvanced) {
      // Resolve and clean up
    }
  }
}, 2000);
```

`hasCompletionForSessionSince()` queries the SQLite database for `tool_end`, `tool_error`, or `stop` events that arrived after the permission was created. This catches the case where Layer 1's event arrived and was stored in the DB, but the pending map wasn't updated (e.g., race condition between the events endpoint and the hook server).

If the socket is still alive but the DB shows completion, it sends the HTTP response before resolving — unblocking Claude Code if it's somehow still waiting.

### Layer 3: Dashboard Adaptive Polling

The dashboard polls `GET /api/permissions/pending` on an adaptive interval:

- **5 seconds** when permission cards are visible (fast sync)
- **30 seconds** when no cards are pending (background safety net)

This is the last resort. If the WebSocket drops, the server restarts, and all server-side layers fail, the dashboard will still self-correct within one poll cycle.

### Why Three Layers?

Each layer compensates for the others' blind spots:

| Scenario                           | Layer 1     | Layer 2a    | Layer 2b    | Layer 3     |
| ---------------------------------- | ----------- | ----------- | ----------- | ----------- |
| PostToolUse arrives normally       | **catches** | catches     | catches     | catches     |
| Socket closes before events arrive | misses      | **catches** | catches     | catches     |
| Socket stays alive (Windows delay) | catches     | misses      | **catches** | catches     |
| Server restarts mid-permission     | misses      | misses      | misses      | **catches** |

No single layer handles every case. Together, they guarantee that a permission card never gets stuck — auto-dismiss latency is under 2 seconds in the common case and under 7 seconds in the worst case (one polling cycle).

---

## The Takeaway

The hard part of building a remote approval system for AI agents isn't the remote approval — that's a held HTTP response and a WebSocket broadcast. The hard part is knowing when remote approval is no longer needed.

When you have two interfaces to the same blocking resource and no callback from the underlying system, you need to infer state from side effects: subsequent events, socket lifecycle, database records, and polling. Each signal is unreliable on its own. Stack them, and you get something robust.

The deny+message trick for `AskUserQuestion` relay is genuinely a hack — using an API's error path as a data channel. But it works, and it's the kind of pragmatic solution that ships products while you wait for the "right" API to exist.

Synapse is open source at [github.com/bkragl/synapse](https://github.com/bkragl/synapse).
