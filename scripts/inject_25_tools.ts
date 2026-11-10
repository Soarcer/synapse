const API = 'http://localhost:27247/api/events';
const ts = Date.now().toString(36);
const SESSION_ID = `mega-${ts}`;
const AGENT_ID = `agent-mega-${ts}`;

async function post(p: Record<string, unknown>): Promise<void> {
  const r = await fetch(API, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(p) });
  console.log(`${r.ok ? 'OK' : r.status} ${(p.tool_name as string) || p.hook_event_name}`);
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  console.log(`Session: ${SESSION_ID}\nAgent: ${AGENT_ID}\n`);

  await post({ hook_event_name: 'SessionStart', session_id: SESSION_ID, cwd: process.cwd(), model: 'claude-opus-4-6', git_branch: 'feat/mega-tools' });
  await sleep(300);
  await post({ hook_event_name: 'UserPromptSubmit', session_id: SESSION_ID, cwd: process.cwd(), prompt: 'Comprehensive codebase audit — 25 tool operations' });
  await sleep(300);
  await post({ hook_event_name: 'SubagentStart', session_id: SESSION_ID, cwd: process.cwd(), agent_id: AGENT_ID, agent_type: 'Explore' });
  await sleep(300);

  const tools: Array<[string, Record<string, unknown>]> = [
    ['Read', { file_path: 'src/index.ts' }],
    ['Read', { file_path: 'src/App.tsx' }],
    ['Read', { file_path: 'server/db.ts' }],
    ['Grep', { pattern: 'WebSocket', path: 'server/' }],
    ['Grep', { pattern: 'import.*from', path: 'src/' }],
    ['Glob', { pattern: '**/*.ts' }],
    ['Glob', { pattern: '**/*.test.ts' }],
    ['Bash', { command: 'npm run lint', description: 'Run linter' }],
    ['Bash', { command: 'npm test', description: 'Run tests' }],
    ['Bash', { command: 'git status', description: 'Check git status' }],
    ['Edit', { file_path: 'src/config.ts', old_string: 'port: 3000', new_string: 'port: 4000' }],
    ['Edit', { file_path: 'server/index.ts', old_string: '// TODO', new_string: 'app.use(cors())' }],
    ['Write', { file_path: 'src/utils/helpers.ts', content: 'export const formatDate = (d: Date) => d.toISOString()' }],
    ['Write', { file_path: 'tests/setup.ts', content: 'import { vi } from "vitest"' }],
    ['Read', { file_path: 'package.json' }],
    ['WebSearch', { query: 'React Flow best practices 2026' }],
    ['WebFetch', { url: 'https://docs.anthropic.com/api' }],
    ['Bash', { command: 'pnpm build', description: 'Build project' }],
    ['Grep', { pattern: 'TODO|FIXME|HACK', path: '.' }],
    ['Read', { file_path: 'tsconfig.json' }],
    ['Glob', { pattern: 'docs/**/*.md' }],
    ['Edit', { file_path: 'README.md', old_string: '# Old Title', new_string: '# Synapse' }],
    ['Bash', { command: 'npx tsc --noEmit', description: 'Type check' }],
    ['Write', { file_path: 'src/types/index.ts', content: 'export interface Config { port: number }' }],
    ['TodoWrite', { todos: [{ content: 'Review auth module', status: 'pending' }] }],
  ];

  for (let i = 0; i < tools.length; i++) {
    const [name, input] = tools[i];
    const tid = `toolu_m${i + 1}_${ts}`;
    await post({ hook_event_name: 'PreToolUse', session_id: SESSION_ID, cwd: process.cwd(), agent_id: AGENT_ID, tool_name: name, tool_use_id: tid, tool_input: input });
    await sleep(500);
    if (i === 17) {
      await post({ hook_event_name: 'PostToolUseFailure', session_id: SESSION_ID, cwd: process.cwd(), agent_id: AGENT_ID, tool_name: name, tool_use_id: tid, tool_input: input, error: 'Build failed: 3 type errors found' });
    } else {
      await post({ hook_event_name: 'PostToolUse', session_id: SESSION_ID, cwd: process.cwd(), agent_id: AGENT_ID, tool_name: name, tool_use_id: tid, tool_input: input, tool_response: { success: true } });
    }
    await sleep(500);
    console.log(`  ${i + 1}/25`);
  }

  console.log(`\nDone — 25 tools injected under agent ${AGENT_ID}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
