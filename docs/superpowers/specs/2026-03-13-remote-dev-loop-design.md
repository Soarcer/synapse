# Remote Dev Loop — Design Spec

**Date:** 2026-03-13
**Status:** Approved
**Author:** Bernhard + Claude

## Problem

You're on your phone, Claude Code is running on your PC. You want to type "change the background to blue" and have Claude do it — full remote development from any device. Anthropic's `claude remote-control` does this but is locked to `claude.ai/code` and their mobile app. Synapse should offer a LAN-first alternative that integrates with its existing graph, permissions, and analytics.

## Solution

A two-phase approach: an AskUserQuestion-based polling loop (MVP) that ships fast using existing infrastructure, followed by a `claude -p --resume` backend (V2) that adds session management, streaming output, and phone-initiated sessions. Both phases share the same dashboard chat UI.

## Phase 1: MVP — AskUserQuestion Loop

### How It Works

1. User starts a Claude Code session on their PC and runs `/remote-dev` (a superpowers skill)
2. Claude enters a loop, calling `AskUserQuestion` with quick-action options + free-text "Other"
3. Dashboard detects the remote-dev question via `tool_input_raw.metadata.source === "remote-dev"` (the hook server broadcasts the full `tool_input` as `tool_input_raw` in the `pendingPermission` WS message) and renders it as a chat interface instead of a permission card
4. User types a prompt or taps a quick action on their phone
5. Answer relays via the existing deny+message protocol
6. Claude receives the instruction, executes it (hook events stream to phone's graph view in real-time)
7. Claude calls AskUserQuestion again — loop repeats

### Components

#### 1. `/remote-dev` Skill

A superpowers skill file that puts the session into remote dev mode:

<!-- revised: structured question format for response extraction + compact fix + answer key verification -->

The skill uses a two-call pattern per loop iteration:

```
Loop:
  1. Execute the user's instruction (skip on first iteration)

  2. Call AskUserQuestion #1 — "status report" (informational):
     - question: structured response with delimiters:
       "REMOTE_DEV_RESPONSE_START\n{what Claude did, including files changed and outcome}\nREMOTE_DEV_RESPONSE_END"
     - header: "RemoteStatus"
     - metadata: { source: "remote-dev", type: "status" }
     - options: [{ label: "OK", description: "Acknowledged" }]
     Dashboard intercepts this, extracts text between delimiters, renders as Claude's chat message.
     The user doesn't interact — dashboard auto-sends "OK" immediately.

  3. Call AskUserQuestion #2 — "prompt" (waits for user):
     - question: "What's next?"
     - header: "Remote"
     - metadata: { source: "remote-dev", type: "prompt" }
     - options: [Run tests, Build, Commit, Status] + Other (free-text)
     Dashboard renders this as the input box + quick-action buttons.

  4. If timeout → re-ask (continue loop)
  5. If answer is "exit"/"stop"/"done" → break
  6. Go to step 1
```

**Answer key format (must verify empirically before building):**
The "Other" free-text answer key format needs testing. When a user selects "Other" and types custom text, verify whether Claude Code keys the answer by the question text verbatim, or uses a different format. Test by running AskUserQuestion manually and inspecting the hook payload. Document the verified format in the implementation.

**Context burn mitigation:** Claude Code auto-compacts when approaching context limits. The skill should NOT attempt to call `/compact` programmatically (slash commands are not tool-callable). Instead, keep prompts concise and rely on built-in auto-compaction. For long sessions (15+ prompts), the skill can instruct Claude to summarize prior work in the next status report.

#### 2. Dashboard Chat Skin (Mobile Component)

<!-- revised: two-message handling, working state, auto-dismiss, error styling -->

When `pendingPermission` arrives with `tool_name === "AskUserQuestion"` and `tool_input_raw.metadata?.source === "remote-dev"` (metadata is part of the AskUserQuestion schema and flows through the hook server's `tool_input_raw` field in the WS broadcast):

- Do NOT render as a permission card
- Render as a chat interface in the Remote Dev panel
- **Status messages** (`metadata.type === "status"`): Extract text between `REMOTE_DEV_RESPONSE_START` / `REMOTE_DEV_RESPONSE_END` delimiters in the question text. Render as Claude's chat message. Auto-send "OK" answer immediately (no user interaction needed).
- **Prompt messages** (`metadata.type === "prompt"`): Show input box + quick-action buttons. User's typed message sends as the "Other" answer. Quick-action button taps send the corresponding option label.
- **Working state:** After sending an answer, show a pulsing "Working..." indicator in the chat. Clear it when the next remote-dev `pendingPermission` arrives.
- **Auto-dismiss stale:** When a new remote-dev `pendingPermission` arrives, auto-dismiss any previous unresolved remote-dev permission (handles timeout re-ask race).
- **Error styling:** If Claude's status response contains "error", "failed", or "Error:" (case-insensitive), render the chat message with a red/warning style.

#### 3. No Server Changes

The existing deny+message relay in `packages/server/src/routes/permissions.ts` handles everything. No new endpoints needed for MVP.

### Data Flow

<!-- revised: two-call pattern reflected in data flow -->

```
1. Claude calls AskUserQuestion (status report, metadata.type="status"):
   → Dashboard receives pendingPermission via WS
   → Extracts response text between REMOTE_DEV_RESPONSE_START/END delimiters
   → Renders as Claude's chat message
   → Auto-sends "OK" answer → Server relays deny+message → Claude continues

2. Claude calls AskUserQuestion (prompt, metadata.type="prompt"):
   → Dashboard receives pendingPermission via WS
   → Renders input box + quick-action buttons
   → User types "make header sticky" and taps send

3. Dashboard PUTs to /api/permissions/:id/decision with:
   { behavior: "allow", answers: { "What's next?": "make header sticky" } }
   → Server constructs deny+message (packages/server/src/routes/permissions.ts lines 73-86):
     { behavior: "deny", message: "The user answered... Q: What's next?\nA: make header sticky" }
   → Claude receives denial with answer in message field

4. Claude executes instruction (hook events stream to dashboard via WebSocket)
   → Dashboard shows "Working..." indicator
   → Graph tab shows tool nodes appearing live

5. Claude calls AskUserQuestion (status report) → back to step 1
```

**Answer format detail:** The `answers` object is keyed by question text. For quick-action buttons, the answer value is the option label (e.g., `"Run tests"`). For free-text "Other" input, the answer value is whatever the user typed. The exact key format for "Other" answers must be verified empirically before implementation (see skill component above).

### Identifying Remote Dev Questions

The dashboard distinguishes remote-dev AskUserQuestions from normal ones using:

- Primary: `tool_input_raw.metadata?.source === "remote-dev"` — the AskUserQuestion schema supports a `metadata` field, and the hook server includes the full tool input as `tool_input_raw` in the WS broadcast
- Fallback: Check if `tool_input_raw.questions?.[0]?.header === "Remote"` — works even if metadata is stripped

<!-- revised: removed /compact reference, rely on auto-compaction -->

### Context Burn Mitigation

- Claude Code auto-compacts when approaching context limits — no manual intervention needed
- For typical mobile sessions (5-15 prompts), context burn is negligible
- For long sessions, the skill instructs Claude to keep status reports concise and summarize prior work
- User can explicitly say "summarize and compact" as an instruction to trigger manual compaction

<!-- revised: added auto-dismiss for timeout race condition -->

### Timeout Handling

- AskUserQuestion timeout defaults to 30 minutes (configurable via `SYNAPSE_PERMISSION_TIMEOUT_MS`)
- On timeout, Claude receives a denial message
- Skill catches the timeout and re-asks immediately (silent re-loop)
- Dashboard shows no visible timeout — the chat input stays available
- **Race condition guard:** When a timeout triggers a re-ask, the old permission expires and a new `pendingPermission` arrives. The dashboard auto-dismisses any previous remote-dev permission when a new one arrives (see Chat Skin component above), preventing duplicate cards.

---

## Phase 2: V2 — `claude -p --resume` Backend

### How It Works

1. Dashboard has a proper Remote Dev panel with session management
2. User picks an existing session or creates a new one
3. User types a prompt → POSTs to `/api/remote/sessions/:id/prompt`
4. Server spawns `claude` via `child_process.spawn()` with args array (never a shell string — avoids injection from user prompt text)
5. stdout JSON chunks stream to dashboard via WebSocket
6. Process exits → session returns to idle, ready for next prompt

### New Server Components

#### 1. Remote Dev Session Manager (`packages/server/src/services/remoteDevManager.ts`)

```typescript
interface RemoteSession {
  id: string; // Synapse-generated UUID
  claudeSessionId?: string; // Claude's session_id (captured from first run output)
  name: string; // User-provided or auto-generated
  status: 'idle' | 'running' | 'error';
  cwd: string; // Working directory for the session
  createdAt: number;
  lastPromptAt: number;
  promptCount: number;
  process?: ChildProcess; // Active CLI process (null when idle)
}
```

**Methods:**

- `createSession(cwd, name?)` → creates session record, returns ID
- `sendPrompt(sessionId, prompt)` → spawns CLI process, streams output
- `listSessions()` → returns all sessions with status
- `killSession(sessionId)` → kills active process if running, removes session
- `getSession(sessionId)` → single session details

<!-- revised: session TTL for garbage collection -->

**Session Discovery:**
Sessions started normally in terminals are detected via SessionStart hook events. The manager can list these as "attachable" sessions. When the user sends a prompt, the manager uses `--resume` with the Claude session ID captured from hook data.

**Session TTL:** Sessions idle for >24 hours are auto-removed from the list. An interval timer checks every hour. Sessions with `status === 'running'` are never auto-removed.

#### 2. API Routes (`packages/server/src/routes/remoteDev.ts`)

| Method   | Path                              | Purpose                             |
| -------- | --------------------------------- | ----------------------------------- |
| `GET`    | `/api/remote/sessions`            | List all remote sessions            |
| `POST`   | `/api/remote/sessions`            | Create new session `{ cwd, name? }` |
| `POST`   | `/api/remote/sessions/:id/prompt` | Send prompt `{ prompt }`            |
| `GET`    | `/api/remote/sessions/:id`        | Get session details                 |
| `DELETE` | `/api/remote/sessions/:id`        | Kill and remove session             |

#### 3. WebSocket Messages

```typescript
// Server → Dashboard (new message types)
{ type: 'remoteDevOutput', data: { sessionId: string, chunk: StreamJsonChunk } }
{ type: 'remoteDevStatus', data: { sessionId: string, status: 'idle' | 'running' | 'error', message?: string } }

// StreamJsonChunk follows Claude's --output-format stream-json schema:
// { type: 'system' | 'assistant' | 'result', subtype?: string, ... }
```

<!-- revised: spawn() with args array, concurrency guard, session TTL -->

#### 4. Process Lifecycle

```
User sends prompt
  → Manager checks session status (must be 'idle')
  → If status is 'running' → return 409 Conflict ("Session is busy")
  → Spawns via child_process.spawn('claude', ['-p', '--resume', sessionId, '--output-format', 'stream-json', prompt])
     (argument array, NOT shell string — prevents injection from user prompt text)
  → Status → 'running'
  → stdout chunks → WS broadcast as 'remoteDevOutput'
  → Process exits (code 0) → Status → 'idle'
  → Process exits (non-zero) → Status → 'error' + error message
  → Ready for next prompt
```

**Concurrency:** Only one prompt per session at a time. If `status === 'running'`, the prompt endpoint returns `409 Conflict`. Dashboard shows "Claude is working..." and disables the send button until `remoteDevStatus` with `status: 'idle'` arrives.

**First prompt (no session yet):**

```bash
claude -p --output-format stream-json "prompt"
```

Captures `session_id` from the first `{ type: "system", subtype: "init" }` chunk.

**Subsequent prompts:**

```bash
claude -p --resume <captured_session_id> --output-format stream-json "prompt"
```

**Startup overhead:** ~12 seconds per prompt (CLI process startup). Dashboard shows a "Thinking..." state during this.

---

## Shared Dashboard UX (Both Phases)

### Mobile Chat Interface

```
┌─────────────────────────────┐
│  Remote Dev          [⋮]   │  ← Session name + menu
├─────────────────────────────┤
│                             │
│  You: make header sticky    │  ← Chat history
│  Claude: Done. Added        │
│  position: sticky to the    │
│  header in Layout.tsx       │
│                             │
│  You: now run tests         │
│  Claude: All 47 tests pass  │
│                             │
├─────────────────────────────┤
│ [Run tests] [Build] [Commit]│  ← Quick actions (configurable)
├─────────────────────────────┤
│ [🎤] Type instruction...  [→]│  ← Input with voice + send
└─────────────────────────────┘
```

<!-- revised: resolved entry point decision -->

### Entry Point

- **Mobile:** New "Dev" tab alongside Graph / Lenses / Analytics (consistent with existing tab navigation; FAB considered but deferred — conflicts with graph touch interactions)
- **Desktop:** Collapsible side panel (low priority — desktop users have the terminal)

### Quick Actions

Default set: Run tests, Build, Commit, Git status. Configurable — user can add custom actions (Deploy, Lint, Start server, etc.).

### Graph Integration

While Claude works, the user can swipe to the Graph tab to see tool nodes appearing live. The chat shows a compact "Working..." indicator. When done, the response appears in chat.

### Transport Abstraction

The chat component uses a transport interface:

```typescript
interface RemoteDevTransport {
  sendPrompt(text: string): Promise<void>;
  onResponse(callback: (text: string) => void): void;
  isReady(): boolean;
}
```

- **MVP transport:** Sends "Other" answer to pending AskUserQuestion permission
- **V2 transport:** POSTs to `/api/remote/sessions/:id/prompt`, subscribes to WS stream

Same chat component, swappable backend.

---

## Migration Path

1. **Ship MVP:** Skill file + chat skin + AskUser transport. Works immediately with existing infrastructure.
2. **Build V2 backend:** RemoteDevManager + REST routes + WS streaming. Ship alongside MVP.
3. **Switch transport:** Dashboard detects V2 availability (server exposes capability at `/api/remote/status`). Auto-upgrades transport when available.
4. **Deprecate MVP loop:** Once V2 is stable, the `/remote-dev` skill becomes optional (users who prefer the AskUser pattern can keep it).

---

## Comparison with `claude remote-control`

| Feature       | Synapse Remote Dev                           | claude remote-control        |
| ------------- | -------------------------------------------- | ---------------------------- |
| Network       | LAN-first (no cloud dependency)              | Anthropic cloud relay        |
| UI            | Synapse dashboard (graph + chat + analytics) | claude.ai/code or Claude app |
| Streaming     | Via hook events (MVP) / JSON chunks (V2)     | Native streaming             |
| Session start | From PC (MVP) / From phone (V2)              | From terminal                |
| Observability | Full node graph, tool timeline, analytics    | Chat only                    |
| Permissions   | Remote approve/deny with full context        | Built-in permission prompts  |
| Customization | Quick actions, configurable UI               | None                         |
| Offline       | Works without internet (LAN)                 | Requires internet            |
| Third-party   | Open (your own infra)                        | Locked to Anthropic          |

---

## Files to Create/Modify

### Phase 1 (MVP)

| File                                                                   | Action | Purpose                                                   |
| ---------------------------------------------------------------------- | ------ | --------------------------------------------------------- |
| `.claude/commands/remote-dev.md`                                       | Create | `/remote-dev` custom slash command — AskUserQuestion loop |
| `apps/dashboard/src/components/mobile/RemoteDevChat.tsx`               | Create | Chat UI component                                         |
| `apps/dashboard/src/components/permissions/PermissionApprovalCard.tsx` | Modify | Detect `metadata.source: "remote-dev"`, route to chat     |
| `apps/dashboard/src/store/remoteDevStore.ts`                           | Create | Chat history, transport state                             |
| `apps/dashboard/src/components/mobile/MobileView.tsx`                  | Modify | Add Dev tab or FAB entry point                            |

### Phase 2 (V2)

| File                                                     | Action | Purpose                                                                |
| -------------------------------------------------------- | ------ | ---------------------------------------------------------------------- |
| `packages/server/src/services/remoteDevManager.ts`       | Create | Session + process manager                                              |
| `packages/server/src/routes/remoteDev.ts`                | Create | REST API endpoints                                                     |
| `packages/server/src/app.ts`                             | Modify | Mount remote dev routes                                                |
| `packages/core/src/types/remoteDev.ts`                   | Create | Shared types (RemoteSession, WS messages)                              |
| `packages/core/src/types/agent.ts`                       | Modify | Add `remoteDevOutput` and `remoteDevStatus` to `WsServerMessage` union |
| `apps/dashboard/src/store/remoteDevStore.ts`             | Modify | Add V2 transport + session management                                  |
| `apps/dashboard/src/components/mobile/RemoteDevChat.tsx` | Modify | Session picker, V2 streaming display                                   |

---

## Open Questions

1. **Quick action customization:** Where to persist custom quick actions? localStorage? Server setting?
2. **Multi-session UI:** For V2, how to display multiple active sessions on mobile without clutter?
3. **Authentication:** LAN-only is fine for now, but should we add a PIN/token for V2 when sessions can be started remotely?
4. **Working directory:** For V2 new sessions, how does the user specify `cwd` from their phone? Preset list? Last-used?

---

## Open Questions / Deferred (P2)

_From plan review — worth noting, can be addressed incrementally:_

1. **`ChildProcess` not serializable:** `RemoteSession.process` is in-memory only. Session state is lost on server restart. Acceptable for V2 MVP — sessions are ephemeral by nature. If persistence is needed later, store session metadata (minus process handle) in SQLite.
2. **Duplicate event channels in V2:** When `claude -p` runs, hook events fire (captured by Synapse's existing pipeline) AND stdout JSON chunks stream via `remoteDevOutput`. The dashboard receives work visibility through both channels. Not a bug — the graph uses hook events while the chat uses `remoteDevOutput`. Document this duality to avoid confusion during implementation.
3. **Quick action confirmation for destructive actions:** "Commit" and "Deploy" are one-tap on mobile. Consider swipe-to-confirm or long-press for destructive quick actions to prevent accidental taps.
4. **Success metrics:** Track prompts-per-session, average response time, and error rate. Can piggyback on existing analytics infrastructure.
5. **MVP/V2 coexistence:** During migration, a user could have an AskUser loop running AND try V2. The dashboard should detect which transport is active and not offer both simultaneously.

---

## Implementation Kickoff Prompt

```
--- START IMPLEMENTATION PROMPT ---

→ Synapse Remote Dev Loop — Phase 1 (MVP)

I want to implement the Remote Dev Loop MVP. The design spec is at:
- docs/superpowers/specs/2026-03-13-remote-dev-loop-design.md

Please read the full spec, then use the `superpowers:writing-plans` skill to create a
detailed implementation plan for Phase 1 only (the AskUserQuestion loop).

Key context:
- This adds remote development from mobile: user types a prompt on their phone, Claude
  executes it on their PC, with full Synapse graph streaming visibility
- MVP uses the existing AskUserQuestion + deny+message relay — no new server code needed
- Dashboard chat skin intercepts remote-dev AskUserQuestions and renders them as a chat UI

Risks to watch:
- The "Other" answer key format needs empirical verification before building the chat skin
- Status report extraction relies on delimiter parsing (REMOTE_DEV_RESPONSE_START/END)
- Auto-dismiss logic for timeout re-ask race condition

--- END PROMPT ---
```

---

## Sources

- [Claude Code Remote Control docs](https://code.claude.com/docs/en/remote-control)
- [Claude Code CLI reference](https://code.claude.com/docs/en/cli-reference)
- [Claude Code Hooks reference](https://code.claude.com/docs/en/hooks)
- [Agent SDK TypeScript reference](https://platform.claude.com/docs/en/agent-sdk/typescript)
- [Simon Willison on Remote Control](https://simonwillison.net/2026/Feb/25/claude-code-remote-control/)
- [Synapse Remote Answer Relay design](docs/superpowers/specs/2026-03-12-remote-answer-relay-design.md)
