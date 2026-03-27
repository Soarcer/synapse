# Assistant Response Panel — Design Spec

**Date:** 2026-03-15
**Branch:** feat/css-variable-migration (target: main)

---

## Problem Statement

When a user clicks an `AssistantResponseNode` in the graph, the `AgentDetailPanel` renders nothing — no `response-*` prefix handler exists. Users cannot read the full response text, see which tools it triggered, or understand latency without switching to another view.

---

## Approach

Add a `response-*` branch to `AgentDetailPanel` that renders `AssistantResponsePanelContent` — a local function component in the same file. No new files. Pattern is consistent with how `agent-`, `session-`, `prompt-`, `tool-`, and `toolgroup-` nodes are already handled.

Layout: **flat scroll** — all sibling responses for the same prompt stacked top-to-bottom. No accordion or tabs. Chosen because most prompts have one response; flat scroll is the fastest to scan and requires no interaction state.

---

## Data Sources

| Field             | Source                                                                          |
| ----------------- | ------------------------------------------------------------------------------- |
| Response text     | `AssistantResponseData.text`                                                    |
| Sibling responses | See "Cross-session lookup" below                                                |
| Latency           | `response.timestamp − prompt.timestamp`                                         |
| Tools triggered   | Timestamp-window attribution via `agentsBySession` + `ToolCallSummary`          |
| Token count       | Nearest `assistant` `TranscriptTurn` by timestamp; omit silently if unavailable |

No new store state required. `responses` must be subscribed to (see Implementation Details).

---

## Panel Layout

**With token count:**

```
┌─────────────────────────────────────────────────────┐
│ Claude Response  [x close]                          │  header — blue accent
├─────────────────────────────────────────────────────┤
│ 2 responses for this prompt                         │  sibling count pill
├─────────────────────────────────────────────────────┤
│ ── Response 1 ──  11:07:44  +1.2s  221 tok          │  divider row (with tokens)
│                                              [copy] │
│ ┌───────────────────────────────────────────────┐   │
│ │ Full text (scrollable, pre-wrap, user-select) │   │  blue-tinted bg
│ └───────────────────────────────────────────────┘   │
│ TOOLS TRIGGERED  ▸ Read ×3  Bash ×1                 │  purple chips; hidden if 0
├─────────────────────────────────────────────────────┤
│ ── Response 2 ──  11:07:52  +9.4s                   │  divider row (no tokens)
│ ...                                                 │
└─────────────────────────────────────────────────────┘
```

**Divider row variants:**

- With tokens: `── Response N ──  HH:MM:SS  +Xs  NNN tok`
- Without tokens: `── Response N ──  HH:MM:SS  +Xs`
- Token slot is omitted entirely (no empty space) when unavailable.

---

## Implementation Details

### New branch in AgentDetailPanel

```ts
const responseId = selectedNodeId?.startsWith('response-') ? selectedNodeId.slice(9) : null;
```

Add `const responses = useAgentStore((s) => s.responses)` at the top of `AgentDetailPanel` alongside the existing store subscriptions. Then when `responseId` is non-null, render `<AssistantResponsePanelContent responseId={responseId} responses={responses} />` (or the component can call `useAgentStore` directly — either is fine).

### AssistantResponsePanelContent (local component)

Props: `{ responseId: string }`

**Step 1 — Cross-session responseId lookup**

The `responses` map is keyed by `sessionId`, not `responseId`. To find the target response, iterate all values:

```ts
let foundResponse: AssistantResponseData | null = null;
for (const arr of responses.values()) {
  const match = arr.find((r) => r.id === responseId);
  if (match) {
    foundResponse = match;
    break;
  }
}
```

`foundResponse.sessionId` is then available for all subsequent lookups.

**Step 2 — Sibling responses**

```ts
const siblings = (responses.get(foundResponse.sessionId) ?? [])
  .filter((r) => r.promptId === foundResponse.promptId)
  .sort((a, b) => a.timestamp - b.timestamp);
```

**Step 3 — Latency**

```ts
const prompt = prompts.get(sessionId)?.find((p) => p.id === data.promptId);
const ms = prompt ? data.timestamp - prompt.timestamp : null;
const latencyLabel = ms === null ? null : ms < 1000 ? `+${ms}ms` : `+${(ms / 1000).toFixed(1)}s`;
```

**Step 4 — Tool attribution (timestamp-window)**

The response nodes' child edges are synthesized inside `useVisibleGraph` and are NOT present in the store's `rawEdges`. Do NOT walk `rawEdges` for this. Instead, derive attribution directly from `agentsBySession`:

For each sibling response at index `i`, its tool window is `[response[i].timestamp, response[i+1]?.timestamp ?? Infinity)`.

```ts
const sessionAgents = agentsBySession.get(sessionId) ?? [];
// Filter agents that belong to this prompt's time range
const nextPrompt = prompts.get(sessionId)?.find((p) => p.timestamp > prompt.timestamp); // next prompt after this one
const promptWindowEnd = nextPrompt?.timestamp ?? Infinity;
const relevantAgents = sessionAgents.filter(
  (a) => a.startTime >= prompt.timestamp && a.startTime < promptWindowEnd,
);

// For response[i], collect tool calls in [response[i].timestamp, response[i+1]?.timestamp)
const responseWindowEnd = siblings[i + 1]?.timestamp ?? Infinity;
const toolCounts = new Map<string, number>();
for (const agent of relevantAgents) {
  for (const tc of agent.toolCalls) {
    if (tc.timestamp >= siblings[i].timestamp && tc.timestamp < responseWindowEnd) {
      toolCounts.set(tc.toolName, (toolCounts.get(tc.toolName) ?? 0) + 1);
    }
  }
}
```

Tool names come directly from `ToolCallSummary.toolName` — no `toolGroups` map lookup needed.

**Step 5 — Token count**

Match against `TranscriptTurn` by finding the nearest `assistant` turn whose timestamp is within 30 seconds of `response.timestamp`:

```ts
const transcript = transcripts.get(sessionId);
const assistantTurns = transcript?.turns.filter((t) => t.type === 'assistant') ?? [];
const nearestTurn = assistantTurns
  .filter((t) => Math.abs(t.timestamp - response.timestamp) < 30_000)
  .sort(
    (a, b) =>
      Math.abs(a.timestamp - response.timestamp) - Math.abs(b.timestamp - response.timestamp),
  )[0];
const outputTokens = nearestTurn?.outputTokens ?? null;
```

If `outputTokens` is null, the token count slot is omitted from the divider row.

**Step 6 — Copy**

Reuse `copyToClipboard(text)` + `toast('Copied')` — identical to existing usage in the prompt panel.

---

## Rendering

- Response text block: `pre-wrap`, `user-select: text`, scrollable (max-height ~300px), blue-tinted background (`bg-blue-900/20`).
- Tool chips: reuse the existing `ToolBadges` component from `apps/dashboard/src/components/analytics/shared/ToolBadges.tsx`. Only render if `toolCounts.size > 0`.
- Divider: `text-gray-500 text-[11px]` separator line with index number, formatted time, latency, optional token count.
- Copy button: top-right corner of the text block, small icon button.

---

## Files Changed

| File                                                        | Change                                                                                                     |
| ----------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `apps/dashboard/src/components/panels/AgentDetailPanel.tsx` | Add `responseId` branch + `responses` store subscription + `AssistantResponsePanelContent` local component |

No other files need to change.

---

## Out of Scope

- Token count field on `AssistantResponseData` type (not added — read from transcript if available, else omit)
- Navigation arrows between sibling responses (all siblings shown in one panel)
- Streaming / live update of response text (panel reads from store snapshot, same as all other panels)
- `ToolCallSummary.timestamp` assumed to be present for window attribution — if absent, tool attribution section is omitted silently
