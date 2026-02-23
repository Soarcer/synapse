# Open-Source Release Preparation

> Status: In progress | Started: 2026-02-20 | Branch: main

## Goal

Prepare Synapse for open-source release using an AGPL-3.0 open-core model with a proprietary `/ee` directory for future enterprise features.

## Background

Full strategy documented in [2026-02-19-open-source-monetization-strategy.md](2026-02-19-open-source-monetization-strategy.md). This plan covers the "Immediate (Before Public Release)" steps from Section 12.

---

## Completed

### 1. License header script

- **File**: `scripts/add-license-headers.mjs`
- Walks `packages/core/src/`, `packages/server/src/`, `packages/openclaw/src/`, `apps/dashboard/src/`, `apps/vscode/src/`, `hooks/send_event.cjs`
- Prepends 2-line SPDX header (`AGPL-3.0-only` for core, `LicenseRef-Synapse-Enterprise` for `/ee`)
- Handles shebangs (inserts after `#!` line)
- Dry-run by default, `--write` to apply
- **Result**: 233 files received headers

### 2. Root LICENSE → AGPL-3.0

- **File**: `LICENSE` (677 lines)
- Full GNU AGPL v3.0 text downloaded from gnu.org
- Copyright notice appended: `Copyright 2026 Synapse Contributors`

### 3. Enterprise `/ee` directory

- **Files**: `ee/LICENSE`, `ee/README.md`, `ee/packages/` (empty)
- `ee/LICENSE`: Synapse Enterprise License v1.0 — view/eval free, production requires subscription
- `ee/README.md`: Explains the boundary, lists planned enterprise features, contribution terms

### 4. Package.json license fields

- All 6 `package.json` files have `"license": "AGPL-3.0-only"`:
  - `package.json` (root)
  - `packages/core/package.json`
  - `packages/server/package.json`
  - `packages/openclaw/package.json`
  - `apps/dashboard/package.json`
  - `apps/vscode/package.json` (changed from `"MIT"`)

### 5. SPDX headers on all source files

- 233 `.ts`, `.tsx`, `.cjs`, `.mjs` files across all packages
- Each has: `// SPDX-License-Identifier: AGPL-3.0-only` + `// Copyright (c) 2026 Synapse Contributors`

---

## Remaining

### 6. CODE_OF_CONDUCT.md

- **Standard**: Contributor Covenant v2.1 (used by >200K projects)
- **Source**: https://www.contributor-covenant.org/version/2/1/code_of_conduct/
- Fill in contact email placeholder

### 7. CONTRIBUTING.md

- **Pattern**: Cal.com / PostHog / Grafana style
- **Sections needed**:
  1. Welcome — brief intro, link to README
  2. Development Setup — prerequisites (Node 20+, pnpm), clone, `pnpm install`, run dev servers (`start-server.ps1` + `start-client.ps1` or `pnpm dev`)
  3. Project Structure — pnpm monorepo: `packages/core`, `packages/server`, `packages/openclaw`, `apps/dashboard`, `apps/vscode`, `hooks/`, `ee/`
  4. Making Changes — branch from `main`, conventional commits, PR against `main`
  5. Developer Certificate of Origin (DCO) — use `git commit -s`, explain why DCO over CLA (trust, no relicensing risk). Include full DCO v1.1 text.
  6. The `/ee` Boundary — `/ee` is Synapse Enterprise License (not AGPL). Contributions welcome but under enterprise license. Core (`packages/`, `apps/`, `hooks/`) is AGPL.
  7. Code Style — TypeScript strict, no `any` (use `unknown`), Zod at boundaries, `pino` for logging, Zustand gotcha (`?? []` in selectors causes re-renders), ESLint + Prettier
  8. Testing — `pnpm test` runs Vitest, test files colocated in `__tests__/` directories
  9. Reporting Issues — GitHub Issues, reproduction steps
  10. Code of Conduct — link to CODE_OF_CONDUCT.md

### 8. GOVERNANCE.md

- **Pattern**: Node.js / Cal.com style
- **Sections needed**:
  1. Overview — Synapse maintained by [author], AGPL-3.0 core
  2. Decision Making — single maintainer, lazy consensus as community grows
  3. Roles — Maintainer, Contributor (PRs reviewed), Community (issues/discussions)
  4. Commercial Relationship — transparent: enterprise features in `/ee` under separate license. Core will never be relicensed or made proprietary. Free tier is a complete product for individual developers.
  5. Roadmap — link to `docs/ROADMAP.md`, community input via GitHub Discussions
  6. Code of Conduct — link to CODE_OF_CONDUCT.md

### 9. Update README.md

- **Current state**: References Apache 2.0, shows old project structure (`server/`, `src/` instead of monorepo paths), contributing section is inline instead of linking to CONTRIBUTING.md
- **Changes needed**:
  - `## License` section → reference AGPL-3.0, mention `/ee` boundary briefly
  - `## Contributing` section → link to CONTRIBUTING.md
  - `## Project Structure` → update to reflect monorepo (`packages/`, `apps/`, `ee/`)
  - Bottom footer → remove "Licensed under Apache License 2.0"
  - Add brief one-liner about enterprise tier (non-intrusive)
  - Tech Stack table → `better-sqlite3` → `sql.js`, add `pnpm` mention
  - Known Limitations → update "No test coverage" (we now have 2,000+ tests)

### 10. Verification

- `pnpm lint` — ensure SPDX headers don't break linting
- `pnpm typecheck` — ensure nothing broke
- `pnpm test` — full test suite
- Spot-check 5-10 files for correct headers
- Verify `ee/LICENSE` and root `LICENSE` are distinct

---

## Key Conventions (from CLAUDE.md)

- All shared types in `@synapse-ai/core` — never relative paths between packages
- Hook scripts are plain Node.js (no dependencies)
- Zod for validation at system boundaries
- No `any` types — use `unknown`
- `pino` for server logging
- Express 5 `req.params.id` returns `string | string[]` — cast to `string`
- Zustand: `?? []` inside selectors causes infinite re-renders, use module-level `const EMPTY: T[] = []`
