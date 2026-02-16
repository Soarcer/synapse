# Synapse — Comprehensive Code Review Findings

**Reviewed**: 2026-02-16 (round 3 — full exhaustive review)
**Scope**: All packages, apps, hooks, infrastructure, security, UX, data flows, testing
**Method**: 6 specialized review agents covering server, dashboard, VS Code extension, infrastructure, security, and core/UX
**Files reviewed**: 100+ source files across all packages

---

## 1. Server Code Quality & Architecture

### Critical Issues (must fix before production)

- **Unbounded queries in `getEventsBySession` / `getEventsByAgent`** — [db.ts:355-367](packages/server/src/db.ts#L355-L367) — These functions run `SELECT * FROM events` without LIMIT clauses. A session with 100k events returns them all, risking OOM. **Fix**: Add `LIMIT ? OFFSET ?` params with a max cap (10,000).

- **Path traversal in transcript reader** — [transcriptReader.ts:35-57](packages/server/src/services/transcriptReader.ts#L35-L57) — `sessionId` is used directly in file path construction without sanitization. `../../etc/passwd` sequences could escape the expected directory. **Fix**: Validate `sessionId` against `/^[a-zA-Z0-9_-]+$/` before path construction.

- **Missing LIMIT on analytics prompt query** — [promptAnalyzer.ts:254](packages/server/src/services/promptAnalyzer.ts#L254) — `SELECT DISTINCT session_id FROM events` has no LIMIT. Thousands of sessions in a date range = unbounded result set. **Fix**: Add `LIMIT 500`.

- **Rate limiting can be disabled without safeguard** — [app.ts:59-66](packages/server/src/app.ts#L59-L66) — `disableRateLimiting` option intended for tests has no environment check. If set in production, the server is unprotected. **Fix**: Assert `NODE_ENV !== 'production'` when flag is set.

### Major Issues (should fix soon)

- **No backpressure handling in agent streaming** — [agentManager.ts:124-140](packages/server/src/services/agentManager.ts#L124-L140) — The `for await` stream loop broadcasts without checking if clients can keep up. If broadcaster reports backpressure, messages queue in memory. **Fix**: Check broadcaster backpressure state, pause stream if needed.

- **Transcript reader blocks event loop on fallback** — [transcriptReader.ts:44-54](packages/server/src/services/transcriptReader.ts#L44-L54) — When direct path misses, `readdirSync` scans ALL project directories in `~/.claude/projects`. Blocks event loop for users with many projects. **Fix**: Make async or use worker thread.

- **Database save timer can delay persistence indefinitely** — [db.ts:26-39](packages/server/src/db.ts#L26-L39) — 1-second debounce resets on every write. Under continuous writes, DB is never persisted until writes stop. **Fix**: Add max-wait (5s forced save even if writes continue).

- **No `cwd` length validation in analytics** — [analytics.ts (multiple)](packages/server/src/routes/analytics.ts) — `cwd` query parameter is normalized but not length-limited. A 10MB string could cause memory issues. **Fix**: Validate max 500 chars.

- **Error handler leaks internal details** — [app.ts:90-93](packages/server/src/app.ts#L90-L93) — Some route catch blocks return `err.message` directly, which may expose file paths or schema details. **Fix**: Always return generic messages; log full details.

- **Dynamic SQL clauses lack documentation** — [analytics.ts:88, 659](packages/server/src/routes/analytics.ts#L88) — While parameterized, dynamic `WHERE ${clause}` and `IN (${placeholders})` constructions should be documented to confirm safety.

### Minor Issues (nice to have)

- **Missing index on `tool_use_id`** — [analytics.ts:590-598](packages/server/src/routes/analytics.ts#L590-L598) — Pairing tool start/end by `tool_use_id` with no index. Slow at 100k+ events. **Fix**: Add `CREATE INDEX idx_events_tool_use_id`.

- **Nudge detectors run on every event without throttling** — [nudgeEngine.ts:240-249](packages/server/src/services/nudgeEngine.ts#L240-L249) — 1000 events × 8 detectors = 8000 checks. Cooldown prevents duplicates but checks still run.

- **Transcript cache TTL causes stale reads** — [transcriptCache.ts:13](packages/server/src/services/transcriptCache.ts#L13) — 5-minute TTL means active sessions show stale data. **Fix**: Check file mtime for invalidation.

- **No explicit concurrent write documentation for sql.js** — [db.ts:76-84](packages/server/src/db.ts#L76-L84) — sql.js is single-threaded in-memory. Add comment about concurrency model.

- **Coaching route sessionIds splitting** — [coaching.ts:56-57](packages/server/src/routes/coaching.ts#L56-L57) — Splitting on commas without filtering empties could generate large IN clauses.

- **No timeout on HTTP requests to Claude API before streaming** — [agentManager.ts:114-122](packages/server/src/services/agentManager.ts#L114-L122) — AbortController exists but pre-stream connection hang possible.

### Positive Findings

- Excellent parameterized query usage throughout — zero SQL injection vectors found
- `timingSafeEqual` for API key comparison prevents timing attacks
- Comprehensive Zod input validation on all POST endpoints
- Production-grade graceful shutdown: drain connections → abort agents → close WS → persist DB → force-exit after 10s
- Three-tier rate limiting (300/min general, 200/min hooks, 30/min spawns)
- Database migration strategy handles existing columns gracefully
- WebSocket heartbeat (30s ping/pong) with automatic stale client cleanup
- Cost calculation supports time-based pricing for historical accuracy
- No secrets exposed in logs — verified via grep

---

## 2. Client Code Quality & Architecture

### Critical Issues (must fix before production)

**None found.** The dashboard codebase demonstrates strong engineering practices.

### Major Issues (should fix soon)

- **WebSocket lacks backpressure handling** — [wsClient.ts:62-68](apps/dashboard/src/store/wsClient.ts#L62-L68) — Messages processed immediately with no buffering. High-frequency events could make UI unresponsive. **Fix**: Add requestAnimationFrame batching or debounced queue.

- **Event cap toast fires only once globally** — [agentStore.ts:47,61-64](apps/dashboard/src/store/agentStore.ts#L47) — `eventCapToastFired` is module-level and never resets. After clearing events and hitting cap again, no warning shown. **Fix**: Reset flag in `clearEvents()` and `loadEvents()`.

- **MAX_EVENTS hardcoded in 3 places** — [agentStore.ts:234,250,511](apps/dashboard/src/store/agentStore.ts#L234) — The 1000-event limit appears in three spots. If one changes, others won't match. **Fix**: Extract to named constant `const MAX_EVENTS = 1000`.

- **Analytics fetch race condition** — [useAnalyticsData.ts:293-298](apps/dashboard/src/components/analytics/useAnalyticsData.ts#L293-L298) — Rapid filter changes cause multiple fetches to race. Stale check exists (line 208) but pattern is fragile. **Fix**: Use ref to track current fetch, ignore stale results.

### Minor Issues (nice to have)

- **No timeout on analytics API calls** — [useAnalyticsData.ts:192-204](apps/dashboard/src/components/analytics/useAnalyticsData.ts#L192-L204) — Seven parallel fetches with no timeout. Server hang = frozen UI. **Fix**: Add 30s timeout to AbortController.

- **Missing ErrorBoundary around lazy AnalyticsPage** — [App.tsx:198](apps/dashboard/src/App.tsx#L198) — Suspense fallback exists but no ErrorBoundary. Chunk load failure crashes the app. **Fix**: Wrap Suspense in ErrorBoundary.

- **Auto-layout fingerprint hash collisions** — [useAutoLayout.ts:346-358](apps/dashboard/src/hooks/useAutoLayout.ts#L346-L358) — Simple string hash. At 500+ nodes, collisions could skip needed layout recalculations.

- **Console warnings in production** — [useAnalyticsData.ts:237](apps/dashboard/src/components/analytics/useAnalyticsData.ts#L237) and [App.tsx:57](apps/dashboard/src/App.tsx#L57) — `console.warn` leaks internal error details to browser console.

- **No virtualization for large analytics tables** — [PromptAnalyzer.tsx:257](apps/dashboard/src/components/analytics/prompts/PromptAnalyzer.tsx#L257) — `.slice(0, 50)` caps but no virtual scrolling for large datasets.

- **SpawnAgentDialog silently swallows errors** — [SpawnAgentDialog.tsx:66-68](apps/dashboard/src/components/panels/SpawnAgentDialog.tsx#L66-L68) — `catch { /* ignore */ }` gives no user feedback on spawn failure. **Fix**: Show toast on error.

- **Missing analytics filter validation** — [AnalyticsPage.tsx:37](apps/dashboard/src/components/analytics/AnalyticsPage.tsx#L37) — `timeRange` state not validated before API calls.

- **Graph search debounce cleanup** — [GraphSearchBox.tsx:10-15](apps/dashboard/src/components/graph/GraphSearchBox.tsx#L10-L15) — `clearTimeout(undefined)` is harmless but could be clearer.

### Positive Findings

- Excellent normalized Zustand state (sessions, agents, toolCalls, prompts maps)
- Module-level empty arrays prevent infinite re-render loops (Zustand best practice)
- Binary search for sorted event insertion — O(log n) performance
- All React Flow node types properly memoized with `memo()`
- Graph search debounced at 250ms with memoized visibility sets
- Tool collapse mode keeps visible nodes under 100 even with large graphs
- ErrorBoundary components wrap all major sections (Header, LensAdapter, GraphLayout)
- AbortController properly cancels in-flight requests on filter changes
- Server-down banner with retry affordance — graceful degradation
- Zero `any` types, zero `dangerouslySetInnerHTML`, zero XSS vectors
- Out-of-order event handling (tool_end before tool_start creates tool retroactively)
- BFS node removal with adjacency maps for clean graph mutations

---

## 3. Calling Patterns & Data Flow

### Critical Issues

- **Path traversal in transcript reader** — (See Server §1) — `sessionId` in file path without sanitization.

- **Snapshot import accepts unvalidated events** — [snapshot.ts:99-161](packages/server/src/routes/snapshot.ts#L99-L161) — `SnapshotImportSchema` validates top-level structure but individual events pass as `z.unknown()`. Malicious events with XSS payloads, huge strings, or foreign session IDs are inserted directly. **Fix**: Validate each event against `AgentEventSchema`, enforce per-event size limit (100KB).

### Major Issues

- **Events can arrive out of order — handled correctly** — The system handles this via: (1) binary search sorted insertion, (2) tool_end creates missing tool retroactively, (3) Task→Agent pending queue for async arrival. Well-designed.

- **Backend restart loses running agents** — When the server restarts, running agents are lost. The `agentManager` doesn't persist agent state. Events from dead agents may still arrive via hooks. **Fix**: Document this limitation or add agent state persistence.

- **WebSocket reconnect may miss events** — [wsClient.ts](apps/dashboard/src/store/wsClient.ts) — On reconnect, `reloadAllEvents()` fetches from server. Events that arrived between disconnect and reconnect are recovered only if the server stored them. This is correct behavior but worth documenting.

### Minor Issues

- **No circular dependency detection** — No tooling to detect circular imports between modules. Could add `madge` or similar.

### Positive Findings

- End-to-end event pipeline is well-designed: hook → POST → Zod → normalize → SQLite → WS → Zustand → React Flow
- WebSocket exponential backoff reconnect (20 attempts, 30s max) with full state reload on reconnect
- Snapshot export/import pipeline works correctly for data portability
- Frontend pauses only hide events visually — no events are lost

---

## 4. VS Code Extension

### Critical Issues (must fix before production)

- **Extension activation blocks VS Code for up to 10s** — [extension.ts:189-204](apps/vscode/src/extension.ts#L189-L204) — When `autoStart` is true, `activate()` awaits `serverManager.start()` which waits up to 10s for server readiness. This blocks the extension host. **Fix**: Fire-and-forget the startup: `serverManager.start().catch(err => outputChannel.appendLine(err.message))`.

- **WebSocket client has no connection timeout** — [wsClient.ts:22-68](apps/vscode/src/wsClient.ts#L22-L68) — If server is unreachable, WebSocket hangs in CONNECTING state indefinitely. No user feedback. **Fix**: Add 10s connection timeout, close and trigger reconnect on timeout.

- **Server port detection race condition** — [serverManager.ts:96-98](apps/vscode/src/serverManager.ts#L96-L98) — Port detection via stdout parsing (`SYNAPSE_PORT=\d+`) has no timeout. If server crashes before emitting this line, `_port` remains at default. **Fix**: Add 3s port detection timeout.

- **Webview CSP allows `unsafe-inline` scripts** — [webviewPanel.ts:92-96](apps/vscode/src/webviewPanel.ts#L92-L96), [sidebarProvider.ts:77-81](apps/vscode/src/sidebarProvider.ts#L77-L81), [settingsPanel.ts:303-304](apps/vscode/src/settingsPanel.ts#L303-L304) — All webviews use `script-src 'unsafe-inline'`, defeating CSP protection. **Fix**: Use nonce-based CSP per webview creation.

### Major Issues (should fix soon)

- **Server stop doesn't wait for process exit** — [serverManager.ts:139-158](apps/vscode/src/serverManager.ts#L139-L158) — `stop()` sends SIGTERM, sets `process = null`, fires `_onStopped` immediately before process exits. Restart may bind the same port while old process is still running. **Fix**: Only fire `_onStopped` from the `exit` event handler.

- **Deactivation may leave orphaned server** — [extension.ts:207-212](apps/vscode/src/extension.ts#L207-L212) — `deactivate()` calls `dispose()` synchronously. VS Code may terminate extension host before child process receives SIGTERM. **Fix**: Make `deactivate()` async, await process termination with safety timeout.

- **Hook port configuration race** — [extension.ts:72-76](apps/vscode/src/extension.ts#L72-L76) — Hooks configured with `serverManager.port` immediately after `onStarted`, but port detection happens asynchronously. Hooks may use wrong port. **Fix**: Await port detection before configuring hooks.

- **Tree view shows stale data after server stop** — [extension.ts:81-86](apps/vscode/src/extension.ts#L81-L86) — `onStopped` handler disconnects WS but doesn't clear tree. Stale agents/sessions displayed. **Fix**: Add `treeProvider.clear()` in `onStopped`.

- **Settings panel HTTP requests lack error feedback** — [settingsPanel.ts:252-277](apps/vscode/src/settingsPanel.ts#L252-L277) — Network failures silently fail; webview UI shows no error. **Fix**: Send error message to webview.

- **Watch mode only covers extension, not server/dashboard** — [esbuild.mjs:28-40](apps/vscode/esbuild.mjs#L28-L40) — `--watch` skips server and dashboard builds. **Fix**: Document limitation or implement multi-target watch.

### Minor Issues (nice to have)

- **Webview template literal bug** — [webviewPanel.ts:144](apps/vscode/src/webviewPanel.ts#L144) — Uses `'${this.port}'` (string literal) instead of `` `${this.port}` `` (template literal). Port number not interpolated.

- **TreeView rebuilds on every event** — [treeView.ts:97-152](apps/vscode/src/treeView.ts#L97-L152) — `handleEvent()` triggers full tree rebuild per event. High-frequency events cause flicker. **Fix**: Debounce rebuild/refresh (250ms).

- **No webview message validation** — [webviewPanel.ts:25-36](apps/vscode/src/webviewPanel.ts#L25-L36) — Messages from iframes not validated against schema. **Fix**: Add type guards.

- **HookManager uses synchronous file I/O** — [hookManager.ts:90-143](apps/vscode/src/hookManager.ts#L90-L143) — `readFileSync`/`writeFileSync` block extension host thread. **Fix**: Use `fs.promises`.

- **Extension doesn't handle multi-root workspaces** — [extension.ts:27](apps/vscode/src/extension.ts#L27) — Assumes `workspaceFolders?.[0]` only.

- **Dependencies all in devDependencies** — [package.json:166-173](apps/vscode/package.json#L166-L173) — Runtime deps like `ws` in devDependencies. Semantically incorrect (works because esbuild bundles everything).

- **Activation events may miss external server** — [package.json:15-18](apps/vscode/package.json#L15-L18) — Only activates on `.claude/settings.json` presence. **Fix**: Add manual activation commands.

- **No rate limiting on fetchAndHydrateIframes** — [extension.ts:235-257](apps/vscode/src/extension.ts#L235-L257) — Called on every WS connect and iframe ready. Rapid reconnections spam server. **Fix**: Debounce with 2s cache.

### Positive Findings

- Excellent process lifecycle management with SIGTERM/SIGKILL fallback
- Good separation of concerns (serverManager, wsClient, hookManager, treeProvider)
- Proper VS Code EventEmitter usage with disposable subscriptions
- CSP restricts frame-src to localhost only
- User-friendly error messages with actionable guidance (e.g., "Download Node.js" button)
- sql.js asm.js integration is correct — zero native dependencies, ~1.18MB VSIX
- Exponential backoff reconnection in WebSocket client

---

## 5. Infrastructure & Build System

### Critical Issues (must fix before production)

**None found.** Build infrastructure is solid.

### Major Issues (should fix soon)

- **58 React components with zero unit tests** — [apps/dashboard/src/components/](apps/dashboard/src/components/) — Only `agentStore.test.ts` exists for the entire React app. Critical components like `AgentGraph.tsx`, `ToolLogPanel.tsx`, `AnalyticsPage.tsx`, all node types untested. **Fix**: Add @testing-library/react tests for graph nodes, panels, and analytics views.

- **No integration test for event pipeline** — The full `hook → POST → DB → WS → client` pipeline has no end-to-end test. **Fix**: Add `packages/server/src/__tests__/eventPipeline.test.ts`.

- **10 server services lack tests** — `importService`, `badgeService`, `budgetService`, `insightsEngine`, `promptAnalyzer`, `velocityService`, `providerNormalizer`, `transcriptReader`, `transcriptCache`, `nudgeEngine`. **Fix**: Prioritize import, nudge, transcript reader.

- **Transcript routes have zero test coverage** — [routes/transcript.ts](packages/server/src/routes/transcript.ts) — `/api/transcript/:sessionId` untested. **Fix**: Add route integration tests.

### Minor Issues (nice to have)

- **ESLint `no-explicit-any` set as warning, not error** — [eslint.config.js:16](eslint.config.js#L16) — Contradicts project convention "No `any` types". **Fix**: Change to `'error'`.

- **Coverage thresholds are low** — [vitest.config.ts:19-24](vitest.config.ts#L19-L24) — 60% statements, 50% branches. Target 75%+ after adding tests.

- **CI doesn't run Playwright E2E tests** — [ci.yml](.github/workflows/ci.yml) — Only unit tests. **Fix**: Add E2E step.

- **No TypeScript project references** — tsconfig files don't use `references` for incremental builds. **Fix**: Add references for build performance.

- **Missing `.prettierrc`** — Relies on defaults. **Fix**: Add explicit config.

- **Server declares `types` in package.json but `declaration: false` in tsconfig** — [server/tsconfig.json:7-8](packages/server/tsconfig.json#L7-L8) — Type declarations won't be generated. **Fix**: Remove `types` field from package.json or enable `declaration: true`.

- **Vite chunking not optimized** — [vite.config.ts:28-30](apps/dashboard/vite.config.ts#L28-L30) — Only `@xyflow/react` manually chunked. `recharts` and `react-dom` in main bundle. **Fix**: Split heavy deps.

- **VS Code extension has zero tests** — Complex logic in `extension.ts` and `serverManager.ts` untested.

- **No Playwright tests for graph interactions** — E2E tests only cover analytics pages.

- **Redundant `onlyBuiltDependencies`** — [pnpm-workspace.yaml:5](pnpm-workspace.yaml#L5) — Duplicated from root `package.json`.

- **`*.db` gitignore too broad** — [.gitignore:5](.gitignore#L5) — Could catch non-synapse `.db` files. **Fix**: Use `synapse.db` specifically.

### Positive Findings

- Workspace configuration correct — all packages use `workspace:*` protocol
- TypeScript strict mode enabled everywhere via `tsconfig.base.json`
- `moduleResolution: "bundler"` used consistently
- Core package has zero deps except Zod — clean dependency boundary
- Husky + lint-staged ensures quality at commit time
- CI pipeline runs typecheck, lint, test, build, audit on every push/PR
- Build order correct: core → server, dashboard
- VS Code extension multi-stage esbuild pipeline is sophisticated
- Hot reload works: Vite HMR for dashboard, tsx watch for server
- Server test coverage is excellent (10 comprehensive test files, 3400+ lines)
- Test isolation robust — unique temp DB per test, cleanup in afterEach

---

## 6. Security Audit

### Critical Security Issues (must fix immediately)

- **Path traversal in transcript reader** — [transcriptReader.ts:14-49](packages/server/src/services/transcriptReader.ts#L14-L49) — `sessionId` parameter used directly in path construction. `../../` sequences escape the expected directory. **Fix**: Validate `sessionId` against `/^[a-zA-Z0-9_-]+$/`, use `path.resolve()` + check it starts with expected prefix.

- **Snapshot import injects arbitrary events** — [snapshot.ts:99-161](packages/server/src/routes/snapshot.ts#L99-L161) — 50MB payload limit with minimal per-event validation. Malicious events with XSS payloads, session ID hijacking, or memory-busting strings inserted directly. **Fix**: Per-event Zod validation, 100KB per-event size limit, sanitize text fields.

- **No session isolation — multi-user data leakage** — [events.ts:36-46](packages/server/src/routes/events.ts#L36-L46) — All clients can query all events from all sessions. User A can read/manipulate User B's agents, prompts, and tool outputs. **Fix**: Add tenant isolation OR document as single-user-only and bind to `127.0.0.1` exclusively.

### Major Security Issues (fix before production)

- **Authentication disabled by default** — [auth.ts:4-15](packages/server/src/lib/auth.ts#L4-L15) — When `SYNAPSE_API_KEY` is not set, all endpoints are fully open. Single shared key, no rotation, no per-user auth. **Fix**: Require auth by default (fail-closed), support multiple keys.

- **WebSocket auth via URL query param** — [index.ts:90-102](packages/server/src/index.ts#L90-L102) — Token in URL is logged by proxies, visible in browser history. No message authentication after connection. No origin validation. **Fix**: Use WS subprotocol for auth, validate origin, add per-client message rate limiting.

- **CORS wildcard in development** — [app.ts:36-53](packages/server/src/app.ts#L36-L53) — `CORS_ORIGIN=*` allows any website to call the API. Combined with no-auth-by-default, enables CSRF attacks. **Fix**: Never allow `*` in production, strict whitelist only.

- **Insufficient rate limiting on critical endpoints** — Multiple files — DELETE endpoints share 300/min general pool (can wipe DB). Analytics queries (expensive) not separately limited. WebSocket has no rate limiting. Import at 50MB × 300/min = 15GB/hour. **Fix**: Per-endpoint limits (5/min for DELETE/import), per-IP tracking, WS message rate limiting.

- **Analytics import has no size validation** — [analytics.ts:810-835](packages/server/src/routes/analytics.ts#L810-L835) — Accepts arbitrary CSV/JSON payloads for import. **Fix**: Explicit size validation, CSV row limits.

### Minor Security Issues (hardening)

- **Error responses leak internal details** — Some catch blocks return `err.message` directly. Could expose file paths, schema details.
- **Hook script has theoretical command injection** — [send_event.cjs:14-31](hooks/send_event.cjs#L14-L31) — `parseInt()` mitigates but port should be explicitly validated as 1-65535.
- **Spawn agent CWD validates `..` but allows absolute paths** — [schemas.ts:42](packages/core/src/schemas.ts#L42) — `/etc` or `C:\Windows` still allowed. **Fix**: Require relative paths.
- **No WebSocket message size limit** — ws library defaults to 100MB. Should be 1MB.
- **Transcript cache has no eviction** — Unbounded Map grows with enumerated session IDs. **Fix**: LRU with 10k max.
- **DB pruning can be disabled** — Environment variables allow unbounded DB growth.

### Security Positive Findings

- All SQL queries are parameterized — zero injection vectors
- `timingSafeEqual` prevents timing attacks on API key comparison
- No `eval()` or `Function()` anywhere in the backend
- No `dangerouslySetInnerHTML` in dashboard — React escaping prevents XSS
- Comprehensive Zod validation on all API inputs
- No secrets logged — verified via grep
- `pnpm-lock.yaml` exists preventing dependency confusion
- Request body size limits in place (1MB default, 50MB snapshot)

---

## 7. User Experience

### Major Issues (should fix soon)

- **ConfirmDialog lacks focus trap** — [ConfirmDialog.tsx:12-50](apps/dashboard/src/components/ConfirmDialog.tsx#L12-L50) — Keyboard users can tab out of dialog and interact with background content. Violates ARIA dialog pattern. **Fix**: Add focus trap with `focus-trap-react` or manual focus cycling.

- **GraphSearchBox input has no accessible label** — [GraphSearchBox.tsx:20-34](apps/dashboard/src/components/graph/GraphSearchBox.tsx#L20-L34) — `placeholder` exists but no `<label>` or `aria-label`. Screen readers can't identify the input. **Fix**: Add `aria-label="Search graph nodes"`.

- **Toast container lacks screen reader announcements** — [Toast.tsx:78](apps/dashboard/src/components/Toast.tsx#L78) — Has `role="status" aria-live="polite"` but individual toasts lack accessible text. Add `aria-atomic="true"`.

- **SpawnAgentDialog doesn't restore focus on close** — [SpawnAgentDialog.tsx:76-80](apps/dashboard/src/components/panels/SpawnAgentDialog.tsx#L76-L80) — Auto-focuses textarea (good), but doesn't return focus to trigger element on close. Breaks keyboard flow.

- **ErrorBoundary retry doesn't manage focus** — [ErrorBoundary.tsx:37-42](apps/dashboard/src/components/ErrorBoundary.tsx#L37-L42) — Focus lost when error renders. **Fix**: Auto-focus retry button.

### Minor Issues (nice to have)

- **Toast auto-dismiss too fast** — [Toast.tsx:50-55](apps/dashboard/src/components/Toast.tsx#L50-L55) — 3 seconds. WCAG 2.1 AAA recommends 5s+. **Fix**: Increase to 5s or pause on hover.

- **Keyboard shortcuts hidden on small screens** — [Header.tsx:197-208](apps/dashboard/src/components/layout/Header.tsx#L197-L208) — Hints only visible on `lg` breakpoint. **Fix**: Add "?" button for shortcuts dialog.

- **Empty state lacks actionable next steps** — [AgentGraph.tsx:561-570](apps/dashboard/src/components/graph/AgentGraph.tsx#L561-L570) — Says "run a simulation script" but no button or link. **Fix**: Add a "Run simulation" button.

- **Graph loading placeholder has no spinner** — [GraphLayout.tsx:12-17](apps/dashboard/src/components/layout/GraphLayout.tsx#L12-L17) — Static "Loading graph..." text.

- **ConfirmDialog backdrop-click for destructive actions** — [ConfirmDialog.tsx:29](apps/dashboard/src/components/ConfirmDialog.tsx#L29) — Too easy to accidentally dismiss "Clear All Events" dialog.

- **useBreakpoint lacks resize debouncing** — [useBreakpoint.ts:15-19](apps/dashboard/src/hooks/useBreakpoint.ts#L15-L19) — Fires on every resize event.

- **OverflowToggle color-only state indicator** — [Header.tsx:498-508](apps/dashboard/src/components/layout/Header.tsx#L498-L508) — Colored dot may not be visible to colorblind users. **Fix**: Add screen-reader-only on/off text.

### Positive Findings

- Excellent skip-to-main-content link (rare and exemplary)
- Proper ARIA landmarks: `<nav>`, `<main>`, `role="banner"`, `aria-label`
- Server-down banner with clear feedback and retry affordance
- Toast click-to-navigate jumps directly to relevant node (innovative)
- Responsive design with breakpoints and overflow menu
- Error boundaries at component level prevent full-page crashes
- Loading states with spinners for async operations
- Auto-focus management in spawn dialog
- Keyboard shortcuts well-documented in CLAUDE.md and Header

---

## 8. Code Quality & Maintainability

### Major Issues (should fix soon)

- **Duplicated tree traversal logic** — [AgentGraph.tsx:78-82, 214-226](apps/dashboard/src/components/graph/AgentGraph.tsx#L78-L82) and [useAutoLayout.ts:50-63](apps/dashboard/src/hooks/useAutoLayout.ts#L50-L63) — `childrenOf`/`parentOf` map building and ancestor walking duplicated. **Fix**: Extract to `utils/graphTraversal.ts`.

- **Magic number duplication** — [useAutoLayout.ts:14-28](apps/dashboard/src/hooks/useAutoLayout.ts#L14-L28) and [AgentGraph.tsx:109](apps/dashboard/src/components/graph/AgentGraph.tsx#L109) — `MAX_STACKED_PREVIEW = 5` defined in one file, hardcoded as `5` in another. **Fix**: Export constant from single source.

- **Coaching type creates cross-domain coupling** — [agent.ts:130](packages/core/src/types/agent.ts#L130) — `WsServerMessage` imports `CoachingNudge` via dynamic import. Consider extracting to shared base types.

### Minor Issues (nice to have)

- **agentStore is 579 lines** — [agentStore.ts](apps/dashboard/src/store/agentStore.ts) — Mixes store, selectors, actions, WS wiring. **Fix**: Consider splitting into focused modules.

- **Inconsistent type guards vs assertions** — [AgentGraph.tsx:282, 403](apps/dashboard/src/components/graph/AgentGraph.tsx#L282) — Uses `as unknown as {...}` instead of proper narrowing. **Fix**: Define proper types or use type guards.

- **Toast styling could use lookup object** — [Toast.tsx:82-90](apps/dashboard/src/components/Toast.tsx#L82-L90) — Four conditional class strings. **Fix**: `TOAST_STYLES: Record<ToastType, string>`.

- **formatTime locale inconsistency** — [format.ts:50](packages/core/src/utils/format.ts#L50) — `toLocaleTimeString(undefined)` uses system locale. `formatElapsed()` uses hardcoded "5m 23s". Decide on one approach.

- **formatTokens doesn't handle 10M+** — [format.ts:3-9](packages/core/src/utils/format.ts#L3-L9) — Numbers above 10M display as "1.0M" instead of "10M".

### Positive Findings

- No `any` types detected across entire codebase
- Clean package boundaries — all cross-package imports use `@synapse-ai/core`
- Zod 4 compatibility handled correctly (explicit key+value in `z.record()`)
- Comprehensive type exports with clear domain organization
- Consistent use of `useMemo`/`useCallback` for expensive computations
- Zero `console.log` in server — all logging via pino
- Binary search, BFS traversal, memoized adjacency maps — well-engineered algorithms

---

## 9. Testing Gaps

### Current Coverage Estimate

| Package | Estimated Coverage | Test Files |
|---|---|---|
| `packages/core` | ~95% | 1 (validation.test.ts — 223 lines) |
| `packages/server` | ~70% | 10 files (3,400+ lines total) |
| `apps/dashboard` | ~5% | 2 (agentStore.test.ts — 558 lines, format.test.ts) |
| `apps/vscode` | 0% | None |
| **Overall** | **~40-50%** | |

### Tested (Server — Excellent)

- Schema validation, DB CRUD, event normalization, broadcaster, agent manager
- Cost service, analytics routes, coaching routes, report card engine
- All routes integration tested, auth tested, snapshot import/export tested

### Critical Gaps

1. **Zero React component tests** (58 components)
2. **Event pipeline integration test** (hook → DB → WS → client)
3. **10 untested server services** (import, nudge, insights, budget, badge, velocity, prompt analyzer, provider normalizer, transcript reader/cache)
4. **Transcript routes untested**
5. **VS Code extension untested** (complex lifecycle logic)
6. **No graph interaction E2E tests**

### Prioritized Test Plan

**Phase 1 — Critical Path (2-4 days)**
1. Event pipeline integration test (2-4h)
2. Graph node component tests: AgentNode, ToolCallNode, SessionNode, UserPromptNode (4-6h)
3. Untested services: importService, nudgeEngine, transcriptReader (6-8h)
4. WebSocket client tests (2-3h)

**Phase 2 — Analytics & UI (3-5 days)**
5. Analytics components: AnalyticsPage, ExecutiveOverview, DeepDiveExplorer (6-8h)
6. Services: insightsEngine, badgeService, budgetService, velocityService (4-6h)
7. Panel components: ToolLogPanel, AgentDetailPanel, TimelinePanel (4-5h)

**Phase 3 — Edge Cases (3-4 days)**
8. Graph E2E tests (4-6h)
9. Remaining services + transcript routes (3-4h)
10. VS Code extension tests (4-6h)
11. Lens views (3-4h)
12. Utility functions and hooks (2-3h)

**Total estimated effort**: ~44-63 hours (1-1.5 weeks)

---

## 10. Localization & Internationalization

### Major Issues

- **All user-facing strings hardcoded** — Hundreds of strings across components ("Loading events...", "Export failed", "Clear All"). Adding i18n requires touching every file. **Fix**: Wrap with `t()` function, start with high-traffic strings.

- **Inconsistent date/time formatting** — `formatTime()` uses `toLocaleTimeString()` (locale-aware) but `formatElapsed()` uses hardcoded "5m 23s". Decide on consistent approach.

### Minor Issues

- **Number formats not locale-sensitive** — `formatTokens()` uses "1.5k" / "2.3M" with hardcoded decimal separator. German users expect "1,5k". **Fix**: Use `Intl.NumberFormat`.

- **Export filename uses ISO timestamp** — Locale-neutral but may confuse some users.

### i18n Roadmap (if needed)

1. Wrap all UI strings with `t('key')` using `react-i18next` (~2-3 days)
2. Extract to `locales/en.json`, add target locales (~1 day)
3. Locale-aware formatting via `Intl` APIs (~1 day)
4. RTL support with `dir="rtl"` conditional styling (~1 day)
5. Pluralization rules (~0.5 day)

### Positive Findings

- No locale-specific string concatenation patterns
- Unicode/emoji usage confined to `KIND_ICONS` — easily swappable

---

## Top 10 Priority Fixes

Ranked by severity × blast radius:

| # | Issue | Category | Severity | Blast Radius |
|---|---|---|---|---|
| 1 | **Path traversal in transcript reader** | Security | Critical | Server compromise |
| 2 | **Snapshot import injects unvalidated events** | Security | Critical | Data integrity + XSS |
| 3 | **Unbounded queries (getEventsBySession/Agent)** | Server | Critical | OOM crash |
| 4 | **Extension activation blocks VS Code 10s** | Extension | Critical | Every user, every startup |
| 5 | **No auth by default (fail-open)** | Security | Major | Full API exposure |
| 6 | **No session isolation** | Security | Major | Multi-user data leak |
| 7 | **CORS wildcard allows CSRF** | Security | Major | Remote attack vector |
| 8 | **Webview CSP allows unsafe-inline** | Extension | Critical | Script injection vector |
| 9 | **DB save timer delays persistence** | Server | Major | Data loss on crash |
| 10 | **ConfirmDialog lacks focus trap** | UX/A11y | Major | Accessibility blocker |

---

## Architecture Recommendations

1. **Fail-closed authentication** — Require `SYNAPSE_API_KEY` by default. Make the no-auth mode opt-in via `SYNAPSE_NO_AUTH=true` with a startup warning. Consider JWT for multi-user.

2. **Session/tenant isolation** — Add a `tenant_id` column or use per-user SQLite databases. Essential before any shared deployment.

3. **Input validation at import boundaries** — Validate every imported event against `AgentEventSchema`. Add per-event and per-import size limits. This is the single highest-risk attack surface.

4. **WebSocket message buffering** — Add requestAnimationFrame batching on the client and backpressure-aware streaming on the server to handle high-frequency events gracefully.

5. **Extract graph traversal utilities** — Deduplicate `childrenOf`/`parentOf` map building, ancestor walking, and BFS traversal into `utils/graphTraversal.ts`. Used in 3+ files.

6. **Non-blocking extension activation** — Fire-and-forget server startup with event-based readiness notification. This is the single most impactful UX improvement for VS Code users.

7. **Nonce-based CSP for webviews** — Generate per-render nonces instead of relying on `unsafe-inline`. VS Code security best practice.

8. **Explicit pagination everywhere** — No query should return unbounded results. Add server-side maximum limits that can't be overridden by clients.

---

## Performance Optimization Roadmap

Ordered by impact:

| # | Optimization | Impact | Effort |
|---|---|---|---|
| 1 | **Add LIMIT to all unbounded queries** | Prevents OOM under load | 2h |
| 2 | **Non-blocking extension activation** | 10s startup savings per session | 1h |
| 3 | **WebSocket message batching (rAF)** | Smoother UI under high event rate | 4h |
| 4 | **DB save max-wait timer** | Prevents persistence delay under load | 1h |
| 5 | **Add `tool_use_id` index** | Faster analytics tool pairing queries | 0.5h |
| 6 | **Async transcript directory scan** | Unblocks event loop for multi-project users | 2h |
| 7 | **Debounce TreeView rebuild** | Reduces VS Code UI flicker | 1h |
| 8 | **Vite chunk splitting (recharts, react-dom)** | Faster initial dashboard load | 1h |
| 9 | **Virtual scrolling for analytics tables** | Handles 1000+ row tables smoothly | 4h |
| 10 | **TypeScript project references** | Faster incremental builds | 2h |
