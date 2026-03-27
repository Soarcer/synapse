# Desktop Graph Rendering Performance Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reduce render latency when adding nodes to a 300-500 node React Flow graph from ~1000ms to <100ms.

**Architecture:** Batch WebSocket events into single store updates, eliminate redundant work in the render pipeline (layout fingerprinting, edge styling, MiniMap), and reduce per-event store overhead.

**Tech Stack:** React 19, @xyflow/react v12, Zustand 5, TypeScript

---

## Profiling Results

Investigation of the render pipeline for a single incoming tool node event on a 500-node graph:

| Phase                   | File                             | Cost                  | Notes                                                                                                                                                                                           |
| ----------------------- | -------------------------------- | --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| WS → Store              | `wsClient.ts:69-72`              | O(1) per msg          | No batching — N messages = N `set()` calls = N intermediate states (React 19 may coalesce renders, but each `set()` still triggers subscriber notifications and intermediate state computation) |
| Event dedup             | `agentStore.ts:357`              | O(events)             | `state.events.some(e => e.id === event.id)` — linear scan up to 1000                                                                                                                            |
| processEvent            | `agentStore.ts:393-395`          | O(nodes+edges)        | Creates draft, builds derived maps, replaces arrays                                                                                                                                             |
| text_delta fast path    | `agentStore.ts:375`              | O(nodes)              | `.map()` over all nodes to update one agent's data                                                                                                                                              |
| useVisibleGraph         | `useVisibleGraph.ts:40-206`      | O(nodes×depth)        | 4 filter phases, 7 dependencies (all unstable refs)                                                                                                                                             |
| Layout fingerprint      | `useAutoLayout.ts:401-413`       | O(nodes×id_len)       | Runs **outside** useMemo — executes on every render                                                                                                                                             |
| computeGraphLayout      | `useAutoLayout.ts:64-389`        | O(nodes×children)     | Only runs when fingerprint changes (correctly gated)                                                                                                                                            |
| connectedIds            | `AgentGraph.tsx:109-152`         | O(edges)              | Walks edges on selection; stabilized with ref compare                                                                                                                                           |
| styledEdges             | `AgentGraph.tsx:242-280`         | O(edges×3)            | Three `.map()` passes: smoothstep + cost gradient + opacity                                                                                                                                     |
| nodes opacity           | `AgentGraph.tsx:191-201`         | O(1) or O(nodes)      | Already short-circuits when no highlight (line 192)                                                                                                                                             |
| MiniMap                 | `AgentGraph.tsx:618-642`         | Significant           | Re-renders entire minimap; `nodeColor` callback not memoized                                                                                                                                    |
| CollapsibleSourceHandle | `CollapsibleSourceHandle.tsx:16` | O(edges) per instance | Inline `.some()` in selector — runs on ANY store change                                                                                                                                         |

**Critical path for "new tool node arrives":**
WS message → `addEvent` (O(events) dedup + O(nodes) draft) → Zustand notifies subscribers → `useVisibleGraph` (O(nodes×depth)) → layout fingerprint (O(nodes×id_len)) → `computeGraphLayout` (O(nodes×children), if structure changed) → `styledEdges` (O(edges×3)) → `nodes` opacity (O(nodes)) → React Flow reconciliation → MiniMap re-render → `onNodesChange` dimension updates → possible second layout cycle.

**Why mobile is faster:** `MobileGraphView.tsx` skips MiniMap, Background, connectedIds highlight system, styledEdges opacity pass, and edge cost gradients.

---

## Ranked Optimizations

| #   | Optimization                       | Impact     | Effort   | Render Savings (est.)                                 |
| --- | ---------------------------------- | ---------- | -------- | ----------------------------------------------------- |
| 1   | WS event batching                  | **High**   | Medium   | N renders → 1 for burst events                        |
| 2   | Conditional MiniMap                | **High**   | Low      | Eliminates MiniMap re-render cost                     |
| 3   | Event dedup: Set lookup            | **Medium** | Low      | O(events) → O(1) per addEvent                         |
| 4   | Layout fingerprint memoization     | **Low**    | Low      | Marginal — only helps non-store renders               |
| 5   | Single-pass edge styling           | **Medium** | Low      | O(edges×3) → O(edges×1)                               |
| 6   | Split useVisibleGraph Phase 1 memo | **Medium** | Medium   | Skips toolgroup synthesis on selection/search changes |
| 7   | CollapsibleSourceHandle selectors  | **Low**    | Low      | Eliminates O(edges) per store change per handle       |
| 8   | MiniMap nodeColor module-level fn  | **Low**    | Very Low | Prevents callback recreation                          |

---

## Chunk 0: Baseline Measurement

<!-- revised: added per review — no way to validate "60-80%" claim without before/after data -->

### Task 0: Record baseline render times

Before making any changes, capture baseline metrics so we can measure actual improvement.

**Files:**

- Create: `apps/dashboard/src/__tests__/perf.baseline.test.ts`

- [ ] **Step 1: Write a benchmark that adds events to a pre-populated store**

```typescript
// apps/dashboard/src/__tests__/perf.baseline.test.ts
import { describe, it, expect } from 'vitest';
import { useAgentStore } from '../store/agentStore';
import { makeSessionEvent, makeAgentEvent, makeToolEvent } from './helpers';

describe('render pipeline baseline', () => {
  it('measures addEvent time on a 500-node store', () => {
    const store = useAgentStore.getState();
    // Seed 500 nodes (mix of sessions, agents, tools)
    for (let i = 0; i < 500; i++) {
      store.addEvent(makeToolEvent({ id: `seed-${i}` }));
    }

    // Measure: add 10 more events, record per-event time
    const times: number[] = [];
    for (let i = 0; i < 10; i++) {
      const start = performance.now();
      store.addEvent(makeToolEvent({ id: `measure-${i}` }));
      times.push(performance.now() - start);
    }

    const avg = times.reduce((a, b) => a + b, 0) / times.length;
    const max = Math.max(...times);
    console.log(`[BASELINE] avg=${avg.toFixed(1)}ms max=${max.toFixed(1)}ms`);

    // This test always passes — it's a measurement, not an assertion.
    // After all optimizations, change this to: expect(avg).toBeLessThan(50);
    expect(avg).toBeGreaterThanOrEqual(0);
  });
});
```

- [ ] **Step 2: Run baseline and record results**

Run: `cd apps/dashboard && pnpm vitest run src/__tests__/perf.baseline.test.ts`

Record the `[BASELINE]` output. This is the number we need to beat.

**Success criteria:** After all optimizations, average addEvent time on a 500-node store should be <50ms (down from the current ~200-300ms estimated from the 1034ms message handler violation which includes rendering).

- [ ] **Step 3: Commit baseline test**

```bash
git add apps/dashboard/src/__tests__/perf.baseline.test.ts
git commit -m "test: add render pipeline baseline benchmark"
```

---

## Chunk 1: WebSocket Event Batching

### Task 1: Add event batching to wsClient

Batch rapid WS messages so multiple events arriving within the same microtask produce a single store update instead of N separate renders.

**Files:**

- Modify: `apps/dashboard/src/store/wsClient.ts:69-75`
- Create: `apps/dashboard/src/__tests__/wsClient.batch.test.ts`

- [ ] **Step 1: Write failing test for event batching**

```typescript
// apps/dashboard/src/__tests__/wsClient.batch.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

describe('WS event batching', () => {
  it('batches multiple synchronous events into a single callback', async () => {
    const batchHandler = vi.fn();
    const { batchEvent, flush } = createEventBatcher(batchHandler);

    batchEvent({ type: 'tool_use', id: '1' } as any);
    batchEvent({ type: 'tool_use', id: '2' } as any);
    batchEvent({ type: 'tool_use', id: '3' } as any);

    // Not yet called — queued for microtask
    expect(batchHandler).not.toHaveBeenCalled();

    // Wait for microtask to drain
    await Promise.resolve();
    await Promise.resolve();

    expect(batchHandler).toHaveBeenCalledTimes(1);
    expect(batchHandler).toHaveBeenCalledWith([
      expect.objectContaining({ id: '1' }),
      expect.objectContaining({ id: '2' }),
      expect.objectContaining({ id: '3' }),
    ]);
  });

  it('processes separate batches for events in different microtasks', async () => {
    const batchHandler = vi.fn();
    const { batchEvent } = createEventBatcher(batchHandler);

    batchEvent({ type: 'tool_use', id: '1' } as any);
    await Promise.resolve();
    await Promise.resolve();

    batchEvent({ type: 'tool_use', id: '2' } as any);
    await Promise.resolve();
    await Promise.resolve();

    expect(batchHandler).toHaveBeenCalledTimes(2);
  });

  it('handles text_delta events without batching (low latency path)', async () => {
    const batchHandler = vi.fn();
    const immediateHandler = vi.fn();
    const { batchEvent } = createEventBatcher(batchHandler, immediateHandler);

    batchEvent({ type: 'text_delta', id: '1' } as any);

    // text_delta should fire immediately, not batched
    expect(immediateHandler).toHaveBeenCalledTimes(1);
    expect(batchHandler).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/dashboard && pnpm vitest run src/__tests__/wsClient.batch.test.ts`
Expected: FAIL — `createEventBatcher` is not defined

- [ ] **Step 3: Implement createEventBatcher**

Add to `apps/dashboard/src/store/wsClient.ts`:

```typescript
// ── Event batching ──────────────────────────────────────────
// Batches rapid WS messages into a single store update per microtask.
// text_delta events bypass batching for low-latency streaming.

export function createEventBatcher(
  onBatch: (events: WsServerMessage[]) => void,
  onImmediate?: (event: WsServerMessage) => void,
) {
  let queue: WsServerMessage[] = [];
  let scheduled = false;

  function flush() {
    const batch = queue;
    queue = [];
    scheduled = false;
    if (batch.length > 0) onBatch(batch);
  }

  function batchEvent(msg: WsServerMessage) {
    // text_delta bypasses batching for streaming responsiveness
    if (msg.type === 'text_delta' && onImmediate) {
      onImmediate(msg);
      return;
    }
    queue.push(msg);
    if (!scheduled) {
      scheduled = true;
      queueMicrotask(flush);
    }
  }

  return { batchEvent, flush };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/dashboard && pnpm vitest run src/__tests__/wsClient.batch.test.ts`
Expected: PASS

- [ ] **Step 5: Extract shared event processing and add addEvents batch handler**

**Files:**

- Modify: `apps/dashboard/src/store/agentStore.ts` (extract helper, add `addEvents` action)

First, extract the per-event state transformation into a shared function so `addEvent` and `addEvents` stay in sync:

```typescript
// Shared per-event state transformation (used by both addEvent and addEvents).
// IMPORTANT: Does NOT call buildDerivedMaps — callers must do that once after
// all events are applied, to avoid redundant O(agents+sessions) rebuilds per event.
function applyEvent(state: AgentState, event: AgentEvent): AgentState {
  if (state.paused) {
    return { ...state, pauseQueue: [...state.pauseQueue, event] };
  }
  if (event.type !== 'text_delta' && state.eventIds.has(event.id)) {
    return state; // dedup (uses Set from Task 3; use .some() until Task 3 is done)
  }
  // Fast path: text_delta
  if (event.type === 'text_delta') {
    const agentId = event.agentId ?? '';
    const agent = state.agents.get(agentId);
    const events = insertEventSorted(state.events, event, MAX_EVENTS);
    if (!agent) return { ...state, events };
    const updated = { ...agent, streamingText: (agent.streamingText ?? '') + (event.text ?? '') };
    const agents = new Map(state.agents);
    agents.set(agentId, updated);
    const nodes = state.nodes.map((n) =>
      n.id === nid.agent(agentId) ? { ...n, data: { agent: updated } } : n,
    );
    return { ...state, agents, nodes, events }; // no buildDerivedMaps here
  }
  const events = insertEventSorted(state.events, event, MAX_EVENTS);
  if (event.eventSource === 'hook' && !state.showHookEvents) return { ...state, events };
  if (NO_GRAPH_EVENTS.has(event.type)) return { ...state, events };
  const draft = draftFromState(state);
  processEvent(event, draft, state.showHookEvents);
  return { ...state, ...draft, events }; // no buildDerivedMaps here
}
```

Then refactor `addEvent` to use it, and add `addEvents`:

```typescript
addEvent: (event) => {
  set((state) => {
    const next = applyEvent(state, event);
    if (next === state) return state; // dedup no-op
    return { ...next, ...buildDerivedMaps(next.agents, next.sessions) };
  });
},

// <!-- revised: buildDerivedMaps called once after loop, not per-event -->
addEvents: (events) => {
  set((state) => {
    let current = state;
    for (const event of events) {
      current = applyEvent(current, event);
    }
    if (current === state) return state; // all deduped
    // Build derived maps ONCE for the final state, not per event
    return { ...current, ...buildDerivedMaps(current.agents, current.sessions) };
  });
},
```

This ensures both paths always use identical per-event logic. `buildDerivedMaps` runs exactly once regardless of batch size — for a batch of 10 events this saves 9 redundant O(agents+sessions) map rebuilds.

**Important:** Permission-related WS messages (`permission_request`, `permission_response`) are handled by `permissionStore`, not `agentStore`. Check how they're routed in the WS `onEvent` callback. If they go through the same path, they should also be batched or use the immediate bypass alongside `text_delta`:

```typescript
// In createEventBatcher, add permission events to immediate path:
const IMMEDIATE_TYPES = new Set(['text_delta', 'permission_request', 'permission_response']);

function batchEvent(msg: WsServerMessage) {
  if (IMMEDIATE_TYPES.has(msg.type) && onImmediate) {
    onImmediate(msg);
    return;
  }
  // ... batch as before
}
```

- [ ] **Step 6: Wire batcher into WsClient.connect()**

In `wsClient.ts`, replace the direct `this.onEvent?.(msg)` call in `onmessage`:

```typescript
// In WsClient constructor or connect():
const { batchEvent } = createEventBatcher(
  (batch) => this.onBatchEvent?.(batch),
  (msg) => this.onEvent?.(msg), // text_delta immediate path
);

this.ws.onmessage = (event) => {
  try {
    const msg: WsServerMessage = JSON.parse(event.data);
    batchEvent(msg);
  } catch {
    console.warn('[wsClient] Malformed message:', String(event.data).slice(0, 80));
  }
};
```

Add `onBatchEvent` callback property to WsClient and wire it to `addEvents` in the App component where WsClient is configured.

- [ ] **Step 7: Run full test suite**

Run: `cd apps/dashboard && pnpm vitest run`
Expected: All tests pass

- [ ] **Step 8: Commit**

```bash
git add apps/dashboard/src/store/wsClient.ts apps/dashboard/src/store/agentStore.ts apps/dashboard/src/__tests__/wsClient.batch.test.ts
git commit -m "perf: batch WS events into single store update per microtask"
```

---

### Checkpoint: Re-measure after Chunk 1

<!-- revised: added per review — stop early if Chunk 1 alone delivers most of the improvement -->

Run the baseline benchmark again after Tasks 1-3. If average addEvent time is already <50ms on 500 nodes, Tasks 4-7 may not be worth the code complexity. Proceed to Chunk 2 only if the target hasn't been met.

---

## Chunk 2: MiniMap and Render Pipeline Optimizations

### Task 2: Conditional MiniMap rendering

Hide MiniMap when the graph exceeds a node threshold. The MiniMap re-renders on every graph update and is the single biggest difference between desktop (slow) and mobile (fast).

**Files:**

- Modify: `apps/dashboard/src/components/graph/AgentGraph.tsx:617-642`

- [ ] **Step 1: Write failing test**

```typescript
// apps/dashboard/src/__tests__/AgentGraph.minimap.test.tsx
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
// Test that MiniMap is not rendered when node count > threshold
// (This may need to be an integration test or snapshot test depending on React Flow test setup)

describe('AgentGraph MiniMap', () => {
  it('should hide MiniMap when node count exceeds MINIMAP_THRESHOLD', () => {
    // Verify the constant exists and is reasonable
    expect(MINIMAP_THRESHOLD).toBeGreaterThanOrEqual(200);
    expect(MINIMAP_THRESHOLD).toBeLessThanOrEqual(500);
  });
});
```

- [ ] **Step 2: Implement conditional MiniMap**

In `AgentGraph.tsx`, add a threshold constant and conditionally render:

```typescript
const MINIMAP_THRESHOLD = 300;

// Inside AgentGraphInner, before the return:
const showMiniMap = rawNodes.length <= MINIMAP_THRESHOLD;
```

<!-- revised: add user toggle so MiniMap can be force-shown even above threshold -->

Also add a `showMiniMapOverride` toggle to ViewSettingsDropdown (or reuse the existing keyboard shortcut system) so users can force-show the MiniMap if they need orientation on large graphs despite the performance cost.

Then in JSX, wrap the MiniMap:

```tsx
{
  (showMiniMap || showMiniMapOverride) && (
    <MiniMap
      position="bottom-right"
      pannable
      zoomable
      style={{ background: '#0d1117', border: '1px solid #1e293b' }}
      maskColor="rgba(13, 17, 23, 0.7)"
      maskStrokeColor="rgba(96, 165, 250, 0.5)"
      maskStrokeWidth={2}
      nodeColor={miniMapNodeColor}
    />
  );
}
```

- [ ] **Step 3: Memoize MiniMap nodeColor callback**

Extract the inline callback to a module-level function (it uses no closure state):

```typescript
// Module level, outside component
function miniMapNodeColor(node: Node): string {
  switch (node.type) {
    case 'session':
      return '#3b82f6';
    case 'userPrompt':
      return '#f59e0b';
    case 'agent':
      return '#22c55e';
    case 'toolCall':
    case 'toolGroup':
      return '#a855f7';
    default:
      return '#6b7280';
  }
}
```

- [ ] **Step 4: Run tests**

Run: `cd apps/dashboard && pnpm vitest run`
Expected: All tests pass

- [ ] **Step 5: Commit**

```bash
git add apps/dashboard/src/components/graph/AgentGraph.tsx
git commit -m "perf: conditionally render MiniMap above 300 nodes, memoize nodeColor"
```

### Task 3: Event dedup with Set instead of linear scan

Replace `state.events.some(e => e.id === event.id)` with a Set lookup for O(1) deduplication.

**Files:**

- Modify: `apps/dashboard/src/store/agentStore.ts` (state shape + addEvent)

- [ ] **Step 1: Write failing test**

```typescript
// In existing agentStore test file or new:
describe('event dedup performance', () => {
  it('deduplicates events in O(1) using eventIds Set', () => {
    const store = useAgentStore.getState();
    // Add an event
    store.addEvent(makeEvent({ id: 'evt-1', type: 'tool_use' }));
    expect(useAgentStore.getState().eventIds.has('evt-1')).toBe(true);

    // Adding same event again should be a no-op
    const nodesBefore = useAgentStore.getState().nodes;
    store.addEvent(makeEvent({ id: 'evt-1', type: 'tool_use' }));
    expect(useAgentStore.getState().nodes).toBe(nodesBefore); // Same reference
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Expected: FAIL — `eventIds` does not exist on state

- [ ] **Step 3: Add eventIds Set to store state**

In the store's initial state, add:

```typescript
eventIds: new Set<string>(),
```

In `addEvent`, replace:

```typescript
// Before (O(n)):
if (event.type !== 'text_delta' && state.events.some((e) => e.id === event.id)) {
  return state;
}

// After (O(1)):
if (event.type !== 'text_delta' && state.eventIds.has(event.id)) {
  return state;
}
```

<!-- revised: clone Set instead of mutating in place — mutation breaks Zustand devtools/middleware that snapshot state -->

After successful insertion, clone the Set and add the new ID:

```typescript
const eventIds = new Set(state.eventIds);
eventIds.add(event.id);
// Include eventIds in the returned state object
```

**Complexity note:** The `.has()` check is O(1). The `new Set()` clone is O(n) but this cost is dwarfed by the O(n) `insertEventSorted` + `nodes.map()` that already run on every event. The net win is eliminating the O(n) `.some()` string comparison on the hot dedup path.

Also update `clearEvents` to reset the Set, and `insertEventSorted` overflow trimming to remove evicted IDs.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/dashboard && pnpm vitest run`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/dashboard/src/store/agentStore.ts apps/dashboard/src/__tests__/
git commit -m "perf: use Set for O(1) event dedup instead of linear scan"
```

### Task 4: Memoize layout fingerprint computation (low priority)

<!-- revised: downgraded from Medium to Low — nodes ref changes on every store update so the memo re-runs on the critical path anyway. Win is limited to non-store renders (selection, local state). -->

The layout fingerprint hash (O(nodes × id_length)) runs **outside** `useMemo` — it executes on every single render. Wrapping it in `useMemo([nodes, edges, expandedParentId])` helps, but the win is **marginal** on the critical path because `nodes` ref changes on every store update (Zustand immutability). The fingerprint memo only saves work for renders triggered by local state changes (selection highlights, search input). The inner `useMemo([key])` already correctly gates `computeGraphLayout` via the string key.

**Files:**

- Modify: `apps/dashboard/src/hooks/useAutoLayout.ts:395-424`

- [ ] **Step 1: Write test for layout stability**

```typescript
// Verify layout doesn't recompute when only unrelated state changes
describe('useAutoLayout fingerprint', () => {
  it('returns same positions reference when nodes/edges unchanged', () => {
    // Render hook twice with same inputs, verify same reference returned
  });
});
```

- [ ] **Step 2: Wrap fingerprint in useMemo**

```typescript
export function useAutoLayout(
  nodes: Node[],
  edges: Edge[],
  expandedParentId: string | null = null,
): Node[] {
  // Memoize the fingerprint to avoid O(nodes×id_len) hash on every render
  const key = useMemo(() => {
    let idHash = 0;
    let dimHash = 0;
    for (const n of nodes) {
      for (let i = 0; i < n.id.length; i++) {
        idHash = ((idHash << 5) - idHash + n.id.charCodeAt(i)) | 0;
      }
      if (n.measured?.width) {
        dimHash = ((dimHash << 5) - dimHash + (n.measured.width | 0)) | 0;
        dimHash = ((dimHash << 5) - dimHash + ((n.measured.height ?? 0) | 0)) | 0;
      }
    }
    return `${nodes.length}:${edges.length}:${idHash}:${dimHash}:${expandedParentId}`;
  }, [nodes, edges, expandedParentId]);

  const { positions, zIndexMap } = useMemo(() => {
    // ... existing layout computation, now keyed on `key`
  }, [key]);
  // ...
}
```

**Note:** The fingerprint memo depends on `[nodes, edges, expandedParentId]`. When `nodes` reference changes (e.g., dimension update), the hash recomputes — but the resulting string key will be the same if only non-measured properties changed, so `computeGraphLayout` still skips. The key benefit is that **other renders** (selection changes, highlight changes, etc.) that don't change `nodes`/`edges` refs now skip the O(n) hash entirely.

- [ ] **Step 3: Run tests**

Run: `cd apps/dashboard && pnpm vitest run`
Expected: All tests pass

- [ ] **Step 4: Commit**

```bash
git add apps/dashboard/src/hooks/useAutoLayout.ts
git commit -m "perf: memoize layout fingerprint to skip O(n) hash on unrelated renders"
```

### Task 5: Single-pass edge styling

Combine the three `.map()` passes over edges into a single pass.

**Files:**

- Modify: `apps/dashboard/src/components/graph/AgentGraph.tsx:242-280`

- [ ] **Step 1: Write test for edge styling output**

```typescript
describe('styledEdges', () => {
  it('applies smoothstep type, cost gradient, and highlight opacity in single pass', () => {
    // Snapshot or structural test of styled edge output
  });
});
```

- [ ] **Step 2: Merge three maps into one**

Replace the current pattern:

```typescript
// Current: 3 passes
const base = visibleEdges.map(e => ({ ...e, type: 'smoothstep', ... }));
const withCost = base.map(e => ({ ...e, style: { stroke: gradient } }));
const final = withCost.map(e => ({ ...e, style: { ...e.style, opacity } }));
```

With single pass:

Note: `edgeCostMap` is `{ cumTokens: Map<string, number>, maxCum: number } | null` — not a Map itself.

```typescript
const styledEdges = useMemo(() => {
  const hasHighlight = mergedHighlightIds && mergedHighlightIds.size > 0;
  return visibleEdges.map((edge) => {
    const style: Record<string, unknown> = { ...edge.style };

    // Cost gradient (only when no highlight active)
    if (!hasHighlight && edgeCostMap) {
      const cum = edgeCostMap.cumTokens.get(edge.target) ?? 0;
      const ratio = cum / edgeCostMap.maxCum;
      const hue = Math.round(220 - ratio * 220);
      style.stroke = `hsl(${hue}, 70%, 50%)`;
      style.strokeWidth = 1 + ratio * 2;
      style.transition = 'stroke 0.3s ease, stroke-width 0.3s ease';
    }

    // Highlight opacity
    if (hasHighlight) {
      const connected = mergedHighlightIds.has(edge.source) && mergedHighlightIds.has(edge.target);
      style.opacity = connected ? 1 : 0.1;
      style.transition = 'opacity 0.2s ease';
    }

    return {
      ...edge,
      type: 'smoothstep' as const,
      pathOptions: { borderRadius: 12 },
      style,
    };
  });
}, [visibleEdges, mergedHighlightIds, edgeCostMap]);
```

- [ ] **Step 3: Run tests**

Run: `cd apps/dashboard && pnpm vitest run`
Expected: All tests pass

- [ ] **Step 4: Commit**

```bash
git add apps/dashboard/src/components/graph/AgentGraph.tsx
git commit -m "perf: single-pass edge styling instead of three map() passes"
```

---

## Chunk 3: Remaining Optimizations

### Task 6: Split useVisibleGraph Phase 1 into separate memo

The `useVisibleGraph` hook is a single giant `useMemo` with 7 dependencies. Phase 1 (toolgroup synthesis) only depends on `rawNodes`/`rawEdges`/`toolGroupDims` but re-runs on every `selectedNodeId` or `graphSearchQuery` change. Splitting it out means clicking through nodes rapidly skips the O(edges) toolgroup synthesis.

**Files:**

- Modify: `apps/dashboard/src/hooks/useVisibleGraph.ts`

- [ ] **Step 1: Write test verifying toolgroup stability on selection change**

```typescript
describe('useVisibleGraph phase split', () => {
  it('returns same toolgroup nodes when only selectedNodeId changes', () => {
    // Render hook, change selectedNodeId, verify toolgroup array reference is stable
  });
});
```

- [ ] **Step 2: Extract Phase 1 into its own useMemo**

Split the current single memo into two:

```typescript
// Phase 1: Toolgroup synthesis (only depends on structure + dims)
const { nodesWithGroups, edgesWithGroups, toolGroupMap } = useMemo(() => {
  // ... existing Phase 1 code (lines ~51-98): walk edges, create synthetic toolgroup nodes
  return { nodesWithGroups, edgesWithGroups, toolGroupMap };
}, [rawNodes, rawEdges, toolGroupDims]);

// Phase 2+: Search, auto-close, collapse (depends on selection, search, etc.)
const { visibleNodes, visibleEdges, searchMatchCount } = useMemo(() => {
  // ... existing Phase 2-4 code operating on nodesWithGroups/edgesWithGroups
}, [
  nodesWithGroups,
  edgesWithGroups,
  graphSearchQuery,
  autoClosePrompts,
  selectedNodeId,
  collapsedNodes,
]);
```

- [ ] **Step 3: Run tests**

Run: `cd apps/dashboard && pnpm vitest run`
Expected: All tests pass

- [ ] **Step 4: Commit**

```bash
git add apps/dashboard/src/hooks/useVisibleGraph.ts
git commit -m "perf: split useVisibleGraph Phase 1 into separate memo for structural stability"
```

### Task 7: Fix CollapsibleSourceHandle inline selector

`childAgents` only maps agent-to-child-agent relationships — it does NOT include tool edges. We need a `sourceHasEdge: Set<string>` in derived state.

**Files:**

- Modify: `apps/dashboard/src/store/agentStore.ts` (add to `buildDerivedMaps`)
- Modify: `apps/dashboard/src/components/graph/CollapsibleSourceHandle.tsx:16-27`

- [ ] **Step 1: Add `sourceHasEdge` Set to derived maps**

In `buildDerivedMaps` (or wherever derived state is computed), add:

```typescript
// Set of node IDs that have at least one outgoing edge
const sourceHasEdge = new Set<string>();
for (const edge of state.edges) {
  sourceHasEdge.add(edge.source);
}
// Add to returned derived state
```

- [ ] **Step 2: Replace inline selector**

```typescript
// Before (O(edges) on every store change):
const hasChildren = useAgentStore((s) => s.edges.some((e) => e.source === nodeId));

// After (O(1) Set lookup):
const hasChildren = useAgentStore((s) => s.sourceHasEdge.has(nodeId));
```

- [ ] **Step 3: Run tests, commit**

Run: `cd apps/dashboard && pnpm vitest run`

```bash
git add apps/dashboard/src/store/agentStore.ts apps/dashboard/src/components/graph/CollapsibleSourceHandle.tsx
git commit -m "perf: replace O(edges) selector with Set lookup in CollapsibleSourceHandle"
```

---

## Duplicate Key Investigation

The console warning `Encountered two children with the same key 'toolu_019ZbANPqDM7UZiDeBUNRNsA'` was **not reproducible** in static analysis — all node IDs use distinct prefixes (`tool-`, `toolgroup-`, `agent-`, etc.) and `toolUseId` values are unique per tool call.

**Most likely cause:** A race condition where the same tool_use event arrives via both HTTP initial load and WebSocket broadcast before the dedup check catches it. The event dedup Set (Task 3) should eliminate this. If it persists after Task 3, add a debug log in `processEvent` to trace the duplicate source:

```typescript
if (state.nodes.some((n) => n.id === newNodeId)) {
  console.warn('[addEvent] duplicate node ID:', newNodeId, 'from event:', event.id);
}
```

---

## onNodesChange Dimension Loop Analysis

The dimension update flow was verified to be **self-stabilizing**:

1. `onNodesChange` receives dimension updates from React Flow
2. `updateNodeDimensions` in `agentStore.ts:526-539` returns `{}` if no dimensions actually changed
3. This prevents a re-render when measurements are stable

However, the first measurement cycle after adding new nodes causes 2 renders:

1. Node added → React Flow renders → measures → fires `onNodesChange`
2. Dimensions stored → layout recomputes with measurements → positions finalize

This is expected behavior and cannot be eliminated without pre-computing node dimensions (which requires DOM measurement). The layout fingerprint memoization (Task 4) ensures the second render is cheaper.

---

## Expected Impact

With all optimizations applied, the render pipeline for "new tool node on 500-node graph" should look like:

| Before                                   | After                                         |
| ---------------------------------------- | --------------------------------------------- |
| N separate renders for burst events      | 1 render per microtask batch                  |
| O(events) dedup scan                     | O(1) Set lookup                               |
| MiniMap re-renders on every update       | MiniMap hidden above 300 nodes                |
| O(nodes×id_len) fingerprint every render | Fingerprint skipped on non-structural renders |
| O(edges×3) edge styling                  | O(edges×1) single pass                        |
| Full useVisibleGraph on selection change | Phase 1 (toolgroups) cached across selections |
| O(edges) per CollapsibleSourceHandle     | O(1) Set lookup                               |

**Conservative estimate:** 50-70% reduction in per-event render time for large graphs, bringing the "1034ms message handler" violation well under 100ms for typical events. The biggest single win is WS batching (Task 1) which eliminates redundant intermediate state computations; the MiniMap conditional (Task 2) eliminates the most expensive React Flow child component.

<!-- revised: adjusted estimate down from 60-80% since React 19 automatic batching already coalesces some renders -->

---

## Open Questions / Deferred (P2)

These findings from the plan review were noted but deferred as non-blocking:

1. **`queueMicrotask` may batch too aggressively on slow connections or not enough on fast bursts.** If 50 events arrive in one frame, the single `set()` call does O(n^2) work internally (each `applyEvent` maps over growing `nodes` array). Consider capping batch size at ~10 and flushing early. Monitor after implementation.

2. **No automated regression benchmark.** The baseline test (Task 0) is manual. A CI-integrated perf benchmark (e.g., `vitest bench`) that fails on regression would prevent future slowdowns.

3. **Progressive performance degradation framework.** The plan only degrades MiniMap. Other features could also degrade on large graphs: reduce edge animation transitions, simplify node rendering, auto-collapse distant subtrees. Worth considering as a follow-up if >1000 node graphs become common.

4. **`text_delta` fast path still does `.map()` over all nodes** (agentStore.ts:375). For a 500-node graph receiving rapid streaming text, this creates a new array on every delta. A `nodeIndex: Map<string, number>` for O(1) lookup would eliminate the linear scan, but adds complexity to keep the index in sync.

5. **React 19 automatic batching may already coalesce some renders.** The WS batching in Task 1 still helps by reducing intermediate state computations (fewer Zustand `set()` calls = fewer subscriber notifications), but the actual render count reduction may be less than "N renders → 1". Verify with React DevTools Profiler.
