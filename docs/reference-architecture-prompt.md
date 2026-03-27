# Node Graph Architecture — Reference Prompt for Writing Experiment App

> **What this is**: A proven architecture for building a live-streaming, hierarchical node graph
> using React + Zustand + React Flow (@xyflow/react). Extracted from Synapse, which monitors
> AI agent sessions in real-time. Your app has the same structure — just different domain nouns.

## Hierarchy Mapping

| Concept               | Synapse (source)      | Writing App (target)       |
| --------------------- | --------------------- | -------------------------- |
| Top-level container   | Session               | Experiment                 |
| Mid-level actor       | Agent                 | Story                      |
| Grouped leaf items    | ToolGroup (composite) | ChapterStrip (composite)   |
| Individual leaf item  | ToolCall              | Chapter                    |
| Container→Actor edge  | Session→Agent         | Experiment→Story           |
| Actor→Leaves edge     | Agent→ToolGroup       | Story→ChapterStrip         |
| Status lifecycle      | running→success/error | running→scored/verdict     |
| Auto-expand trigger   | Agent status=running  | Experiment status=running  |
| Auto-collapse trigger | Agent status=done     | Experiment verdict arrived |

## Pattern 1: Deterministic Node/Edge IDs

Every node and edge gets a deterministic, prefix-based ID. This prevents duplicates,
enables O(1) lookup, and makes parent→child correlation trivial.

```typescript
// ID generators — pure functions, no randomness
export const nid = {
  experiment: (id: string) => `experiment-${id}`,
  story: (id: string) => `story-${id}`,
  chapter: (id: string) => `chapter-${id}`,
} as const;

export function eid(source: string, target: string): string {
  return `edge-${source}-${target}`;
}
```

**Why this matters**: When events arrive out-of-order (and they will over WebSocket),
you can check `draft.nodes.some(n => n.id === nid.story(id))` to avoid duplicates,
and build edges by combining known IDs without waiting for both ends to exist.

## Pattern 2: StateDraft — Mutable Batch Processing

Don't dispatch individual Zustand updates per event. Instead, clone state into a
mutable draft, process all events in a batch, then commit once.

```typescript
interface StateDraft {
  experiments: Map<string, ExperimentData>;
  stories: Map<string, StoryData>;
  chapters: Map<string, ChapterData>;
  // Correlation maps (see Pattern 5)
  activeStories: Map<string, string[]>; // experimentId → running storyIds
  nodes: Node[];
  edges: Edge[];
}

function createFreshDraft(): StateDraft {
  /* new Maps, empty arrays */
}
function draftFromState(state: StateDraft): StateDraft {
  /* shallow clone all Maps/arrays */
}
```

**The flow**:

1. WebSocket batch arrives (see Pattern 3)
2. `const draft = draftFromState(currentState)`
3. For each event: `processEvent(event, draft)` — mutates draft in place
4. `zustandStore.setState(draft)` — single render

## Pattern 3: WebSocket Event Batching

Rapid events (chapters arriving fast) should be coalesced into one React render.

```typescript
function createEventBatcher(onBatch: (events: Event[]) => void) {
  let queue: Event[] = [];
  let scheduled = false;

  return {
    push(event: Event) {
      queue.push(event);
      if (!scheduled) {
        scheduled = true;
        queueMicrotask(() => {
          const batch = queue;
          queue = [];
          scheduled = false;
          onBatch(batch);
        });
      }
    },
  };
}
```

**Why queueMicrotask**: Groups all events that arrive in the same tick into one
store update → one React render. Without this, 10 chapters arriving in 50ms
cause 10 separate re-renders.

## Pattern 4: Event→Node Pipeline (the core pattern)

Each event type has a handler that mutates the draft. The handler:

1. Ensures parent exists (creates placeholder if needed)
2. Creates the data record in the Map
3. Pushes a React Flow Node
4. Determines parent and pushes an Edge

```typescript
function handleStoryStart(event: AppEvent, draft: StateDraft): void {
  // 1. Ensure parent experiment exists
  ensureExperiment(event.experimentId, event.timestamp, draft);

  // 2. Create domain data
  const story: StoryData = {
    storyId: event.storyId,
    genre: event.genre,
    status: 'running',
    chapters: [],
    startTime: event.timestamp,
  };
  draft.stories.set(event.storyId, story);

  // 3. Track active stories for chapter→story inference
  const active = draft.activeStories.get(event.experimentId) ?? [];
  draft.activeStories.set(event.experimentId, [...active, event.storyId]);

  // 4. Push React Flow node (offscreen — layout pass positions it)
  draft.nodes.push({
    id: nid.story(event.storyId),
    type: 'story',
    position: { x: -9999, y: -9999 }, // offscreen
    style: { visibility: 'hidden' as const }, // invisible until layout
    data: { story },
  });

  // 5. Push edge: experiment → story
  draft.edges.push({
    id: eid(nid.experiment(event.experimentId), nid.story(event.storyId)),
    source: nid.experiment(event.experimentId),
    target: nid.story(event.storyId),
    type: 'animated',
    animated: true,
    data: { status: 'running' },
  });
}
```

**Critical detail — OFFSCREEN + HIDDEN**: New nodes are placed at (-9999, -9999) with
`visibility: hidden`. The layout hook (Pattern 7) positions them correctly, then
React Flow reveals them. This prevents a flash of nodes at (0,0) before layout runs.

## Pattern 5: Parent Inference When Events Lack Parent IDs

Sometimes a "chapter started" event doesn't include which story it belongs to.
Synapse solves this by tracking active (running) agents per session:

```typescript
// On story start: push to activeStories
// On story end:   remove from activeStories
// On chapter start without storyId:
const active = draft.activeStories.get(event.experimentId) ?? [];
const inferredStoryId = active[active.length - 1]; // latest running story
```

This "latest active parent" heuristic works well for sequential processing.
For parallel stories, you'll need explicit IDs in the events.

## Pattern 6: Composite Nodes (ChapterStrip = our ToolGroup)

**Key insight**: The store holds individual chapter nodes. A visibility hook
synthesizes composite "chapter strip" nodes at render time. This keeps the
store simple while the UI shows grouped views.

```
Store layer:  chapter-c1, chapter-c2, chapter-c3  (individual nodes)
     ↓ useVisibleGraph hook
View layer:   chapterstrip-story-s1  (one composite node containing c1, c2, c3)
```

**How the synthesis works** (in a useMemo):

1. Walk edges to find leaf chapters (chapters with no children)
2. Group by parent story
3. For each group: create a synthetic node with `type: 'chapterStrip'`
4. Create one edge: story → chapterStrip (replacing individual story→chapter edges)
5. Filter out the individual chapter nodes from visible output

```typescript
// Synthetic node shape
{
  id: `chapterstrip-${storyNodeId}`,
  type: 'chapterStrip',
  data: {
    chapters: ChapterData[],     // the grouped chapters
    parentStoryId: string,
  },
  position: OFFSCREEN,
  style: HIDDEN,
}
```

**The composite node component** renders chapters as a pill strip inside itself:

- Collapsed: `[5 chapters] ●●●●○` (count + status dots)
- Expanded: grid of clickable pills, each showing `C1 · title · color-dot`

## Pattern 7: Layout — Offscreen→Position→Reveal

Layout runs as a `useMemo` hook that takes nodes + edges and returns positioned nodes.

```
Nodes arrive (offscreen, hidden)
  → Layout hook computes positions (tree/dagre)
  → Returns nodes with real {x, y} and visibility: 'visible'
  → React Flow renders at correct positions
```

**Spacing constants** to start with:

```typescript
const GAP_X = 120; // horizontal gap between tree ranks
const GAP_Y = 32; // vertical gap between siblings
const ROOT_GAP = 24; // gap between independent root trees
const MARGIN = 20; // canvas margin
```

**Measurement**: React Flow provides `node.measured.width/height` after first render.
Use fallback defaults until measured:

```typescript
const NODE_DEFAULTS = {
  experiment: { width: 220, height: 65 },
  story: { width: 200, height: 100 },
  chapterStrip: { width: 280, height: 120 },
};
```

## Pattern 8: Status Lifecycle on Edges

Edges carry status in their `data` property. This drives visual feedback:

```typescript
// On start: animated edge
{ animated: true, data: { status: 'running' } }

// On completion: static edge
{ animated: false, data: { status: 'done' } }
```

Use `updateEdgesByTarget()` to batch-update all edges pointing at a node:

```typescript
function updateEdgesByTarget(edges: Edge[], target: string, changes: Partial<Edge>) {
  for (let i = 0; i < edges.length; i++) {
    if (edges[i].target === target) {
      edges[i] = { ...edges[i], ...changes };
    }
  }
}
```

## Pattern 9: Node Type Registry

Register custom node components with React Flow:

```typescript
import type { NodeTypes } from '@xyflow/react';
export const nodeTypes: NodeTypes = {
  experiment: ExperimentNode,
  story: StoryNode,
  chapterStrip: ChapterStripNode,
};
// Pass to: <ReactFlow nodeTypes={nodeTypes} ... />
```

Each component receives `data` via `NodeProps` and renders with `<Handle>` components
for edge connection points.

## Gotchas We Learned the Hard Way

1. **Zustand `?? []` in selectors causes infinite re-renders**

   ```typescript
   // BAD — creates new array reference every render
   const items = useStore((s) => s.map.get(id) ?? []);
   // GOOD — module-level constant
   const EMPTY: Item[] = [];
   const items = useStore((s) => s.map.get(id)) ?? EMPTY;
   ```

2. **Express 5 `req.params.id` returns `string | string[]`** — always cast to `string`.

3. **Don't use `any`** — use `unknown` and narrow with type guards.

4. **Dedup events**: WebSocket reconnection replays can send duplicate events.
   Guard with `if (draft.nodes.some(n => n.id === nid.chapter(event.id))) return;`

5. **Out-of-order events**: A "chapter complete" event may arrive before "chapter start".
   Handle gracefully — create the node on-the-fly if it doesn't exist yet.

6. **`memo()` all node components**: React Flow re-renders all visible nodes on any
   graph change. Wrap every node component in `React.memo()`.

7. **Structural vs leaf distinction**: Some chapters might spawn sub-items (like our
   Task tool spawns sub-agents). Keep these as individual nodes, not part of the
   composite strip. Detect by checking if the chapter has outgoing edges.
