# AskUserQuestion Tool Completion on Permission Resolve

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When a permission (especially AskUserQuestion) is resolved, immediately mark the corresponding tool node as completed in the dashboard graph — eliminating the "Running..." stuck state.

**Architecture:** Enrich all `permissionResolved` WebSocket broadcasts with `session_id`, `tool_use_id`, and `tool_name` from the original hook event. On the dashboard, when `permissionResolved` arrives with a `tool_use_id`, synthesize a tool completion in the agentStore. The real `PostToolUse` from Claude Code will arrive later and be harmlessly re-applied (same status).

**Tech Stack:** TypeScript, Express, WebSocket, Zustand

---

## Problem

When Claude Code uses AskUserQuestion (or any permission-gated tool):

1. `PreToolUse` fires → creates a tool node with `status: 'running'`
2. `PermissionRequest` fires → creates a permission card on the dashboard
3. User approves/denies on the dashboard → `permissionResolved` WS message sent
4. Claude Code receives the answer, processes it, and eventually sends `PostToolUse` → updates tool node to `status: 'success'`

Step 4 can be delayed (Claude thinking) or never arrive (connection issues). The tool node stays stuck showing "Running..." even though the user already answered.

## Solution

Two changes:

1. **Server**: Include `session_id`, `tool_use_id`, `tool_name` in all `permissionResolved` WS broadcasts (5 resolution paths)
2. **Dashboard**: When `permissionResolved` arrives with a `tool_use_id`, call `finalizeToolCall` to mark the tool as completed immediately

## Resolution Paths (all 5 must be updated)

| #   | Path                          | File                                             | Line  | Trigger                                    |
| --- | ----------------------------- | ------------------------------------------------ | ----- | ------------------------------------------ |
| R1  | Dashboard approve/deny        | `packages/server/src/routes/permissions.ts`      | 63-66 | `PUT /api/permissions/:id/decision`        |
| R2  | Timeout                       | `packages/server/src/hookServer.ts`              | 63-78 | `setTimeout` after `PERMISSION_TIMEOUT_MS` |
| R3  | Connection close              | `packages/server/src/hookServer.ts`              | 89-99 | `res.on('close')`                          |
| R4  | Connection monitor (Layer 2)  | `packages/server/src/state/permissionState.ts`   | 95-98 | `setInterval` checks socket/DB             |
| R5  | Session-advanced auto-resolve | `packages/server/src/services/eventIngestion.ts` | 52-55 | Incoming PostToolUse/Stop event            |

---

### Task 1: Create shared helper to build enriched `permissionResolved` payload

**Files:**

- Create: `packages/server/src/state/permissionResolved.ts`
- Test: `packages/server/src/__tests__/permissionResolved.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// packages/server/src/__tests__/permissionResolved.test.ts
import { describe, it, expect } from 'vitest';
import { buildPermissionResolved } from '../state/permissionResolved.js';

describe('buildPermissionResolved', () => {
  it('includes session_id and tool_use_id from hook event', () => {
    const event = {
      session_id: 'sess-1',
      tool_use_id: 'tu-abc',
      tool_name: 'AskUserQuestion',
      hook_event_name: 'PermissionRequest',
    };
    const result = buildPermissionResolved('perm-1', 'allow', event);

    expect(result).toEqual({
      type: 'permissionResolved',
      data: {
        id: 'perm-1',
        behavior: 'allow',
        session_id: 'sess-1',
        tool_use_id: 'tu-abc',
        tool_name: 'AskUserQuestion',
      },
    });
  });

  it('omits missing fields gracefully', () => {
    const event = { hook_event_name: 'PermissionRequest' };
    const result = buildPermissionResolved('perm-2', 'deny', event);

    expect(result).toEqual({
      type: 'permissionResolved',
      data: {
        id: 'perm-2',
        behavior: 'deny',
      },
    });
  });

  it('handles auto-dismissed behavior', () => {
    const event = {
      session_id: 'sess-3',
      tool_use_id: 'tu-xyz',
      tool_name: 'Bash',
      hook_event_name: 'PermissionRequest',
    };
    const result = buildPermissionResolved('perm-3', 'auto-dismissed', event);

    expect(result.data.behavior).toBe('auto-dismissed');
    expect(result.data.session_id).toBe('sess-3');
    expect(result.data.tool_use_id).toBe('tu-xyz');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- --run packages/server/src/__tests__/permissionResolved.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Write the implementation**

```typescript
// packages/server/src/state/permissionResolved.ts
// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Bernhard

/**
 * Builds an enriched permissionResolved WS message payload.
 * Includes session_id, tool_use_id, and tool_name from the original
 * hook event so the dashboard can immediately finalize tool nodes.
 */
export function buildPermissionResolved(
  id: string,
  behavior: 'allow' | 'deny' | 'auto-dismissed',
  event: Record<string, unknown>,
): { type: 'permissionResolved'; data: Record<string, unknown> } {
  const data: Record<string, unknown> = { id, behavior };

  const sessionId = event.session_id as string | undefined;
  const toolUseId = event.tool_use_id as string | undefined;
  const toolName = event.tool_name as string | undefined;

  if (sessionId) data.session_id = sessionId;
  if (toolUseId) data.tool_use_id = toolUseId;
  if (toolName) data.tool_name = toolName;

  return { type: 'permissionResolved', data };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test -- --run packages/server/src/__tests__/permissionResolved.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/state/permissionResolved.ts packages/server/src/__tests__/permissionResolved.test.ts
git commit -m "feat(server): add buildPermissionResolved helper with enriched payload"
```

---

### Task 2: Update all 5 server resolution paths to use the helper

**Files:**

- Modify: `packages/server/src/routes/permissions.ts:63-66` (R1)
- Modify: `packages/server/src/hookServer.ts:63-78,89-99` (R2, R3)
- Modify: `packages/server/src/state/permissionState.ts:95-98` (R4)
- Modify: `packages/server/src/services/eventIngestion.ts:52-55` (R5)

- [ ] **Step 1: Update R1 — dashboard approve/deny (permissions.ts)**

In `packages/server/src/routes/permissions.ts`, add the import at the top:

```typescript
import { buildPermissionResolved } from '../state/permissionResolved.js';
```

Replace lines 62-66:

```typescript
// Broadcast resolution to all dashboard clients
broadcaster.broadcastRaw({
  type: 'permissionResolved',
  data: { id, behavior },
});
```

With:

```typescript
// Broadcast resolution to all dashboard clients (enriched with tool IDs)
broadcaster.broadcastRaw(buildPermissionResolved(id, behavior, entry.event));
```

- [ ] **Step 2: Update R2 — timeout handler (hookServer.ts)**

In `packages/server/src/hookServer.ts`, add import at the top:

```typescript
import { buildPermissionResolved } from './state/permissionResolved.js';
```

The timeout handler (line 63-78) needs access to the event data. Extract `session_id`, `tool_use_id`, `tool_name` from `req.body` before the `pending.set()`. Change the timeout handler to also broadcast `permissionResolved`:

Replace lines 63-78:

```typescript
const timer = setTimeout(() => {
  pending.delete(id);
  try {
    res.json({
      hookSpecificOutput: {
        hookEventName: 'PermissionRequest',
        decision: {
          behavior: 'deny',
          message: 'Synapse approval timed out. Re-run the task or approve in terminal.',
        },
      },
    });
  } catch {
    // Response may already be closed
  }
}, PERMISSION_TIMEOUT_MS);
```

With:

```typescript
const hookEvent = req.body as Record<string, unknown>;
const timer = setTimeout(() => {
  pending.delete(id);
  broadcaster.broadcastRaw(buildPermissionResolved(id, 'deny', hookEvent));
  try {
    res.json({
      hookSpecificOutput: {
        hookEventName: 'PermissionRequest',
        decision: {
          behavior: 'deny',
          message: 'Synapse approval timed out. Re-run the task or approve in terminal.',
        },
      },
    });
  } catch {
    // Response may already be closed
  }
}, PERMISSION_TIMEOUT_MS);
```

Note: The timeout path did NOT previously broadcast `permissionResolved` at all — this is a bug fix that also enriches the payload.

- [ ] **Step 3: Update R3 — connection close handler (hookServer.ts)**

Replace lines 89-99:

```typescript
res.on('close', () => {
  const entry = pending.get(id);
  if (!entry) return; // Already resolved by another layer
  clearTimeout(entry.timer);
  pending.delete(id);
  broadcaster.broadcastRaw({
    type: 'permissionResolved',
    data: { id, behavior: 'auto-dismissed' },
  });
  logger.info({ id }, 'Permission auto-dismissed: res.on(close)');
});
```

With:

```typescript
res.on('close', () => {
  const entry = pending.get(id);
  if (!entry) return; // Already resolved by another layer
  clearTimeout(entry.timer);
  pending.delete(id);
  broadcaster.broadcastRaw(buildPermissionResolved(id, 'auto-dismissed', entry.event));
  logger.info({ id }, 'Permission auto-dismissed: res.on(close)');
});
```

- [ ] **Step 4: Update R4 — connection monitor Layer 2 (permissionState.ts)**

In `packages/server/src/state/permissionState.ts`, add import at the top:

```typescript
import { buildPermissionResolved } from './permissionResolved.js';
```

Replace lines 95-98:

```typescript
monitorBroadcaster?.broadcastRaw({
  type: 'permissionResolved',
  data: { id, behavior: sessionAdvanced ? 'allow' : 'auto-dismissed' },
});
```

With:

```typescript
const behavior = sessionAdvanced ? 'allow' : 'auto-dismissed';
monitorBroadcaster?.broadcastRaw(buildPermissionResolved(id, behavior, entry.event));
```

- [ ] **Step 5: Update R5 — session-advanced auto-resolve (eventIngestion.ts)**

In `packages/server/src/services/eventIngestion.ts`, add import at the top:

```typescript
import { buildPermissionResolved } from '../state/permissionResolved.js';
```

Replace lines 52-55:

```typescript
broadcaster.broadcastRaw({
  type: 'permissionResolved',
  data: { id, behavior },
});
```

With:

```typescript
broadcaster.broadcastRaw(buildPermissionResolved(id, behavior, entry.event));
```

- [ ] **Step 6: Run existing tests to verify no regressions**

Run: `pnpm test -- --run`
Expected: All 69+ test files pass. The existing tests check for `type: 'permissionResolved'` with `expect.objectContaining()` so the extra fields won't break them.

- [ ] **Step 7: Commit**

```bash
git add packages/server/src/routes/permissions.ts packages/server/src/hookServer.ts packages/server/src/state/permissionState.ts packages/server/src/services/eventIngestion.ts
git commit -m "feat(server): enrich all permissionResolved broadcasts with tool IDs"
```

---

### Task 3: Dashboard — finalize tool node on permissionResolved

<!-- revised: removed eventHandlers.ts from file list (no change needed), removed dead test block per review -->

**Files:**

- Modify: `apps/dashboard/src/store/agentStore.ts:965-972`
- Test: `apps/dashboard/src/store/__tests__/permissionToolEnd.test.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/dashboard/src/store/__tests__/permissionToolEnd.test.ts`:

```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import { useAgentStore } from '../agentStore';

beforeEach(() => {
  useAgentStore.getState().clearEvents();
});

describe('permission tool finalization', () => {
  it('finalizes a running tool when permissionResolved has tool_use_id', () => {
    const { addEvent, finalizePermissionTool } = useAgentStore.getState();

    addEvent({
      id: 'e1',
      type: 'session_start',
      sessionId: 'sess-perm',
      timestamp: Date.now(),
      eventSource: 'hook',
      vendor: 'anthropic',
    });
    addEvent({
      id: 'e2',
      type: 'tool_start',
      sessionId: 'sess-perm',
      timestamp: Date.now(),
      eventSource: 'hook',
      vendor: 'anthropic',
      toolName: 'AskUserQuestion',
      toolUseId: 'tu-ask-1',
      status: 'running',
    });

    // Tool should be running
    const before = [...useAgentStore.getState().toolCalls.values()].flat();
    expect(before.find((t) => t.toolUseId === 'tu-ask-1')?.status).toBe('running');

    // Finalize via permission resolution
    finalizePermissionTool('tu-ask-1', 'sess-perm', 'allow');

    // Tool should now be success
    const after = [...useAgentStore.getState().toolCalls.values()].flat();
    expect(after.find((t) => t.toolUseId === 'tu-ask-1')?.status).toBe('success');
  });

  it('sets status to error when behavior is deny', () => {
    const { addEvent, finalizePermissionTool } = useAgentStore.getState();

    addEvent({
      id: 'e1',
      type: 'session_start',
      sessionId: 'sess-deny',
      timestamp: Date.now(),
      eventSource: 'hook',
      vendor: 'anthropic',
    });
    addEvent({
      id: 'e2',
      type: 'tool_start',
      sessionId: 'sess-deny',
      timestamp: Date.now(),
      eventSource: 'hook',
      vendor: 'anthropic',
      toolName: 'AskUserQuestion',
      toolUseId: 'tu-deny-1',
      status: 'running',
    });

    finalizePermissionTool('tu-deny-1', 'sess-deny', 'deny');

    const after = [...useAgentStore.getState().toolCalls.values()].flat();
    expect(after.find((t) => t.toolUseId === 'tu-deny-1')?.status).toBe('error');
  });

  it('is a no-op when tool_use_id does not match any running tool', () => {
    const { finalizePermissionTool } = useAgentStore.getState();
    // Should not throw
    expect(() => finalizePermissionTool('nonexistent', 'sess-x', 'allow')).not.toThrow();
  });

  it('is a no-op when tool is already completed', () => {
    const { addEvent, finalizePermissionTool } = useAgentStore.getState();

    addEvent({
      id: 'e1',
      type: 'session_start',
      sessionId: 'sess-done',
      timestamp: Date.now(),
      eventSource: 'hook',
      vendor: 'anthropic',
    });
    addEvent({
      id: 'e2',
      type: 'tool_start',
      sessionId: 'sess-done',
      timestamp: Date.now(),
      eventSource: 'hook',
      vendor: 'anthropic',
      toolName: 'AskUserQuestion',
      toolUseId: 'tu-done-1',
      status: 'running',
    });
    addEvent({
      id: 'e3',
      type: 'tool_end',
      sessionId: 'sess-done',
      timestamp: Date.now(),
      eventSource: 'hook',
      vendor: 'anthropic',
      toolName: 'AskUserQuestion',
      toolUseId: 'tu-done-1',
      status: 'success',
    });

    // Already success — finalize should be a no-op
    finalizePermissionTool('tu-done-1', 'sess-done', 'allow');

    const after = [...useAgentStore.getState().toolCalls.values()].flat();
    expect(after.find((t) => t.toolUseId === 'tu-done-1')?.status).toBe('success');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- --run apps/dashboard/src/store/__tests__/permissionToolEnd.test.ts`
Expected: FAIL — `finalizePermissionTool` is not a function

- [ ] **Step 3: Implement `finalizePermissionTool` in the agentStore**

In `apps/dashboard/src/store/agentStore.ts`, add a new action to the store interface and implementation.

Add to the store's actions type (near other action declarations):

```typescript
  finalizePermissionTool: (toolUseId: string, sessionId: string, behavior: string) => void;
```

Add to the store's implementation (near `addEvent`):

```typescript
  finalizePermissionTool: (toolUseId, sessionId, behavior) => {
    const status = behavior === 'deny' ? 'error' : 'success';
    // Synthesize a tool_end event and process it through the normal handler
    const syntheticEvent: AgentEvent = {
      id: `perm-resolve-${toolUseId}`,
      type: status === 'error' ? 'tool_error' : 'tool_end',
      sessionId,
      timestamp: Date.now(),
      eventSource: 'hook',
      vendor: 'anthropic',
      toolUseId,
      status,
    };
    // Re-use the existing addEvent path — it calls finalizeToolCall internally
    // which handles idempotency (already-completed tools are patched harmlessly)
    get().addEvent(syntheticEvent);
  },
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test -- --run apps/dashboard/src/store/__tests__/permissionToolEnd.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 5: Wire up the WS handler**

In `apps/dashboard/src/store/agentStore.ts`, update the `permissionResolved` handler (around line 965):

Replace:

```typescript
if (msg.type === 'permissionResolved') {
  const data = msg.data as { id: string; behavior: 'allow' | 'deny' | 'auto-dismissed' };
  const devStore = useRemoteDevStore.getState();
  if (devStore.pendingQuestion?.id === data.id) {
    devStore.resolveQuestion();
    return;
  }
}
```

With:

```typescript
if (msg.type === 'permissionResolved') {
  const data = msg.data as {
    id: string;
    behavior: 'allow' | 'deny' | 'auto-dismissed';
    tool_use_id?: string;
    session_id?: string;
  };
  const devStore = useRemoteDevStore.getState();
  if (devStore.pendingQuestion?.id === data.id) {
    devStore.resolveQuestion();
    // Finalize tool node before returning (remote-dev path)
    if (data.tool_use_id && data.session_id) {
      useAgentStore
        .getState()
        .finalizePermissionTool(data.tool_use_id, data.session_id, data.behavior);
    }
    return; // Keep return — don't double-process in permissionStore
  }
  // Finalize the tool node if we have the IDs (non-remote-dev path)
  if (data.tool_use_id && data.session_id) {
    useAgentStore
      .getState()
      .finalizePermissionTool(data.tool_use_id, data.session_id, data.behavior);
  }
}
```

<!-- revised: kept `return` after resolveQuestion() to avoid double-processing in permissionStore -->

- [ ] **Step 6: Run full test suite**

Run: `pnpm test -- --run`
Expected: All tests pass (69+ files, 1160+ tests)

- [ ] **Step 7: Commit**

```bash
git add apps/dashboard/src/store/agentStore.ts apps/dashboard/src/store/__tests__/permissionToolEnd.test.ts
git commit -m "feat(dashboard): finalize tool node immediately on permission resolution"
```

---

### Task 4: Integration test — full permission lifecycle

**Files:**

- Modify: `packages/server/src/__tests__/hookServer.test.ts`

- [ ] **Step 1: Write integration test**

Add to `packages/server/src/__tests__/hookServer.test.ts`:

```typescript
import { buildPermissionResolved } from '../state/permissionResolved.js';

describe('permissionResolved payload enrichment', () => {
  it('includes session_id and tool_use_id from the hook event body', async () => {
    // Fire a permission request with tool IDs
    const responsePromise = new Promise<request.Response>((resolve, reject) => {
      request(app)
        .post('/api/hooks/permission')
        .send({
          session_id: 'sess-enrich',
          tool_use_id: 'tu-enrich-1',
          tool_name: 'AskUserQuestion',
          tool_input: { questions: [{ question: 'Pick one?' }] },
          hook_event_name: 'PermissionRequest',
        })
        .end((err, res) => {
          if (err) reject(err);
          else resolve(res);
        });
    });

    await new Promise((r) => setTimeout(r, 100));
    expect(pending.size).toBe(1);

    const [id, entry] = [...pending.entries()][0];

    // Verify the entry has the tool IDs from the request body
    expect(entry.event.session_id).toBe('sess-enrich');
    expect(entry.event.tool_use_id).toBe('tu-enrich-1');
    expect(entry.event.tool_name).toBe('AskUserQuestion');

    // Verify buildPermissionResolved produces enriched payload
    const resolved = buildPermissionResolved(id, 'allow', entry.event);
    expect(resolved.data.session_id).toBe('sess-enrich');
    expect(resolved.data.tool_use_id).toBe('tu-enrich-1');
    expect(resolved.data.tool_name).toBe('AskUserQuestion');

    // Clean up: resolve the held response
    clearTimeout(entry.timer);
    entry.res.json({
      hookSpecificOutput: {
        hookEventName: 'PermissionRequest',
        decision: { behavior: 'allow' },
      },
    });
    pending.delete(id);
    await responsePromise;
  });
});
```

- [ ] **Step 2: Run integration test**

Run: `pnpm test -- --run packages/server/src/__tests__/hookServer.test.ts`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add packages/server/src/__tests__/hookServer.test.ts
git commit -m "test(server): add integration test for enriched permissionResolved payload"
```

---

### Task 5: Final verification

- [ ] **Step 1: Run full test suite**

Run: `pnpm test -- --run`
Expected: All tests pass with zero failures

- [ ] **Step 2: Manual test**

1. Start the server: `.\start-server.ps1`
2. Start the dashboard: `.\start-client.ps1`
3. In a Claude Code session, trigger an AskUserQuestion
4. Observe the tool node shows "Running..."
5. Answer the question on the dashboard
6. Verify the tool node immediately transitions to "Success" (green)
7. Verify the real PostToolUse arrives later and doesn't cause issues

- [ ] **Step 3: Final commit**

```bash
git add -A
git commit -m "feat: immediate tool completion on permission resolution

When AskUserQuestion or any permission-gated tool is resolved via the
dashboard, the tool node now immediately shows as completed instead of
staying stuck on 'Running...' until Claude Code sends PostToolUse.

All 5 resolution paths (approve/deny, timeout, connection close,
connection monitor, session-advanced) are covered."
```
