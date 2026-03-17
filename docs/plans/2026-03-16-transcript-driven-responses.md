# Transcript-Driven Response Threading

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace hook-based assistant response ingestion with transcript-derived, parentUuid-grouped response data — giving every prompt its exact responses, reasoning, and tool calls.

**Architecture:** Add a new endpoint `GET /api/transcript/:sessionId/prompt-turns` that groups assistant `ReasoningTurn`s by their parent user message `uuid`, matched to hook-derived prompt nodes by timestamp + text confirmation. The frontend fetches this once at the graph level and passes groups down to prompt nodes, replacing the current hook-based `AssistantResponseData` for display.

**Tech Stack:** Existing transcript reader, thinkingParser, ReasoningTurn types. No new dependencies.

---

## Context & Motivation

### The Problem

Currently, assistant responses in prompt nodes come from hook events (`Stop` → `last_assistant_message`). This has three issues:

1. **Incomplete data** — `Stop` fires once per turn, but Claude may produce multiple assistant messages per prompt (thinking, partial responses, tool-interleaved text). We only get the last one.
2. **Fragile matching** — Responses are matched to prompts by timestamp proximity (`last prompt with timestamp <= response`), which breaks with async events or clock skew.
3. **Redundant data path** — The transcript already contains ALL responses with exact `parentUuid` linking, structured thinking, tool calls, and token usage. The `PromptReasoningSummary` component already fetches this but uses a "within 5 minutes" heuristic (line 58 of `PromptReasoningSummary.tsx`).

### The Solution

Use the transcript as source of truth for response data. The transcript has:

- `ConversationRecord` with `type: 'user'` → user prompts (with `uuid`)
- `ConversationRecord` with `type: 'assistant'` → responses (with `parentUuid` pointing to user message)
- Full content: thinking blocks, text blocks, tool_use blocks
- Token usage per turn

The new endpoint groups assistant turns by their parent user message, then matches these groups to hook-derived prompt nodes by timestamp (primary) with text confirmation (secondary).

### Do We Still Need Response Hooks?

**Short answer: Yes, but only for real-time preview.**

| Aspect       | Hooks (Stop event)  | Transcript                |
| ------------ | ------------------- | ------------------------- |
| Latency      | Real-time           | Slight delay (file write) |
| Completeness | Last message only   | All messages              |
| Accuracy     | Timestamp heuristic | Exact parentUuid link     |
| Richness     | Plain text          | Thinking + tools + usage  |

**Decision:** Keep the `Stop` → `assistant_response` hook mapping in `packages/server/src/adapters/claude.ts` as a real-time "preview" — shows the latest response immediately in the prompt node before the transcript is available. The frontend shows hook-derived response immediately, then silently merges transcript data when it arrives (append new responses, don't replace existing). No new hooks needed — `AssistantResponse` hook event is unnecessary since `Stop` covers real-time and transcript covers completeness.

---

## Phasing

<!-- revised: split into Phase 1 (ship-blocking fix) and Phase 2 (enhancement) per PM review -->

| Phase       | Tasks | Goal                                                                                 |
| ----------- | ----- | ------------------------------------------------------------------------------------ |
| **Phase 1** | T1–T5 | Fix missing responses in prompt nodes using transcript data                          |
| **Phase 2** | T6–T8 | Unified Inspector: scoped reasoning + response text in prompt, reasoning in response |

Ship and test Phase 1 independently before starting Phase 2.

**Phase 1 success criteria:** Every prompt node in a live session shows at least one response within 10 seconds of the first poll.

---

## File Structure

| Action | File                                                              | Responsibility                                                                        |
| ------ | ----------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| Modify | `packages/core/src/types/transcript.ts`                           | Add `PromptTurnGroup` type                                                            |
| Modify | `packages/server/src/routes/transcript.ts`                        | Extract shared helpers, add `/:sessionId/prompt-turns` endpoint, add transcript cache |
| Create | `apps/dashboard/src/hooks/usePromptTurns.ts`                      | Shared hook for fetching prompt-turn groups (called once per session)                 |
| Modify | `apps/dashboard/src/components/graph/AgentGraph.tsx`              | Lift `usePromptTurns` to graph level, pass groups via context or props                |
| Modify | `apps/dashboard/src/components/graph/nodes/UserPromptNode.tsx`    | Use transcript response text for collapsed preview                                    |
| Modify | `apps/dashboard/src/components/panels/PromptReasoningSummary.tsx` | Fetch from new endpoint, use exact grouping                                           |
| Modify | `apps/dashboard/src/components/panels/ReasoningSection.tsx`       | Accept optional `promptText` filter prop                                              |

---

## Phase 1: Fix Missing Responses

### Task 1: Add `PromptTurnGroup` Type

**Files:**

- Modify: `packages/core/src/types/transcript.ts`

- [ ] **Step 1: Add the type definition**

```typescript
/** A user prompt with all its assistant responses grouped by parentUuid */
export interface PromptTurnGroup {
  /** uuid of the user ConversationRecord */
  promptUuid: string;
  /** Timestamp of the user message */
  promptTimestamp: number;
  /** Text content of the user prompt (for matching to hook-derived prompt nodes) */
  promptText: string;
  /** Assistant turns linked to this prompt (direct parentUuid or via tool_result chain) */
  turns: ReasoningTurn[];
  /** Aggregate response text (all text blocks concatenated) */
  responseText: string | null;
}

export interface PromptTurnData {
  sessionId: string;
  groups: PromptTurnGroup[];
}
```

- [ ] **Step 2: Export from core index**

Ensure `PromptTurnGroup` and `PromptTurnData` are exported from `packages/core/src/index.ts`.

- [ ] **Step 3: Commit**

```bash
git add packages/core/src/types/transcript.ts packages/core/src/index.ts
git commit -m "feat(core): add PromptTurnGroup type for transcript-driven response grouping"
```

### Task 2: Extract Shared Helpers from `/reasoning` Endpoint

<!-- revised: refactor first, then reuse in new endpoint — prevents duplication from being shipped -->

**Files:**

- Modify: `packages/server/src/routes/transcript.ts`

- [ ] **Step 1: Extract `buildToolResultMap` helper**

```typescript
/** Build tool_use_id → tool_result lookup from conversation records */
function buildToolResultMap(
  conversations: ConversationRecord[],
): Map<string, { content: string; is_error: boolean; timestamp: number }> {
  const map = new Map<string, { content: string; is_error: boolean; timestamp: number }>();
  for (const conv of conversations) {
    for (const block of conv.content) {
      if (block.type === 'tool_result') {
        map.set(block.tool_use_id, {
          content: block.content,
          is_error: block.is_error,
          timestamp: conv.timestamp,
        });
      }
    }
  }
  return map;
}
```

- [ ] **Step 2: Extract `buildReasoningTurn` helper**

```typescript
/**
 * Convert an assistant ConversationRecord into a ReasoningTurn.
 * @param keepTextOnly - If true, keep turns that are pure text (no thinking/tools).
 *   /reasoning passes false (original behavior), /prompt-turns passes true
 *   so simple replies like "Done." aren't dropped.
 */
function buildReasoningTurn(
  conv: ConversationRecord,
  toolResultMap: Map<string, { content: string; is_error: boolean; timestamp: number }>,
  keepTextOnly = false,
): ReasoningTurn | null {
  const thinkingBlocks = conv.content.filter((b) => b.type === 'thinking');
  const textBlocks = conv.content.filter((b) => b.type === 'text');
  const toolUseBlocks = conv.content.filter((b) => b.type === 'tool_use');

  // Skip empty turns; skip text-only turns unless keepTextOnly is set
  const hasContent = thinkingBlocks.length > 0 || toolUseBlocks.length > 0;
  if (!hasContent && (!keepTextOnly || textBlocks.length === 0)) return null;

  const thinkingText =
    thinkingBlocks.map((b) => (b.type === 'thinking' ? b.thinking : '')).join('\n\n') || null;
  const responseText =
    textBlocks.map((b) => (b.type === 'text' ? b.text : '')).join('\n\n') || null;

  const toolCalls: ReasoningToolCall[] = toolUseBlocks
    .filter((b): b is Extract<typeof b, { type: 'tool_use' }> => b.type === 'tool_use')
    .map((b) => {
      const result = toolResultMap.get(b.id);
      return {
        id: b.id,
        name: b.name,
        input: b.input,
        resultContent: result?.content ?? null,
        isError: result?.is_error ?? false,
        durationMs: result ? result.timestamp - conv.timestamp : null,
      };
    });

  return {
    uuid: conv.uuid,
    parentUuid: conv.parentUuid,
    timestamp: conv.timestamp,
    model: conv.model,
    isSidechain: conv.isSidechain,
    isApiErrorMessage: conv.isApiErrorMessage,
    error: conv.error,
    thinkingText,
    structured: parseThinking(thinkingText),
    responseText,
    toolCalls,
    usage: {
      inputTokens: conv.usage.inputTokens,
      outputTokens: conv.usage.outputTokens,
      cacheReadTokens: conv.usage.cacheReadTokens,
      cacheCreationTokens: conv.usage.cacheCreationTokens ?? 0,
      thinkingTokens: conv.usage.thinkingTokens ?? 0,
    },
  };
}
```

- [ ] **Step 3: Refactor `/reasoning` endpoint to use helpers**

Replace inline logic with `buildToolResultMap` + `buildReasoningTurn` calls. Verify no behavioral change.

- [ ] **Step 4: Run existing tests**

```bash
pnpm test
```

Expected: All tests pass (no behavioral change).

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/routes/transcript.ts
git commit -m "refactor(server): extract shared helpers from /reasoning endpoint"
```

### Task 3: Add `/prompt-turns` Endpoint with parentUuid Chain Walking

<!-- revised: properly walk parentUuid chain instead of skipping orphaned turns -->

**Files:**

- Modify: `packages/server/src/routes/transcript.ts`

- [ ] **Step 1: Write the endpoint using shared helpers**

```typescript
// GET /api/transcript/:sessionId/prompt-turns — responses grouped by parent prompt
router.get('/:sessionId/prompt-turns', async (req: Request, res: Response) => {
  try {
    const sessionId = req.params.sessionId as string;
    const transcriptPath = await resolveTranscriptPath(sessionId);
    if (!transcriptPath) {
      res.status(404).json({ error: 'Transcript not found', sessionId });
      return;
    }
    const full = await readFullTranscript(transcriptPath, sessionId);
    const toolResultMap = buildToolResultMap(full.conversations);

    // Index ALL conversation records by uuid for chain walking
    const allRecords = new Map<string, ConversationRecord>();
    for (const conv of full.conversations) {
      allRecords.set(conv.uuid, conv);
    }

    // Index user messages by uuid
    const userMessages = new Map<string, { uuid: string; timestamp: number; text: string }>();
    for (const conv of full.conversations) {
      if (conv.type !== 'user') continue;
      const text = conv.content
        .filter((b) => b.type === 'text')
        .map((b) => (b.type === 'text' ? b.text : ''))
        .join('\n');
      userMessages.set(conv.uuid, { uuid: conv.uuid, timestamp: conv.timestamp, text });
    }

    // Walk parentUuid chain to find the root user message
    function findRootUserUuid(startUuid: string): string | null {
      let current = startUuid;
      const visited = new Set<string>(); // cycle guard
      while (current && !visited.has(current)) {
        if (userMessages.has(current)) return current;
        visited.add(current);
        const record = allRecords.get(current);
        if (!record?.parentUuid) return null;
        current = record.parentUuid;
      }
      return null;
    }

    // Group assistant turns by root user message
    const groupMap = new Map<string, ReasoningTurn[]>();
    for (const conv of full.conversations) {
      if (conv.type !== 'assistant') continue;
      if (!conv.parentUuid) continue;

      const turn = buildReasoningTurn(conv, toolResultMap, /* keepTextOnly */ true);
      if (!turn) continue; // Completely empty turn

      const rootUuid = findRootUserUuid(conv.parentUuid);
      if (!rootUuid) continue; // Truly orphaned

      const existing = groupMap.get(rootUuid) ?? [];
      existing.push(turn);
      groupMap.set(rootUuid, existing);
    }

    // Build PromptTurnGroup[] ordered by timestamp
    const groups: PromptTurnGroup[] = [];
    for (const [uuid, turns] of groupMap) {
      const user = userMessages.get(uuid);
      if (!user) continue;
      const allResponseText =
        turns
          .map((t) => t.responseText)
          .filter(Boolean)
          .join('\n\n') || null;
      groups.push({
        promptUuid: uuid,
        promptTimestamp: user.timestamp,
        promptText: user.text,
        turns: turns.sort((a, b) => a.timestamp - b.timestamp),
        responseText: allResponseText,
      });
    }
    groups.sort((a, b) => a.promptTimestamp - b.promptTimestamp);

    res.json({ sessionId, groups } satisfies PromptTurnData);
  } catch (err: unknown) {
    if (err instanceof Error && 'code' in err && (err as NodeJS.ErrnoException).code === 'ENOENT') {
      res
        .status(404)
        .json({ error: 'Transcript not found', sessionId: req.params.sessionId as string });
      return;
    }
    logger.error({ err }, 'Prompt-turns endpoint error');
    res.status(500).json({ error: 'Transcript read failed' });
  }
});
```

- [ ] **Step 2: Add file-stat-based transcript cache**

<!-- revised: cache transcript parsing to avoid re-reading JSONL on every poll -->

Add a module-level cache above both endpoints:

```typescript
const transcriptCache = new Map<
  string,
  {
    mtime: number;
    size: number;
    result: FullTranscript;
    cachedAt: number;
  }
>();
const CACHE_TTL = 5000; // 5 seconds

async function getCachedTranscript(
  transcriptPath: string,
  sessionId: string,
): Promise<FullTranscript> {
  const stat = await fs.promises.stat(transcriptPath);
  const key = transcriptPath;
  const cached = transcriptCache.get(key);
  if (
    cached &&
    cached.mtime === stat.mtimeMs &&
    cached.size === stat.size &&
    Date.now() - cached.cachedAt < CACHE_TTL
  ) {
    return cached.result;
  }
  const result = await readFullTranscript(transcriptPath, sessionId);
  transcriptCache.set(key, { mtime: stat.mtimeMs, size: stat.size, result, cachedAt: Date.now() });
  return result;
}
```

Replace `readFullTranscript` calls in both `/reasoning` and `/prompt-turns` with `getCachedTranscript`.

- [ ] **Step 3: Test manually**

```bash
curl http://localhost:27246/api/transcript/<sessionId>/prompt-turns | jq '.groups | length'
curl http://localhost:27246/api/transcript/<sessionId>/prompt-turns | jq '.groups[0] | {promptText: .promptText[:80], turnCount: (.turns | length), hasResponse: (.responseText != null)}'
```

Verify each group has `promptText` matching a user prompt and `turns` containing the assistant responses.

- [ ] **Step 4: Commit**

```bash
git add packages/server/src/routes/transcript.ts
git commit -m "feat(server): add /prompt-turns endpoint with parentUuid chain walking and transcript cache"
```

### Task 4: Create `usePromptTurns` Hook (Session-Level)

<!-- revised: hook is called once per session at graph level, not per prompt node -->

**Files:**

- Create: `apps/dashboard/src/hooks/usePromptTurns.ts`
- Modify: `apps/dashboard/src/components/graph/AgentGraph.tsx`

- [ ] **Step 1: Write the hook**

```typescript
import { useState, useEffect, useRef } from 'react';
import type { PromptTurnData, PromptTurnGroup } from '@synapse-ai/core';
import { apiUrl } from '../utils/api.js';

const POLL_INTERVAL = 8000; // 8 seconds — transcript updates are less frequent than events

export function usePromptTurns(sessionId: string | undefined): PromptTurnGroup[] {
  const [groups, setGroups] = useState<PromptTurnGroup[]>([]);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (!sessionId) return;

    const fetchData = () => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      fetch(apiUrl(`/api/transcript/${sessionId}/prompt-turns`), { signal: controller.signal })
        .then((r) => (r.ok ? r.json() : null))
        .then((d: PromptTurnData | null) => {
          if (d && !controller.signal.aborted) setGroups(d.groups);
        })
        .catch(() => {
          /* silently fail — transcript data is optional enhancement */
        });
    };

    fetchData();
    const timer = setInterval(fetchData, POLL_INTERVAL);
    return () => {
      clearInterval(timer);
      abortRef.current?.abort();
    };
  }, [sessionId]);

  return groups;
}
```

- [ ] **Step 2: Call hook in AgentGraph and pass groups to prompt nodes**

In `AgentGraph.tsx`, call `usePromptTurns` once with the active session ID. Pass the groups array to `UserPromptNode` via node data or React context. Do NOT call the hook inside individual prompt nodes.

```typescript
// In AgentGraph.tsx:
const promptTurnGroups = usePromptTurns(activeSessionId);

// Pass to nodes via nodeData or context — implementation depends on
// how AgentGraph currently passes data to custom nodes.
```

- [ ] **Step 3: Commit**

```bash
git add apps/dashboard/src/hooks/usePromptTurns.ts apps/dashboard/src/components/graph/AgentGraph.tsx
git commit -m "feat(dashboard): add usePromptTurns hook at graph level"
```

### Task 5: Match Transcript Groups to Prompt Nodes

<!-- revised: use timestamp-first matching with text confirmation -->

**Files:**

- Modify: `apps/dashboard/src/components/graph/nodes/UserPromptNode.tsx`

- [ ] **Step 1: Add matching logic using timestamp + text confirmation**

```typescript
// Inside UserPromptNode, receive promptTurnGroups from props/context:
const transcriptGroup = useMemo(() => {
  if (!promptTurnGroups.length || !prompt.text) return null;

  // Primary match: timestamp within ±2 seconds
  const candidates = promptTurnGroups.filter(
    (g) => Math.abs(g.promptTimestamp - prompt.timestamp) < 5000,
  );

  if (candidates.length === 1) return candidates[0];

  // Tiebreaker: text prefix confirmation
  if (candidates.length > 1) {
    const promptPrefix = prompt.text.slice(0, 80).toLowerCase();
    return (
      candidates.find(
        (g) =>
          g.promptText.toLowerCase().startsWith(promptPrefix) ||
          promptPrefix.startsWith(g.promptText.slice(0, 80).toLowerCase()),
      ) ?? candidates[0]
    ); // Fall back to first timestamp match
  }

  // Fallback: text-only match (timestamps may differ due to clock skew)
  const promptPrefix = prompt.text.slice(0, 80).toLowerCase();
  return (
    promptTurnGroups.find(
      (g) =>
        g.promptText.toLowerCase().startsWith(promptPrefix) ||
        promptPrefix.startsWith(g.promptText.slice(0, 80).toLowerCase()),
    ) ?? null
  );
}, [promptTurnGroups, prompt.text, prompt.timestamp]);
```

- [ ] **Step 2: Update collapsed response section**

Show hook-derived response immediately. When transcript data arrives, append any additional responses (don't replace the hook-derived one to avoid visual jumps). Show the last response's text as the preview, with a count badge for total turns.

```typescript
// Merge: hook responses + transcript turns, deduplicated
const displayResponseText = transcriptGroup?.responseText ?? responses[0]?.text ?? null;
const displayTurnCount = transcriptGroup?.turns.length ?? responses.length;

// In the collapsed section, show last response preview + count:
// "Claude ▸  [3 responses]"
// "The change is in the dashboard store code — if..."
```

- [ ] **Step 3: Test visually**

Refresh the dashboard with a live session. Each prompt node should now show all response text from the transcript. Verify:

- Responses appear even for prompts that previously showed none
- No visual jump when transcript data arrives after hook data
- Short prompts ("yes", "ok") still match correctly

- [ ] **Step 4: Commit**

```bash
git add apps/dashboard/src/components/graph/nodes/UserPromptNode.tsx
git commit -m "feat(dashboard): use transcript-derived responses in prompt nodes with timestamp+text matching"
```

---

## Phase 2: Unified Inspector Experience

### Task 6: Replace Timestamp Heuristic in PromptReasoningSummary

**Files:**

- Modify: `apps/dashboard/src/components/panels/PromptReasoningSummary.tsx`
- Modify: `apps/dashboard/src/components/panels/AgentDetailPanel.tsx`

- [ ] **Step 1: Switch to prompt-turns endpoint**

Replace the current fetch of `/reasoning` + 5-minute timestamp filter with a fetch of `/prompt-turns` + timestamp+text match.

```typescript
interface PromptReasoningSummaryProps {
  sessionId: string;
  promptText: string; // Changed from promptTimestamp
  promptTimestamp: number; // Keep for matching
}

// Fetch /prompt-turns instead of /reasoning
// Find group by timestamp + text match
const relevantTurns = useMemo(() => {
  if (!data?.groups.length || !promptText) return [];

  // Same matching logic as UserPromptNode
  const candidates = data.groups.filter(
    (g) => Math.abs(g.promptTimestamp - promptTimestamp) < 5000,
  );
  if (candidates.length === 1) return candidates[0].turns;

  const prefix = promptText.slice(0, 80).toLowerCase();
  const match = (candidates.length > 1 ? candidates : data.groups).find((g) =>
    g.promptText.toLowerCase().startsWith(prefix),
  );
  return match?.turns ?? [];
}, [data, promptText, promptTimestamp]);
```

- [ ] **Step 2: Update callers**

In `AgentDetailPanel.tsx`:

```typescript
<PromptReasoningSummary
  sessionId={foundPrompt.sessionId}
  promptText={foundPrompt.text}
  promptTimestamp={foundPrompt.timestamp}
/>
```

- [ ] **Step 3: Commit**

```bash
git add apps/dashboard/src/components/panels/PromptReasoningSummary.tsx apps/dashboard/src/components/panels/AgentDetailPanel.tsx
git commit -m "fix(dashboard): replace timestamp heuristic with exact transcript grouping in PromptReasoningSummary"
```

### Task 7: Scope ReasoningSection to a Single Prompt

**Files:**

- Modify: `apps/dashboard/src/components/panels/ReasoningSection.tsx`

- [ ] **Step 1: Add optional `promptText` and `promptTimestamp` props**

```typescript
interface ReasoningSectionProps {
  sessionId: string;
  promptText?: string; // If provided, filters to turns for this prompt only
  promptTimestamp?: number; // Used alongside promptText for matching
}
```

When `promptText` is set, fetch `/prompt-turns` instead of `/reasoning` and filter to the matching group's turns. When not set, keep existing behavior (all turns for session).

- [ ] **Step 2: Commit**

```bash
git add apps/dashboard/src/components/panels/ReasoningSection.tsx
git commit -m "feat(dashboard): scope ReasoningSection to single prompt via promptText filter"
```

### Task 8: Add Response Text to Prompt Inspector + Reasoning to Response Inspector

**Files:**

- Modify: `apps/dashboard/src/components/panels/AgentDetailPanel.tsx`

- [ ] **Step 1: Add transcript response text to prompt Inspector Stats tab**

In the PromptDetailView, after the PromptReasoningSummary, show the transcript-derived response text using `formatPanelText`. Use the `usePromptTurnsContext` to get the matching group.

- [ ] **Step 2: Add structured reasoning to response Inspector**

In the response detail section, look up the matching transcript turn for the response (by timestamp/text) and show intent + decision blocks above the response text, using the same card styling as ReasoningSection's StructuredTurnCard.

- [ ] **Step 3: Commit**

```bash
git add apps/dashboard/src/components/panels/AgentDetailPanel.tsx
git commit -m "feat(dashboard): unified Inspector — response text in prompt view, reasoning in response view"
```

---

## Open Questions / Deferred

<!-- P2 findings — address incrementally -->

1. **Unit test for `/prompt-turns` endpoint** — The endpoint has complex grouping logic (parentUuid chain walking, group building). A test with a mock transcript JSONL would catch regressions. Defer to a follow-up since we can test manually with live data first.

2. **ETag / 304 support** — The 8-second poll returns the full response body every time. An ETag based on transcript file mtime would let the server return `304 Not Modified` for unchanged transcripts, reducing bandwidth. Low priority since this is localhost-only.

3. **Collapsed node height with many turns** — With transcript data surfacing 5-10 assistant turns per prompt, the collapsed prompt node could become tall. Consider showing only the last response with a count badge (e.g., "3 turns") instead of all responses.

---

## Testing Checklist

### Phase 1

- [ ] `/prompt-turns` endpoint returns groups for a live session with 3+ prompts
- [ ] Each group has correct `promptText` matching the user's message
- [ ] Each group's `turns` array has all assistant responses (not just the last one)
- [ ] parentUuid chain walking correctly groups tool-interleaved turns
- [ ] Prompt nodes in the graph show transcript-derived response text
- [ ] Prompt nodes still show hook-derived response as fallback when transcript isn't available yet
- [ ] No visual jump when transcript data arrives after hook data
- [ ] Short prompts ("yes", "ok") match correctly via timestamp tiebreaker (±5s window)
- [ ] Text-only responses (no thinking/tools) like "Done." appear in groups
- [ ] Transcript cache prevents redundant file I/O on repeated polls
- [ ] Transcript cache uses async stat (no blocking I/O on event loop)
- [ ] `usePromptTurns` is called once per session (at graph level), not per prompt node
- [ ] No regression in existing `/reasoning` endpoint after helper extraction

### Phase 2

- [ ] PromptReasoningSummary shows per-prompt reasoning (not session-wide)
- [ ] ReasoningSection in prompt detail panel shows only that prompt's thinking
- [ ] No regression in session-level ReasoningSection (agent detail panel)
