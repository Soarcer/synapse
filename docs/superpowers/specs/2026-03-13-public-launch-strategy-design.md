# Public Launch Strategy — Design Spec

**Date:** 2026-03-13
**Author:** Bernhard (with Claude)
**Status:** Approved
**Supplements:** [ship-v0.1.0-design.md](2026-03-11-ship-v0.1.0-design.md) (technical ship spec)

## Context

This spec covers decisions made during a strategic review of Synapse's positioning, feature scope, and public launch approach. It supplements the existing ship-v0.1.0 spec with scope cuts, feature gating architecture, community infrastructure, and repo strategy.

## Strategic Positioning

**What Synapse is:** A real-time visualization dashboard for Claude Code agent sessions. Watch your AI agent work in an interactive node graph.

**What Synapse is NOT:** A competing agent control plane, cost optimizer, learning tool, or policy enforcement engine. These are things Anthropic, GitHub, and others are building natively.

**Core value:** Making the invisible visible. Claude Code works in a text terminal — Synapse shows the topology, timing, and structure of what's really happening.

**Differentiators (things nobody else does):**

- Real-time React Flow node graph of agent sessions
- 5 lens views (treemap, compaction, cost waterfall, sankey, tree)
- Tool grouping with 3 visualization modes
- Mobile PWA with responsive layout
- Export/import session snapshots for sharing

## V1 Feature Set

### Ships

- Real-time node graph (5 node types, animated edges, cost gradient)
- 5 lens views: treemap, compaction, cost waterfall, sankey, tree
- Tool grouping (pill grid, timeline, heatmap-within-group)
- Node detail panel (click any node → full detail)
- Session selector + time filter
- Graph search, keyboard shortcuts
- Export/import snapshots (share sessions)
- Mobile PWA (auto-detected, bottom tabs)
- VS Code extension (already on marketplace)
- CLI (`npx @synapse-ai/cli start/stop/status/hook`)
- Permission cards (remote approve/deny from dashboard)
- Guided tour (first-time visitors)
- Simulation scripts (try without Claude Code)

### Cut from V1 (code exists, doesn't ship)

| Feature                          | Reason                                                                   |
| -------------------------------- | ------------------------------------------------------------------------ |
| Heatmap lens                     | Low value — other lenses cover the data better                           |
| Coaching / nudges / report cards | Nice-to-have, not core. "Makes me smile but wouldn't change how I work." |
| Prompt Lab / Workshop            | Separate product idea, confuses v1 story                                 |
| Analytics deep tabs              | Lenses already show analytics on the graph                               |
| Cost display mode toggle         | Subscription users don't care about cost breakdown                       |
| Remote dev chat                  | Anthropic shipped Remote Control (free, all paid plans)                  |
| Push notifications               | Complex setup (HTTPS, VAPID), Anthropic covers this natively now         |
| Spawn Agent dialog               | Already deferred to v0.2.0, needs conversation model                     |
| Multi-vendor adapters            | Not battle-tested, roadmap item                                          |

## Feature Gate System

### Architecture: Compile-Time Elimination

Single source of truth in `packages/core/src/features.ts`. Vite tree-shakes disabled features at build time — zero bytes in the production bundle.

```typescript
export const Features = {
  // v0.1.0 — ships
  nodeGraph: true,
  lensTreemap: true,
  lensCompaction: true,
  lensCostWaterfall: true,
  lensSankey: true,
  lensTree: true,
  toolGrouping: true,
  guidedTour: true,
  snapshotExport: true,
  permissionCards: true,
  mobileView: true,
  cli: true,

  // roadmap — code exists, doesn't ship
  lensHeatmap: false,
  coaching: false,
  promptLab: false,
  analyticsDeep: false,
  costDisplayMode: false,
  remoteDevChat: false,
  pushNotifications: false,
  spawnAgent: false,
  multiVendor: false,
} as const;

export type FeatureName = keyof typeof Features;
```

### Integration Pattern

**Components:**

```tsx
import { Features } from '@synapse-ai/core/features';
{
  Features.lensHeatmap && <Tab label="Heatmap" />;
}
```

**Lazy-loaded chunks (dead import elimination):**

```tsx
const CoachingPanel = lazy(() => import('./coaching/PlaybookPanel'));
{
  Features.coaching && (
    <Suspense>
      <CoachingPanel />
    </Suspense>
  );
}
```

**Keyboard shortcuts:**

```typescript
if (Features.promptLab && e.key === 'w') { ... }
```

**Server routes:**

```typescript
if (Features.coaching) app.use('/api/analytics/coaching', coachingRouter);
```

**Why `as const`:** Literal `true`/`false` values (not `boolean`) let Vite prove branches are unreachable and eliminate them entirely. Runtime boolean variables wouldn't get this treatment.

### Integration Points (files to modify)

| Location                    | What to gate                                       |
| --------------------------- | -------------------------------------------------- |
| `App.tsx` keyboard handlers | W (promptLab), $ (costDisplayMode), N (spawnAgent) |
| `LensTabBar.tsx` tab list   | Filter through Features.lensHeatmap                |
| `MobileTabBar.tsx` Dev tab  | Features.remoteDevChat                             |
| `NudgeBadge` in graph       | Features.coaching                                  |
| Push setup in settings      | Features.pushNotifications                         |
| Analytics deep tabs         | Features.analyticsDeep                             |
| Server route registration   | coaching, push routes                              |

## Repo Strategy

### Approach: Public Repo with Private Local Space

**Public repo:** `github.com/soarcer/synapse`

- All source code (including disabled features — visible in code, absent from builds)
- Issues, discussions, PRs, CI/CD
- README, CONTRIBUTING.md, LICENSE (MIT)

**Private (local only, never pushed):**

- Experiment branches
- `.claude/` project memory
- `.env`, VAPID keys, certificates
- `synapse.db`, `.vsix` artifacts

### Workflow

```
Develop locally → push to public when ready
Feature branches → PR to main → merge
Experiments → local branches, never pushed
Release → tag v0.1.0 → CI publishes
```

### Branch Protection (day 1)

- Require CI to pass before merge
- No force pushes to main

## Domains

- `soarcer.dev` — personal brand (purchased)
- `usesynapse.dev` — project domain (purchased, redirects to GitHub repo)

## Community Infrastructure

### Launch Day (this weekend)

| What               | How                                         | Effort        |
| ------------------ | ------------------------------------------- | ------------- |
| GitHub Issues      | Two templates: Bug Report + Feature Request | 15 min        |
| CONTRIBUTING.md    | Already exists, update AGPL→MIT references  | Per ship spec |
| GitHub Discussions | Enable "Ideas" category = votable roadmap   | 5 min         |
| README with GIF    | 20-second GIF of graph in action            | 30 min        |

### Wait Until People Ask

| What                | Trigger                                     |
| ------------------- | ------------------------------------------- |
| Discord             | 50+ stars or explicit community request     |
| Docs site           | People ask "where are the docs?"            |
| Public roadmap page | Discussions "Ideas" category is the roadmap |
| FAQ / Help page     | After first 10 issues reveal real questions |
| Changelog tooling   | When doing regular releases                 |
| Code of Conduct     | First PR from a stranger                    |

### Roadmap (seeded as GitHub Discussions)

**Near-term (community validates):**

- Multi-vendor support (Gemini CLI, Codex CLI, Cursor)
- Push notifications (mobile alerts)
- Remote dev chat
- Coaching nudges
- Prompt Lab
- Session comparison

**Longer-term:**

- Cross-session intelligence
- Team mode
- OTel export

## How Contributions Work

- Forks: full copy under contributor's account, invisible to you until PR
- PRs: contributor pushes branch on fork, opens PR against your main
- CI runs automatically on PRs
- You review, comment, approve/reject, merge (squash merge for clean history)
- Nobody can push directly to your repo (only you have write access)

## Success Criteria

1. Public repo at `github.com/soarcer/synapse` with clean code
2. `usesynapse.dev` redirects to repo
3. README with GIF sells the project in 10 seconds
4. `pnpm dev` + simulation script works flawlessly from clean clone
5. VS Code extension install → configure hooks → see graph flow works end-to-end
6. All tests pass, disabled features produce zero bundle bytes
7. Posted on r/ClaudeAI with engagement
