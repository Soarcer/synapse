# Synapse — Execution Prompt for AI Agent

Copy everything below this line and paste it as a prompt to a new Claude Code session.

---

You are executing a comprehensive code quality, reliability, and UX improvement plan for the Synapse project at `c:\Workspace\Coding\Prototypes\Synapse`. This is a pnpm monorepo with `packages/core`, `packages/server`, `apps/dashboard`, `apps/vscode`, and `hooks/`.

Read `docs/IMPLEMENTATION_PLAN.md` and `docs/REVIEW_FINDINGS.md` for full context. The plan has 8 phases with ~55 tasks. Execute them in order, writing tests alongside each phase (not in a separate phase). Use parallel agents where tasks are independent.

## Key Constraints

- **Do NOT create a new migration system** — the existing `try { ALTER TABLE } catch {}` pattern is fine for a local dev tool
- **CSP already exists** in `apps/vscode/src/webviewPanel.ts` and `sidebarProvider.ts` — skip M19
- **`@testing-library/react` is already installed** in `apps/dashboard` — use it for component tests
- **`@vitest/coverage-v8` is NOT needed** — vitest v4 has built-in v8 coverage
- **New schemas exist** in `packages/core/src/schemas.ts` — `AnalyticsQuerySchema` and `PriceCreateSchema` were recently added. Don't overwrite them.
- **Windows environment** — use PowerShell-compatible commands

## Execution Strategy

### Phase 1: Foundation (CI + Test Infra)
Run these in parallel:
1. Create `.github/workflows/ci.yml` (GitHub Actions: checkout → Node 20 → pnpm install → lint → build → test → audit)
2. Add coverage thresholds to `vitest.config.ts` (statements 50%, branches 40%, functions 50%, lines 50%)
3. Add `"audit"` and `"typecheck"` scripts to root `package.json`

Verify: `pnpm test` passes, `pnpm lint` passes.

### Phase 2: Server Hardening
Execute sequentially (many edits to `packages/server/src/index.ts`):

1. **CORS fix** (`index.ts:44-45`): Remove fallback `else if (allowedOrigins.length > 0)` branch
2. **WS auth** (`index.ts:147-160`): If `SYNAPSE_API_KEY` set, validate `?token=` on WS upgrade. Update `apps/dashboard/src/store/wsClient.ts` and `apps/vscode/src/wsClient.ts` to pass token.
3. **Body limits** (`index.ts:32`): Remove global `50mb` limit. Use `1mb` default, `50mb` only on snapshot import router.
4. **Timing-safe auth** (`lib/auth.ts`): Use `crypto.timingSafeEqual` instead of `!==`
5. **DB pruning** (`db.ts`): Add `pruneOldEvents(maxAgeDays)`, `pruneExcessEvents(maxCount)`, hourly timer. Env vars: `SYNAPSE_MAX_EVENT_AGE_DAYS=30`, `SYNAPSE_MAX_EVENTS=100000`
6. **Paginate queries** (`db.ts`): Add `LIMIT ? OFFSET ?` to sessionId/agentId branches in `queryEvents()`. Default limit 2000.
7. **Snapshot N+1** (`routes/snapshot.ts`): Single query `SELECT * FROM events ORDER BY session_id, created_at`, group in JS
8. **Rate limiting** (`index.ts`): General limiter 300/min on `/api`. Add `standardHeaders: 'draft-8'` to all limiters.
9. **Request ID** (new file `lib/requestId.ts`): Middleware generating `x-request-id` via nanoid
10. **Error swallowing** (`routes/snapshot.ts:130`): Log + count skipped events. (`index.ts:207`): Call `shutdown()` on unhandledRejection.
11. **Transcript cache** (`services/transcriptReader.ts`): Add 5-min TTL Map cache for `findTranscriptPath()`
12. **Hook debug gate** (`hooks/send_event.cjs`): Gate behind `SYNAPSE_DEBUG=1`
13. **Clean `as any`** (`services/agentManager.ts`): Replace with `unknown` + narrowing
14. **Type-safe analytics** (`db.ts`): Replace raw `analyticsQueryAll`/`analyticsExecute` with typed wrappers

Then write tests:
- `packages/server/src/__tests__/auth.test.ts` — timing-safe auth
- `packages/server/src/__tests__/db.test.ts` — insert, query, pagination, delete, prune, rollup
- `packages/server/src/__tests__/costService.test.ts` — pricing lookup, computation, overrides

Run `pnpm test` to verify.

### Phase 3: Client Reliability
1. **Pause queue** (`agentStore.ts`): Add `pauseQueue: AgentEvent[]`, queue while paused, replay on unpause, remove `reloadAllEvents()` on unpause
2. **Search debounce** (`GraphSearchBox.tsx`): 250ms debounce with local state + useRef timer
3. **WS reconnect** (`wsClient.ts`): Add `resetAndReconnect()`. Show "Reconnect" button in Header when failed.
4. **text_delta sessionId** (`agentStore.ts:465-473`): Look up agent's sessionId from agents map
5. **Backpressure recovery** (`broadcaster.ts`): Add `staleClients: WeakSet`, send `{ type: 'stale' }` on next successful send. Handle in `wsClient.ts`.
6. **Event ordering** (`agentStore.ts`): Binary search insertion by timestamp in `addEvent`
7. **Event cap warning** (`agentStore.ts`): Toast warning when hitting 1000, flag to prevent repeats
8. **Move cwdFilter** into Zustand store
9. **Remove dead WS methods** (`subscribe`/`unsubscribe` in `wsClient.ts:102-108`)

Add tests to `apps/dashboard/src/store/__tests__/agentStore.test.ts` for pause queue, ordering, cap warning.

### Phase 4: Architecture Cleanup
Run these in parallel where independent:
1. Extract `GraphLayout` component from duplicated JSX in `App.tsx`
2. Remove duplicated `normalizeCwd` in `apps/vscode/src/extension.ts` — import from `@synapse-ai/core`
3. Fix `hookManager.ts` removeHooks to only delete Synapse hook keys, preserve other settings
4. Remove `hookManager?.removeHooks(true)` from `extension.ts` deactivate
5. Add missing keyboard shortcuts to `CLAUDE.md` table: C, V, F, E, I, /, 1-6
6. Guard number keys with `viewMode === 'full'` check in `App.tsx:196-199`
7. Fix `postMessage` target origin in `App.tsx:117` — use `window.location.origin` in full mode

### Phase 5: Route + WS + Component Tests
1. Install supertest: `pnpm add -D supertest @types/supertest --filter @synapse-ai/server`
2. Refactor `packages/server/src/index.ts` to export `createApp()` for testability (keep server startup in a separate `if (import.meta.url === ...)` block or separate file)
3. Write route tests (`__tests__/routes.test.ts`): ~20 tests covering all endpoints
4. Write WS tests (`__tests__/ws.test.ts`): ~8 tests for connect, broadcast, heartbeat, auth
5. Write component tests in `apps/dashboard/src/components/__tests__/`: Header, Toast, ErrorBoundary, GraphSearchBox

Run `pnpm test -- --coverage` and verify 60%+ coverage.

### Phase 6: UX — Onboarding + States
1. Create `EmptyState.tsx` component (icon, title, description, CTA)
2. Add empty state overlay to `AgentGraph.tsx` when only spawn node exists
3. Create `SkeletonLoader.tsx` (CSS shimmer animation)
4. Add server-down banner to `Header.tsx` (disconnected + failed states with reconnect)
5. Add skeleton loaders to `AgentDetailPanel.tsx` and `ToolLogPanel.tsx`
6. Add event cap warning banner to `Header.tsx`

### Phase 7: Accessibility
1. Semantic landmarks in `App.tsx`: `<header>`, `<nav>`, `<main>`, `<aside>`
2. Skip-to-content link: `<a href="#main-graph" className="sr-only focus:not-sr-only">`
3. ARIA labels: `aria-label` on icon buttons, `aria-expanded` on collapsibles, `aria-live="polite"` on toast, `role="status"` on connection indicator
4. Text status labels on node components alongside color indicators
5. Focus management in `SpawnAgentDialog.tsx` (auto-focus, return focus, tab trap)
6. Arrow key navigation in `ToolLogPanel.tsx` and `AgentDetailPanel.tsx`

### Phase 8: Responsive (minimal)
1. Create `useBreakpoint.ts` hook (sm < 768, md 768-1024, lg > 1024)
2. Responsive header: overflow menu below 768px
3. Responsive panels: bottom sheet below 768px

## Verification After All Phases

Run these commands to verify everything works:
```powershell
pnpm lint
pnpm -r build
pnpm test -- --coverage
npx tsx packages/server/src/index.ts   # should start on port 4000
# In another terminal:
npx tsx scripts/simulate_session.ts     # events should appear
cd apps/vscode && node esbuild.mjs      # extension should build
```

## Commit Strategy

Create one commit per phase with a descriptive message:
- `fix: Phase 1 — CI pipeline, coverage config, audit script`
- `fix: Phase 2 — server hardening (CORS, auth, body limits, DB pruning, pagination)`
- `fix: Phase 3 — client reliability (pause queue, debounce, reconnect, event ordering)`
- `refactor: Phase 4 — architecture cleanup (GraphLayout, dedup, extension fixes)`
- `test: Phase 5 — route, WS, component tests (60%+ coverage)`
- `feat: Phase 6 — UX onboarding, empty/loading/error states`
- `feat: Phase 7 — accessibility (ARIA, keyboard nav, focus management)`
- `feat: Phase 8 — responsive design (breakpoints, adaptive layout)`
