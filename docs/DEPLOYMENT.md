# Deployment & Minimal Packaging (Per-Project)

This doc describes the **minimal file sets**, **configuration variables**, and **deployment steps** to run Synapse per project, including on a brand-new machine.

---

## Minimal File Sets

### Source-run (dev: Vite + tsx)
Keep only these files/folders:

- package.json
- vite.config.ts
- tsconfig.json
- tsconfig.server.json
- index.html
- src/
- server/
- hooks/send_event.cjs
- .claude/settings.json **or** .claude/settings.local.json

Optional helpers:
- start-client.ps1 / start-client.sh
- start-server.ps1 / start-server.sh

### Prebuilt (frontend built, server still tsx)
Keep only:

- dist/  (from `npm run build`)
- server/
- package.json
- hooks/send_event.cjs
- .claude/settings.json **or** .claude/settings.local.json

> Note: The server is TypeScript and currently runs via `tsx`. If you want a fully compiled server, add a server build step later.

---

## Configuration Variables & Defaults

### Implemented today

- **PORT** (server): default `4000`
  - Source: server/index.ts
- **SYNAPSE_URL** (hook target): default `http://localhost:4000/api/events`
  - Source: hooks/send_event.cjs

- **Vite dev server port**: `5173` (default, overridable)
  - Source: vite.config.ts
- **Vite dev proxy** (defaults, overridable):
  - `/api -> http://localhost:4000`
  - `/ws -> ws://localhost:4000`
  - Source: vite.config.ts
- **WS client dev URL**: `ws://<hostname>:4000/ws` (overridable)
  - Source: src/store/wsClient.ts
- **CORS origin**: `http://localhost:5173` (overridable)
  - Source: server/index.ts
- **SQLite DB path**: `server/synapse.db` (overridable)
  - Source: server/db.ts
  - Env: `SYNAPSE_DB_PATH`

### Multi-instance (now supported via env)
If you plan to run multiple instances on one machine, set these:

- **CLIENT_ORIGIN** (server CORS): default `http://localhost:5173`
- **VITE_DEV_PORT** (vite): default `5173`
- **VITE_API_ORIGIN** (client API base): default `http://localhost:4000` in dev
- **VITE_WS_ORIGIN** (vite WS proxy): default `ws://localhost:4000`
- **VITE_WS_URL** (client WS override): default empty (auto)
- **SYNAPSE_DB_PATH** (server DB): default `server/synapse.db`

---

## Per-Project Hook Setup

Create or edit `.claude/settings.local.json` in the target project and point to the hook script:

- Command: `node hooks/send_event.cjs`
- Set `SYNAPSE_URL` to the server for **that project** (via environment or wrapper script).

If the Synapse folder is outside the project, update the command to the absolute path, e.g.
`node C:/tools/Synapse/hooks/send_event.cjs`

---

## Deploy to a Brand-New Machine (Source-Run)

1) Install prerequisites
- Node.js 20+ (includes global npm)

2) Copy files
- Copy the **Source-run** minimal file set into a folder (e.g. `C:\Synapse`).

3) Configure env
- Copy `.env.example` -> `.env` and set ports if needed.

4) Install dependencies
- Run `npm install` in the Synapse folder.

5) Start backend and frontend
- `./start-server.ps1` (or `bash start-server.sh`)
- `./start-client.ps1` (or `bash start-client.sh`)

6) Configure hooks in the target project
- Place `.claude/settings.local.json` in the project, referencing the hook script.
- Set `SYNAPSE_URL=http://localhost:4000/api/events` (or a custom port).

7) Verify
- Open `http://localhost:5173`
- Optional: run `npx tsx scripts/simulate_session.ts` from the Synapse folder to populate data.

---

## Deploy to a Brand-New Machine (Prebuilt Frontend)

1) Build on a dev machine
- `npm install`
- `npm run build` (creates dist/)

2) Copy to target machine
- Copy **Prebuilt** minimal set to the new machine.

3) Configure env
- Copy `.env.example` -> `.env` and set ports if needed.

4) Install dependencies
- `npm install`

5) Start server (single process)
- `./start-server.ps1` (serves both API and dashboard on port 4000)
- Open `http://localhost:4000`

---

## Sharing with a Friend

Give them:
- The minimal file set (source-run is easiest)
- This doc
- A short checklist:
  1) Install Node 20+
  2) Copy `.env.example` -> `.env`
  3) `npm install`
  4) Start server + client (scripts)
  5) Configure .claude hook for their project

---

## Packaging Script

Run `scripts/make-package.ps1` (or `bash scripts/make-package.sh`) to assemble a minimal per-project package in `_package/Synapse`.
The package includes this doc and [docs/PACKAGE.md](docs/PACKAGE.md).

---

## Notes on Multiple Instances

Per-project instances **do not** require multiple hook definitions — each project just points its hooks to the correct instance URL via `SYNAPSE_URL`. If you want one global hook configuration, you would need a router/orchestrator to forward events by project, which is extra complexity.
