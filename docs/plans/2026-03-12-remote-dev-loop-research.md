# Remote Development Loop Research

**Date**: 2026-03-12
**Goal**: User taps a button on their phone dashboard, types a prompt, and Claude Code (running on their PC) executes it. The UX should feel like the USER initiates, not like Claude is waiting with a visible prompt.

---

## Approach 1: Claude Code CLI stdin injection

**Question**: Can you pipe prompts into a running Claude Code session via stdin?

**Answer**: No. You cannot inject prompts into an _already running_ interactive session. The `-p` flag starts a _new_ non-interactive session -- it does not attach to an existing one. There is no IPC mechanism, named pipe, or socket that a running Claude Code session exposes for external prompt injection.

**What works instead**: You can chain prompts across sessions using `--continue` or `--resume`:

```bash
session_id=$(claude -p "Start a review" --output-format json | jq -r '.session_id')
claude -p "Continue that review" --resume "$session_id"
```

**Trade-offs**:

- Each `claude -p` invocation spawns a new process (~12s overhead per call)
- Session context is preserved via `--resume`, so conversation continuity works
- Feels like user-initiated (they type prompt, server runs `claude -p`)
- No way to get real-time streaming to the phone dashboard easily

**Verdict**: Technically possible via repeated `claude -p --resume`. Viable but slow due to process spawn overhead. Good for fire-and-forget tasks.

---

## Approach 2: Claude Code `--print` / batch mode

**Question**: Is there a non-interactive mode for sending prompts and getting output?

**Answer**: Yes. `claude -p "prompt"` (or `--print`) runs non-interactively. Key features:

- `--output-format json` returns structured JSON with `session_id`, `result`, metadata
- `--output-format stream-json` with `--verbose --include-partial-messages` streams tokens as they generate
- `--resume <id>` continues a specific session
- `--continue` continues the most recent session
- `--allowedTools` auto-approves tools without prompting
- `--max-turns` limits agentic turns
- `--max-budget-usd` limits API spend
- `--json-schema` enforces structured output

**Architecture for Synapse**:

```
Phone Dashboard  -->  Synapse Server  -->  spawns `claude -p --resume <sid> --output-format stream-json`
                 WS                   child_process
                 <--  streams tokens  <--  stdout pipe
```

**Trade-offs**:

- Process spawn overhead (~12s per query)
- Streaming works via `stream-json` output format
- Full tool access (Bash, Edit, Read, etc.)
- Session continuity via `--resume`
- User clearly initiates (types prompt on phone)
- Server needs to manage child processes

**Verdict**: The most pragmatic approach for immediate implementation. The 12s overhead is the main drawback.

---

## Approach 3: Agent SDK `query()` loop

**Question**: Could the Synapse server run `query()` from the Agent SDK, receiving prompts from the dashboard?

**Answer**: Yes. The Agent SDK provides `query()` (V1) and `createSession()`/`send()`/`stream()` (V2 preview). The V2 interface is particularly well-suited:

```typescript
import { unstable_v2_createSession } from '@anthropic-ai/claude-agent-sdk';

const session = unstable_v2_createSession({
  model: 'claude-opus-4-6',
  allowedTools: ['Read', 'Edit', 'Bash', 'Glob', 'Grep'],
  cwd: '/path/to/project',
});

// User sends prompt from phone
await session.send(userPrompt);

// Stream response back to phone via WebSocket
for await (const msg of session.stream()) {
  ws.send(JSON.stringify(msg));
}

// Next prompt from phone...
await session.send(nextPrompt);
for await (const msg of session.stream()) {
  ws.send(JSON.stringify(msg));
}
```

**Key V2 features**:

- `send()` + `stream()` = natural multi-turn pattern
- `session.sessionId` for persistence
- `resumeSession(id)` to resume across server restarts
- Same tools, agent loop, and context as Claude Code
- `canUseTool` callback for custom permission handling

**Trade-offs**:

- Same ~12s process spawn overhead (SDK spawns Claude Code under the hood)
- Requires API key (not subscription-based like Claude Code CLI)
- Bypasses hooks entirely (no Synapse hook events would fire)
- Full programmatic control over tools, permissions, output
- Native TypeScript -- integrates cleanly with Synapse server
- V2 interface is `unstable_` prefixed (may change)

**Verdict**: Best long-term approach. Clean API, native TypeScript, multi-turn sessions. The 12s overhead and API key requirement are the main concerns. Could run alongside hooks (SDK agent + hook-monitored Claude Code sessions).

---

## Approach 4: UserPromptSubmit hook for prompt injection

**Question**: Could we use the UserPromptSubmit hook to inject prompts?

**Answer**: No, not for injection. UserPromptSubmit fires _when the user submits a prompt_ -- it cannot CREATE prompts. It can:

- Add `additionalContext` to an existing prompt
- Block a prompt (`decision: "block"`)
- Add plain text context via stdout

The hook is reactive (fires on user action), not generative (cannot initiate action). There is no hook event that creates or injects new prompts into a session.

**What it COULD do**: If combined with Approach 2/3, a UserPromptSubmit hook could enrich remote prompts with local context (e.g., current git status, open files).

**Verdict**: Not viable as a standalone approach. Useful as an enhancement to other approaches.

---

## Approach 5: Custom MCP server as "prompt inbox"

**Question**: Could an MCP server act as a "prompt inbox" that Claude polls for new tasks?

**Answer**: Yes, but with a critical UX problem. You could create an MCP tool like `check_remote_inbox()` that reads from a queue. But:

- Claude must _actively call_ the tool -- you cannot make Claude poll automatically
- Requires Claude to be in an active session, already running, waiting
- The user would see Claude sitting there repeatedly calling `check_inbox()`
- This is the AskUserQuestion polling pattern with extra steps

**Implementation sketch**:

```typescript
// MCP server
tool("check_inbox", "Check for remote prompts", { ... }, async () => {
  const prompt = await redis.lpop("remote-prompts");
  return prompt ? { content: [{ type: "text", text: prompt }] } : { content: [{ type: "text", text: "No new prompts" }] };
});
```

**Trade-offs**:

- Claude must already be running and instructed to poll
- Visible polling loop (not user-initiated UX)
- Latency depends on poll interval
- Extra complexity (MCP server + queue)

**Verdict**: Not viable. Same fundamental problem as AskUserQuestion -- Claude is visibly waiting, not the user initiating.

---

## Approach 6: WebSocket-based prompt injection into Claude Code

**Question**: Is there any way to send a message TO Claude Code (not just FROM it via hooks)?

**Answer**: No direct mechanism exists. Claude Code does not expose an inbound WebSocket, HTTP endpoint, or IPC channel for receiving prompts from external sources.

**However**: The `claude remote-control` feature (released Feb 2026) does exactly this, but only through Anthropic's servers:

- `claude remote-control` starts a session that polls Anthropic's API for work
- You connect from claude.ai/code or the Claude mobile app
- Messages route through Anthropic's API over TLS
- All execution stays local

**Architecture**: Local Claude Code --> outbound HTTPS polling --> Anthropic API <-- browser/phone client

**Key limitations**:

- Only works with claude.ai/code or Claude mobile app (no third-party API)
- No documented API for building custom clients
- Requires Pro/Max subscription
- One remote session per Claude Code instance
- Cannot integrate with Synapse dashboard

**Verdict**: Anthropic solved this problem with Remote Control, but it is a closed system. No third-party API is exposed. If they opened the Remote Control protocol, this would be the ideal solution.

---

## Approach 7: File-based polling

**Question**: Could Claude watch a file and pick up new prompts?

**Answer**: Yes, but requires Claude to already be running and actively watching. Two variants:

**Variant A: Claude in interactive mode with instructions to watch a file**

- Tell Claude: "Watch `remote-prompt.txt`. When it changes, execute the prompt inside it."
- Claude would need to use `Bash(inotifywait ...)` or poll with `cat`
- Same visibility problem as Approach 5 -- Claude is visibly polling

**Variant B: External script + `claude -p`**

- Synapse server watches a queue/file
- When prompt arrives, spawns `claude -p --resume <sid> "$(cat prompt.txt)"`
- This is just Approach 2 with a file-based trigger

**Verdict**: Variant A has the same UX problems as MCP polling. Variant B is just Approach 2 with extra steps.

---

## Recommendation Matrix

| Approach                         | Feasible?                  | User-initiates UX?           | Latency      | Complexity | Session continuity?  |
| -------------------------------- | -------------------------- | ---------------------------- | ------------ | ---------- | -------------------- |
| 1. CLI stdin                     | No (for running sessions)  | N/A                          | N/A          | N/A        | N/A                  |
| 2. `claude -p --resume`          | Yes                        | Yes                          | ~12s startup | Low        | Yes (via session ID) |
| 3. Agent SDK `query()`/V2        | Yes                        | Yes                          | ~12s startup | Medium     | Yes (via session ID) |
| 4. UserPromptSubmit hook         | No (cannot create prompts) | N/A                          | N/A          | N/A        | N/A                  |
| 5. MCP inbox polling             | Yes (but bad UX)           | No (Claude polls)            | Variable     | High       | Yes                  |
| 6. WS injection / Remote Control | No (closed system)         | Yes (but only via claude.ai) | Low          | N/A        | Yes                  |
| 7. File-based polling            | Yes (but bad UX)           | Variant B only               | ~12s+        | Low        | Variant B only       |

## Recommended Architecture

### Short-term: `claude -p --resume` (Approach 2)

The simplest viable path:

```
[Phone Dashboard] --WS--> [Synapse Server] --spawn--> claude -p --resume <sid> --output-format stream-json "user prompt"
                  <--WS--                  <--stdout--  (stream tokens back)
```

1. User opens dashboard on phone, taps "New prompt"
2. Types prompt, hits send
3. Synapse server receives prompt via WebSocket
4. Server spawns `claude -p --resume <sessionId> --output-format stream-json --allowedTools "..." "the prompt"`
5. Server pipes stdout back to phone via WebSocket
6. Process exits when done
7. Session ID is stored for next prompt

**Pros**: No new dependencies, works today, user clearly initiates
**Cons**: 12s process spawn overhead per prompt, must manage child processes

### Long-term: Agent SDK V2 `createSession()` (Approach 3)

More integrated, better for a product:

```
[Phone Dashboard] --WS--> [Synapse Server] --SDK--> Agent SDK session (persistent)
                  <--WS--                  <--stream-- (real-time tokens)
```

1. Server creates a long-lived SDK session per project
2. User sends prompt from phone
3. Server calls `session.send(prompt)` + `session.stream()`
4. Streams response back via WebSocket
5. Session persists in memory (or resume via `resumeSession()`)

**Pros**: Native TypeScript, multi-turn, streaming, no process spawn per prompt (but session creation still has overhead)
**Cons**: API key required, V2 is `unstable_`, bypasses hooks

### Dream scenario: Anthropic opens Remote Control API

If Anthropic exposed the Remote Control protocol, Synapse could:

1. Start `claude remote-control` locally
2. Connect to it via the same protocol claude.ai uses
3. Send prompts from the Synapse phone dashboard
4. Get full Claude Code with all tools, hooks, and local filesystem access
5. Zero overhead, user-initiated, persistent session

This would require Anthropic to document and open the Remote Control WebSocket/polling protocol.
