# Token Display Fix & Orphaned Node Prevention

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix token counting display so it shows transcript-sourced data when hook events lack tokens, and prevent orphaned nodes when a session is deleted while still active.

**Architecture:** Two independent fixes. (1) Token display: agent nodes show 0 tokens because Claude Code hooks never send `tokenUsage` on `agent_stop` — the only real token data comes from JSONL transcripts. `UserPromptNode` and `SessionNode` already have transcript fallbacks; `AgentNode` does not — we add one. (2) Orphaned nodes: add a `suppressedSessionIds` Set to the store; `removeSession` populates it; `processEvent` checks it before creating nodes for deleted sessions.

<!-- revised: removed Task 2 (SessionNode) — already has fallback at lines 46-54. Removed Task 3 (skip marker). Renumbered. -->
<!-- revised: added loadEvents/clearEvents preservation of suppressedSessionIds (P1 from review). -->
<!-- revised: Task 1 test now tests the pure fallback function, not just the baseline. -->

**Tech Stack:** TypeScript, React, Zustand, Vitest

**Known limitation:** The transcript fallback only works when transcripts are loaded (requires `transcriptPath` on the session and server-side JSONL parsing). If transcripts aren't available, token display still shows 0. The root cause is that Claude Code hooks don't include token data — fixing that is outside this project's scope.

---

### Task 1: Add transcript-based token fallback to AgentNode

`UserPromptNode` already falls back to transcript data when agent tokens are 0 (lines 49-64). `SessionNode` also has it (lines 46-54). `AgentNode` does not — it only reads `agent.tokenUsage` which stays `{0,0}` for hook-sourced sessions.

**Files:**

- Modify: `apps/dashboard/src/components/graph/nodes/AgentNode.tsx:39-47`

- [ ] **Step 1: Add transcript subscription and fallback to AgentNode**

In `apps/dashboard/src/components/graph/nodes/AgentNode.tsx`, add a transcript fallback to the `useMemo` that computes `inputTokens`/`outputTokens`. The logic: if the agent's own tokens (including children) are both zero, check the session transcript for assistant turns within the agent's time window.

Add the transcript subscription before the existing `useMemo`:

```typescript
const transcript = useAgentStore((s) => s.transcripts.get(agent.sessionId));
```

Replace the existing `useMemo` block (lines 39-47):

```typescript
const { inputTokens, outputTokens } = useMemo(() => {
  let input = agent.tokenUsage.input;
  let output = agent.tokenUsage.output;
  for (const a of children) {
    input += a.tokenUsage.input;
    output += a.tokenUsage.output;
  }
  // Fallback to transcript data when hook events lack token info.
  // 2s slack before startTime matches the pattern in UserPromptNode.
  if (input === 0 && output === 0 && transcript) {
    const windowStart = agent.startTime - 2000;
    const windowEnd = agent.endTime ?? agent.startTime + 600_000;
    for (const turn of transcript.turns) {
      if (
        turn.type === 'assistant' &&
        turn.timestamp >= windowStart &&
        turn.timestamp < windowEnd
      ) {
        input += turn.totalInputTokens;
        output += turn.outputTokens;
      }
    }
  }
  return { inputTokens: input, outputTokens: output };
}, [children, agent.tokenUsage, agent.startTime, agent.endTime, transcript]);
```

- [ ] **Step 2: Run full test suite to verify no regressions**

Run: `cd apps/dashboard && npx vitest run`
Expected: All existing tests pass.

- [ ] **Step 3: Commit**

```bash
git add apps/dashboard/src/components/graph/nodes/AgentNode.tsx
git commit -m "fix(dashboard): add transcript fallback for agent node token display

Agent nodes showed 0 tokens for hook-sourced sessions because Claude Code
hooks don't include tokenUsage on agent_stop events. Now falls back to
transcript turn data (same pattern as UserPromptNode and SessionNode)."
```

---

### Task 2: Prevent orphaned nodes — add `suppressedSessionIds` to store

When a session is deleted via `removeNode`, we add its ID to a `suppressedSessionIds` Set. The `processEvent` function checks this set and skips events for suppressed sessions.

**Files:**

- Modify: `apps/dashboard/src/store/eventHandlers.ts` (add suppression check)
- Modify: `apps/dashboard/src/store/agentStore.ts` (add `suppressedSessionIds` to state, populate in `removeNode`, preserve in `loadEvents`)
- Test: `apps/dashboard/src/__tests__/eventHandlerNormalization.test.ts` (add test)
- Test: `apps/dashboard/src/store/__tests__/agentStore.test.ts` (add integration test, update resetStore)

- [ ] **Step 1: Write the failing unit test**

Add to `apps/dashboard/src/__tests__/eventHandlerNormalization.test.ts`:

```typescript
describe('suppressed session handling', () => {
  it('ensureSession does not recreate a suppressed session', () => {
    const draft = applyEvents([
      makeEvent({ type: 'session_start', sessionId: 'sess-1', timestamp: 1000 }),
      makeEvent({ type: 'user_prompt', sessionId: 'sess-1', text: 'hello', timestamp: 2000 }),
    ]);

    // Verify session exists
    expect(draft.sessions.has('sess-1')).toBe(true);

    // Simulate deletion: remove from draft and add to suppressed set
    draft.sessions.delete('sess-1');
    draft.nodes = draft.nodes.filter(
      (n) => !n.id.startsWith('session-sess-1') && !n.id.startsWith('prompt-'),
    );
    draft.edges = [];
    draft.prompts.delete('sess-1');
    draft.suppressedSessionIds = new Set(['sess-1']);

    // New event arrives for deleted session
    processEvent(
      makeEvent({ type: 'user_prompt', sessionId: 'sess-1', text: 'new prompt', timestamp: 5000 }),
      draft,
      true,
    );

    // Session should NOT be recreated
    expect(draft.sessions.has('sess-1')).toBe(false);
    // No new prompt node should exist
    expect(draft.nodes.some((n) => n.id.includes('prompt-'))).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/dashboard && npx vitest run src/__tests__/eventHandlerNormalization.test.ts`
Expected: FAIL — `suppressedSessionIds` doesn't exist on `StateDraft` yet.

- [ ] **Step 3: Add `suppressedSessionIds` to StateDraft**

In `apps/dashboard/src/store/eventHandlers.ts`:

Add to the `StateDraft` interface:

```typescript
/** Session IDs that were explicitly deleted — skip events for these */
suppressedSessionIds: Set<string>;
```

Add to `createFreshDraft()`:

```typescript
    suppressedSessionIds: new Set(),
```

Add to `draftFromState()`:

```typescript
    suppressedSessionIds: new Set(state.suppressedSessionIds),
```

- [ ] **Step 4: Add suppression check to processEvent**

In `processEvent()`, add an early return at the top of the function (before the hook visibility check):

```typescript
// Skip events for sessions that were explicitly deleted by the user
if (draft.suppressedSessionIds.has(event.sessionId)) return;
```

- [ ] **Step 5: Run unit test to verify it passes**

Run: `cd apps/dashboard && npx vitest run src/__tests__/eventHandlerNormalization.test.ts`
Expected: PASS

- [ ] **Step 6: Add `suppressedSessionIds` to AgentStore interface and initial state**

In `apps/dashboard/src/store/agentStore.ts`:

Add to `AgentStore` interface (near the other Set fields):

```typescript
suppressedSessionIds: Set<string>;
```

Add to initial state in `create<AgentStore>`:

```typescript
  suppressedSessionIds: new Set<string>(),
```

- [ ] **Step 7: Populate `suppressedSessionIds` in `removeNode`**

In `apps/dashboard/src/store/agentStore.ts`, in the `removeNode` method, after the `removedSessionIds` Set is built (~line 731), add:

```typescript
// Suppress future events for deleted sessions
const suppressedSessionIds = new Set(state.suppressedSessionIds);
for (const sid of removedSessionIds) {
  suppressedSessionIds.add(sid);
}
```

Include `suppressedSessionIds` in the `set()` call at ~line 740.

- [ ] **Step 8: Preserve `suppressedSessionIds` in `loadEvents` and `clearEvents`**

In `loadEvents` (~line 884), the `set({ ...draft, ... })` call spreads `createFreshDraft()` which has an empty `suppressedSessionIds`. This would clear the suppression set on reload, allowing WS events that arrive between the DELETE call and reload to recreate phantom nodes. Fix by preserving the existing set:

After line 883 (`const eventIds = ...`), add:

```typescript
// Preserve suppression set across reloads — backend DELETE removes persisted events
// but live WS events may still arrive for recently-deleted sessions
const { suppressedSessionIds } = prevState;
```

And include `suppressedSessionIds` in the `set()` call.

In `clearEvents` (~line 820-840), also preserve it:

```typescript
    suppressedSessionIds: get().suppressedSessionIds,
```

- [ ] **Step 9: Add `suppressedSessionIds` to resetStore in test helper**

In `apps/dashboard/src/store/__tests__/agentStore.test.ts`, add to `resetStore()`:

```typescript
    suppressedSessionIds: new Set<string>(),
```

- [ ] **Step 10: Write integration test**

Add to `apps/dashboard/src/store/__tests__/agentStore.test.ts`:

```typescript
describe('session deletion suppression', () => {
  beforeEach(() => resetStore());

  it('suppresses events for deleted sessions', () => {
    const store = useAgentStore.getState();

    // Create a session with events
    store.addEvent({
      id: 'e1',
      type: 'session_start',
      sessionId: 'sess-del',
      timestamp: 1000,
    });
    store.addEvent({
      id: 'e2',
      type: 'user_prompt',
      sessionId: 'sess-del',
      text: 'hello',
      timestamp: 2000,
    });

    expect(useAgentStore.getState().sessions.has('sess-del')).toBe(true);

    // Delete the session
    store.removeSession('sess-del');

    expect(useAgentStore.getState().sessions.has('sess-del')).toBe(false);
    expect(useAgentStore.getState().suppressedSessionIds.has('sess-del')).toBe(true);

    // New event arrives for deleted session
    store.addEvent({
      id: 'e3',
      type: 'user_prompt',
      sessionId: 'sess-del',
      text: 'ghost prompt',
      timestamp: 5000,
    });

    // Session should NOT be recreated
    expect(useAgentStore.getState().sessions.has('sess-del')).toBe(false);
    // No prompt nodes for this session
    expect(useAgentStore.getState().nodes.some((n) => n.id.includes('sess-del'))).toBe(false);
  });
});
```

- [ ] **Step 11: Run full test suite**

Run: `cd apps/dashboard && npx vitest run`
Expected: All tests pass.

- [ ] **Step 12: Commit**

```bash
git add apps/dashboard/src/store/eventHandlers.ts apps/dashboard/src/store/agentStore.ts apps/dashboard/src/__tests__/eventHandlerNormalization.test.ts apps/dashboard/src/store/__tests__/agentStore.test.ts
git commit -m "fix(dashboard): prevent orphaned nodes after session deletion

When a session is deleted while still active, new events for that session
are now suppressed instead of recreating a phantom placeholder session.
Adds suppressedSessionIds Set to store, populated by removeNode, checked
by processEvent, and preserved across loadEvents/clearEvents."
```

---

### Task 3: Final verification

- [ ] **Step 1: Run complete test suite**

Run: `pnpm test`
Expected: All tests pass across all packages.

- [ ] **Step 2: Manual smoke test (optional)**

1. Start server and dashboard
2. Run a Claude Code session → verify token counts appear on nodes (requires transcript to be loaded)
3. Delete a session node → verify no phantom nodes reappear when new events arrive
4. Check cost waterfall still works with transcript data

---

## Open Questions / Deferred

- **P2: `suppressedSessionIds` grows unboundedly** — Every deleted session adds to the set. Could cap at 50 or prune entries older than 1 hour. Low priority since entries are tiny strings and sessions are rarely deleted.
- **P2: No visual feedback for suppressed events** — Events for deleted sessions are silently dropped. Could add a subtle toast. The current silent behavior is arguably correct UX.
- **P2: Agent time-window 2s slack** — The `agent.startTime - 2000` fudge in the transcript fallback could match turns from a different agent in rare cases. Matches existing pattern in `UserPromptNode`.
