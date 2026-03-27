# Session: Launch Strategy & Checklist — 2026-03-13

## What We Accomplished

- Researched VS Code agent-scoped hooks (8 lifecycle events, differences from Claude Code hooks)
- Wrote comprehensive research doc: `docs/superpowers/specs/2026-03-13-vscode-agent-scoped-hooks-research.md`
- Strategic competitive analysis — identified what Anthropic ships natively vs what Synapse uniquely offers
- Identified Synapse's true differentiator: real-time visualization (not agent control, cost optimization, or learning)
- Made V1 scope decisions: ships vs cuts (9 features cut from V1, code preserved via feature gates)
- Designed compile-time feature gate system (`as const` + Vite tree-shaking)
- Wrote public launch strategy spec: `docs/superpowers/specs/2026-03-13-public-launch-strategy-design.md`
- Built interactive launch checklist: `docs/launch-checklist.html` with:
  - 10 tabbed sections, ~60 items with smart numbering (BF1, FG3, VA2, etc.)
  - localStorage persistence, progress tracking, sub-item checklists
  - Font size toggle (S/M/L), expand/collapse all, export, filter by role/status
  - Sticky header with section tabs wrapping into two rows
- Resolved domain decisions: soarcer.dev (purchased), usesynapse.dev (purchased)
- Resolved repo strategy: public repo with private local space (Approach C)
- Resolved npm scope: @synapse-ai org on npm ready for publishing
- Drafted Reddit posts (short + medium versions)

## Key Decisions & Reasoning

- **Cut heatmap, coaching, prompt lab, analytics deep tabs, cost display mode, remote dev chat, push notifications, spawn agent from V1** — Anthropic ships most of these natively; Synapse's value is visualization, not agent control
- **Feature gate via `as const` not runtime flags** — Vite can prove branches unreachable and eliminate dead code at build time (zero bundle bytes for disabled features)
- **Public repo, not private** — open source from day one, experiments on local branches only
- **MIT license** — simpler than AGPL, better for adoption
- **No Discord/docs site at launch** — wait until people ask (50+ stars or explicit requests)
- **GitHub Discussions as roadmap** — "Ideas" category with seeded roadmap items

## What's Complete

- Launch checklist HTML tool (fully functional, all items populated)
- Research docs (VS Code hooks, public launch strategy)
- Reddit post drafts
- Domain purchases (soarcer.dev, usesynapse.dev)
- npm org setup (@synapse-ai)
- README rewrite, CONTRIBUTING.md, CODE_OF_CONDUCT.md, CI/CD workflows, .gitignore

## What Remains

The entire checklist needs execution. Priority order:

1. **Bug fixes (BF1-BF6)** — 4 blockers: zoom, permission card, CLI build, failing tests
2. **Feature gating (FG1-FG10)** — create features.ts, gate all 9 cut features, verify bundle
3. **Repo cleanup (RC1-RC11)** — license swap, SPDX headers, version normalize, remove /ee, clean working tree
4. **Visual assets (VA1-VA9)** — hero GIF, screenshots, social preview
5. **GitHub setup (GH1-GH12)** — create repo, push, secrets, branch protection, npm publish
6. **Smoke test (ST1-ST3)** — fresh clone, VS Code, mobile
7. **Launch (LP1-LP9)** — Reddit, HN, Product Hunt, Twitter

## Blockers & Open Questions

- Graph zoom regression (BF1) — root cause unknown, likely in useAutoLayout.ts or React Flow props
- Permission card serialization (BF2) — root cause known (double serialization), fix identified
- CLI build failure (BF3) — root cause known (readPort import mismatch), fix identified
- 10 failing tests (BF4) — 7 will auto-fix after BF2, 3 need feature gate skips

## What We Tried That Didn't Work

- Considered making Synapse a learning tool / coaching platform — honest assessment showed this doesn't match what the user actually values
- Considered private repo with public releases — rejected for complexity and community friction
- Considered new GitHub org — rejected, using existing soarcer account
- synapse-ai.sh domain at $45 — rejected as overpriced for a redirect

## Files Changed This Session

- `docs/launch-checklist.html` — created (interactive launch runbook)
- `docs/superpowers/specs/2026-03-13-vscode-agent-scoped-hooks-research.md` — created
- `docs/superpowers/specs/2026-03-13-public-launch-strategy-design.md` — created
- Memory files updated (feedback_smart_numbering.md, MEMORY.md)

## Trade-offs Made

- **Cutting features users might want** — accepted smaller V1 scope for faster launch and cleaner story
- **Leaving code in repo but gated** — accepted visible-but-disabled code over separate branches for simplicity
- **No docs site at launch** — accepted "README + how-it-works.html" as sufficient for V1
