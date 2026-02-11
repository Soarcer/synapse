# Synapse — Interactive Agent Orchestration Dashboard

## What This Project Is

A visual node-based dashboard that monitors, visualizes, and controls Claude agents in real-time. It combines two data sources:

1. **Claude Code Hooks** — observe existing Claude Code sessions (subagent spawning, tool calls, session lifecycle)
2. **Claude Agent SDK** — programmatically spawn, control, and stream custom agents

The frontend uses React Flow for an interactive node graph. The backend uses Express + SQLite + WebSocket.

## Tech Stack

- **Frontend**: React 19, @xyflow/react v12, Zustand 5, Tailwind CSS 4, Vite 6
- **Backend**: Node.js, Express 5, ws 8, better-sqlite3, tsx
- **Agent SDK**: @anthropic-ai/claude-agent-sdk (TypeScript)
- **Monorepo**: pnpm workspaces, @synapse-ai npm scope
- **Language**: TypeScript throughout

## Project Structure (pnpm monorepo)

```
Synapse/
├── pnpm-workspace.yaml
├── tsconfig.base.json
├── packages/
│   ├── core/           # @synapse-ai/core — types, Zod schemas, format utils
│   ├── server/         # @synapse-ai/server — Express + SQLite + WebSocket
│   └── openclaw/       # @synapse-ai/openclaw — OpenClaw monitoring plugin
├── apps/
│   ├── dashboard/      # React frontend (not published)
│   └── vscode/         # @synapse-ai/vscode — VS Code extension
├── hooks/              # Claude Code hook scripts (send_event.cjs)
├── scripts/            # Build and simulation scripts
├── docs/               # Architecture docs
└── .claude/            # Hook configuration
```

## Quick Start

Open two PowerShell terminals:

```powershell
# Terminal 1 — Backend (port 4000)
.\start-server.ps1

# Terminal 2 — Frontend (port 5173)
.\start-client.ps1
```

Then open **http://localhost:5173** in your browser.

Any Claude Code session running in this project will automatically send hook events to the dashboard via `.claude/settings.json` → `hooks/send_event.cjs` → `POST localhost:4000/api/events`.

To test without a live session, run the simulation script:

```powershell
npx tsx scripts/simulate_session.ts
```

Stop either server with **Ctrl+C** in its terminal.

## Key Commands

- `.\start-server.ps1` — start backend (port 4000)
- `.\start-client.ps1` — start frontend (port 5173)
- `pnpm dev` — start both concurrently
- `pnpm -r build` — build all packages
- `pnpm test` — run all tests
- `npx tsx scripts/simulate_session.ts` — simulate a full session with 8 events

## Keyboard Shortcuts

| Key     | Action                        |
|---------|-------------------------------|
| **T**     | Toggle tool log panel         |
| **N**     | Open spawn agent dialog       |
| **Space** | Pause/resume live updates     |
| **Escape**| Close panels and dialogs      |
| **L**     | Toggle layout mode (graph/list)|
| **H**     | Toggle hook event visibility  |

## Architecture Docs

See `docs/ARCHITECTURE.md` for the full system design, data flows, type definitions, and node specifications.
See `docs/RESEARCH.md` for research on Claude 4.6 features, hooks API, Agent SDK streaming, and reference projects.
See `docs/DEPLOYMENT.md` for minimal packaging and deployment steps.
See `docs/PACKAGE.md` for the per-project package checklist.

## Conventions

- All shared types live in `@synapse-ai/core` (packages/core/) — imported by all other packages
- Use `@synapse-ai/core` for cross-package imports, never relative paths between packages
- Hook scripts are plain Node.js (no dependencies) — they read stdin JSON and POST to localhost:4000
- WebSocket messages use the `AgentEvent` type from `@synapse-ai/core`
- React Flow nodes use custom components in `apps/dashboard/src/components/graph/nodes/`
- Backend API routes are prefixed with `/api/`
- The SQLite database file is stored at `packages/server/synapse.db` (gitignored)
- Zod for runtime validation at system boundaries (API inputs, WS messages)
- No `any` types — use `unknown` and narrow with type guards
- `pino` for server logging (not console.log)
- Express 5 `req.params.id` returns `string | string[]` — cast to `string`
- Zustand gotcha: `?? []` inside selectors causes infinite re-renders. Use module-level `const EMPTY: T[] = []`
