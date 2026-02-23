# Synapse — Unified Roadmap (v3.0)

> Unified plan for Synapse platform architecture.
> See `docs/SYNAPSE_PLAN.md` for the full Synapse reference architecture.

---

## Progress Tracker

| Phase | Name                           | Status              | Notes                                                                                      |
| ----- | ------------------------------ | ------------------- | ------------------------------------------------------------------------------------------ |
| 1     | Hardening                      | ✅ **DONE**         | Error boundaries, rate limiting, agent limits, confirmation dialogs                        |
| 2     | Developer Experience           | ✅ **DONE**         | ESLint, Prettier, EditorConfig, Vitest, CI/CD, CONTRIBUTING.md, Husky                      |
| 3     | Monorepo Extraction            | ✅ **DONE**         | 5 workspace packages, pnpm workspaces, @synapse-ai/core cross-imports                      |
| 4     | Performance + UX               | ✅ **DONE**         | Async I/O, materialized sessions, batch transcript fetch, react-virtuoso, URL deep linking |
| 5     | Canvas2D Widget                | ❌ **REMOVED**      | Pixel Art Office removed from codebase                                                     |
| 5b    | Mobile Responsive              | ✅ **DONE**         | 13 components, auto-detect, MobileView/Graph/Analytics/BottomSheet, pinch zoom             |
| 5c    | Notification System            | ✅ **DONE**         | NotificationTray, NotificationPulse, AlertsView, store, settings                           |
| 5d    | Guided Tour                    | ✅ **DONE**         | 6 chapters, 18+ steps, auto-play + manual spotlight, i18n, 24 tests                        |
| 5e    | Arcade Game Modes              | 🔶 **90% DONE**     | GameOfLife, Tetris, Snake, Breakout done; PacMan not built                                 |
| 6     | VSCode Extension               | ✅ **DONE**         | v0.9.0: 11 commands, 9 settings, 4-tab settings, Prompt Lab, notifications                 |
| 7     | Auto-Resume + Cost             | 🔶 **95% DONE**     | Full analytics (21 endpoints, 5 UI tabs), coaching, budgets; missing `--project <dir>`     |
| 8     | ClawBrain                      | 🔶 **65% DONE**     | 3-layer plugin + backend integration; missing adapter + /brain                             |
| 9     | Multi-Vendor Integration       | 🔄 **IN PROGRESS**  | 9.1 + 9.2 done (adapter system + Gemini); 9.3 Codex + 9.4 UI remaining                     |
| —     | Packaging & CLI                | ✅ **90% DONE**     | All 5 packaging options implemented                                                        |
| —     | Open Source Prep               | 🔶 **80% DONE**     | SPDX headers (233 files), AGPL-3.0 + /ee; missing GOVERNANCE, README updates               |
| 10    | Standalone App / Claude Plugin | ⬜ **PLANNED**      | npm package, daemon mode, zero-config CLI, Claude plugin adapter                           |
| —     | AI Self-Modification           | ⬜ **NICE TO HAVE** | Design + plan complete; CSS themes + scoped CSS + custom lenses                            |

```
Phase 1  ──── ✅ DONE
Phase 2  ──── ✅ DONE
Phase 3  ──── ✅ DONE
Phase 4  ──── ✅ DONE
Phase 5  ──── ❌ REMOVED (Pixel Art Office)
Phase 5b ──── ✅ DONE (Mobile Responsive)
Phase 5c ──── ✅ DONE (Notification System)
Phase 5d ──── ✅ DONE (Guided Tour)
Phase 5e ──── 🔶 90% (Arcade Game Modes — missing PacMan)
Phase 6  ──── ✅ DONE (v0.9.0)
Phase 7  ──── 🔶 95% (missing --project CLI flag)
Phase 8  ──── 🔶 65% (missing ProviderAdapter + /brain)
Phase 9  ──── 🔄 IN PROGRESS (9.1 + 9.2 done)
Phase 10 ──── ⬜ PLANNED (Standalone App / Claude Plugin)
```

---

## Completed Phases

### Phase 1: Hardening — ✅ DONE

Error boundaries (6 in App.tsx), rate limiting (`/api/events` 200/min, `/api/agents/spawn` 30/min), MAX_CONCURRENT_AGENTS=10, AGENT_TIMEOUT_MS=300000, confirmation dialogs, global Express error handler, process signal handlers.

### Phase 2: Developer Experience — ✅ DONE

Vitest (505 tests), ESLint + Prettier + Husky pre-commit (`pnpm lint-staged`), `.editorconfig`, CI/CD (GitHub Actions), CONTRIBUTING.md, lint-staged config in `package.json`.

### Phase 3: Monorepo Extraction — ✅ DONE

5 workspace packages (`@synapse-ai/core`, `@synapse-ai/server`, `@synapse-ai/dashboard`, `@synapse-ai/vscode`, `@synapse-ai/openclaw`). pnpm workspaces. Cross-package imports via `@synapse-ai/core`.

### Phase 4: Performance + UX — ✅ DONE

Async I/O, materialized `session_summary` table, batch transcript fetch, react-virtuoso for long lists, URL deep linking (`useUrlSync`), composite DB indexes, lazy lens computation.

### Packaging & CLI — ✅ 90% DONE

| Option                    | Status | Files                                                                 |
| ------------------------- | ------ | --------------------------------------------------------------------- |
| 1. Folder copy            | ✅     | `scripts/make-package.ps1` + `.sh` (supports `--prebuilt`)            |
| 2. Global install         | ✅     | `scripts/install-global.ps1` + `.sh` → `~/.synapse`                   |
| 3. Single-process server  | ✅     | `server/index.ts` serves `dist/` via `express.static` + SPA fallback  |
| 4. npm CLI                | ✅     | `bin/synapse.mjs` — `synapse start`, `synapse hook`, `synapse unhook` |
| 5. VSCode extension build | ✅     | `scripts/build-extension.ps1` + `.sh` → `.vsix`                       |

### Phase 5b: Mobile Responsive — ✅ DONE

> 13 mobile components + `useBreakpoint` hook. Auto-detection for phones via `?view=mobile`.

**Components:** MobileView, MobileGraphView, MobileAnalyticsView, MobileTabBar, MobileStatusBar, MobileBottomSheet, MobileSessionSelector, MobileSearchButton, MobileLensView, MobileLensPanel, MobileSettingsButton, PinchZoomWrapper. Breakpoints: sm (<768), md (<1024), lg (1024+).

**Plan:** `docs/plans/2026-02-20-mobile-responsive-design.md`, `docs/plans/2026-02-20-mobile-enhancements.md`

### Phase 5c: Notification System — ✅ DONE

> Real-time notification tray, pulse overlay, and alerts view for permission prompts and warnings.

**Components:** NotificationTray (toast cards, bottom-left), NotificationPulse (top banner with auto-zoom), AlertsView (scrollable list), NotificationSettings (3 toggles). Zustand store with dedup, max 50, localStorage persistence. Isolation tags: `// [notifications]`.

**Plan:** `docs/plans/2026-02-20-notification-system.md`

### Phase 5d: Guided Tour — ✅ DONE

> Two-phase onboarding: auto-play demo (800ms narration over 31+ events) then manual spotlight walkthrough (6 chapters, 18+ steps).

**Components:** TourOverlay (spotlight clip-path + floating card), TourLauncher (welcome card + restart button), useAutoPlay (narration driver), tourStore (Zustand). Steps: graph (5), lens (3), panels (3), header (3), settings (2), analytics (2). Full i18n. 24 tests.

**Plan:** `docs/plans/2026-02-21-guided-tour-design.md`

### Phase 5e: Arcade Game Modes — 🔶 90% DONE

> Mini-games inside ToolGroupNode — tools become game elements.

**Done:** GameOfLife (cellular automaton, tool-seeded patterns), Tetris (human-player, 70/30 intelligent placement, line clearing), Snake (tool segments), Breakout (tool bricks, ball physics).

**Remaining:** PacMan (victory lap — sweep mechanic eating tool ghosts). Full implementation code in plan doc.

**Plan:** `docs/plans/2026-02-22-arcade-modes-v2-plan.md`

### Open Source Prep — 🔶 80% DONE

> AGPL-3.0-only licensing with enterprise `/ee` directory. SPDX headers added to 233 files.

**Done:** License headers, AGPL-3.0 license file, `/ee` directory structure, SPDX-License-Identifier on all source files.

**Remaining:** CODE_OF_CONDUCT.md, GOVERNANCE.md, CONTRIBUTING.md updates, README refresh for public repo, verification pass.

**Plan:** `docs/plans/2026-02-20-open-source-release-prep.md`

---

## Active Phases

### Phase 6: VSCode Extension — ✅ DONE

> `apps/vscode/` — v0.9.0 with 11 commands, 9 settings, 4-tab settings panel, Prompt Lab hotkeys, notification handler.

**Done:** Extension entry point, ServerManager (subprocess + health check + port auto-increment), HookManager (12 hook events + port file strategy), WebView Panel (iframe dashboard), WebView Sidebar (lens view), TreeView (session→agent→tool hierarchy), wsClient (direct WS + exponential backoff), StatusBar (running/stopped + metrics), 40+ keybinding forwarding, settings panel (hooks/server/data/Prompt Lab tabs), Prompt Lab (Ctrl+Alt+D/V), notification handler (blocked session tracking + toast + badge), bundled resources (server + dashboard + hooks in `.vsix`). 1.51 MB package, zero native deps.

### Phase 7: Auto-Resume + Cost System — 🔶 95% DONE

**Done:**

- Snapshot export/import (`GET/POST /api/snapshot`)
- Cost calculation in `transcriptReader.ts` (pricing tables for Claude, GPT, Gemini models)
- SQLite auto-persist: loads from disk on startup, debounced writes during runtime, `saveNow()` on shutdown
- Pricing engine (8 models, 4 vendors) in `costService.ts`
- Budget service with thresholds, WMA forecast, plan detection
- Velocity service (tokens/min, cost/min, efficiency score, sparklines)
- 21+ analytics endpoints (overview, timeseries, sessions, tools, models, turns, velocity, prompts, insights, budget, badges, prices, import, projects, model-optimization, AI summary/analyze/insights)
- 5-tab analytics UI (Executive, Prompts, Workshop, Insights, Live Nudges)
- Cost waterfall lens, conversation-aware coaching, report cards, playbook service

**Remaining:**

- `--project <dir>` CLI flag

### Phase 8: ClawBrain — 🔶 65% DONE

> OpenClaw plugin at `packages/openclaw/`. 3-layer data capture architecture.

**Done:** Plugin entry + registration, Layer 1 (JSONL transcript watcher), Layer 2 (3 agent tools: `synapse_query`, `synapse_metrics`, `synapse_dashboard`), Layer 3 PoC (provider wrapper), event normalization (multi-vendor), cost tracking (8 models), simulation script, build pipeline, backend integration (`vendor` column, `storePreNormalized()`).

**Remaining:**

| Item                                | Notes                                                 |
| ----------------------------------- | ----------------------------------------------------- |
| `openclawAdapter` (ProviderAdapter) | No adapter implementing the ProviderAdapter interface |
| `/brain` command                    | No CLI command parser; only agent tools available     |
| Layer 3 integration                 | Waiting on OpenClaw provider plugin interface         |

---

## Planned Phases

### Phase 9: Multi-Vendor Integration — 🔄 IN PROGRESS

> Extend Synapse to monitor Gemini CLI and OpenAI Codex CLI alongside Claude Code.
> Full plan: `docs/MULTI_VENDOR_PLAN.md`

**Three integration patterns:**

1. **Hook-based** (push, real-time) — Claude Code, Gemini CLI
2. **File-based** (pull, near real-time) — Codex CLI, Aider (future)
3. **Plugin/framework** (embedded) — OpenClaw (already exists)

| Sub-Phase | Name                                      | Effort | Status         |
| --------- | ----------------------------------------- | ------ | -------------- |
| 9.1       | Adapter interface + Claude extraction     | Small  | ✅ Done        |
| 9.2       | Gemini CLI adapter (hooks)                | Small  | ✅ Done        |
| 9.3       | Codex CLI adapter (file watcher + notify) | Medium | ⬜ Not started |
| 9.4       | Dashboard multi-vendor UI                 | Small  | ⬜ Not started |

**Completed deliverables (9.1 + 9.2):**

- `packages/server/src/adapters/types.ts` — `Adapter` interface (detect, normalize, dedupeFingerprint)
- `packages/server/src/adapters/claude.ts` — `ClaudeAdapter` extracted from eventStore.ts (zero behavioral change)
- `packages/server/src/adapters/gemini.ts` — `GeminiAdapter` with Gemini-exclusive hook detection + session ID namespacing
- `packages/server/src/adapters/index.ts` — `AdapterRegistry` (first-match-wins, 2s dedup window, adapter-qualified fingerprints)
- `hooks/send_gemini_event.cjs` — Gemini hook script (stdin JSON → POST)
- `scripts/simulate_gemini_session.ts` — 8-event Gemini simulation
- 35 adapter unit tests + 4 Gemini integration tests — all passing

**Remaining deliverables (9.3 + 9.4):**

- `packages/server/src/adapters/codex.ts` — file watcher + cumulative→delta token tracker
- Dashboard vendor badges, filter-by-vendor, vendor color coding

**Research docs:** `docs/GEMINI_INTEGRATION.md`, `docs/CODEX_INTEGRATION.md`, `docs/CODEX_FORMATS.md`, `docs/MULTI_VENDOR_PROMPT.md`

**Gate:** All three vendors coexist in SQLite. Simulation scripts for each tool produce correct events.

---

### Phase 10: Standalone App / Claude Plugin — ⬜ NOT STARTED

> Package Synapse as a zero-config standalone app or official Claude Code plugin that "just works" with `claude` in any terminal — no VS Code, no manual hook setup, no separate server process.

### What We Have Today vs What's Needed

| Concern                      | Current State                                                                                          | Standalone / Plugin Target                                                                              | Gap                                                                                                           |
| ---------------------------- | ------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| **Installation**             | Clone repo → `pnpm install` → run two processes; OR install .vsix in VS Code                           | `npx synapse` / `npm i -g synapse` / `claude plugin install synapse`                                    | Need self-contained npm package with pre-built dashboard, or single-binary via pkg/SEA                        |
| **Hook setup**               | Manual: run `synapse hook` per project, or VS Code extension auto-writes `.claude/settings.local.json` | Automatic: plugin registers hooks on install; standalone CLI auto-configures on `synapse start` for cwd | CLI `start` should auto-run `hook` for cwd; plugin mode needs Claude's plugin registration API                |
| **Server lifecycle**         | User starts server manually (`synapse start` or VS Code auto-start)                                    | Background daemon: auto-start on first hook event, auto-stop after idle timeout                         | Need daemonization (or `--background` flag), PID file, health check, `synapse status`/`synapse stop`          |
| **Dashboard access**         | Open browser to `localhost:4000` or VS Code webview                                                    | `synapse start` auto-opens browser; terminal mode shows compact TUI summary                             | Already serve SPA from Express; need `open` (cross-platform browser launch) + optional terminal-only mode     |
| **Build artifact**           | Monorepo source, not publishable as-is — `bin/synapse.mjs` spawns `npx tsx server/index.ts`            | Single npm package with compiled JS + pre-built dashboard assets                                        | Need build pipeline: `tsc` server → bundle dashboard → copy into `dist/` → publish as one package             |
| **Native dependencies**      | `sql.js` (pure JS) — already zero native deps for server                                               | Same — no change needed                                                                                 | None (already solved for VS Code)                                                                             |
| **Global config**            | Per-project `.claude/settings.local.json` only                                                         | Global `~/.synapse/config.json` for port, theme, API key; per-project overrides still work              | Need config file discovery: `~/.synapse/config.json` → project `.synapse.json` → env vars → CLI flags         |
| **Claude Plugin API**        | Doesn't exist yet — Claude Code has hooks but no formal plugin registry                                | `claude plugin install synapse` wires hooks + starts daemon automatically                               | Blocked on Anthropic shipping a plugin system; design for it now, ship when available                         |
| **Cross-project monitoring** | One server instance, but hooks must be configured per-project                                          | Single daemon monitors all projects; hook script auto-discovers running server                          | `.synapse-port` file approach already works; need global port file (`~/.synapse/port`) instead of per-project |
| **Auto-update**              | Manual git pull or re-install .vsix                                                                    | npm update; or self-update check on startup                                                             | Standard npm semver; optional update-notifier on CLI start                                                    |

### Implementation Sub-Phases

| Sub-Phase | Name                                      | Effort | Description                                                                                                                                                       |
| --------- | ----------------------------------------- | ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 10.1      | **Publishable npm package**               | Medium | Build pipeline: compile TS server → pre-build dashboard → bundle into single `synapse` npm package with `bin/synapse` entry. Remove `npx tsx` runtime dependency. |
| 10.2      | **Zero-config CLI**                       | Small  | `synapse start` auto-hooks cwd, opens browser, writes global port file. `synapse stop`, `synapse status`. `--no-browser`, `--background` flags.                   |
| 10.3      | **Background daemon mode**                | Medium | Daemonize server process (`--background` or auto on hook event). PID file at `~/.synapse/pid`. Auto-shutdown after configurable idle timeout (default 30 min).    |
| 10.4      | **Global config & multi-project**         | Small  | `~/.synapse/config.json` for persistent settings. Global port file so any project's hook script finds the running server without per-project `.synapse-port`.     |
| 10.5      | **Claude Plugin adapter**                 | Small  | Shim layer that conforms to Claude Code's plugin API (when available). Registers hooks, manages lifecycle, exposes metadata. Design now, ship when API exists.    |
| 10.6      | **Single-binary distribution** (optional) | Medium | Use Node.js SEA (Single Executable Application) or `pkg` to produce a standalone binary with no Node.js requirement. Windows/macOS/Linux.                         |

### Key Decisions to Make

1. **npm package vs single binary?** — npm is simpler and covers 95% of users (they already have Node). Single binary (SEA/pkg) removes the Node requirement but adds build complexity and ~50MB binary size.
2. **Always-running daemon vs on-demand?** — Daemon gives instant dashboard on any `claude` session. On-demand (start when first hook fires) is simpler but adds latency on first event.
3. **Claude Plugin API dependency** — The plugin sub-phase is speculative. If Anthropic ships a plugin registry, we adapt. If not, the CLI approach (`synapse start` + `synapse hook`) covers the same use case with one extra setup step.

### What's Already Done (reusable)

- `bin/synapse.mjs` — CLI skeleton with `start`, `hook`, `unhook` commands
- `hooks/send_event.cjs` — zero-dependency hook script, already reads port from file
- `packages/server/src/index.ts` — serves pre-built dashboard via `express.static`, auto-scans ports
- `sql.js` — no native dependencies, works everywhere
- VS Code extension build pipeline — proves the "bundle everything into one artifact" approach works

**Gate:** `npm install -g synapse && synapse start` in a fresh terminal → hooks auto-configured → open Claude Code → agent graph appears in browser.

---

## Future: AI Self-Modification — ⬜ NICE TO HAVE

> Users type a natural-language prompt and AI modifies the dashboard's appearance.

**Design:** `docs/plans/2026-02-20-self-modification-design.md`
**Implementation plan:** `docs/plans/2026-02-20-self-modification-plan.md`

Three channels: CSS variable overrides, scoped CSS injection, custom lens configs. Six-layer sandboxing. Feature flag `experimentalSelfModify` (defaults false).

---

## Key Decisions

1. **Harden BEFORE refactoring** — error boundaries, testing, linting in the current structure FIRST
2. **Monorepo extraction is Phase 3** — extract AFTER quality guardrails exist
3. **Build in-place** — convert this codebase via `git mv`, preserve history
4. **VSCode = hybrid approach** — WebView Panel (full dashboard), Sidebar (lens), StatusBar (metrics), TreeView (hierarchy)
5. **OpenClaw/ClawBrain = separate session** — build after core + dashboard are stable

---

## Files to Clean Up

- ~~`nul` — Windows redirect artifact~~ ✅ Deleted
- ~~`dagre` — remove from package.json~~ ✅ Removed
- `c:temp/`, `c:tempread_responses.txt` — orphaned temp artifacts, delete
- `hook_debug.log` — already gitignored but ~3MB on disk, consider deleting
