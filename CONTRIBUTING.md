# Contributing to Synapse

Welcome! We're glad you're interested in contributing to Synapse. Whether you're fixing a bug, adding a feature, improving docs, or just poking around — thank you.

Before you start, please read through this guide. It covers how to set up the project, our conventions, and the licensing model you should be aware of as a contributor.

For a high-level overview of what Synapse does, see the [README](README.md).

---

## Development Setup

### Prerequisites

- **Node.js** >= 20
- **pnpm** (install via `corepack enable` or `npm install -g pnpm`)

### Getting Started

```bash
git clone https://github.com/YOUR_USERNAME/synapse.git
cd synapse
pnpm install
```

### Running the Dev Servers

**Option A** — single command:

```bash
pnpm dev
```

**Option B** — two terminals (recommended on Windows):

```powershell
# Terminal 1 — Backend (port 4000)
.\start-server.ps1

# Terminal 2 — Frontend (port 5173)
.\start-client.ps1
```

Then open **http://localhost:5173** in your browser.

### Simulating Events

Don't have a live Claude Code session? Simulate one:

```bash
# Basic simulation (8 events)
npx tsx scripts/simulate_session.ts

# Comprehensive demo (31 events — every node type)
npx tsx scripts/simulate_all_nodes.ts
```

---

## Project Structure

Synapse is a **pnpm monorepo** with shared packages and application frontends:

```
Synapse/
├── packages/
│   ├── core/             # @synapse-ai/core — types, Zod schemas, format utilities
│   ├── server/           # @synapse-ai/server — Express 5 + SQLite + WebSocket backend
│   └── openclaw/         # @synapse-ai/openclaw — multi-vendor monitoring plugin
├── apps/
│   ├── dashboard/        # React 19 + React Flow v12 frontend
│   └── vscode/           # VS Code extension (embedded dashboard)
├── hooks/                # Claude Code hook scripts (plain Node.js, no dependencies)
├── ee/                   # Enterprise features (separate license — see below)
├── scripts/              # Build, simulation, and utility scripts
└── docs/                 # Architecture and planning docs
```

Cross-package imports use `@synapse-ai/core` — never relative paths between packages.

---

## Making Changes

1. **Branch from `main`** — create a feature or fix branch (e.g., `feat/mcp-badges`, `fix/ws-reconnect`).
2. **Use conventional commits** — prefix your commit messages:
   - `feat:` — new functionality
   - `fix:` — bug fix
   - `docs:` — documentation only
   - `refactor:` — code restructuring without behavior change
   - `test:` — adding or updating tests
   - `chore:` — tooling, CI, dependencies
3. **Open a PR against `main`** — describe what changed and why.
4. **Keep PRs focused** — one logical change per PR. Smaller PRs get reviewed faster.

---

## Developer Certificate of Origin (DCO)

We use the **Developer Certificate of Origin** instead of a Contributor License Agreement (CLA). This means every commit you contribute must include a `Signed-off-by` line certifying that you wrote the code (or have the right to submit it).

### How to sign off

Add `-s` to your commit command:

```bash
git commit -s -m "feat: add MCP tool badges"
```

This appends a line like:

```
Signed-off-by: Your Name <your.email@example.com>
```

### Why DCO instead of CLA?

- **Trust** — you retain copyright over your contributions
- **No relicensing risk** — DCO prevents the project from being relicensed without contributor consent
- **Lower friction** — no legal forms to sign, no corporate approval workflow

### The DCO v1.1 Text

```
Developer Certificate of Origin
Version 1.1

Copyright (C) 2004, 2006 The Linux Foundation and its contributors.

Everyone is permitted to copy and distribute verbatim copies of this
license document, but changing it is not allowed.


Developer's Certificate of Origin 1.1

By making a contribution to this project, I certify that:

(a) The contribution was created in whole or in part by me and I
    have the right to submit it under the open source license
    indicated in the file; or

(b) The contribution is based upon previous work that, to the best
    of my knowledge, is covered under an appropriate open source
    license and I have the right under that license to submit that
    work with modifications, whether created in whole or in part
    by me, under the same open source license (unless I am
    permitted to submit under a different license), as indicated
    in the file; or

(c) The contribution was provided directly to me by some other
    person who certified (a), (b) or (c) and I have not modified
    it.

(d) I understand and agree that this project and the contribution
    are public and that a record of the contribution (including all
    personal information I submit with it, including my sign-off) is
    maintained indefinitely and may be redistributed consistent with
    this project or the open source license(s) involved.
```

---

## The `/ee` Boundary

Synapse uses an **open-core model**:

- **Everything outside `/ee`** is licensed under **AGPL-3.0** — free to use, modify, and distribute under the same license.
- **The `/ee` directory** is under the **Synapse Enterprise License** — free to view and evaluate, but production use requires a subscription.

Contributions to either area are welcome. Just understand which license applies to the code you're touching:

| Directory | License | Can I contribute? |
|-----------|---------|-------------------|
| Everything except `/ee` | AGPL-3.0 | Yes |
| `/ee/*` | Synapse Enterprise License | Yes |

If your contribution spans both areas, note that in your PR description.

---

## Code Style

- **TypeScript strict mode** throughout the entire codebase
- **No `any` types** — use `unknown` and narrow with type guards
- **Zod** for runtime validation at system boundaries (API inputs, WebSocket messages)
- **`pino`** for server logging — never `console.log` in backend code
- **ESLint + Prettier** are pre-configured — run `pnpm lint` to check

### Zustand Gotcha

Never use `?? []` inside Zustand selectors — it creates a new array reference on every render and causes infinite re-renders. Instead:

```typescript
// Bad — infinite re-renders
const items = useStore(s => s.items ?? []);

// Good — stable reference
const EMPTY: Item[] = [];
const items = useStore(s => s.items ?? EMPTY);
```

---

## Testing

```bash
pnpm test          # Run all tests across all packages
pnpm test --watch  # Watch mode (useful during development)
```

- Tests use **Vitest** with colocated `__tests__/` directories next to source files
- 2,000+ existing tests across the monorepo
- Please add tests for new features and bug fixes

---

## Reporting Issues

Use **GitHub Issues**. When filing a bug report, please include:

1. **What you expected** to happen
2. **What actually happened** (include error messages, screenshots, or logs)
3. **Steps to reproduce** the issue
4. **Environment** — OS, Node.js version, browser (if frontend)

Feature requests are also welcome as issues — describe the use case and why it would be valuable.

---

## Code of Conduct

This project follows the [Contributor Covenant Code of Conduct](CODE_OF_CONDUCT.md). By participating, you agree to uphold its standards. Please report unacceptable behavior to synapse-conduct@example.com.
