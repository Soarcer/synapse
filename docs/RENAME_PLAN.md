# Synapse Rename Plan: AgentViz → Synapse

## Status

The project branding is ~90% renamed. All user-facing UI, CLI commands, npm packages, extensions, and plugins already use "Synapse". What remains is infrastructure naming: database filename, env var fallbacks, documentation paths, script strings, and the root directory itself.

## Constraints

- No external consumers — local dev project only
- Database data should be auto-migrated (rename file on startup)
- Root directory will be renamed: `AgentViz` → `Synapse`
- Legacy `AGENTVIZ_*` env vars: keep with deprecation warning, remove later
- `_package/AgentViz/` is a stale build artifact — will be deleted, not migrated

## Scope

### Category A: Code changes (11 files, ~35 edits)

Mechanical find-and-replace, safe to batch.

| # | File | Line(s) | Current | Replacement |
|---|------|---------|---------|-------------|
| 1 | `.gitignore` | 3 | `server/agentviz.db` | `server/synapse.db` (add `server/agentviz.db` on next line for migration) |
| 2 | `server/db.ts` | 7 | `path.join(__dirname, 'agentviz.db')` | `path.join(__dirname, 'synapse.db')` |
| 3 | `server/db.ts` | 6 | `process.env.SYNAPSE_DB_PATH \|\| process.env.AGENTVIZ_DB_PATH` | Keep both, add `console.warn` when `AGENTVIZ_DB_PATH` used |
| 4 | `hooks/send_event.cjs` | 13 | `process.env.SYNAPSE_URL \|\| process.env.AGENTVIZ_URL \|\| ...` | Keep both, add `console.error` to stderr when `AGENTVIZ_URL` used |
| 5 | `scripts/simulate_session.ts` | 15 | `'c:\\Workspace\\Coding\\Prototypes\\AgentViz'` | `process.cwd()` |
| 6 | `scripts/simulate_session.ts` | 45 | `'AgentViz Session Simulator'` | `'Synapse Session Simulator'` |
| 7 | `scripts/simulate_session.ts` | 92 | `'{"name":"agentviz",...}'` | `'{"name":"synapse-viz",...}'` |
| 8 | `scripts/spawn_two_agents.ts` | 56 | `'Check the AgentViz UI'` | `'Check the Synapse UI'` |
| 9 | `package-lock.json` | 2, 8 | `"name": "agentviz"` | Regenerate via `npm install` after package.json is already `synapse-viz` |

### Category B: Database auto-migration (1 file)

Add to `server/db.ts` before `new Database(DB_PATH)`:

```typescript
// Auto-migrate: rename agentviz.db → synapse.db if old file exists and new doesn't
const legacyPath = path.join(__dirname, 'agentviz.db');
if (!fs.existsSync(DB_PATH) && fs.existsSync(legacyPath) && DB_PATH.endsWith('synapse.db')) {
  fs.renameSync(legacyPath, DB_PATH);
  // Also migrate WAL/SHM files if present
  for (const suffix of ['-wal', '-shm']) {
    const oldF = legacyPath + suffix;
    if (fs.existsSync(oldF)) fs.renameSync(oldF, DB_PATH + suffix);
  }
  console.log(`[DB] Migrated ${legacyPath} → ${DB_PATH}`);
}
```

### Category C: Documentation updates (7 files)

Purely text changes — no functional risk.

| File | Changes |
|------|---------|
| `docs/ARCHITECTURE.md` | Line 1: title, Line 41: directory tree root |
| `docs/RESEARCH.md` | Line 1: title |
| `docs/DEPLOYMENT.md` | Lines 47, 60: remove "(legacy: AGENTVIZ_*)" notes |
| `docs/INSTALL.md` | All `AgentViz` path references → `Synapse`, `agentviz.db` → `synapse.db` |
| `docs/ROADMAP.md` | Lines 3, 153: remaining "AgentViz" references |
| `docs/SYNAPSE_PLAN.md` | Lines 5, 8, 16, 18, 41, 78, 117, 427, 488, 574, 578, 594, 597 |
| `docs/IMPLEMENTATION_PROMPT.md` | Lines 3, 14, 169 |
| `docs/IMPLEMENTATION_PROMPTS.md` | Lines 1, 5, 14, 24, 113, 125, 258 |

### Category D: Cleanup

| Item | Action |
|------|--------|
| `_package/AgentViz/` | Delete entire directory (stale build artifact) |
| `ctempread_responses.txt` | Delete (temp debug file) |
| `package-lock.json` | Regenerate with `npm install` (still says `"name": "agentviz"`) |

### Category E: Root directory rename (manual, last step)

1. Close all editors, terminals, running servers
2. `Rename-Item c:\Workspace\Coding\Prototypes\AgentViz Synapse` (PowerShell)
3. Reopen from `c:\Workspace\Coding\Prototypes\Synapse`
4. Claude Code will create new project settings automatically
5. Re-run `node bin/synapse.mjs hook` in any hooked projects

## Execution Order

```
Phase 1: Code changes         (Categories A + B)  — safe, testable in-place
Phase 2: Documentation        (Category C)         — zero risk, text only
Phase 3: Cleanup              (Category D)         — delete stale artifacts
Phase 4: Test                 — build, start, simulate, verify
Phase 5: Commit               — single commit before directory rename
Phase 6: Directory rename     (Category E)         — OS-level, must be last
Phase 7: Post-rename verify   — reopen, build, test again
```

## What NOT to rename

- **Type names** (`AgentEvent`, `AgentNodeData`, `AgentManager`, etc.) — these describe the domain ("agent"), not the product
- **CSS class names** — no AgentViz references exist in styles
- **Component names** (`AgentNode`, `AgentGraph`, `AgentDetailPanel`) — domain terminology

## Risks

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Database data loss | Low | Medium | Auto-migration renames file; no data deleted |
| Hook paths break after dir rename | Medium | Low | Re-run `synapse hook` in affected projects |
| Claude project settings reset | Certain | Trivial | Settings regenerate from CLAUDE.md |
| Build breaks after rename | Low | Low | `npm install` regenerates lock file |
| Git history confused | None | None | Git tracks content, not directory paths |

## Verification Checklist

After all phases:

- [ ] `npm run build` succeeds
- [ ] `npx tsx server/index.ts` starts on port 4000
- [ ] `curl http://localhost:4000/api/health` returns `{"ok":true,...}`
- [ ] `npx tsx scripts/simulate_session.ts` runs without errors
- [ ] `npx tsx openclaw-plugin/scripts/simulate_openclaw.ts --post` runs
- [ ] No "agentviz" in `grep -ri agentviz . --include='*.ts' --include='*.tsx' --include='*.js' --include='*.cjs' --include='*.mjs' --include='*.json' --include='*.md' --include='*.ps1' --include='*.sh' --include='*.html'` (excluding node_modules, .git, _package)
- [ ] Database migration works: place a file named `agentviz.db` in `server/`, start server, verify it becomes `synapse.db`
