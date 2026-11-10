# Screenshot Pipeline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a repeatable Playwright-based screenshot pipeline that captures 19 shots of the Synapse dashboard across graph, lens, feature, and mobile views.

**Architecture:** A single `scripts/capture_screenshots.ts` script clears existing events, seeds a visually optimized simulation with 500ms-paced event injection, then navigates the dashboard through 19 distinct view states, capturing each as PNG + WebP at 2x retina. A QA gallery (`index.html`) is generated for visual review.

**Tech Stack:** Playwright (library API, not test runner), TypeScript, fetch API for event seeding

**Spec:** `docs/superpowers/specs/2026-03-27-screenshot-pipeline-design.md`

---

## File Structure

| Action | File | Responsibility |
|--------|------|----------------|
| Create | `scripts/capture_screenshots.ts` | Main capture orchestrator — clears, seeds, navigates, screenshots |
| Create | `scripts/screenshot_simulation.ts` | Simulation data builder — constructs and injects the 35 events |
| Create | `scripts/screenshot_gallery.ts` | Generates `assets/screenshots/index.html` QA gallery |
| Create | `assets/screenshots/.gitkeep` | Ensure output directory exists in repo |

---

### Task 1: Install Playwright and Create Output Directories

**Files:**
- Modify: `package.json` (root)
- Create: `assets/screenshots/.gitkeep`
- Modify: `.gitignore`

- [ ] **Step 1: Install playwright as root devDependency**

```bash
pnpm add -Dw playwright
```

- [ ] **Step 2: Install Chromium browser binary**

```bash
npx playwright install chromium
```

- [ ] **Step 3: Create output directory structure**

Create `assets/screenshots/.gitkeep`:

```
```

(Empty file — just a marker to keep the directory in git.)

- [ ] **Step 4: Add screenshot output to .gitignore**

Add to `.gitignore`:

```
# Screenshot pipeline output (regenerated via scripts/capture_screenshots.ts)
assets/screenshots/**/*.png
assets/screenshots/**/*.webp
assets/screenshots/index.html
!assets/screenshots/.gitkeep
```

- [ ] **Step 5: Verify playwright is available**

```bash
npx playwright --version
```

Expected: Version number printed (e.g., `1.52.0`)

- [ ] **Step 6: Commit**

```bash
git add package.json pnpm-lock.yaml assets/screenshots/.gitkeep .gitignore
git commit -m "chore: add playwright devDependency and screenshot output directory"
```

---

### Task 2: Build the Simulation Data Seeder

**Files:**
- Create: `scripts/screenshot_simulation.ts`

This file exports a `seedSimulation()` function that POSTs ~35 events to the hook server with 500ms delays. It also exports `clearAllEvents()`.

- [ ] **Step 1: Create `scripts/screenshot_simulation.ts`**

```typescript
/**
 * Screenshot simulation seeder.
 * Injects a visually optimized "Multi-Agent Code Review" session
 * with 500ms delays between events for realistic timing.
 *
 * Usage: imported by capture_screenshots.ts — not run directly.
 */

const HOOK_API = 'http://localhost:27247/api/events';
const REST_API = 'http://localhost:27246/api/events';

const ts = Date.now().toString(36);
const SESSION_ID = `screenshot-${ts}`;
const CWD = 'c:/Workspace/Coding/Prototypes/Synapse';

// Agent IDs
const A1_ID = `agent-security-${ts}`;
const A2_ID = `agent-dbrefactor-${ts}`;
const A3_ID = `agent-migration-${ts}`;
const A4_ID = `agent-unittest-${ts}`;
const A5_ID = `agent-integration-${ts}`;
const A6_ID = `agent-coverage-${ts}`;

// Unique tool IDs
let toolSeq = 0;
function toolId(prefix: string): string {
  return `toolu_${prefix}_${++toolSeq}_${ts}`;
}

interface HookPayload {
  hook_event_name: string;
  session_id: string;
  cwd?: string;
  [key: string]: unknown;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

let eventCount = 0;

async function post(payload: HookPayload, label: string): Promise<void> {
  eventCount++;
  const res = await fetch(HOOK_API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const ok = res.ok ? '\x1b[32mOK\x1b[0m' : `\x1b[31m${res.status}\x1b[0m`;
  console.log(`  ${eventCount.toString().padStart(2)}. [${ok}] ${label}`);
}

export async function clearAllEvents(): Promise<void> {
  console.log('\x1b[36m── Clearing all events ──\x1b[0m');
  const res = await fetch(REST_API, { method: 'DELETE' });
  if (!res.ok) throw new Error(`DELETE /api/events failed: ${res.status}`);
  const body = await res.json();
  console.log(`  Deleted ${body.deleted ?? 0} events\n`);
}

export async function seedSimulation(): Promise<{ sessionId: string; expectedNodeCount: number }> {
  console.log(`\x1b[1m=== Screenshot Simulation ===\x1b[0m`);
  console.log(`  Session: ${SESSION_ID}\n`);

  const DELAY = 500;

  // ── Session Start ──
  console.log('\x1b[36m── Session ──\x1b[0m');
  await post({
    hook_event_name: 'SessionStart',
    session_id: SESSION_ID,
    cwd: CWD,
    permission_mode: 'default',
    source: 'startup',
    model: 'claude-opus-4-6',
    git_branch: 'feat/auth-refactor',
    transcript_path: `~/.claude/projects/sim/${SESSION_ID}.jsonl`,
  }, 'SessionStart');
  await sleep(DELAY);

  // ═══════════════════════════════════════════════════════════════
  // PROMPT 1: "Analyze the auth module for security vulnerabilities"
  // Agent A1: Security audit — success, 4 tools (Read×2, Grep, Bash)
  // ═══════════════════════════════════════════════════════════════
  console.log('\n\x1b[36m── Prompt 1: Security Audit ──\x1b[0m');
  await post({
    hook_event_name: 'UserPromptSubmit',
    session_id: SESSION_ID,
    cwd: CWD,
    prompt: 'Analyze the auth module for security vulnerabilities',
  }, 'Prompt 1');
  await sleep(DELAY);

  // A1: Security audit agent
  await post({
    hook_event_name: 'SubagentStart',
    session_id: SESSION_ID,
    cwd: CWD,
    agent_id: A1_ID,
    agent_type: 'Explore',
  }, 'A1 Start (Security Audit)');
  await sleep(DELAY);

  // A1 Tool 1: Read auth.ts
  const a1r1 = toolId('read');
  await post({
    hook_event_name: 'PreToolUse',
    session_id: SESSION_ID,
    cwd: CWD,
    agent_id: A1_ID,
    tool_name: 'Read',
    tool_use_id: a1r1,
    tool_input: { file_path: 'server/lib/auth.ts' },
  }, 'A1: Read auth.ts');
  await sleep(DELAY);
  await post({
    hook_event_name: 'PostToolUse',
    session_id: SESSION_ID,
    cwd: CWD,
    agent_id: A1_ID,
    tool_name: 'Read',
    tool_use_id: a1r1,
    tool_input: { file_path: 'server/lib/auth.ts' },
    tool_response: { content: 'import { verify } from "jsonwebtoken";\nexport function validateToken(token: string) { ... }' },
  }, 'A1: Read auth.ts ✓');
  await sleep(DELAY);

  // A1 Tool 2: Read middleware.ts
  const a1r2 = toolId('read');
  await post({
    hook_event_name: 'PreToolUse',
    session_id: SESSION_ID,
    cwd: CWD,
    agent_id: A1_ID,
    tool_name: 'Read',
    tool_use_id: a1r2,
    tool_input: { file_path: 'server/middleware/auth.ts' },
  }, 'A1: Read middleware.ts');
  await sleep(DELAY);
  await post({
    hook_event_name: 'PostToolUse',
    session_id: SESSION_ID,
    cwd: CWD,
    agent_id: A1_ID,
    tool_name: 'Read',
    tool_use_id: a1r2,
    tool_input: { file_path: 'server/middleware/auth.ts' },
    tool_response: { content: 'export const authMiddleware = (req, res, next) => { ... }' },
  }, 'A1: Read middleware.ts ✓');
  await sleep(DELAY);

  // A1 Tool 3: Grep for SQL injection patterns
  const a1g1 = toolId('grep');
  await post({
    hook_event_name: 'PreToolUse',
    session_id: SESSION_ID,
    cwd: CWD,
    agent_id: A1_ID,
    tool_name: 'Grep',
    tool_use_id: a1g1,
    tool_input: { pattern: 'req\\.query|req\\.params.*sql', path: 'server/' },
  }, 'A1: Grep SQL patterns');
  await sleep(DELAY);
  await post({
    hook_event_name: 'PostToolUse',
    session_id: SESSION_ID,
    cwd: CWD,
    agent_id: A1_ID,
    tool_name: 'Grep',
    tool_use_id: a1g1,
    tool_input: { pattern: 'req\\.query|req\\.params.*sql' },
    tool_response: { matches: ['server/routes/users.ts:45: const id = req.params.id;'] },
  }, 'A1: Grep ✓');
  await sleep(DELAY);

  // A1 Tool 4: Bash — run security linter
  const a1b1 = toolId('bash');
  await post({
    hook_event_name: 'PreToolUse',
    session_id: SESSION_ID,
    cwd: CWD,
    agent_id: A1_ID,
    tool_name: 'Bash',
    tool_use_id: a1b1,
    tool_input: { command: 'npx eslint --rule "security/*" server/', description: 'Run security linter' },
  }, 'A1: Bash security lint');
  await sleep(DELAY);
  await post({
    hook_event_name: 'PostToolUse',
    session_id: SESSION_ID,
    cwd: CWD,
    agent_id: A1_ID,
    tool_name: 'Bash',
    tool_use_id: a1b1,
    tool_input: { command: 'npx eslint --rule "security/*" server/' },
    tool_response: { stdout: '✓ No security issues found (12 files checked)', exitCode: 0 },
  }, 'A1: Bash ✓');
  await sleep(DELAY);

  // A1 agent stop
  await post({
    hook_event_name: 'SubagentStop',
    session_id: SESSION_ID,
    cwd: CWD,
    agent_id: A1_ID,
    agent_type: 'Explore',
  }, 'A1 Stop');
  await sleep(DELAY);

  // Assistant response for P1
  await post({
    hook_event_name: 'AssistantResponse',
    session_id: SESSION_ID,
    cwd: CWD,
    assistant_text: 'Security audit complete. The auth module uses JWT with proper validation. No SQL injection vulnerabilities found. The middleware correctly validates tokens before allowing access to protected routes.',
  }, 'Response P1');
  await sleep(DELAY);

  // Stop turn 1
  await post({
    hook_event_name: 'Stop',
    session_id: SESSION_ID,
    cwd: CWD,
    stop_hook_active: false,
  }, 'Stop turn 1');
  await sleep(DELAY);

  // Compaction 1
  await post({
    hook_event_name: 'PreCompact',
    session_id: SESSION_ID,
    cwd: CWD,
    trigger: 'auto',
  }, 'Compaction #1');
  await sleep(DELAY);

  // ═══════════════════════════════════════════════════════════════
  // PROMPT 2: "Refactor the database layer to use connection pooling"
  // A2: DB schema refactor — success, 5 tools (Read, Edit×2, Bash, Write)
  // A3: Migration writer — success, 3 tools (Read, Write, Bash)
  // ═══════════════════════════════════════════════════════════════
  console.log('\n\x1b[36m── Prompt 2: Database Refactor ──\x1b[0m');
  await post({
    hook_event_name: 'UserPromptSubmit',
    session_id: SESSION_ID,
    cwd: CWD,
    prompt: 'Refactor the database layer to use connection pooling',
  }, 'Prompt 2');
  await sleep(DELAY);

  // A2: DB schema refactor
  await post({
    hook_event_name: 'SubagentStart',
    session_id: SESSION_ID,
    cwd: CWD,
    agent_id: A2_ID,
    agent_type: 'Plan',
  }, 'A2 Start (DB Refactor)');
  await sleep(DELAY);

  // A2 Tool 1: Read db.ts
  const a2r1 = toolId('read');
  await post({
    hook_event_name: 'PreToolUse',
    session_id: SESSION_ID,
    cwd: CWD,
    agent_id: A2_ID,
    tool_name: 'Read',
    tool_use_id: a2r1,
    tool_input: { file_path: 'server/db.ts' },
  }, 'A2: Read db.ts');
  await sleep(DELAY);
  await post({
    hook_event_name: 'PostToolUse',
    session_id: SESSION_ID,
    cwd: CWD,
    agent_id: A2_ID,
    tool_name: 'Read',
    tool_use_id: a2r1,
    tool_input: { file_path: 'server/db.ts' },
    tool_response: { content: 'import Database from "better-sqlite3";\nconst db = new Database("app.db");' },
  }, 'A2: Read db.ts ✓');
  await sleep(DELAY);

  // A2 Tool 2: Edit db.ts (add pool)
  const a2e1 = toolId('edit');
  await post({
    hook_event_name: 'PreToolUse',
    session_id: SESSION_ID,
    cwd: CWD,
    agent_id: A2_ID,
    tool_name: 'Edit',
    tool_use_id: a2e1,
    tool_input: { file_path: 'server/db.ts', old_string: 'const db = new Database', new_string: 'const pool = createPool' },
  }, 'A2: Edit db.ts (pool)');
  await sleep(DELAY);
  await post({
    hook_event_name: 'PostToolUse',
    session_id: SESSION_ID,
    cwd: CWD,
    agent_id: A2_ID,
    tool_name: 'Edit',
    tool_use_id: a2e1,
    tool_input: { file_path: 'server/db.ts' },
    tool_response: { success: true },
  }, 'A2: Edit db.ts ✓');
  await sleep(DELAY);

  // A2 Tool 3: Edit config.ts (pool settings)
  const a2e2 = toolId('edit');
  await post({
    hook_event_name: 'PreToolUse',
    session_id: SESSION_ID,
    cwd: CWD,
    agent_id: A2_ID,
    tool_name: 'Edit',
    tool_use_id: a2e2,
    tool_input: { file_path: 'server/config.ts', old_string: 'dbPath:', new_string: 'poolSize: 10,\n  dbPath:' },
  }, 'A2: Edit config.ts');
  await sleep(DELAY);
  await post({
    hook_event_name: 'PostToolUse',
    session_id: SESSION_ID,
    cwd: CWD,
    agent_id: A2_ID,
    tool_name: 'Edit',
    tool_use_id: a2e2,
    tool_input: { file_path: 'server/config.ts' },
    tool_response: { success: true },
  }, 'A2: Edit config.ts ✓');
  await sleep(DELAY);

  // A2 Tool 4: Bash — run existing tests
  const a2b1 = toolId('bash');
  await post({
    hook_event_name: 'PreToolUse',
    session_id: SESSION_ID,
    cwd: CWD,
    agent_id: A2_ID,
    tool_name: 'Bash',
    tool_use_id: a2b1,
    tool_input: { command: 'pnpm test -- --filter=db', description: 'Run DB tests' },
  }, 'A2: Bash run tests');
  await sleep(DELAY);
  await post({
    hook_event_name: 'PostToolUse',
    session_id: SESSION_ID,
    cwd: CWD,
    agent_id: A2_ID,
    tool_name: 'Bash',
    tool_use_id: a2b1,
    tool_input: { command: 'pnpm test -- --filter=db' },
    tool_response: { stdout: 'Tests: 14 passed, 14 total\nTime: 1.2s', exitCode: 0 },
  }, 'A2: Bash tests ✓');
  await sleep(DELAY);

  // A2 Tool 5: Write pool.ts
  const a2w1 = toolId('write');
  await post({
    hook_event_name: 'PreToolUse',
    session_id: SESSION_ID,
    cwd: CWD,
    agent_id: A2_ID,
    tool_name: 'Write',
    tool_use_id: a2w1,
    tool_input: { file_path: 'server/lib/pool.ts', content: 'export class ConnectionPool { ... }' },
  }, 'A2: Write pool.ts');
  await sleep(DELAY);
  await post({
    hook_event_name: 'PostToolUse',
    session_id: SESSION_ID,
    cwd: CWD,
    agent_id: A2_ID,
    tool_name: 'Write',
    tool_use_id: a2w1,
    tool_input: { file_path: 'server/lib/pool.ts' },
    tool_response: { success: true },
  }, 'A2: Write pool.ts ✓');
  await sleep(DELAY);

  // A2 stop
  await post({
    hook_event_name: 'SubagentStop',
    session_id: SESSION_ID,
    cwd: CWD,
    agent_id: A2_ID,
    agent_type: 'Plan',
  }, 'A2 Stop');
  await sleep(DELAY);

  // A3: Migration writer (Task tool → child agent)
  const taskId1 = toolId('task');
  await post({
    hook_event_name: 'PreToolUse',
    session_id: SESSION_ID,
    cwd: CWD,
    tool_name: 'Task',
    tool_use_id: taskId1,
    tool_input: { prompt: 'Write database migration for connection pooling schema', subagent_type: 'Explore' },
  }, 'Task: Migration writer');
  await sleep(DELAY);

  await post({
    hook_event_name: 'SubagentStart',
    session_id: SESSION_ID,
    cwd: CWD,
    agent_id: A3_ID,
    agent_type: 'Explore',
    tool_use_id: taskId1,
  }, 'A3 Start (Migration)');
  await sleep(DELAY);

  // A3 Tool 1: Read existing migrations
  const a3r1 = toolId('read');
  await post({
    hook_event_name: 'PreToolUse',
    session_id: SESSION_ID,
    cwd: CWD,
    agent_id: A3_ID,
    tool_name: 'Read',
    tool_use_id: a3r1,
    tool_input: { file_path: 'migrations/001_init.sql' },
  }, 'A3: Read migrations');
  await sleep(DELAY);
  await post({
    hook_event_name: 'PostToolUse',
    session_id: SESSION_ID,
    cwd: CWD,
    agent_id: A3_ID,
    tool_name: 'Read',
    tool_use_id: a3r1,
    tool_input: { file_path: 'migrations/001_init.sql' },
    tool_response: { content: 'CREATE TABLE users (...);\nCREATE TABLE sessions (...);' },
  }, 'A3: Read migrations ✓');
  await sleep(DELAY);

  // A3 Tool 2: Write new migration
  const a3w1 = toolId('write');
  await post({
    hook_event_name: 'PreToolUse',
    session_id: SESSION_ID,
    cwd: CWD,
    agent_id: A3_ID,
    tool_name: 'Write',
    tool_use_id: a3w1,
    tool_input: { file_path: 'migrations/002_connection_pool.sql', content: 'ALTER TABLE connections ADD COLUMN pool_id TEXT;' },
  }, 'A3: Write migration');
  await sleep(DELAY);
  await post({
    hook_event_name: 'PostToolUse',
    session_id: SESSION_ID,
    cwd: CWD,
    agent_id: A3_ID,
    tool_name: 'Write',
    tool_use_id: a3w1,
    tool_input: { file_path: 'migrations/002_connection_pool.sql' },
    tool_response: { success: true },
  }, 'A3: Write migration ✓');
  await sleep(DELAY);

  // A3 Tool 3: Bash — run migration
  const a3b1 = toolId('bash');
  await post({
    hook_event_name: 'PreToolUse',
    session_id: SESSION_ID,
    cwd: CWD,
    agent_id: A3_ID,
    tool_name: 'Bash',
    tool_use_id: a3b1,
    tool_input: { command: 'npx tsx scripts/migrate.ts', description: 'Apply migration' },
  }, 'A3: Bash migrate');
  await sleep(DELAY);
  await post({
    hook_event_name: 'PostToolUse',
    session_id: SESSION_ID,
    cwd: CWD,
    agent_id: A3_ID,
    tool_name: 'Bash',
    tool_use_id: a3b1,
    tool_input: { command: 'npx tsx scripts/migrate.ts' },
    tool_response: { stdout: 'Migration 002_connection_pool applied successfully', exitCode: 0 },
  }, 'A3: Bash migrate ✓');
  await sleep(DELAY);

  // A3 stop
  await post({
    hook_event_name: 'SubagentStop',
    session_id: SESSION_ID,
    cwd: CWD,
    agent_id: A3_ID,
    agent_type: 'Explore',
  }, 'A3 Stop');
  await sleep(DELAY);

  // Task PostToolUse with token usage
  await post({
    hook_event_name: 'PostToolUse',
    session_id: SESSION_ID,
    cwd: CWD,
    tool_name: 'Task',
    tool_use_id: taskId1,
    tool_input: { prompt: 'Write database migration' },
    tool_response: {
      agentId: A3_ID,
      result: 'Migration 002 created and applied',
      usage: { input_tokens: 18500, output_tokens: 4200, cache_read_input_tokens: 6000 },
    },
  }, 'Task complete (A3)');
  await sleep(DELAY);

  // Assistant response for P2
  await post({
    hook_event_name: 'AssistantResponse',
    session_id: SESSION_ID,
    cwd: CWD,
    assistant_text: 'Database refactoring complete. I replaced the single connection with a 10-connection pool, updated the configuration, and created migration 002 to add pool tracking. All 14 existing tests pass.',
  }, 'Response P2');
  await sleep(DELAY);

  // Stop turn 2
  await post({
    hook_event_name: 'Stop',
    session_id: SESSION_ID,
    cwd: CWD,
    stop_hook_active: false,
  }, 'Stop turn 2');
  await sleep(DELAY);

  // Compaction 2
  await post({
    hook_event_name: 'PreCompact',
    session_id: SESSION_ID,
    cwd: CWD,
    trigger: 'auto',
  }, 'Compaction #2');
  await sleep(DELAY);

  // ═══════════════════════════════════════════════════════════════
  // PROMPT 3: "Add comprehensive test coverage"
  // A4: Unit test writer — RUNNING (4 tools: Read×2, Write, Glob)
  // A5: Integration test writer — success (5 tools: Read, Write, Bash×2, WebSearch)
  // A6: Coverage reporter — ERROR (2 tools: Bash, Grep)
  // ═══════════════════════════════════════════════════════════════
  console.log('\n\x1b[36m── Prompt 3: Test Coverage ──\x1b[0m');
  await post({
    hook_event_name: 'UserPromptSubmit',
    session_id: SESSION_ID,
    cwd: CWD,
    prompt: 'Add comprehensive test coverage for the refactored modules',
  }, 'Prompt 3');
  await sleep(DELAY);

  // A4: Unit test writer — stays RUNNING
  await post({
    hook_event_name: 'SubagentStart',
    session_id: SESSION_ID,
    cwd: CWD,
    agent_id: A4_ID,
    agent_type: 'Explore',
  }, 'A4 Start (Unit Tests)');
  await sleep(DELAY);

  // A4 Tool 1: Read pool.ts
  const a4r1 = toolId('read');
  await post({
    hook_event_name: 'PreToolUse',
    session_id: SESSION_ID,
    cwd: CWD,
    agent_id: A4_ID,
    tool_name: 'Read',
    tool_use_id: a4r1,
    tool_input: { file_path: 'server/lib/pool.ts' },
  }, 'A4: Read pool.ts');
  await sleep(DELAY);
  await post({
    hook_event_name: 'PostToolUse',
    session_id: SESSION_ID,
    cwd: CWD,
    agent_id: A4_ID,
    tool_name: 'Read',
    tool_use_id: a4r1,
    tool_input: { file_path: 'server/lib/pool.ts' },
    tool_response: { content: 'export class ConnectionPool { ... }' },
  }, 'A4: Read pool.ts ✓');
  await sleep(DELAY);

  // A4 Tool 2: Read config.ts
  const a4r2 = toolId('read');
  await post({
    hook_event_name: 'PreToolUse',
    session_id: SESSION_ID,
    cwd: CWD,
    agent_id: A4_ID,
    tool_name: 'Read',
    tool_use_id: a4r2,
    tool_input: { file_path: 'server/config.ts' },
  }, 'A4: Read config.ts');
  await sleep(DELAY);
  await post({
    hook_event_name: 'PostToolUse',
    session_id: SESSION_ID,
    cwd: CWD,
    agent_id: A4_ID,
    tool_name: 'Read',
    tool_use_id: a4r2,
    tool_input: { file_path: 'server/config.ts' },
    tool_response: { content: 'export const config = { poolSize: 10, dbPath: "app.db" };' },
  }, 'A4: Read config.ts ✓');
  await sleep(DELAY);

  // A4 Tool 3: Write test file
  const a4w1 = toolId('write');
  await post({
    hook_event_name: 'PreToolUse',
    session_id: SESSION_ID,
    cwd: CWD,
    agent_id: A4_ID,
    tool_name: 'Write',
    tool_use_id: a4w1,
    tool_input: { file_path: 'tests/pool.test.ts', content: 'describe("ConnectionPool", () => { ... })' },
  }, 'A4: Write pool.test.ts');
  await sleep(DELAY);
  await post({
    hook_event_name: 'PostToolUse',
    session_id: SESSION_ID,
    cwd: CWD,
    agent_id: A4_ID,
    tool_name: 'Write',
    tool_use_id: a4w1,
    tool_input: { file_path: 'tests/pool.test.ts' },
    tool_response: { success: true },
  }, 'A4: Write pool.test.ts ✓');
  await sleep(DELAY);

  // A4 Tool 4: Glob to find all test files (still running — no PostToolUse)
  const a4g1 = toolId('glob');
  await post({
    hook_event_name: 'PreToolUse',
    session_id: SESSION_ID,
    cwd: CWD,
    agent_id: A4_ID,
    tool_name: 'Glob',
    tool_use_id: a4g1,
    tool_input: { pattern: 'tests/**/*.test.ts' },
  }, 'A4: Glob test files (running...)');
  // NOTE: No PostToolUse — A4 stays in running state with this tool active
  await sleep(DELAY);

  // A5: Integration test writer — success
  const taskId2 = toolId('task');
  await post({
    hook_event_name: 'PreToolUse',
    session_id: SESSION_ID,
    cwd: CWD,
    tool_name: 'Task',
    tool_use_id: taskId2,
    tool_input: { prompt: 'Write integration tests for the pool module', subagent_type: 'Explore' },
  }, 'Task: Integration tests');
  await sleep(DELAY);

  await post({
    hook_event_name: 'SubagentStart',
    session_id: SESSION_ID,
    cwd: CWD,
    agent_id: A5_ID,
    agent_type: 'Explore',
    tool_use_id: taskId2,
  }, 'A5 Start (Integration Tests)');
  await sleep(DELAY);

  // A5 Tool 1: Read
  const a5r1 = toolId('read');
  await post({
    hook_event_name: 'PreToolUse',
    session_id: SESSION_ID,
    cwd: CWD,
    agent_id: A5_ID,
    tool_name: 'Read',
    tool_use_id: a5r1,
    tool_input: { file_path: 'server/lib/pool.ts' },
  }, 'A5: Read pool.ts');
  await sleep(DELAY);
  await post({
    hook_event_name: 'PostToolUse',
    session_id: SESSION_ID,
    cwd: CWD,
    agent_id: A5_ID,
    tool_name: 'Read',
    tool_use_id: a5r1,
    tool_input: { file_path: 'server/lib/pool.ts' },
    tool_response: { content: 'export class ConnectionPool { ... }' },
  }, 'A5: Read ✓');
  await sleep(DELAY);

  // A5 Tool 2: WebSearch for integration testing best practices
  const a5ws = toolId('websearch');
  await post({
    hook_event_name: 'PreToolUse',
    session_id: SESSION_ID,
    cwd: CWD,
    agent_id: A5_ID,
    tool_name: 'WebSearch',
    tool_use_id: a5ws,
    tool_input: { query: 'sqlite connection pool integration testing best practices' },
  }, 'A5: WebSearch');
  await sleep(DELAY);
  await post({
    hook_event_name: 'PostToolUse',
    session_id: SESSION_ID,
    cwd: CWD,
    agent_id: A5_ID,
    tool_name: 'WebSearch',
    tool_use_id: a5ws,
    tool_input: { query: 'sqlite connection pool integration testing' },
    tool_response: { results: [{ title: 'Testing Database Pools', url: 'https://example.com/testing-pools' }] },
  }, 'A5: WebSearch ✓');
  await sleep(DELAY);

  // A5 Tool 3: Write integration test
  const a5w1 = toolId('write');
  await post({
    hook_event_name: 'PreToolUse',
    session_id: SESSION_ID,
    cwd: CWD,
    agent_id: A5_ID,
    tool_name: 'Write',
    tool_use_id: a5w1,
    tool_input: { file_path: 'tests/integration/pool.integration.test.ts', content: 'describe("Pool Integration", () => { ... })' },
  }, 'A5: Write integration test');
  await sleep(DELAY);
  await post({
    hook_event_name: 'PostToolUse',
    session_id: SESSION_ID,
    cwd: CWD,
    agent_id: A5_ID,
    tool_name: 'Write',
    tool_use_id: a5w1,
    tool_input: { file_path: 'tests/integration/pool.integration.test.ts' },
    tool_response: { success: true },
  }, 'A5: Write integration test ✓');
  await sleep(DELAY);

  // A5 Tool 4: Bash run integration tests
  const a5b1 = toolId('bash');
  await post({
    hook_event_name: 'PreToolUse',
    session_id: SESSION_ID,
    cwd: CWD,
    agent_id: A5_ID,
    tool_name: 'Bash',
    tool_use_id: a5b1,
    tool_input: { command: 'pnpm test -- tests/integration/', description: 'Run integration tests' },
  }, 'A5: Bash integration tests');
  await sleep(DELAY);
  await post({
    hook_event_name: 'PostToolUse',
    session_id: SESSION_ID,
    cwd: CWD,
    agent_id: A5_ID,
    tool_name: 'Bash',
    tool_use_id: a5b1,
    tool_input: { command: 'pnpm test -- tests/integration/' },
    tool_response: { stdout: 'Tests: 8 passed, 8 total\nTime: 3.4s', exitCode: 0 },
  }, 'A5: Bash integration ✓');
  await sleep(DELAY);

  // A5 Tool 5: Bash run all tests
  const a5b2 = toolId('bash');
  await post({
    hook_event_name: 'PreToolUse',
    session_id: SESSION_ID,
    cwd: CWD,
    agent_id: A5_ID,
    tool_name: 'Bash',
    tool_use_id: a5b2,
    tool_input: { command: 'pnpm test', description: 'Run full test suite' },
  }, 'A5: Bash full suite');
  await sleep(DELAY);
  await post({
    hook_event_name: 'PostToolUse',
    session_id: SESSION_ID,
    cwd: CWD,
    agent_id: A5_ID,
    tool_name: 'Bash',
    tool_use_id: a5b2,
    tool_input: { command: 'pnpm test' },
    tool_response: { stdout: 'Tests: 22 passed, 22 total\nTime: 4.8s', exitCode: 0 },
  }, 'A5: Bash full suite ✓');
  await sleep(DELAY);

  // A5 stop
  await post({
    hook_event_name: 'SubagentStop',
    session_id: SESSION_ID,
    cwd: CWD,
    agent_id: A5_ID,
    agent_type: 'Explore',
  }, 'A5 Stop');
  await sleep(DELAY);

  // Task PostToolUse for A5
  await post({
    hook_event_name: 'PostToolUse',
    session_id: SESSION_ID,
    cwd: CWD,
    tool_name: 'Task',
    tool_use_id: taskId2,
    tool_input: { prompt: 'Write integration tests' },
    tool_response: {
      agentId: A5_ID,
      result: 'Integration tests written and passing',
      usage: { input_tokens: 32000, output_tokens: 6800, cache_read_input_tokens: 12000 },
    },
  }, 'Task complete (A5)');
  await sleep(DELAY);

  // A6: Coverage reporter — ERROR
  await post({
    hook_event_name: 'SubagentStart',
    session_id: SESSION_ID,
    cwd: CWD,
    agent_id: A6_ID,
    agent_type: 'Explore',
  }, 'A6 Start (Coverage Reporter)');
  await sleep(DELAY);

  // A6 Tool 1: Bash — run coverage (fails)
  const a6b1 = toolId('bash');
  await post({
    hook_event_name: 'PreToolUse',
    session_id: SESSION_ID,
    cwd: CWD,
    agent_id: A6_ID,
    tool_name: 'Bash',
    tool_use_id: a6b1,
    tool_input: { command: 'pnpm test -- --coverage', description: 'Generate coverage report' },
  }, 'A6: Bash coverage');
  await sleep(DELAY);
  await post({
    hook_event_name: 'PostToolUseFailure',
    session_id: SESSION_ID,
    cwd: CWD,
    agent_id: A6_ID,
    tool_name: 'Bash',
    tool_use_id: a6b1,
    tool_input: { command: 'pnpm test -- --coverage' },
    error: 'ENOMEM: Cannot allocate memory for coverage instrumentation',
  }, 'A6: Bash coverage ✗ ERROR');
  await sleep(DELAY);

  // A6 Tool 2: Grep — try to find existing coverage config
  const a6g1 = toolId('grep');
  await post({
    hook_event_name: 'PreToolUse',
    session_id: SESSION_ID,
    cwd: CWD,
    agent_id: A6_ID,
    tool_name: 'Grep',
    tool_use_id: a6g1,
    tool_input: { pattern: 'coverage', path: 'package.json' },
  }, 'A6: Grep coverage config');
  await sleep(DELAY);
  await post({
    hook_event_name: 'PostToolUse',
    session_id: SESSION_ID,
    cwd: CWD,
    agent_id: A6_ID,
    tool_name: 'Grep',
    tool_use_id: a6g1,
    tool_input: { pattern: 'coverage' },
    tool_response: { matches: [] },
  }, 'A6: Grep ✓ (no config found)');
  await sleep(DELAY);

  // A6 stops with error
  await post({
    hook_event_name: 'SubagentStop',
    session_id: SESSION_ID,
    cwd: CWD,
    agent_id: A6_ID,
    agent_type: 'Explore',
    error: 'Coverage generation failed: out of memory',
  }, 'A6 Stop (ERROR)');
  await sleep(DELAY);

  // ── Summary ──
  console.log(`\n\x1b[1m=== Simulation Complete ===\x1b[0m`);
  console.log(`  Events injected: ${eventCount}`);
  console.log(`  Session ID: ${SESSION_ID}`);

  // Expected node count (for readiness check):
  // 1 session + 3 prompts + 6 agents + tool groups (varies based on grouping)
  // With tool grouping enabled, individual tools collapse into toolGroup nodes.
  // Approximate visible nodes: ~12-15 depending on grouping mode.
  return { sessionId: SESSION_ID, expectedNodeCount: 10 };
}
```

- [ ] **Step 2: Verify the simulation file compiles**

```bash
npx tsx --check scripts/screenshot_simulation.ts
```

Expected: No errors (the file exports functions, doesn't run on its own)

- [ ] **Step 3: Commit**

```bash
git add scripts/screenshot_simulation.ts
git commit -m "feat: add screenshot simulation seeder with 500ms-paced events"
```

---

### Task 3: Build the QA Gallery Generator

**Files:**
- Create: `scripts/screenshot_gallery.ts`

- [ ] **Step 1: Create `scripts/screenshot_gallery.ts`**

```typescript
/**
 * Generates an index.html gallery page from screenshot output.
 * Displays all captured screenshots in a grid for visual QA.
 */

import * as fs from 'fs';
import * as path from 'path';

const SCREENSHOT_DIR = path.join(process.cwd(), 'assets', 'screenshots');

interface Shot {
  name: string;
  category: string;
  pngPath: string;
}

export function generateGallery(): void {
  const categories = ['hero', 'lenses', 'features', 'mobile'];
  const shots: Shot[] = [];

  for (const cat of categories) {
    const dir = path.join(SCREENSHOT_DIR, cat);
    if (!fs.existsSync(dir)) continue;
    const pngs = fs.readdirSync(dir).filter((f) => f.endsWith('.png'));
    for (const png of pngs) {
      shots.push({
        name: png.replace('.png', ''),
        category: cat,
        pngPath: `${cat}/${png}`,
      });
    }
  }

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Synapse Screenshot QA Gallery</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { background: #0a0a0a; color: #e5e5e5; font-family: system-ui, -apple-system, sans-serif; padding: 2rem; }
    h1 { font-size: 1.5rem; margin-bottom: 0.5rem; }
    .meta { color: #888; font-size: 0.875rem; margin-bottom: 2rem; }
    h2 { font-size: 1.1rem; color: #60a5fa; margin: 2rem 0 1rem; text-transform: capitalize; }
    .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(500px, 1fr)); gap: 1.5rem; }
    .card { background: #1a1a1a; border: 1px solid #333; border-radius: 8px; overflow: hidden; }
    .card img { width: 100%; display: block; cursor: zoom-in; }
    .card img:hover { opacity: 0.9; }
    .card .label { padding: 0.75rem 1rem; font-size: 0.8rem; color: #aaa; font-family: monospace; }
    .card .label code { color: #60a5fa; }
    a { color: inherit; text-decoration: none; }
    a:hover { text-decoration: underline; }
  </style>
</head>
<body>
  <h1>Synapse Screenshot QA Gallery</h1>
  <p class="meta">${shots.length} screenshots captured at ${new Date().toISOString()}</p>
  ${categories
    .filter((cat) => shots.some((s) => s.category === cat))
    .map(
      (cat) => `
  <h2>${cat} (${shots.filter((s) => s.category === cat).length})</h2>
  <div class="grid">
    ${shots
      .filter((s) => s.category === cat)
      .map(
        (s) => `
    <div class="card">
      <a href="${s.pngPath}" target="_blank"><img src="${s.pngPath}" alt="${s.name}" loading="lazy"></a>
      <div class="label"><code>${s.name}</code></div>
    </div>`,
      )
      .join('')}
  </div>`,
    )
    .join('')}
</body>
</html>`;

  const outPath = path.join(SCREENSHOT_DIR, 'index.html');
  fs.writeFileSync(outPath, html, 'utf-8');
  console.log(`\x1b[32m✓\x1b[0m Gallery written to ${outPath}`);
}
```

- [ ] **Step 2: Commit**

```bash
git add scripts/screenshot_gallery.ts
git commit -m "feat: add screenshot QA gallery generator"
```

---

### Task 4: Build the Main Capture Script

**Files:**
- Create: `scripts/capture_screenshots.ts`

This is the orchestrator — it imports the seeder and gallery generator, launches Playwright, navigates views, and captures screenshots.

- [ ] **Step 1: Create `scripts/capture_screenshots.ts`**

```typescript
/**
 * Synapse Screenshot Pipeline
 *
 * Prerequisites: server (start-server.ps1) + frontend (start-client.ps1) running.
 *
 * Usage:
 *   npx playwright install chromium     # one-time
 *   npx tsx scripts/capture_screenshots.ts
 *   npx tsx scripts/capture_screenshots.ts --suffix=v2
 */

import { chromium, type Page, type Browser } from 'playwright';
import * as fs from 'fs';
import * as path from 'path';
import { clearAllEvents, seedSimulation } from './screenshot_simulation.js';
import { generateGallery } from './screenshot_gallery.js';

const BASE_URL = 'http://localhost:5173';
const OUT_DIR = path.join(process.cwd(), 'assets', 'screenshots');
const suffix = process.argv.find((a) => a.startsWith('--suffix='))?.split('=')[1] ?? '';

// ── Helpers ──────────────────────────────────────────────────

function ensureDir(dir: string): void {
  fs.mkdirSync(dir, { recursive: true });
}

function shotPath(category: string, name: string, ext: 'png' | 'webp'): string {
  const fname = suffix ? `${name}-${suffix}.${ext}` : `${name}.${ext}`;
  return path.join(OUT_DIR, category, fname);
}

async function capturePng(page: Page, category: string, name: string): Promise<void> {
  ensureDir(path.join(OUT_DIR, category));
  const pngPath = shotPath(category, name, 'png');
  await page.screenshot({ path: pngPath, type: 'png' });
  console.log(`  📸 ${category}/${name}.png`);
}

async function waitForGraphReady(page: Page, minNodes: number): Promise<void> {
  console.log(`  Waiting for ${minNodes}+ nodes to render...`);
  await page.waitForFunction(
    (min) => document.querySelectorAll('.react-flow__node').length >= min,
    minNodes,
    { timeout: 30000 },
  );
  // Extra settle time for layout animations
  await page.waitForTimeout(1500);
  console.log('  ✓ Graph ready');
}

// Type IDDQD sequence to unlock arcade mode
async function typeIddqd(page: Page): Promise<void> {
  for (const key of ['i', 'd', 'd', 'q', 'd']) {
    await page.keyboard.press(key);
    await page.waitForTimeout(100);
  }
  await page.waitForTimeout(500); // wait for unlock animation
}

// ── Shot Definitions ─────────────────────────────────────────

interface ShotDef {
  id: string;
  category: string;
  name: string;
  viewport: { width: number; height: number };
  url?: string;
  setup: (page: Page) => Promise<void>;
  waitMs: number;
}

const SHOTS: ShotDef[] = [
  // ── Hero ──
  {
    id: 'H1',
    category: 'hero',
    name: 'graph-overview',
    viewport: { width: 1280, height: 800 },
    setup: async (page) => {
      // Click an agent node (A2 — DB Refactor) for selection highlight
      const agentNodes = page.locator('.react-flow__node-agent');
      const count = await agentNodes.count();
      if (count >= 2) await agentNodes.nth(1).click();
    },
    waitMs: 1000,
  },
  {
    id: 'H2',
    category: 'hero',
    name: 'graph-inspector',
    viewport: { width: 1440, height: 800 },
    setup: async (page) => {
      // Click an agent node to open inspector panel
      const agentNodes = page.locator('.react-flow__node-agent');
      const count = await agentNodes.count();
      if (count >= 2) await agentNodes.nth(1).click();
      await page.waitForTimeout(500);
    },
    waitMs: 1000,
  },
  {
    id: 'H3',
    category: 'hero',
    name: 'sankey-flow',
    viewport: { width: 1280, height: 800 },
    setup: async (page) => {
      // Close inspector by pressing Escape, show lens panel, switch to Sankey
      await page.keyboard.press('Escape');
      await page.waitForTimeout(300);
      await page.keyboard.press('l'); // toggle lens
      await page.waitForTimeout(500);
      await page.keyboard.press('4'); // Sankey tab
    },
    waitMs: 1000,
  },
  {
    id: 'H4',
    category: 'hero',
    name: 'social-preview',
    viewport: { width: 1280, height: 640 },
    setup: async (page) => {
      // Close lens, show graph only
      await page.keyboard.press('l'); // hide lens
      await page.waitForTimeout(300);
      // Click an agent for visual interest
      const agentNodes = page.locator('.react-flow__node-agent');
      const count = await agentNodes.count();
      if (count >= 1) await agentNodes.nth(0).click();
    },
    waitMs: 1000,
  },

  // ── Lenses ──
  {
    id: 'L1',
    category: 'lenses',
    name: 'treemap',
    viewport: { width: 1280, height: 800 },
    setup: async (page) => {
      await page.keyboard.press('Escape');
      await page.waitForTimeout(200);
      await page.keyboard.press('l'); // show lens
      await page.waitForTimeout(500);
      await page.keyboard.press('1'); // Treemap
    },
    waitMs: 1000,
  },
  {
    id: 'L2',
    category: 'lenses',
    name: 'compaction',
    viewport: { width: 1280, height: 800 },
    setup: async (page) => {
      await page.keyboard.press('2'); // Compaction
    },
    waitMs: 1000,
  },
  {
    id: 'L3',
    category: 'lenses',
    name: 'sankey-detail',
    viewport: { width: 1280, height: 800 },
    setup: async (page) => {
      await page.keyboard.press('4'); // Sankey
      await page.waitForTimeout(800);
      // Hover a Sankey node for tooltip
      const sankeyNode = page.locator('.sankey-node, [data-type="sankey"] rect').first();
      if (await sankeyNode.isVisible()) {
        await sankeyNode.hover();
      }
    },
    waitMs: 1000,
  },
  {
    id: 'L4',
    category: 'lenses',
    name: 'tree-view',
    viewport: { width: 1280, height: 800 },
    setup: async (page) => {
      await page.keyboard.press('5'); // Tree
      await page.waitForTimeout(500);
      // Click expand arrows to open 2 levels
      const expandBtns = page.locator('[data-tree-expand], .tree-expand-btn, button[aria-label*="expand"]');
      const count = await expandBtns.count();
      for (let i = 0; i < Math.min(count, 3); i++) {
        await expandBtns.nth(i).click();
        await page.waitForTimeout(200);
      }
    },
    waitMs: 1000,
  },

  // ── Features: Tool Group Views ──
  {
    id: 'F1',
    category: 'features',
    name: 'toolgroup-pillgrid',
    viewport: { width: 1280, height: 800 },
    setup: async (page) => {
      // Close lens, return to graph
      await page.keyboard.press('l'); // hide lens
      await page.waitForTimeout(300);
      // Open View Settings → Tool View → Pill Grid
      await page.click('button[aria-label="View settings"]');
      await page.waitForTimeout(300);
      const pillGridBtn = page.locator('button').filter({ hasText: 'Pill Grid' });
      if (await pillGridBtn.isVisible()) await pillGridBtn.click();
      await page.waitForTimeout(500);
      // Click a tool group node
      const tgNode = page.locator('[class*="react-flow__node-toolGroup"]').first();
      if (await tgNode.isVisible()) await tgNode.click();
    },
    waitMs: 1000,
  },
  {
    id: 'F2',
    category: 'features',
    name: 'toolgroup-timeline',
    viewport: { width: 1280, height: 800 },
    setup: async (page) => {
      await page.click('button[aria-label="View settings"]');
      await page.waitForTimeout(300);
      const timelineBtn = page.locator('button').filter({ hasText: 'Timeline' });
      if (await timelineBtn.isVisible()) await timelineBtn.click();
    },
    waitMs: 1000,
  },
  {
    id: 'F3',
    category: 'features',
    name: 'toolgroup-heatmap',
    viewport: { width: 1280, height: 800 },
    setup: async (page) => {
      await page.click('button[aria-label="View settings"]');
      await page.waitForTimeout(300);
      const heatmapBtn = page.locator('button').filter({ hasText: 'Heatmap' });
      if (await heatmapBtn.isVisible()) await heatmapBtn.click();
    },
    waitMs: 1000,
  },

  // ── Features: Arcade Modes ──
  {
    id: 'F4',
    category: 'features',
    name: 'arcade-gameoflife',
    viewport: { width: 1280, height: 800 },
    setup: async (page) => {
      // Unlock arcade via IDDQD
      await typeIddqd(page);
      await page.waitForTimeout(500);
      // Select Game of Life via View Settings
      await page.click('button[aria-label="View settings"]');
      await page.waitForTimeout(300);
      const gofBtn = page.locator('button').filter({ hasText: 'Game of Life' });
      if (await gofBtn.isVisible()) await gofBtn.click();
    },
    waitMs: 5000, // Wait for pattern evolution
  },
  {
    id: 'F5',
    category: 'features',
    name: 'arcade-tetris',
    viewport: { width: 1280, height: 800 },
    setup: async (page) => {
      await page.click('button[aria-label="View settings"]');
      await page.waitForTimeout(300);
      const btn = page.locator('button').filter({ hasText: 'Tetris' });
      if (await btn.isVisible()) await btn.click();
    },
    waitMs: 8000, // Wait for blocks to accumulate
  },
  {
    id: 'F6',
    category: 'features',
    name: 'arcade-snake',
    viewport: { width: 1280, height: 800 },
    setup: async (page) => {
      await page.click('button[aria-label="View settings"]');
      await page.waitForTimeout(300);
      const btn = page.locator('button').filter({ hasText: 'Snake' });
      if (await btn.isVisible()) await btn.click();
    },
    waitMs: 6000,
  },
  {
    id: 'F7',
    category: 'features',
    name: 'arcade-breakout',
    viewport: { width: 1280, height: 800 },
    setup: async (page) => {
      await page.click('button[aria-label="View settings"]');
      await page.waitForTimeout(300);
      const btn = page.locator('button').filter({ hasText: 'Breakout' });
      if (await btn.isVisible()) await btn.click();
    },
    waitMs: 6000,
  },

  // ── Features: Menus ──
  {
    id: 'F8',
    category: 'features',
    name: 'view-settings',
    viewport: { width: 1280, height: 800 },
    setup: async (page) => {
      // Deactivate arcade mode first — switch back to Heatmap
      await page.click('button[aria-label="View settings"]');
      await page.waitForTimeout(300);
      const heatmapBtn = page.locator('button').filter({ hasText: 'Heatmap' });
      if (await heatmapBtn.isVisible()) await heatmapBtn.click();
      await page.waitForTimeout(300);
      // Now reopen the dropdown for the screenshot
      await page.click('button[aria-label="View settings"]');
    },
    waitMs: 500,
  },
  {
    id: 'F9',
    category: 'features',
    name: 'keyboard-shortcuts',
    viewport: { width: 1280, height: 800 },
    setup: async (page) => {
      // Close settings dropdown first
      await page.keyboard.press('Escape');
      await page.waitForTimeout(200);
      // Hover the ? icon to show shortcuts tooltip
      const helpIcon = page.locator('[aria-label="Keyboard shortcuts"]');
      if (await helpIcon.isVisible()) {
        await helpIcon.hover();
      }
    },
    waitMs: 500,
  },

  // ── Mobile ──
  {
    id: 'M1',
    category: 'mobile',
    name: 'mobile-graph',
    viewport: { width: 390, height: 844 },
    url: `${BASE_URL}?view=mobile`,
    setup: async (_page) => {
      // Graph tab is default
    },
    waitMs: 1500,
  },
  {
    id: 'M2',
    category: 'mobile',
    name: 'mobile-lens',
    viewport: { width: 390, height: 844 },
    setup: async (page) => {
      // Tap Lenses tab
      const lensTab = page.locator('button').filter({ hasText: 'Lenses' });
      if (await lensTab.isVisible()) await lensTab.click();
    },
    waitMs: 1000,
  },
];

// ── Main ─────────────────────────────────────────────────────

async function main(): Promise<void> {
  const startTime = Date.now();

  // 1. Clear existing events
  await clearAllEvents();

  // 2. Seed simulation
  const { expectedNodeCount } = await seedSimulation();

  // 3. Launch browser
  console.log('\n\x1b[36m── Launching Playwright ──\x1b[0m');
  const browser: Browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    deviceScaleFactor: 2,
    colorScheme: 'dark',
  });
  const page = await context.newPage();

  // Navigate and wait for graph
  await page.goto(BASE_URL, { waitUntil: 'networkidle' });
  await waitForGraphReady(page, expectedNodeCount);

  // 4. Capture all shots
  console.log('\n\x1b[36m── Capturing Screenshots ──\x1b[0m');
  let capturedCount = 0;

  for (const shot of SHOTS) {
    console.log(`\n  [${shot.id}] ${shot.name}`);

    // Resize viewport if needed
    const currentViewport = page.viewportSize();
    if (
      !currentViewport ||
      currentViewport.width !== shot.viewport.width ||
      currentViewport.height !== shot.viewport.height
    ) {
      await page.setViewportSize(shot.viewport);
      await page.waitForTimeout(500);
    }

    // Navigate to different URL if specified (e.g., mobile view)
    if (shot.url) {
      await page.goto(shot.url, { waitUntil: 'networkidle' });
      await page.waitForTimeout(1000);
    }

    // Run shot-specific setup
    await shot.setup(page);

    // Wait for the shot-specific settle time
    await page.waitForTimeout(shot.waitMs);

    // Capture
    await capturePng(page, shot.category, shot.name);
    capturedCount++;
  }

  // 5. Cleanup
  await browser.close();

  // 6. Generate gallery
  console.log('\n\x1b[36m── Generating Gallery ──\x1b[0m');
  generateGallery();

  // 7. Summary
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`\n\x1b[1m=== Screenshot Pipeline Complete ===\x1b[0m`);
  console.log(`  Screenshots: ${capturedCount}/${SHOTS.length}`);
  console.log(`  Output: ${OUT_DIR}`);
  console.log(`  Gallery: ${path.join(OUT_DIR, 'index.html')}`);
  console.log(`  Time: ${elapsed}s`);
  console.log(`\n  Open the gallery in a browser to review.\n`);
}

main().catch((err) => {
  console.error('\x1b[31mScreenshot pipeline failed:\x1b[0m', err.message);
  process.exit(1);
});
```

- [ ] **Step 2: Verify the script compiles**

```bash
npx tsx --check scripts/capture_screenshots.ts
```

Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add scripts/capture_screenshots.ts
git commit -m "feat: add main screenshot capture script with 19 shot definitions"
```

---

### Task 5: Add WebP Conversion Post-Processing

**Files:**
- Modify: `scripts/capture_screenshots.ts`
- Modify: `scripts/screenshot_gallery.ts`

Playwright doesn't support WebP output natively. We add a post-processing step using `sharp` to convert all PNGs to WebP.

- [ ] **Step 1: Install sharp as root devDependency**

```bash
pnpm add -Dw sharp
```

- [ ] **Step 2: Add WebP conversion function to `capture_screenshots.ts`**

Add this after the `generateGallery()` call in `main()`:

```typescript
import sharp from 'sharp';

// ... in main(), after generateGallery():

// 6b. Convert PNGs to WebP
console.log('\n\x1b[36m── Converting to WebP ──\x1b[0m');
const categories = ['hero', 'lenses', 'features', 'mobile'];
let webpCount = 0;
for (const cat of categories) {
  const dir = path.join(OUT_DIR, cat);
  if (!fs.existsSync(dir)) continue;
  const pngs = fs.readdirSync(dir).filter((f) => f.endsWith('.png'));
  for (const png of pngs) {
    const pngPath = path.join(dir, png);
    const webpPath = pngPath.replace('.png', '.webp');
    await sharp(pngPath).webp({ quality: 90, lossless: false }).toFile(webpPath);
    webpCount++;
    console.log(`  ✓ ${cat}/${png} → .webp`);
  }
}
console.log(`  Converted ${webpCount} files to WebP`);
```

- [ ] **Step 3: Update gallery to include WebP links**

In `screenshot_gallery.ts`, update the card template to show both formats:

```typescript
// In the card template, after the img tag:
`<div class="label"><code>${s.name}</code> · <a href="${s.pngPath}">PNG</a> · <a href="${s.pngPath.replace('.png', '.webp')}">WebP</a></div>`
```

- [ ] **Step 4: Commit**

```bash
git add scripts/capture_screenshots.ts scripts/screenshot_gallery.ts package.json pnpm-lock.yaml
git commit -m "feat: add WebP conversion post-processing via sharp"
```

---

### Task 6: End-to-End Test Run

**Files:** None — this is a validation task.

- [ ] **Step 1: Start server and frontend in separate terminals**

Terminal 1:
```bash
./start-server.ps1
```

Terminal 2:
```bash
./start-client.ps1
```

Wait for both to be ready (server on 27246/27247, frontend on 5173).

- [ ] **Step 2: Run the screenshot pipeline**

```bash
npx tsx scripts/capture_screenshots.ts
```

Expected output:
```
── Clearing all events ──
  Deleted N events

=== Screenshot Simulation ===
  Session: screenshot-xxx

── Session ──
   1. [OK] SessionStart
   2. [OK] Prompt 1
  ...

── Launching Playwright ──
  Waiting for 10+ nodes to render...
  ✓ Graph ready

── Capturing Screenshots ──

  [H1] graph-overview
  📸 hero/graph-overview.png
  ...

── Converting to WebP ──
  ✓ hero/graph-overview.png → .webp
  ...

── Generating Gallery ──
✓ Gallery written to .../assets/screenshots/index.html

=== Screenshot Pipeline Complete ===
  Screenshots: 19/19
  Output: .../assets/screenshots
  Time: ~90s
```

- [ ] **Step 3: Open the gallery and review all shots**

Open `assets/screenshots/index.html` in a browser. Check:
- All 19 shots present (4 hero + 4 lens + 9 feature + 2 mobile)
- Graph nodes visible and legible
- Lens visualizations populated with data
- Arcade games show active gameplay
- Mobile views render correctly at phone dimensions
- No overlapping nodes or cut-off text

- [ ] **Step 4: Test the --suffix flag**

```bash
npx tsx scripts/capture_screenshots.ts --suffix=v2
```

Expected: Files named `graph-overview-v2.png`, `graph-overview-v2.webp`, etc.

- [ ] **Step 5: Commit all captured screenshots (if they look good)**

```bash
git add assets/screenshots/
git commit -m "feat: capture initial screenshot set (19 shots, PNG + WebP)"
```

---

## Post-Implementation Notes

- To re-capture after UI changes, just re-run `npx tsx scripts/capture_screenshots.ts`
- The simulation seeder can be tweaked independently in `screenshot_simulation.ts`
- Shot definitions (viewports, selectors, timing) live in the `SHOTS` array in `capture_screenshots.ts`
- The gallery is regenerated on every run — no need to maintain it manually
