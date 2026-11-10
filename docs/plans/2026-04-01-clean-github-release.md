# Clean GitHub Release — Public Source for @synapse-ai/cli

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Publish a clean public GitHub repository containing only the source code that powers the `@synapse-ai/cli` npm package — the monitoring dashboard, server, core types, hooks, and CLI. All roadmap/private features (analytics, coaching, prompt lab, OpenClaw, VS Code extension, game modes, multi-vendor adapters, simulation scripts) are stripped.

**Architecture:** Create a repeatable export script that copies the monorepo into a clean staging directory, strips private features via targeted file exclusion and surgical edits to import/registration files, verifies the result builds, then pushes to a separate public GitHub repo. The private monorepo remains untouched.

**Tech Stack:** bash scripting, git, pnpm, esbuild, TypeScript, Vite

---

## Strategy: Separate Public Repo

**Why not an orphan branch or filter-repo?**
- Orphan branches in the same repo leak `.git` objects (someone can `git log --all` and find private code)
- `git filter-repo` rewrites history and is fragile with monorepos
- A **separate repo** (`Soarcer/synapse`) is the industry standard (React, Next.js, etc. all do this)

**The workflow:**
1. A script copies files from the private monorepo to a local clone of the public repo
2. It strips private features (deletes files, patches imports)
3. It verifies the build works
4. You review the diff and push

This is repeatable for every release — run the script, review, push.

---

## File Map: What Ships vs. What's Excluded

### INCLUDED (public repo)

```
synapse-public/
├── package.json                 # Root monorepo (stripped scripts)
├── pnpm-workspace.yaml          # Only core, server, cli, dashboard
├── tsconfig.base.json
├── LICENSE
├── README.md                    # Public-facing README (rewrite)
├── CONTRIBUTING.md
├── CODE_OF_CONDUCT.md
├── .gitignore
├── .github/                     # CI workflows
├── hooks/
│   └── send_event.cjs           # Claude Code hook ONLY
├── packages/
│   ├── core/                    # @synapse-ai/core (stripped)
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   └── src/
│   │       ├── index.ts         # Stripped: no coaching exports
│   │       ├── config.ts
│   │       ├── features.ts      # Stripped: only shipped flags
│   │       ├── pricing.ts
│   │       ├── schemas.ts       # Stripped: no coaching schemas
│   │       ├── types/
│   │       │   ├── agent.ts
│   │       │   ├── transcript.ts
│   │       │   └── hooks.ts
│   │       │   # NO coaching.ts
│   │       └── utils/
│   │           └── format.ts
│   ├── server/                  # @synapse-ai/server (stripped)
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   └── src/
│   │       ├── index.ts
│   │       ├── app.ts           # Stripped: no analytics/coaching/push routes
│   │       ├── db.ts            # Stripped: no coaching/badge/nudge tables
│   │       ├── hookServer.ts
│   │       ├── sql-js.d.ts
│   │       ├── lib/             # ALL files
│   │       ├── state/           # ALL files
│   │       ├── adapters/
│   │       │   ├── index.ts
│   │       │   ├── types.ts
│   │       │   └── claude.ts    # Claude ONLY — no gemini.ts, codex.ts
│   │       ├── routes/
│   │       │   ├── agents.ts
│   │       │   ├── events.ts
│   │       │   ├── transcript.ts
│   │       │   ├── snapshot.ts
│   │       │   ├── settings.ts
│   │       │   ├── hookConfig.ts
│   │       │   ├── permissions.ts
│   │       │   └── network.ts
│   │       │   # NO analytics.ts, coaching.ts, push.ts
│   │       └── services/
│   │           ├── broadcaster.ts
│   │           ├── agentManager.ts
│   │           ├── eventIngestion.ts
│   │           ├── eventStore.ts
│   │           ├── fileEventRelay.ts
│   │           ├── transcriptReader.ts
│   │           ├── transcriptScanner.ts
│   │           ├── transcriptCache.ts
│   │           ├── costService.ts
│   │           ├── settingsService.ts
│   │           ├── hookConfigService.ts
│   │           ├── importService.ts
│   │           └── providerNormalizer.ts
│   │           # NO: rules/, nudgeEngine, reportCard, aiCoach,
│   │           #     badge, budget, velocity, insights, prompt,
│   │           #     crossSession, modelOptimization, playbook, push
│   └── cli/                     # @synapse-ai/cli (mostly unchanged)
│       ├── package.json
│       ├── tsconfig.json
│       ├── README.md
│       ├── bin/synapse.mjs
│       ├── src/
│       │   ├── cli.ts
│       │   ├── daemon.ts
│       │   ├── hookSetup.ts
│       │   ├── paths.ts
│       │   └── setup.ts
│       └── scripts/
│           └── build.mjs        # Patched: only copies send_event.cjs
├── apps/
│   └── dashboard/               # React frontend (stripped)
│       ├── package.json
│       ├── tsconfig.json
│       ├── vite.config.ts
│       ├── tailwind.config.ts
│       ├── index.html
│       └── src/
│           ├── main.tsx
│           ├── App.tsx          # Stripped: no analytics lazy import
│           ├── index.css
│           ├── i18n/
│           ├── hooks/
│           ├── store/
│           ├── components/
│           │   ├── graph/       # ALL (including game-modes easter egg)
│           │   │   # BUT: remove NudgeBadge.tsx or strip coaching refs
│           │   ├── layout/      # ALL
│           │   ├── lens/        # ALL (disabled lenses are feature-gated)
│           │   ├── panels/      # ALL
│           │   ├── permissions/ # ALL
│           │   ├── mobile/      # ALL except RemoteDevChat.tsx
│           │   │   # NO: analytics/ directory
│           │   │   # NO: WorkshopModal.tsx
│           │   ├── ConfirmDialog.tsx
│           │   ├── EmptyState.tsx
│           │   ├── ErrorBoundary.tsx
│           │   ├── SkeletonLoader.tsx
│           │   └── Toast.tsx
│           └── features/
│               ├── tour/        # ALL (analytics steps already removed)
│               └── notifications/ # ALL (push is feature-gated)
└── scripts/
    # EMPTY — no simulation or screenshot scripts
```

### EXCLUDED (stays in private repo only)

| Category | Files |
|----------|-------|
| Analytics dashboard | `apps/dashboard/src/components/analytics/**` |
| Workshop modal | `apps/dashboard/src/components/WorkshopModal.tsx` |
| Remote dev chat | `apps/dashboard/src/components/mobile/RemoteDevChat.tsx` |
| Coaching types | `packages/core/src/types/coaching.ts` |
| Analytics route | `packages/server/src/routes/analytics.ts` |
| Coaching route | `packages/server/src/routes/coaching.ts` |
| Push route | `packages/server/src/routes/push.ts` |
| Rules engine | `packages/server/src/services/rules/**` |
| 14 coaching/analytics services | `nudgeEngine`, `reportCardEngine`, `aiCoachService`, `aiNudgeEscalator`, `badgeService`, `budgetService`, `velocityService`, `promptAnalyzer`, `insightsEngine`, `crossSessionAnalyzer`, `modelOptimizationService`, `playbookService`, `pushService` |
| Gemini/Codex adapters | `packages/server/src/adapters/gemini.ts`, `codex.ts` |
| Gemini/Codex hooks | `hooks/send_gemini_event.cjs`, `send_codex_event.cjs` |
| OpenClaw | `packages/openclaw/**`, `openclaw-plugin/**` |
| VS Code extension | `apps/vscode/**` |
| Simulation scripts | `scripts/simulate_*.ts`, `scripts/inject_*.ts`, etc. |
| Screenshot pipeline | `scripts/capture_screenshots.ts`, `scripts/screenshot_*.ts` |
| Internal docs | `docs/` (except curated public docs) |
| Dev configs | `.claude/`, `start-server.ps1`, `start-client.ps1` |

---

## Tasks

### Task 1: Create the public repo on GitHub

**Files:** None (GitHub UI / gh CLI)

- [ ] **Step 1: Create the repo**

```bash
gh repo create Soarcer/synapse --public --description "Monitor AI coding agents in real-time" --license MIT
```

- [ ] **Step 2: Clone it locally**

```bash
cd c:/Workspace/Coding/Prototypes
git clone https://github.com/Soarcer/synapse.git synapse-public
```

- [ ] **Step 3: Verify it's empty and ready**

```bash
cd synapse-public && ls -la
```

Expected: empty repo with just `.git/`

---

### Task 2: Write the export script

**Files:**
- Create: `scripts/export-public.sh`

This script is the core of the release process. It copies files from the private monorepo to the public repo clone, skipping all private features.

- [ ] **Step 1: Create the export script**

```bash
#!/usr/bin/env bash
# export-public.sh — Copy public-facing source to the clean GitHub repo.
# Usage: ./scripts/export-public.sh /path/to/synapse-public
set -euo pipefail

PRIVATE_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PUBLIC_ROOT="${1:?Usage: $0 /path/to/synapse-public}"

if [ ! -d "$PUBLIC_ROOT/.git" ]; then
  echo "ERROR: $PUBLIC_ROOT is not a git repo" >&2
  exit 1
fi

echo "=== Exporting from $PRIVATE_ROOT → $PUBLIC_ROOT ==="

# ── Clean target (preserve .git) ──
find "$PUBLIC_ROOT" -mindepth 1 -maxdepth 1 ! -name '.git' -exec rm -rf {} +

# ── Root config files ──
for f in tsconfig.base.json LICENSE CONTRIBUTING.md CODE_OF_CONDUCT.md .gitignore; do
  [ -f "$PRIVATE_ROOT/$f" ] && cp "$PRIVATE_ROOT/$f" "$PUBLIC_ROOT/"
done

# ── pnpm-workspace.yaml (strip openclaw, vscode) ──
cat > "$PUBLIC_ROOT/pnpm-workspace.yaml" << 'YAML'
packages:
  - 'packages/core'
  - 'packages/server'
  - 'packages/cli'
  - 'apps/dashboard'
YAML

# ── Root package.json (minimal) ──
cat > "$PUBLIC_ROOT/package.json" << 'JSON'
{
  "name": "synapse-monorepo",
  "private": true,
  "description": "Monitor AI coding agents in real-time",
  "license": "MIT",
  "packageManager": "pnpm@10.6.3",
  "scripts": {
    "dev": "concurrently \"pnpm --filter @synapse-ai/server dev\" \"pnpm --filter @synapse-ai/dashboard dev\"",
    "build": "pnpm -r build",
    "test": "pnpm -r test"
  },
  "devDependencies": {
    "concurrently": "^9.1.2",
    "typescript": "^5.7.3"
  }
}
JSON

# ── hooks/ (Claude only) ──
mkdir -p "$PUBLIC_ROOT/hooks"
cp "$PRIVATE_ROOT/hooks/send_event.cjs" "$PUBLIC_ROOT/hooks/"
[ -f "$PRIVATE_ROOT/hooks/send_response.cjs" ] && cp "$PRIVATE_ROOT/hooks/send_response.cjs" "$PUBLIC_ROOT/hooks/"

# ── .github/ ──
[ -d "$PRIVATE_ROOT/.github" ] && cp -r "$PRIVATE_ROOT/.github" "$PUBLIC_ROOT/"

# ── packages/core/ ──
mkdir -p "$PUBLIC_ROOT/packages/core"
cp "$PRIVATE_ROOT/packages/core/package.json" "$PUBLIC_ROOT/packages/core/"
cp "$PRIVATE_ROOT/packages/core/tsconfig.json" "$PUBLIC_ROOT/packages/core/"
mkdir -p "$PUBLIC_ROOT/packages/core/src/types" "$PUBLIC_ROOT/packages/core/src/utils"
for f in config.ts features.ts pricing.ts schemas.ts index.ts; do
  cp "$PRIVATE_ROOT/packages/core/src/$f" "$PUBLIC_ROOT/packages/core/src/"
done
for f in agent.ts transcript.ts hooks.ts; do
  cp "$PRIVATE_ROOT/packages/core/src/types/$f" "$PUBLIC_ROOT/packages/core/src/types/"
done
# Explicitly skip coaching.ts
cp "$PRIVATE_ROOT/packages/core/src/utils/format.ts" "$PUBLIC_ROOT/packages/core/src/utils/"

# ── packages/server/ ──
mkdir -p "$PUBLIC_ROOT/packages/server/src"/{lib,routes,services,adapters,state}
cp "$PRIVATE_ROOT/packages/server/package.json" "$PUBLIC_ROOT/packages/server/"
cp "$PRIVATE_ROOT/packages/server/tsconfig.json" "$PUBLIC_ROOT/packages/server/"
# Core server files
for f in index.ts app.ts db.ts hookServer.ts sql-js.d.ts; do
  cp "$PRIVATE_ROOT/packages/server/src/$f" "$PUBLIC_ROOT/packages/server/src/"
done
# lib/ — all files
cp "$PRIVATE_ROOT/packages/server/src/lib/"*.ts "$PUBLIC_ROOT/packages/server/src/lib/"
# state/ — all files
cp "$PRIVATE_ROOT/packages/server/src/state/"*.ts "$PUBLIC_ROOT/packages/server/src/state/"
# adapters/ — Claude only + shared
for f in index.ts types.ts claude.ts; do
  cp "$PRIVATE_ROOT/packages/server/src/adapters/$f" "$PUBLIC_ROOT/packages/server/src/adapters/"
done
# routes/ — no analytics, coaching, push
for f in agents.ts events.ts transcript.ts snapshot.ts settings.ts hookConfig.ts permissions.ts network.ts; do
  cp "$PRIVATE_ROOT/packages/server/src/routes/$f" "$PUBLIC_ROOT/packages/server/src/routes/"
done
# services/ — no coaching, analytics, rules, push
for f in broadcaster.ts agentManager.ts eventIngestion.ts eventStore.ts fileEventRelay.ts \
         transcriptReader.ts transcriptScanner.ts transcriptCache.ts costService.ts \
         settingsService.ts hookConfigService.ts importService.ts providerNormalizer.ts; do
  [ -f "$PRIVATE_ROOT/packages/server/src/services/$f" ] && \
    cp "$PRIVATE_ROOT/packages/server/src/services/$f" "$PUBLIC_ROOT/packages/server/src/services/"
done

# ── packages/cli/ ──
mkdir -p "$PUBLIC_ROOT/packages/cli"/{bin,src,scripts}
cp "$PRIVATE_ROOT/packages/cli/package.json" "$PUBLIC_ROOT/packages/cli/"
cp "$PRIVATE_ROOT/packages/cli/tsconfig.json" "$PUBLIC_ROOT/packages/cli/"
cp "$PRIVATE_ROOT/packages/cli/README.md" "$PUBLIC_ROOT/packages/cli/"
cp "$PRIVATE_ROOT/packages/cli/bin/synapse.mjs" "$PUBLIC_ROOT/packages/cli/bin/"
cp "$PRIVATE_ROOT/packages/cli/src/"*.ts "$PUBLIC_ROOT/packages/cli/src/"
cp "$PRIVATE_ROOT/packages/cli/scripts/build.mjs" "$PUBLIC_ROOT/packages/cli/scripts/"

# ── apps/dashboard/ ──
# Copy everything, then delete excluded dirs
mkdir -p "$PUBLIC_ROOT/apps/dashboard"
cp -r "$PRIVATE_ROOT/apps/dashboard/src" "$PUBLIC_ROOT/apps/dashboard/"
cp -r "$PRIVATE_ROOT/apps/dashboard/public" "$PUBLIC_ROOT/apps/dashboard/" 2>/dev/null || true
for f in package.json tsconfig.json tsconfig.app.json tsconfig.node.json \
         vite.config.ts tailwind.config.ts postcss.config.js index.html; do
  [ -f "$PRIVATE_ROOT/apps/dashboard/$f" ] && cp "$PRIVATE_ROOT/apps/dashboard/$f" "$PUBLIC_ROOT/apps/dashboard/"
done

# Remove excluded dashboard directories/files
rm -rf "$PUBLIC_ROOT/apps/dashboard/src/components/analytics"
rm -f "$PUBLIC_ROOT/apps/dashboard/src/components/WorkshopModal.tsx"
rm -f "$PUBLIC_ROOT/apps/dashboard/src/components/mobile/RemoteDevChat.tsx"
rm -f "$PUBLIC_ROOT/apps/dashboard/src/components/mobile/MobileAnalyticsView.tsx"

echo ""
echo "=== Export complete. Now run Task 3 patches. ==="
```

- [ ] **Step 2: Make it executable**

```bash
chmod +x scripts/export-public.sh
```

- [ ] **Step 3: Commit to private repo**

```bash
git add scripts/export-public.sh
git commit -m "chore: add public repo export script"
```

---

### Task 3: Patch files that reference excluded code

After the export script copies files, several source files still `import` removed modules. These patches must be applied to the **public repo copy** after export.

**Files to patch** (all paths relative to public repo root):

- [ ] **Step 1: Patch `packages/core/src/index.ts` — remove coaching exports**

Delete lines 53–72 (the coaching type re-exports) and lines 96–99 (the coaching schema exports).

After patching, `index.ts` should NOT contain any reference to `coaching.ts`, `CoachingQuerySchema`, `CoachingMultiQuerySchema`, `PlaybookCreateSchema`, or `NudgeDismissSchema`.

- [ ] **Step 2: Patch `packages/core/src/schemas.ts` — remove coaching schemas**

Delete the `CoachingQuerySchema`, `CoachingMultiQuerySchema`, `PlaybookCreateSchema`, and `NudgeDismissSchema` exports. Keep all other schemas.

- [ ] **Step 3: Patch `packages/core/src/features.ts` — remove roadmap flags**

Replace the entire file with only the shipped flags:

```typescript
// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Bernhard

export const Features = {
  nodeGraph: true,
  lensTree: true,
  lensTreemap: true,
  lensCompaction: true,
  lensSankey: true,
  toolGrouping: true,
  guidedTour: true,
  snapshotExport: true,
  permissionCards: true,
  mobileView: true,
  cli: true,
} as const;

export type FeatureName = keyof typeof Features;
```

- [ ] **Step 4: Patch `packages/server/src/app.ts` — remove excluded route imports and registrations**

Remove these imports:
```
import { createAnalyticsRouter } from './routes/analytics.js';
import { createCoachingRouter } from './routes/coaching.js';
import { createPushRouter } from './routes/push.js';
```

Remove these route registrations:
```
app.use('/api/analytics', createAnalyticsRouter(broadcaster));
if (Features.coaching) app.use('/api/analytics/coaching', createCoachingRouter());
if (Features.pushNotifications) app.use('/api/push', createPushRouter());
```

- [ ] **Step 5: Patch `packages/server/src/db.ts` — remove coaching/badge tables**

Delete the SQL blocks for tables:
- `badges_earned` (lines ~257-268)
- `coaching_report_cards` (lines ~271-280)
- `coaching_nudges` (lines ~283-297)
- `coaching_playbooks` (lines ~300-313)
- `nudge_rule_config` (lines ~316-326)
- `ai_coaching_cache` (lines ~337-349)

Keep: `events`, `session_summary`, `analytics_daily`, `analytics_tool_daily`, `price_history`, `settings`, `transcript_index`, `permission_events`, `push_subscriptions`.

- [ ] **Step 6: Patch `packages/server/src/adapters/index.ts` — remove Gemini/Codex adapters**

Update the adapter registry to only export the Claude adapter. Remove imports/references to `gemini.ts` and `codex.ts`.

- [ ] **Step 7: Patch `apps/dashboard/src/App.tsx` — remove analytics import**

Remove the line:
```typescript
const AnalyticsPage = lazy(() => import('./components/analytics/AnalyticsPageLazy'));
```

Remove the `WorkshopModal` import. Remove any `view === 'analytics'` conditional rendering that references `AnalyticsPage`. Remove the `import { WorkshopModal }` line.

- [ ] **Step 8: Patch `packages/cli/scripts/build.mjs` — only copy Claude hook**

In the hook-copy step, change from copying `send_gemini_event.cjs` and `send_codex_event.cjs` to only copying `send_event.cjs` and `send_response.cjs`.

- [ ] **Step 9: Patch `packages/cli/package.json` — clean description and keywords**

Change description from "Works with Claude Code, Gemini CLI, and Codex CLI" to "Monitor Claude Code agents in real-time".

Remove `"gemini"` and `"codex"` from keywords array.

- [ ] **Step 10: Grep for any remaining references to removed modules**

```bash
cd synapse-public
grep -r "analytics\|coaching\|nudge\|badge\|playbook\|gemini\|codex\|openclaw\|WorkshopModal\|RemoteDevChat\|pushService" \
  --include="*.ts" --include="*.tsx" --include="*.mjs" \
  -l
```

Any hits need to be patched. False positives (comments, i18n keys) are OK. Real imports or function calls must be removed.

---

### Task 4: Write the public README.md

**Files:**
- Create: `README.md` (at public repo root)

- [ ] **Step 1: Write the README**

The README should cover:
- What Synapse is (one-liner + screenshot if available)
- Installation: `npx @synapse-ai/cli start`
- What it monitors (Claude Code sessions)
- Quick start (3 steps: install, run, open browser)
- Architecture overview (monorepo structure)
- Building from source (`pnpm install && pnpm build`)
- Link to npm package
- License (MIT)

Do NOT mention: analytics, coaching, prompt lab, Gemini, Codex, OpenClaw, VS Code extension.

---

### Task 5: Verify the public repo builds

**Files:** None (verification only)

- [ ] **Step 1: Install dependencies**

```bash
cd synapse-public
pnpm install
```

Expected: clean install, no missing workspace references.

- [ ] **Step 2: TypeScript type-check all packages**

```bash
pnpm -r exec tsc --noEmit
```

Expected: zero errors. If there are errors, they indicate a missed import patch from Task 3.

- [ ] **Step 3: Build the CLI (which bundles server + dashboard)**

```bash
cd packages/cli && pnpm run build
```

Expected: `dist/cli.mjs`, `dist/server.mjs`, `dist/hooks/send_event.cjs`, `dist/dashboard/` all created.

- [ ] **Step 4: Smoke test the CLI**

```bash
node bin/synapse.mjs start --no-open --no-hook &
sleep 3
curl http://localhost:27246/api/health
node bin/synapse.mjs stop
```

Expected: health endpoint returns `{ "ok": true, ... }`.

- [ ] **Step 5: Run tests**

```bash
cd ../.. && pnpm test
```

Note: Some tests may reference removed features. Fix or delete those test files. The goal is zero failures on the public repo.

---

### Task 6: Commit and push to public repo

**Files:** None (git operations)

- [ ] **Step 1: Stage and review**

```bash
cd synapse-public
git add -A
git status
git diff --cached --stat
```

Review the file list. Ensure no private files are staged. Look for:
- No `analytics`, `coaching`, `nudge`, `badge`, `playbook` source files
- No `gemini`, `codex` adapter files
- No `openclaw`, `vscode` directories
- No simulation scripts
- No internal docs

- [ ] **Step 2: Commit**

```bash
git commit -m "feat: initial public release — Synapse v0.1.0

Open-source release of the Synapse monitoring dashboard for Claude Code.
Includes: CLI, server, dashboard, core types, and Claude Code hook integration."
```

- [ ] **Step 3: Tag**

```bash
git tag -a v0.1.0 -m "Synapse v0.1.0 — first public release"
```

- [ ] **Step 4: Push**

```bash
git push origin main --tags
```

---

### Task 7: Post-release — update npm package.json

**Files:**
- Modify: `packages/cli/package.json` (in private repo)

- [ ] **Step 1: Verify the repository URL points to the public repo**

The `repository.url` in `packages/cli/package.json` should already be `https://github.com/Soarcer/synapse.git`. Verify this matches the actual public repo URL.

- [ ] **Step 2: Publish updated npm package if needed**

```bash
cd packages/cli
pnpm run build
npm publish --access public
```

---

## Future releases

To publish a new version:

```bash
# 1. Run the export
./scripts/export-public.sh /path/to/synapse-public

# 2. Apply patches (automate in a second script once stable)
# ... Task 3 patches ...

# 3. Verify
cd /path/to/synapse-public
pnpm install && pnpm -r exec tsc --noEmit && cd packages/cli && pnpm run build

# 4. Commit + push
git add -A && git commit -m "feat: v0.1.x updates" && git push
```

Consider automating Tasks 2–3 into a single `scripts/export-public.sh` that also applies the patches via `sed` or a Node script. Once it's stable, releases become a one-command operation.
