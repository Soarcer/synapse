# Session Intelligence — Transcript-Enriched Graph

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Enrich the graph with transcript data — reasoning tooltips on tools, sidechain cost badges on edges, compaction indicators on agents, isMeta filtering in analytics, and human-readable session names.

**Architecture:** On-demand transcript fetching feeds a `transcriptDetails` cache in the store. Graph nodes and edges consume enrichment data via lightweight selectors. Server-side parsing adds `isMeta` to the existing `TranscriptTurn` type. Session names derive from first user prompt text, `slug`, or `git_branch` metadata already flowing through the system.

**Tech Stack:** React 19, Zustand 5, @xyflow/react v12, Express 5, Vitest, Tailwind CSS 4

---

## Task 1: Add `isMeta` to TranscriptTurn (server)

Adds the `isMeta` boolean to the lightweight v1 turn type so all consumers can filter system-injected turns without needing full ConversationRecord[].

**Files:**
- Modify: `packages/core/src/types/transcript.ts:6-32`
- Modify: `packages/server/src/services/transcriptReader.ts:184-240`
- Test: `packages/server/src/__tests__/transcriptReader.test.ts`

**Step 1: Write the failing test**

In `packages/server/src/__tests__/transcriptReader.test.ts`, add a test that verifies `isMeta` appears on parsed turns:

```typescript
it('should include isMeta flag on TranscriptTurn', async () => {
  const jsonl = [
    JSON.stringify({
      type: 'user',
      uuid: 'u1',
      timestamp: '2026-02-20T10:00:00Z',
      sessionId: 'sess1',
      isMeta: true,
      message: { role: 'user', content: [{ type: 'text', text: '/skill expansion' }] },
    }),
    JSON.stringify({
      type: 'assistant',
      uuid: 'a1',
      timestamp: '2026-02-20T10:00:01Z',
      sessionId: 'sess1',
      isMeta: false,
      message: {
        model: 'claude-opus-4-6',
        role: 'assistant',
        content: [{ type: 'text', text: 'Real response' }],
        usage: { input_tokens: 100, output_tokens: 50 },
      },
    }),
  ].join('\n');

  const result = await readTranscript(jsonl, 'sess1');
  expect(result.turns[0].isMeta).toBe(true);
  expect(result.turns[1].isMeta).toBe(false);
});
```

**Step 2: Run test to verify it fails**

Run: `cd /c/Workspace/Coding/Prototypes/Synapse && pnpm vitest run packages/server/src/__tests__/transcriptReader.test.ts -t "isMeta"`
Expected: FAIL — `isMeta` property does not exist on `TranscriptTurn`

**Step 3: Add `isMeta` to the TranscriptTurn interface**

In `packages/core/src/types/transcript.ts`, add after line 31 (`cacheHitRate`):

```typescript
  // Context flags (from v2 ConversationRecord, propagated to v1 for filtering)
  isMeta: boolean;
```

**Step 4: Set `isMeta` in parseTurn()**

In `packages/server/src/services/transcriptReader.ts`, inside the return object of `parseTurn()` (around line 221-239), add:

```typescript
    isMeta: record.isMeta === true,
```

**Step 5: Run test to verify it passes**

Run: `cd /c/Workspace/Coding/Prototypes/Synapse && pnpm vitest run packages/server/src/__tests__/transcriptReader.test.ts -t "isMeta"`
Expected: PASS

**Step 6: Commit**

```bash
git add packages/core/src/types/transcript.ts packages/server/src/services/transcriptReader.ts packages/server/src/__tests__/transcriptReader.test.ts
git commit -m "feat(core): add isMeta flag to TranscriptTurn for analytics filtering"
```

---

## Task 2: Filter isMeta from analytics computations

Uses the new `isMeta` field to exclude system-injected turns from cost and complexity calculations, resolving the TODO in lensComputations.

**Files:**
- Modify: `apps/dashboard/src/components/lens/lensComputations.ts:259-262`
- Modify: `apps/dashboard/src/components/analytics/shared/promptUtils.ts` (if it uses transcript turns)
- Test: `apps/dashboard/src/__tests__/lensComputations.test.ts` (create if needed)

**Step 1: Write the failing test**

Create or add to a lens computations test file:

```typescript
import { buildCostPerTurn } from '../components/lens/lensComputations';
import type { UserPromptData, AgentNodeData, TranscriptSummary } from '@synapse-ai/core';

describe('buildCostPerTurn isMeta filtering', () => {
  it('should exclude isMeta turns from transcript token matching', () => {
    const prompts = new Map<string, UserPromptData[]>([
      ['sess1', [{ id: 'p1', sessionId: 'sess1', text: 'hello', timestamp: 1000 }]],
    ]);
    const agents = new Map<string, AgentNodeData>();
    const compactEvents: [] = [];
    const transcripts = new Map<string, TranscriptSummary>([
      ['sess1', {
        turns: [
          { uuid: 'u1', timestamp: 1000, type: 'user', isMeta: true, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0, contentTypes: ['text'], toolNames: [], toolUseCount: 0, textLength: 20, thinkingLength: 0, totalInputTokens: 0, cacheHitRate: 0 },
          { uuid: 'a1', timestamp: 1001, type: 'assistant', isMeta: true, inputTokens: 5000, outputTokens: 2000, cacheReadTokens: 0, cacheCreationTokens: 0, contentTypes: ['text'], toolNames: [], toolUseCount: 0, textLength: 100, thinkingLength: 0, totalInputTokens: 5000, cacheHitRate: 0 },
          { uuid: 'a2', timestamp: 1002, type: 'assistant', isMeta: false, inputTokens: 1000, outputTokens: 500, cacheReadTokens: 0, cacheCreationTokens: 0, contentTypes: ['text'], toolNames: [], toolUseCount: 0, textLength: 50, thinkingLength: 0, totalInputTokens: 1000, cacheHitRate: 0 },
        ],
        // ... rest of summary fields with defaults
      } as TranscriptSummary],
    ]);

    const result = buildCostPerTurn(prompts, agents, compactEvents, transcripts);
    // The isMeta assistant turn (5000 input tokens) should be excluded
    // Only the real assistant turn (1000 input tokens) should count
    expect(result[0].transcriptInputTokens).toBeLessThan(3000);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd /c/Workspace/Coding/Prototypes/Synapse && pnpm vitest run apps/dashboard/src/__tests__/lensComputations.test.ts`
Expected: FAIL — isMeta turns are still included

**Step 3: Apply the filter in buildCostPerTurn**

In `apps/dashboard/src/components/lens/lensComputations.ts`, replace lines 259-262:

```typescript
    // Filter out isMeta records to prevent /skill invocations and system-injected
    // content from appearing as user prompts in the cost lens.
    const tTurns = transcript?.turns.filter((t) => t.type === 'assistant' && !t.isMeta) ?? [];
```

**Step 4: Run test to verify it passes**

Run: `cd /c/Workspace/Coding/Prototypes/Synapse && pnpm vitest run apps/dashboard/src/__tests__/lensComputations.test.ts`
Expected: PASS

**Step 5: Run full test suite to check for regressions**

Run: `cd /c/Workspace/Coding/Prototypes/Synapse && pnpm test`
Expected: All tests pass

**Step 6: Commit**

```bash
git add apps/dashboard/src/components/lens/lensComputations.ts apps/dashboard/src/__tests__/lensComputations.test.ts
git commit -m "fix(lens): filter isMeta turns from cost and analytics computations"
```

---

## Task 3: Session naming — add title, gitBranch, topTools to SessionData

Enriches `SessionData` so sessions can be displayed with human-readable names instead of truncated IDs.

**Files:**
- Modify: `packages/core/src/types/agent.ts:55-66`
- Modify: `apps/dashboard/src/store/eventHandlers.ts` (handleUserPrompt, handleSessionStart, handleToolEnd)
- Test: `apps/dashboard/src/store/__tests__/agentStore.test.ts`

**Step 1: Write the failing test**

In `apps/dashboard/src/store/__tests__/agentStore.test.ts`, add:

```typescript
it('should set session title from first user_prompt text', () => {
  const store = useAgentStore.getState();
  store.addEvent({
    id: 'e1', type: 'session_start', sessionId: 'sess1', timestamp: 1000,
  } as AgentEvent);
  store.addEvent({
    id: 'e2', type: 'user_prompt', sessionId: 'sess1', timestamp: 1001,
    text: 'Add dark mode toggle to the settings page with persistent state',
  } as AgentEvent);

  const session = useAgentStore.getState().sessions.get('sess1');
  expect(session?.title).toBe('Add dark mode toggle to the settings page wi...');
});

it('should set session gitBranch from session_start cwd or agent metadata', () => {
  const store = useAgentStore.getState();
  store.addEvent({
    id: 'e1', type: 'session_start', sessionId: 'sess1', timestamp: 1000,
    gitBranch: 'feat/dark-mode',
  } as AgentEvent);

  const session = useAgentStore.getState().sessions.get('sess1');
  expect(session?.gitBranch).toBe('feat/dark-mode');
});
```

**Step 2: Run test to verify it fails**

Run: `cd /c/Workspace/Coding/Prototypes/Synapse && pnpm vitest run apps/dashboard/src/store/__tests__/agentStore.test.ts -t "session title"`
Expected: FAIL — `title` and `gitBranch` don't exist on SessionData

**Step 3: Add fields to SessionData**

In `packages/core/src/types/agent.ts`, add to `SessionData` (after line 65):

```typescript
  title?: string;                 // Human-readable name from first prompt or slug
  gitBranch?: string;             // Git branch from transcript metadata
  topTools?: string[];            // Top 3 most-used tool names
```

**Step 4: Add fields to AgentEvent**

In `packages/core/src/types/agent.ts`, check if `AgentEvent` already has `gitBranch`. If not, add:

```typescript
  gitBranch?: string;
```

**Step 5: Set title in handleUserPrompt**

In `apps/dashboard/src/store/eventHandlers.ts`, inside `handleUserPrompt()`, after creating the prompt node, add:

```typescript
  // Set session title from first prompt text (if not already set)
  const session = draft.sessions.get(event.sessionId);
  if (session && !session.title && event.text) {
    const maxLen = 48;
    session.title = event.text.length > maxLen
      ? event.text.slice(0, maxLen - 3) + '...'
      : event.text;
  }
```

**Step 6: Set gitBranch in handleSessionStart**

In `apps/dashboard/src/store/eventHandlers.ts`, inside `handleSessionStart()`, add:

```typescript
  if (event.gitBranch) session.gitBranch = event.gitBranch;
```

**Step 7: Accumulate topTools in buildDerivedMaps**

In `apps/dashboard/src/store/eventHandlers.ts`, inside `buildDerivedMaps()`, after building `agentsBySession`, add logic to compute top-3 tool names per session and set them on the session:

```typescript
  // Compute topTools per session
  for (const [sessionId, sessionAgents] of agentsBySession) {
    const counts = new Map<string, number>();
    for (const a of sessionAgents) {
      for (const tc of a.toolCalls) {
        counts.set(tc.toolName, (counts.get(tc.toolName) ?? 0) + 1);
      }
    }
    const top3 = [...counts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([name]) => name);
    const session = state.sessions.get(sessionId);
    if (session && top3.length > 0) session.topTools = top3;
  }
```

**Step 8: Run tests to verify they pass**

Run: `cd /c/Workspace/Coding/Prototypes/Synapse && pnpm vitest run apps/dashboard/src/store/__tests__/agentStore.test.ts`
Expected: PASS

**Step 9: Commit**

```bash
git add packages/core/src/types/agent.ts apps/dashboard/src/store/eventHandlers.ts apps/dashboard/src/store/__tests__/agentStore.test.ts
git commit -m "feat(store): enrich SessionData with title, gitBranch, topTools"
```

---

## Task 4: Session naming — update SessionNode, SessionSelector, LensAdapter

Renders the new session metadata in all UI locations where sessions are identified.

**Files:**
- Modify: `apps/dashboard/src/components/graph/nodes/SessionNode.tsx:129-136`
- Modify: `apps/dashboard/src/components/layout/SessionSelector.tsx:89-110`
- Modify: `apps/dashboard/src/components/lens/LensAdapter.tsx:117`
- No new test file (visual verification + E2E)

**Step 1: Update SessionNode to show title instead of shortId**

In `apps/dashboard/src/components/graph/nodes/SessionNode.tsx`, replace the display section (around lines 129-136):

```tsx
      <div className="flex items-center gap-2 mt-0.5">
        <Tooltip content={isEnded ? 'Session ended' : 'Session active'}>
          <div
            className={`w-2.5 h-2.5 rounded-full shrink-0 ${isEnded ? 'bg-gray-500' : 'bg-blue-400 animate-pulse'}`}
          />
        </Tooltip>
        <div className="flex flex-col min-w-0">
          <span className="text-sm font-semibold text-gray-100 truncate max-w-[180px]">
            {session.title ?? shortId}
          </span>
          <div className="flex items-center gap-1.5">
            {session.gitBranch && (
              <span className="text-[9px] px-1.5 rounded bg-indigo-900/50 text-indigo-300 truncate max-w-[120px]">
                {session.gitBranch}
              </span>
            )}
            {session.source === 'resume' && (
              <span className="text-[9px] px-1 rounded bg-amber-900/40 text-amber-300">resumed</span>
            )}
            {session.title && (
              <span className="text-[9px] text-gray-600 font-mono">{shortId}</span>
            )}
          </div>
        </div>
      </div>
```

**Step 2: Add topTools pills to SessionNode stats footer**

In `apps/dashboard/src/components/graph/nodes/SessionNode.tsx`, add after the agent/tool count badges (around line 183), inside the stats footer:

```tsx
          {session.topTools && session.topTools.length > 0 && (
            <div className="flex items-center gap-0.5 ml-1">
              {session.topTools.map((t) => (
                <span key={t} className="px-1 py-0.5 rounded text-[8px] bg-gray-700/50 text-gray-400">{t}</span>
              ))}
            </div>
          )}
```

**Step 3: Update SessionSelector dropdown**

In `apps/dashboard/src/components/layout/SessionSelector.tsx`, enhance the dropdown items (around lines 97-108):

```tsx
              <div className="flex items-center gap-1.5">
                <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${s.isRunning ? 'bg-green-400 animate-pulse' : 'bg-gray-500'}`} />
                <span className={`text-xs truncate max-w-[160px] ${filter.sessionId === s.sessionId ? 'text-blue-300' : 'text-gray-200'}`}>
                  {s.title ?? s.sessionId.slice(0, 8)}
                </span>
              </div>
              <div className="flex items-center gap-2 mt-0.5 ml-3">
                <span className="text-[10px] text-gray-500">
                  {s.isRunning ? 'Running' : formatRelativeTime(s.startTime)} · {formatDuration(s.duration)}
                </span>
                {s.gitBranch && <span className="text-[10px] text-indigo-400">{s.gitBranch}</span>}
                {s.model && <span className="text-[10px] text-gray-600">{s.model}</span>}
              </div>
```

This requires adding `title` and `gitBranch` to the `sessionList` mapping. Find where `sessionList` is derived from `sessions` and add:

```typescript
  title: session.title,
  gitBranch: session.gitBranch,
```

**Step 4: Update LensAdapter tree label**

In `apps/dashboard/src/components/lens/LensAdapter.tsx`, replace line 117:

```typescript
  label: session.title ?? session.sessionId.slice(0, 8),
```

**Step 5: Run E2E simulation and verify visually**

Run: `cd /c/Workspace/Coding/Prototypes/Synapse && npx tsx scripts/simulate_all_nodes.ts`
Then check the dashboard at http://localhost:5173 — sessions should show the first prompt text instead of hex IDs.

**Step 6: Commit**

```bash
git add apps/dashboard/src/components/graph/nodes/SessionNode.tsx apps/dashboard/src/components/layout/SessionSelector.tsx apps/dashboard/src/components/lens/LensAdapter.tsx
git commit -m "feat(ui): display session title, git branch, and top tools across graph"
```

---

## Task 5: On-demand transcript detail fetching

Creates the infrastructure for loading full transcript data on demand (when a user clicks a node), providing enrichment data to subsequent tasks.

**Files:**
- Modify: `apps/dashboard/src/utils/api.ts`
- Modify: `apps/dashboard/src/store/agentStore.ts:186-267`
- Create: `apps/dashboard/src/hooks/useTranscriptDetail.ts`
- Test: `apps/dashboard/src/hooks/__tests__/useTranscriptDetail.test.ts`

**Step 1: Add fetchTranscriptReasoning to api.ts**

In `apps/dashboard/src/utils/api.ts`, add after line 68:

```typescript
export interface TranscriptReasoningData {
  turns: Array<{
    uuid: string;
    parentUuid: string | null;
    timestamp: number;
    model?: string;
    isSidechain: boolean;
    thinkingText: string | null;
    responseText: string | null;
    toolCalls: Array<{
      toolUseId: string;
      toolName: string;
      input: Record<string, unknown>;
      result?: string;
      isError: boolean;
      durationMs?: number;
    }>;
    structured?: {
      intent?: string;
      planSteps?: string[];
      decision?: string;
      confidence?: number;
    };
  }>;
}

export async function fetchTranscriptReasoning(
  sessionId: string,
  signal?: AbortSignal,
): Promise<TranscriptReasoningData | null> {
  const resp = await fetch(apiUrl(`/api/transcript/${sessionId}/reasoning`), { signal });
  if (!resp.ok) return null;
  const data = await resp.json();
  return data.found === false ? null : data;
}
```

**Step 2: Add transcriptReasoning cache to store**

In `apps/dashboard/src/store/agentStore.ts`, add to `AgentStore` interface:

```typescript
  transcriptReasoning: Map<string, TranscriptReasoningData>;
  setTranscriptReasoning: (sessionId: string, data: TranscriptReasoningData) => void;
```

And in the store implementation, add the initial value and action.

**Step 3: Create useTranscriptDetail hook**

Create `apps/dashboard/src/hooks/useTranscriptDetail.ts`:

```typescript
import { useCallback, useRef } from 'react';
import { useAgentStore } from '../store/agentStore';
import { fetchTranscriptReasoning } from '../utils/api';

/** Lazily fetches transcript reasoning for a session, caching in store. */
export function useTranscriptDetail(sessionId: string | undefined) {
  const reasoning = useAgentStore(
    (s) => sessionId ? s.transcriptReasoning.get(sessionId) : undefined,
  );
  const setReasoning = useAgentStore((s) => s.setTranscriptReasoning);
  const inflightRef = useRef<Set<string>>(new Set());

  const ensureLoaded = useCallback(() => {
    if (!sessionId || reasoning || inflightRef.current.has(sessionId)) return;
    inflightRef.current.add(sessionId);
    fetchTranscriptReasoning(sessionId).then((data) => {
      inflightRef.current.delete(sessionId);
      if (data) setReasoning(sessionId, data);
    }).catch(() => {
      inflightRef.current.delete(sessionId);
    });
  }, [sessionId, reasoning, setReasoning]);

  return { reasoning, ensureLoaded };
}

/** Finds the thinking excerpt that preceded a specific tool call. */
export function findThinkingForTool(
  reasoning: TranscriptReasoningData | undefined,
  toolUseId: string,
): string | null {
  if (!reasoning) return null;
  for (const turn of reasoning.turns) {
    const match = turn.toolCalls.find((tc) => tc.toolUseId === toolUseId);
    if (match && turn.thinkingText) {
      // Return last 200 chars of thinking (the decision portion)
      const text = turn.thinkingText;
      return text.length > 200 ? '...' + text.slice(-200) : text;
    }
  }
  return null;
}
```

**Step 4: Write test for findThinkingForTool**

```typescript
import { findThinkingForTool } from '../useTranscriptDetail';
import type { TranscriptReasoningData } from '../../utils/api';

describe('findThinkingForTool', () => {
  const reasoning: TranscriptReasoningData = {
    turns: [
      {
        uuid: 'a1', parentUuid: 'u1', timestamp: 1000, isSidechain: false,
        thinkingText: 'I need to read the file first to understand the structure before editing.',
        responseText: null,
        toolCalls: [
          { toolUseId: 'tu1', toolName: 'Read', input: { file_path: '/foo.ts' }, isError: false },
          { toolUseId: 'tu2', toolName: 'Edit', input: { file_path: '/foo.ts' }, isError: false },
        ],
      },
    ],
  };

  it('returns thinking for a matching toolUseId', () => {
    const result = findThinkingForTool(reasoning, 'tu1');
    expect(result).toContain('read the file first');
  });

  it('returns null for unknown toolUseId', () => {
    expect(findThinkingForTool(reasoning, 'unknown')).toBeNull();
  });

  it('returns null when reasoning is undefined', () => {
    expect(findThinkingForTool(undefined, 'tu1')).toBeNull();
  });
});
```

**Step 5: Run tests**

Run: `cd /c/Workspace/Coding/Prototypes/Synapse && pnpm vitest run apps/dashboard/src/hooks/__tests__/useTranscriptDetail.test.ts`
Expected: PASS

**Step 6: Commit**

```bash
git add apps/dashboard/src/utils/api.ts apps/dashboard/src/store/agentStore.ts apps/dashboard/src/hooks/useTranscriptDetail.ts apps/dashboard/src/hooks/__tests__/useTranscriptDetail.test.ts
git commit -m "feat(dashboard): add on-demand transcript reasoning fetcher and cache"
```

---

## Task 6: Tool reasoning tooltip on ToolCallNode

Shows thinking excerpt on hover over individual tool call nodes (when tools are expanded via F key).

**Files:**
- Modify: `apps/dashboard/src/components/graph/nodes/ToolCallNode.tsx`
- Test: E2E visual verification

**Step 1: Add tooltip with reasoning to ToolCallNode**

In `apps/dashboard/src/components/graph/nodes/ToolCallNode.tsx`, import the hook and update the component:

```tsx
import { useTranscriptDetail, findThinkingForTool } from '../../../hooks/useTranscriptDetail';
```

Inside `ToolCallNodeComponent`, after the existing store selectors, add:

```tsx
  // Resolve session for this tool via toolAgentMap → agent → sessionId
  const toolAgentMap = useAgentStore((s) => s.toolAgentMap);
  const agents = useAgentStore((s) => s.agents);
  const agentId = toolAgentMap.get(tc.toolUseId);
  const sessionId = agentId ? agents.get(agentId)?.sessionId : undefined;
  const { reasoning, ensureLoaded } = useTranscriptDetail(sessionId);
  const thinkingExcerpt = findThinkingForTool(reasoning, tc.toolUseId);
```

Wrap the outermost `<div>` with `onMouseEnter={ensureLoaded}` to trigger lazy fetch on hover.

Update the tool name row to include a thinking indicator + enhanced tooltip:

```tsx
      <div className="flex items-center gap-1.5 mt-0.5">
        <Tooltip content={
          thinkingExcerpt
            ? `Reasoning: ${thinkingExcerpt}`
            : `${tc.status}${duration ? ` · ${duration}` : ''}`
        }>
          <span className="text-white truncate">{tc.toolName}</span>
        </Tooltip>
        {thinkingExcerpt && (
          <span className="text-yellow-500/60 text-[8px]" title="Has reasoning context">💭</span>
        )}
        <Tooltip content={`${tc.status}${duration ? ` · ${duration}` : ''}`}>
          <span className="text-gray-400 text-[10px]">{statusIcon[tc.status]}</span>
        </Tooltip>
      </div>
```

**Step 2: Also add reasoning tooltip to ToolGroupNode pills**

In `apps/dashboard/src/components/graph/nodes/ToolGroupNode.tsx`, in the Pill Grid mode, each pill can similarly show a thinking tooltip. The ToolGroupNode receives `tools: ToolCallSummary[]` and a `parentAgentId`. Use the same pattern:

```tsx
const agentData = agents.get(data.parentAgentId);
const { reasoning, ensureLoaded } = useTranscriptDetail(agentData?.sessionId);
```

Then in each pill, when hovered, show `findThinkingForTool(reasoning, tool.toolUseId)` as tooltip content.

**Step 3: Run E2E simulation and verify visually**

Run: `cd /c/Workspace/Coding/Prototypes/Synapse && npx tsx scripts/simulate_all_nodes.ts`
Hover over tool nodes — tooltip should show reasoning excerpt if transcript is available.

**Step 4: Commit**

```bash
git add apps/dashboard/src/components/graph/nodes/ToolCallNode.tsx apps/dashboard/src/components/graph/nodes/ToolGroupNode.tsx
git commit -m "feat(graph): show reasoning tooltip on tool nodes via on-demand transcript"
```

---

## Task 7: Sidechain cost badge on AnimatedEdge

Shows turn count and cost as an always-visible pill on Task→ChildAgent edges.

**Files:**
- Modify: `apps/dashboard/src/components/graph/edges/AnimatedEdge.tsx`
- Modify: `apps/dashboard/src/store/agentStore.ts` (add edge data enrichment)
- Modify: `apps/dashboard/src/store/eventHandlers.ts` (attach sidechain metadata to edge data)
- Test: `apps/dashboard/src/store/__tests__/agentStore.test.ts`

**Step 1: Write the failing test**

```typescript
it('should attach sidechain metadata to Task→Agent edges', () => {
  const store = useAgentStore.getState();
  // session + prompt + agent + Task tool + child agent
  store.addEvent({ id: 'e1', type: 'session_start', sessionId: 's1', timestamp: 1000 } as AgentEvent);
  store.addEvent({ id: 'e2', type: 'user_prompt', sessionId: 's1', timestamp: 1001, text: 'hello' } as AgentEvent);
  store.addEvent({ id: 'e3', type: 'agent_start', sessionId: 's1', agentId: 'a1', timestamp: 1002 } as AgentEvent);
  store.addEvent({ id: 'e4', type: 'tool_start', sessionId: 's1', agentId: 'a1', toolName: 'Task', toolUseId: 'tu1', timestamp: 1003, toolInput: { prompt: 'Search for auth files' } } as AgentEvent);
  store.addEvent({ id: 'e5', type: 'agent_start', sessionId: 's1', agentId: 'a2', toolUseId: 'tu1', timestamp: 1004 } as AgentEvent);
  store.addEvent({ id: 'e6', type: 'tool_end', sessionId: 's1', agentId: 'a1', toolName: 'Task', toolUseId: 'tu1', timestamp: 1010, toolResponse: { agentId: 'a2' } } as AgentEvent);

  const edges = useAgentStore.getState().edges;
  const taskEdge = edges.find((e) => e.source === 'tool-tu1' && e.target === 'agent-a2');
  expect(taskEdge).toBeDefined();
  expect((taskEdge?.data as any)?.isTaskEdge).toBe(true);
});
```

**Step 2: Run test to verify it fails**

Run: `cd /c/Workspace/Coding/Prototypes/Synapse && pnpm vitest run apps/dashboard/src/store/__tests__/agentStore.test.ts -t "sidechain metadata"`
Expected: FAIL

**Step 3: Mark Task→Agent edges with metadata in handleToolEnd**

In `apps/dashboard/src/store/eventHandlers.ts`, inside the Task re-pointing section of `handleToolEnd()` (around line 530), when re-pointing the edge, set data:

```typescript
    draft.edges[i] = {
      ...draft.edges[i],
      id: eid(toolNodeId, agentNodeId),
      source: toolNodeId,
      data: {
        ...(draft.edges[i].data as Record<string, unknown> ?? {}),
        isTaskEdge: true,
        taskPrompt: event.toolInput?.prompt as string | undefined,
      },
    };
```

**Step 4: Run test to verify it passes**

Run: `cd /c/Workspace/Coding/Prototypes/Synapse && pnpm vitest run apps/dashboard/src/store/__tests__/agentStore.test.ts -t "sidechain metadata"`
Expected: PASS

**Step 5: Update AnimatedEdge to show pill badge on Task edges**

In `apps/dashboard/src/components/graph/edges/AnimatedEdge.tsx`, add an SVG `<foreignObject>` label for Task edges:

```tsx
function AnimatedEdgeComponent({
  id, sourceX, sourceY, targetX, targetY,
  sourcePosition, targetPosition, data, style = {},
}: EdgeProps) {
  const [edgePath, labelX, labelY] = getSmoothStepPath({
    sourceX, sourceY, targetX, targetY,
    sourcePosition, targetPosition, borderRadius: 8,
  });

  const edgeData = data as { status?: string; isTaskEdge?: boolean; taskPrompt?: string } | undefined;
  const isActive = edgeData?.status === 'running';
  const isTaskEdge = edgeData?.isTaskEdge === true;

  // Look up child agent token usage for Task edges
  const agents = useAgentStore((s) => isTaskEdge ? s.agents : undefined);
  const childAgentId = isTaskEdge
    ? useAgentStore.getState().edges
        .find((e) => e.id === id)?.target?.replace('agent-', '')
    : undefined;
  const childAgent = childAgentId && agents ? agents.get(childAgentId) : undefined;
  const sidechainTokens = childAgent
    ? childAgent.tokenUsage.input + childAgent.tokenUsage.output
    : 0;
  const sidechainToolCount = childAgent?.toolCalls.length ?? 0;

  return (
    <>
      <path
        id={id}
        className="react-flow__edge-path"
        d={edgePath}
        style={{
          stroke: isTaskEdge ? '#a78bfa' : isActive ? '#60a5fa' : '#4b5563',
          strokeWidth: isTaskEdge ? 2 : isActive ? 2 : 1.5,
          strokeDasharray: isActive ? '6 3' : 'none',
          animation: isActive ? 'dashFlow 0.5s linear infinite' : 'none',
          fill: 'none',
          ...style,
        }}
      />
      {isTaskEdge && sidechainTokens > 0 && (
        <foreignObject
          x={labelX - 40} y={labelY - 10}
          width={80} height={20}
          className="pointer-events-none"
        >
          <div className="flex items-center justify-center gap-1 bg-purple-900/80 border border-purple-500/30 rounded-full px-2 py-0.5 text-[9px] text-purple-200 whitespace-nowrap">
            <span>{sidechainToolCount} tools</span>
            <span className="text-purple-400">·</span>
            <span>{formatTokens(sidechainTokens)}</span>
          </div>
        </foreignObject>
      )}
    </>
  );
}
```

Import `useAgentStore` and `formatTokens` from the appropriate modules.

**Step 6: Run E2E simulation**

Run: `cd /c/Workspace/Coding/Prototypes/Synapse && npx tsx scripts/simulate_all_nodes.ts`
Check the graph — Task→Agent edges should show purple pill badges with token counts.

**Step 7: Commit**

```bash
git add apps/dashboard/src/components/graph/edges/AnimatedEdge.tsx apps/dashboard/src/store/eventHandlers.ts apps/dashboard/src/store/__tests__/agentStore.test.ts
git commit -m "feat(graph): show sidechain cost pill on Task→Agent edges"
```

---

## Task 8: Compaction badge on AgentNode

Shows an orange compaction indicator on agents whose conversations were compacted.

**Files:**
- Modify: `packages/core/src/types/agent.ts:70-90` (add compactionCount to AgentNodeData)
- Modify: `apps/dashboard/src/store/eventHandlers.ts` (track compactions per agent)
- Modify: `apps/dashboard/src/components/graph/nodes/AgentNode.tsx`
- Modify: `apps/dashboard/src/components/graph/nodes/UserPromptNode.tsx` (enhance tooltip)
- Test: `apps/dashboard/src/store/__tests__/agentStore.test.ts`

**Step 1: Write the failing test**

```typescript
it('should track compaction count on agents', () => {
  const store = useAgentStore.getState();
  store.addEvent({ id: 'e1', type: 'session_start', sessionId: 's1', timestamp: 1000 } as AgentEvent);
  store.addEvent({ id: 'e2', type: 'user_prompt', sessionId: 's1', timestamp: 1001, text: 'test' } as AgentEvent);
  store.addEvent({ id: 'e3', type: 'agent_start', sessionId: 's1', agentId: 'a1', timestamp: 1002 } as AgentEvent);
  store.addEvent({ id: 'e4', type: 'compact', sessionId: 's1', timestamp: 1003 } as AgentEvent);

  const agent = useAgentStore.getState().agents.get('a1');
  expect(agent?.compactionCount).toBe(1);
});
```

**Step 2: Run test to verify it fails**

Run: `cd /c/Workspace/Coding/Prototypes/Synapse && pnpm vitest run apps/dashboard/src/store/__tests__/agentStore.test.ts -t "compaction count"`
Expected: FAIL

**Step 3: Add `compactionCount` to AgentNodeData**

In `packages/core/src/types/agent.ts`, add to `AgentNodeData`:

```typescript
  compactionCount?: number;
```

**Step 4: Increment compactionCount in event handler**

In `apps/dashboard/src/store/eventHandlers.ts`, find the compact event handler. When a `compact` event arrives, find the latest active agent in the session and increment its compaction count:

```typescript
function handleCompact(event: AgentEvent, draft: StateDraft): void {
  // ... existing logic for marking prompts ...

  // Increment compaction count on the latest active agent
  const sessionActive = draft.activeAgents.get(event.sessionId);
  if (sessionActive && sessionActive.length > 0) {
    const agentId = sessionActive[sessionActive.length - 1];
    const node = draft.nodes.find((n) => n.id === nid.agent(agentId));
    if (node) {
      const agent = (node.data as { agent: AgentNodeData }).agent;
      agent.compactionCount = (agent.compactionCount ?? 0) + 1;
    }
    // Also update the agents map
    const agentData = draft.agents.get(agentId);
    if (agentData) {
      agentData.compactionCount = (agentData.compactionCount ?? 0) + 1;
    }
  }
}
```

**Step 5: Run test to verify it passes**

Run: `cd /c/Workspace/Coding/Prototypes/Synapse && pnpm vitest run apps/dashboard/src/store/__tests__/agentStore.test.ts -t "compaction count"`
Expected: PASS

**Step 6: Add badge to AgentNode**

In `apps/dashboard/src/components/graph/nodes/AgentNode.tsx`, in the header row (around line 63-65), add after the existing "Task" badge:

```tsx
            {agent.compactionCount && agent.compactionCount > 0 && (
              <Tooltip content={`Context compacted ${agent.compactionCount} time${agent.compactionCount > 1 ? 's' : ''}`}>
                <span className="bg-orange-900/50 text-orange-300 text-[9px] px-1.5 rounded">
                  {'\u2702'}{agent.compactionCount > 1 ? ` ×${agent.compactionCount}` : ''}
                </span>
              </Tooltip>
            )}
```

**Step 7: Enhance UserPromptNode compaction tooltip**

In `apps/dashboard/src/components/graph/nodes/UserPromptNode.tsx`, the existing tooltip at line 86 says "Context was compacted — earlier messages were summarized". This is sufficient but could include `preTokens` if available from transcript. For now, keep the existing behavior — the transcript enrichment in Task 5 makes this data available for the detail panel.

**Step 8: Run full test suite**

Run: `cd /c/Workspace/Coding/Prototypes/Synapse && pnpm test`
Expected: All tests pass

**Step 9: Commit**

```bash
git add packages/core/src/types/agent.ts apps/dashboard/src/store/eventHandlers.ts apps/dashboard/src/components/graph/nodes/AgentNode.tsx apps/dashboard/src/store/__tests__/agentStore.test.ts
git commit -m "feat(graph): show compaction badge on agent nodes"
```

---

## Task 9: Lightweight FIFO validation

Adds a console warning when the FIFO-matched Task tool's prompt doesn't match the child agent's description, helping diagnose incorrect linkage.

**Files:**
- Modify: `apps/dashboard/src/store/eventHandlers.ts:276-300`
- Test: `apps/dashboard/src/store/__tests__/agentStore.test.ts`

**Step 1: Write the failing test**

```typescript
it('should warn on FIFO mismatch between Task prompt and agent description', () => {
  const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  const store = useAgentStore.getState();

  store.addEvent({ id: 'e1', type: 'session_start', sessionId: 's1', timestamp: 1000 } as AgentEvent);
  store.addEvent({ id: 'e2', type: 'user_prompt', sessionId: 's1', timestamp: 1001, text: 'go' } as AgentEvent);
  store.addEvent({ id: 'e3', type: 'agent_start', sessionId: 's1', agentId: 'a1', timestamp: 1002 } as AgentEvent);
  // Two concurrent Task tools
  store.addEvent({ id: 'e4', type: 'tool_start', sessionId: 's1', agentId: 'a1', toolName: 'Task', toolUseId: 'tu1', timestamp: 1003, toolInput: { prompt: 'Search for auth files' } } as AgentEvent);
  store.addEvent({ id: 'e5', type: 'tool_start', sessionId: 's1', agentId: 'a1', toolName: 'Task', toolUseId: 'tu2', timestamp: 1004, toolInput: { prompt: 'Run the test suite' } } as AgentEvent);
  // Agent starts with no explicit toolUseId — FIFO assigns tu1, but agent's prompt says "Run the test suite"
  store.addEvent({ id: 'e6', type: 'agent_start', sessionId: 's1', agentId: 'a2', timestamp: 1005, prompt: 'Run the test suite' } as AgentEvent);

  expect(warnSpy).toHaveBeenCalledWith(
    expect.stringContaining('FIFO mismatch'),
  );
  warnSpy.mockRestore();
});
```

**Step 2: Run test to verify it fails**

Expected: FAIL — no warning emitted

**Step 3: Add validation after FIFO match**

In `apps/dashboard/src/store/eventHandlers.ts`, after the FIFO fallback at line 288, add:

```typescript
      } else {
        taskToolUseId = pending.shift();
        // Validate FIFO match: compare Task prompt with agent prompt
        if (taskToolUseId && event.prompt) {
          const taskToolNode = draft.nodes.find((n) => n.id === nid.tool(taskToolUseId!));
          const taskPrompt = (taskToolNode?.data as { toolCall?: ToolCallSummary })?.toolCall?.toolInput?.prompt as string | undefined;
          if (taskPrompt && event.prompt && !event.prompt.includes(taskPrompt.slice(0, 30)) && !taskPrompt.includes(event.prompt.slice(0, 30))) {
            console.warn(
              `[Synapse] FIFO mismatch: Task tool "${taskToolUseId}" prompt "${taskPrompt.slice(0, 50)}..." ` +
              `does not match agent "${agentId}" prompt "${event.prompt.slice(0, 50)}..."`,
            );
          }
        }
      }
```

**Step 4: Run test to verify it passes**

Run: `cd /c/Workspace/Coding/Prototypes/Synapse && pnpm vitest run apps/dashboard/src/store/__tests__/agentStore.test.ts -t "FIFO mismatch"`
Expected: PASS

**Step 5: Run full test suite**

Run: `cd /c/Workspace/Coding/Prototypes/Synapse && pnpm test`
Expected: All tests pass

**Step 6: Commit**

```bash
git add apps/dashboard/src/store/eventHandlers.ts apps/dashboard/src/store/__tests__/agentStore.test.ts
git commit -m "fix(store): add FIFO mismatch warning for concurrent Task tool linking"
```

---

## Task 10: E2E verification with simulated sessions

Runs the simulation scripts and verifies all enrichment features work end-to-end.

**Files:**
- Modify: `scripts/simulate_all_nodes.ts` (add events for compaction, multiple Task tools, isMeta scenarios)
- No new test file — manual + automated verification

**Step 1: Enhance simulation script**

In `scripts/simulate_all_nodes.ts`, add events that exercise:
- A compaction event after some tool calls (to test compaction badge)
- Multiple concurrent Task tools (to test FIFO warning)
- Session with `gitBranch` metadata

**Step 2: Run the enhanced simulation**

```bash
cd /c/Workspace/Coding/Prototypes/Synapse
npx tsx packages/server/src/index.ts &
# Wait for server to start
npx tsx scripts/simulate_all_nodes.ts
```

**Step 3: Verify each feature visually at http://localhost:5173**

Checklist:
- [ ] Session node shows first prompt text instead of hex ID
- [ ] Session node shows git branch chip (if present)
- [ ] Session node shows top-3 tool pills in footer
- [ ] SessionSelector dropdown shows title + branch + model
- [ ] Hovering a tool call node shows reasoning tooltip (if transcript available)
- [ ] Task→Agent edge shows purple pill with token/tool count
- [ ] Agent node shows orange compaction badge (if compacted)
- [ ] Cost waterfall lens excludes isMeta turns

**Step 4: Run full test suite one final time**

```bash
cd /c/Workspace/Coding/Prototypes/Synapse && pnpm test
```
Expected: All tests pass

**Step 5: Final commit**

```bash
git add scripts/simulate_all_nodes.ts
git commit -m "test(e2e): enhance simulation with compaction, concurrent tasks, and git branch events"
```

---

## Summary of Changes by Component

| Component | What's New |
|---|---|
| **TranscriptTurn** (core type) | `isMeta: boolean` field |
| **SessionData** (core type) | `title`, `gitBranch`, `topTools` fields |
| **AgentNodeData** (core type) | `compactionCount` field |
| **parseTurn()** (server) | Propagates `isMeta` from raw JSONL |
| **eventHandlers.ts** (store) | Session title from first prompt, compaction tracking, FIFO validation, Task edge metadata |
| **SessionNode** (graph) | Title, git branch chip, source badge, top-tool pills |
| **SessionSelector** (layout) | Title, branch, richer dropdown items |
| **LensAdapter** (lens) | Title-based tree labels |
| **ToolCallNode** (graph) | Reasoning tooltip on hover |
| **ToolGroupNode** (graph) | Reasoning tooltip on pill hover |
| **AnimatedEdge** (graph) | Purple sidechain cost pill on Task edges |
| **AgentNode** (graph) | Orange compaction badge |
| **lensComputations** (analytics) | isMeta filtering in buildCostPerTurn |
| **api.ts** (utils) | `fetchTranscriptReasoning()` function |
| **useTranscriptDetail** (hook) | On-demand transcript cache + `findThinkingForTool()` |
