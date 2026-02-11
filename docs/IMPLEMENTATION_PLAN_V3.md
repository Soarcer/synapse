# Synapse v3 — Complete Implementation Plan

> **Scope**: Take Synapse from prototype to OSS-ready monorepo under `@synapse-ai` npm scope.
> **Generated**: 2026-02-10
> **Status**: Pending approval

---

## Executive Summary

Synapse is an interactive agent orchestration dashboard. This plan covers:
- Monorepo migration (pnpm workspaces, 4 published packages + 2 apps)
- Full TDD + E2E testing (~80-100 unit tests + ~10 Playwright E2E tests)
- Backend hardening (validation, auth, WebSocket robustness, structured logging)
- Frontend hardening (memory leaks, performance, component decomposition, accessibility)
- VSCode extension completion (bundled server, TreeView, StatusBar metrics)
- OpenClaw plugin alignment with official `openclaw/plugin-sdk`
- Performance + UX (virtualization, code splitting, Canvas2D widget)
- Auto-resume + cost tracking
- GitHub Actions CI/CD with auto-publish

**Target audience**: OSS / public distribution
**npm scope**: `@synapse-ai` (claimed)

---

## Current State (Investigation Findings)

### Backend (36 issues found)
- **CRITICAL**: No input validation on any endpoint; no API auth; unbounded WS buffering; AgentManager memory leaks; shutdown race conditions
- **HIGH**: Missing error handling in broadcaster; unhandled promise rejections; no concurrency control on agent messages; no vendor field on SDK events
- **MEDIUM**: Missing composite DB indexes; N+1 queries in snapshot; no structured logging; hardcoded config values; no DB migrations; no heartbeat/ping

### Frontend (42 issues found)
- **CRITICAL**: Toast listener memory leak; WS reconnect infinite loop; store race condition on paused addEvent; useAutoLayout ref mutation races
- **HIGH**: 12+ unoptimized Zustand selectors causing full re-renders; O(N^2) lens tree rebuilds; god components (AgentGraph 794 lines, AgentDetailPanel 653 lines, agentStore 962 lines)
- **MEDIUM**: No code splitting; no ARIA labels; keyboard shortcut conflicts; no focus traps; color-only status indicators

### Extension + Plugin (26 issues found)
- **CRITICAL**: ServerManager masks startup failures; build scripts swallow errors; hook script has no retry queue; JSONL bridge has unbounded Maps
- **HIGH**: Plugin not using official `openclaw/plugin-sdk` interfaces; WebView doesn't watch config changes; no resource integrity checks

### Types + Tests
- **Zero test files** despite vitest being installed
- **13 instances** of `catch (err: any)` (should be `unknown`)
- **No runtime validation library** (no Zod/Joi)
- **Unused `dagre` dependency** still in package.json
- **Git artifacts**: `nul` file, `c:tempread_responses.txt`, WAL files in git

---

## Monorepo Architecture

### Package Structure
```
synapse/
├── pnpm-workspace.yaml
├── packages/
│   ├── core/                    # @synapse-ai/core — types, validation, utils
│   ├── server/                  # @synapse-ai/server — Express + SQLite + WS
│   └── openclaw/                # @synapse-ai/openclaw — OpenClaw monitoring plugin
├── apps/
│   ├── dashboard/               # React frontend (not published to npm)
│   └── vscode/                  # @synapse-ai/vscode — VS Code extension
├── hooks/                       # Claude Code hook scripts
├── scripts/                     # Build and install scripts
├── tests/e2e/                   # Playwright E2E tests
├── .github/workflows/           # CI/CD
└── docs/
```

### Dependency Graph
```
@synapse-ai/core (0 runtime deps — just zod for validation)
  ↑ imported by all other packages
  │
  ├── @synapse-ai/server (core + express + better-sqlite3 + ws + pino)
  │     ↑
  │     ├── apps/dashboard (core + server[types only] + react + @xyflow/react + zustand)
  │     ├── apps/vscode (bundles server + dashboard dist into extension)
  │     └── @synapse-ai/openclaw (core + openclaw/plugin-sdk)
  │
  └── @synapse-ai/openclaw (also imports core directly for types + normalization)
```

### Package Responsibilities

| Package | Published | Contents |
|---------|-----------|----------|
| `@synapse-ai/core` | npm | TypeScript types, Zod schemas, format utils, constants |
| `@synapse-ai/server` | npm | Express server, SQLite DB, WebSocket broadcaster, AgentManager |
| `@synapse-ai/openclaw` | npm | OpenClaw plugin (JSONL bridge, agent tools, provider wrapper) |
| `apps/dashboard` | No (bundled) | React frontend with graph, lens views, panels |
| `apps/vscode` | VS Marketplace | Extension with bundled server + dashboard |

---

## Phase-by-Phase Implementation

### Phase 0: Cleanup (Day 1)

| Task | File(s) | Details |
|------|---------|---------|
| Delete artifacts | root | Remove `nul`, `c:tempread_responses.txt` |
| Remove dagre | `package.json` | Remove from dependencies |
| Update gitignore | `.gitignore` | Add `nul`, `c:temp*`, `server/agentviz.db*` |
| Fix error typing | 13 files | `catch (err: any)` → `catch (err: unknown)` with narrowing |
| Pin SDK version | `package.json` | `@anthropic-ai/claude-agent-sdk: "^0.x.x"` |
| Commit everything | git | Commit all 10 uncommitted files + cleanup |

### Phase 1: Monorepo Scaffold (Days 2-4)

**Step 1**: Initialize workspace
```yaml
# pnpm-workspace.yaml
packages:
  - 'packages/*'
  - 'apps/*'
```

**Step 2**: Create `@synapse-ai/core`
- Extract from current `src/types/agent.ts`, `src/types/transcript.ts`, `src/utils/format.ts`
- Add Zod schemas: `AgentEventSchema`, `SpawnAgentRequestSchema`, `SnapshotSchema`
- Export everything via `packages/core/src/index.ts`
- `package.json`: name `@synapse-ai/core`, main `dist/index.js`, types `dist/index.d.ts`

**Step 3**: Create `@synapse-ai/server`
- Move `server/` contents to `packages/server/src/`
- Replace `import from '../src/types/agent'` with `import from '@synapse-ai/core'`
- Add Zod validation middleware to routes
- `package.json`: name `@synapse-ai/server`, bin entry for CLI

**Step 4**: Move `apps/dashboard`
- Move `src/`, `index.html`, `vite.config.ts`, `src/index.css`
- Replace type imports with `@synapse-ai/core`
- Update Vite config `resolve.alias` if needed

**Step 5**: Move `apps/vscode`
- Move `extension/` to `apps/vscode/`
- Update build paths

**Step 6**: Move `packages/openclaw`
- Move `openclaw-plugin/` to `packages/openclaw/`

**Step 7**: Update all scripts, verify full build

**Gate**: `pnpm install && pnpm -r build && pnpm dev` all succeed

### Phase 2: Testing Infrastructure (Days 3-7, overlaps with Phase 1)

**Shared vitest config** at root:
```ts
// vitest.config.ts
import { defineConfig } from 'vitest/config';
export default defineConfig({
  test: {
    globals: true,
    coverage: { provider: 'v8', reporter: ['text', 'lcov'] },
  },
});
```

**Test matrix** (~80 tests total):

| Package | Test File | Tests | Priority |
|---------|-----------|-------|----------|
| core | validation.test.ts | 10 | P0 |
| core | format.test.ts | 8 | P0 |
| server | eventStore.test.ts | 10 | P0 |
| server | agentManager.test.ts | 8 | P0 |
| server | routes/events.test.ts | 8 | P0 |
| server | routes/agents.test.ts | 5 | P1 |
| server | broadcaster.test.ts | 5 | P1 |
| server | routes/snapshot.test.ts | 5 | P1 |
| dashboard | store/agentStore.test.ts | 8 | P0 |
| dashboard | store/wsClient.test.ts | 5 | P1 |
| dashboard | hooks/useAutoLayout.test.ts | 5 | P1 |
| dashboard | components/ErrorBoundary.test.tsx | 3 | P2 |
| openclaw | normalizer.test.ts | 8 | P1 |
| openclaw | jsonlBridge.test.ts | 5 | P2 |

**E2E** (Playwright, ~10 tests):
- Dashboard loads, graph renders
- Hook event → node appears
- Spawn agent dialog → agent runs
- Lens view switching
- Snapshot export/import
- Keyboard shortcuts

**CI**: `.github/workflows/ci.yml`
- Trigger: push to main, PRs
- Matrix: Node 20 + 22, Ubuntu + Windows
- Steps: install → lint → typecheck → test → build → e2e (Ubuntu only)
- Coverage: upload to Codecov

**Lint/Format**:
- ESLint flat config with `@typescript-eslint`
- Prettier with 2-space indent, single quotes, trailing commas
- Husky pre-commit → lint-staged
- `.editorconfig`

### Phase 3: Backend Hardening (Days 5-7)

**3a. Zod Validation Middleware**
```ts
// packages/server/src/middleware/validate.ts
import { z, ZodSchema } from 'zod';
export function validate(schema: ZodSchema) {
  return (req, res, next) => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      return res.status(400).json({ error: 'Validation failed', details: result.error.flatten() });
    }
    req.body = result.data;
    next();
  };
}
```

**3b. API Key Auth**
```ts
// packages/server/src/middleware/auth.ts
export function apiKeyAuth(req, res, next) {
  const key = process.env.SYNAPSE_API_KEY;
  if (!key) return next(); // No auth configured = allow all
  const provided = req.headers.authorization?.replace('Bearer ', '');
  if (provided !== key) return res.status(401).json({ error: 'Unauthorized' });
  next();
}
```

**3c. WebSocket Hardening**
- Check `client.bufferedAmount > 1_048_576` before send → skip + warn
- Ping every 30s, terminate if no pong in 10s
- Max 50 clients (configurable via `SYNAPSE_MAX_WS_CLIENTS`)

**3d. AgentManager Fixes**
- `stopAll()`: iterate copy of agents Map, clear both timeout + cleanup timers
- `sendMessage()`: check+set `agent.status = 'resuming'` atomically
- `runAgent()`: wrap in try-finally, always call `scheduleCleanup()`
- Set `event.vendor = 'anthropic'` for all SDK events

**3e. Database**
- Add indexes: `CREATE INDEX idx_events_session_time ON events(session_id, created_at)`
- Add pragmas: `synchronous=NORMAL`, `cache_size=-64000`
- Health check: include `PRAGMA page_count` and `PRAGMA page_size` for DB size
- Batch snapshot export: `WHERE session_id IN (?)` with chunking

**3f. Structured Logging**
- Replace all `console.log/error` with `pino` logger
- Add request ID middleware (nanoid per request)
- Log format: JSON with timestamp, level, requestId, message

### Phase 4: Frontend Hardening (Days 5-7, parallel with Phase 3)

**4a. Fix Critical Issues**
- Toast.tsx: return cleanup function from useEffect that removes listener from Set
- wsClient.ts: add `maxRetries: 20`, after which emit permanent failure event
- agentStore.ts: use Zustand's `set()` callback pattern for atomic pause check
- useAutoLayout.ts: compute positions as immutable objects, apply all at once

**4b. Performance**
```ts
// Stable selectors — define outside components
export const selectEvents = (s: AgentState) => s.events;
export const selectAgents = (s: AgentState) => s.agents;
export const selectSelectedId = (s: AgentState) => s.selectedAgentId;

// Use in components
const events = useAgentStore(selectEvents);
```

- Lazy lens views:
```tsx
const TreeView = React.lazy(() => import('./lens/tree/TreeView'));
const HeatmapView = React.lazy(() => import('./lens/heatmap/HeatmapView'));
// etc.
```

**4c. Component Decomposition**
- AgentGraph.tsx → 4 files (graph + 3 custom hooks)
- AgentDetailPanel.tsx → 4 files (panel + 3 sub-components)
- agentStore.ts → 3 files (store + event processor + selectors)

**4d. Accessibility**
- All `<button>` with only icon text → add `aria-label`
- Collapsible handles → `role="button"` + `aria-expanded={isOpen}`
- SpawnAgentDialog/ConfirmDialog → focus trap (use `@radix-ui/react-dialog` or manual)
- Keyboard shortcut handler: skip when `event.target` is input/textarea/contenteditable

### Phase 5: VSCode Extension (Days 8-10)

**Architecture**: Bundled server mode
- Extension resources include: `dist/` (dashboard), `server/` (compiled), `hooks/`
- ServerManager spawns: `node resources/server/index.js`
- Activation: auto-detect `.claude/` dir → start server → open dashboard

**New features**:
- `SynapseTreeDataProvider`: implements `vscode.TreeDataProvider<SynapseTreeItem>`
  - Sessions (expandable) → Agents → Tools
  - Refresh on WebSocket events
- StatusBar: `$(pulse) 3 agents | 12.4K tokens` — update via WS
- Sidebar WebView: compact graph view (reuse dashboard with `?compact=true` query param)
- New commands: `synapse.switchLens`, `synapse.reconnect`

**Build**: esbuild bundles extension; resources copied from workspace builds

### Phase 6: OpenClaw Plugin (Days 8-10, parallel with Phase 5)

**Align with official SDK**:
```ts
// packages/openclaw/src/plugin.ts
import type { PluginContext } from 'openclaw/plugin-sdk';

export function register(api: PluginContext) {
  // Background server process
  api.registerService({
    id: 'synapse-monitor',
    start: async () => { /* spawn server, wait for health */ },
    stop: async () => { /* graceful shutdown */ },
  });

  // Agent tools
  api.registerTool({
    name: 'synapse_query',
    description: 'Query monitoring events from Synapse dashboard',
    schema: { /* Zod or TypeBox schema */ },
    handler: async (input) => { /* fetch from server API */ },
  });

  api.registerTool({ name: 'synapse_metrics', /* ... */ });
  api.registerTool({ name: 'synapse_dashboard', /* ... */ });

  // Slash command
  api.registerCommand({
    name: 'brain',
    description: 'Synapse monitoring commands',
    handler: async (ctx) => { /* parse subcommand, return result */ },
  });
}
```

**Manifest** (`openclaw.plugin.json`):
```json
{
  "id": "synapse-monitor",
  "configSchema": {
    "type": "object",
    "properties": {
      "port": { "type": "number", "default": 4000 },
      "layers": {
        "type": "object",
        "properties": {
          "transcriptWatcher": { "type": "boolean", "default": true },
          "agentTools": { "type": "boolean", "default": true }
        }
      }
    }
  }
}
```

### Phase 7: Performance + UX (Days 11-14)

- `react-virtuoso` for TreeView and ToolLogPanel
- Materialized sessions table (summary with event counts, last update)
- Async file I/O everywhere (replace all `readFileSync`)
- Deep linking: URL hash encodes `#/session/{id}/agent/{id}`
- Command palette: simple Ctrl+K dialog with fuzzy search
- CSV export from ToolLogPanel
- SVG/PNG graph export via `@xyflow/react`'s `toSVG()`/`toPNG()`

### Phase 8: Auto-Resume + Cost (Days 11-14, parallel with Phase 7)

- `.synapse/sessions.json`: auto-save on shutdown, auto-load on start
- `--project <dir>` flag for project-scoped DB
- Cost tables: `cost_records(id, session_id, agent_id, vendor, model, input_tokens, output_tokens, cost_usd, created_at)`
- Budget API: `POST /api/budgets`, `GET /api/budgets`, `DELETE /api/budgets/:id`
- Alert engine: check budgets on each cost record insert; emit WebSocket alert event

### Phase 9: Release Engineering (Days 15-16)

- `.github/workflows/release.yml`: tag-triggered publish to npm
- `.github/workflows/extension.yml`: build + publish VSIX to Marketplace
- Changesets for version management (`@changesets/cli`)
- Root README.md, per-package README.md
- CONTRIBUTING.md, LICENSE (MIT recommended for OSS)
- `npx changeset` workflow documented

---

## Testing Strategy Summary

| Layer | Tool | Count | What's Tested |
|-------|------|-------|---------------|
| Unit | Vitest | ~65 | Core types/validation, server routes/services, store/hooks/utils |
| Integration | Vitest | ~15 | API endpoints with real SQLite, WebSocket broadcast chain |
| Component | Vitest + Testing Library | ~10 | Node rendering, error boundaries, dialog behavior |
| E2E | Playwright | ~10 | Full user flows: load → interact → verify |

**CI gates**: All tests must pass before merge to main. Coverage threshold: 70% lines.

---

## Opportunities & Additional Value Identified

1. **tRPC between server and dashboard**: Replace REST + manual types with tRPC for type-safe API layer. Significant DX improvement but adds a dependency. Consider for v4.
2. **Agent Teams visualization**: Claude Opus 4.6 supports TeammateTool for collaborative agents. Synapse could visualize team interactions as a mesh graph rather than tree.
3. **Session diffing**: Compare two sessions side-by-side to see how agent behavior differs (useful for prompt engineering).
4. **Embeddable widget**: A `<SynapseWidget />` React component that other apps embed for agent monitoring — this is what the monorepo enables.
5. **MCP server**: Expose Synapse data as an MCP server so Claude Code can query its own monitoring data.

---

## File Reference (Critical Files to Modify)

### Current → New Locations

| Current Path | New Path |
|-------------|----------|
| `src/types/agent.ts` | `packages/core/src/types/agent.ts` |
| `src/types/transcript.ts` | `packages/core/src/types/transcript.ts` |
| `src/utils/format.ts` | `packages/core/src/utils/format.ts` |
| `server/index.ts` | `packages/server/src/index.ts` |
| `server/db.ts` | `packages/server/src/db.ts` |
| `server/routes/*` | `packages/server/src/routes/*` |
| `server/services/*` | `packages/server/src/services/*` |
| `src/App.tsx` | `apps/dashboard/src/App.tsx` |
| `src/store/*` | `apps/dashboard/src/store/*` |
| `src/components/*` | `apps/dashboard/src/components/*` |
| `src/hooks/*` | `apps/dashboard/src/hooks/*` |
| `extension/*` | `apps/vscode/*` |
| `openclaw-plugin/*` | `packages/openclaw/*` |
