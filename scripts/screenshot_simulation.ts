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
  await post(
    {
      hook_event_name: 'SessionStart',
      session_id: SESSION_ID,
      cwd: CWD,
      permission_mode: 'default',
      source: 'startup',
      model: 'claude-opus-4-6',
      git_branch: 'feat/auth-refactor',
      transcript_path: `~/.claude/projects/sim/${SESSION_ID}.jsonl`,
    },
    'SessionStart',
  );
  await sleep(DELAY);

  // ═══════════════════════════════════════════════════════════════
  // PROMPT 1: "Analyze the auth module for security vulnerabilities"
  // Agent A1: Security audit — success, 4 tools (Read×2, Grep, Bash)
  // ═══════════════════════════════════════════════════════════════
  console.log('\n\x1b[36m── Prompt 1: Security Audit ──\x1b[0m');
  await post(
    {
      hook_event_name: 'UserPromptSubmit',
      session_id: SESSION_ID,
      cwd: CWD,
      prompt: 'Analyze the auth module for security vulnerabilities',
    },
    'Prompt 1',
  );
  await sleep(DELAY);

  // A1: Security audit agent
  await post(
    {
      hook_event_name: 'SubagentStart',
      session_id: SESSION_ID,
      cwd: CWD,
      agent_id: A1_ID,
      agent_type: 'Explore',
    },
    'A1 Start (Security Audit)',
  );
  await sleep(DELAY);

  // A1 Tool 1: Read auth.ts
  const a1r1 = toolId('read');
  await post(
    {
      hook_event_name: 'PreToolUse',
      session_id: SESSION_ID,
      cwd: CWD,
      agent_id: A1_ID,
      tool_name: 'Read',
      tool_use_id: a1r1,
      tool_input: { file_path: 'server/lib/auth.ts' },
    },
    'A1: Read auth.ts',
  );
  await sleep(DELAY);
  await post(
    {
      hook_event_name: 'PostToolUse',
      session_id: SESSION_ID,
      cwd: CWD,
      agent_id: A1_ID,
      tool_name: 'Read',
      tool_use_id: a1r1,
      tool_input: { file_path: 'server/lib/auth.ts' },
      tool_response: {
        content:
          'import { verify } from "jsonwebtoken";\nexport function validateToken(token: string) { ... }',
      },
    },
    'A1: Read auth.ts ✓',
  );
  await sleep(DELAY);

  // A1 Tool 2: Read middleware.ts
  const a1r2 = toolId('read');
  await post(
    {
      hook_event_name: 'PreToolUse',
      session_id: SESSION_ID,
      cwd: CWD,
      agent_id: A1_ID,
      tool_name: 'Read',
      tool_use_id: a1r2,
      tool_input: { file_path: 'server/middleware/auth.ts' },
    },
    'A1: Read middleware.ts',
  );
  await sleep(DELAY);
  await post(
    {
      hook_event_name: 'PostToolUse',
      session_id: SESSION_ID,
      cwd: CWD,
      agent_id: A1_ID,
      tool_name: 'Read',
      tool_use_id: a1r2,
      tool_input: { file_path: 'server/middleware/auth.ts' },
      tool_response: { content: 'export const authMiddleware = (req, res, next) => { ... }' },
    },
    'A1: Read middleware.ts ✓',
  );
  await sleep(DELAY);

  // A1 Tool 3: Grep for SQL injection patterns
  const a1g1 = toolId('grep');
  await post(
    {
      hook_event_name: 'PreToolUse',
      session_id: SESSION_ID,
      cwd: CWD,
      agent_id: A1_ID,
      tool_name: 'Grep',
      tool_use_id: a1g1,
      tool_input: { pattern: 'req\\.query|req\\.params.*sql', path: 'server/' },
    },
    'A1: Grep SQL patterns',
  );
  await sleep(DELAY);
  await post(
    {
      hook_event_name: 'PostToolUse',
      session_id: SESSION_ID,
      cwd: CWD,
      agent_id: A1_ID,
      tool_name: 'Grep',
      tool_use_id: a1g1,
      tool_input: { pattern: 'req\\.query|req\\.params.*sql' },
      tool_response: { matches: ['server/routes/users.ts:45: const id = req.params.id;'] },
    },
    'A1: Grep ✓',
  );
  await sleep(DELAY);

  // A1 Tool 4: Bash — run security linter
  const a1b1 = toolId('bash');
  await post(
    {
      hook_event_name: 'PreToolUse',
      session_id: SESSION_ID,
      cwd: CWD,
      agent_id: A1_ID,
      tool_name: 'Bash',
      tool_use_id: a1b1,
      tool_input: {
        command: 'npx eslint --rule "security/*" server/',
        description: 'Run security linter',
      },
    },
    'A1: Bash security lint',
  );
  await sleep(DELAY);
  await post(
    {
      hook_event_name: 'PostToolUse',
      session_id: SESSION_ID,
      cwd: CWD,
      agent_id: A1_ID,
      tool_name: 'Bash',
      tool_use_id: a1b1,
      tool_input: { command: 'npx eslint --rule "security/*" server/' },
      tool_response: { stdout: '✓ No security issues found (12 files checked)', exitCode: 0 },
    },
    'A1: Bash ✓',
  );
  await sleep(DELAY);

  // A1 agent stop
  await post(
    {
      hook_event_name: 'SubagentStop',
      session_id: SESSION_ID,
      cwd: CWD,
      agent_id: A1_ID,
      agent_type: 'Explore',
    },
    'A1 Stop',
  );
  await sleep(DELAY);

  // Assistant response for P1
  await post(
    {
      hook_event_name: 'AssistantResponse',
      session_id: SESSION_ID,
      cwd: CWD,
      assistant_text:
        'Security audit complete. The auth module uses JWT with proper validation. No SQL injection vulnerabilities found. The middleware correctly validates tokens before allowing access to protected routes.',
    },
    'Response P1',
  );
  await sleep(DELAY);

  // Stop turn 1
  await post(
    {
      hook_event_name: 'Stop',
      session_id: SESSION_ID,
      cwd: CWD,
      stop_hook_active: false,
    },
    'Stop turn 1',
  );
  await sleep(DELAY);

  // Compaction 1
  await post(
    {
      hook_event_name: 'PreCompact',
      session_id: SESSION_ID,
      cwd: CWD,
      trigger: 'auto',
    },
    'Compaction #1',
  );
  await sleep(DELAY);

  // ═══════════════════════════════════════════════════════════════
  // PROMPT 2: "Refactor the database layer to use connection pooling"
  // A2: DB schema refactor — success, 5 tools (Read, Edit×2, Bash, Write)
  // A3: Migration writer — success, 3 tools (Read, Write, Bash)
  // ═══════════════════════════════════════════════════════════════
  console.log('\n\x1b[36m── Prompt 2: Database Refactor ──\x1b[0m');
  await post(
    {
      hook_event_name: 'UserPromptSubmit',
      session_id: SESSION_ID,
      cwd: CWD,
      prompt: 'Refactor the database layer to use connection pooling',
    },
    'Prompt 2',
  );
  await sleep(DELAY);

  // A2: DB schema refactor
  await post(
    {
      hook_event_name: 'SubagentStart',
      session_id: SESSION_ID,
      cwd: CWD,
      agent_id: A2_ID,
      agent_type: 'Plan',
    },
    'A2 Start (DB Refactor)',
  );
  await sleep(DELAY);

  // A2 Tool 1: Read db.ts
  const a2r1 = toolId('read');
  await post(
    {
      hook_event_name: 'PreToolUse',
      session_id: SESSION_ID,
      cwd: CWD,
      agent_id: A2_ID,
      tool_name: 'Read',
      tool_use_id: a2r1,
      tool_input: { file_path: 'server/db.ts' },
    },
    'A2: Read db.ts',
  );
  await sleep(DELAY);
  await post(
    {
      hook_event_name: 'PostToolUse',
      session_id: SESSION_ID,
      cwd: CWD,
      agent_id: A2_ID,
      tool_name: 'Read',
      tool_use_id: a2r1,
      tool_input: { file_path: 'server/db.ts' },
      tool_response: {
        content: 'import Database from "better-sqlite3";\nconst db = new Database("app.db");',
      },
    },
    'A2: Read db.ts ✓',
  );
  await sleep(DELAY);

  // A2 Tool 2: Edit db.ts (add pool)
  const a2e1 = toolId('edit');
  await post(
    {
      hook_event_name: 'PreToolUse',
      session_id: SESSION_ID,
      cwd: CWD,
      agent_id: A2_ID,
      tool_name: 'Edit',
      tool_use_id: a2e1,
      tool_input: {
        file_path: 'server/db.ts',
        old_string: 'const db = new Database',
        new_string: 'const pool = createPool',
      },
    },
    'A2: Edit db.ts (pool)',
  );
  await sleep(DELAY);
  await post(
    {
      hook_event_name: 'PostToolUse',
      session_id: SESSION_ID,
      cwd: CWD,
      agent_id: A2_ID,
      tool_name: 'Edit',
      tool_use_id: a2e1,
      tool_input: { file_path: 'server/db.ts' },
      tool_response: { success: true },
    },
    'A2: Edit db.ts ✓',
  );
  await sleep(DELAY);

  // A2 Tool 3: Edit config.ts (pool settings)
  const a2e2 = toolId('edit');
  await post(
    {
      hook_event_name: 'PreToolUse',
      session_id: SESSION_ID,
      cwd: CWD,
      agent_id: A2_ID,
      tool_name: 'Edit',
      tool_use_id: a2e2,
      tool_input: {
        file_path: 'server/config.ts',
        old_string: 'dbPath:',
        new_string: 'poolSize: 10,\n  dbPath:',
      },
    },
    'A2: Edit config.ts',
  );
  await sleep(DELAY);
  await post(
    {
      hook_event_name: 'PostToolUse',
      session_id: SESSION_ID,
      cwd: CWD,
      agent_id: A2_ID,
      tool_name: 'Edit',
      tool_use_id: a2e2,
      tool_input: { file_path: 'server/config.ts' },
      tool_response: { success: true },
    },
    'A2: Edit config.ts ✓',
  );
  await sleep(DELAY);

  // A2 Tool 4: Bash — run existing tests
  const a2b1 = toolId('bash');
  await post(
    {
      hook_event_name: 'PreToolUse',
      session_id: SESSION_ID,
      cwd: CWD,
      agent_id: A2_ID,
      tool_name: 'Bash',
      tool_use_id: a2b1,
      tool_input: { command: 'pnpm test -- --filter=db', description: 'Run DB tests' },
    },
    'A2: Bash run tests',
  );
  await sleep(DELAY);
  await post(
    {
      hook_event_name: 'PostToolUse',
      session_id: SESSION_ID,
      cwd: CWD,
      agent_id: A2_ID,
      tool_name: 'Bash',
      tool_use_id: a2b1,
      tool_input: { command: 'pnpm test -- --filter=db' },
      tool_response: { stdout: 'Tests: 14 passed, 14 total\nTime: 1.2s', exitCode: 0 },
    },
    'A2: Bash tests ✓',
  );
  await sleep(DELAY);

  // A2 Tool 5: Write pool.ts
  const a2w1 = toolId('write');
  await post(
    {
      hook_event_name: 'PreToolUse',
      session_id: SESSION_ID,
      cwd: CWD,
      agent_id: A2_ID,
      tool_name: 'Write',
      tool_use_id: a2w1,
      tool_input: {
        file_path: 'server/lib/pool.ts',
        content: 'export class ConnectionPool { ... }',
      },
    },
    'A2: Write pool.ts',
  );
  await sleep(DELAY);
  await post(
    {
      hook_event_name: 'PostToolUse',
      session_id: SESSION_ID,
      cwd: CWD,
      agent_id: A2_ID,
      tool_name: 'Write',
      tool_use_id: a2w1,
      tool_input: { file_path: 'server/lib/pool.ts' },
      tool_response: { success: true },
    },
    'A2: Write pool.ts ✓',
  );
  await sleep(DELAY);

  // A2 stop
  await post(
    {
      hook_event_name: 'SubagentStop',
      session_id: SESSION_ID,
      cwd: CWD,
      agent_id: A2_ID,
      agent_type: 'Plan',
    },
    'A2 Stop',
  );
  await sleep(DELAY);

  // A3: Migration writer (Task tool → child agent)
  const taskId1 = toolId('task');
  await post(
    {
      hook_event_name: 'PreToolUse',
      session_id: SESSION_ID,
      cwd: CWD,
      tool_name: 'Task',
      tool_use_id: taskId1,
      tool_input: {
        prompt: 'Write database migration for connection pooling schema',
        subagent_type: 'Explore',
      },
    },
    'Task: Migration writer',
  );
  await sleep(DELAY);

  await post(
    {
      hook_event_name: 'SubagentStart',
      session_id: SESSION_ID,
      cwd: CWD,
      agent_id: A3_ID,
      agent_type: 'Explore',
      tool_use_id: taskId1,
    },
    'A3 Start (Migration)',
  );
  await sleep(DELAY);

  // A3 Tool 1: Read existing migrations
  const a3r1 = toolId('read');
  await post(
    {
      hook_event_name: 'PreToolUse',
      session_id: SESSION_ID,
      cwd: CWD,
      agent_id: A3_ID,
      tool_name: 'Read',
      tool_use_id: a3r1,
      tool_input: { file_path: 'migrations/001_init.sql' },
    },
    'A3: Read migrations',
  );
  await sleep(DELAY);
  await post(
    {
      hook_event_name: 'PostToolUse',
      session_id: SESSION_ID,
      cwd: CWD,
      agent_id: A3_ID,
      tool_name: 'Read',
      tool_use_id: a3r1,
      tool_input: { file_path: 'migrations/001_init.sql' },
      tool_response: { content: 'CREATE TABLE users (...);\nCREATE TABLE sessions (...);' },
    },
    'A3: Read migrations ✓',
  );
  await sleep(DELAY);

  // A3 Tool 2: Write new migration
  const a3w1 = toolId('write');
  await post(
    {
      hook_event_name: 'PreToolUse',
      session_id: SESSION_ID,
      cwd: CWD,
      agent_id: A3_ID,
      tool_name: 'Write',
      tool_use_id: a3w1,
      tool_input: {
        file_path: 'migrations/002_connection_pool.sql',
        content: 'ALTER TABLE connections ADD COLUMN pool_id TEXT;',
      },
    },
    'A3: Write migration',
  );
  await sleep(DELAY);
  await post(
    {
      hook_event_name: 'PostToolUse',
      session_id: SESSION_ID,
      cwd: CWD,
      agent_id: A3_ID,
      tool_name: 'Write',
      tool_use_id: a3w1,
      tool_input: { file_path: 'migrations/002_connection_pool.sql' },
      tool_response: { success: true },
    },
    'A3: Write migration ✓',
  );
  await sleep(DELAY);

  // A3 Tool 3: Bash — run migration
  const a3b1 = toolId('bash');
  await post(
    {
      hook_event_name: 'PreToolUse',
      session_id: SESSION_ID,
      cwd: CWD,
      agent_id: A3_ID,
      tool_name: 'Bash',
      tool_use_id: a3b1,
      tool_input: { command: 'npx tsx scripts/migrate.ts', description: 'Apply migration' },
    },
    'A3: Bash migrate',
  );
  await sleep(DELAY);
  await post(
    {
      hook_event_name: 'PostToolUse',
      session_id: SESSION_ID,
      cwd: CWD,
      agent_id: A3_ID,
      tool_name: 'Bash',
      tool_use_id: a3b1,
      tool_input: { command: 'npx tsx scripts/migrate.ts' },
      tool_response: { stdout: 'Migration 002_connection_pool applied successfully', exitCode: 0 },
    },
    'A3: Bash migrate ✓',
  );
  await sleep(DELAY);

  // A3 stop
  await post(
    {
      hook_event_name: 'SubagentStop',
      session_id: SESSION_ID,
      cwd: CWD,
      agent_id: A3_ID,
      agent_type: 'Explore',
    },
    'A3 Stop',
  );
  await sleep(DELAY);

  // Task PostToolUse with token usage
  await post(
    {
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
    },
    'Task complete (A3)',
  );
  await sleep(DELAY);

  // Assistant response for P2
  await post(
    {
      hook_event_name: 'AssistantResponse',
      session_id: SESSION_ID,
      cwd: CWD,
      assistant_text:
        'Database refactoring complete. I replaced the single connection with a 10-connection pool, updated the configuration, and created migration 002 to add pool tracking. All 14 existing tests pass.',
    },
    'Response P2',
  );
  await sleep(DELAY);

  // Stop turn 2
  await post(
    {
      hook_event_name: 'Stop',
      session_id: SESSION_ID,
      cwd: CWD,
      stop_hook_active: false,
    },
    'Stop turn 2',
  );
  await sleep(DELAY);

  // Compaction 2
  await post(
    {
      hook_event_name: 'PreCompact',
      session_id: SESSION_ID,
      cwd: CWD,
      trigger: 'auto',
    },
    'Compaction #2',
  );
  await sleep(DELAY);

  // ═══════════════════════════════════════════════════════════════
  // PROMPT 3: "Add comprehensive test coverage"
  // A4: Unit test writer — RUNNING (4 tools: Read×2, Write, Glob)
  // A5: Integration test writer — success (5 tools: Read, Write, Bash×2, WebSearch)
  // A6: Coverage reporter — ERROR (2 tools: Bash, Grep)
  // ═══════════════════════════════════════════════════════════════
  console.log('\n\x1b[36m── Prompt 3: Test Coverage ──\x1b[0m');
  await post(
    {
      hook_event_name: 'UserPromptSubmit',
      session_id: SESSION_ID,
      cwd: CWD,
      prompt: 'Add comprehensive test coverage for the refactored modules',
    },
    'Prompt 3',
  );
  await sleep(DELAY);

  // A4: Unit test writer — stays RUNNING
  await post(
    {
      hook_event_name: 'SubagentStart',
      session_id: SESSION_ID,
      cwd: CWD,
      agent_id: A4_ID,
      agent_type: 'Explore',
    },
    'A4 Start (Unit Tests)',
  );
  await sleep(DELAY);

  // A4 Tool 1: Read pool.ts
  const a4r1 = toolId('read');
  await post(
    {
      hook_event_name: 'PreToolUse',
      session_id: SESSION_ID,
      cwd: CWD,
      agent_id: A4_ID,
      tool_name: 'Read',
      tool_use_id: a4r1,
      tool_input: { file_path: 'server/lib/pool.ts' },
    },
    'A4: Read pool.ts',
  );
  await sleep(DELAY);
  await post(
    {
      hook_event_name: 'PostToolUse',
      session_id: SESSION_ID,
      cwd: CWD,
      agent_id: A4_ID,
      tool_name: 'Read',
      tool_use_id: a4r1,
      tool_input: { file_path: 'server/lib/pool.ts' },
      tool_response: { content: 'export class ConnectionPool { ... }' },
    },
    'A4: Read pool.ts ✓',
  );
  await sleep(DELAY);

  // A4 Tool 2: Read config.ts
  const a4r2 = toolId('read');
  await post(
    {
      hook_event_name: 'PreToolUse',
      session_id: SESSION_ID,
      cwd: CWD,
      agent_id: A4_ID,
      tool_name: 'Read',
      tool_use_id: a4r2,
      tool_input: { file_path: 'server/config.ts' },
    },
    'A4: Read config.ts',
  );
  await sleep(DELAY);
  await post(
    {
      hook_event_name: 'PostToolUse',
      session_id: SESSION_ID,
      cwd: CWD,
      agent_id: A4_ID,
      tool_name: 'Read',
      tool_use_id: a4r2,
      tool_input: { file_path: 'server/config.ts' },
      tool_response: { content: 'export const config = { poolSize: 10, dbPath: "app.db" };' },
    },
    'A4: Read config.ts ✓',
  );
  await sleep(DELAY);

  // A4 Tool 3: Write test file
  const a4w1 = toolId('write');
  await post(
    {
      hook_event_name: 'PreToolUse',
      session_id: SESSION_ID,
      cwd: CWD,
      agent_id: A4_ID,
      tool_name: 'Write',
      tool_use_id: a4w1,
      tool_input: {
        file_path: 'tests/pool.test.ts',
        content: 'describe("ConnectionPool", () => { ... })',
      },
    },
    'A4: Write pool.test.ts',
  );
  await sleep(DELAY);
  await post(
    {
      hook_event_name: 'PostToolUse',
      session_id: SESSION_ID,
      cwd: CWD,
      agent_id: A4_ID,
      tool_name: 'Write',
      tool_use_id: a4w1,
      tool_input: { file_path: 'tests/pool.test.ts' },
      tool_response: { success: true },
    },
    'A4: Write pool.test.ts ✓',
  );
  await sleep(DELAY);

  // A4 Tool 4: Glob to find all test files (still running — no PostToolUse)
  const a4g1 = toolId('glob');
  await post(
    {
      hook_event_name: 'PreToolUse',
      session_id: SESSION_ID,
      cwd: CWD,
      agent_id: A4_ID,
      tool_name: 'Glob',
      tool_use_id: a4g1,
      tool_input: { pattern: 'tests/**/*.test.ts' },
    },
    'A4: Glob test files (running...)',
  );
  // NOTE: No PostToolUse — A4 stays in running state with this tool active
  await sleep(DELAY);

  // A5: Integration test writer — success
  const taskId2 = toolId('task');
  await post(
    {
      hook_event_name: 'PreToolUse',
      session_id: SESSION_ID,
      cwd: CWD,
      tool_name: 'Task',
      tool_use_id: taskId2,
      tool_input: {
        prompt: 'Write integration tests for the pool module',
        subagent_type: 'Explore',
      },
    },
    'Task: Integration tests',
  );
  await sleep(DELAY);

  await post(
    {
      hook_event_name: 'SubagentStart',
      session_id: SESSION_ID,
      cwd: CWD,
      agent_id: A5_ID,
      agent_type: 'Explore',
      tool_use_id: taskId2,
    },
    'A5 Start (Integration Tests)',
  );
  await sleep(DELAY);

  // A5 Tool 1: Read
  const a5r1 = toolId('read');
  await post(
    {
      hook_event_name: 'PreToolUse',
      session_id: SESSION_ID,
      cwd: CWD,
      agent_id: A5_ID,
      tool_name: 'Read',
      tool_use_id: a5r1,
      tool_input: { file_path: 'server/lib/pool.ts' },
    },
    'A5: Read pool.ts',
  );
  await sleep(DELAY);
  await post(
    {
      hook_event_name: 'PostToolUse',
      session_id: SESSION_ID,
      cwd: CWD,
      agent_id: A5_ID,
      tool_name: 'Read',
      tool_use_id: a5r1,
      tool_input: { file_path: 'server/lib/pool.ts' },
      tool_response: { content: 'export class ConnectionPool { ... }' },
    },
    'A5: Read ✓',
  );
  await sleep(DELAY);

  // A5 Tool 2: WebSearch for integration testing best practices
  const a5ws = toolId('websearch');
  await post(
    {
      hook_event_name: 'PreToolUse',
      session_id: SESSION_ID,
      cwd: CWD,
      agent_id: A5_ID,
      tool_name: 'WebSearch',
      tool_use_id: a5ws,
      tool_input: { query: 'sqlite connection pool integration testing best practices' },
    },
    'A5: WebSearch',
  );
  await sleep(DELAY);
  await post(
    {
      hook_event_name: 'PostToolUse',
      session_id: SESSION_ID,
      cwd: CWD,
      agent_id: A5_ID,
      tool_name: 'WebSearch',
      tool_use_id: a5ws,
      tool_input: { query: 'sqlite connection pool integration testing' },
      tool_response: {
        results: [{ title: 'Testing Database Pools', url: 'https://example.com/testing-pools' }],
      },
    },
    'A5: WebSearch ✓',
  );
  await sleep(DELAY);

  // A5 Tool 3: Write integration test
  const a5w1 = toolId('write');
  await post(
    {
      hook_event_name: 'PreToolUse',
      session_id: SESSION_ID,
      cwd: CWD,
      agent_id: A5_ID,
      tool_name: 'Write',
      tool_use_id: a5w1,
      tool_input: {
        file_path: 'tests/integration/pool.integration.test.ts',
        content: 'describe("Pool Integration", () => { ... })',
      },
    },
    'A5: Write integration test',
  );
  await sleep(DELAY);
  await post(
    {
      hook_event_name: 'PostToolUse',
      session_id: SESSION_ID,
      cwd: CWD,
      agent_id: A5_ID,
      tool_name: 'Write',
      tool_use_id: a5w1,
      tool_input: { file_path: 'tests/integration/pool.integration.test.ts' },
      tool_response: { success: true },
    },
    'A5: Write integration test ✓',
  );
  await sleep(DELAY);

  // A5 Tool 4: Bash run integration tests
  const a5b1 = toolId('bash');
  await post(
    {
      hook_event_name: 'PreToolUse',
      session_id: SESSION_ID,
      cwd: CWD,
      agent_id: A5_ID,
      tool_name: 'Bash',
      tool_use_id: a5b1,
      tool_input: {
        command: 'pnpm test -- tests/integration/',
        description: 'Run integration tests',
      },
    },
    'A5: Bash integration tests',
  );
  await sleep(DELAY);
  await post(
    {
      hook_event_name: 'PostToolUse',
      session_id: SESSION_ID,
      cwd: CWD,
      agent_id: A5_ID,
      tool_name: 'Bash',
      tool_use_id: a5b1,
      tool_input: { command: 'pnpm test -- tests/integration/' },
      tool_response: { stdout: 'Tests: 8 passed, 8 total\nTime: 3.4s', exitCode: 0 },
    },
    'A5: Bash integration ✓',
  );
  await sleep(DELAY);

  // A5 Tool 5: Bash run all tests
  const a5b2 = toolId('bash');
  await post(
    {
      hook_event_name: 'PreToolUse',
      session_id: SESSION_ID,
      cwd: CWD,
      agent_id: A5_ID,
      tool_name: 'Bash',
      tool_use_id: a5b2,
      tool_input: { command: 'pnpm test', description: 'Run full test suite' },
    },
    'A5: Bash full suite',
  );
  await sleep(DELAY);
  await post(
    {
      hook_event_name: 'PostToolUse',
      session_id: SESSION_ID,
      cwd: CWD,
      agent_id: A5_ID,
      tool_name: 'Bash',
      tool_use_id: a5b2,
      tool_input: { command: 'pnpm test' },
      tool_response: { stdout: 'Tests: 22 passed, 22 total\nTime: 4.8s', exitCode: 0 },
    },
    'A5: Bash full suite ✓',
  );
  await sleep(DELAY);

  // A5 stop
  await post(
    {
      hook_event_name: 'SubagentStop',
      session_id: SESSION_ID,
      cwd: CWD,
      agent_id: A5_ID,
      agent_type: 'Explore',
    },
    'A5 Stop',
  );
  await sleep(DELAY);

  // Task PostToolUse for A5
  await post(
    {
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
    },
    'Task complete (A5)',
  );
  await sleep(DELAY);

  // A6: Coverage reporter — ERROR
  await post(
    {
      hook_event_name: 'SubagentStart',
      session_id: SESSION_ID,
      cwd: CWD,
      agent_id: A6_ID,
      agent_type: 'Explore',
    },
    'A6 Start (Coverage Reporter)',
  );
  await sleep(DELAY);

  // A6 Tool 1: Bash — run coverage (fails)
  const a6b1 = toolId('bash');
  await post(
    {
      hook_event_name: 'PreToolUse',
      session_id: SESSION_ID,
      cwd: CWD,
      agent_id: A6_ID,
      tool_name: 'Bash',
      tool_use_id: a6b1,
      tool_input: { command: 'pnpm test -- --coverage', description: 'Generate coverage report' },
    },
    'A6: Bash coverage',
  );
  await sleep(DELAY);
  await post(
    {
      hook_event_name: 'PostToolUseFailure',
      session_id: SESSION_ID,
      cwd: CWD,
      agent_id: A6_ID,
      tool_name: 'Bash',
      tool_use_id: a6b1,
      tool_input: { command: 'pnpm test -- --coverage' },
      error: 'ENOMEM: Cannot allocate memory for coverage instrumentation',
    },
    'A6: Bash coverage ✗ ERROR',
  );
  await sleep(DELAY);

  // A6 Tool 2: Grep — try to find existing coverage config
  const a6g1 = toolId('grep');
  await post(
    {
      hook_event_name: 'PreToolUse',
      session_id: SESSION_ID,
      cwd: CWD,
      agent_id: A6_ID,
      tool_name: 'Grep',
      tool_use_id: a6g1,
      tool_input: { pattern: 'coverage', path: 'package.json' },
    },
    'A6: Grep coverage config',
  );
  await sleep(DELAY);
  await post(
    {
      hook_event_name: 'PostToolUse',
      session_id: SESSION_ID,
      cwd: CWD,
      agent_id: A6_ID,
      tool_name: 'Grep',
      tool_use_id: a6g1,
      tool_input: { pattern: 'coverage' },
      tool_response: { matches: [] },
    },
    'A6: Grep ✓ (no config found)',
  );
  await sleep(DELAY);

  // A6 stops with error
  await post(
    {
      hook_event_name: 'SubagentStop',
      session_id: SESSION_ID,
      cwd: CWD,
      agent_id: A6_ID,
      agent_type: 'Explore',
      error: 'Coverage generation failed: out of memory',
    },
    'A6 Stop (ERROR)',
  );
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
