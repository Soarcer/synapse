# Remote Answer Relay — AskUserQuestion via Synapse Dashboard

**Date**: 2026-03-12
**Status**: Validated (live-tested, working)
**Phase**: A (Remote Approval & Prompt Interceptor)

---

## Overview

Synapse enables users to answer Claude's `AskUserQuestion` prompts remotely — from a phone, tablet, or any browser on the LAN — without touching the terminal. Questions appear as interactive cards with tappable options, and selected answers are relayed back to Claude through a **deny + message** protocol trick in the Claude Code Hooks API.

## The Problem

When Claude Code invokes `AskUserQuestion`, it blocks waiting for user input in the terminal. If you're away from your desk — cooking, on the couch, walking around — you can't respond. The agent sits idle until the permission times out (default: 30 minutes).

## The Solution: Deny + Message Relay

### Why "deny + message" and not "allow + message"?

Claude Code's `PermissionRequest` hook has an important asymmetry:

| Field               | On `"allow"`                          | On `"deny"`                        |
| ------------------- | ------------------------------------- | ---------------------------------- |
| `decision.behavior` | Tool proceeds as normal               | Tool is blocked                    |
| `decision.message`  | **Ignored** — not forwarded to Claude | **Forwarded to Claude** as context |

This means the only way to pass information back to Claude through the hook system is to **deny** the tool call with a message. Claude receives the denial message, sees the user's answers, and continues without re-asking.

### The Trick

When a user selects answers on the dashboard and presses "Send Answer":

1. The dashboard sends `behavior: "allow"` + `answers: { ... }` to the server
2. The server **overrides** behavior to `"deny"` and constructs a message containing the answers
3. Claude receives the denial with the answer text and treats it as user input
4. Claude does NOT re-ask the question — the message explicitly instructs it not to

---

## Architecture

### Data Flow

```
┌──────────────┐     PermissionRequest hook     ┌──────────────────┐
│  Claude Code │ ──── POST /api/hooks/permission ──→│  Synapse Server  │
│  (blocked)   │                                    │  (holds response)│
└──────────────┘                                    └────────┬─────────┘
                                                             │ WS broadcast
                                                             ▼
                                                    ┌──────────────────┐
                                                    │  Dashboard (WS)  │
                                                    │  Desktop / Phone │
                                                    └────────┬─────────┘
                                                             │ User taps options
                                                             │ Presses "Send Answer"
                                                             ▼
                                                    ┌──────────────────┐
                                                    │  PUT /api/perms/  │
                                                    │  :id/decision     │
                                                    │  { behavior,      │
                                                    │    answers }      │
                                                    └────────┬─────────┘
                                                             │ Server constructs
                                                             │ deny + message
                                                             ▼
┌──────────────┐     hookSpecificOutput             ┌──────────────────┐
│  Claude Code │ ←── JSON response ─────────────────│  Synapse Server  │
│  (unblocked) │     { behavior: "deny",            │  (resolves held  │
│              │       message: "User answered..." } │   HTTP response) │
└──────────────┘                                    └──────────────────┘
```

### Components

#### 1. Hook Server (`packages/server/src/hookServer.ts`)

Receives the `PermissionRequest` from Claude Code and **holds the HTTP response open** until the user decides.

```typescript
// Claude Code POSTs here and BLOCKS waiting for the response.
app.post('/api/hooks/permission', (req, res) => {
  const id = crypto.randomUUID();
  const timer = setTimeout(() => {
    pending.delete(id);
    res.json({
      hookSpecificOutput: {
        hookEventName: 'PermissionRequest',
        decision: {
          behavior: 'deny',
          message: 'Synapse approval timed out.',
        },
      },
    });
  }, PERMISSION_TIMEOUT_MS); // default: 30 minutes

  pending.set(id, { res, event: req.body, timer, createdAt });

  // Broadcast to all dashboard clients via WebSocket
  broadcaster.broadcastRaw({
    type: 'pendingPermission',
    data: { id, tool_name, tool_input_preview, tool_input_raw, createdAt, expiresAt },
  });
  // res intentionally NOT called — held until decision or timeout
});
```

#### 2. Decision Endpoint (`packages/server/src/routes/permissions.ts`)

When the dashboard user makes a decision, the server resolves the held response:

```typescript
router.put('/:id/decision', (req, res) => {
  const answers = req.body?.answers as Record<string, string> | undefined;
  const hasAnswers = answers && Object.keys(answers).length > 0;

  const hookDecision: Record<string, unknown> = { behavior };

  if (hasAnswers) {
    // THE KEY TRICK: override to "deny" so Claude sees the message
    hookDecision.behavior = 'deny';
    hookDecision.message =
      `The user answered this question remotely via the Synapse dashboard. ` +
      `Do NOT re-ask this question. Use these answers and continue:\n\n` +
      Object.entries(answers)
        .map(([q, a]) => `Q: ${q}\nA: ${a}`)
        .join('\n\n');
  }

  // Resolve the held hook response back to Claude Code
  entry.res.json({
    hookSpecificOutput: {
      hookEventName: 'PermissionRequest',
      decision: hookDecision,
    },
  });
});
```

#### 3. Permission Store (`apps/dashboard/src/store/permissionStore.ts`)

Zustand store managing pending/resolved permissions with:

- **Deduplication**: `addPending` skips if ID already exists
- **Merge hydration**: Won't re-add already-resolved items on reconnect
- **Error tracking**: Network failures show retry UI instead of silent resolution
- **Answer passthrough**: `approve(id, answers?)` sends answers alongside behavior

```typescript
approve: async (id, answers) => {
  const payload: Record<string, unknown> = { behavior: 'allow' };
  if (answers && Object.keys(answers).length > 0) {
    payload.answers = answers;
  }
  const res = await fetch(apiUrl(`/api/permissions/${id}/decision`), {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (res.ok || res.status === 404) {
    get().resolvePending(id, 'allow');
  }
},
```

#### 4. AskUserQuestion Card (`apps/dashboard/src/components/permissions/PermissionApprovalCard.tsx`)

The dashboard renders tool-specific cards based on `tool_name`:

- **`AskUserQuestion`** → Interactive card with tappable options, radio/checkbox selection, tab bar for multi-question prompts
- **Everything else** → Generic permission card with tool name, input preview, approve/deny buttons

The `AskUserQuestionCard` component:

- Parses the raw `tool_input` to extract `questions[]` with `options[]`
- Tracks selections per question via `useState<Record<number, Set<number>>>`
- Supports both single-select (radio) and multi-select (checkbox)
- Builds an answers map: `{ "question text": "selected label(s)" }`
- Disables "Send Answer" until all questions are answered
- Shows a countdown timer (turns red under 60 seconds)

#### 5. Mobile Rendering

iOS Safari breaks `position: fixed` inside elements with `overflow: hidden` + fixed html/body. Solution: `createPortal` renders `PermissionPanel` directly into `document.body`, escaping all clipping ancestors.

```tsx
function MobilePermissionPortal() {
  return createPortal(<PermissionPanel mobile />, document.body);
}
```

---

## Wire Format

### WebSocket: `pendingPermission` (server → dashboard)

```json
{
  "type": "pendingPermission",
  "data": {
    "id": "a1b2c3d4-...",
    "tool_name": "AskUserQuestion",
    "tool_input_preview": "{\"questions\":[{\"question\":\"Pick your favo...",
    "tool_input_raw": {
      "questions": [
        {
          "question": "Pick your favorite color for testing:",
          "header": "Color",
          "options": [
            { "label": "Blue", "description": "Cool and calm" },
            { "label": "Green", "description": "Fresh and natural" },
            { "label": "Orange", "description": "Warm and energetic" }
          ],
          "multiSelect": false
        }
      ]
    },
    "createdAt": 1741795200000,
    "expiresAt": 1741797000000
  }
}
```

### PUT `/api/permissions/:id/decision` (dashboard → server)

```json
{
  "behavior": "allow",
  "answers": {
    "Pick your favorite color for testing:": "Green"
  }
}
```

### Hook Response (server → Claude Code)

```json
{
  "hookSpecificOutput": {
    "hookEventName": "PermissionRequest",
    "decision": {
      "behavior": "deny",
      "message": "The user answered this question remotely via the Synapse dashboard. Do NOT re-ask this question. Use these answers and continue:\n\nQ: Pick your favorite color for testing:\nA: Green"
    }
  }
}
```

---

## Live Test Results (2026-03-12)

### Test 1: Single-question card

Claude asked: _"Pick your favorite color for testing the answer relay"_

User selected **Green** from the dashboard. Claude received:

```
Q: Pick your favorite color for testing the answer relay:
A: Green
```

Result: Claude acknowledged the answer and continued without re-asking.

### Test 2: Multi-question celebration card

Claude sent 3 questions simultaneously:

| #   | Question                                                                             | Header     | User's Answer        |
| --- | ------------------------------------------------------------------------------------ | ---------- | -------------------- |
| 1   | "How does it feel to approve Claude from your phone while walking around the house?" | Vibe check | **All of the above** |
| 2   | "What's the most ridiculous place you'd approve a permission request from?"          | Location   | **The toilet**       |
| 3   | "Rate Synapse's remote approval feature:"                                            | Rating     | **Mind = blown**     |

All 3 answers relayed correctly in a single response. Claude received:

```
Q: How does it feel to approve Claude from your phone while walking around the house?
A: All of the above

Q: What's the most ridiculous place you'd approve a permission request from?
A: The toilet

Q: Rate Synapse's remote approval feature:
A: Mind = blown
```

Result: Full multi-question round-trip confirmed working over LAN to iOS Safari.

### Test 3: Plain deny

User pressed "Deny" (not "Send Answer"). Claude received a standard denial with no message. Confirmed working.

---

## Card States

```
┌─────────────────────┐
│   PENDING            │ ← Live countdown, interactive options
│   [30:00 remaining]  │
│                      │
│   ○ Option A         │
│   ● Option B (sel)   │
│   ○ Option C         │
│                      │
│   [Deny] [Send Ans]  │
└─────────────────────┘
         │
         ├── User taps "Send Answer" ──→ RESOLVED (answers relayed)
         ├── User taps "Deny" ──────────→ RESOLVED (plain deny)
         └── Timer hits 0:00 ──────────→ EXPIRED
                                          ┌─────────────────────┐
                                          │   EXPIRED            │
                                          │   Permission Request │
                                          │   Timed out — Claude │
                                          │   denied and fell    │
                                          │   back to terminal.  │
                                          │          [Dismiss]   │
                                          └─────────────────────┘
```

---

## Known Limitations

1. **Race condition with VS Code UI**: If Claude Code's built-in permission prompt is visible in the terminal, the user might answer there first, making the dashboard card stale (resolves as 404).

2. **deny + message is a hack**: Claude "sees" the answer as a denial message, not as structured tool output. It works because Claude is instructed to treat the message as user input. A future Claude Code API could support `allow` + structured answer passthrough.

3. **Hydration on refresh**: After page refresh, permission cards may briefly show `[object Object]` if `tool_input_raw` isn't properly serialized during hydration. (Known bug, tracked separately.)

4. **Mobile WS flakiness**: iOS Safari over LAN WiFi occasionally drops WebSocket connections. The dashboard auto-reconnects (exponential backoff, max 20 retries), but there's a brief "Reconnecting" state.

---

## Hook Configuration

The `PermissionRequest` hook in `.claude/settings.local.json` must use the **HTTP hook** format (not just `command`):

```json
{
  "PermissionRequest": [
    {
      "hooks": [
        {
          "type": "command",
          "command": "node \"path/to/hooks/send_event.cjs\"",
          "async": true
        }
      ]
    }
  ]
}
```

The hook server listens on port 27247 (separate from the main API server on 27246) and accepts the permission request at `POST /api/hooks/permission`.

---

## File Map

| File                                                                   | Role                                         |
| ---------------------------------------------------------------------- | -------------------------------------------- |
| `packages/server/src/hookServer.ts`                                    | Hook HTTP server, holds permission responses |
| `packages/server/src/routes/permissions.ts`                            | Decision endpoint, deny+message construction |
| `packages/server/src/state/permissionState.ts`                         | In-memory pending/decision maps              |
| `apps/dashboard/src/store/permissionStore.ts`                          | Zustand store, WS handler, hydration         |
| `apps/dashboard/src/components/permissions/PermissionApprovalCard.tsx` | Card UI (AskUserQuestion + Generic)          |
| `apps/dashboard/src/components/permissions/PermissionPanel.tsx`        | Positioning layer (fixed/absolute)           |
| `apps/dashboard/src/components/mobile/MobileView.tsx`                  | Portal rendering for iOS                     |
| `.claude/settings.local.json`                                          | Hook configuration                           |
