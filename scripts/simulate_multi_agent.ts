/**
 * Multi-agent simulation: 3 top-level agents, one of which spawns 2 sub-agents.
 * Run with: npx tsx scripts/simulate_multi_agent.ts
 *
 * Hierarchy:
 *   Session → Prompt
 *   ├── Agent A (Explore)        — 3 tools: Glob, Grep, Read
 *   ├── Agent B (general-purpose) — 4 tools: Read, Grep, WebSearch, Edit
 *   │   ├── Sub-Agent B1 (Explore) — 3 tools: Glob, Read, Grep
 *   │   └── Sub-Agent B2 (Plan)    — 3 tools: Read, Glob, Read
 *   └── Agent C (code-review)     — 3 tools: Read, Grep, Read
 */

const API_URL = process.env.API_URL ?? 'http://localhost:27246/api/events';

const ts = Date.now().toString(36);
const SESSION_ID = `multi-${ts}`;
const AGENT_A = `agent-explore-${ts}`;
const AGENT_B = `agent-gp-${ts}`;
const AGENT_C = `agent-review-${ts}`;
const SUB_B1 = `agent-sub-explore-${ts}`;
const SUB_B2 = `agent-sub-plan-${ts}`;
const CWD = process.cwd();

interface HookPayload {
  hook_event_name: string;
  session_id: string;
  cwd?: string;
  permission_mode?: string;
  [key: string]: unknown;
}

let stepNum = 0;
let failCount = 0;

async function post(payload: HookPayload, label: string): Promise<void> {
  stepNum++;
  try {
    const res = await fetch(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const body = await res.json();
    const status = res.ok ? '\x1b[32mOK\x1b[0m' : `\x1b[31m${res.status}\x1b[0m`;
    if (!res.ok) failCount++;
    console.log(`  ${stepNum.toString().padStart(2)}. [${status}] ${label}`);
  } catch (err: unknown) {
    failCount++;
    const msg = err instanceof Error ? err.message : String(err);
    console.log(`  ${stepNum.toString().padStart(2)}. [\x1b[31mERR\x1b[0m] ${label} → ${msg}`);
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Emit a tool start+end pair */
async function tool(
  agentId: string,
  toolName: string,
  input: Record<string, unknown>,
  response: Record<string, unknown>,
  label: string,
): Promise<void> {
  const toolId = `toolu_${toolName.toLowerCase()}_${agentId.slice(-6)}_${stepNum}`;
  await post(
    {
      hook_event_name: 'PreToolUse',
      session_id: SESSION_ID,
      cwd: CWD,
      agent_id: agentId,
      tool_name: toolName,
      tool_use_id: toolId,
      tool_input: input,
    },
    `PreToolUse  (${toolName} — ${label})`,
  );
  await sleep(300 + Math.random() * 400);

  await post(
    {
      hook_event_name: 'PostToolUse',
      session_id: SESSION_ID,
      cwd: CWD,
      agent_id: agentId,
      tool_name: toolName,
      tool_use_id: toolId,
      tool_input: input,
      tool_response: response,
    },
    `PostToolUse (${toolName} — ${label})`,
  );
  await sleep(150);
}

async function main() {
  console.log(`\n\x1b[1m=== Synapse Multi-Agent Simulator ===\x1b[0m`);
  console.log(`  Session: ${SESSION_ID}`);
  console.log(`  Server:  ${API_URL}\n`);

  // ── Session Start ──────────────────────────────────────────
  console.log('\x1b[36m── Session ──\x1b[0m');
  await post(
    {
      hook_event_name: 'SessionStart',
      session_id: SESSION_ID,
      cwd: CWD,
      permission_mode: 'default',
      source: 'startup',
      model: 'claude-opus-4-6',
    },
    'SessionStart',
  );
  await sleep(200);

  // ── User Prompt ────────────────────────────────────────────
  console.log('\n\x1b[36m── Prompt ──\x1b[0m');
  await post(
    {
      hook_event_name: 'UserPromptSubmit',
      session_id: SESSION_ID,
      cwd: CWD,
      prompt:
        'Research the authentication system, plan improvements, and review the current implementation',
    },
    'UserPrompt',
  );
  await sleep(300);

  // ══════════════════════════════════════════════════════════════
  // AGENT A — Explore (3 tools: Glob, Grep, Read)
  // ══════════════════════════════════════════════════════════════
  console.log('\n\x1b[36m── Agent A: Explore (3 tools) ──\x1b[0m');
  await post(
    {
      hook_event_name: 'SubagentStart',
      session_id: SESSION_ID,
      cwd: CWD,
      agent_id: AGENT_A,
      agent_type: 'Explore',
    },
    'SubagentStart (Explore)',
  );
  await sleep(300);

  await tool(
    AGENT_A,
    'Glob',
    { pattern: 'src/auth/**/*.ts' },
    { files: ['src/auth/login.ts', 'src/auth/session.ts', 'src/auth/middleware.ts'] },
    'Agent A',
  );

  await tool(
    AGENT_A,
    'Grep',
    { pattern: 'jwt\\.verify', path: 'src/auth/' },
    { matches: ['src/auth/middleware.ts:14:const decoded = jwt.verify(token, secret)'] },
    'Agent A',
  );

  await tool(
    AGENT_A,
    'Read',
    { file_path: 'src/auth/middleware.ts' },
    {
      content:
        'import jwt from "jsonwebtoken";\nexport function authMiddleware(req, res, next) { ... }',
    },
    'Agent A',
  );

  await post(
    {
      hook_event_name: 'SubagentStop',
      session_id: SESSION_ID,
      cwd: CWD,
      agent_id: AGENT_A,
      agent_type: 'Explore',
    },
    'SubagentStop (Explore)',
  );
  await sleep(200);

  // ══════════════════════════════════════════════════════════════
  // AGENT B — general-purpose (4 tools + spawns 2 sub-agents)
  // ══════════════════════════════════════════════════════════════
  console.log('\n\x1b[36m── Agent B: general-purpose (4 tools + 2 sub-agents) ──\x1b[0m');
  await post(
    {
      hook_event_name: 'SubagentStart',
      session_id: SESSION_ID,
      cwd: CWD,
      agent_id: AGENT_B,
      agent_type: 'general-purpose',
    },
    'SubagentStart (general-purpose)',
  );
  await sleep(300);

  await tool(
    AGENT_B,
    'Read',
    { file_path: 'package.json' },
    { content: '{"name":"myapp","dependencies":{"jsonwebtoken":"^9.0.0","bcrypt":"^5.1.0"}}' },
    'Agent B',
  );

  await tool(
    AGENT_B,
    'Grep',
    { pattern: 'bcrypt\\.hash', path: 'src/' },
    { matches: ['src/auth/login.ts:22:const hashed = await bcrypt.hash(password, 12)'] },
    'Agent B',
  );

  await tool(
    AGENT_B,
    'WebSearch',
    { query: 'jwt refresh token best practices 2026' },
    { results: ['Use rotating refresh tokens', 'Short-lived access tokens (15min)'] },
    'Agent B',
  );

  await tool(
    AGENT_B,
    'Edit',
    {
      file_path: 'src/auth/config.ts',
      old_string: 'expiresIn: "7d"',
      new_string: 'expiresIn: "15m"',
    },
    { success: true },
    'Agent B',
  );

  // ── Sub-Agent B1: Explore (3 tools) ─────────────────────
  console.log('\n\x1b[33m  ── Sub-Agent B1: Explore (3 tools) ──\x1b[0m');
  await post(
    {
      hook_event_name: 'SubagentStart',
      session_id: SESSION_ID,
      cwd: CWD,
      agent_id: SUB_B1,
      agent_type: 'Explore',
      parent_agent_id: AGENT_B,
    },
    'SubagentStart (Sub-Explore under B)',
  );
  await sleep(300);

  await tool(
    SUB_B1,
    'Glob',
    { pattern: 'src/routes/**/*.ts' },
    { files: ['src/routes/api.ts', 'src/routes/auth.ts', 'src/routes/users.ts'] },
    'Sub B1',
  );

  await tool(
    SUB_B1,
    'Read',
    { file_path: 'src/routes/auth.ts' },
    { content: 'router.post("/login", loginHandler);\nrouter.post("/register", registerHandler);' },
    'Sub B1',
  );

  await tool(
    SUB_B1,
    'Grep',
    { pattern: 'refreshToken', path: 'src/' },
    { matches: ['src/auth/login.ts:34:const refreshToken = generateRefresh(user.id)'] },
    'Sub B1',
  );

  await post(
    {
      hook_event_name: 'SubagentStop',
      session_id: SESSION_ID,
      cwd: CWD,
      agent_id: SUB_B1,
      agent_type: 'Explore',
    },
    'SubagentStop (Sub-Explore)',
  );
  await sleep(200);

  // ── Sub-Agent B2: Plan (3 tools) ────────────────────────
  console.log('\n\x1b[33m  ── Sub-Agent B2: Plan (3 tools) ──\x1b[0m');
  await post(
    {
      hook_event_name: 'SubagentStart',
      session_id: SESSION_ID,
      cwd: CWD,
      agent_id: SUB_B2,
      agent_type: 'Plan',
      parent_agent_id: AGENT_B,
    },
    'SubagentStart (Sub-Plan under B)',
  );
  await sleep(300);

  await tool(
    SUB_B2,
    'Read',
    { file_path: 'docs/ARCHITECTURE.md' },
    { content: '# Architecture\n## Authentication\nJWT-based auth with refresh tokens...' },
    'Sub B2',
  );

  await tool(
    SUB_B2,
    'Glob',
    { pattern: 'src/auth/*.ts' },
    {
      files: [
        'src/auth/login.ts',
        'src/auth/session.ts',
        'src/auth/middleware.ts',
        'src/auth/config.ts',
      ],
    },
    'Sub B2',
  );

  await tool(
    SUB_B2,
    'Read',
    { file_path: 'src/auth/session.ts' },
    { content: 'export class SessionManager { constructor(private store: Redis) { ... } }' },
    'Sub B2',
  );

  await post(
    {
      hook_event_name: 'SubagentStop',
      session_id: SESSION_ID,
      cwd: CWD,
      agent_id: SUB_B2,
      agent_type: 'Plan',
    },
    'SubagentStop (Sub-Plan)',
  );
  await sleep(200);

  // ── Agent B stops ──
  await post(
    {
      hook_event_name: 'SubagentStop',
      session_id: SESSION_ID,
      cwd: CWD,
      agent_id: AGENT_B,
      agent_type: 'general-purpose',
    },
    'SubagentStop (general-purpose)',
  );
  await sleep(200);

  // ══════════════════════════════════════════════════════════════
  // AGENT C — code-review (3 tools: Read, Grep, Read)
  // ══════════════════════════════════════════════════════════════
  console.log('\n\x1b[36m── Agent C: code-review (3 tools) ──\x1b[0m');
  await post(
    {
      hook_event_name: 'SubagentStart',
      session_id: SESSION_ID,
      cwd: CWD,
      agent_id: AGENT_C,
      agent_type: 'code-review',
    },
    'SubagentStart (code-review)',
  );
  await sleep(300);

  await tool(
    AGENT_C,
    'Read',
    { file_path: 'src/auth/login.ts' },
    {
      content: 'import bcrypt from "bcrypt";\nexport async function loginHandler(req, res) { ... }',
    },
    'Agent C',
  );

  await tool(
    AGENT_C,
    'Grep',
    { pattern: 'TODO|FIXME|HACK', path: 'src/auth/' },
    {
      matches: [
        'src/auth/middleware.ts:8:// TODO: rate limiting',
        'src/auth/login.ts:41:// FIXME: timing attack',
      ],
    },
    'Agent C',
  );

  await tool(
    AGENT_C,
    'Read',
    { file_path: 'src/auth/session.ts' },
    {
      content:
        'export class SessionManager {\n  async create(userId: string) { ... }\n  async revoke(sessionId: string) { ... }\n}',
    },
    'Agent C',
  );

  await post(
    {
      hook_event_name: 'SubagentStop',
      session_id: SESSION_ID,
      cwd: CWD,
      agent_id: AGENT_C,
      agent_type: 'code-review',
    },
    'SubagentStop (code-review)',
  );
  await sleep(200);

  // ── Stop + Session End ─────────────────────────────────────
  console.log('\n\x1b[36m── Session End ──\x1b[0m');
  await post(
    {
      hook_event_name: 'Stop',
      session_id: SESSION_ID,
      cwd: CWD,
      stop_hook_active: false,
    },
    'Stop',
  );
  await sleep(200);

  await post(
    {
      hook_event_name: 'SessionEnd',
      session_id: SESSION_ID,
      cwd: CWD,
      reason: 'prompt_input_exit',
    },
    'SessionEnd',
  );

  // ── Summary ────────────────────────────────────────────────
  console.log(`\n\x1b[1m=== Results ===\x1b[0m`);
  console.log(`  Total events: ${stepNum}`);
  console.log(
    `  Failures:     ${failCount === 0 ? '\x1b[32m0\x1b[0m' : `\x1b[31m${failCount}\x1b[0m`}`,
  );
  console.log(`\n\x1b[1mExpected Graph Hierarchy:\x1b[0m`);
  console.log(`  Session (${SESSION_ID})`);
  console.log('  └── Prompt: "Research the authentication system..."');
  console.log('      ├── Agent A: Explore');
  console.log('      │   ├── tool: Glob (src/auth/**/*.ts)');
  console.log('      │   ├── tool: Grep (jwt.verify)');
  console.log('      │   └── tool: Read (middleware.ts)');
  console.log('      ├── Agent B: general-purpose');
  console.log('      │   ├── tool: Read (package.json)');
  console.log('      │   ├── tool: Grep (bcrypt.hash)');
  console.log('      │   ├── tool: WebSearch (jwt best practices)');
  console.log('      │   ├── tool: Edit (config.ts)');
  console.log('      │   ├── Sub-Agent B1: Explore');
  console.log('      │   │   ├── tool: Glob (src/routes)');
  console.log('      │   │   ├── tool: Read (auth.ts)');
  console.log('      │   │   └── tool: Grep (refreshToken)');
  console.log('      │   └── Sub-Agent B2: Plan');
  console.log('      │       ├── tool: Read (ARCHITECTURE.md)');
  console.log('      │       ├── tool: Glob (src/auth)');
  console.log('      │       └── tool: Read (session.ts)');
  console.log('      └── Agent C: code-review');
  console.log('          ├── tool: Read (login.ts)');
  console.log('          ├── tool: Grep (TODO/FIXME)');
  console.log('          └── tool: Read (session.ts)');
  console.log('');
  console.log('\x1b[1mNode Counts:\x1b[0m');
  console.log('  session:    1');
  console.log('  userPrompt: 1');
  console.log('  agent:      5 (A + B + B1 + B2 + C)');
  console.log('  toolCall:   16 (3 + 4 + 3 + 3 + 3)');
  console.log('  spawnAgent: 1');
  console.log('  TOTAL:      24 nodes');
  console.log(`\n  Open \x1b[4mhttp://localhost:5173\x1b[0m to verify.\n`);
}

main().catch((err) => {
  console.error('\x1b[31mSimulation failed:\x1b[0m', err.message);
  process.exit(1);
});
