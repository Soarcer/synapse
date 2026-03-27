# Option C: HTTP-Native Hooks — Zero Process Spawning

**Date**: 2026-03-17
**Status**: Draft
**Impact**: Eliminates 150-600 Node process spawns per Claude Code session

---

## Problem

Every hook event spawns a new `node send_event.cjs` process:

- **150-600 process spawns** per typical session (50-200 tool calls × 2-3 hooks each)
- Each process: ~30-50ms Node startup + TCP connection + HTTP request + 3s timeout ceiling
- In the success case (server running), this wastes **5-30 seconds of cumulative CPU time** per session
- The circuit breaker only helps the failure case — the success case is still expensive

## Key Insight

**Claude Code already supports `type: "http"` hooks.** The PermissionRequest hook already uses this:

```json
{
  "type": "http",
  "url": "http://localhost:27247/api/hooks/permission",
  "timeout": 1800
}
```

With `type: "http"`, Claude Code makes the HTTP POST internally — no child process spawned, no Node startup, no script overhead. The server already has `/api/events` which accepts the exact JSON that Claude Code sends as the hook payload.

## Design

### Hook Configuration (before → after)

**Before** (12 events × command hooks = 12 process spawns per cycle):

```json
{
  "PreToolUse": [
    {
      "hooks": [
        {
          "type": "command",
          "command": "node hooks/send_event.cjs",
          "async": true
        }
      ]
    }
  ]
}
```

**After** (11 events × HTTP hooks = 0 process spawns + 1 command for Stop):

```json
{
  "PreToolUse": [
    {
      "hooks": [
        {
          "type": "http",
          "url": "http://localhost:27248/api/events",
          "timeout": 5
        }
      ]
    }
  ]
}
```

### Why Keep `type: "command"` for Stop?

The `Stop` event fires `send_response.cjs`, which reads the transcript JSONL file from disk to extract the last assistant response. This requires filesystem access that HTTP hooks can't provide — Claude Code sends the hook event JSON, but the transcript _content_ isn't in that payload (only `transcript_path` is).

```json
"Stop": [{
  "hooks": [
    { "type": "http", "url": "http://localhost:27248/api/events", "timeout": 5 },
    { "type": "command", "command": "node hooks/send_response.cjs", "async": true }
  ]
}]
```

### Why the HTTP Fallback Port (27248)?

HTTP hooks must always use plain HTTP. The main server port (27246) may be HTTPS when TLS is configured. The HTTP fallback port (SYNAPSE_PORT + 2 = 27248) is always plain HTTP, matching what `send_event.cjs` already uses today.

### PermissionRequest — Special Case

PermissionRequest already uses an HTTP hook pointing at the hook server (port 27247). It's a **blocking** hook (no `async`, 30-min timeout). This stays unchanged — but we ADD the telemetry HTTP hook alongside it:

```json
"PermissionRequest": [{
  "hooks": [
    { "type": "http", "url": "http://localhost:27248/api/events", "timeout": 5 },
    { "type": "http", "url": "http://localhost:27247/api/hooks/permission", "timeout": 1800 }
  ]
}]
```

### Circuit Breaker Changes

With HTTP hooks, Claude Code handles timeouts internally (5-second timeout per hook). The circuit breaker in `send_event.cjs` becomes irrelevant for 11 of 12 hook types since those scripts are no longer invoked.

**What we keep:**

- Circuit breaker in `send_response.cjs` (Stop event still uses command hook)
- Permanent trip behavior (no 60s retry — reset only on server start)

**What we remove from the hot path:**

- `send_event.cjs` is no longer called by Claude Code hooks (retained as manual fallback/debugging tool)

### When Server Is Down

| Scenario           | Before (command hooks)                                      | After (HTTP hooks)                                       |
| ------------------ | ----------------------------------------------------------- | -------------------------------------------------------- |
| Server unreachable | Process spawns, ECONNREFUSED, circuit breaker trips after 3 | Claude Code gets connection error, continues (async)     |
| Server slow        | Process waits up to 3s timeout                              | Claude Code waits up to 5s timeout (async, non-blocking) |
| Server comes back  | CB file deleted on start, hooks resume                      | Hooks resume immediately (no CB state to clear)          |

The async flag on HTTP hooks means Claude Code doesn't block regardless of server state. There's no cascading failure risk.

### Gemini and Codex Hooks

These are separate hook systems with different config formats:

- **Gemini**: `~/.gemini/settings.json` — also supports HTTP hooks, same migration possible (future work)
- **Codex**: `~/.codex/config.toml` — uses `notify` array, different mechanism (no change)

This plan only covers Claude Code hooks. Gemini/Codex migration is a follow-up.

---

## Implementation Plan

### Step 1: Update HookManager to generate HTTP hooks

**File**: `apps/vscode/src/hookManager.ts`

Changes:

- `configureHooks()` generates `type: "http"` entries instead of `type: "command"` for all events except Stop
- URL uses HTTP fallback port: `http://localhost:${port + 2}/api/events`
- Timeout: 5 seconds (short, async, fire-and-forget)
- Stop event gets both HTTP (for telemetry) and command (for transcript extraction)
- PermissionRequest gets both HTTP (telemetry) and the existing blocking HTTP hook (permission routing)
- `needsConfiguration()` checks for HTTP hook URLs instead of `send_event.cjs` command strings

```typescript
// New hook generation logic
function buildHookEntry(port: number, event: string): unknown[] {
  const telemetryHook = {
    type: 'http',
    url: `http://localhost:${port + 2}/api/events`,
    timeout: 5,
  };

  if (event === 'Stop') {
    // Telemetry + transcript extraction (needs filesystem)
    return [
      {
        hooks: [
          telemetryHook,
          { type: 'command', command: `node "${responseScript}"`, async: true },
        ],
      },
    ];
  }

  if (event === 'PermissionRequest') {
    // Telemetry + blocking permission router
    return [
      {
        hooks: [
          telemetryHook,
          { type: 'http', url: `http://localhost:${port + 1}/api/hooks/permission`, timeout: 1800 },
        ],
      },
    ];
  }

  // All other events: HTTP-only, async
  return [{ hooks: [telemetryHook] }];
}
```

### Step 2: Update repo-level settings.json

**File**: `.claude/settings.json`

Replace all `type: "command"` hooks with `type: "http"` hooks. This is the repo-level config used during development (when not using the VS Code extension's auto-configuration).

### Step 3: Update circuit breaker to permanent-trip

**File**: `hooks/send_response.cjs`

- Remove the 60-second cooldown window
- Circuit breaker stays tripped until server deletes the CB file
- Already mostly done — just remove the window-based failure counting, keep the permanent trip

**File**: `hooks/send_event.cjs`

- Same permanent-trip change
- Add a comment noting this script is now only used as a manual fallback / debugging tool (not called by hooks in production)

### Step 4: Update bundled hook scripts in VS Code extension

**File**: `apps/vscode/resources/synapse-server/hooks/send_event.cjs`
**File**: `apps/vscode/resources/synapse-server/hooks/send_response.cjs`

These are copies bundled into the .vsix. They need the same circuit breaker changes.

### Step 5: Update needsConfiguration() detection

**File**: `apps/vscode/src/hookManager.ts`

`needsConfiguration()` currently checks for `send_event.cjs` in the settings file. Update to check for the HTTP hook URL pattern instead (since most hooks no longer reference send_event.cjs).

### Step 6: Update getHookStatus() for settings panel

**File**: `apps/vscode/src/hookManager.ts`

`getHookStatus()` parses hook config for the settings UI. Update to detect both HTTP and command hook types.

### Step 7: Verify server event ingestion handles HTTP hook payloads

**File**: `packages/server/src/routes/events.ts`

Claude Code's HTTP hooks POST the raw hook event JSON. The existing `/api/events` route already handles this format (it's the same JSON that `send_event.cjs` was forwarding). Verify no normalization is lost by removing the `send_event.cjs` middleman.

Key check: `send_event.cjs` does `JSON.parse(body)` then `fetch(url, { body })` — it passes through the raw JSON unchanged. So the HTTP hook payload is identical. No server changes needed.

---

## Impact Summary

| Metric                          | Before           | After                                                               |
| ------------------------------- | ---------------- | ------------------------------------------------------------------- |
| Process spawns per session      | 150-600          | 1-3 (Stop events only)                                              |
| Node startup overhead           | 5-30s cumulative | ~100ms cumulative                                                   |
| Network connections per session | 150-600 TCP      | 150-600 TCP (but from Claude Code's existing process, not new ones) |
| Files changed                   | —                | 3-4 files                                                           |
| New dependencies                | —                | None                                                                |
| Risk                            | —                | Low (HTTP hooks already proven by PermissionRequest)                |

## Risks and Mitigations

1. **HTTP hook `async` behavior undocumented**: Need to verify Claude Code doesn't block on async HTTP hooks. Mitigation: the 5-second timeout caps worst case. Test with server down.

2. **HTTP fallback port not listening**: If port 27248 fails to bind, all telemetry hooks silently fail. Mitigation: this port already exists and is used by `send_event.cjs` today — same failure mode as before.

3. **Hook payload format differences**: Unlikely since `send_event.cjs` is a passthrough, but verify with `SYNAPSE_DEBUG=1` logging.

## Out of Scope

- Gemini CLI hook migration (separate config system)
- Codex hook migration (different mechanism)
- Named pipe / sidecar for the `send_response.cjs` transcript reader (diminishing returns — only fires once per turn)
- Server-side changes (none needed)
