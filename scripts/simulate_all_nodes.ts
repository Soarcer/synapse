/**
 * Comprehensive simulation: exercises every graph node type and event lifecycle.
 * Run with: npx tsx scripts/simulate_all_nodes.ts
 *
 * Graph Node Types tested:
 *   1. session    — SessionStart / SessionEnd
 *   2. userPrompt — UserPromptSubmit (x3)
 *   3. agent      — SubagentStart / SubagentStop (Explore + Plan)
 *   4. toolCall   — PreToolUse / PostToolUse (Read, Glob, Edit, Bash, Grep, Write)
 *                   + PostToolUseFailure (error case)
 *
 * Non-graph events tested:
 *   - Stop (pause between turns)
 *   - Notification
 *   - PreCompact (compaction indicator on prompt)
 *   - PermissionRequest
 */

const API_URL = process.env.API_URL ?? 'http://localhost:4000/api/events';

const ts = Date.now().toString(36);
const SESSION_ID = `allnodes-${ts}`;
const EXPLORE_AGENT = `agent-explore-${ts}`;
const PLAN_AGENT = `agent-plan-${ts}`;
const CWD = process.cwd();

interface HookPayload {
  hook_event_name: string;
  session_id: string;
  cwd?: string;
  permission_mode?: string;
  transcript_path?: string;
  [key: string]: unknown;
}

let stepNum = 0;
let failCount = 0;

async function postEvent(payload: HookPayload, label: string): Promise<void> {
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
    console.log(`  ${stepNum.toString().padStart(2)}. [${status}] ${label} → ${body.eventId ?? body.error ?? 'n/a'}`);
  } catch (err: unknown) {
    failCount++;
    const msg = err instanceof Error ? err.message : String(err);
    console.log(`  ${stepNum.toString().padStart(2)}. [\x1b[31mERR\x1b[0m] ${label} → ${msg}`);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function main() {
  console.log(`\n\x1b[1m=== Synapse All-Nodes Simulator ===\x1b[0m`);
  console.log(`  Session: ${SESSION_ID}`);
  console.log(`  Server:  ${API_URL}\n`);

  // ═══════════════════════════════════════════════════════════════
  // 1. SESSION START (with git branch for session naming)
  // ═══════════════════════════════════════════════════════════════
  console.log('\x1b[36m── Session ──\x1b[0m');
  await postEvent({
    hook_event_name: 'SessionStart',
    session_id: SESSION_ID,
    cwd: CWD,
    permission_mode: 'default',
    source: 'startup',
    model: 'claude-opus-4-6',
    git_branch: 'feat/health-check',
    transcript_path: `~/.claude/projects/sim/${SESSION_ID}.jsonl`,
  }, 'SessionStart (with gitBranch)');
  await sleep(200);

  // ═══════════════════════════════════════════════════════════════
  // 2. FIRST PROMPT — main agent tools (Read, Edit, Bash)
  // ═══════════════════════════════════════════════════════════════
  console.log('\n\x1b[36m── Prompt 1: Main agent tools (Read, Edit, Bash) ──\x1b[0m');
  await postEvent({
    hook_event_name: 'UserPromptSubmit',
    session_id: SESSION_ID,
    cwd: CWD,
    permission_mode: 'default',
    prompt: 'Add a health check endpoint to the server',
  }, 'UserPrompt #1');
  await sleep(300);

  // Tool: Read (success)
  const readId = `toolu_read_${ts}`;
  await postEvent({
    hook_event_name: 'PreToolUse',
    session_id: SESSION_ID,
    cwd: CWD,
    tool_name: 'Read',
    tool_use_id: readId,
    tool_input: { file_path: 'server/index.ts' },
  }, 'PreToolUse (Read)');
  await sleep(400);

  await postEvent({
    hook_event_name: 'PostToolUse',
    session_id: SESSION_ID,
    cwd: CWD,
    tool_name: 'Read',
    tool_use_id: readId,
    tool_input: { file_path: 'server/index.ts' },
    tool_response: { content: 'const app = express();\nconst server = createServer(app);' },
  }, 'PostToolUse (Read ✓)');
  await sleep(200);

  // Tool: Edit (success)
  const editId = `toolu_edit_${ts}`;
  await postEvent({
    hook_event_name: 'PreToolUse',
    session_id: SESSION_ID,
    cwd: CWD,
    tool_name: 'Edit',
    tool_use_id: editId,
    tool_input: {
      file_path: 'server/index.ts',
      old_string: '// placeholder',
      new_string: 'app.get("/health", (req, res) => res.json({ ok: true }))',
    },
  }, 'PreToolUse (Edit)');
  await sleep(500);

  await postEvent({
    hook_event_name: 'PostToolUse',
    session_id: SESSION_ID,
    cwd: CWD,
    tool_name: 'Edit',
    tool_use_id: editId,
    tool_input: { file_path: 'server/index.ts' },
    tool_response: { success: true },
  }, 'PostToolUse (Edit ✓)');
  await sleep(200);

  // Tool: Bash (success)
  const bashId = `toolu_bash_${ts}`;
  await postEvent({
    hook_event_name: 'PreToolUse',
    session_id: SESSION_ID,
    cwd: CWD,
    tool_name: 'Bash',
    tool_use_id: bashId,
    tool_input: { command: 'curl -s http://localhost:4000/health', description: 'Test health endpoint' },
  }, 'PreToolUse (Bash)');
  await sleep(600);

  await postEvent({
    hook_event_name: 'PostToolUse',
    session_id: SESSION_ID,
    cwd: CWD,
    tool_name: 'Bash',
    tool_use_id: bashId,
    tool_input: { command: 'curl -s http://localhost:4000/health' },
    tool_response: { stdout: '{"ok":true}', stderr: '', exitCode: 0 },
  }, 'PostToolUse (Bash ✓)');
  await sleep(200);

  // Stop (between turns — no graph node)
  await postEvent({
    hook_event_name: 'Stop',
    session_id: SESSION_ID,
    cwd: CWD,
    stop_hook_active: false,
  }, 'Stop (turn 1 done)');
  await sleep(300);

  // ═══════════════════════════════════════════════════════════════
  // 3. SECOND PROMPT — Explore subagent with Glob + Grep tools
  // ═══════════════════════════════════════════════════════════════
  console.log('\n\x1b[36m── Prompt 2: Explore subagent (Glob, Grep) ──\x1b[0m');
  await postEvent({
    hook_event_name: 'UserPromptSubmit',
    session_id: SESSION_ID,
    cwd: CWD,
    prompt: 'Find all TypeScript files that reference WebSocket',
  }, 'UserPrompt #2');
  await sleep(300);

  // Spawn Explore agent
  await postEvent({
    hook_event_name: 'SubagentStart',
    session_id: SESSION_ID,
    cwd: CWD,
    agent_id: EXPLORE_AGENT,
    agent_type: 'Explore',
  }, 'SubagentStart (Explore)');
  await sleep(400);

  // Explore: Glob
  const globId = `toolu_glob_${ts}`;
  await postEvent({
    hook_event_name: 'PreToolUse',
    session_id: SESSION_ID,
    cwd: CWD,
    agent_id: EXPLORE_AGENT,
    tool_name: 'Glob',
    tool_use_id: globId,
    tool_input: { pattern: '**/*.ts' },
  }, 'PreToolUse (Glob — Explore)');
  await sleep(500);

  await postEvent({
    hook_event_name: 'PostToolUse',
    session_id: SESSION_ID,
    cwd: CWD,
    agent_id: EXPLORE_AGENT,
    tool_name: 'Glob',
    tool_use_id: globId,
    tool_input: { pattern: '**/*.ts' },
    tool_response: { files: ['server/index.ts', 'server/services/broadcaster.ts', 'src/store/agentStore.ts'] },
  }, 'PostToolUse (Glob ✓ — Explore)');
  await sleep(200);

  // Explore: Grep
  const grepId = `toolu_grep_${ts}`;
  await postEvent({
    hook_event_name: 'PreToolUse',
    session_id: SESSION_ID,
    cwd: CWD,
    agent_id: EXPLORE_AGENT,
    tool_name: 'Grep',
    tool_use_id: grepId,
    tool_input: { pattern: 'WebSocket', path: 'server/' },
  }, 'PreToolUse (Grep — Explore)');
  await sleep(600);

  await postEvent({
    hook_event_name: 'PostToolUse',
    session_id: SESSION_ID,
    cwd: CWD,
    agent_id: EXPLORE_AGENT,
    tool_name: 'Grep',
    tool_use_id: grepId,
    tool_input: { pattern: 'WebSocket', path: 'server/' },
    tool_response: { matches: ['server/services/broadcaster.ts:1:import { WebSocket } from "ws"'] },
  }, 'PostToolUse (Grep ✓ — Explore)');
  await sleep(200);

  // Explore agent stops
  await postEvent({
    hook_event_name: 'SubagentStop',
    session_id: SESSION_ID,
    cwd: CWD,
    agent_id: EXPLORE_AGENT,
    agent_type: 'Explore',
    agent_transcript_path: `~/.claude/projects/sim/${EXPLORE_AGENT}.jsonl`,
  }, 'SubagentStop (Explore)');
  await sleep(200);

  // Stop
  await postEvent({
    hook_event_name: 'Stop',
    session_id: SESSION_ID,
    cwd: CWD,
    stop_hook_active: false,
  }, 'Stop (turn 2 done)');
  await sleep(300);

  // ═══════════════════════════════════════════════════════════════
  // 4. THIRD PROMPT — tool error + Write tool + Plan subagent + compact + notification + permission
  // ═══════════════════════════════════════════════════════════════
  console.log('\n\x1b[36m── Prompt 3: Error tool, Write, Plan agent, compact, notification ──\x1b[0m');
  await postEvent({
    hook_event_name: 'UserPromptSubmit',
    session_id: SESSION_ID,
    cwd: CWD,
    prompt: 'Refactor the broadcaster to support multiple channels, then write a plan',
  }, 'UserPrompt #3');
  await sleep(300);

  // Permission request (no graph node)
  await postEvent({
    hook_event_name: 'PermissionRequest',
    session_id: SESSION_ID,
    cwd: CWD,
    tool_name: 'Write',
  }, 'PermissionRequest (Write) — timeline only');
  await sleep(200);

  // Tool: Write (success)
  const writeId = `toolu_write_${ts}`;
  await postEvent({
    hook_event_name: 'PreToolUse',
    session_id: SESSION_ID,
    cwd: CWD,
    tool_name: 'Write',
    tool_use_id: writeId,
    tool_input: { file_path: 'server/services/channels.ts', content: 'export class ChannelBroadcaster {}' },
  }, 'PreToolUse (Write)');
  await sleep(400);

  await postEvent({
    hook_event_name: 'PostToolUse',
    session_id: SESSION_ID,
    cwd: CWD,
    tool_name: 'Write',
    tool_use_id: writeId,
    tool_input: { file_path: 'server/services/channels.ts' },
    tool_response: { success: true },
  }, 'PostToolUse (Write ✓)');
  await sleep(200);

  // Tool: Bash that FAILS (PostToolUseFailure)
  const failBashId = `toolu_bash_fail_${ts}`;
  await postEvent({
    hook_event_name: 'PreToolUse',
    session_id: SESSION_ID,
    cwd: CWD,
    tool_name: 'Bash',
    tool_use_id: failBashId,
    tool_input: { command: 'npm run test:channels', description: 'Run channel tests' },
  }, 'PreToolUse (Bash — will fail)');
  await sleep(500);

  await postEvent({
    hook_event_name: 'PostToolUseFailure',
    session_id: SESSION_ID,
    cwd: CWD,
    tool_name: 'Bash',
    tool_use_id: failBashId,
    tool_input: { command: 'npm run test:channels' },
    error: 'npm ERR! Missing script: "test:channels"',
  }, 'PostToolUseFailure (Bash ✗)');
  await sleep(200);

  // Spawn Plan agent
  await postEvent({
    hook_event_name: 'SubagentStart',
    session_id: SESSION_ID,
    cwd: CWD,
    agent_id: PLAN_AGENT,
    agent_type: 'Plan',
  }, 'SubagentStart (Plan)');
  await sleep(400);

  // Plan agent: Read
  const planReadId = `toolu_plan_read_${ts}`;
  await postEvent({
    hook_event_name: 'PreToolUse',
    session_id: SESSION_ID,
    cwd: CWD,
    agent_id: PLAN_AGENT,
    tool_name: 'Read',
    tool_use_id: planReadId,
    tool_input: { file_path: 'docs/ARCHITECTURE.md' },
  }, 'PreToolUse (Read — Plan)');
  await sleep(300);

  await postEvent({
    hook_event_name: 'PostToolUse',
    session_id: SESSION_ID,
    cwd: CWD,
    agent_id: PLAN_AGENT,
    tool_name: 'Read',
    tool_use_id: planReadId,
    tool_input: { file_path: 'docs/ARCHITECTURE.md' },
    tool_response: { content: '# Synapse Architecture\n\n## Broadcasting\n...' },
  }, 'PostToolUse (Read ✓ — Plan)');
  await sleep(200);

  // Plan agent stops
  await postEvent({
    hook_event_name: 'SubagentStop',
    session_id: SESSION_ID,
    cwd: CWD,
    agent_id: PLAN_AGENT,
    agent_type: 'Plan',
  }, 'SubagentStop (Plan)');
  await sleep(200);

  // ── Task tool → child agent (exercises sidechain cost badge on edge)
  const taskId = `toolu_task_${ts}`;
  const TASK_AGENT = `agent-task-${ts}`;
  await postEvent({
    hook_event_name: 'PreToolUse',
    session_id: SESSION_ID,
    cwd: CWD,
    tool_name: 'Task',
    tool_use_id: taskId,
    tool_input: { prompt: 'Search for auth files across the codebase', subagent_type: 'Explore' },
  }, 'PreToolUse (Task — spawns child)');
  await sleep(300);

  await postEvent({
    hook_event_name: 'SubagentStart',
    session_id: SESSION_ID,
    cwd: CWD,
    agent_id: TASK_AGENT,
    agent_type: 'Explore',
    tool_use_id: taskId,
  }, 'SubagentStart (Task child)');
  await sleep(300);

  const taskGrepId = `toolu_task_grep_${ts}`;
  await postEvent({
    hook_event_name: 'PreToolUse',
    session_id: SESSION_ID,
    cwd: CWD,
    agent_id: TASK_AGENT,
    tool_name: 'Grep',
    tool_use_id: taskGrepId,
    tool_input: { pattern: 'auth', path: 'server/' },
  }, 'PreToolUse (Grep — Task child)');
  await sleep(300);

  await postEvent({
    hook_event_name: 'PostToolUse',
    session_id: SESSION_ID,
    cwd: CWD,
    agent_id: TASK_AGENT,
    tool_name: 'Grep',
    tool_use_id: taskGrepId,
    tool_input: { pattern: 'auth' },
    tool_response: { matches: ['server/lib/auth.ts:1:import { verify } from "jsonwebtoken"'] },
  }, 'PostToolUse (Grep ✓ — Task child)');
  await sleep(200);

  await postEvent({
    hook_event_name: 'SubagentStop',
    session_id: SESSION_ID,
    cwd: CWD,
    agent_id: TASK_AGENT,
    agent_type: 'Explore',
  }, 'SubagentStop (Task child)');
  await sleep(200);

  await postEvent({
    hook_event_name: 'PostToolUse',
    session_id: SESSION_ID,
    cwd: CWD,
    tool_name: 'Task',
    tool_use_id: taskId,
    tool_input: { prompt: 'Search for auth files across the codebase' },
    tool_response: {
      agentId: TASK_AGENT,
      result: 'Found auth.ts with JWT authentication',
      usage: { input_tokens: 12500, output_tokens: 3800, cache_read_input_tokens: 4200 },
    },
  }, 'PostToolUse (Task ✓ — with token usage for cost badge)');
  await sleep(200);

  // Notification (no graph node)
  await postEvent({
    hook_event_name: 'Notification',
    session_id: SESSION_ID,
    cwd: CWD,
    message: 'Context window approaching limit, compaction recommended',
    notification_type: 'warning',
  }, 'Notification — timeline only');
  await sleep(200);

  // Compaction x2 (tests compaction badge count on agent)
  await postEvent({
    hook_event_name: 'PreCompact',
    session_id: SESSION_ID,
    cwd: CWD,
    trigger: 'auto',
  }, 'PreCompact #1 (compaction indicator on prompt #3)');
  await sleep(200);

  await postEvent({
    hook_event_name: 'PreCompact',
    session_id: SESSION_ID,
    cwd: CWD,
    trigger: 'auto',
  }, 'PreCompact #2 (second compaction — badge shows ×2)');
  await sleep(200);

  // Stop
  await postEvent({
    hook_event_name: 'Stop',
    session_id: SESSION_ID,
    cwd: CWD,
    stop_hook_active: false,
  }, 'Stop (turn 3 done)');
  await sleep(200);

  // ═══════════════════════════════════════════════════════════════
  // 5. SESSION END
  // ═══════════════════════════════════════════════════════════════
  console.log('\n\x1b[36m── Session End ──\x1b[0m');
  await postEvent({
    hook_event_name: 'SessionEnd',
    session_id: SESSION_ID,
    cwd: CWD,
    reason: 'prompt_input_exit',
  }, 'SessionEnd');

  // ═══════════════════════════════════════════════════════════════
  // SUMMARY
  // ═══════════════════════════════════════════════════════════════
  console.log(`\n\x1b[1m=== Results ===\x1b[0m`);
  console.log(`  Total events: ${stepNum}`);
  console.log(`  Failures:     ${failCount === 0 ? '\x1b[32m0\x1b[0m' : `\x1b[31m${failCount}\x1b[0m`}`);
  console.log(`\n\x1b[1mExpected Graph Hierarchy:\x1b[0m`);
  console.log(`  Session (${SESSION_ID}) — title: "Add a health check endpoint..." | branch: feat/health-check`);
  console.log('  ├── Prompt #1: "Add a health check endpoint..."');
  console.log('  │   ├── tool: Read (server/index.ts) ✓');
  console.log('  │   ├── tool: Edit (server/index.ts) ✓');
  console.log('  │   └── tool: Bash (curl health) ✓');
  console.log('  ├── Prompt #2: "Find all TypeScript files..."');
  console.log('  │   └── agent: Explore');
  console.log('  │       ├── tool: Glob (**/*.ts) ✓');
  console.log('  │       └── tool: Grep (WebSocket) ✓');
  console.log('  └── Prompt #3: "Refactor the broadcaster..." ✂ compacted ×2');
  console.log('      ├── tool: Write (channels.ts) ✓');
  console.log('      ├── tool: Bash (test:channels) ✗ ERROR');
  console.log('      ├── agent: Plan');
  console.log('      │   └── tool: Read (ARCHITECTURE.md) ✓');
  console.log('      └── tool: Task → agent: Explore (Task child)  ── purple cost badge on edge');
  console.log('              └── tool: Grep (auth) ✓');
  console.log('');
  console.log('\x1b[1mExpected Node Counts:\x1b[0m');
  console.log('  session:    1 (with title + gitBranch + topTools)');
  console.log('  userPrompt: 3 (one with ✂ compaction indicator)');
  console.log('  agent:      3 (Explore + Plan + Task-child)');
  console.log('  toolCall:  10 (Read, Edit, Bash, Glob, Grep, Write, Bash-fail, Read-plan, Task, Grep-task)');
  console.log('  spawnAgent: 1 (always present)');
  console.log('  TOTAL:      18 nodes');
  console.log('');
  console.log('\x1b[1mSession Intelligence Features:\x1b[0m');
  console.log('  ✓ Session title from first prompt text');
  console.log('  ✓ Git branch chip on session node');
  console.log('  ✓ Top tools pills (Read, Bash, Grep)');
  console.log('  ✓ Purple cost badge on Task→Agent edge (16.5k tokens)');
  console.log('  ✓ Orange compaction badge on agent (×2)');
  console.log('  ✓ FIFO mismatch warning (not triggered — explicit toolUseId used)');
  console.log('');
  console.log('\x1b[1mTimeline-only events (no graph node):\x1b[0m');
  console.log('  Stop x3, PermissionRequest x1, Notification x1');
  console.log(`\n  Open \x1b[4mhttp://localhost:5173\x1b[0m to verify.\n`);
}

main().catch((err) => {
  console.error('\x1b[31mSimulation failed:\x1b[0m', err.message);
  process.exit(1);
});
