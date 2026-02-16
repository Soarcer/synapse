# Synapse — Comprehensive Code Review Prompt

Give this prompt to your AI coding assistant for a world-class review.

---

## Prompt

You are performing a comprehensive code review of **Synapse**, an interactive agent orchestration dashboard built as a pnpm monorepo. The project monitors, visualizes, and controls Claude AI agents in real-time using a React Flow node graph, Express + SQLite backend, WebSocket real-time layer, and a VS Code extension. Your review must be exhaustive, actionable, and organized by severity.

### Project Context

- **Monorepo structure**: `packages/core` (shared types + Zod schemas), `packages/server` (Express 5 + sql.js + WebSocket), `apps/dashboard` (React 19 + React Flow v12 + Zustand 5 + Tailwind 4), `apps/vscode` (VS Code extension with embedded server + dashboard)
- **Key data flow**: Claude Code hooks → `hooks/send_event.cjs` → POST `/api/events` → SQLite → WebSocket broadcast → React Flow graph
- **Agent SDK flow**: User spawns agent → POST `/api/agents/spawn` → Claude Agent SDK streaming → events emitted → same WS/graph pipeline
- **Tech**: TypeScript throughout, Zod 4 for validation, Pino logging, sql.js (WASM SQLite), Vite 6, esbuild for extension bundling

### Review Scope — Evaluate ALL of the following areas in depth:

---

#### 1. SERVER CODE QUALITY & ARCHITECTURE

Read and evaluate every file in `packages/server/src/`:

- **`index.ts`** — Express app setup, middleware ordering, CORS configuration, rate limiting, auth middleware, WebSocket upgrade handling, graceful shutdown logic, static file serving
- **`db.ts`** — sql.js initialization, schema definition, migration logic, query helpers, auto-persistence, connection lifecycle
- **Routes** (`routes/events.ts`, `routes/agents.ts`, `routes/transcript.ts`, `routes/snapshot.ts`):
  - Are endpoints RESTful with consistent response envelopes?
  - Is input validation applied to every endpoint that accepts data?
  - Are error responses structured, informative, and safe (no internal details leaked)?
  - Is pagination implemented correctly? Are there unbounded queries?
  - Are HTTP status codes used correctly (201 for creates, 404 for not found, 429 for rate limits)?
- **Services** (`services/broadcaster.ts`, `services/agentManager.ts`, `services/eventStore.ts`, `services/transcriptReader.ts`):
  - Is the WebSocket broadcaster handling backpressure, heartbeats, max clients, and dead client cleanup correctly?
  - Does the agent manager properly enforce concurrency limits, timeouts, and graceful cancellation?
  - Is event normalization from Claude Code hooks to internal types correct and complete?
  - Are there any race conditions in concurrent agent operations?
- **Libraries** (`lib/auth.ts`, `lib/logger.ts`, `lib/validate.ts`):
  - Is auth middleware secure? What happens when `SYNAPSE_API_KEY` is not set?
  - Is Zod validation middleware reusable and correct?
  - Are there any middleware ordering issues?

**Specific questions to answer:**
- Can a malicious client exhaust server resources via unbounded queries or oversized payloads?
- Is the database schema properly indexed for the query patterns used?
- Are there any silent error swallowing (bare `catch {}`) that should be logged?
- Is the graceful shutdown sequence correct — does it drain connections, stop agents, persist DB, then exit?

---

#### 2. CLIENT CODE QUALITY & ARCHITECTURE

Read and evaluate every file in `apps/dashboard/src/`:

- **State management** (`store/agentStore.ts`, `store/eventHandlers.ts`, `store/wsClient.ts`):
  - Is the Zustand store properly normalized? Are derived maps computed efficiently?
  - Are there any infinite re-render risks from selectors returning new references?
  - Does the WebSocket client handle all edge cases (disconnect, reconnect, message ordering, backpressure)?
  - Are events dropped when paused? Should they be queued instead?
  - Is the 1000-event cap appropriate? Are users warned when events are being dropped?
- **Graph layer** (`components/graph/`):
  - Is React Flow configured for performance with large graphs (500+ nodes)?
  - Is the auto-layout algorithm (`hooks/useAutoLayout.ts`) efficient? Does it avoid unnecessary recalculations?
  - Are node types properly memoized to prevent re-renders?
  - Is search/filter debounced? Does it avoid full graph recomputation on every keystroke?
- **Panels** (`components/panels/`):
  - Do panels handle empty, loading, and error states consistently?
  - Is the SpawnAgentDialog input validation thorough?
  - Are tool detail renderers safe from XSS when displaying tool input/output?
- **Lens views** (`components/lens/`):
  - Are lens computations memoized or recalculated on every render?
  - Do views handle edge cases (no data, single event, thousands of events)?
  - Is the resizable panel implementation accessible?
- **Error handling**:
  - Are Error Boundaries placed around every major section?
  - Do async operations (fetch, WS) have proper try/catch with user-facing error messages?
  - Is there retry logic for transient failures?

**Specific questions to answer:**
- What happens when a user has 50+ agents with 500+ tool calls? Does the UI remain responsive?
- Are there any memory leaks (event listeners not cleaned up, intervals not cleared)?
- Does the app gracefully handle the server being unavailable at startup?

---

#### 3. CALLING PATTERNS & DATA FLOW

Trace these end-to-end flows and identify any issues:

1. **Hook event ingestion**: Claude Code hook fires → `hooks/send_event.cjs` reads stdin → POST to `/api/events` → Zod validation → `normalizeHookPayload()` → SQLite insert → WebSocket broadcast → frontend `addEvent()` → node/edge creation → React Flow render
2. **Agent SDK spawning**: User clicks Spawn → `SpawnAgentDialog` → POST `/api/agents/spawn` → `agentManager.spawn()` → Claude Agent SDK → streaming events → `broadcaster.broadcast()` → frontend processes events
3. **Snapshot export/import**: Header export button → GET `/api/snapshot/export` → query all events → JSON blob → download. Import: file upload → POST `/api/snapshot/import` → validate → insert events → respond
4. **WebSocket lifecycle**: Frontend connects → `wsClient.connect()` → server adds client → heartbeat ping/pong → disconnect → exponential backoff reconnect → `reloadAllEvents()` on reconnect
5. **Transcript parsing**: GET `/api/transcript/:sessionId` → scan `~/.claude/projects/` for JSONL files → parse messages → compute token usage → return summary

**Specific questions to answer:**
- Are there any race conditions in the event processing pipeline?
- Can events arrive out of order? If so, does the system handle it?
- What happens if the backend restarts while agents are running?
- Is the WebSocket reconnection logic correct — does it restore full state or could events be missed?
- Are there any circular dependencies between modules?

---

#### 4. VS CODE EXTENSION

Read and evaluate every file in `apps/vscode/src/`:

- **`extension.ts`** — Activation, command registration, cross-panel sync, server lifecycle management
- **`serverManager.ts`** — Child process spawning, port allocation, health checks, auto-start
- **`webviewPanel.ts`** — Editor panel webview creation, iframe communication, selection sync
- **`sidebarProvider.ts`** — Sidebar webview, event relay
- **`treeView.ts`** — Explorer tree view for agents/sessions
- **`wsClient.ts`** — WebSocket client for extension
- **`hookManager.ts`** — Hook installation/removal in `.claude/settings.json`
- **`esbuild.mjs`** — Build pipeline bundling server + dashboard + extension

**Specific questions to answer:**
- Is the extension activation efficient? Does it avoid blocking the VS Code startup?
- Is the embedded server properly lifecycle-managed (start, stop, health check, restart)?
- Are webviews properly secured (CSP, message validation, no arbitrary script execution)?
- Does the tree view update efficiently when events arrive?
- Is the esbuild configuration correct for VS Code extension constraints (CommonJS, no WASM)?
- Are there resource leaks (processes not killed, WS not disconnected on deactivation)?

---

#### 5. INFRASTRUCTURE & BUILD SYSTEM

- **pnpm workspaces** — Is the workspace configuration correct? Are inter-package dependencies properly declared?
- **TypeScript** — Are `tsconfig.json` files consistent? Is strict mode enabled everywhere? Are there any `any` types?
- **Vite** — Is the dev proxy configured correctly? Is chunking optimal? Are there any bundle size concerns?
- **esbuild** — Is the VS Code extension build correct? Are server dependencies properly bundled?
- **Testing** — What is the test coverage? Are there critical paths without tests? Is the test infrastructure (vitest) properly configured?
- **Linting** — Is ESLint configured correctly? Are there any disabled rules that should be enabled?
- **CI/CD** — Is there a CI pipeline? If not, what should one include?

---

#### 6. SECURITY AUDIT

- **Authentication**: Is the optional API key auth secure? What about timing attacks?
- **Authorization**: Is there session isolation? Can client A see client B's events?
- **Input validation**: Are all inputs validated with Zod? Are there size limits on payloads?
- **SQL injection**: Are all queries parameterized?
- **XSS**: Is user-controlled content (tool input/output, agent text) safely rendered?
- **CORS**: Is the CORS configuration secure? Does it fall back to permissive defaults?
- **WebSocket**: Is there auth on WS upgrade? Message size limits? Rate limiting per connection?
- **Path traversal**: Can the transcript reader or snapshot import access files outside expected directories?
- **Dependency audit**: Are there known vulnerabilities in dependencies?
- **Secrets**: Are any secrets (API keys, tokens) exposed in code, logs, or error messages?

---

#### 7. USER EXPERIENCE

- **Accessibility (a11y)**: ARIA labels, keyboard navigation, focus management, screen reader support, color contrast
- **Loading states**: Skeleton loaders, progress indicators, optimistic updates
- **Empty states**: What does the UI show when there are no sessions, no agents, no events?
- **Error states**: User-facing error messages, retry affordances, degraded functionality indicators
- **Responsiveness**: Does the UI work at different viewport sizes? Is the graph usable on smaller screens?
- **Performance perception**: Are there any operations that feel slow? Could they be optimistic?
- **Keyboard shortcuts**: Are they documented, discoverable, and non-conflicting?
- **Onboarding**: What does a first-time user see? Is there guidance?

---

#### 8. CODE QUALITY & MAINTAINABILITY

- **Code reuse**: Are there duplicated patterns that should be extracted into shared utilities?
- **Naming**: Are names consistent and descriptive across packages?
- **Module boundaries**: Are package responsibilities clear? Is there any circular coupling?
- **Type safety**: Are there any type assertions (`as`) or non-null assertions (`!`) that could be eliminated?
- **Dead code**: Are there unused exports, components, or utilities?
- **Comments**: Are complex algorithms documented? Are there misleading or outdated comments?
- **Consistency**: Are patterns (error handling, logging, validation) applied uniformly?

---

#### 9. TESTING GAPS

Current test files:
- `packages/core/src/__tests__/validation.test.ts` (schema validation)
- `packages/server/src/__tests__/broadcaster.test.ts` (WS broadcasting)
- `packages/server/src/__tests__/eventStore.test.ts` (event normalization)
- `packages/server/src/__tests__/agentManager.test.ts` (agent lifecycle)
- `apps/dashboard/src/store/__tests__/agentStore.test.ts` (Zustand store)
- `apps/dashboard/src/utils/__tests__/format.test.ts` (format utilities)

**Identify gaps:**
- Which server routes have no test coverage?
- Which React components need tests most urgently?
- Are there integration tests for the full event pipeline?
- Are there E2E tests for user workflows?
- What's the approximate code coverage percentage?
- Propose a prioritized test plan (what to test first for maximum risk reduction).

---

#### 10. LOCALIZATION & INTERNATIONALIZATION

- Are there any hardcoded user-facing strings that should be extracted?
- Is the date/time formatting locale-aware?
- Are number formats (tokens, durations) locale-sensitive?
- Is the UI direction (LTR/RTL) handled?
- What would it take to add i18n support?

---

### Output Format

Organize your findings as:

```
## [Category Name]

### Critical Issues (must fix before production)
- **[Issue title]** — [File:line] — [Description] — [Recommended fix]

### Major Issues (should fix soon)
- ...

### Minor Issues (nice to have)
- ...

### Positive Findings (things done well)
- ...
```

End with:
- **Top 10 Priority Fixes** — ranked by severity × blast radius
- **Architecture Recommendations** — any structural changes that would improve the system
- **Test Plan** — prioritized list of tests to write next
- **Performance Optimization Roadmap** — ordered by impact

Be specific. Reference exact file paths and line numbers. Propose concrete fixes, not vague suggestions.
