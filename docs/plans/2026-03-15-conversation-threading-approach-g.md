# Conversation Threading — Approach G (Hybrid E+F)

**Date:** 2026-03-15
**Status:** Plan (revised after review)
**Prototype:** `docs/prototypes/conversation-threading-v2.html` (Tab G)

## Problem

The Synapse dashboard shows sessions as disconnected prompts. Now that we have `assistant_response` events, we can show full conversations. But raw response nodes would add noise. We need a smart two-state model.

## Design (Approach G)

Two states for each turn, plus an automatic in-progress state:

### State 1: Collapsed (default)

The existing `userPrompt` node gets a **blue response section** appended inside it. Tools, agents, and toolgroups remain as **direct children of the prompt** — identical to today's graph. The only visual change is the response text inside the prompt node.

```
┌─────────────────────────┐
│ Prompt (amber)          │
│ "Fix the bug in auth"   │
│ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ │  ← blue response section (clickable)
│ Claude: "Done! The..."  │
│ 12.4k↓ 847↑    $0.04   │
└────────────┬────────────┘
             ├──→ [Toolgroup: Read·Edit·Grep]
             └──→ [Agent: Explore hooks]
```

<!-- revised: P1 UX — entire blue section is clickable, not just chevron -->

The entire blue response section is clickable to toggle expand/collapse. A subtle hover state (brightness increase) and tooltip ("Click to expand responses") provide discoverability.

### State 2: Expanded (click to expand)

<!-- revised: P1 layout — responses chain horizontally (LR), consistent with existing graph direction -->

Response nodes appear as **intermediaries** between the turn and its tools, chaining **left-to-right** (consistent with the existing dagre LR layout). Each response branches further right to its tools/agents.

```
┌─────────────────┐    ┌──────────────┐    ┌──────────────────┐
│ Prompt (amber)  │──→ │ Response 1   │──→ │ Toolgroup:       │
│ "Fix the bug"   │    │ "Let me..."  │    │ Read·Grep        │
│ ─ ─ ─ ─ ─ ─ ─  │    └──────┬───────┘    └──────────────────┘
│ Claude: "Done"  │           │
└─────────────────┘    ┌──────▼───────┐    ┌──────────────────┐
                       │ Response 2   │──→ │ Agent: Explore   │
                       │ "Done! The"  │    └──────────────────┘
                       └──────────────┘
```

### In-Progress State (automatic)

When Claude is still working, there's no response yet. The prompt node shows without the blue section — identical to today. The response fills in when `assistant_response` events arrive.

### Response Granularity (v1 vs v2)

<!-- revised: P1 — explicitly document single vs multi response strategy -->

**v1 (this plan):** The `Stop` hook fires once per turn, producing **one `assistant_response` event** containing the final/concatenated response text. The expanded view shows a single response node with all tools/agents as its children. This is still useful — it shows the response text separately from the prompt and groups the work under it.

**v2 (future):** Parse the transcript in `send_response.cjs` to emit **N events** (one per text segment between tool calls). The expanded view then shows a true response chain with tools attributed to specific segments. This is a pure enhancement — no breaking changes from v1.

## Implementation Plan

### Step G0: Verify hook pipeline (prerequisite gate)

<!-- revised: P1 PM — hook pipeline must be proven before any UI work -->

**Files:** `hooks/send_response.cjs`, `.claude/settings.local.json`, server logs

Before any UI work, confirm the data pipeline works end-to-end:

1. Verify `send_response.cjs` fires on the `Stop` hook event
2. Verify the POST reaches the server (check `hook_response_debug.log` or server logs)
3. Verify the event is stored in the `events` array and appears in the tool log panel
4. If the hook isn't firing, debug and fix before proceeding

**Gate:** An `assistant_response` event must appear in the dashboard's event list after a Claude response. If this gate fails, the remaining steps are blocked.

**Estimate:** ~30 min debugging, 0 new lines (hook script and settings already exist)

### Step G1: Wire `assistant_response` into the store

**Files:** `packages/core/src/types/agent.ts`, `apps/dashboard/src/store/eventHandlers.ts`, `apps/dashboard/src/store/agentStore.ts`

Currently `assistant_response` is in `NO_GRAPH_EVENTS` — events are stored but skip graph processing. We need to:

1. Add a `responses` map to the store: `Map<string, AssistantResponseData[]>` keyed by `sessionId`
2. Define `AssistantResponseData` in core types:
   ```typescript
   interface AssistantResponseData {
     id: string;
     sessionId: string;
     text: string;
     timestamp: number;
     promptId: string; // Resolved: last prompt with timestamp <= response timestamp
   }
   ```
3. Add a `handleAssistantResponse()` handler in `eventHandlers.ts` that:
   - Creates an `AssistantResponseData` and adds it to `responses` map
   <!-- revised: P1 — explicit prompt matching algorithm -->
   - **Prompt matching:** Find the last prompt in `draft.prompts.get(sessionId)` where `prompt.timestamp <= event.timestamp`. This is safe because the `Stop` hook always fires after the prompt that triggered it. Edge case: if no prompt exists yet (race condition), store with `promptId: ''` and backfill on next event.
   - Does NOT create nodes/edges (that's done in the visibility layer)
4. Remove `assistant_response` from `NO_GRAPH_EVENTS` and add the case to `processEvent()`

**Estimate:** ~40 lines changed

### Step G2: Add response text to `UserPromptNode` component

**Files:** `apps/dashboard/src/components/graph/nodes/UserPromptNode.tsx`

1. Read `responses` from store, filter to responses where `promptId === this prompt's id`
2. If responses exist, render a blue section below the prompt text:
   - Thin amber/blue divider line
   - Blue-tinted background section (`bg-blue-900/30 border border-blue-500/20`)
   - Response preview (last response text, truncated to ~60 chars)
   - Small "Claude" label in blue
   <!-- revised: P1 UX — clickable section, not just chevron -->
3. The entire blue section is clickable (not just a chevron). Expand chevron (▸/▾) shown on hover.
4. Wire the click handler to a new store action `toggleTurnExpanded(promptId)`
5. Short responses (< 10 chars): show inline without the full section wrapper

**Estimate:** ~50 lines added to the component

### Step G3: Add `expandedTurns` state to the store

**Files:** `apps/dashboard/src/store/agentStore.ts`

1. Add `expandedTurns: Set<string>` to store state (set of prompt node IDs, e.g. `"prompt-abc123"`)
2. Add `toggleTurnExpanded(promptId: string)` action
3. Initialize as empty set (all turns collapsed by default)

Note: `expandedTurns` is intentionally inverted from `collapsedNodes` — turns default to collapsed (showing inline response), nodes default to expanded (showing children). The naming reflects this: you "expand" a turn to see the response chain.

**Estimate:** ~15 lines

### Step G4: Create `AssistantResponseNode` component

**Files:** `apps/dashboard/src/components/graph/nodes/AssistantResponseNode.tsx`, `apps/dashboard/src/components/graph/nodeTypes.ts`

1. New node component with blue theme (matching the inline response section colors)
2. Shows: response text preview (truncated ~80 chars), timestamp
3. v1: single response node per turn (solid border, full opacity)
4. v2 future: intermediate segments get dashed border, dimmed opacity; final segment solid
5. Target handle (blue) on left, source handle (blue) on right for tools/agents
6. Register as `'assistantResponse'` in `nodeTypes.ts`

**Estimate:** ~80 lines for the component, ~2 lines for registration

### Step G5: Response node synthesis in `useVisibleGraph`

**Files:** `apps/dashboard/src/hooks/useVisibleGraph.ts`

This is the critical step. Add a new phase (Phase 1.5) between toolgroup synthesis and search filtering:

<!-- revised: P1 — explicit pseudocode for edge re-parenting post-Phase-1 -->

```typescript
// Phase 1.5: Response node synthesis for expanded turns
if (expandedTurns.size > 0) {
  const promptResponses = /* responses from store, grouped by promptId */;
  const reparentedSources = new Set<string>(); // edges we'll reparent

  for (const promptNodeId of expandedTurns) {
    const responses = promptResponses.get(promptNodeId);
    if (!responses?.length) continue;

    // Create synthetic response node(s)
    for (const [i, resp] of responses.entries()) {
      const respNodeId = `response-${resp.id}`;
      syntheticNodes.push({
        id: respNodeId,
        type: 'assistantResponse',
        data: { response: resp, index: i, total: responses.length },
        position: OFFSCREEN, style: HIDDEN_STYLE,
      });
    }

    // Chain edges: prompt → resp1, resp1 → resp2, ...
    const firstRespId = `response-${responses[0].id}`;
    syntheticEdges.push(makeEdge(promptNodeId, firstRespId));
    for (let i = 1; i < responses.length; i++) {
      syntheticEdges.push(makeEdge(
        `response-${responses[i-1].id}`,
        `response-${responses[i].id}`
      ));
    }

    // Re-parent: find all baseEdges where source === promptNodeId
    // (these are toolgroup edges, agent edges, structural tool edges)
    // Point them to the last response node instead
    const lastRespId = `response-${responses[responses.length - 1].id}`;
    for (const edge of baseEdges) {
      if (edge.source === promptNodeId && !edge.target.startsWith('prompt-')
          && !edge.target.startsWith('session-')) {
        reparentedSources.add(edge.id);
        syntheticEdges.push({ ...edge, id: `reparented-${edge.id}`, source: lastRespId });
      }
    }
  }

  // Filter out original edges that were reparented
  baseEdges = baseEdges.filter(e => !reparentedSources.has(e.id));
  baseNodes = [...baseNodes, ...syntheticNodes];
  baseEdges = [...baseEdges, ...syntheticEdges];
}
```

**v1 simplification:** With one response per turn, ALL children of the prompt get re-parented to that single response node. No timestamp correlation needed — just move every child edge.

**v2 enhancement:** With N responses per turn, use timestamp windows to attribute children to specific response segments.

**Estimate:** ~60 lines

### Step G6: Layout support

**Files:** `apps/dashboard/src/hooks/useAutoLayout.ts`

<!-- revised: P1 layout — responses flow LR like everything else -->

The dagre LR layout handles this naturally. Response nodes are just new nodes with edges flowing left-to-right. We need to:

1. Give `assistantResponse` nodes a default width (180px) and height (60px) for dagre
2. No special rank assignment needed — dagre LR will place responses between prompt and tools naturally

**Estimate:** ~5-10 lines (dimension defaults only)

## Files Changed Summary

| File                                                                  | Change Type                               | Lines          |
| --------------------------------------------------------------------- | ----------------------------------------- | -------------- |
| `packages/core/src/types/agent.ts`                                    | Add `AssistantResponseData` type          | ~10            |
| `apps/dashboard/src/store/eventHandlers.ts`                           | Add handler, remove from NO_GRAPH_EVENTS  | ~30            |
| `apps/dashboard/src/store/agentStore.ts`                              | Add `responses`, `expandedTurns`, actions | ~20            |
| `apps/dashboard/src/components/graph/nodes/UserPromptNode.tsx`        | Add blue response section + expand toggle | ~50            |
| `apps/dashboard/src/components/graph/nodes/AssistantResponseNode.tsx` | **New file** — response node component    | ~80            |
| `apps/dashboard/src/components/graph/nodeTypes.ts`                    | Register new type                         | ~2             |
| `apps/dashboard/src/hooks/useVisibleGraph.ts`                         | Phase 1.5 — response synthesis on expand  | ~60            |
| `apps/dashboard/src/hooks/useAutoLayout.ts`                           | Dimension defaults                        | ~10            |
| **Total**                                                             |                                           | **~260 lines** |

## Risk Assessment

**Low risk:**

- Steps G0-G3: Pure additions/verification, no existing behavior changes
- Step G4: New file, no existing code touched
- Step G6: Small addition to existing layout

**Medium risk:**

- Step G2: Modifying `UserPromptNode` — but changes are additive (new section below existing content)
- Step G5: Edge re-parenting logic — most complex part. Mitigated by:
  - Following the proven toolgroup synthesis pattern
  - Only activating when a turn is explicitly expanded (collapsed = today's behavior)
  - v1 simplification: one response per turn = all children move to one node (no timestamp correlation)
  - Easy to test: expand a turn, verify tools appear under the response node

**Zero risk to collapsed state:** When `expandedTurns` is empty (default), no synthetic nodes are created, no edges are modified. The graph is identical to today.

## Build Order

```
G0 (verify pipeline) → G1 (store) → G3 (expandedTurns) → G2 (prompt node UI) → G4 (response node) → G5 (synthesis) → G6 (layout)
```

G0 is a prerequisite gate. G1 and G3 can be done in parallel. G2 and G4 can be done in parallel after G1/G3. G5 depends on all prior steps. G6 can be done alongside G5.

## Testing Strategy

1. **Gate:** G0 — `assistant_response` event visible in dashboard event list
2. **Unit:** Store handlers — verify `responses` map populated correctly, prompt matching works
3. **Unit:** `useVisibleGraph` — verify synthetic nodes/edges created only for expanded turns
4. **Visual:** Simulate session with multiple prompts and responses, verify:
   - Collapsed: blue section visible in prompt node, tools as direct children
   - Expanded: response node visible between prompt and tools, all children re-parented
   - Toggle: smooth transition between states
5. **Regression:** Existing tests must pass unchanged (collapsed is default)

## Acceptance Criteria

A user can read the conversation flow (prompt + response) without leaving the graph view. Specifically:

- In collapsed mode, the prompt node shows both the user's question and Claude's answer
- In expanded mode, the response appears as a separate node with tools/agents as its children
- Toggling between states preserves node selection and viewport position

## Open Questions / Deferred

<!-- P2 items from review — not blocking v1 -->

1. **Node height jump:** Adding the blue response section increases node height, triggering dagre re-layout. Could cause a visible "jump" during live sessions. Monitor and smooth if needed.
2. **`responses` map size:** No explicit limit. Low concern since it's small data (text + timestamp). Add `MAX_RESPONSES` cap if needed later.
3. **Short response styling:** Responses < 10 chars shown inline. If this looks awkward in practice, adjust threshold.
4. **Keyboard shortcut:** Should there be a key to expand/collapse all turns? (Suggest: Shift+F or a new key). Defer to v2.
5. **Per-segment response attribution (v2):** Parse transcript to emit N `assistant_response` events per turn. Enables true response chain with tools attributed to specific segments. Pure enhancement over v1.
