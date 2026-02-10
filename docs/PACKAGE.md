# Synapse Package (Per-Project)

This package is intended to be copied to a new machine and run per project with minimal setup.

---

## Quick Install (new machine)

1) Install **Node.js 20+**.
2) Copy the packaged Synapse folder to the machine.
3) In the Synapse folder:
   - Copy `.env.example` -> `.env`
   - Edit ports/origins if needed (see below)
4) Install deps:
   - `npm install`
5) Start server:
   - `./start-server.ps1` (or `bash start-server.sh`)
   - For dev mode (with Vite HMR): also run `./start-client.ps1`
6) Configure hooks in the target project:
   - Copy `.claude/settings.local.json` into your project (or edit existing)
   - Ensure the hook command points to `hooks/send_event.cjs`
   - Ensure `SYNAPSE_URL` in `.env` points to your server

---

## Create the Package

From the repo root:

- `npm run package`

This writes `_package/Synapse` with the minimal source-run set.

## Config (.env)

Minimal defaults:

```
PORT=4000
CLIENT_ORIGIN=http://localhost:5173
SYNAPSE_DB_PATH=server/synapse.db
VITE_DEV_PORT=5173
VITE_API_ORIGIN=http://localhost:4000
VITE_WS_ORIGIN=ws://localhost:4000
SYNAPSE_URL=http://localhost:4000/api/events
```

If you run multiple instances on the same machine, pick unique ports per project:

```
PORT=4010
CLIENT_ORIGIN=http://localhost:5181
VITE_DEV_PORT=5181
VITE_API_ORIGIN=http://localhost:4010
VITE_WS_ORIGIN=ws://localhost:4010
SYNAPSE_URL=http://localhost:4010/api/events
```

---

## Package Contents (source-run)

- package.json
- vite.config.ts
- tsconfig.json
- tsconfig.server.json
- index.html
- src/
- server/
- hooks/
- .claude/
- start-client.ps1 / start-client.sh
- start-server.ps1 / start-server.sh
- .env.example
- docs/DEPLOYMENT.md
- docs/PACKAGE.md

---

## Notes

- The server is TypeScript and runs via `tsx`.
- If you want a fully compiled server build, add a server build step later.
