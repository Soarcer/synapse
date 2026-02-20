/**
 * Progressive layout test — run with increasing --step values to build complexity.
 *
 *   npx tsx scripts/simulate_layout_test.ts --step 1
 *   npx tsx scripts/simulate_layout_test.ts --step 2
 *   ...up to --step 6
 *
 * Each step clears existing data first, then sends a specific set of events.
 * Use --delay <ms> to control event spacing (default 150).
 *
 * Steps:
 *   1  Minimal chain: Session → Prompt → Agent → 2 Tools
 *   2  Sibling prompts: Session → 2 Prompts (each with Agent + 2 Tools)
 *   3  Tool count variety: Session → 3 Prompts (1, 5, 8 tools)
 *   4  Deep nesting: Session → Prompt → Agent → Task → SubAgent → 3 Tools
 *   5  Multiple sessions: 2 Sessions with 3 prompts each
 *   6  Stress test: 2 Sessions, nested agents, 10+ tools per agent
 */

const API_URL = process.env.API_URL ?? 'http://localhost:4000/api/events';
const DELETE_URL = process.env.API_URL?.replace('/events', '/events') ?? 'http://localhost:4000/api/events';

// ── CLI args ─────────────────────────────────────────────────
const args = process.argv.slice(2);
function getArg(name: string, fallback: string): string {
  const idx = args.indexOf(`--${name}`);
  return idx >= 0 && args[idx + 1] ? args[idx + 1] : fallback;
}
const STEP = parseInt(getArg('step', '1'), 10);
const DELAY = parseInt(getArg('delay', '150'), 10);

if (STEP < 1 || STEP > 6) {
  console.error('Usage: npx tsx scripts/simulate_layout_test.ts --step <1-6> [--delay <ms>]');
  process.exit(1);
}

// ── Helpers ──────────────────────────────────────────────────
const ts = Date.now().toString(36);
const CWD = process.cwd();
let stepNum = 0;
let clock = Date.now(); // monotonic timestamp for event ordering

interface HookPayload {
  hook_event_name: string;
  session_id: string;
  cwd?: string;
  [key: string]: unknown;
}

async function postEvent(payload: HookPayload, label: string): Promise<void> {
  stepNum++;
  // Inject a monotonically increasing timestamp so the server stores them in order
  const body = { ...payload, _sim_timestamp: clock++ };
  const res = await fetch(API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const json = await res.json();
  const status = res.ok ? '\x1b[32mOK\x1b[0m' : `\x1b[31m${res.status}\x1b[0m`;
  console.log(`  ${stepNum.toString().padStart(2)}. [${status}] ${label}`);
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function clearAll(): Promise<void> {
  try {
    await fetch(DELETE_URL, { method: 'DELETE' });
    console.log('  Cleared all events.\n');
  } catch {
    console.log('  (Could not clear events — continuing)\n');
  }
}

// ── Event builders ───────────────────────────────────────────
function sessionStart(sid: string): [HookPayload, string] {
  return [{ hook_event_name: 'SessionStart', session_id: sid, cwd: CWD, model: 'claude-opus-4-6', source: 'startup' }, `SessionStart (${sid})`];
}

function sessionEnd(sid: string): [HookPayload, string] {
  return [{ hook_event_name: 'SessionEnd', session_id: sid, cwd: CWD, reason: 'prompt_input_exit' }, `SessionEnd (${sid})`];
}

function prompt(sid: string, text: string): [HookPayload, string] {
  return [{ hook_event_name: 'UserPromptSubmit', session_id: sid, cwd: CWD, prompt: text }, `Prompt: "${text.slice(0, 40)}..."`];
}

function agentStart(sid: string, agentId: string, agentType: string, parentAgentId?: string): [HookPayload, string] {
  const p: HookPayload = { hook_event_name: 'SubagentStart', session_id: sid, cwd: CWD, agent_id: agentId, agent_type: agentType };
  if (parentAgentId) p.parent_agent_id = parentAgentId;
  return [p, `AgentStart (${agentType}: ${agentId})`];
}

function agentStop(sid: string, agentId: string, agentType: string): [HookPayload, string] {
  return [{ hook_event_name: 'SubagentStop', session_id: sid, cwd: CWD, agent_id: agentId, agent_type: agentType }, `AgentStop (${agentType}: ${agentId})`];
}

function toolStart(sid: string, toolName: string, toolUseId: string, input: Record<string, unknown>, agentId?: string): [HookPayload, string] {
  const p: HookPayload = { hook_event_name: 'PreToolUse', session_id: sid, cwd: CWD, tool_name: toolName, tool_use_id: toolUseId, tool_input: input };
  if (agentId) p.agent_id = agentId;
  return [p, `PreToolUse (${toolName}: ${toolUseId.slice(-8)}${agentId ? ` @${agentId.slice(-8)}` : ''})`];
}

function toolEnd(sid: string, toolName: string, toolUseId: string, agentId?: string): [HookPayload, string] {
  const p: HookPayload = { hook_event_name: 'PostToolUse', session_id: sid, cwd: CWD, tool_name: toolName, tool_use_id: toolUseId, tool_input: {}, tool_response: { ok: true } };
  if (agentId) p.agent_id = agentId;
  return [p, `PostToolUse (${toolName}: ${toolUseId.slice(-8)})`];
}

function taskToolStart(sid: string, toolUseId: string, agentId?: string): [HookPayload, string] {
  return toolStart(sid, 'Task', toolUseId, { description: 'spawn subagent' }, agentId);
}

// ── Send helper ──────────────────────────────────────────────
async function send(...pairs: [HookPayload, string][]): Promise<void> {
  for (const [payload, label] of pairs) {
    await postEvent(payload, label);
    await sleep(DELAY);
  }
}

// ── Step definitions ─────────────────────────────────────────

const S1 = `sim1-${ts}`;
const S2 = `sim2-${ts}`;

async function step1() {
  console.log('\x1b[1m── Step 1: Minimal chain ──\x1b[0m');
  console.log('  Session → Prompt → Agent → 2 Tools\n');

  const a1 = `agent-gp-${ts}`;
  await send(
    sessionStart(S1),
    prompt(S1, 'Explain how the WebSocket broadcasting works in this codebase'),
    agentStart(S1, a1, 'general-purpose'),
    toolStart(S1, 'Glob', `toolu_glob1_${ts}`, { pattern: '**/*.ts' }, a1),
    toolEnd(S1, 'Glob', `toolu_glob1_${ts}`, a1),
    toolStart(S1, 'Read', `toolu_read1_${ts}`, { file_path: 'server/index.ts' }, a1),
    toolEnd(S1, 'Read', `toolu_read1_${ts}`, a1),
    agentStop(S1, a1, 'general-purpose'),
  );

  console.log('\n  Expected:');
  console.log(`  Session (${S1})`);
  console.log('  └── Prompt: "Explain how..."');
  console.log('      └── Agent: general-purpose');
  console.log('          ├── tool: Glob');
  console.log('          └── tool: Read');
}

async function step2() {
  console.log('\x1b[1m── Step 2: Sibling prompts (oldest on top) ──\x1b[0m');
  console.log('  Session → 2 Prompts, each with Agent + 2 Tools\n');

  const a1 = `agent-p1-${ts}`;
  const a2 = `agent-p2-${ts}`;
  await send(
    sessionStart(S1),
    // First prompt (older → should be on top)
    prompt(S1, 'First prompt: search the codebase for WebSocket usage'),
    agentStart(S1, a1, 'Explore'),
    toolStart(S1, 'Glob', `toolu_s2g1_${ts}`, { pattern: '**/*.ts' }, a1),
    toolEnd(S1, 'Glob', `toolu_s2g1_${ts}`, a1),
    toolStart(S1, 'Read', `toolu_s2r1_${ts}`, { file_path: 'index.ts' }, a1),
    toolEnd(S1, 'Read', `toolu_s2r1_${ts}`, a1),
    agentStop(S1, a1, 'Explore'),
    // Second prompt (newer → should be below)
    prompt(S1, 'Second prompt: add a health check endpoint'),
    agentStart(S1, a2, 'general-purpose'),
    toolStart(S1, 'Edit', `toolu_s2e1_${ts}`, { file_path: 'index.ts' }, a2),
    toolEnd(S1, 'Edit', `toolu_s2e1_${ts}`, a2),
    toolStart(S1, 'Bash', `toolu_s2b1_${ts}`, { command: 'npm test' }, a2),
    toolEnd(S1, 'Bash', `toolu_s2b1_${ts}`, a2),
    agentStop(S1, a2, 'general-purpose'),
  );

  console.log('\n  Expected (oldest on top):');
  console.log(`  Session (${S1})`);
  console.log('  ├── Prompt 1: "First prompt..." (TOP)');
  console.log('  │   └── Agent: Explore');
  console.log('  │       ├── tool: Glob');
  console.log('  │       └── tool: Read');
  console.log('  └── Prompt 2: "Second prompt..." (BOTTOM)');
  console.log('      └── Agent: general-purpose');
  console.log('          ├── tool: Edit');
  console.log('          └── tool: Bash');
}

async function step3() {
  console.log('\x1b[1m── Step 3: Varying tool counts (1, 5, 8) ──\x1b[0m');
  console.log('  Session → 3 Prompts with different tool stack sizes\n');

  const a1 = `agent-tc1-${ts}`;
  const a2 = `agent-tc5-${ts}`;
  const a3 = `agent-tc8-${ts}`;

  // Build events array
  const events: [HookPayload, string][] = [
    sessionStart(S1),
    // Prompt 1: 1 tool
    prompt(S1, 'Prompt A: quick lookup (1 tool)'),
    agentStart(S1, a1, 'Explore'),
    toolStart(S1, 'Read', `toolu_tc1_${ts}`, { file_path: 'README.md' }, a1),
    toolEnd(S1, 'Read', `toolu_tc1_${ts}`, a1),
    agentStop(S1, a1, 'Explore'),
    // Prompt 2: 5 tools
    prompt(S1, 'Prompt B: moderate exploration (5 tools)'),
    agentStart(S1, a2, 'general-purpose'),
  ];
  for (let i = 0; i < 5; i++) {
    const id = `toolu_tc5_${i}_${ts}`;
    events.push(toolStart(S1, ['Glob', 'Read', 'Grep', 'Read', 'Edit'][i], id, { i }, a2));
    events.push(toolEnd(S1, ['Glob', 'Read', 'Grep', 'Read', 'Edit'][i], id, a2));
  }
  events.push(agentStop(S1, a2, 'general-purpose'));
  // Prompt 3: 8 tools
  events.push(prompt(S1, 'Prompt C: heavy refactor (8 tools)'));
  events.push(agentStart(S1, a3, 'general-purpose'));
  const toolNames = ['Glob', 'Read', 'Read', 'Grep', 'Edit', 'Edit', 'Bash', 'Write'];
  for (let i = 0; i < 8; i++) {
    const id = `toolu_tc8_${i}_${ts}`;
    events.push(toolStart(S1, toolNames[i], id, { i }, a3));
    events.push(toolEnd(S1, toolNames[i], id, a3));
  }
  events.push(agentStop(S1, a3, 'general-purpose'));

  await send(...events);

  console.log('\n  Expected (oldest on top, tool stacks grow):');
  console.log(`  Session (${S1})`);
  console.log('  ├── Prompt A (1 tool)   ← TOP');
  console.log('  ├── Prompt B (5 tools)  ← MIDDLE');
  console.log('  └── Prompt C (8 tools)  ← BOTTOM');
  console.log('  Verify: No vertical overlap even with different stack sizes');
}

async function step4() {
  console.log('\x1b[1m── Step 4: Deep nesting (Task → SubAgent) ──\x1b[0m');
  console.log('  Session → Prompt → Agent → Task → SubAgent → 3 Tools\n');

  const aMain = `agent-main-${ts}`;
  const aChild = `agent-child-${ts}`;
  const taskId = `toolu_task_${ts}`;

  await send(
    sessionStart(S1),
    prompt(S1, 'Refactor the authentication module with sub-agent exploration'),
    agentStart(S1, aMain, 'general-purpose'),
    toolStart(S1, 'Read', `toolu_d_read_${ts}`, { file_path: 'auth.ts' }, aMain),
    toolEnd(S1, 'Read', `toolu_d_read_${ts}`, aMain),
    // Task tool → spawns subagent
    taskToolStart(S1, taskId, aMain),
    agentStart(S1, aChild, 'Explore'),
    toolEnd(S1, 'Task', taskId, aMain),
    // SubAgent does 3 tools
    toolStart(S1, 'Glob', `toolu_dc_g_${ts}`, { pattern: 'auth/**' }, aChild),
    toolEnd(S1, 'Glob', `toolu_dc_g_${ts}`, aChild),
    toolStart(S1, 'Read', `toolu_dc_r1_${ts}`, { file_path: 'auth/login.ts' }, aChild),
    toolEnd(S1, 'Read', `toolu_dc_r1_${ts}`, aChild),
    toolStart(S1, 'Read', `toolu_dc_r2_${ts}`, { file_path: 'auth/session.ts' }, aChild),
    toolEnd(S1, 'Read', `toolu_dc_r2_${ts}`, aChild),
    agentStop(S1, aChild, 'Explore'),
    // Main agent finishes
    toolStart(S1, 'Edit', `toolu_d_edit_${ts}`, { file_path: 'auth.ts' }, aMain),
    toolEnd(S1, 'Edit', `toolu_d_edit_${ts}`, aMain),
    agentStop(S1, aMain, 'general-purpose'),
  );

  console.log('\n  Expected:');
  console.log(`  Session (${S1})`);
  console.log('  └── Prompt: "Refactor..."');
  console.log('      └── Agent: general-purpose');
  console.log('          ├── tool: Read (auth.ts)');
  console.log('          ├── tool(Task) → Agent: Explore');
  console.log('          │               ├── tool: Glob');
  console.log('          │               ├── tool: Read (login.ts)');
  console.log('          │               └── tool: Read (session.ts)');
  console.log('          └── tool: Edit (auth.ts)');
}

async function step5() {
  console.log('\x1b[1m── Step 5: Two sessions (oldest on top) ──\x1b[0m');
  console.log('  2 Sessions, 3 prompts each\n');

  const a1 = `agent-s1a_${ts}`;
  const a2 = `agent-s1b_${ts}`;
  const a3 = `agent-s1c_${ts}`;
  const a4 = `agent-s2a_${ts}`;
  const a5 = `agent-s2b_${ts}`;
  const a6 = `agent-s2c_${ts}`;

  // Session 1 (older → top)
  const s1Events: [HookPayload, string][] = [
    sessionStart(S1),
    prompt(S1, 'S1-P1: Search for API routes'),
    agentStart(S1, a1, 'Explore'),
    toolStart(S1, 'Glob', `toolu_s5_1a_${ts}`, { pattern: 'routes/*' }, a1),
    toolEnd(S1, 'Glob', `toolu_s5_1a_${ts}`, a1),
    agentStop(S1, a1, 'Explore'),
    prompt(S1, 'S1-P2: Fix the broken test'),
    agentStart(S1, a2, 'general-purpose'),
    toolStart(S1, 'Read', `toolu_s5_1b_${ts}`, { file_path: 'test.ts' }, a2),
    toolEnd(S1, 'Read', `toolu_s5_1b_${ts}`, a2),
    toolStart(S1, 'Edit', `toolu_s5_1c_${ts}`, { file_path: 'test.ts' }, a2),
    toolEnd(S1, 'Edit', `toolu_s5_1c_${ts}`, a2),
    agentStop(S1, a2, 'general-purpose'),
    prompt(S1, 'S1-P3: Run the test suite'),
    agentStart(S1, a3, 'Bash'),
    toolStart(S1, 'Bash', `toolu_s5_1d_${ts}`, { command: 'npm test' }, a3),
    toolEnd(S1, 'Bash', `toolu_s5_1d_${ts}`, a3),
    agentStop(S1, a3, 'Bash'),
  ];

  // Session 2 (newer → bottom)
  const s2Events: [HookPayload, string][] = [
    sessionStart(S2),
    prompt(S2, 'S2-P1: Add dark mode support'),
    agentStart(S2, a4, 'general-purpose'),
    toolStart(S2, 'Glob', `toolu_s5_2a_${ts}`, { pattern: '*.css' }, a4),
    toolEnd(S2, 'Glob', `toolu_s5_2a_${ts}`, a4),
    toolStart(S2, 'Edit', `toolu_s5_2b_${ts}`, { file_path: 'styles.css' }, a4),
    toolEnd(S2, 'Edit', `toolu_s5_2b_${ts}`, a4),
    agentStop(S2, a4, 'general-purpose'),
    prompt(S2, 'S2-P2: Create theme toggle component'),
    agentStart(S2, a5, 'general-purpose'),
    toolStart(S2, 'Write', `toolu_s5_2c_${ts}`, { file_path: 'ThemeToggle.tsx' }, a5),
    toolEnd(S2, 'Write', `toolu_s5_2c_${ts}`, a5),
    agentStop(S2, a5, 'general-purpose'),
    prompt(S2, 'S2-P3: Write tests for theme toggle'),
    agentStart(S2, a6, 'general-purpose'),
    toolStart(S2, 'Write', `toolu_s5_2d_${ts}`, { file_path: 'ThemeToggle.test.tsx' }, a6),
    toolEnd(S2, 'Write', `toolu_s5_2d_${ts}`, a6),
    toolStart(S2, 'Bash', `toolu_s5_2e_${ts}`, { command: 'npx vitest' }, a6),
    toolEnd(S2, 'Bash', `toolu_s5_2e_${ts}`, a6),
    agentStop(S2, a6, 'general-purpose'),
  ];

  await send(...s1Events, ...s2Events);

  console.log('\n  Expected (Session 1 on top):');
  console.log(`  Session 1 (${S1}) ← TOP`);
  console.log('  ├── S1-P1 → Explore (1 tool)');
  console.log('  ├── S1-P2 → general-purpose (2 tools)');
  console.log('  └── S1-P3 → Bash (1 tool)');
  console.log(`  Session 2 (${S2}) ← BOTTOM`);
  console.log('  ├── S2-P1 → general-purpose (2 tools)');
  console.log('  ├── S2-P2 → general-purpose (1 tool)');
  console.log('  └── S2-P3 → general-purpose (2 tools)');
}

async function step6() {
  console.log('\x1b[1m── Step 6: Stress test ──\x1b[0m');
  console.log('  2 Sessions, nested agents, 10+ tools per agent\n');

  const aMega = `agent-mega-${ts}`;
  const aTask1 = `agent-task1-${ts}`;
  const aTask2 = `agent-task2-${ts}`;
  const aS2 = `agent-s2main-${ts}`;
  const taskId1 = `toolu_task1_${ts}`;
  const taskId2 = `toolu_task2_${ts}`;

  const events: [HookPayload, string][] = [
    // Session 1: mega agent with 12 tools + 2 sub-agents
    sessionStart(S1),
    prompt(S1, 'S1: Full codebase refactor with multiple sub-agents'),
    agentStart(S1, aMega, 'general-purpose'),
  ];

  // 12 tools on main agent
  const megaTools = ['Glob', 'Read', 'Read', 'Grep', 'Read', 'Edit', 'Edit', 'Read', 'Grep', 'Edit', 'Bash', 'Write'];
  for (let i = 0; i < megaTools.length; i++) {
    const id = `toolu_mega_${i}_${ts}`;
    events.push(toolStart(S1, megaTools[i], id, { i }, aMega));
    events.push(toolEnd(S1, megaTools[i], id, aMega));
  }

  // Task → SubAgent1 with 4 tools
  events.push(taskToolStart(S1, taskId1, aMega));
  events.push(agentStart(S1, aTask1, 'Explore'));
  events.push(toolEnd(S1, 'Task', taskId1, aMega));
  for (let i = 0; i < 4; i++) {
    const id = `toolu_t1_${i}_${ts}`;
    events.push(toolStart(S1, ['Glob', 'Read', 'Read', 'Grep'][i], id, { i }, aTask1));
    events.push(toolEnd(S1, ['Glob', 'Read', 'Read', 'Grep'][i], id, aTask1));
  }
  events.push(agentStop(S1, aTask1, 'Explore'));

  // Task → SubAgent2 with 3 tools
  events.push(taskToolStart(S1, taskId2, aMega));
  events.push(agentStart(S1, aTask2, 'Plan'));
  events.push(toolEnd(S1, 'Task', taskId2, aMega));
  for (let i = 0; i < 3; i++) {
    const id = `toolu_t2_${i}_${ts}`;
    events.push(toolStart(S1, ['Read', 'Grep', 'Read'][i], id, { i }, aTask2));
    events.push(toolEnd(S1, ['Read', 'Grep', 'Read'][i], id, aTask2));
  }
  events.push(agentStop(S1, aTask2, 'Plan'));
  events.push(agentStop(S1, aMega, 'general-purpose'));

  // Session 2: simpler — 2 prompts, moderate tools
  events.push(sessionStart(S2));
  events.push(prompt(S2, 'S2-P1: Quick bug fix'));
  events.push(agentStart(S2, aS2, 'general-purpose'));
  for (let i = 0; i < 3; i++) {
    const id = `toolu_s2_${i}_${ts}`;
    events.push(toolStart(S2, ['Read', 'Edit', 'Bash'][i], id, { i }, aS2));
    events.push(toolEnd(S2, ['Read', 'Edit', 'Bash'][i], id, aS2));
  }
  events.push(agentStop(S2, aS2, 'general-purpose'));
  events.push(prompt(S2, 'S2-P2: Deploy to staging'));

  await send(...events);

  console.log('\n  Expected:');
  console.log(`  Session 1 (${S1}) ← TOP`);
  console.log('  └── Prompt: "Full codebase refactor..."');
  console.log('      └── Agent: general-purpose (12 tools)');
  console.log('          ├── Task → Explore (4 tools)');
  console.log('          └── Task → Plan (3 tools)');
  console.log(`  Session 2 (${S2}) ← BOTTOM`);
  console.log('  ├── Prompt: "Quick bug fix"');
  console.log('  │   └── Agent: general-purpose (3 tools)');
  console.log('  └── Prompt: "Deploy to staging" (no agent)');
}

// ── Main ─────────────────────────────────────────────────────
async function main() {
  console.log(`\n\x1b[1mSynapse Layout Test — Step ${STEP}\x1b[0m`);
  console.log(`  Server:  ${API_URL}`);
  console.log(`  Delay:   ${DELAY}ms\n`);

  await clearAll();
  // Small pause after clear so frontend resets
  await sleep(500);

  const steps: Record<number, () => Promise<void>> = {
    1: step1,
    2: step2,
    3: step3,
    4: step4,
    5: step5,
    6: step6,
  };

  await steps[STEP]();

  console.log(`\n\x1b[32mStep ${STEP} complete!\x1b[0m Open http://localhost:5173 to verify.\n`);
}

main().catch((err) => {
  console.error('\x1b[31mFailed:\x1b[0m', err.message);
  process.exit(1);
});
