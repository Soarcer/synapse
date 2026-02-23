# Session Handoff: Phase 9 (Multi-Vendor) + Phase 10 (CLI)

**Date**: 2026-02-22
**Branch**: main (all work uncommitted)

---

## What Was Built This Session

### Phase 9.3 — Codex CLI Adapter (Complete)

Added OpenAI Codex CLI support as the third vendor adapter alongside Claude and Gemini.

**New files:**

- `packages/server/src/adapters/codex.ts` — Full adapter with `TokenTracker` class (cumulative→delta token conversion), handles 4 JSONL payload formats: `agent-turn-complete`, `event_msg`, `message` (role-based), `record_type: state`
- `hooks/send_codex_event.cjs` — Codex-specific hook script (reads JSON from argv, not stdin)
- `scripts/simulate_codex_session.ts` — 10-event simulation covering all Codex event types

**Modified files:**

- `packages/server/src/adapters/index.ts` — Added `CodexAdapter` + `TokenTracker` exports
- `packages/server/src/routes/events.ts` — Registered CodexAdapter in registry (before Gemini and Claude)
- `packages/server/src/__tests__/adapters.test.ts` — 30+ new tests (detect, normalize, dedup, TokenTracker)
- `packages/server/src/__tests__/eventPipeline.test.ts` — 4 Codex integration tests
- `apps/vscode/esbuild.mjs` — Added `send_codex_event.cjs` to hook copy loop

**Key design decisions:**

- Codex session IDs prefixed with `codex-` (like Gemini uses `gemini-`)
- `vendor: 'openai'`, `eventSource: 'hook'` on all Codex events
- TokenTracker is stateful per-session — Codex reports cumulative tokens, adapter converts to deltas
- Codex uses argv delivery (not stdin like Claude/Gemini) — the hook script handles this

### Phase 9.4 — Dashboard Multi-Vendor UI (Complete)

Made vendor data visible and filterable throughout the dashboard.

**Modified files:**

- `apps/dashboard/src/store/eventHandlers.ts` — Propagated `vendor` from `AgentEvent` into `SessionData` (in `ensureSession` + `handleSessionStart`) and `AgentNodeData` (in `handleAgentStart`)
- `apps/dashboard/src/store/agentStore.ts` — Added `vendor?: string` to filter type
- `apps/dashboard/src/components/layout/SessionSelector.tsx` — Added vendor color dots on session rows + vendor filter pills (All/anthropic/openai/google) when multiple vendors exist
- `apps/dashboard/src/components/panels/AgentDetailPanel.tsx` — Added vendor badge next to model badge in agent info card

**Already working (no changes needed):**

- `SessionNode` — already had vendor badge
- `AgentNode` — already had vendor-colored left border
- `VendorBreakdown` — already showed vendor analytics
- Cost service — already had Gemini/OpenAI pricing

### Phase 10 — Standalone CLI (Complete)

Built `@synapse-ai/cli` — a standalone npm package for terminal users (no VS Code required).

**New package: `packages/cli/`**

- `package.json` — `bin: { synapse: "./bin/synapse.mjs" }`, version 0.9.0
- `tsconfig.json`
- `bin/synapse.mjs` — Thin entry point
- `src/cli.ts` — Command parser: `start`, `stop`, `status`, `hook`, `unhook`, `help`
- `src/daemon.ts` — Server lifecycle: spawn foreground/background, PID/port files, health check, graceful stop
- `src/hookSetup.ts` — Configure `.claude/settings.local.json` for current project
- `src/paths.ts` — `~/.synapse/` constants (port, pid, db), dist-relative paths
- `scripts/build.mjs` — 4-stage build: CLI bundle → server bundle → hooks copy → dashboard build

**Architecture: Single daemon, per-project hooks**

- One server process serves all projects (unlike VS Code extension which uses per-project servers)
- Global state at `~/.synapse/` (db, port file, pid file, server.log)
- Each project gets hooks configured in `.claude/settings.local.json` pointing to the daemon
- Hook scripts discover port via: project `.synapse-port` → global `~/.synapse/port` → default 4000

**Hook script update:**

- `hooks/send_event.cjs` — Added `getGlobalPort()` fallback reading `~/.synapse/port`
- Gemini and Codex hooks already had this fallback

**Build output:** `packages/cli/dist/` (4.6 MB)

```
dist/
├── cli.mjs          (7 KB)
├── server.mjs       (3 MB — full server bundle)
├── dashboard/       (1.6 MB — Vite assets)
└── hooks/           (11 KB — 3 hook scripts)
```

**Verified end-to-end:**

- `synapse start -d` → daemon on port 4000
- `synapse status` → reports running state
- `synapse hook` → configures hooks for cwd
- Simulation events → stored correctly
- `synapse stop` → graceful shutdown
- 581/581 tests pass

### VS Code Extension v0.9.0 (Rebuilt)

- Bumped from 0.8.0 to 0.9.0
- Includes all 3 hook scripts (Claude, Gemini, Codex)
- 1.51 MB, 26 files
- Copied to `\\192.168.1.214\Incoming\`

### ROADMAP.md Updates

Added 5 previously untracked features into the roadmap:

- Phase 5b: Mobile Responsive (DONE)
- Phase 5c: Notification System (DONE)
- Phase 5d: Guided Tour (DONE)
- Phase 5e: Arcade Game Modes (DONE)
- Open Source Prep (DONE)

Updated Phase 6 (VS Code) to DONE, Phase 7 (Cost/Resume) to 95%, Phase 9 to IN PROGRESS.

---

## Current State

- **All changes are uncommitted** on the `main` branch
- **581 tests pass** (0 failures)
- **VS Code extension v0.9.0** built and deployed to NAS
- **CLI package** built and tested locally at `packages/cli/dist/`

---

## What's Left / Next Steps

### Immediate

1. **Commit all changes** — large commit covering Phase 9.3, 9.4, and 10
2. **npm publish** — publish `@synapse-ai/cli` to npm (needs npm account setup, README)
3. **CLI README** — usage docs for `packages/cli/README.md`

### Phase 10 Polish

4. **Idle shutdown** — auto-stop daemon after 30 min of no events (~10 lines in server index.ts)
5. **Global config** — `~/.synapse/config.json` for persistent settings (default port, auto-open, etc.)
6. **`synapse start --watch`** — activate JSONL file watcher for OpenClaw integration
7. **`npx synapse`** support — ensure the package works without global install

### Phase 9 Remaining

8. **Phase 9.5** — Multi-vendor simulation script (run Claude + Gemini + Codex simultaneously)
9. **Dashboard project filter** — Add project/cwd filter for the single-daemon CLI model (sessions from different projects need visual separation)

### Other Roadmap Items

10. **Phase 7 remaining 5%** — Resume/continue session feature
11. **Phase 8** — ClawBrain AI coaching (design only, no implementation yet)
12. **Flaky perf test** — `analyticsRoutes.test.ts` benchmark sometimes exceeds 2000ms threshold
