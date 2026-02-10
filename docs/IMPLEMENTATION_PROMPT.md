# Synapse Implementation Prompt (Parallel Agents, 8 Phases)

> Copy-paste this into a fresh Claude Code session in the AgentViz project directory.
> The orchestrator session dispatches specialized agents in parallel per phase.
> Read `docs/ROADMAP.md` for the high-level plan and `docs/SYNAPSE_PLAN.md` for the full architecture reference.

---

## Prompt

```
Read CLAUDE.md, docs/ROADMAP.md, and docs/SYNAPSE_PLAN.md first.

You are the ORCHESTRATOR. You will implement 8 phases of improvements to transform AgentViz into Synapse. Within each phase, you MUST dispatch specialized agents IN PARALLEL using the Task tool, one per work stream. Each stream has exclusive file ownership — no two agents touch the same file.

IMPORTANT: Never run more than 3 agents concurrently. Phases with 4+ streams are split into batches (3 + 1). Wait for each batch to complete before starting the next.

After all agents in a phase complete, you (the orchestrator) perform a merge/verify step: review changes, resolve any package.json conflicts, run `npm run build` to verify compilation, then commit.

Install all needed dependencies BEFORE dispatching agents for a phase (agents can't install packages).

## Key conventions (pass to every agent)
- Type names use PascalCase with `Ws` prefix: `WsServerMessage`, `WsClientMessage`
- Backend routes return plain arrays: `res.json(agents)`, `res.json(events)`
- Tailwind v4 uses `@tailwindcss/vite` plugin (no tailwind.config)
- Hook scripts use `.cjs` extension (package.json has `"type": "module"`)
- Zustand gotcha: `?? []` inside selectors causes infinite re-renders. Use module-level `const EMPTY: T[] = []` and `?? EMPTY` outside selectors
- Express 5 `req.params.id` returns `string | string[]` — cast to `string`
- Agent SDK `abortController` goes inside `options`, not at top level of `query()` arg

---

# ═══════════════════════════════════════════════════
# PHASE 1: HARDENING — ✅ COMPLETE (skip to Phase 2)
# ═══════════════════════════════════════════════════

All Phase 1 items are already implemented:
- ✅ Express error handler (global middleware + uncaughtException + unhandledRejection)
- ✅ Rate limiting (express-rate-limit on /api/events 200/min, /api/agents/spawn 30/min)
- ✅ Agent limits + timeout (MAX_CONCURRENT_AGENTS=10, AGENT_TIMEOUT_MS=300000)
- ✅ sendMessage guard simplified
- ✅ Spawn 429 error in routes/agents.ts
- ✅ Error boundaries (ErrorBoundary.tsx wrapping 6 components in App.tsx)
- ✅ Loading/error states (isLoading/loadError in store, spinner + error banner)
- ✅ Confirmation dialogs (ConfirmDialog.tsx in Header + AgentDetailPanel)
- ✅ waterfallSpans dead code removed from LensAdapter
- ✅ CSS cleanup done (no icicle/waterfall classes)
- ✅ _test.txt deleted, hook_debug.log in .gitignore

**2 tiny cleanup items remain (handle in Phase 2 merge step):**
- Delete the file `nul` from project root (Windows redirect artifact)
- Remove `dagre` from package.json dependencies (replaced by custom layout, unused)

No agents needed. Proceed directly to Phase 2.


# ═══════════════════════════════════════════════════
# PHASE 2: DEVELOPER EXPERIENCE
# ═══════════════════════════════════════════════════

## Pre-step: Dependencies already installed — NO install needed
All dev dependencies are already in package.json: vitest, @testing-library/react, @testing-library/jest-dom, jsdom, eslint, @eslint/js, typescript-eslint, eslint-plugin-react-hooks, prettier, eslint-config-prettier, husky, lint-staged.

`.nvmrc` already exists (22). Skip creating it.

## Dispatch 3 agents in parallel:

### Agent 1: "Testing Setup"
**Files owned (ONLY touch these):** `vitest.config.ts` (new), `src/__tests__/` (new dir), `server/__tests__/` (new dir)

Create `vitest.config.ts`:
```typescript
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./src/__tests__/setup.ts'],
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx', 'server/**/*.test.ts'],
  },
});
```

Create `src/__tests__/setup.ts`: `import '@testing-library/jest-dom';`

Write test files:
1. `server/__tests__/eventStore.test.ts` — test `normalizeHookEvent()` for each hook type in HOOK_EVENT_MAP, test JSON parse protection for corrupted tool_input. Read `server/services/eventStore.ts` to understand the function signatures.
2. `src/__tests__/agentStore.test.ts` — test `addEvent` creates nodes/edges, `removeNode` cascades children, `buildDerivedMaps` populates `agentsBySession` and `childAgents` maps. Read `src/store/agentStore.ts` for the store interface.
3. `src/__tests__/format.test.ts` — test `formatTokens`, `formatDuration`, `formatCost` with zero, normal, and large values. Read `src/utils/format.ts` for the function signatures.

---

### Agent 2: "Linting Setup"
**Files owned (ONLY touch these):** `eslint.config.js` (new), `.prettierrc` (new), `.husky/` (new dir)

Create `eslint.config.js` (ESLint 9+ flat config):
```javascript
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
export default tseslint.config(
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    plugins: { 'react-hooks': reactHooks },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
      '@typescript-eslint/no-explicit-any': 'warn',
    },
  },
  { ignores: ['dist/', 'node_modules/', '_package/', 'distribution/'] },
);
```

Create `.prettierrc`:
```json
{ "singleQuote": true, "trailingComma": "all", "printWidth": 100, "semi": true }
```

Create `.husky/pre-commit`:
```bash
npx lint-staged
```

---

### Agent 3: "Project Config"
**Files owned (ONLY touch these):** `.editorconfig` (new)

Note: `.nvmrc` already exists (22). `start-server.sh` and `start-client.sh` already exist. Skip all three.

Create `.editorconfig`:
```
root = true
[*]
indent_style = space
indent_size = 2
end_of_line = lf
charset = utf-8
trim_trailing_whitespace = true
insert_final_newline = true
```

---

## After all 3 agents complete:
1. **Phase 1 leftovers:** Delete the file `nul` from project root. Remove `dagre` from package.json dependencies.
2. Merge `package.json` — add all scripts from all streams:
   - `"test": "vitest run"`, `"test:watch": "vitest"`
   - `"lint": "eslint ."`, `"format": "prettier --write \"src/**/*.{ts,tsx}\" \"server/**/*.ts\""`
   - `"prepare": "husky"`
   - `"lint-staged": { "*.{ts,tsx}": ["eslint --fix", "prettier --write"] }`
3. Pin `@anthropic-ai/claude-agent-sdk` version (check `node_modules/@anthropic-ai/claude-agent-sdk/package.json`)
4. Run `npx husky init` if `.husky/pre-commit` needs it
5. Run `npm run format` to normalize codebase
6. Run `npm test` to verify tests pass
7. Run `npm run build` to verify compilation
8. Commit: `feat(dx): vitest, eslint, prettier, husky, project configs, cleanup`


# ═══════════════════════════════════════════════════
# PHASE 3: MONOREPO EXTRACTION
# ═══════════════════════════════════════════════════

> This phase converts the single-project AgentViz into a pnpm workspace monorepo,
> extracting provider-agnostic code into `@synapse-viz/core` and keeping Claude-specific
> code in `apps/dashboard/`.

## Pre-step: Install pnpm and initialize workspace
```bash
npm install -g pnpm
```

## Dispatch 3 agents in parallel:

### Agent 4: "Monorepo Scaffold"
**Files owned (ONLY touch these):** `pnpm-workspace.yaml` (new), `tsconfig.base.json` (new), `packages/core/package.json` (new), `packages/core/tsconfig.json` (new), `apps/dashboard/package.json` (new), `apps/dashboard/tsconfig.json` (new), `apps/dashboard/vite.config.ts` (new)

Tasks:

**3.1 Create monorepo scaffold:**

Create `pnpm-workspace.yaml`:
```yaml
packages:
  - 'packages/*'
  - 'apps/*'
```

Create `tsconfig.base.json`:
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "jsx": "react-jsx",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true,
    "outDir": "dist",
    "rootDir": "src"
  }
}
```

Create `packages/core/package.json`:
```json
{
  "name": "@synapse-viz/core",
  "version": "0.1.0",
  "type": "module",
  "main": "src/index.ts",
  "types": "src/index.ts",
  "exports": {
    ".": "./src/index.ts",
    "./types": "./src/types/index.ts",
    "./store": "./src/store/index.ts",
    "./components": "./src/components/index.ts",
    "./hooks": "./src/hooks/index.ts",
    "./utils": "./src/utils/index.ts",
    "./server": "./src/server/index.ts"
  },
  "peerDependencies": {
    "react": "^19.0.0",
    "react-dom": "^19.0.0",
    "@xyflow/react": "^12.0.0",
    "zustand": "^5.0.0"
  }
}
```

Create `packages/core/tsconfig.json` extending base.

Create `apps/dashboard/package.json` with dependency on `"@synapse-viz/core": "workspace:*"`.

Create `apps/dashboard/tsconfig.json` extending base.

Move existing `vite.config.ts` → `apps/dashboard/vite.config.ts` (update paths).

---

### Agent 5: "Types + Utils Extraction"
**Files owned (ONLY touch these):** `packages/core/src/types/` (new dir), `packages/core/src/utils/` (new dir)

Tasks:

**3.2 Extract types:**
- Copy `src/types/agent.ts` → `packages/core/src/types/agent.ts`
- Generalize: make `eventSource` a `string` instead of union, add optional `providerMetadata?: Record<string, unknown>`
- Create `packages/core/src/types/provider.ts` with the `ProviderAdapter` interface:

```typescript
export interface AgentTypeEntry {
  name: string;
  color: string;
  icon?: string;
  category?: string;
}

export interface ToolEntry {
  name: string;
  icon: string;
  category?: string;
}

export interface ColorPalette {
  name: string;
  colors: string[];
}

export interface ProviderAdapter {
  id: string;
  displayName: string;
  agentTypes: AgentTypeEntry[];
  tools: ToolEntry[];
  normalizeEvent(raw: Record<string, unknown>): AgentEvent;
  resolveToolAgent?(event: AgentEvent, activeAgents: Map<string, string[]>, toolAgentMap: Map<string, string>): string | null;
  isSubagentTool?(toolName: string): boolean;
  palettes: ColorPalette[];
  pricing?: Record<string, { inputPer1k: number; outputPer1k: number }>;
}
```

- Create `packages/core/src/types/lens.ts` — extract lens-related types
- Create `packages/core/src/types/index.ts` barrel export

**3.3 Extract utils:**
- Copy `src/utils/format.ts` → `packages/core/src/utils/format.ts`
- Create `packages/core/src/utils/theme.ts` — dynamic palette based on `ProviderAdapter.agentTypes[]` instead of hardcoded `TYPE_COLORS`
- Create `packages/core/src/utils/index.ts` barrel export

---

### Agent 6: "Store + Components Extraction"
**Files owned (ONLY touch these):** `packages/core/src/store/` (new dir), `packages/core/src/components/` (new dir), `packages/core/src/hooks/` (new dir)

Tasks:

**3.4 Extract store:**
- Copy `src/store/agentStore.ts` → `packages/core/src/store/graphStore.ts`
- Refactor to accept `ProviderAdapter` via factory: `export function createGraphStore(adapter: ProviderAdapter)`
- Move Claude-specific inference logic (e.g., tool→agent mapping heuristics) out — the adapter's `resolveToolAgent()` handles this now
- Keep `buildDerivedMaps`, all mutation methods, derived Maps

**3.5 Extract components:**
- Copy all generic components to `packages/core/src/components/`:
  - `graph/AgentGraph.tsx` → `graph/GraphCanvas.tsx` (decouple from store, accept props)
  - `graph/nodes/*` → as-is (decouple from direct store access, accept data props)
  - `graph/edges/*` → as-is
  - `lens/*` → as-is (already generic via LensNode)
  - `panels/AgentDetailPanel.tsx` → `panels/DetailPanel.tsx` (accept `AgentActions` callbacks)
  - `panels/TimelinePanel.tsx` → as-is
  - `panels/ToolLogPanel.tsx` → as-is
  - `Toast.tsx` → as-is
  - `ErrorBoundary.tsx` → as-is (from Phase 1)
  - `ConfirmDialog.tsx` → as-is (from Phase 1)

**3.6 Extract hooks:**
- Copy `src/hooks/useAutoLayout.ts` → `packages/core/src/hooks/useAutoLayout.ts`
- Copy `src/hooks/useHandlePositions.ts` → if it exists

---

## After all 3 agents complete (sequential wiring):
1. Wire `apps/dashboard/src/main.tsx` to import from `@synapse-viz/core`
2. Create `apps/dashboard/src/adapters/claudeAdapter.ts` with Claude Code agent types + tools
3. Move Claude-specific components: `SpawnAgentDialog.tsx`, `AgentTemplates.tsx` → `apps/dashboard/src/components/`
4. Move server code: `server/` → `apps/dashboard/server/` (keep DB, routes, agentManager, eventStore)
5. Move hook script: `hooks/send_event.cjs` → `apps/dashboard/hooks/`
6. Update root `package.json` with pnpm workspace scripts
7. Run `pnpm install`
8. Run `pnpm run build` to verify compilation
9. Run `npx tsx apps/dashboard/scripts/simulate_session.ts` to verify functionality
10. Commit: `refactor: extract @synapse-viz/core, convert to pnpm monorepo`


# ═══════════════════════════════════════════════════
# PHASE 4: PERFORMANCE + UX
# ═══════════════════════════════════════════════════

## Pre-step: Install dependencies
```bash
cd apps/dashboard && pnpm add react-virtuoso && cd ../..
```

## Batch A: Dispatch 3 agents in parallel:

### Agent 7: "Backend Performance"
**Files owned (ONLY touch these):** `packages/core/src/server/db.ts`, `apps/dashboard/server/services/transcriptReader.ts`, `apps/dashboard/server/routes/transcript.ts`, `apps/dashboard/server/routes/snapshot.ts`

**4.1 Composite DB Indexes** — In `db.ts`, add inside the `db.exec` block:
```sql
CREATE INDEX IF NOT EXISTS idx_events_session_time ON events(session_id, created_at);
CREATE INDEX IF NOT EXISTS idx_events_agent_type ON events(agent_id, event_type);
CREATE INDEX IF NOT EXISTS idx_events_type_time ON events(event_type, created_at);
```

**4.2 Async Transcript Reading** — In `transcriptReader.ts`:
- Replace `fs.readFileSync` with `await fs.promises.readFile`
- Make `readTranscript()` and `parseTranscript()` async
- Update `transcript.ts` and `snapshot.ts` route handlers to use `await`

**4.3 Sessions Summary Table** — In `db.ts`:
- Add `sessions` table with `session_id TEXT PRIMARY KEY, first_event_at, last_event_at, event_count`
- Add upsert prepared statement called inside `insertEvent()`
- Update `listSessions()` to query `sessions` table directly (no more GROUP BY)

---

### Agent 8: "Lens Performance"
**Files owned (ONLY touch these):** `packages/core/src/components/lens/LensAdapter.tsx`

**4.4 Lazy Lens Computation**:
- Add module-level `const EMPTY: never[] = []`
- Keep `treeRoots` always computed (shared base)
- Guard each other useMemo with `activeLensTab`:
  ```typescript
  const profileRoots = useMemo(
    () => activeLensTab === 'profile' ? buildProfileBlocks(treeRoots, profileMetric, paletteIndex) : EMPTY,
    [activeLensTab, treeRoots, profileMetric, paletteIndex],
  );
  ```
- Same for: `heatmapData`, `sankeyData`, `compactEvents`, `costPerTurn`
- Note: `compactEvents` is also used by `costPerTurn`. If cost tab is active, compute both.

**4.5 Transcript Fetch Batching**:
- Add module-level `const fetchedSessions = new Set<string>()`
- Collect all unfetched session IDs, fire `Promise.all()` instead of individual fetches
- Add `transcriptLoading` state, show loading indicator in lens header

---

### Agent 9: "Virtualization"
**Files owned (ONLY touch these):** `packages/core/src/components/lens/tree/TreeView.tsx`, `packages/core/src/components/panels/ToolLogPanel.tsx`

**4.6 Virtualization** — Replace `.map()` loops with `<Virtuoso>` from react-virtuoso:

**TreeView**: Replace flat list rendering with:
```tsx
<Virtuoso
  data={flatList}
  style={{ height: '100%' }}
  itemContent={(idx, node) => <TreeRow ... />}
/>
```
- Preserve `data-node-id` attributes for auto-scroll
- Update keyboard navigation to use Virtuoso's `scrollToIndex` ref API

**ToolLogPanel**: Same pattern. Virtuoso handles variable-height expandable rows automatically.

---

## After Batch A (3 agents) complete:
1. Run `pnpm run build` to verify compilation

## Batch B: Dispatch 1 agent:

### Agent 10: "UX Features"
**Files owned (ONLY touch these):** `apps/dashboard/src/App.tsx`, `apps/dashboard/src/store/agentStore.ts`, `apps/dashboard/src/components/CommandPalette.tsx` (new), `apps/dashboard/server/db.ts`, `apps/dashboard/server/routes/events.ts`, `apps/dashboard/src/components/graph/AgentGraph.tsx`, `apps/dashboard/src/components/panels/TimelinePanel.tsx`, `apps/dashboard/src/components/panels/SpawnAgentDialog.tsx`, `apps/dashboard/src/components/panels/AgentTemplates.tsx` (new)

**4.7 Deep Linking**:
- In `App.tsx`: parse `window.location.hash` → `#session=X&node=Y&lens=tree`
- On mount: apply hash state to store
- Subscribe to store changes → update hash (debounced 300ms)
- Listen for `hashchange` for browser back/forward

**4.8 Command Palette** — `CommandPalette.tsx`:
- Trigger: Ctrl+K / Cmd+K
- Dark overlay + centered modal, search input, scrollable action list
- Actions: toggle tool log [T], toggle layout [L], toggle hooks [H], switch lens tabs [1-7], spawn agent [N], pause/resume [Space], export snapshot, clear events
- Fuzzy match, arrow keys navigate, Enter executes, Escape closes

**4.9 Full-Text Search (backend)**:
- In `db.ts`: `searchEvents()` using LIKE on tool_name, tool_input, tool_response, error
- In `events.ts`: `GET /api/events/search?q=...&limit=50`

**4.10 CSV Export** (JSON export already exists via E shortcut in Header):
- Cost view: CSV download button (turn, model, tokens, cost)

**4.11 Empty States** (partial empty states already exist — graph hint banner, "No tool events yet", "No token data available"):
- AgentGraph: when `nodes.length === 0 && !isLoading`, show centered "No active sessions" with spawn button (upgrade from current hint banner)
- TimelinePanel: gray bar with "Timeline appears when agents are active"

**4.12 Agent Templates** — `AgentTemplates.tsx`:
- Type: `{ name, prompt, model, tools, systemPrompt? }`
- localStorage-backed CRUD
- In SpawnAgentDialog: "Templates" dropdown, "Save as Template" button
- 3 built-in: "Code Review", "Explore Codebase", "Write Tests"

---

## After Batch B complete:
1. Run `pnpm run build`
2. Run `pnpm test`
3. Commit: `feat: performance (lazy lens, virtualization, indexes) + UX (deep linking, command palette, search, export, templates)`


# ═══════════════════════════════════════════════════
# PHASE 5: CANVAS2D WIDGET ENGINE
# ═══════════════════════════════════════════════════

> Build `packages/widget/` — a lightweight Canvas2D rendering engine for agent graphs.
> No React dependency in the engine itself. React wrapper provided separately.
> See `docs/SYNAPSE_PLAN.md` "Canvas2D Widget Engine" section for full spec.

## Pre-step: Create package scaffold
```bash
mkdir -p packages/widget/engine packages/widget/views
```

Create `packages/widget/package.json`:
```json
{
  "name": "@synapse-viz/widget",
  "version": "0.1.0",
  "type": "module",
  "main": "src/index.ts",
  "exports": {
    ".": "./src/index.ts",
    "./react": "./src/Widget.tsx"
  }
}
```

## Dispatch 3 agents in parallel:

### Agent 11: "Widget Engine"
**Files owned (ONLY touch these):** `packages/widget/engine/Scene.ts` (new), `packages/widget/engine/Layout.ts` (new)

**5.1 Scene Graph** — `Scene.ts`:
```typescript
class Scene {
  nodes: SceneNode[];           // Positioned rectangles with data
  edges: SceneEdge[];           // Lines between nodes
  camera: { x: number; y: number; zoom: number };
  dirty: Set<SceneNode>;        // Only redraw changed nodes

  hitTest(x: number, y: number): SceneNode | null;
  panBy(dx: number, dy: number): void;
  zoomTo(level: number, cx: number, cy: number): void;
  addNode(node: SceneNode): void;
  removeNode(id: string): void;
  updateNode(id: string, data: Partial<SceneNode>): void;
}
```

- `SceneNode`: `{ id, x, y, width, height, label, color, badges?, status?, children? }`
- `SceneEdge`: `{ from, to, color?, animated? }`
- Hit testing: point-in-rect with camera transform
- Dirty rect tracking: only mark nodes that changed as needing redraw

**5.2 Tree Layout** — `Layout.ts`:
- Top-down tree layout algorithm (like dagre but simpler, ~100 lines)
- Inputs: nodes with parent relationships
- Outputs: x, y positions for each node
- Configurable: `nodeWidth`, `nodeHeight`, `horizontalGap`, `verticalGap`

---

### Agent 12: "Widget Renderer + Views"
**Files owned (ONLY touch these):** `packages/widget/engine/Renderer.ts` (new), `packages/widget/views/GraphView.ts` (new), `packages/widget/views/TreeView.ts` (new), `packages/widget/views/HeatmapView.ts` (new), `packages/widget/views/TreemapView.ts` (new), `packages/widget/views/CompactionView.ts` (new), `packages/widget/views/CostView.ts` (new)

**5.3 Renderer** — `Renderer.ts`:
```typescript
class Renderer {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private scene: Scene;
  private textCache: Map<string, TextMetrics>;

  drawNode(node: SceneNode): void;    // Rounded rect + label + badges
  drawEdge(edge: SceneEdge): void;    // Bezier curve with arrow
  drawHeatCell(x, y, w, h, intensity): void;
  drawTreemapRect(x, y, w, h, label, color, depth): void;
  drawBar(x, y, w, h, color): void;
  clear(): void;
  render(): void;                      // Full draw loop
}
```

**5.4 View Renderers** — One per lens (~80-200 lines each):
- `GraphView.ts`: Tree layout → draw node rects + bezier edges + badges
- `TreeView.ts`: Indented list with expand/collapse triangles
- `HeatmapView.ts`: Grid of colored cells, axis labels, intensity legend
- `TreemapView.ts`: Squarify algorithm → nested colored rects
- `CompactionView.ts`: Horizontal stacked bars + line chart overlay
- `CostView.ts`: Vertical waterfall bars + context area fill

Each view: `class XxxView { constructor(renderer: Renderer); update(data: LensData): void; render(): void; }`

---

### Agent 13: "Widget Integration"
**Files owned (ONLY touch these):** `packages/widget/src/Widget.tsx` (new), `packages/widget/src/embed.ts` (new), `packages/widget/index.html` (new), `packages/widget/src/index.ts` (new)

**5.5 React Wrapper** — `Widget.tsx`:
```tsx
export function SynapseWidget({ data, view, onSelect, width, height }: WidgetProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  // Create scene + renderer on mount
  // Update scene when data changes
  // Handle mouse events → hit test → onSelect
  // Handle wheel → zoom, drag → pan
  return <canvas ref={canvasRef} width={width} height={height} />;
}
```

**5.6 iframe/postMessage Bridge** — `embed.ts`:
```typescript
// Receives data via postMessage, renders widget in iframe
window.addEventListener('message', (e) => {
  if (e.data.type === 'synapse:update') { scene.update(e.data.payload); }
  if (e.data.type === 'synapse:view') { setActiveView(e.data.view); }
});
// Sends selection events back to parent
function onSelect(nodeId: string) {
  window.parent.postMessage({ type: 'synapse:select', nodeId }, '*');
}
```

**5.7 Test Page** — `index.html`:
- Self-contained HTML page that loads the widget
- Generates mock data (5 sessions, 20 agents, 50 tool calls)
- Buttons to switch between all 6 views
- Displays selected node info

Create `packages/widget/src/index.ts` barrel export: Scene, Renderer, Layout, all views, SynapseWidget.

---

## After all 3 agents complete:
1. Run `pnpm run build`
2. Open `packages/widget/index.html` in browser
3. Verify all 6 views render, pan/zoom works, selection highlights
4. Commit: `feat(widget): Canvas2D engine with 6 views, React wrapper, iframe bridge`


# ═══════════════════════════════════════════════════
# PHASE 6: VSCODE EXTENSION
# ═══════════════════════════════════════════════════

> Build `apps/vscode/` — Synapse for VSCode.
> See `docs/SYNAPSE_PLAN.md` "VSCode Extension" section.

## Pre-step: Scaffold extension
```bash
mkdir -p apps/vscode/extension apps/vscode/webview
```

Create `apps/vscode/package.json` (VSCode extension manifest):
```json
{
  "name": "synapse-vscode",
  "displayName": "Synapse",
  "description": "Real-time agent visualization for Claude Code and other AI agents",
  "version": "0.1.0",
  "engines": { "vscode": "^1.85.0" },
  "categories": ["Visualization"],
  "activationEvents": ["onStartupFinished"],
  "main": "./dist/extension.js",
  "contributes": {
    "viewsContainers": {
      "activitybar": [{
        "id": "synapse",
        "title": "Synapse",
        "icon": "media/icon.svg"
      }]
    },
    "views": {
      "synapse": [{
        "type": "webview",
        "id": "synapse.sidebar",
        "name": "Agent Graph"
      }]
    },
    "commands": [
      { "command": "synapse.openPanel", "title": "Synapse: Open Full Dashboard" },
      { "command": "synapse.switchLens", "title": "Synapse: Switch Lens View" },
      { "command": "synapse.reconnect", "title": "Synapse: Reconnect to Server" }
    ]
  }
}
```

## Dispatch 3 agents in parallel:

### Agent 14: "Native Providers"
**Files owned (ONLY touch these):** `apps/vscode/extension/statusBar.ts` (new), `apps/vscode/extension/treeView.ts` (new)

**6.1 StatusBar** — `statusBar.ts`:
- Create StatusBarItem aligned left, priority 100
- Format: `$(pulse) 3 agents · 12.4k tokens · $0.08`
- Update on WebSocket events
- Click → run `synapse.openPanel` command
- Show `$(debug-disconnect)` icon when disconnected

**6.2 TreeView** — `treeView.ts`:
- TreeDataProvider with 3 levels: Session → Agent → Tool Calls
- Each node shows: name, status icon, token count
- Click → select in sidebar widget
- Context menu: "Stop Agent", "View Details"
- Auto-refresh on WebSocket events

---

### Agent 15: "WebView Sidebar"
**Files owned (ONLY touch these):** `apps/vscode/extension/sidebarProvider.ts` (new), `apps/vscode/webview/sidebar.tsx` (new)

**6.3 Sidebar Provider** — `sidebarProvider.ts`:
- Implements `WebviewViewProvider`
- Loads Canvas2D widget from `@synapse-viz/widget`
- Passes data via postMessage
- Handles selection messages from widget → update TreeView + StatusBar

**6.4 Sidebar WebView** — `sidebar.tsx`:
- Renders `<SynapseWidget>` from `@synapse-viz/widget/react`
- Auto-connects to backend WS (localhost:4000/ws)
- Lens view switcher (compact tabs at top)
- Shows connection status overlay

---

### Agent 16: "WebView Panel"
**Files owned (ONLY touch these):** `apps/vscode/extension/panelProvider.ts` (new), `apps/vscode/webview/panel.tsx` (new), `apps/vscode/extension/extension.ts` (new), `apps/vscode/extension/wsClient.ts` (new)

**6.5 Panel Provider** — `panelProvider.ts`:
- Creates WebviewPanel in editor area
- Loads full React dashboard from `apps/dashboard/` build
- Retains when hidden (configurable)

**6.6 Panel WebView** — `panel.tsx`:
- Full Synapse Dashboard rendered in WebviewPanel
- Uses `acquireVsCodeApi()` for communication with extension host

**6.7 Extension Entry** — `extension.ts`:
- Register sidebar provider, panel command, status bar
- Create shared `wsClient.ts` (Node.js WebSocket) for extension host
- Auto-detect if Synapse server is running (try connect to :4000)
- Distribute events to sidebar, panel, tree view, status bar

**6.8 WebSocket Client** — `wsClient.ts`:
- Node.js WebSocket (not browser WS) connecting to localhost:4000/ws
- Auto-reconnect with exponential backoff
- Event distribution to all registered listeners

---

## After all 3 agents complete:
1. Build extension: `cd apps/vscode && pnpm run build`
2. Install extension locally: `code --install-extension synapse-vscode-0.1.0.vsix`
3. Verify: sidebar shows widget, status bar updates, panel opens with full dashboard
4. Commit: `feat(vscode): Synapse extension with sidebar widget, full panel, status bar, tree view`


# ═══════════════════════════════════════════════════
# PHASE 7: AUTO-RESUME + COST SYSTEM (Sequential)
# ═══════════════════════════════════════════════════

> All tasks modify DB schema — must be sequential.

**7.1 ProjectStore Service** — Create `packages/core/src/server/projectStore.ts`:
- Uses existing `SnapshotFile` format from snapshot route
- `load()`: reads `.synapse/sessions.json`, imports events (UNIQUE constraint deduplicates)
- `save()`: exports all events to `.synapse/sessions.json`
- Constructor takes `projectDir: string`

**7.2 Auto-load on Startup** — In `apps/dashboard/server/index.ts`:
```typescript
const PROJECT_DIR = process.argv.includes('--project')
  ? path.resolve(process.argv[process.argv.indexOf('--project') + 1])
  : process.cwd();
const projectStore = new ProjectStore(PROJECT_DIR);
// After DB init: projectStore.load()
```

**7.3 Auto-save on Shutdown** — In shutdown handler, BEFORE db.close():
```typescript
projectStore.save()
```

**7.4 `.synapse/` in .gitignore**

**7.5 Cost Tables** — In `packages/core/src/server/db.ts`:
```sql
CREATE TABLE IF NOT EXISTS cost_records (
  id INTEGER PRIMARY KEY,
  session_id TEXT NOT NULL,
  agent_id TEXT,
  model TEXT,
  input_tokens INTEGER DEFAULT 0,
  output_tokens INTEGER DEFAULT 0,
  cache_read_tokens INTEGER DEFAULT 0,
  estimated_cost REAL DEFAULT 0,
  timestamp INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS budgets (
  id INTEGER PRIMARY KEY,
  scope TEXT NOT NULL,          -- 'global' | 'session' | 'agent'
  scope_id TEXT,
  period TEXT NOT NULL,         -- 'hourly' | 'daily' | 'weekly' | 'monthly'
  limit_usd REAL NOT NULL,
  hard_stop INTEGER DEFAULT 0,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS alerts (
  id INTEGER PRIMARY KEY,
  rule_type TEXT NOT NULL,      -- 'budget' | 'error_spike' | 'offline' | 'token_spike'
  severity TEXT NOT NULL,       -- 'info' | 'warning' | 'critical'
  message TEXT NOT NULL,
  acknowledged INTEGER DEFAULT 0,
  timestamp INTEGER NOT NULL
);
```

**7.6 Budget Management API** — In `apps/dashboard/server/routes/`:
- `GET /api/budgets` — list all budgets
- `POST /api/budgets` — create budget
- `DELETE /api/budgets/:id` — delete budget
- `GET /api/costs?sessionId=X&period=hourly` — aggregated cost data
- `GET /api/alerts?acknowledged=false` — pending alerts

**7.7 Alert Engine** — In `packages/core/src/server/alertEngine.ts`:
- On each cost record insert: check budget thresholds
- If exceeded: create alert record + broadcast via WebSocket
- Webhook delivery: configurable endpoints (Discord, Slack, custom HTTP)
- Provider pricing from adapter's `pricing` table

## After Phase 7:
1. Test: start → simulate → stop → verify `.synapse/sessions.json` exists
2. Test: delete DB → restart → events reload from JSON
3. Test: set budget → exceed → alert appears
4. Commit: `feat: auto-resume (.synapse/sessions.json), cost tracking, budget alerts`


# ═══════════════════════════════════════════════════
# PHASE 8: CLAWBRAIN (Separate Session)
# ═══════════════════════════════════════════════════

> This phase should be done in a SEPARATE Claude Code session.
> See `docs/SYNAPSE_PLAN.md` "Data Capture: ClawBrain Multi-Layer Strategy" section.

Build `apps/clawbrain/` with:
1. OpenClaw plugin registration (4 reliable + 4 hopeful hooks)
2. Multi-layer data capture (hooks → gateway WS → OTLP → file parsing)
3. `openclawAdapter` implementing ProviderAdapter
4. ClawBrain dashboard using @synapse-viz/core + openclawAdapter
5. `/brain` command integration
6. Cost tracking with gateway WebSocket data


# ═══════════════════════════════════════════════════
# VERIFICATION CHECKLIST
# ═══════════════════════════════════════════════════

Run these after all phases are complete:

### Phase 1: Hardening — ✅ COMPLETE
- [x] Error boundary catches crashes without killing app
- [x] Kill backend → frontend shows loading error with retry
- [x] Click "Clear All" → confirmation dialog appears, cancel works
- [x] Rapid POST to /api/events → 429 after 200 requests

### Phase 2: Developer Experience
- [ ] `npm test` — all tests pass
- [ ] `npm run lint` — no errors
- [ ] `npm run build` — compiles clean
- [ ] Git commit → husky runs lint-staged

### Phase 3: Monorepo
- [ ] `pnpm run build` from root → all packages compile
- [ ] `apps/dashboard/` imports from `@synapse-viz/core` — no direct `src/` imports
- [ ] Simulation script renders correctly via monorepo dashboard

### Phase 4: Performance + UX
- [ ] Switch lens tabs rapidly → no computation delay
- [ ] Generate 5000+ events → TreeView scrolls smoothly
- [ ] Select node → URL hash updates → copy URL → new tab → same node selected
- [ ] Ctrl+K → command palette → type "spawn" → Enter → dialog opens
- [ ] Export CSV from cost view → valid spreadsheet data

### Phase 5: Widget
- [ ] Open `packages/widget/index.html` → all 6 views render
- [ ] Pan/zoom works in all views
- [ ] Click node → selection event fires
- [ ] 50+ nodes at 60fps (no dropped frames)

### Phase 6: VSCode Extension
- [ ] Extension activates on startup
- [ ] Sidebar shows live agent graph from Canvas2D widget
- [ ] Status bar shows agent count + token count
- [ ] "Synapse: Open Dashboard" command opens full panel
- [ ] Tree view shows session → agent → tool hierarchy

### Phase 7: Auto-Resume + Cost
- [ ] Start server → simulate → stop → `.synapse/sessions.json` exists
- [ ] Delete DB → restart → events reload from JSON
- [ ] Restart again → no duplicates
- [ ] Set budget $1.00 → exceed → alert appears in dashboard

### Phase 8: ClawBrain
- [ ] Install plugin in OpenClaw → hooks fire → dashboard shows agent graph
- [ ] `/brain` command opens dashboard
- [ ] Cost tracking shows per-model breakdown
```
