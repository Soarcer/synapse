# Remote Dev Loop — MVP Design (Single-Call Pattern)

**Date:** 2026-03-13
**Status:** Approved
**Author:** Bernhard + Claude
**Supersedes:** Phase 1 section of `2026-03-13-remote-dev-loop-design.md` (two-call pattern replaced with single-call)

---

## Problem

You're on your phone, Claude Code is running on your PC. You want to type "change the background to blue" and have Claude do it. Anthropic's `claude remote-control` does this but is locked to `claude.ai/code`. Synapse should offer a LAN-first alternative using its existing permission relay infrastructure.

## Solution

A single-call AskUserQuestion loop (via a `/remote-dev` skill) paired with a dedicated chat UI on the mobile dashboard. No server changes needed — the existing deny+message relay handles everything.

### Why Single-Call (not Two-Call)

The original spec used two AskUserQuestion calls per iteration (status report + prompt). Single-call is better because:

- **Half the overhead:** One HTTP round-trip, one WS broadcast, one permission entry per iteration instead of two
- **No auto-dismiss races:** Two-call required auto-sending "OK" to the status card before the prompt card arrived — fragile on slow mobile connections
- **V2 alignment:** When Phase 2 adds `claude -p --resume`, each turn is naturally one interaction. Single-call maps 1:1, making the transport swap trivial

Status reports are embedded in the question text using a `---` separator. The chat skin splits on it.

---

## Architecture

### Overview

```
Claude Code (PC)                    Synapse Server              Dashboard (Phone)
      │                                  │                            │
      │  AskUserQuestion                 │                            │
      │  (metadata.source: remote-dev)   │                            │
      ├─── POST /api/hooks/permission ──→│                            │
      │    (blocked, waiting)            │── WS: pendingPermission ──→│
      │                                  │                            │ Route to remoteDevStore
      │                                  │                            │ (not permissionStore)
      │                                  │                            │
      │                                  │                            │ User types "make it blue"
      │                                  │                            │
      │                                  │←── PUT /api/permissions/   │
      │                                  │    {behavior:allow,        │
      │                                  │     answers:{Q: text}}     │
      │                                  │                            │
      │←── deny + message ──────────────│                            │
      │    (contains user's answer)      │── WS: permissionResolved ─→│
      │                                  │                            │
      │  Executes instruction...         │                            │
      │  (hook events stream to graph)   │── WS: agent events ──────→│
      │                                  │                            │
      │  AskUserQuestion (next iter)     │                            │
      └─── POST /api/hooks/permission ──→│          ...repeat         │
```

### Components

| #   | Component           | Type                | Purpose                                       |
| --- | ------------------- | ------------------- | --------------------------------------------- |
| 1   | `/remote-dev` skill | Markdown file       | AskUserQuestion loop with single-call pattern |
| 2   | WS routing logic    | Modify App.tsx      | Route remote-dev questions to remoteDevStore  |
| 3   | `remoteDevStore.ts` | New Zustand store   | Chat messages, pending question, status       |
| 4   | `RemoteDevChat.tsx` | New component       | Chat UI with quick actions and text input     |
| 5   | MobileTabBar entry  | Modify MobileTabBar | 4th "Dev" tab with waiting badge              |

**No server changes required.**

---

## Component Details

### 1. `/remote-dev` Skill

**File:** `.claude/commands/remote-dev.md`

A custom slash command that puts Claude into a remote dev loop. Claude calls AskUserQuestion once per iteration with:

```
question: "{status summary}\n---\nWhat's next?"
metadata: { source: "remote-dev" }
options: [Run tests, Build, Commit, Git status] + Other (free-text)
```

**Loop structure:**

```
Loop:
  1. Execute the user's instruction (skip on first iteration)
  2. Call AskUserQuestion — single call:
     - First iteration: question is just "What's next?"
     - Subsequent: "{what Claude did}\n---\nWhat's next?"
     - metadata: { source: "remote-dev" }
     - options: [Run tests, Build, Commit, Git status, Other]
  3. If answer contains "exit"/"stop"/"done" → break
  4. If timeout (deny without answer) → re-ask silently
  5. Go to step 1
```

**Separator convention:** `---` (markdown horizontal rule) splits status from prompt. Everything before `---` is Claude's report on what it did. Everything after is the question for the user. The chat skin parses on this using `indexOf('\n---\n')` to find the **first** occurrence, then splits into two parts. This avoids ambiguity if `---` appears multiple times.

**Skill instruction:** The skill explicitly tells Claude: "Do not use `---` (horizontal rule) inside your status report — it is reserved as the separator between your report and the prompt."

**Context burn mitigation:** Claude Code auto-compacts when approaching context limits. The skill keeps status reports concise. For long sessions (15+ prompts), Claude summarizes prior work rather than listing every change.

**Exit conditions:** User types "exit", "stop", or "done". Also exits if Claude detects the task is complete and confirms with the user.

### 2. WS Routing

**File:** `apps/dashboard/src/store/agentStore.ts` (inside the `wsClient.setOnEvent` handler, ~line 936-940)

The routing intercept must be placed **before** both the toast and `handlePermissionWsMessage()` call, because both currently fire unconditionally for all `pendingPermission` messages.

**Detection helper** (shared by both `pendingPermission` and hydration paths):

```typescript
function isRemoteDev(data: { tool_name?: string; tool_input_raw?: unknown }): boolean {
  const raw = data.tool_input_raw as Record<string, unknown> | undefined;
  if (raw?.metadata && (raw.metadata as Record<string, unknown>)?.source === 'remote-dev')
    return true;
  // Fallback: check header field in case metadata is stripped
  const questions = raw?.questions as Array<{ header?: string }> | undefined;
  return questions?.[0]?.header === 'Remote';
}
```

**`pendingPermission` routing:**

```typescript
if (msg.type === 'pendingPermission') {
  if (isRemoteDev(msg.data)) {
    remoteDevStore.getState().receiveQuestion(msg.data);
    return; // Skip toast + permission store entirely
  }
  // Existing: toast + handlePermissionWsMessage(msg)
}
```

**`permissionResolved` routing:**

```typescript
if (msg.type === 'permissionResolved') {
  const devStore = remoteDevStore.getState();
  if (devStore.pendingQuestion?.id === msg.data.id) {
    devStore.resolveQuestion();
    return; // Skip permission store
  }
  // Existing: handlePermissionWsMessage(msg)
}
```

**Hydration on reconnect:** The existing `hydratePermissions()` fetches `GET /api/permissions/pending` and passes all results to `permissionStore.hydrate()`. This must be updated to pre-filter: items where `isRemoteDev(item)` is true go to `remoteDevStore.receiveQuestion()` instead. This prevents remote-dev questions from appearing as permission cards after a page refresh or WS reconnect.

### 3. `remoteDevStore.ts`

**File:** `apps/dashboard/src/store/remoteDevStore.ts`

```typescript
interface ChatMessage {
  id: string;
  role: 'user' | 'claude';
  text: string;
  timestamp: number;
  isError?: boolean; // Red styling for error messages
}

type RemoteDevStatus = 'idle' | 'waiting' | 'working';

interface RemoteDevState {
  messages: ChatMessage[];
  pendingQuestion: PendingSummary | null;
  quickActions: string[];
  status: RemoteDevStatus;

  // Actions
  receiveQuestion: (data: PendingSummary) => void;
  sendAnswer: (text: string) => Promise<void>;
  resolveQuestion: () => void;
  clear: () => void;
}
```

**`receiveQuestion(data)`:**

1. Parse `tool_input_raw` to extract question text
2. Find first `\n---\n` via `indexOf` and split into two parts (status + prompt). If no separator found, treat entire text as the prompt (no status message).
3. If status text exists, push as `{ role: 'claude' }` message
4. Check if status text matches `/error|failed/i` → set `isError: true`
5. Extract options from `tool_input_raw.questions[0].options` → `quickActions`
6. Set `pendingQuestion = data`
7. Set `status = 'waiting'`

**`sendAnswer(text)`:**

1. Push `{ role: 'user', text }` message
2. Set `status = 'working'`
3. `PUT /api/permissions/${pendingQuestion.id}/decision` with `{ behavior: 'allow', answers: { ... } }`
   - **Answer key format is TBD** — must be verified empirically before implementation (see "Answer Key Format" section). The key must match what Claude Code expects when processing the deny+message relay. Use the same pattern as `permissionStore.approve()` which already works for standard AskUserQuestion cards.
4. **Error recovery:** If the PUT fails (network error, 404 already-resolved, server down):
   - Revert `status` to `'waiting'`
   - Re-enable the input box
   - Mark the last user message with `isError: true` and append " (failed to send)" to its text
   - Log the error for debugging

**`resolveQuestion()`:**

1. Set `pendingQuestion = null`
2. (Status stays `working` until next `receiveQuestion` or timeout)

**No persistence:** Chat history is ephemeral — cleared on page refresh. V2 can add persistence if needed.

### 4. `RemoteDevChat.tsx`

**File:** `apps/dashboard/src/components/mobile/RemoteDevChat.tsx`

**Layout:**

```
┌─────────────────────────────┐
│  Remote Dev        [status] │  Header + status badge
├─────────────────────────────┤
│                             │
│  🤖 Modified Layout.tsx —   │  Claude message (status text)
│  added sticky header.       │
│  All 47 tests pass.         │
│                             │
│  👤 make the footer sticky  │  User message
│     too                     │
│                             │
│  ⏳ Working...              │  Pulsing indicator (working)
│                             │
├─────────────────────────────┤
│ [Run tests] [Build] [Commit]│  Quick actions (from options)
├─────────────────────────────┤
│ Type instruction...      [→]│  Text input + send
└─────────────────────────────┘
```

**Behavior:**

- Auto-scroll to bottom on new messages
- Quick action buttons call `sendAnswer(label)` directly
- Text input sends on Enter or send button tap
- Input disabled when `status !== 'waiting'`
- Empty state (idle + no messages): "Run `/remote-dev` in a Claude Code session to start"
- Error messages: red/warning border on Claude message bubble when `isError` is true

**Styling:** Dark theme consistent with existing mobile components. Message bubbles left-aligned (Claude) and right-aligned (user). Compact — no avatars, just role color differentiation.

### 5. MobileTabBar + Badge

**File:** `apps/dashboard/src/components/mobile/MobileTabBar.tsx`

Add 4th tab:

```typescript
{ id: 'dev', label: 'Dev', icon: '⌘' }
```

**Tab order:** Graph | Lenses | Stats | Dev

**Badge:** When `remoteDevStore.status === 'waiting'`, show a pulsing amber dot on the Dev tab icon (same style as Graph's connection dot, but amber to indicate "needs attention").

**File:** `apps/dashboard/src/components/mobile/MobileView.tsx`

Add the Dev tab content:

```typescript
{activeTab === 'dev' && <RemoteDevChat />}
```

Update `MobileTab` type to include `'dev'`.

---

## Push Notification Integration

No changes needed. Remote-dev questions are still `AskUserQuestion` permission requests, so the existing push flow fires:

1. Hook server receives `AskUserQuestion` → formats as `💬 Claude needs your input`
2. Web push notification sent to all subscriptions
3. User taps notification → PWA opens → user navigates to Dev tab

**Note:** The push notification body currently shows `toolInput.slice(0, 120)` where `toolInput` is the stringified `tool_input` object. For AskUserQuestion, this will be raw JSON (`{"question":"Modified Layout.tsx...`), not a clean status summary. This is acceptable for MVP — a future server improvement could extract the question text from AskUserQuestion's `tool_input` before building the push body for a polished notification.

---

## Answer Key Format

**Open question:** When a user selects "Other" and types custom text in AskUserQuestion, how does Claude Code key the answer? The deny+message relay constructs `Q: {key}\nA: {value}` — the key must match what Claude expects.

**Must verify empirically before building the chat skin.** Test by:

1. Running AskUserQuestion manually with options + Other
2. Selecting Other, typing custom text
3. Inspecting the hook payload to see the answer key format

The chat skin's `sendAnswer()` must use the verified key format.

---

## Timeout Handling

- AskUserQuestion timeout defaults to 30 minutes (`SYNAPSE_PERMISSION_TIMEOUT_MS`)
- On timeout, Claude receives a denial → skill catches it and re-asks silently
- Dashboard: `status` stays `working` during the re-ask gap. When new `pendingPermission` arrives, auto-replaces the old one (no stale cards)
- **Race guard:** `receiveQuestion()` always replaces `pendingQuestion` — if a timeout re-ask arrives while a previous question is still showing, the new one wins

---

## Testing Strategy

**Unit tests (Vitest):**

- `remoteDevStore.test.ts` — receiveQuestion parsing, sendAnswer flow, status transitions, error detection, separator splitting
- `RemoteDevChat.test.tsx` — renders messages, quick actions trigger sendAnswer, input disabled when not waiting, empty state shown when idle

**Manual E2E test:**

1. Start Synapse server + dashboard on PC
2. Open dashboard on phone (Dev tab)
3. Run `/remote-dev` in a Claude Code session
4. Verify: first question appears as chat prompt on phone
5. Type an instruction → verify Claude executes it
6. Verify: status report appears as Claude message, new prompt appears
7. Tap a quick action → verify it sends
8. Verify: push notification fires when question arrives
9. Test timeout: wait 30min → verify re-ask arrives cleanly

---

## Files to Create/Modify

| File                                                                    | Action | Purpose                                            |
| ----------------------------------------------------------------------- | ------ | -------------------------------------------------- |
| `.claude/commands/remote-dev.md`                                        | Create | `/remote-dev` slash command — AskUserQuestion loop |
| `apps/dashboard/src/store/remoteDevStore.ts`                            | Create | Chat state, question parsing, answer relay         |
| `apps/dashboard/src/store/__tests__/remoteDevStore.test.ts`             | Create | Store unit tests                                   |
| `apps/dashboard/src/components/mobile/RemoteDevChat.tsx`                | Create | Chat UI component                                  |
| `apps/dashboard/src/components/mobile/__tests__/RemoteDevChat.test.tsx` | Create | Component tests                                    |
| `apps/dashboard/src/components/mobile/MobileTabBar.tsx`                 | Modify | Add "Dev" tab + waiting badge                      |
| `apps/dashboard/src/components/mobile/MobileView.tsx`                   | Modify | Render RemoteDevChat in Dev tab                    |
| `apps/dashboard/src/App.tsx`                                            | Modify | Route remote-dev WS messages to remoteDevStore     |

---

## V2 Migration Path

When Phase 2 adds `claude -p --resume` backend:

1. Add `RemoteDevTransport` interface to `remoteDevStore.ts`
2. MVP transport: sends answers via `PUT /api/permissions/:id/decision` (current)
3. V2 transport: `POST /api/remote/sessions/:id/prompt` + WS streaming
4. Server exposes `/api/remote/status` capability endpoint
5. Store auto-detects V2 availability and switches transport
6. Same chat component, swappable backend — no UI changes needed

---

## Open Questions

1. **Answer key format** — must verify empirically (see section above)
2. **Quick action customization** — hardcoded for MVP, could add settings later
3. **Desktop UI** — MVP is mobile-only. Desktop users have the terminal. Defer desktop panel.
4. **Session indicator** — should the Dev tab show which Claude session is in remote-dev mode? Defer to V2.
