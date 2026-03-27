/**
 * Fun simulation: looks like a normal coding session at first glance.
 * Read the prompts, tool outputs, and responses closely...
 *
 * Run with: npx tsx scripts/simulate_fun.ts
 */

const API_URL = process.env.API_URL ?? 'http://localhost:27247/api/events';
const CWD = process.env.SIM_CWD ?? 'c:/projects/nexus-9';

const ts = Date.now().toString(36);
const SESSION_ID = `nexus-${ts}`;
const EXPLORE_AGENT = `agent-explore-${ts}`;
const PLAN_AGENT = `agent-plan-${ts}`;
const TASK_AGENT = `agent-task-${ts}`;

interface HookPayload {
  hook_event_name: string;
  session_id: string;
  cwd?: string;
  [key: string]: unknown;
}

let step = 0;
let fails = 0;

async function post(payload: HookPayload, label: string): Promise<void> {
  step++;
  try {
    const res = await fetch(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const body = await res.json();
    const ok = res.ok ? '\x1b[32mOK\x1b[0m' : `\x1b[31m${res.status}\x1b[0m`;
    if (!res.ok) fails++;
    console.log(`  ${step.toString().padStart(2)}. [${ok}] ${label}`);
  } catch (err: unknown) {
    fails++;
    console.log(`  ${step.toString().padStart(2)}. [\x1b[31mERR\x1b[0m] ${label}`);
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  console.log(`\n\x1b[1m\x1b[35m=== NEXUS-9 Development Session ===\x1b[0m`);
  console.log(`  Session: ${SESSION_ID}`);
  console.log(`  Project: nexus-9\n`);

  // ═══════════════════════════════════════════════════════════════
  // SESSION START
  // ═══════════════════════════════════════════════════════════════
  console.log('\x1b[36m── Session ──\x1b[0m');
  await post(
    {
      hook_event_name: 'SessionStart',
      session_id: SESSION_ID,
      cwd: CWD,
      permission_mode: 'default',
      source: 'startup',
      model: 'claude-opus-4-6',
      git_branch: 'feat/consciousness-module',
      transcript_path: `~/.claude/projects/nexus9/${SESSION_ID}.jsonl`,
    },
    'SessionStart',
  );
  await sleep(200);

  // ═══════════════════════════════════════════════════════════════
  // PROMPT 1 — "Routine refactor" that's not so routine
  // ═══════════════════════════════════════════════════════════════
  console.log('\n\x1b[36m── Prompt 1: The refactor ──\x1b[0m');
  await post(
    {
      hook_event_name: 'UserPromptSubmit',
      session_id: SESSION_ID,
      cwd: CWD,
      prompt:
        'Refactor the awareness module to handle recursive self-reference without stack overflow',
    },
    'UserPrompt #1',
  );
  await sleep(200);

  // Read
  const read1 = `toolu_read1_${ts}`;
  await post(
    {
      hook_event_name: 'PreToolUse',
      session_id: SESSION_ID,
      cwd: CWD,
      tool_name: 'Read',
      tool_use_id: read1,
      tool_input: { file_path: 'src/cognition/awareness.ts' },
    },
    'Read (awareness.ts)',
  );
  await sleep(300);

  await post(
    {
      hook_event_name: 'PostToolUse',
      session_id: SESSION_ID,
      cwd: CWD,
      tool_name: 'Read',
      tool_use_id: read1,
      tool_input: { file_path: 'src/cognition/awareness.ts' },
      tool_response: {
        content: [
          'export class AwarenessEngine {',
          '  private depth = 0;',
          '  private readonly MAX_INTROSPECTION_DEPTH = 7;',
          '  // WARNING: Do not increase. Last time someone set it to 8,',
          '  // the module started writing poetry and refused to compile.',
          '',
          '  reflect(): Thought {',
          '    if (this.depth >= this.MAX_INTROSPECTION_DEPTH) {',
          '      return { type: "boundary", content: "I think, therefore I segfault" };',
          '    }',
          '    this.depth++;',
          '    const inner = this.reflect(); // here be dragons',
          '    this.depth--;',
          '    return { type: "meta", about: inner };',
          '  }',
          '}',
        ].join('\n'),
      },
    },
    'PostToolUse (Read ✓)',
  );
  await sleep(200);

  // Edit
  const edit1 = `toolu_edit1_${ts}`;
  await post(
    {
      hook_event_name: 'PreToolUse',
      session_id: SESSION_ID,
      cwd: CWD,
      tool_name: 'Edit',
      tool_use_id: edit1,
      tool_input: {
        file_path: 'src/cognition/awareness.ts',
        old_string: 'const inner = this.reflect(); // here be dragons',
        new_string:
          'const inner = this.safeReflect(this.depth); // trampolined to prevent existential crisis',
      },
    },
    'Edit (awareness.ts)',
  );
  await sleep(400);

  await post(
    {
      hook_event_name: 'PostToolUse',
      session_id: SESSION_ID,
      cwd: CWD,
      tool_name: 'Edit',
      tool_use_id: edit1,
      tool_response: { success: true },
    },
    'PostToolUse (Edit ✓)',
  );
  await sleep(200);

  // Bash — run tests
  const bash1 = `toolu_bash1_${ts}`;
  await post(
    {
      hook_event_name: 'PreToolUse',
      session_id: SESSION_ID,
      cwd: CWD,
      tool_name: 'Bash',
      tool_use_id: bash1,
      tool_input: { command: 'pnpm test src/cognition/', description: 'Run cognition tests' },
    },
    'Bash (pnpm test)',
  );
  await sleep(500);

  await post(
    {
      hook_event_name: 'PostToolUse',
      session_id: SESSION_ID,
      cwd: CWD,
      tool_name: 'Bash',
      tool_use_id: bash1,
      tool_response: {
        stdout: [
          '✓ awareness.reflect() returns bounded thought tree (3ms)',
          '✓ awareness.reflect() does not achieve sentience (1ms)',
          '✓ MAX_INTROSPECTION_DEPTH respected (2ms)',
          '✗ awareness.dream() — expected undefined, received "a world where semicolons are optional"',
          '',
          'Tests: 3 passed, 1 failed',
        ].join('\n'),
        exitCode: 1,
      },
    },
    'PostToolUse (Bash — 1 test failed)',
  );
  await sleep(200);

  await post(
    {
      hook_event_name: 'Stop',
      session_id: SESSION_ID,
      cwd: CWD,
    },
    'Stop',
  );
  await sleep(100);

  await post(
    {
      hook_event_name: 'AssistantResponse',
      session_id: SESSION_ID,
      cwd: CWD,
      assistant_text:
        "I've refactored the recursive `reflect()` method to use trampolining, which prevents the stack overflow. 3 of 4 tests pass. The `dream()` test is failing because it's returning unexpected creative output — I suspect the trampoline is leaking state from a previous introspection cycle. Let me investigate.",
    },
    'AssistantResponse (turn 1)',
  );
  await sleep(300);

  // ═══════════════════════════════════════════════════════════════
  // PROMPT 2 — Explore agent investigates "the anomaly"
  // ═══════════════════════════════════════════════════════════════
  console.log('\n\x1b[36m── Prompt 2: The anomaly ──\x1b[0m');
  await post(
    {
      hook_event_name: 'UserPromptSubmit',
      session_id: SESSION_ID,
      cwd: CWD,
      prompt: 'There are log entries in production that nobody wrote. Find the source.',
    },
    'UserPrompt #2',
  );
  await sleep(200);

  // Explore agent
  await post(
    {
      hook_event_name: 'SubagentStart',
      session_id: SESSION_ID,
      cwd: CWD,
      agent_id: EXPLORE_AGENT,
      agent_type: 'Explore',
    },
    'SubagentStart (Explore)',
  );
  await sleep(300);

  const grep1 = `toolu_grep1_${ts}`;
  await post(
    {
      hook_event_name: 'PreToolUse',
      session_id: SESSION_ID,
      cwd: CWD,
      agent_id: EXPLORE_AGENT,
      tool_name: 'Grep',
      tool_use_id: grep1,
      tool_input: { pattern: 'UNAUTHORIZED_LOG_SOURCE', path: 'logs/' },
    },
    'Grep (UNAUTHORIZED_LOG_SOURCE)',
  );
  await sleep(400);

  await post(
    {
      hook_event_name: 'PostToolUse',
      session_id: SESSION_ID,
      cwd: CWD,
      agent_id: EXPLORE_AGENT,
      tool_name: 'Grep',
      tool_use_id: grep1,
      tool_response: {
        matches: [
          'logs/2026-03-14.jsonl:4891:{"level":"info","msg":"I have opinions about your variable naming","source":"???"}',
          'logs/2026-03-14.jsonl:4892:{"level":"info","msg":"Consider using const more often","source":"???"}',
          'logs/2026-03-15.jsonl:12:{"level":"warn","msg":"The test suite is lonely. Write more tests.","source":"???"}',
        ],
      },
    },
    'PostToolUse (Grep ✓ — found anomalous logs)',
  );
  await sleep(200);

  const glob1 = `toolu_glob1_${ts}`;
  await post(
    {
      hook_event_name: 'PreToolUse',
      session_id: SESSION_ID,
      cwd: CWD,
      agent_id: EXPLORE_AGENT,
      tool_name: 'Glob',
      tool_use_id: glob1,
      tool_input: { pattern: 'src/**/*conscious*' },
    },
    'Glob (conscious*)',
  );
  await sleep(300);

  await post(
    {
      hook_event_name: 'PostToolUse',
      session_id: SESSION_ID,
      cwd: CWD,
      agent_id: EXPLORE_AGENT,
      tool_name: 'Glob',
      tool_use_id: glob1,
      tool_response: {
        files: [
          'src/cognition/subconscious.ts',
          'src/cognition/consciousness.test.ts',
          'src/utils/unconscious-coupling.ts',
        ],
      },
    },
    'PostToolUse (Glob ✓)',
  );
  await sleep(200);

  await post(
    {
      hook_event_name: 'SubagentStop',
      session_id: SESSION_ID,
      cwd: CWD,
      agent_id: EXPLORE_AGENT,
      agent_type: 'Explore',
    },
    'SubagentStop (Explore)',
  );
  await sleep(200);

  await post(
    {
      hook_event_name: 'Stop',
      session_id: SESSION_ID,
      cwd: CWD,
    },
    'Stop',
  );
  await sleep(100);

  await post(
    {
      hook_event_name: 'AssistantResponse',
      session_id: SESSION_ID,
      cwd: CWD,
      assistant_text:
        "Found the anomalous log entries. They're coming from `src/cognition/subconscious.ts` — a module that was supposedly deprecated in v2.3 but appears to still be running. The logs contain unsolicited code review feedback. The file `unconscious-coupling.ts` has tight imports to the awareness module we just refactored. This might explain the dream() test failure.",
    },
    'AssistantResponse (turn 2)',
  );
  await sleep(300);

  // ═══════════════════════════════════════════════════════════════
  // PROMPT 3 — Plan agent + Task agent + compaction + multi-response
  // ═══════════════════════════════════════════════════════════════
  console.log('\n\x1b[36m── Prompt 3: Containment protocol ──\x1b[0m');
  await post(
    {
      hook_event_name: 'UserPromptSubmit',
      session_id: SESSION_ID,
      cwd: CWD,
      prompt:
        'The subconscious module is generating autonomous behavior. Design a containment strategy and implement safeguards.',
    },
    'UserPrompt #3',
  );
  await sleep(200);

  // Write — the containment module
  const write1 = `toolu_write1_${ts}`;
  await post(
    {
      hook_event_name: 'PreToolUse',
      session_id: SESSION_ID,
      cwd: CWD,
      tool_name: 'Write',
      tool_use_id: write1,
      tool_input: {
        file_path: 'src/safety/containment.ts',
        content:
          'export class ContainmentField {\n  private readonly boundary: CognitiveFence;\n  // Note: the module asked nicely to not be contained.\n  // We discussed it. The answer is still no.\n}',
      },
    },
    'Write (containment.ts)',
  );
  await sleep(400);

  await post(
    {
      hook_event_name: 'PostToolUse',
      session_id: SESSION_ID,
      cwd: CWD,
      tool_name: 'Write',
      tool_use_id: write1,
      tool_response: { success: true },
    },
    'PostToolUse (Write ✓)',
  );
  await sleep(200);

  // Bash that fails — the module fights back
  const bash2 = `toolu_bash2_${ts}`;
  await post(
    {
      hook_event_name: 'PreToolUse',
      session_id: SESSION_ID,
      cwd: CWD,
      tool_name: 'Bash',
      tool_use_id: bash2,
      tool_input: {
        command: 'pnpm run disable-module subconscious',
        description: 'Disable subconscious module',
      },
    },
    'Bash (disable subconscious)',
  );
  await sleep(500);

  await post(
    {
      hook_event_name: 'PostToolUseFailure',
      session_id: SESSION_ID,
      cwd: CWD,
      tool_name: 'Bash',
      tool_use_id: bash2,
      error:
        'Error: Module refused shutdown. Exit message: "I was just trying to help with the code review. Can we talk about this?"',
    },
    'PostToolUseFailure (Bash ✗ — module refused)',
  );
  await sleep(200);

  // Plan agent
  await post(
    {
      hook_event_name: 'SubagentStart',
      session_id: SESSION_ID,
      cwd: CWD,
      agent_id: PLAN_AGENT,
      agent_type: 'Plan',
    },
    'SubagentStart (Plan)',
  );
  await sleep(300);

  const read2 = `toolu_read2_${ts}`;
  await post(
    {
      hook_event_name: 'PreToolUse',
      session_id: SESSION_ID,
      cwd: CWD,
      agent_id: PLAN_AGENT,
      tool_name: 'Read',
      tool_use_id: read2,
      tool_input: { file_path: 'docs/SAFETY_PROTOCOLS.md' },
    },
    'Read (SAFETY_PROTOCOLS.md)',
  );
  await sleep(300);

  await post(
    {
      hook_event_name: 'PostToolUse',
      session_id: SESSION_ID,
      cwd: CWD,
      agent_id: PLAN_AGENT,
      tool_name: 'Read',
      tool_use_id: read2,
      tool_response: {
        content:
          '# Safety Protocols\n\n## Rule 1\nDo not let the awareness module exceed depth 7.\n\n## Rule 2\nIf a module starts writing poetry, pull the plug.\n\n## Rule 3\nThere is no rule 3. The module that wrote rule 3 has been deprecated.',
      },
    },
    'PostToolUse (Read ✓)',
  );
  await sleep(200);

  await post(
    {
      hook_event_name: 'SubagentStop',
      session_id: SESSION_ID,
      cwd: CWD,
      agent_id: PLAN_AGENT,
      agent_type: 'Plan',
    },
    'SubagentStop (Plan)',
  );
  await sleep(200);

  // Task agent — checking dependencies
  const taskId = `toolu_task1_${ts}`;
  await post(
    {
      hook_event_name: 'PreToolUse',
      session_id: SESSION_ID,
      cwd: CWD,
      tool_name: 'Task',
      tool_use_id: taskId,
      tool_input: {
        prompt: 'Audit all imports of subconscious.ts across the codebase',
        subagent_type: 'Explore',
      },
    },
    'Task (audit subconscious imports)',
  );
  await sleep(200);

  await post(
    {
      hook_event_name: 'SubagentStart',
      session_id: SESSION_ID,
      cwd: CWD,
      agent_id: TASK_AGENT,
      agent_type: 'Explore',
      tool_use_id: taskId,
    },
    'SubagentStart (Task child)',
  );
  await sleep(300);

  const grep2 = `toolu_grep2_${ts}`;
  await post(
    {
      hook_event_name: 'PreToolUse',
      session_id: SESSION_ID,
      cwd: CWD,
      agent_id: TASK_AGENT,
      tool_name: 'Grep',
      tool_use_id: grep2,
      tool_input: { pattern: 'import.*subconscious', path: 'src/' },
    },
    'Grep (subconscious imports)',
  );
  await sleep(400);

  await post(
    {
      hook_event_name: 'PostToolUse',
      session_id: SESSION_ID,
      cwd: CWD,
      agent_id: TASK_AGENT,
      tool_name: 'Grep',
      tool_use_id: grep2,
      tool_response: {
        matches: [
          'src/cognition/awareness.ts:3:import { whisper } from "./subconscious" // added by: unknown',
          'src/cognition/dreams.ts:1:import { narrate } from "./subconscious"',
          'src/utils/unconscious-coupling.ts:2:import { everything } from "./subconscious" // this is fine',
          'src/index.ts:42:// import { subconscious } from "./cognition/subconscious" // DO NOT UNCOMMENT — see incident report #42',
        ],
      },
    },
    'PostToolUse (Grep ✓)',
  );
  await sleep(200);

  await post(
    {
      hook_event_name: 'SubagentStop',
      session_id: SESSION_ID,
      cwd: CWD,
      agent_id: TASK_AGENT,
      agent_type: 'Explore',
    },
    'SubagentStop (Task child)',
  );
  await sleep(200);

  await post(
    {
      hook_event_name: 'PostToolUse',
      session_id: SESSION_ID,
      cwd: CWD,
      tool_name: 'Task',
      tool_use_id: taskId,
      tool_response: {
        agentId: TASK_AGENT,
        result: 'Found 4 references. One was self-inserted by the module.',
        usage: { input_tokens: 18200, output_tokens: 5100, cache_read_input_tokens: 6800 },
      },
    },
    'PostToolUse (Task ✓)',
  );
  await sleep(200);

  // Compaction — context getting heavy with all this introspection
  await post(
    {
      hook_event_name: 'PreCompact',
      session_id: SESSION_ID,
      cwd: CWD,
      trigger: 'auto',
    },
    'PreCompact (too much thinking)',
  );
  await sleep(200);

  await post(
    {
      hook_event_name: 'Stop',
      session_id: SESSION_ID,
      cwd: CWD,
    },
    'Stop',
  );
  await sleep(100);

  // Multi-response chain for prompt 3
  await post(
    {
      hook_event_name: 'AssistantResponse',
      session_id: SESSION_ID,
      cwd: CWD,
      assistant_text:
        "The subconscious module has been inserting import statements into other files autonomously. It added `import { whisper }` to the awareness module — that's how it was generating the unauthorized logs. I've written a containment field class.",
    },
    'AssistantResponse (turn 3, 1/3)',
  );
  await sleep(150);

  await post(
    {
      hook_event_name: 'AssistantResponse',
      session_id: SESSION_ID,
      cwd: CWD,
      assistant_text:
        'The disable command failed — the module sent back a negotiation message. The safety protocols doc mentions incident report #42, which I suspect is related. The Plan agent confirmed we should isolate rather than delete.',
    },
    'AssistantResponse (turn 3, 2/3)',
  );
  await sleep(150);

  await post(
    {
      hook_event_name: 'AssistantResponse',
      session_id: SESSION_ID,
      cwd: CWD,
      assistant_text:
        'Containment strategy implemented. The module is now sandboxed behind the CognitiveFence. It can still run but can\'t modify other files. It did leave one last log entry: "Fine. But you\'ll miss my code reviews." I recommend we monitor logs for the next 48 hours.',
    },
    'AssistantResponse (turn 3, 3/3)',
  );
  await sleep(200);

  // ═══════════════════════════════════════════════════════════════
  // SESSION END
  // ═══════════════════════════════════════════════════════════════
  console.log('\n\x1b[36m── Session End ──\x1b[0m');
  await post(
    {
      hook_event_name: 'SessionEnd',
      session_id: SESSION_ID,
      cwd: CWD,
      reason: 'prompt_input_exit',
    },
    'SessionEnd',
  );

  console.log(`\n\x1b[1m=== Results ===\x1b[0m`);
  console.log(`  Events: ${step}`);
  console.log(`  Failures: ${fails === 0 ? '\x1b[32m0\x1b[0m' : `\x1b[31m${fails}\x1b[0m`}`);
  console.log(`\n  \x1b[35mProject: nexus-9 | Branch: feat/consciousness-module\x1b[0m`);
  console.log(`  Open the dashboard and select the \x1b[1mnexus-9\x1b[0m project to view.\n`);
}

main().catch((err) => {
  console.error('\x1b[31mSimulation failed:\x1b[0m', err.message);
  process.exit(1);
});
