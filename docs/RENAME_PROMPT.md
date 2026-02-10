# Rename Implementation Prompt

> Paste this into a fresh Claude Code session opened in the project directory.
> Reference: `docs/RENAME_PLAN.md` for the full plan and verification checklist.

---

You are implementing a project rename from AgentViz → Synapse. The branding is already 90% done. Your job is to complete the remaining infrastructure naming changes. Follow the plan in `docs/RENAME_PLAN.md` exactly.

## Phase 1: Code Changes

### 1a. Database auto-migration

In `server/db.ts`, add auto-migration logic BEFORE the `new Database(DB_PATH)` line. If `synapse.db` doesn't exist but `agentviz.db` does at the same directory level, rename it (including `-wal` and `-shm` files). Log the migration to console.

Then change the default database filename from `'agentviz.db'` to `'synapse.db'` on the line where `DB_PATH` is computed.

### 1b. Env var deprecation warnings

In `server/db.ts`: keep the `AGENTVIZ_DB_PATH` fallback but add a `console.warn('[DB] AGENTVIZ_DB_PATH is deprecated, use SYNAPSE_DB_PATH instead')` when it's used.

In `hooks/send_event.cjs`: keep the `AGENTVIZ_URL` fallback but add a `process.stderr.write` warning when it's the one that matches (SYNAPSE_URL is not set but AGENTVIZ_URL is).

### 1c. Script updates

In `scripts/simulate_session.ts`:
- Line 15: Change the hardcoded CWD path to `process.cwd()`
- Line 45: Change "AgentViz Session Simulator" to "Synapse Session Simulator"
- Line 92: Change `"name":"agentviz"` to `"name":"synapse-viz"` in the mock tool_response

In `scripts/spawn_two_agents.ts`:
- Line 56: Change "Check the AgentViz UI" to "Check the Synapse UI"

### 1d. Gitignore

In `.gitignore`: Change `server/agentviz.db` to two lines:
```
server/synapse.db
server/agentviz.db
```
(Keep both so the old filename is still ignored during migration.)

### 1e. Regenerate package-lock.json

Run `npm install` to regenerate `package-lock.json` which still says `"name": "agentviz"` on lines 2 and 8. The root `package.json` already says `"name": "synapse-viz"` so the lock file will pick it up.

## Phase 2: Documentation

Use `replace_all` edits where safe. These are all text-only changes with zero functional risk.

**`docs/ARCHITECTURE.md`**:
- Line 1: `# AgentViz Architecture` → `# Synapse Architecture`
- Line 41: `AgentViz/` → `Synapse/`

**`docs/RESEARCH.md`**:
- Line 1: `# AgentViz Research` → `# Synapse Research`

**`docs/DEPLOYMENT.md`**:
- Line 47: Remove ` - Legacy: \`AGENTVIZ_URL\` still works as fallback`
- Line 60: Change `(legacy: \`AGENTVIZ_DB_PATH\`)` → remove the legacy note

**`docs/INSTALL.md`**:
- All `C:\Workspace\Coding\Prototypes\AgentViz` → `C:\Workspace\Coding\Prototypes\Synapse`
- All `~/AgentViz` → `~/Synapse`
- All `C:/path/to/AgentViz/hooks` → `C:/path/to/Synapse/hooks`
- `server/agentviz.db` → `server/synapse.db` (in env var table and troubleshooting)
- `agentviz.db-wal` and `agentviz.db-shm` → `synapse.db-wal` and `synapse.db-shm`
- "from the AgentViz directory" → "from the Synapse directory"

**`docs/IMPLEMENTATION_PROMPT.md`**:
- Line 3: "AgentViz project directory" → "Synapse project directory"
- Line 14: "transform AgentViz into Synapse" → "build out the Synapse platform"
- Line 169: "single-project AgentViz" → "single-project Synapse app"

**`docs/IMPLEMENTATION_PROMPTS.md`**:
- Replace all "AgentViz" with "Synapse" throughout (use replace_all)
- Line 24: `server/agentviz.db` → `server/synapse.db`

**`docs/ROADMAP.md`**:
- Line 3: "merging AgentViz incremental improvements with Synapse" → "for Synapse platform"
- Line 153: "refactored AgentViz" → "refactored from prototype"

**`docs/SYNAPSE_PLAN.md`**:
- Replace remaining "AgentViz" references with "Synapse" or contextually appropriate text. There are ~12 occurrences. Use replace_all where the replacement is unambiguous. For comparison tables that reference "AgentViz (current)", change to "Prototype (v0.1)" or similar.

## Phase 3: Cleanup

Delete these stale artifacts:
- `_package/AgentViz/` (entire directory — old build output)
- `ctempread_responses.txt` (temp debug file in root)

## Phase 4: Test

Run in order:
1. `npm run build` — must succeed
2. Start server: `npx tsx server/index.ts` — must start on port 4000
3. Health check: `curl http://localhost:4000/api/health` — must return `{"ok":true,...}`
4. Simulator: `npx tsx scripts/simulate_session.ts` — must show all OK
5. OpenClaw simulator: `npx tsx openclaw-plugin/scripts/simulate_openclaw.ts --post` — must show all OK
6. Stop server

Run a final grep to verify no remaining "agentviz" references in source files:
```bash
grep -ri "agentviz" --include='*.ts' --include='*.tsx' --include='*.js' --include='*.cjs' --include='*.mjs' --include='*.md' --include='*.ps1' --include='*.sh' --include='*.html' --include='*.json' . | grep -v node_modules | grep -v '.git/' | grep -v '_package/' | grep -v 'package-lock.json'
```

The only allowed remaining match should be `.gitignore` line `server/agentviz.db` (intentional for migration).

## Phase 5: Commit

Create a single commit:
```
rename: complete AgentViz → Synapse migration

- Default database filename: agentviz.db → synapse.db (with auto-migration)
- Deprecation warnings on AGENTVIZ_* env vars
- All documentation paths and references updated
- Stale build artifacts removed
```

## Do NOT change

- Type names (`AgentEvent`, `AgentNodeData`, `AgentManager`, etc.)
- Component names (`AgentNode`, `AgentGraph`, `AgentDetailPanel`)
- CSS classes
- The npm package name (already `synapse-viz`)
- The VS Code extension name (already `synapse`)
- The OpenClaw plugin name (already `@synapse/openclaw-plugin`)

## After this session (manual steps for the user)

Tell the user to do these steps themselves:

1. Close all editors and terminals
2. Rename directory: `Rename-Item c:\Workspace\Coding\Prototypes\AgentViz Synapse`
3. Reopen from `c:\Workspace\Coding\Prototypes\Synapse`
4. Run `npm run build` to verify
5. Re-run `node bin/synapse.mjs hook` in any hooked projects
