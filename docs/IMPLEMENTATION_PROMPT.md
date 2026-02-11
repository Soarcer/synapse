# Synapse v3 Implementation Prompt for AI Coding Assistant

> Copy-paste this into a fresh Claude Code session in the Synapse project directory.
> Reference: `docs/IMPLEMENTATION_PLAN_V3.md` for full architecture, rationale, and file mappings.

---

## System Context

You are implementing a phased migration of the **Synapse** project from a single-package prototype to an OSS-ready pnpm monorepo under the `@synapse-ai` npm scope. Synapse is an interactive agent orchestration dashboard that monitors Claude Code sessions and Claude Agent SDK agents in real-time.

**Working directory**: `c:\Workspace\Coding\Prototypes\Synapse`
**Branch**: Create `feat/monorepo-v3` from `main`

**Read these documents first** (in order):
1. `CLAUDE.md` — Project conventions and structure
2. `docs/IMPLEMENTATION_PLAN_V3.md` — Full plan with all phases, findings, file mappings
3. `docs/ARCHITECTURE.md` — Current system design
4. `docs/ROADMAP.md` — Original roadmap (superseded by V3 plan but useful for context)

---

## Key Conventions (apply to ALL code)

- TypeScript strict mode everywhere
- Zod for runtime validation at system boundaries (API inputs, WS messages, file reads)
- No `any` types — use `unknown` and narrow with type guards
- Immutable state updates in Zustand (never mutate, always new objects)
- `pino` for server logging (not console.log)
- Error handling: catch with `unknown`, never leak stack traces to clients
- Write tests BEFORE or alongside implementation, not after
- Use `@synapse-ai/core` for shared types — never relative cross-package imports
- Express 5 `req.params.id` returns `string | string[]` — cast to `string`
- Zustand gotcha: `?? []` inside selectors causes infinite re-renders. Use module-level `const EMPTY: T[] = []`
- Agent SDK `abortController` goes inside `options`, not at top level of `query()` arg
- Hook scripts use `.cjs` extension (package.json has `"type": "module"`)
- npm scope is `@synapse-ai` (org claimed on npmjs.com)

---

## Execution Order

Execute phases sequentially. Each phase has a verification gate. Use the todo list to track progress.

### Phase 0: Cleanup (30 minutes)

1. Delete files: `nul` (root), `c:tempread_responses.txt` (root, if exists)
2. Edit `package.json`: remove `dagre` dep, pin `@anthropic-ai/claude-agent-sdk` to specific version
3. Edit `.gitignore`: add `nul`, `c:temp*`, `server/agentviz.db*`
4. Fix all 13 `catch (err: any)` → `catch (err: unknown)` with narrowing pattern:
   ```ts
   catch (err: unknown) {
     const message = err instanceof Error ? err.message : 'Unknown error';
   }
   ```
   Locations: `server/routes/agents.ts` (2), `server/routes/events.ts` (5), `server/routes/snapshot.ts` (2), `server/routes/transcript.ts` (2), `server/services/agentManager.ts` (1), `src/components/layout/Header.tsx` (2)
5. Commit: `chore: cleanup artifacts, fix error typing, pin dependencies`

**Gate**: `npm install` succeeds, git status clean.

---

### Phase 1: Monorepo Scaffold (dispatch 3 parallel agents)

**Target structure**:
```
synapse/
├── pnpm-workspace.yaml
├── tsconfig.base.json
├── packages/
│   ├── core/        @synapse-ai/core (types, validation, utils)
│   ├── server/      @synapse-ai/server (Express + SQLite + WS)
│   └── openclaw/    @synapse-ai/openclaw (OpenClaw plugin)
├── apps/
│   ├── dashboard/   React frontend (not published)
│   └── vscode/      @synapse-ai/vscode extension
├── hooks/           Claude Code hook scripts
├── scripts/         Build scripts
└── tests/e2e/       Playwright tests
```

**Agent A**: "Workspace Scaffold" — Create pnpm-workspace.yaml, tsconfig.base.json, all package.json files, all tsconfig.json files. NO code moves yet.

**Agent B**: "Code Migration" — Move files to new locations per the mapping in `docs/IMPLEMENTATION_PLAN_V3.md`. Update all relative imports to use `@synapse-ai/core`.

**Agent C**: "Build Config" — Update vite.config.ts (move to apps/dashboard/), update all build scripts in scripts/, create root workspace scripts, update .github/workflows if exists.

**After agents**: Run `pnpm install && pnpm -r build && pnpm dev` to verify.

**Gate**: Full build succeeds, dev server starts on :5173 + :4000.

---

### Phase 2: Testing Infrastructure (dispatch 3 parallel agents)

**Agent A**: "Test Setup + Core Tests" — Create vitest.config.ts (root + per-package), write ~18 tests for @synapse-ai/core (validation schemas, format utils, type guards).

**Agent B**: "Server Tests" — Write ~30 tests for @synapse-ai/server (eventStore, agentManager, routes/events, routes/agents, broadcaster, routes/snapshot).

**Agent C**: "Dashboard Tests + Lint" — Write ~25 tests for apps/dashboard (agentStore, wsClient, useAutoLayout, ErrorBoundary). Create eslint.config.js, .prettierrc, .editorconfig, husky + lint-staged.

**After agents**: Set up Playwright (`tests/e2e/`), write ~10 E2E tests. Create `.github/workflows/ci.yml`.

**Gate**: `pnpm test` all pass, `pnpm lint` passes, CI would be green.

---

### Phase 3: Backend Hardening (dispatch 2 parallel agents)

**Agent A**: "Validation + Auth + Logging"
- Add Zod validation middleware to ALL route handlers (use schemas from @synapse-ai/core)
- Add optional API key auth middleware (`SYNAPSE_API_KEY` env var)
- Replace all console.log/error with pino structured logger
- Fix error responses to not leak stack traces
- Make all hardcoded values configurable via env vars

**Agent B**: "WebSocket + AgentManager + DB"
- WebSocket: add backpressure (check bufferedAmount), ping/pong heartbeat (30s), max clients
- AgentManager: fix cleanup timer race in stopAll(), add sendMessage mutex, try-finally lifecycle, set vendor='anthropic' on SDK events, use transactions for multi-event ops
- DB: add composite indexes, SQLite pragmas (synchronous=NORMAL, cache_size=-64000), fix N+1 in snapshot export
- Fix CORS, fix shutdown handler

**Gate**: POST invalid event → 400 with Zod details. Health check shows DB size. Graceful shutdown clean.

---

### Phase 4: Frontend Hardening (dispatch 2 parallel agents, parallel with Phase 3)

**Agent A**: "Memory + Performance"
- Fix Toast memory leak (cleanup listeners on unmount)
- Fix WS reconnect loop (max 20 retries, connection timeout)
- Fix store race condition (atomic pause check in addEvent)
- Extract stable Zustand selectors to top-level constants
- Add useShallow for collection subscriptions
- Add React.lazy() code splitting for 6 lens views
- Debounce viewport ops (200ms)

**Agent B**: "Components + Accessibility"
- Split AgentGraph.tsx (794 lines → ~200 + 3 hooks: useGraphVisibility, useEdgeStyling, useGraphNavigation)
- Split AgentDetailPanel.tsx (653 lines → 4 components: AgentInfo, AgentTools, ToolDetail, MessageInput)
- Split agentStore.ts (962 lines → 3 files: store, eventProcessor, selectors)
- Add ARIA labels, focus traps, keyboard shortcut filtering
- Add ErrorBoundary around each lens view

**Gate**: No console errors on load. Lens views load lazily. All dashboard tests pass.

---

### Phase 5: VSCode Extension (dispatch 2 parallel agents)

**Agent A**: "Server Bundle + TreeView + StatusBar"
- Bundle server + dashboard dist into extension resources
- Fix ServerManager: reject on timeout, shell:false, 10s graceful shutdown
- Add TreeView: Session → Agent → Tool hierarchy in Explorer
- Upgrade StatusBar: live agent count + tokens via WS
- Add WS client for extension-side real-time updates

**Agent B**: "Sidebar + Build Pipeline"
- WebView sidebar with compact dashboard view
- New commands: switchLens, reconnect
- Fix build scripts: error checking, npm ci, include src/types
- VSIX size validation

**Gate**: `code --install-extension *.vsix` works. TreeView shows hierarchy. StatusBar shows live metrics.

---

### Phase 6: OpenClaw Plugin Alignment (dispatch 2 parallel agents)

**Agent A**: "SDK Alignment + /brain Command"
- Refactor to use `openclaw/plugin-sdk`: api.registerService(), api.registerTool(), api.registerCommand()
- Create proper openclaw.plugin.json manifest
- Implement /brain command: status, sessions, costs, dashboard subcommands

**Agent B**: "Bridge + Wrapper Fixes"
- Fix JSONL bridge: LRU cache for fileOffsets, batch posting, encoding validation, file size check
- Fix provider wrapper: external pricing config, proper model matching, request-scoped IDs
- Fix normalizer: bounded sessionStates Map, improved hash function

**Gate**: Plugin loads in OpenClaw. /brain status returns data. Events appear in dashboard.

---

### Phase 7: Performance + UX (dispatch 2 parallel agents)

**Agent A**: "Backend Perf + Virtualization"
- Materialized sessions table, async transcript I/O, batch query optimization
- react-virtuoso for TreeView and ToolLogPanel

**Agent B**: "UX Features"
- Deep linking (URL hash ↔ selected node/session/lens)
- Command palette (Ctrl+K with fuzzy search)
- CSV export, SVG/PNG graph export
- Full empty states with spawn button

**Gate**: 1000+ nodes scroll smoothly. Deep links work. Command palette finds all actions.

---

### Phase 8: Auto-Resume + Cost (sequential, not parallel)

1. ProjectStore service: load/save .synapse/sessions.json
2. Auto-load on startup, auto-save on shutdown
3. --project CLI flag for project-scoped DB
4. Cost tables (cost_records, budgets, alerts)
5. Budget API (CRUD + threshold checks)
6. Alert engine (dashboard toast + webhook)

**Gate**: Stop → restart → sessions restored. Budget exceeded → alert appears.

---

### Phase 9: Release Engineering (sequential)

1. GitHub Actions release workflow (tag-triggered npm publish)
2. Extension publish to VS Marketplace
3. Changesets for version management
4. Per-package README.md
5. CONTRIBUTING.md + LICENSE (MIT)

---

## Do NOT

- Use `any` type anywhere
- Use `console.log` in server code (use pino)
- Mutate Zustand state directly
- Create circular dependencies between packages
- Skip test gates between phases
- Add dependencies without justification
- Refactor code outside the current phase scope
- Create documentation files unless explicitly in the phase tasks
