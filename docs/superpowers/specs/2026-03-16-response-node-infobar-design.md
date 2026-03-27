# AssistantResponseNode Infobar — Design Spec

**Date:** 2026-03-16
**Branch:** main

---

## Problem Statement

The `AssistantResponseNode` graph node is visually bare compared to other node types. When expanded in the conversation threading view, it shows only a text preview and timestamp — no stats footer. Users cannot see token counts, tool attribution, latency, or cost without clicking through to the detail panel.

Every other node type has an infobar/stats footer on the node itself:

- **SessionNode:** token counts, sparkline, agent/tool counts, top tools
- **UserPromptNode:** token counts (input/output), agent count pill, tool count pill, compaction indicator
- **AgentNode:** token counts, tool count pill (with expand indicator), elapsed time, status icon, streaming preview

The AssistantResponseNode should follow the same pattern for visual consistency and information density.

---

## Data Available

From the store and existing data structures, these metrics can be derived for each response:

| Metric                | Source                                  | Derivation                                                                        |
| --------------------- | --------------------------------------- | --------------------------------------------------------------------------------- |
| Token count (output)  | `TranscriptTurn` nearest by timestamp   | Same as assistant response panel spec — match nearest `assistant` turn within 30s |
| Latency               | `response.timestamp − prompt.timestamp` | Already computed in the panel spec                                                |
| Tools triggered       | Timestamp-window attribution            | Same algorithm as panel spec — tools between this response and next response      |
| Tool count            | Derived from tools triggered            | Count from the tool attribution map                                               |
| Cost (output portion) | Output tokens × model price             | _Derivable but excluded — see "What NOT to include"_                              |
| Model                 | Nearest agent's `model` field           | _Derivable but excluded — see "What NOT to include"_                              |

<!-- revised: P1 PM — clarify which metrics are displayed vs merely derivable -->

**Note:** Not all derivable metrics are displayed on the node. Cost and Model are available but excluded for space/relevance reasons (see "What NOT to include" below).

**Not available on the node data directly:** The `AssistantResponseData` type has `{ id, sessionId, text, timestamp, promptId }`. All metrics must be derived from other store maps. This is the same approach used by `UserPromptNode` which derives its metrics from `agentsBySession` and `transcripts`.

---

## Design

### Layout

Add a stats footer to `AssistantResponseNode`, positioned below the text preview, consistent with the UserPromptNode and AgentNode patterns:

```
┌─────────────────────────────────┐
│ Claude (1/2)          11:07:44  │  header (existing)
│ "Let me check the auth..."      │  text preview (existing)
│ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─│  thin divider (new)
│ 847↑  +1.2s    ▸ 4 tools        │  stats footer (new)
└─────────────────────────────────┘
```

### Stats Footer Elements

Left-to-right, all at `text-[10px]`:

1. **Output tokens** (orange, mono) — `formatTokens(outputTokens)↑`
   - Only shown when `outputTokens > 0`
   - Tooltipped: "Output tokens"

2. **Latency** (gray) — `+Xs` or `+Xms`
   - Time from parent prompt's timestamp to this response's timestamp
   - Only shown when latency > 0
   <!-- revised: P1 UX — disambiguate latency tooltip for multi-response prompts -->
   - Tooltipped: "Time since prompt" (consistent whether first or Nth response)

3. **Tool count pill** (purple, right-aligned) — `▸ N tools`
   - Only shown when `toolCount > 0`
   - Uses the same pill style as AgentNode: `bg-purple-600/20 text-purple-400`
   - Tooltipped: "Tools triggered after this response"

### What NOT to include

- **Input tokens**: Not meaningful per-response (input is shared across the whole turn)
- **Cost**: Too granular at response level — shown on prompt node and detail panel
- **Model badge**: Takes too much space; already visible on the parent agent/prompt
- **Cache rate**: Per-response cache isn't meaningful
- **Sparkline**: Only makes sense for session-level aggregation
- **Streaming preview**: Responses are finalized text, not streaming

### Conditional rendering

The entire stats footer is wrapped in a conditional — only rendered when at least one metric has data (`outputTokens > 0 || latency > 0 || toolCount > 0`). This keeps the node compact when no data is available (e.g., during initial hydration or when transcript data hasn't loaded yet).

---

## Implementation Details

### File: `apps/dashboard/src/components/graph/nodes/AssistantResponseNode.tsx`

This is the only file that needs changes. All metrics are derived from existing store data.

#### Step 0 — Module-level empty constants

Per Zustand convention (CLAUDE.md: `?? []` inside selectors causes infinite re-renders):

```tsx
const EMPTY_PROMPTS: UserPromptData[] = [];
const EMPTY_AGENTS: AgentNodeData[] = [];
```

#### Step 1 — Add session-scoped store subscriptions

Use session-scoped selectors to avoid re-rendering on changes to unrelated sessions:

```tsx
const sessionPrompts = useAgentStore((s) => s.prompts.get(response.sessionId)) ?? EMPTY_PROMPTS;
const sessionAgents =
  useAgentStore((s) => s.agentsBySession.get(response.sessionId)) ?? EMPTY_AGENTS;
const transcript = useAgentStore((s) => s.transcripts.get(response.sessionId));
```

#### Step 2 — Compute metrics in useMemo

The component receives `{ response, index, total }` via data props. It also needs sibling responses to compute per-response tool windows. The parent (`useVisibleGraph`) already provides `index` and `total`, but we need sibling response data for accurate tool attribution.

```tsx
// Get all responses for the same prompt to compute per-response tool windows
const allSessionResponses =
  useAgentStore((s) => s.responses.get(response.sessionId)) ?? EMPTY_RESPONSES;
const siblings = useMemo(
  () =>
    allSessionResponses
      .filter((r) => r.promptId === response.promptId)
      .sort((a, b) => a.timestamp - b.timestamp),
  [allSessionResponses, response.promptId],
);

const metrics = useMemo(() => {
  // Latency: response timestamp - prompt timestamp
  const prompt = sessionPrompts.find((p) => p.id === response.promptId);
  const latencyMs = prompt ? response.timestamp - prompt.timestamp : 0;

  // Output tokens from nearest transcript turn
  const assistantTurns = transcript?.turns.filter((t) => t.type === 'assistant') ?? [];
  const nearestTurn = assistantTurns
    .filter((t) => Math.abs(t.timestamp - response.timestamp) < 30_000)
    .sort(
      (a, b) =>
        Math.abs(a.timestamp - response.timestamp) - Math.abs(b.timestamp - response.timestamp),
    )[0];
  const outputTokens = nearestTurn?.outputTokens ?? 0;

  // Tool count: per-response timestamp-window attribution
  // Window for this response: [this.timestamp, nextSibling.timestamp)
  // Consistent with the panel spec's tool attribution algorithm
  const siblingIdx = siblings.findIndex((s) => s.id === response.id);
  const windowStart = response.timestamp;
  const windowEnd = siblings[siblingIdx + 1]?.timestamp ?? Infinity;
  let toolCount = 0;
  if (prompt) {
    const promptWindowEnd =
      sessionPrompts.find((p) => p.timestamp > prompt.timestamp)?.timestamp ?? Infinity;
    for (const agent of sessionAgents) {
      if (agent.startTime >= prompt.timestamp && agent.startTime < promptWindowEnd) {
        for (const tc of agent.toolCalls) {
          // <!-- revised: P1 Eng — fallback for tc.startTime === 0 (missing hook timestamp) -->
          const tcTime = tc.startTime || agent.startTime; // fallback to agent start if tool timestamp missing
          if (tcTime >= windowStart && tcTime < windowEnd) {
            toolCount++;
          }
        }
      }
    }
  }

  return { outputTokens, latencyMs, toolCount };
}, [response, sessionPrompts, transcript, sessionAgents, siblings]);
```

**Note:** For v1 (single response per prompt), the window is `[response.timestamp, Infinity)` — equivalent to counting all tools. For v2 (multiple responses), each response gets only its attributed tools. This is consistent with the panel spec's Step 4 algorithm.

#### Step 3 — Render the stats footer

```tsx
{
  (metrics.outputTokens > 0 || metrics.latencyMs > 0 || metrics.toolCount > 0) && (
    <div className="flex items-center justify-between mt-1.5 pt-1 border-t border-blue-500/20">
      <div className="flex items-center gap-2">
        {metrics.outputTokens > 0 && (
          <Tooltip content="Output tokens">
            <span className="text-[10px] font-mono text-orange-400/60">
              {formatTokens(metrics.outputTokens)}↑
            </span>
          </Tooltip>
        )}
        {metrics.latencyMs > 0 && (
          <Tooltip content="Time since prompt">
            <span className="text-[10px] text-gray-400">
              +
              {metrics.latencyMs < 1000
                ? `${Math.round(metrics.latencyMs)}ms`
                : `${(metrics.latencyMs / 1000).toFixed(1)}s`}
            </span>
          </Tooltip>
        )}
      </div>
      {metrics.toolCount > 0 && (
        <Tooltip content="Tools triggered after this response">
          <span className="px-1.5 py-0.5 rounded-full text-[10px] bg-purple-600/20 text-purple-400">
            ▸ {metrics.toolCount} tool{metrics.toolCount !== 1 ? 's' : ''}
          </span>
        </Tooltip>
      )}
    </div>
  );
}
```

#### Additional imports needed

```tsx
import type { UserPromptData, AgentNodeData, AssistantResponseData } from '@synapse-ai/core';
import { formatTokens, formatTime } from '@synapse-ai/core';
import { Tooltip } from '../../ui/Tooltip';
```

`formatTime` is already imported. `formatTokens`, `Tooltip`, and the type imports need to be added.

---

## Files Changed

| File                                                                  | Change                                                     |
| --------------------------------------------------------------------- | ---------------------------------------------------------- |
| `apps/dashboard/src/components/graph/nodes/AssistantResponseNode.tsx` | Add store subscriptions, metrics useMemo, stats footer JSX |

No other files need to change.

---

## Consistency with Existing Patterns

| Pattern               |          UserPromptNode          |            AgentNode             |    AssistantResponseNode (new)    |
| --------------------- | :------------------------------: | :------------------------------: | :-------------------------------: |
| Token display         |          cyan↓ orange↑           |          cyan↓ orange↑           |       orange↑ only (output)       |
| Tool count pill       |            purple bg             |            purple bg             |             purple bg             |
| Tooltip on metrics    |               Yes                |               Yes                |                Yes                |
| Conditional footer    | Yes (`inputTokens > 0 \|\| ...`) | Yes (`inputTokens > 0 \|\| ...`) | Yes (`outputTokens > 0 \|\| ...`) |
| `text-[10px]` size    |               Yes                |               Yes                |                Yes                |
| `font-mono` on tokens |               Yes                |               Yes                |                Yes                |
| Divider before footer |           amber border           |            (uses gap)            |        blue-500/20 border         |

---

## Out of Scope

- Response detail panel (already designed in `2026-03-15-assistant-response-panel-design.md`)
- Multi-response attribution per-segment (v2 of conversation threading)
- Adding fields to `AssistantResponseData` type (metrics derived from other stores)
- Streaming/live response state (responses are finalized text only)

---

## Open Questions / Deferred

<!-- P2 items from plan review — not blocking implementation -->

1. **Zustand selector stability:** Session-scoped selectors (`s.prompts.get(sessionId)`) still re-render when the parent Map is replaced (Zustand default equality is `Object.is`). This matches the existing `UserPromptNode` pattern and is acceptable. True per-session isolation would require store restructuring — out of scope.
2. **Siblings useMemo churn:** The `siblings` memo re-filters on any session response change. Negligible for v1 (1 response/prompt), monitor for v2.
3. **Stats footer height impact:** Adds ~20px per response node. Acceptable for v1; monitor graph density for v2 response chains.
4. **Shared `formatLatency` utility:** Both this infobar and the panel spec inline the same latency formatting. Could extract to `@synapse-ai/core` for DRY — defer to a cleanup pass.
