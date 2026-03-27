/**
 * TB Layout Test: 1 prompt → 1 agent (3 tools) → 2 child agents
 * Run with: npx tsx scripts/simulate_tb_test.ts
 */

const API_URL = process.env.API_URL ?? 'http://localhost:27247/api/events';
const ts = Date.now().toString(36);
const SESSION_ID = `tb-test-${ts}`;
const AGENT_1 = `agent-main-${ts}`;
const AGENT_2 = `agent-child-a-${ts}`;
const AGENT_3 = `agent-child-b-${ts}`;
const CWD = process.env.SIM_CWD ?? process.cwd();

let stepNum = 0;

async function post(payload: Record<string, unknown>, label: string) {
  stepNum++;
  try {
    const res = await fetch(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const body = await res.json();
    const status = res.ok ? '\x1b[32mOK\x1b[0m' : `\x1b[31m${res.status}\x1b[0m`;
    console.log(`  ${stepNum.toString().padStart(2)}. [${status}] ${label}`);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.log(`  ${stepNum.toString().padStart(2)}. [\x1b[31mERR\x1b[0m] ${label} → ${msg}`);
  }
}

const DELAY = parseInt(process.env.SIM_DELAY ?? '800', 10);
const sleep = (ms?: number) => new Promise((r) => setTimeout(r, ms ?? DELAY));

async function main() {
  console.log(`\n\x1b[1m=== TB Layout Test ===\x1b[0m`);
  console.log(`  Session: ${SESSION_ID}\n`);

  // ── Session Start ──
  await post(
    {
      hook_event_name: 'SessionStart',
      session_id: SESSION_ID,
      cwd: CWD,
      permission_mode: 'default',
      model: 'claude-opus-4-6',
    },
    'SessionStart',
  );
  await sleep(300);

  // ── Prompt ──
  await post(
    {
      hook_event_name: 'UserPromptSubmit',
      session_id: SESSION_ID,
      cwd: CWD,
      prompt: 'Refactor the auth module and update tests',
    },
    'UserPrompt',
  );
  await sleep(500);

  // ── Agent 1: Main agent ──
  await post(
    {
      hook_event_name: 'SubagentStart',
      session_id: SESSION_ID,
      cwd: CWD,
      agent_id: AGENT_1,
      agent_type: 'general-purpose',
    },
    'SubagentStart (Main)',
  );
  await sleep(400);

  // ── Tool 1: Read ──
  const t1 = `toolu_read_${ts}`;
  await post(
    {
      hook_event_name: 'PreToolUse',
      session_id: SESSION_ID,
      cwd: CWD,
      tool_name: 'Read',
      tool_use_id: t1,
      tool_input: { file_path: 'src/auth/index.ts' },
    },
    'PreToolUse (Read)',
  );
  await sleep(600);

  await post(
    {
      hook_event_name: 'PostToolUse',
      session_id: SESSION_ID,
      cwd: CWD,
      tool_name: 'Read',
      tool_use_id: t1,
      tool_input: { file_path: 'src/auth/index.ts' },
      tool_response: { content: 'export function authenticate() { ... }' },
    },
    'PostToolUse (Read)',
  );
  await sleep(300);

  // ── Tool 2: Edit ──
  const t2 = `toolu_edit_${ts}`;
  await post(
    {
      hook_event_name: 'PreToolUse',
      session_id: SESSION_ID,
      cwd: CWD,
      tool_name: 'Edit',
      tool_use_id: t2,
      tool_input: { file_path: 'src/auth/index.ts', old_string: 'old', new_string: 'new' },
    },
    'PreToolUse (Edit)',
  );
  await sleep(600);

  await post(
    {
      hook_event_name: 'PostToolUse',
      session_id: SESSION_ID,
      cwd: CWD,
      tool_name: 'Edit',
      tool_use_id: t2,
      tool_input: { file_path: 'src/auth/index.ts' },
      tool_response: { success: true },
    },
    'PostToolUse (Edit)',
  );
  await sleep(300);

  // ── Tool 3: Bash ──
  const t3 = `toolu_bash_${ts}`;
  await post(
    {
      hook_event_name: 'PreToolUse',
      session_id: SESSION_ID,
      cwd: CWD,
      tool_name: 'Bash',
      tool_use_id: t3,
      tool_input: { command: 'npm test -- --filter auth' },
    },
    'PreToolUse (Bash)',
  );
  await sleep(800);

  await post(
    {
      hook_event_name: 'PostToolUse',
      session_id: SESSION_ID,
      cwd: CWD,
      tool_name: 'Bash',
      tool_use_id: t3,
      tool_input: { command: 'npm test -- --filter auth' },
      tool_response: { stdout: 'Tests passed: 12/12', exitCode: 0 },
    },
    'PostToolUse (Bash)',
  );
  await sleep(300);

  // ── Agent 1 stops ──
  await post(
    {
      hook_event_name: 'SubagentStop',
      session_id: SESSION_ID,
      cwd: CWD,
      agent_id: AGENT_1,
      agent_type: 'general-purpose',
    },
    'SubagentStop (Main)',
  );
  await sleep(500);

  // ── Agent 2: Child A (Explore) ──
  await post(
    {
      hook_event_name: 'SubagentStart',
      session_id: SESSION_ID,
      cwd: CWD,
      agent_id: AGENT_2,
      agent_type: 'Explore',
    },
    'SubagentStart (Explore)',
  );
  await sleep(400);

  const t4 = `toolu_grep_${ts}`;
  await post(
    {
      hook_event_name: 'PreToolUse',
      session_id: SESSION_ID,
      cwd: CWD,
      tool_name: 'Grep',
      tool_use_id: t4,
      tool_input: { pattern: 'authenticate', path: 'src/' },
    },
    'PreToolUse (Grep — Explore)',
  );
  await sleep(500);

  await post(
    {
      hook_event_name: 'PostToolUse',
      session_id: SESSION_ID,
      cwd: CWD,
      tool_name: 'Grep',
      tool_use_id: t4,
      tool_input: { pattern: 'authenticate' },
      tool_response: { matches: ['src/auth/index.ts:5'] },
    },
    'PostToolUse (Grep — Explore)',
  );
  await sleep(300);

  await post(
    {
      hook_event_name: 'SubagentStop',
      session_id: SESSION_ID,
      cwd: CWD,
      agent_id: AGENT_2,
      agent_type: 'Explore',
    },
    'SubagentStop (Explore)',
  );
  await sleep(500);

  // ── Agent 3: Child B (Plan) ──
  await post(
    {
      hook_event_name: 'SubagentStart',
      session_id: SESSION_ID,
      cwd: CWD,
      agent_id: AGENT_3,
      agent_type: 'Plan',
    },
    'SubagentStart (Plan)',
  );
  await sleep(400);

  const t5 = `toolu_read2_${ts}`;
  await post(
    {
      hook_event_name: 'PreToolUse',
      session_id: SESSION_ID,
      cwd: CWD,
      tool_name: 'Read',
      tool_use_id: t5,
      tool_input: { file_path: 'docs/auth-spec.md' },
    },
    'PreToolUse (Read — Plan)',
  );
  await sleep(500);

  await post(
    {
      hook_event_name: 'PostToolUse',
      session_id: SESSION_ID,
      cwd: CWD,
      tool_name: 'Read',
      tool_use_id: t5,
      tool_input: { file_path: 'docs/auth-spec.md' },
      tool_response: { content: '# Auth Spec\n...' },
    },
    'PostToolUse (Read — Plan)',
  );
  await sleep(300);

  await post(
    {
      hook_event_name: 'SubagentStop',
      session_id: SESSION_ID,
      cwd: CWD,
      agent_id: AGENT_3,
      agent_type: 'Plan',
    },
    'SubagentStop (Plan)',
  );
  await sleep(300);

  // ── Session End ──
  await post(
    {
      hook_event_name: 'SessionEnd',
      session_id: SESSION_ID,
      cwd: CWD,
    },
    'SessionEnd',
  );

  console.log(`\n\x1b[32mDone! ${stepNum} events sent.\x1b[0m\n`);
}

main();
