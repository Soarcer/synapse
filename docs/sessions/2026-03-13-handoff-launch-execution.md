# Handoff Prompt — Launch Execution

Copy everything below the line and paste as your first message in a new Opus session.

---

## Synapse v0.1.0 Launch Execution — Work Through Checklist

You are continuing work on **Synapse**, a real-time visualization dashboard for Claude Code agent sessions. We're preparing for our first public launch on GitHub this weekend.

### What Synapse Is

A React Flow node graph that visualizes Claude Code sessions in real-time — tool calls, subagents, timing, costs, all rendered as an interactive graph with 5 lens views (treemap, compaction, cost waterfall, sankey, tree). It's a pnpm monorepo with packages/core, packages/server, packages/cli, apps/dashboard, apps/vscode.

### What Just Happened

In the previous session, we completed a strategic review and built a comprehensive interactive launch checklist at `docs/launch-checklist.html`. Every task needed to go public is documented there with detailed instructions, sub-items, and verification steps. We also wrote design specs for the public launch strategy and a compile-time feature gate system.

### Your Job

Work through the launch checklist (`docs/launch-checklist.html`) with me, **one item at a time**. Each item has a smart code (like BF1, FG3, RC7) — I'll tell you which to work on, or you can suggest the next logical one.

### How This Works

1. Open `docs/launch-checklist.html` and read the DATA array to understand all sections and items
2. When I say a code (e.g., "BF1"), find that item, read its detail, and execute it
3. After completing each item, tell me it's done and suggest what's next based on the dependency order
4. For items tagged `you` — those are manual tasks I do myself. Skip them unless I ask for help.
5. For items tagged `claude` — those are yours. Execute them fully with verification.
6. For items tagged `blocker` — prioritize these. Nothing else matters until blockers are clear.

### Section Prefixes (for reference)

| Code | Section            | Items                        |
| ---- | ------------------ | ---------------------------- |
| BF   | Bug Fixes          | 6 items — 4 are blockers     |
| FG   | Feature Gating     | 10 items                     |
| RC   | Repo Cleanup       | 11 items                     |
| VA   | Visual Assets      | 9 items — mostly `you` tasks |
| RD   | README & Docs      | 5 items — most are done      |
| GH   | GitHub & npm       | 12 items                     |
| ST   | Smoke Test         | 3 items                      |
| LP   | Launch & Promotion | 9 items                      |
| NH   | Nice to Have       | 2 items                      |
| PL   | Post-Launch        | 5 items                      |

### Execution Order (suggested)

**Phase 1 — Fix what's broken (BF):**

- BF1: Fix graph zoom regression (blocker) — likely in `useAutoLayout.ts` or ReactFlow props
- BF2: Fix permission card [object Object] (blocker) — double serialization in `packages/server/src/routes/permissions.ts` line 115
- BF3: Fix CLI build (blocker) — `readPort` import in `packages/cli/src/cli.ts` line 15, use `status().port` instead
- BF4: Fix 10 failing tests (blocker) — 7 auto-fix after BF2, 3 need feature gate skips
- BF5: Fix deprecated meta tag (2 min)
- BF6: Fix React key warning (10 min)

**Phase 2 — Gate cut features (FG):**

- FG1 first (create `packages/core/src/features.ts`), then FG2-FG9 in any order, FG10 last (verify bundle)

**Phase 3 — Clean up for public (RC):**

- RC1-RC11 in listed order. RC6 is critical (remove .pem files before push!)

**Phase 4 — GitHub setup (GH):**

- GH1-GH12, but skip `you`-tagged items until I'm ready

### Key Files to Read First

- `docs/launch-checklist.html` — the master checklist (read the JS DATA array for all items and details)
- `docs/superpowers/specs/2026-03-13-public-launch-strategy-design.md` — strategic decisions, feature gate architecture, what ships vs what's cut
- `CLAUDE.md` — project structure, conventions, quick start
- `docs/sessions/2026-03-13-launch-strategy-and-checklist.md` — previous session summary

### Known Bugs (details in checklist)

- **BF1 — Graph zoom broken**: Regression from another session. Mouse wheel, pinch, keyboard zoom all broken on desktop and mobile. Root cause unknown but likely in `useAutoLayout.ts` or ReactFlow event handlers. Check `minZoom`/`maxZoom` props, `fitView` calls.
- **BF2 — Permission card [object Object]**: Server double-serializes `tool_input_raw` in `packages/server/src/routes/permissions.ts:115`. Fix: change `tool_input_raw: rawInput` to `tool_input_raw: entry.event.tool_input`.
- **BF3 — CLI build**: `packages/cli/src/cli.ts:15` imports `readPort` from `daemon.ts`, but it exports `readPid()`. Fix: use `const { port } = await status();`
- **BF4 — 10 failing tests**: 7 PermissionCard (fix after BF2), 2 RemoteDevChat (gate with `describe.skipIf`), 1 PushSetup (gate with `describe.skipIf`)

### Feature Gate Architecture

Single file `packages/core/src/features.ts` with `as const` literal booleans. Vite tree-shakes `false` branches at build time. Pattern:

```tsx
import { Features } from '@synapse-ai/core/features';
{
  Features.lensHeatmap && <Tab label="Heatmap" />;
}
```

9 features to gate: lensHeatmap, coaching, promptLab, analyticsDeep, costDisplayMode, remoteDevChat, pushNotifications, spawnAgent, multiVendor.

### Watch Out For

- **Do NOT kill all node processes** — use `taskkill //F //PID <pid>`, never `taskkill //F //IM node.exe`
- **The .pem files in `packages/server/` are local TLS certs with the user's IP** — these MUST be removed/gitignored before any push to public
- **`packages/openclaw` uses `better-sqlite3`** (native dep) — must be excluded from pnpm workspace before public clone test
- **Zustand gotcha**: `?? []` inside selectors causes infinite re-renders — use module-level `const EMPTY: T[] = []`
- **Express 5**: `req.params.id` returns `string | string[]` — cast to `string`

### Start

Read `docs/launch-checklist.html` (the DATA array in the script section) and tell me the current state — how many items total, how many blockers, and suggest where to start. Then wait for my go-ahead.
