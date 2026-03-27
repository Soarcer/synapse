# OpenClaw Standalone Packaging + Phase 9.3/9.4 Completion

**Date:** 2026-02-23
**Status:** Approved

## Problem Statement

Two workstreams need completion:

1. **OpenClaw plugin** (`@synapse-ai/openclaw`) cannot be distributed independently — it has broken path assumptions, native dependencies, and missing assets that prevent anyone from installing it outside the Synapse monorepo.

2. **Phase 9.3** (Codex adapter) and **Phase 9.4** (multi-vendor dashboard UI) have 7 confirmed gaps that prevent multi-vendor analytics from working end-to-end.

## Workstream A: OpenClaw Standalone Plugin

### Current Blockers

| Issue                            | Detail                                                                          |
| -------------------------------- | ------------------------------------------------------------------------------- |
| Server not bundled               | `plugin.ts:32` references `../server/index.ts` — doesn't exist outside monorepo |
| `npx tsx` runtime dep            | Line 44 spawns TypeScript via tsx — needs compiled JS                           |
| `better-sqlite3` native addon    | Requires C++ compiler + python on user machines                                 |
| `@synapse-ai/core` workspace dep | `workspace:*` resolves to nothing on npm; never actually imported               |
| `@sinclair/typebox` misplaced    | Used at runtime but listed as devDep                                            |
| Dashboard not included           | No built frontend assets in the package                                         |
| No `openclaw.plugin.json`        | OpenClaw plugin system requires manifest                                        |

### Design

**Architecture:**

```
@synapse-ai/openclaw (npm package)
├── openclaw.plugin.json          ← OpenClaw manifest + JSON Schema config
├── package.json                  ← zero runtime deps, openclaw as peer
├── dist/
│   ├── plugin.js                 ← plugin entry (ESM, self-contained)
│   ├── server.mjs                ← full Synapse server (ESM, sql.js, minified)
│   └── dashboard/                ← built React frontend
│       ├── index.html
│       └── assets/...
```

**Key decisions:**

- Server bundled as `dist/server.mjs` using esbuild (same approach as VS Code extension)
- `sql.js/dist/sql-asm.js` replaces `better-sqlite3` — zero native deps
- Plugin spawns `node dist/server.mjs` (not `npx tsx`)
- Path: `path.join(__dirname, 'server.mjs')` — works from any install location
- Dashboard pre-built into `dist/dashboard/`
- `@synapse-ai/core` removed from deps (never imported — all types local)
- `@sinclair/typebox` bundled by esbuild (or moved to deps)
- `openclaw.plugin.json` added with JSON Schema matching TypeBox config

**Build pipeline (new `esbuild.mjs`):**

1. Bundle `src/plugin.ts` → `dist/plugin.js` (external: `openclaw` only)
2. Bundle `packages/server/src/index.ts` → `dist/server.mjs` (sql.js asm plugin, minified)
3. Build dashboard → copy to `dist/dashboard/`
4. Generate/copy `openclaw.plugin.json`

**Installation by end users:**

```bash
openclaw plugins install @synapse-ai/openclaw
# or from local: openclaw plugins install ./synapse-ai-openclaw-0.1.0.tgz
# or dev-link: openclaw plugins install -l /path/to/packages/openclaw
```

### Files to Create/Modify

| File                                     | Action                                                |
| ---------------------------------------- | ----------------------------------------------------- |
| `packages/openclaw/openclaw.plugin.json` | Create — manifest                                     |
| `packages/openclaw/esbuild.mjs`          | Rewrite — 4-step build pipeline                       |
| `packages/openclaw/src/plugin.ts`        | Modify — spawn `node server.mjs` instead of `npx tsx` |
| `packages/openclaw/package.json`         | Modify — remove runtime deps, add files entries       |

---

## Workstream B: Phase 9.3 + 9.4

### Phase 9.3 — Codex Adapter (3 gaps)

**Gap 1: `o4-mini` pricing**

- File: `packages/server/src/services/costService.ts`
- Add `o4-mini` entry to `DEFAULT_PRICES` after `o3-mini`
- Pricing: $1.10 / $0.55 / $4.40 per 1M (input / cached / output)

**Gap 2: Codex text recovery in `rowToAgentEvent`**

- File: `packages/server/src/services/eventStore.ts`
- In the raw_payload recovery block (lines 170-183), add checks for:
  - `raw.payload?.message` → Codex event_msg user text
  - `raw['last-assistant-message']` / `raw.last_assistant_message` → Codex notify result text

**Gap 3: CodexFileWatcher**

- New file: `packages/server/src/services/codexWatcher.ts`
- Watches `~/.codex/sessions/YYYY/MM/DD/*.jsonl` for new lines
- Tails via byte-offset tracking (no readline streams)
- Routes lines through `CodexAdapter.normalize()` → `storeNormalized()`
- Midnight rollover: watches for new day directory
- Gated by `SYNAPSE_CODEX_WATCH=1` env var
- Started from `packages/server/src/index.ts`

### Phase 9.4 — Dashboard Multi-Vendor UI (4 gaps)

**Gap 4: OpenAI + Google models in `MODEL_COLORS` / `MODEL_LABELS`**

- Files: `apps/dashboard/src/components/analytics/shared/constants.ts` and local copy in `ExecutiveOverview.tsx`
- Add: o4-mini, o3-mini, o1, gpt-4o, gpt-4o-mini (teal shades), gemini-2.5-pro, gemini-2.5-flash (blue shades)

**Gap 5: Render `VendorBreakdown`**

- File: `apps/dashboard/src/components/analytics/executive/ExecutiveOverview.tsx`
- Import and render `VendorBreakdown` conditionally (when 2+ vendors present)

**Gap 6: Wire vendor filter to API**

- File: `apps/dashboard/src/components/analytics/useAnalyticsData.ts`
- Add `if (filters.vendor) params.set('vendor', filters.vendor);` to param building
- Add `filters.vendor` to useCallback dependency array

**Gap 7: Vendor filter UI**

- File: `apps/dashboard/src/components/analytics/executive/ExecutiveOverview.tsx` (or analytics page)
- Add vendor pill buttons derived from `data.sessions` vendor field

### Roadmap Update

- Phase 5e → 100% DONE (PacMan intentionally not built)
- Phase 9.3 → update after implementation
- Phase 9.4 → update after implementation
