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

| Field             | Source                                                                                    |
| ----------------- | ----------------------------------------------------------------------------------------- |
| Response text     | `AssistantResponseData.text`                                                              |
| Sibling responses | `responses.get(sessionId)` filtered by `promptId`                                         |
| Latency           | `response.timestamp − prompt.timestamp` (prompt looked up via `prompts.get(sessionId)`)   |
| Tools triggered   | Walk `rawEdges` for `source === response-{id}`, resolve tool names from `toolGroups` map  |
| Token count       | `transcripts` window-match (same logic as `UserPromptNode`); omit silently if unavailable |

No new store state required.

---

## Panel Layout

```
┌─────────────────────────────────────┐
│ Claude Response  [x close]          │  header — blue accent, matches node color
├─────────────────────────────────────┤
│ {N} response(s) for this prompt     │  sibling count pill
├─────────────────────────────────────┤
│ ── Response 1 ──  11:07:44  +1.2s   │  divider: index, timestamp, latency
│ [copy]                              │  copy button (top-right of text block)
│ ┌─────────────────────────────────┐ │
│ │ Full text (scrollable, pre-wrap)│ │  blue-tinted bg, user-select text
│ └─────────────────────────────────┘ │
│ TOOLS TRIGGERED  ▸ Read ×3  Bash ×1 │  purple chip badges; hidden if 0 tools
├─────────────────────────────────────┤
│ ── Response 2 ──  11:07:52  +9.4s   │  second block, identical structure
│ ...                                 │
└─────────────────────────────────────┘
```

Token count is shown in the divider row when available from transcript data.

---

## Implementation Details

### New branch in AgentDetailPanel

```ts
const responseId = selectedNodeId?.startsWith('response-') ? selectedNodeId.slice(9) : null;
```

When `responseId` is non-null, render `<AssistantResponsePanelContent responseId={responseId} />`.

### AssistantResponsePanelContent (local component)

Props: `{ responseId: string }`

Steps:

1. Find the `AssistantResponseData` by `responseId` from `responses` map (all sessions).
2. Get all sibling responses: `responses.get(sessionId).filter(r => r.promptId === data.promptId)`, sort by timestamp.
3. Look up prompt for latency: `prompts.get(sessionId)?.find(p => p.id === data.promptId)`.
4. For each sibling response, compute tools triggered: filter `rawEdges` where `source === response-{id}`, resolve node labels from `toolGroups`/`nodes`.
5. Attempt token count from `transcripts` window match.
6. Render flat scroll: one block per response.

### Tool attribution

Walk `useAgentStore(s => s.rawEdges)` (or the edges already on the store) for children of each response node. Resolve tool group chip labels from the existing `toolGroups` map. Reuse the `ToolBadges` component already used in other panel sections.

### Copy

Reuse `copyToClipboard(text)` + `toast('Copied')` — identical to existing usage in the prompt panel.

### Latency formatting

```ts
const ms = response.timestamp - prompt.timestamp;
const label = ms < 1000 ? `+${ms}ms` : `+${(ms / 1000).toFixed(1)}s`;
```

---

## Files Changed

| File                                                        | Change                                                                    |
| ----------------------------------------------------------- | ------------------------------------------------------------------------- |
| `apps/dashboard/src/components/panels/AgentDetailPanel.tsx` | Add `responseId` branch + `AssistantResponsePanelContent` local component |

No other files need to change.

---

## Out of Scope

- Token count on `AssistantResponseData` type (not added — read from transcript if available, else omit)
- Navigation between sibling responses (user clicks the node they want; all siblings shown in one panel)
- Streaming / live update of response text (panel reads from store snapshot, same as all other panels)
