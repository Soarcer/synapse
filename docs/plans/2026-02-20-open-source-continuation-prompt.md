# Continuation Prompt — Open-Source Release Prep

Copy everything below the line into a new Claude session.

---

## Context

I'm preparing Synapse (an AI agent monitoring dashboard) for open-source release. We're using an AGPL-3.0 open-core model with a proprietary `/ee` directory for future enterprise features.

**What's already done** (don't redo these):

- `LICENSE` — replaced with full AGPL-3.0 text (677 lines + copyright notice)
- `ee/LICENSE` + `ee/README.md` — enterprise license and directory created
- `scripts/add-license-headers.mjs` — wrote and ran it; 233 source files now have SPDX headers (`// SPDX-License-Identifier: AGPL-3.0-only` + `// Copyright (c) 2026 Synapse Contributors`)
- All 6 `package.json` files have `"license": "AGPL-3.0-only"` (root, core, server, openclaw, dashboard, vscode)

**What remains** — please implement these 5 items:

### 1. Create `CODE_OF_CONDUCT.md` (root)

Use the **Contributor Covenant v2.1** standard text from https://www.contributor-covenant.org/version/2/1/code_of_conduct/. Use `synapse-conduct@example.com` as the contact email placeholder. This is the standard used by >200K projects (Linux, Kubernetes, React, Rails).

### 2. Create `CONTRIBUTING.md` (root)

Follow the Cal.com / PostHog / Grafana open-core pattern. Include these sections:

1. **Welcome** — brief intro, link to README
2. **Development Setup** — prerequisites: Node.js >= 20, pnpm. Steps: clone, `pnpm install`, run `pnpm dev` (or `.\start-server.ps1` + `.\start-client.ps1` in two terminals). Frontend on port 5173, backend on port 4000. Simulation: `npx tsx scripts/simulate_session.ts`
3. **Project Structure** — pnpm monorepo with `packages/core` (types/schemas), `packages/server` (Express+SQLite+WS), `packages/openclaw` (multi-vendor plugin), `apps/dashboard` (React frontend), `apps/vscode` (VS Code extension), `hooks/` (Claude Code hook scripts), `ee/` (enterprise features, separate license)
4. **Making Changes** — branch from `main`, use conventional commits (`feat:`, `fix:`, `docs:`, `refactor:`, `test:`), open PR against `main`, keep PRs focused
5. **Developer Certificate of Origin (DCO)** — we use DCO instead of CLA. All commits must include `Signed-off-by` line via `git commit -s`. Include the full DCO v1.1 text (same as Linux kernel). Explain why DCO: trust, no relicensing risk, lower friction than CLA.
6. **The `/ee` Boundary** — everything outside `/ee` is AGPL-3.0. The `/ee` directory is under the Synapse Enterprise License (view/eval free, production requires subscription). Contributions to either area are welcome — just understand which license applies to which directory.
7. **Code Style** — TypeScript strict mode, no `any` (use `unknown` + type guards), Zod for validation at system boundaries, `pino` for server logging (not console.log), ESLint + Prettier pre-configured. Zustand gotcha: never use `?? []` inside selectors (causes infinite re-renders) — use module-level `const EMPTY: T[] = []` instead.
8. **Testing** — `pnpm test` runs Vitest across all packages. Test files in `__tests__/` directories colocated with source. 2,000+ existing tests.
9. **Reporting Issues** — GitHub Issues, include reproduction steps, expected vs actual behavior
10. **Code of Conduct** — link to CODE_OF_CONDUCT.md

### 3. Create `GOVERNANCE.md` (root)

Follow the Node.js / Cal.com pattern. Sections:

1. **Overview** — Synapse is an open-source agent monitoring dashboard maintained by its creator. Core is AGPL-3.0.
2. **Decision Making** — Currently single-maintainer. As community grows, adopt lazy consensus for non-controversial changes. Maintainer has final say on architecture and roadmap.
3. **Roles** — Maintainer (full commit access, release authority), Contributor (submit PRs, reviewed by maintainer), Community (issues, discussions, bug reports)
4. **Commercial Relationship** — Be transparent: Synapse has enterprise features in `/ee` under a separate license. The open-source core will **never** be relicensed or made proprietary. The free tier is a complete, standalone product for individual developers. Enterprise features are additive, not restrictive.
5. **Roadmap** — link to `docs/ROADMAP.md`. Community input welcome via GitHub Discussions. Feature requests can be filed as issues.
6. **Code of Conduct** — link to CODE_OF_CONDUCT.md

### 4. Update `README.md` (root)

The README currently has stale content. Make these targeted edits (don't rewrite the whole file — the tone is good):

- **`## License` section** (near bottom): Change from Apache 2.0 reference to:

  ```
  The core of Synapse is licensed under the [GNU Affero General Public License v3.0](LICENSE).

  Enterprise features in the [`/ee`](ee/) directory are licensed under the [Synapse Enterprise License](ee/LICENSE).

  See [GOVERNANCE.md](GOVERNANCE.md) for our commitment to keeping the open-source core complete and free.
  ```

- **`## Contributing` section**: Replace the inline contributing text with a link to CONTRIBUTING.md:

  ```
  We welcome contributions! See [CONTRIBUTING.md](CONTRIBUTING.md) for development setup, code style, and how to submit pull requests.

  All contributions require a [Developer Certificate of Origin](https://developercertificate.org/) sign-off. See the contributing guide for details.
  ```

- **`## Project Structure`**: Update to show monorepo layout:

  ```
  Synapse/
  ├── packages/
  │   ├── core/             # @synapse-ai/core — types, schemas, utilities
  │   ├── server/           # @synapse-ai/server — Express + SQLite + WebSocket
  │   └── openclaw/         # @synapse-ai/openclaw — multi-vendor monitoring plugin
  ├── apps/
  │   ├── dashboard/        # React 19 + React Flow v12 frontend
  │   └── vscode/           # VS Code extension (embedded dashboard)
  ├── hooks/                # Claude Code hook scripts
  ├── ee/                   # Enterprise features (separate license)
  ├── scripts/              # Build, simulation, and utility scripts
  └── docs/                 # Architecture and planning docs
  ```

- **`## Tech Stack` table**: Change `better-sqlite3` → `sql.js (pure JS SQLite)`. Add `pnpm workspaces` as the monorepo tool.

- **`## Known Limitations`**: Update the "No test coverage" bullet — we now have 2,000+ tests across 15 test files. Change to something like: "**Test coverage is growing** — 2,000+ tests and counting, but some areas still need coverage."

- **Bottom footer**: Change `Licensed under the [Apache License 2.0](LICENSE).` to `Licensed under [AGPL-3.0](LICENSE). Enterprise features under [Synapse Enterprise License](ee/LICENSE).`

### 5. Verification

After all files are created, run:

- `pnpm lint` — ensure SPDX headers don't break linting
- `pnpm typecheck` — ensure nothing broke
- `pnpm test` — full test suite should pass
- Spot-check 5-10 source files to confirm they have the 2-line SPDX header on lines 1-2
- Verify `ee/LICENSE` and root `LICENSE` exist and are distinct files

## Key Project Conventions (from CLAUDE.md)

- Monorepo: `packages/` for shared code, `apps/` for frontends/extensions
- `@synapse-ai/core` for cross-package imports, never relative paths between packages
- Hook scripts are plain Node.js (no dependencies)
- Zod for runtime validation at system boundaries
- No `any` types — use `unknown` and narrow with type guards
- `pino` for server logging (not console.log)
- Zustand: `?? []` inside selectors causes infinite re-renders — use module-level `const EMPTY: T[] = []`
