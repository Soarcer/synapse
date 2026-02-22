// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Synapse Contributors

export interface DemoEvent {
  payload: Record<string, unknown>;
  delayMs: number;
  /** i18n key for narration callout shown during auto-play (null = silent) */
  narrationKey: string | null;
}

const SESSION_ID = 'tour-demo-session';
const EXPLORE_AGENT = 'tour-agent-explore';
const PLAN_AGENT = 'tour-agent-plan';
const TASK_AGENT = 'tour-agent-task';
const CWD = '/workspace/my-project';

export const DEMO_EVENTS: DemoEvent[] = [
  // ═══════════════════════════════════════════════════════════════
  // 1. SESSION START
  // ═══════════════════════════════════════════════════════════════
  {
    payload: {
      hook_event_name: 'SessionStart',
      session_id: SESSION_ID,
      cwd: CWD,
      permission_mode: 'default',
      source: 'startup',
      model: 'claude-opus-4-6',
      git_branch: 'feat/health-check',
      transcript_path: `~/.claude/projects/sim/${SESSION_ID}.jsonl`,
    },
    delayMs: 800,
    narrationKey: 'tour.auto.sessionStart',
  },

  // ═══════════════════════════════════════════════════════════════
  // 2. FIRST PROMPT — main agent tools (Read, Edit, Bash)
  // ═══════════════════════════════════════════════════════════════
  {
    payload: {
      hook_event_name: 'UserPromptSubmit',
      session_id: SESSION_ID,
      cwd: CWD,
      permission_mode: 'default',
      prompt: 'Add a health check endpoint to the server',
    },
    delayMs: 800,
    narrationKey: 'tour.auto.prompt1',
  },

  // Tool: Read (Pre)
  {
    payload: {
      hook_event_name: 'PreToolUse',
      session_id: SESSION_ID,
      cwd: CWD,
      tool_name: 'Read',
      tool_use_id: 'tour-toolu-read',
      tool_input: { file_path: 'server/index.ts' },
    },
    delayMs: 300,
    narrationKey: null,
  },

  // Tool: Read (Post)
  {
    payload: {
      hook_event_name: 'PostToolUse',
      session_id: SESSION_ID,
      cwd: CWD,
      tool_name: 'Read',
      tool_use_id: 'tour-toolu-read',
      tool_input: { file_path: 'server/index.ts' },
      tool_response: { content: 'const app = express();\nconst server = createServer(app);' },
    },
    delayMs: 200,
    narrationKey: null,
  },

  // Tool: Edit (Pre)
  {
    payload: {
      hook_event_name: 'PreToolUse',
      session_id: SESSION_ID,
      cwd: CWD,
      tool_name: 'Edit',
      tool_use_id: 'tour-toolu-edit',
      tool_input: {
        file_path: 'server/index.ts',
        old_string: '// placeholder',
        new_string: 'app.get("/health", (req, res) => res.json({ ok: true }))',
      },
    },
    delayMs: 300,
    narrationKey: null,
  },

  // Tool: Edit (Post)
  {
    payload: {
      hook_event_name: 'PostToolUse',
      session_id: SESSION_ID,
      cwd: CWD,
      tool_name: 'Edit',
      tool_use_id: 'tour-toolu-edit',
      tool_input: { file_path: 'server/index.ts' },
      tool_response: { success: true },
    },
    delayMs: 200,
    narrationKey: null,
  },

  // Tool: Bash (Pre)
  {
    payload: {
      hook_event_name: 'PreToolUse',
      session_id: SESSION_ID,
      cwd: CWD,
      tool_name: 'Bash',
      tool_use_id: 'tour-toolu-bash',
      tool_input: { command: 'curl -s http://localhost:4000/health', description: 'Test health endpoint' },
    },
    delayMs: 300,
    narrationKey: null,
  },

  // Tool: Bash (Post) — last tool in first batch, gets narration
  {
    payload: {
      hook_event_name: 'PostToolUse',
      session_id: SESSION_ID,
      cwd: CWD,
      tool_name: 'Bash',
      tool_use_id: 'tour-toolu-bash',
      tool_input: { command: 'curl -s http://localhost:4000/health' },
      tool_response: { stdout: '{"ok":true}', stderr: '', exitCode: 0 },
    },
    delayMs: 600,
    narrationKey: 'tour.auto.tools1',
  },

  // Stop (turn 1 done)
  {
    payload: {
      hook_event_name: 'Stop',
      session_id: SESSION_ID,
      cwd: CWD,
      stop_hook_active: false,
    },
    delayMs: 200,
    narrationKey: null,
  },

  // ═══════════════════════════════════════════════════════════════
  // 3. SECOND PROMPT — Explore subagent (Glob, Grep)
  // ═══════════════════════════════════════════════════════════════
  {
    payload: {
      hook_event_name: 'UserPromptSubmit',
      session_id: SESSION_ID,
      cwd: CWD,
      prompt: 'Find all TypeScript files that reference WebSocket',
    },
    delayMs: 800,
    narrationKey: 'tour.auto.prompt2',
  },

  // SubagentStart (Explore)
  {
    payload: {
      hook_event_name: 'SubagentStart',
      session_id: SESSION_ID,
      cwd: CWD,
      agent_id: EXPLORE_AGENT,
      agent_type: 'Explore',
    },
    delayMs: 600,
    narrationKey: 'tour.auto.explore',
  },

  // Explore: Glob (Pre)
  {
    payload: {
      hook_event_name: 'PreToolUse',
      session_id: SESSION_ID,
      cwd: CWD,
      agent_id: EXPLORE_AGENT,
      tool_name: 'Glob',
      tool_use_id: 'tour-toolu-glob',
      tool_input: { pattern: '**/*.ts' },
    },
    delayMs: 300,
    narrationKey: null,
  },

  // Explore: Glob (Post)
  {
    payload: {
      hook_event_name: 'PostToolUse',
      session_id: SESSION_ID,
      cwd: CWD,
      agent_id: EXPLORE_AGENT,
      tool_name: 'Glob',
      tool_use_id: 'tour-toolu-glob',
      tool_input: { pattern: '**/*.ts' },
      tool_response: { files: ['server/index.ts', 'server/services/broadcaster.ts', 'src/store/agentStore.ts'] },
    },
    delayMs: 200,
    narrationKey: null,
  },

  // Explore: Grep (Pre)
  {
    payload: {
      hook_event_name: 'PreToolUse',
      session_id: SESSION_ID,
      cwd: CWD,
      agent_id: EXPLORE_AGENT,
      tool_name: 'Grep',
      tool_use_id: 'tour-toolu-grep',
      tool_input: { pattern: 'WebSocket', path: 'server/' },
    },
    delayMs: 300,
    narrationKey: null,
  },

  // Explore: Grep (Post)
  {
    payload: {
      hook_event_name: 'PostToolUse',
      session_id: SESSION_ID,
      cwd: CWD,
      agent_id: EXPLORE_AGENT,
      tool_name: 'Grep',
      tool_use_id: 'tour-toolu-grep',
      tool_input: { pattern: 'WebSocket', path: 'server/' },
      tool_response: { matches: ['server/services/broadcaster.ts:1:import { WebSocket } from "ws"'] },
    },
    delayMs: 200,
    narrationKey: null,
  },

  // SubagentStop (Explore)
  {
    payload: {
      hook_event_name: 'SubagentStop',
      session_id: SESSION_ID,
      cwd: CWD,
      agent_id: EXPLORE_AGENT,
      agent_type: 'Explore',
      agent_transcript_path: `~/.claude/projects/sim/${EXPLORE_AGENT}.jsonl`,
    },
    delayMs: 200,
    narrationKey: null,
  },

  // Stop (turn 2 done)
  {
    payload: {
      hook_event_name: 'Stop',
      session_id: SESSION_ID,
      cwd: CWD,
      stop_hook_active: false,
    },
    delayMs: 200,
    narrationKey: null,
  },

  // ═══════════════════════════════════════════════════════════════
  // 4. THIRD PROMPT — error tool, Write, Plan agent, Task, compact, notification
  // ═══════════════════════════════════════════════════════════════
  {
    payload: {
      hook_event_name: 'UserPromptSubmit',
      session_id: SESSION_ID,
      cwd: CWD,
      prompt: 'Refactor the broadcaster to support multiple channels, then write a plan',
    },
    delayMs: 600,
    narrationKey: null,
  },

  // PermissionRequest (timeline only)
  {
    payload: {
      hook_event_name: 'PermissionRequest',
      session_id: SESSION_ID,
      cwd: CWD,
      tool_name: 'Write',
    },
    delayMs: 200,
    narrationKey: null,
  },

  // Tool: Write (Pre)
  {
    payload: {
      hook_event_name: 'PreToolUse',
      session_id: SESSION_ID,
      cwd: CWD,
      tool_name: 'Write',
      tool_use_id: 'tour-toolu-write',
      tool_input: { file_path: 'server/services/channels.ts', content: 'export class ChannelBroadcaster {}' },
    },
    delayMs: 300,
    narrationKey: null,
  },

  // Tool: Write (Post)
  {
    payload: {
      hook_event_name: 'PostToolUse',
      session_id: SESSION_ID,
      cwd: CWD,
      tool_name: 'Write',
      tool_use_id: 'tour-toolu-write',
      tool_input: { file_path: 'server/services/channels.ts' },
      tool_response: { success: true },
    },
    delayMs: 200,
    narrationKey: null,
  },

  // Tool: Bash that FAILS (Pre)
  {
    payload: {
      hook_event_name: 'PreToolUse',
      session_id: SESSION_ID,
      cwd: CWD,
      tool_name: 'Bash',
      tool_use_id: 'tour-toolu-bash-fail',
      tool_input: { command: 'npm run test:channels', description: 'Run channel tests' },
    },
    delayMs: 300,
    narrationKey: null,
  },

  // Tool: Bash (PostToolUseFailure)
  {
    payload: {
      hook_event_name: 'PostToolUseFailure',
      session_id: SESSION_ID,
      cwd: CWD,
      tool_name: 'Bash',
      tool_use_id: 'tour-toolu-bash-fail',
      tool_input: { command: 'npm run test:channels' },
      error: 'npm ERR! Missing script: "test:channels"',
    },
    delayMs: 600,
    narrationKey: 'tour.auto.error',
  },

  // SubagentStart (Plan)
  {
    payload: {
      hook_event_name: 'SubagentStart',
      session_id: SESSION_ID,
      cwd: CWD,
      agent_id: PLAN_AGENT,
      agent_type: 'Plan',
    },
    delayMs: 300,
    narrationKey: null,
  },

  // Plan: Read (Pre)
  {
    payload: {
      hook_event_name: 'PreToolUse',
      session_id: SESSION_ID,
      cwd: CWD,
      agent_id: PLAN_AGENT,
      tool_name: 'Read',
      tool_use_id: 'tour-toolu-plan-read',
      tool_input: { file_path: 'docs/ARCHITECTURE.md' },
    },
    delayMs: 200,
    narrationKey: null,
  },

  // Plan: Read (Post)
  {
    payload: {
      hook_event_name: 'PostToolUse',
      session_id: SESSION_ID,
      cwd: CWD,
      agent_id: PLAN_AGENT,
      tool_name: 'Read',
      tool_use_id: 'tour-toolu-plan-read',
      tool_input: { file_path: 'docs/ARCHITECTURE.md' },
      tool_response: { content: '# Synapse Architecture\n\n## Broadcasting\n...' },
    },
    delayMs: 200,
    narrationKey: null,
  },

  // SubagentStop (Plan)
  {
    payload: {
      hook_event_name: 'SubagentStop',
      session_id: SESSION_ID,
      cwd: CWD,
      agent_id: PLAN_AGENT,
      agent_type: 'Plan',
    },
    delayMs: 200,
    narrationKey: null,
  },

  // Tool: Task (Pre — spawns child agent)
  {
    payload: {
      hook_event_name: 'PreToolUse',
      session_id: SESSION_ID,
      cwd: CWD,
      tool_name: 'Task',
      tool_use_id: 'tour-toolu-task',
      tool_input: { prompt: 'Search for auth files across the codebase', subagent_type: 'Explore' },
    },
    delayMs: 300,
    narrationKey: null,
  },

  // SubagentStart (Task child)
  {
    payload: {
      hook_event_name: 'SubagentStart',
      session_id: SESSION_ID,
      cwd: CWD,
      agent_id: TASK_AGENT,
      agent_type: 'Explore',
      tool_use_id: 'tour-toolu-task',
    },
    delayMs: 600,
    narrationKey: 'tour.auto.taskChild',
  },

  // Task child: Grep (Pre)
  {
    payload: {
      hook_event_name: 'PreToolUse',
      session_id: SESSION_ID,
      cwd: CWD,
      agent_id: TASK_AGENT,
      tool_name: 'Grep',
      tool_use_id: 'tour-toolu-task-grep',
      tool_input: { pattern: 'auth', path: 'server/' },
    },
    delayMs: 200,
    narrationKey: null,
  },

  // Task child: Grep (Post)
  {
    payload: {
      hook_event_name: 'PostToolUse',
      session_id: SESSION_ID,
      cwd: CWD,
      agent_id: TASK_AGENT,
      tool_name: 'Grep',
      tool_use_id: 'tour-toolu-task-grep',
      tool_input: { pattern: 'auth' },
      tool_response: { matches: ['server/lib/auth.ts:1:import { verify } from "jsonwebtoken"'] },
    },
    delayMs: 200,
    narrationKey: null,
  },

  // SubagentStop (Task child)
  {
    payload: {
      hook_event_name: 'SubagentStop',
      session_id: SESSION_ID,
      cwd: CWD,
      agent_id: TASK_AGENT,
      agent_type: 'Explore',
    },
    delayMs: 200,
    narrationKey: null,
  },

  // PostToolUse (Task — with token usage for cost badge)
  {
    payload: {
      hook_event_name: 'PostToolUse',
      session_id: SESSION_ID,
      cwd: CWD,
      tool_name: 'Task',
      tool_use_id: 'tour-toolu-task',
      tool_input: { prompt: 'Search for auth files across the codebase' },
      tool_response: {
        agentId: TASK_AGENT,
        result: 'Found auth.ts with JWT authentication',
        usage: { input_tokens: 12500, output_tokens: 3800, cache_read_input_tokens: 4200 },
      },
    },
    delayMs: 200,
    narrationKey: null,
  },

  // Notification (timeline only)
  {
    payload: {
      hook_event_name: 'Notification',
      session_id: SESSION_ID,
      cwd: CWD,
      message: 'Context window approaching limit, compaction recommended',
      notification_type: 'warning',
    },
    delayMs: 200,
    narrationKey: null,
  },

  // PreCompact #1
  {
    payload: {
      hook_event_name: 'PreCompact',
      session_id: SESSION_ID,
      cwd: CWD,
      trigger: 'auto',
    },
    delayMs: 600,
    narrationKey: 'tour.auto.compaction',
  },

  // PreCompact #2
  {
    payload: {
      hook_event_name: 'PreCompact',
      session_id: SESSION_ID,
      cwd: CWD,
      trigger: 'auto',
    },
    delayMs: 200,
    narrationKey: null,
  },

  // Stop (turn 3 done)
  {
    payload: {
      hook_event_name: 'Stop',
      session_id: SESSION_ID,
      cwd: CWD,
      stop_hook_active: false,
    },
    delayMs: 200,
    narrationKey: null,
  },

  // ═══════════════════════════════════════════════════════════════
  // 5. SESSION END
  // ═══════════════════════════════════════════════════════════════
  {
    payload: {
      hook_event_name: 'SessionEnd',
      session_id: SESSION_ID,
      cwd: CWD,
      reason: 'prompt_input_exit',
    },
    delayMs: 1000,
    narrationKey: 'tour.auto.complete',
  },
];
