# Synapse — Unified Roadmap (v2.2)

> Unified plan for Synapse platform architecture.
> See `docs/SYNAPSE_PLAN.md` for the full Synapse reference architecture.
> See `docs/IMPLEMENTATION_PROMPT.md` for the parallel-agent execution prompt.

---

## Progress Tracker

| Phase | Name | Status | Notes |
|-------|------|--------|-------|
| 1 | Hardening | ✅ **95% DONE** | 2 tiny cleanup items remain (`nul` file, `dagre` dep) |
| 2 | Developer Experience | 🔶 **35% DONE** | Deps installed + bash scripts; config files + tests needed |
| 3 | Monorepo Extraction | ⬜ Not started | |
| 4 | Performance + UX | 🔶 **25% DONE** | Transcript/snapshot routes + JSON export + empty states + search |
| 5 | Canvas2D Widget | ⬜ Not started | |
| 6 | VSCode Extension | 🔶 **35% DONE** | Extension skeleton: StatusBar, WebView Panel, 5 commands |
| 7 | Auto-Resume + Cost | 🔶 **10% DONE** | Snapshot export/import exists; no auto-load/save or cost tables |
| 8 | ClawBrain | 🔶 **65% DONE** | 3-layer plugin + backend integration; missing adapter + /brain |
| 9 | Multi-Vendor Integration | ⬜ **PLANNED** | Gemini CLI + Codex CLI adapters; plan + research complete |
| — | Packaging & CLI | ✅ **90% DONE** | All 5 packaging options implemented |

---

## Packaging & CLI — ✅ 90% COMPLETE

All 5 packaging options from the original plan are implemented:

| Option | Status | Files |
|--------|--------|-------|
| 1. Folder copy | ✅ | `scripts/make-package.ps1` + `.sh` (supports `--prebuilt`) |
| 2. Global install | ✅ | `scripts/install-global.ps1` + `.sh` → `~/.synapse` |
| 3. Single-process server | ✅ | `server/index.ts` serves `dist/` via `express.static` + SPA fallback |
| 4. npm CLI | ✅ | `bin/synapse.mjs` — `synapse start`, `synapse hook`, `synapse unhook` |
| 5. VSCode extension build | ✅ | `scripts/build-extension.ps1` + `.sh` → `.vsix` |

Additional scripts: `scripts/setup-hooks.sh/ps1`, `scripts/synapse.sh/ps1` (wrapper with background mode + status), `scripts/build-openclaw.sh/ps1`.

Package name: `synapse-viz` with `bin/synapse.mjs` entry point, `.npmignore`, `.env.example`.

Documentation: `docs/INSTALL.md` (433-line installation guide covering npm CLI, single-process, VSCode extension, OpenClaw plugin).

---

## Key Decisions

### 1. Harden BEFORE refactoring
Error boundaries, testing, linting in the current structure FIRST. Refactoring broken code is harder than refactoring stable code.

### 2. Monorepo extraction is Phase 3 (not Phase 1)
The Synapse plan jumps straight to monorepo. But the current code has no tests, no linting, no error handling. Extract AFTER quality guardrails exist.

### 3. Build in-place (not a separate project)
Convert this codebase into the Synapse monorepo. Phases 1-2 happen in the current structure. Phase 3 restructures via `git mv`. Git history preserved, no double maintenance.

### 4. VSCode = hybrid approach
- **WebView Panel** for the full dashboard (reuse React UI)
- **WebView Sidebar** for the Canvas2D widget (lightweight)
- **Native StatusBar** for always-visible metrics (glanceable)
- **Native TreeView** for agent hierarchy (integrates with Explorer)
- Skip CodeLens and Timeline for v1

### 5. Canvas2D widget is worth building
20KB vs 150KB for React Flow. Essential for VSCode sidebar, iframe embeds, and eventually OpenClaw.

### 6. OpenClaw/ClawBrain = separate session
ClawBrain is a full plugin with its own hook system. Build it after core + dashboard + widget are stable.

---

## Parallel Execution Map (max 3 concurrent agents)

```
Phase 1  ──── ✅ DONE (2 cleanup items remain)
Phase 2  ──┬── Testing ──┬── Linting ──┬── Config          ← NEXT
Phase 3  ──┬── Scaffold ──┬── Types+Utils ──┬── Store+Components  →  wire dashboard
Phase 4a ──┬── Backend-Perf ──┬── Lens-Perf ──┬── Virtualization
Phase 4b ──── UX Features
Phase 5  ──┬── Engine ──┬── Renderer+Views ──┬── Integration
Phase 6  ──┬── TreeView+Metrics ──┬── WebView Sidebar      (Panel + StatusBar done)
Phase 7  ──── Sequential (DB schema changes, auto-load/save)
Phase 8  ──── Finish: ProviderAdapter + /brain command      (plugin core done)
```

**Max 3 concurrent agents per batch.**

---

## Phase 1: Hardening — ✅ 95% COMPLETE

### Batch A — ALL DONE

| Item | Status | Location |
|------|--------|----------|
| Express error handler | ✅ | `server/index.ts:67-70` (middleware) + `:135-141` (process handlers) |
| Rate limiting | ✅ | `express-rate-limit` on `/api/events` (200/min) + `/api/agents/spawn` (30/min) |
| Agent limits + timeout | ✅ | MAX_CONCURRENT_AGENTS=10, AGENT_TIMEOUT_MS=300000 in `agentManager.ts` |
| sendMessage guard | ✅ | Simplified: `if (!agent || agent.status !== 'success') return false` |
| Spawn 429 error | ✅ | `server/routes/agents.ts:50-56` returns HTTP 429 |
| Error boundaries | ✅ | `ErrorBoundary.tsx` wrapping 6 components in `App.tsx` |
| Loading/error states | ✅ | `isLoading`/`loadError` in store, spinner + error banner in `AgentGraph.tsx` |
| Confirmation dialogs | ✅ | `ConfirmDialog.tsx` used in Header (clear) + AgentDetailPanel (remove/stop) |

### Batch B (Cleanup) — MOSTLY DONE

| Item | Status |
|------|--------|
| waterfallSpans dead code removed | ✅ |
| CSS cleanup (icicle/waterfall) | ✅ |
| `_test.txt` deleted | ✅ |
| `hook_debug.log` in .gitignore | ✅ |
| Delete `nul` file | ❌ Still exists |
| Remove `dagre` from package.json | ❌ Still listed (unused since custom layout) |

---

## Phase 2: Developer Experience — 🔶 NEXT UP

> Quality guardrails before the big refactor. 3 parallel streams.
> **NOTE:** All npm dev dependencies already installed. Only config files, scripts, and test files needed.

**Pre-installed deps:** vitest, @testing-library/react, @testing-library/jest-dom, jsdom, eslint, @eslint/js, typescript-eslint, eslint-plugin-react-hooks, prettier, eslint-config-prettier, husky, lint-staged

**Already exists:** `.nvmrc` (22), `start-server.sh`, `start-client.sh`

| Stream | Remaining Tasks | Files (exclusive) |
|--------|----------------|--------------------|
| **Testing** | Create vitest.config.ts, write test files (eventStore, agentStore, format) | `vitest.config.ts` (new), `src/__tests__/` (new), `server/__tests__/` (new) |
| **Linting** | Create eslint.config.js, .prettierrc, configure .husky/ | `eslint.config.js` (new), `.prettierrc` (new), `.husky/` (new) |
| **Config** | Create .editorconfig, add npm scripts, pin SDK version, add lint-staged config | `.editorconfig` (new) |

**Merge step:** Add to `package.json`: test/lint/format/prepare scripts + lint-staged config. Also: delete `nul`, remove dagre (Phase 1 leftovers).

**Gate:** `npm test && npm run lint && npm run build` all pass.

---

## Phase 3: Monorepo Extraction (Synapse architecture)

> Convert to pnpm workspace. Extract shared code into `@synapse-viz/core`. 3 parallel streams + sequential wiring.

**Target structure:**
```
Synapse/  (this repo, renamed)
├── packages/
│   ├── core/                 # @synapse-viz/core
│   │   ├── types/            # agent.ts, provider.ts (ProviderAdapter), lens.ts
│   │   ├── store/            # graphStore.ts + createStore(adapter) factory
│   │   ├── components/       # graph/, panels/, lens/, Toast, ErrorBoundary, ConfirmDialog
│   │   ├── hooks/            # useAutoLayout, useHandlePositions
│   │   ├── utils/            # format.ts, theme.ts (dynamic palette from registry)
│   │   └── server/           # db.ts, broadcaster.ts, projectStore.ts
│   └── widget/               # @synapse-viz/widget (Phase 5)
├── apps/
│   ├── dashboard/            # Synapse Dashboard (refactored from prototype)
│   │   ├── src/adapters/     # claudeHookAdapter, claudeSdkAdapter
│   │   ├── src/components/   # SpawnAgentDialog, AgentTemplates (Claude-specific)
│   │   ├── src/main.tsx
│   │   └── server/           # Express + hook receiver + Agent SDK
│   └── vscode/               # Synapse for VSCode (Phase 6)
├── pnpm-workspace.yaml
├── tsconfig.base.json
└── package.json
```

| Stream | Tasks | Output |
|--------|-------|--------|
| **Scaffold** | pnpm-workspace.yaml, tsconfig.base.json, per-package package.json, build pipeline | Monorepo compiles |
| **Types+Utils** | Extract types → `core/types/`, add ProviderAdapter, extract format/theme → `core/utils/` | Types importable from `@synapse-viz/core` |
| **Store+Components** | Extract store → `core/store/graphStore.ts`, components → `core/components/`, hooks → `core/hooks/` | Components importable from `@synapse-viz/core` |

Then sequential: Wire `apps/dashboard/` to import from `@synapse-viz/core` with `claudeAdapter`.

**Verify:** Simulation script renders correctly via monorepo dashboard consuming `@synapse-viz/core`.

---

## Phase 4: Performance + UX — 🔶 25% DONE

> Two batches (3 + 1).

**Already done (skip these):**
- ✅ JSON snapshot export/import (keyboard shortcuts E/I in Header)
- ✅ Partial empty states (graph hint banner, "No tool events yet", "No token data available")
- ✅ Graph search with `/` shortcut + `graphSearchQuery` in store
- ✅ Transcript reading service (`server/services/transcriptReader.ts` — JSONL parsing, cost calc, token aggregation)
- ✅ Transcript routes (`server/routes/transcript.ts` — GET per-session + list all)
- ✅ Snapshot routes (`server/routes/snapshot.ts` — export + import with duplicate detection)
- ✅ Sessions endpoint (`GET /api/events/sessions` via `listSessions()` GROUP BY)

**Batch A (3 agents):**

| Stream | Remaining Tasks | Package |
|--------|----------------|---------|
| **Backend-Perf** | Composite indexes, **async** transcript I/O (still `readFileSync`), materialized sessions summary table | `packages/core/server/` |
| **Lens-Perf** | Lazy lens computation (tab-guard useMemos), transcript fetch batching | `packages/core/components/lens/` |
| **Virtualization** | react-virtuoso for TreeView, ToolLogPanel | `packages/core/components/` |

**Batch B (1 agent, after Batch A):**

| Stream | Remaining Tasks | Package |
|--------|----------------|---------|
| **UX Features** | Deep linking, command palette, search API, **CSV export** (JSON already works), full empty state for AgentGraph ("No active sessions" + spawn button), agent templates | `apps/dashboard/` |

**Verify:** 5000+ events: TreeView smooth; lens tabs switch instantly; URL hash round-trips.

---

## Phase 5: Canvas2D Widget Engine

> Build `packages/widget/`. 3 parallel streams.

| Stream | Tasks | Files |
|--------|-------|-------|
| **Engine** | Scene graph (nodes, edges, camera, hit testing, dirty rects), Layout (tree algorithm) | `engine/Scene.ts`, `engine/Layout.ts` |
| **Renderer+Views** | Canvas2D draw loop, 6 view renderers (Graph, Tree, Heatmap, Treemap, Compaction, Cost) | `engine/Renderer.ts`, `views/*.ts` |
| **Integration** | React wrapper `<SynapseWidget />`, iframe/postMessage bridge, test HTML page | `Widget.tsx`, `embed.ts`, `index.html` |

**Target:** ~800 lines, ~20KB bundle, 50+ nodes at 60fps, no React dependency in engine.

---

## Phase 6: VSCode Extension — 🔶 35% DONE

> Extension skeleton exists at `extension/`. Hybrid approach with iframe panel.

**Already done:**

| Item | Status | Location |
|------|--------|----------|
| Extension entry point | ✅ | `extension/src/extension.ts` — activation, commands, lifecycle |
| StatusBar (basic) | ✅ | Shows `$(pulse) Synapse` running/stopped; click opens dashboard |
| WebView Panel | ✅ | `extension/src/webviewPanel.ts` — iframe to localhost:4000, retry logic |
| ServerManager | ✅ | `extension/src/serverManager.ts` — spawns backend subprocess, health check polling |
| HookManager | ✅ | `extension/src/hookManager.ts` — configures 20 hook events in workspace settings |
| Commands | ✅ | `openDashboard`, `startServer`, `stopServer`, `configureHooks`, `removeHooks` |
| Extension manifest | ✅ | `extension/package.json` — activation events, settings, commands |
| Build config | ✅ | `extension/esbuild.mjs` + `scripts/build-extension.ps1/sh` |

**Remaining:**

| Item | Status | Notes |
|------|--------|-------|
| StatusBar **metrics** (agent count + tokens) | ❌ | Currently only shows running/stopped status |
| TreeView (session→agent→tool hierarchy) | ❌ | No `treeView.ts` — no native Explorer integration |
| WebView Sidebar (Canvas2D widget) | ❌ | No `sidebarProvider.ts` — depends on Phase 5 widget |
| Extension-side wsClient | ❌ | No direct WS — relies on iframe browser WS |
| Commands: `switchLens`, `reconnect` | ❌ | Not registered |
| Bundled resources | ❌ | `extension/resources/` is empty — server not packaged into extension yet |

**Verify:** Extension loads; sidebar shows widget; panel shows full dashboard; status bar shows live metrics.

---

## Phase 7: Auto-Resume + Cost System — 🔶 10% DONE

> Sequential (shared DB schema).

**Already done:**
- ✅ Snapshot export/import (`server/routes/snapshot.ts` — manual E/I keyboard shortcuts)
- ✅ Cost calculation in `transcriptReader.ts` (pricing tables for Claude, GPT, Gemini models)

**Remaining:**
- `.synapse/sessions.json` auto-load on startup, auto-save on shutdown
- `--project <dir>` CLI flag
- Cost tables: `cost_records`, `budgets`, `alerts`
- Budget management API (CRUD, threshold checks)
- Alert engine: dashboard toast + webhook delivery
- Provider pricing from adapter's `pricing` table

**Verify:** Stop+restart server → events survive; budget alert fires.

---

## Phase 8: ClawBrain — 🔶 65% DONE

> OpenClaw plugin at `openclaw-plugin/`. 3-layer data capture architecture.

**Already done:**

| Item | Status | Location |
|------|--------|----------|
| Plugin entry + registration | ✅ | `openclaw-plugin/src/plugin.ts` — slot: "tool", TypeBox config schema |
| Layer 1: JSONL transcript watcher | ✅ | `layers/jsonlBridge.ts` — fs.watch + polling, tail-reads new lines |
| Layer 2: Agent tools (3 tools) | ✅ | `layers/agentTools.ts` — `synapse_query`, `synapse_metrics`, `synapse_dashboard` |
| Layer 3: Provider wrapper (PoC) | ⚠️ | `layers/providerWrapper.ts` — monitoring logic ready, no OpenClaw interface yet |
| Event normalization | ✅ | `normalizers/openclawJsonl.ts` — multi-vendor (Claude, GPT, Gemini, Groq, OpenRouter) |
| Cost tracking | ✅ | Pricing tables for 8 models, cost estimates in events + metrics |
| Simulation script | ✅ | `scripts/simulate_openclaw.ts` — 3 multi-vendor sessions |
| Build pipeline | ✅ | `openclaw-plugin/esbuild.mjs` + `scripts/build-openclaw.ps1/sh` |
| Backend integration | ✅ | `vendor` column in events table, `storePreNormalized()` in eventStore, event source routing in events.ts |

**Remaining:**

| Item | Status | Notes |
|------|--------|-------|
| `openclawAdapter` (ProviderAdapter) | ❌ | No adapter implementing the `ProviderAdapter` interface |
| `/brain` command | ❌ | No CLI command parser; only agent tools available |
| ClawBrain dashboard | ❌ | Relies on upstream Synapse server; no dedicated UI |
| Layer 3 integration | ❌ | Waiting on OpenClaw provider plugin interface confirmation |

**Verify:** ClawBrain plugin in OpenClaw → live agent graph + cost tracking.

---

## Phase 9: Multi-Vendor Integration — ⬜ NOT STARTED

> Extend Synapse to monitor Gemini CLI and OpenAI Codex CLI alongside Claude Code.
> Full plan: `docs/MULTI_VENDOR_PLAN.md`

**Three integration patterns:**
1. **Hook-based** (push, real-time) — Claude Code, Gemini CLI
2. **File-based** (pull, near real-time) — Codex CLI, Aider (future)
3. **Plugin/framework** (embedded) — OpenClaw (already exists)

| Sub-Phase | Name | Effort | Status |
|-----------|------|--------|--------|
| 9.1 | Shared infra + Claude adapter extraction | Small | ⬜ Not started |
| 9.2 | Gemini CLI adapter (hooks + file watcher) | Small | ⬜ Not started |
| 9.3 | Codex CLI adapter (file watcher + notify) | Medium | ⬜ Not started |
| 9.4 | Dashboard multi-vendor UI | Small | ⬜ Not started |

**Key deliverables:**
- `packages/adapter-common/` — shared file watcher base, pricing, platform paths
- `packages/adapter-claude/` — extracted from server (refactor, no behavior change)
- `packages/adapter-gemini/` — hook script + normalizer + file watcher
- `packages/adapter-codex/` — file watcher + normalizer + cumulative token tracker
- `AdapterRegistry` in server — replaces hardcoded Claude normalization

**Research docs:**
- `docs/GEMINI_INTEGRATION.md` — Gemini CLI hook schemas, JSON formats, normalizer design
- `docs/CODEX_INTEGRATION.md` — Codex CLI JSONL schemas, token tracking, notify hook
- `docs/CODEX_FORMATS.md` — Detailed Codex file format reference with all event types
- `docs/MULTI_VENDOR_PROMPT.md` — Ready-to-use implementation prompt for new session

**API proxies (OpenRouter, LiteLLM):** No separate adapters needed — covered by tool-level adapters + OpenClaw's provider wrapper + `inferVendor()` model name detection.

**Gate:** All three vendors coexist in SQLite. Simulation scripts for each tool produce correct events.

---

## Remaining Optimizations

### Performance (Phase 4)
- LensAdapter computes all 7 views eagerly (only active tab needed)
- TreeView/ToolLogPanel render all items (no virtualization)
- No composite DB indexes for common queries
- `listSessions()` does GROUP BY on full events table (no materialized summary)
- `readFileSync` in transcriptReader blocks the event loop
- Individual transcript fetches per session (no batching)

### Resolved in Phase 1 ✅
- ~~No max concurrent agent limit~~ → MAX_CONCURRENT_AGENTS=10
- ~~No agent timeout watchdog~~ → AGENT_TIMEOUT_MS=300000
- ~~AgentManager.sendMessage guard logic~~ → Simplified
- ~~Dead `waterfallSpans` computation~~ → Removed
- ~~No error boundaries~~ → 6 boundaries in App.tsx
- ~~No global Express error handler~~ → Added middleware + process handlers
- ~~`hook_debug.log` grows unbounded~~ → In .gitignore

### Infrastructure (Phase 2)
- ~~No tests~~ → vitest installed, config + test files needed
- ~~No linting~~ → eslint/prettier installed, config files needed
- No CI/CD — no GitHub Actions
- No Docker — no containerization
- ~~No Linux/Mac scripts~~ → `start-server.sh`, `start-client.sh` created
- ~~No packaging/CLI~~ → All 5 packaging options implemented

---

## Files to Clean Up (Phase 2 merge step)

- `nul` — Windows redirect artifact, delete
- `dagre` — remove from package.json (replaced by custom layout in useAutoLayout.ts)
- `c:temp/`, `c:tempread_responses.txt` — orphaned temp artifacts, delete
- `hook_debug.log` — already gitignored but ~3MB on disk, consider deleting
