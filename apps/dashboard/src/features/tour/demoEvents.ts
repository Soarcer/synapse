// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Synapse Contributors

import type { AgentEvent } from '@synapse-ai/core';

export interface DemoEvent {
  payload: AgentEvent;
  delayMs: number;
  /** i18n key for narration callout shown during auto-play (null = silent) */
  narrationKey: string | null;
}

const SESSION_ID = 'tour-demo-session';
const EXPLORE_AGENT = 'tour-agent-explore';
const PLAN_AGENT = 'tour-agent-plan';
const TASK_AGENT = 'tour-agent-task';
const CWD = '/workspace/my-project';

/** Auto-incrementing counter for deterministic event IDs + timestamps */
let seq = 0;
function nextId(): string {
  return `tour-evt-${++seq}`;
}
function nextTs(): number {
  return 1700000000000 + seq * 500;
}

/** Reset sequence so IDs are stable across module reloads */
seq = 0;

export const DEMO_EVENTS: DemoEvent[] = [
  // ═══════════════════════════════════════════════════════════════
  // 1. SESSION START
  // ═══════════════════════════════════════════════════════════════
  {
    payload: {
      id: nextId(),
      type: 'session_start',
      sessionId: SESSION_ID,
      timestamp: nextTs(),
      cwd: CWD,
      permissionMode: 'default',
      source: 'startup',
      model: 'claude-opus-4-6',
      gitBranch: 'feat/health-check',
      transcriptPath: `~/.claude/projects/sim/${SESSION_ID}.jsonl`,
    },
    delayMs: 800,
    narrationKey: 'tour.auto.sessionStart',
  },

  // ═══════════════════════════════════════════════════════════════
  // 2. FIRST PROMPT — main agent tools (Read, Edit, Bash)
  // ═══════════════════════════════════════════════════════════════
  {
    payload: {
      id: nextId(),
      type: 'user_prompt',
      sessionId: SESSION_ID,
      timestamp: nextTs(),
      cwd: CWD,
      text: 'Add a health check endpoint to the server',
    },
    delayMs: 800,
    narrationKey: 'tour.auto.prompt1',
  },

  // Tool: Read (Pre)
  {
    payload: {
      id: nextId(),
      type: 'tool_start',
      sessionId: SESSION_ID,
      timestamp: nextTs(),
      cwd: CWD,
      toolName: 'Read',
      toolUseId: 'tour-toolu-read',
      toolInput: { file_path: 'server/index.ts' },
      status: 'running',
    },
    delayMs: 300,
    narrationKey: null,
  },

  // Tool: Read (Post)
  {
    payload: {
      id: nextId(),
      type: 'tool_end',
      sessionId: SESSION_ID,
      timestamp: nextTs(),
      cwd: CWD,
      toolName: 'Read',
      toolUseId: 'tour-toolu-read',
      toolInput: { file_path: 'server/index.ts' },
      toolResponse: { content: 'const app = express();\nconst server = createServer(app);' },
      status: 'success',
    },
    delayMs: 200,
    narrationKey: null,
  },

  // Tool: Edit (Pre)
  {
    payload: {
      id: nextId(),
      type: 'tool_start',
      sessionId: SESSION_ID,
      timestamp: nextTs(),
      cwd: CWD,
      toolName: 'Edit',
      toolUseId: 'tour-toolu-edit',
      toolInput: {
        file_path: 'server/index.ts',
        old_string: '// placeholder',
        new_string: 'app.get("/health", (req, res) => res.json({ ok: true }))',
      },
      status: 'running',
    },
    delayMs: 300,
    narrationKey: null,
  },

  // Tool: Edit (Post)
  {
    payload: {
      id: nextId(),
      type: 'tool_end',
      sessionId: SESSION_ID,
      timestamp: nextTs(),
      cwd: CWD,
      toolName: 'Edit',
      toolUseId: 'tour-toolu-edit',
      toolInput: { file_path: 'server/index.ts' },
      toolResponse: { success: true },
      status: 'success',
    },
    delayMs: 200,
    narrationKey: null,
  },

  // Tool: Bash (Pre)
  {
    payload: {
      id: nextId(),
      type: 'tool_start',
      sessionId: SESSION_ID,
      timestamp: nextTs(),
      cwd: CWD,
      toolName: 'Bash',
      toolUseId: 'tour-toolu-bash',
      toolInput: {
        command: 'curl -s http://localhost:4000/health',
        description: 'Test health endpoint',
      },
      status: 'running',
    },
    delayMs: 300,
    narrationKey: null,
  },

  // Tool: Bash (Post) — last tool in first batch, gets narration
  {
    payload: {
      id: nextId(),
      type: 'tool_end',
      sessionId: SESSION_ID,
      timestamp: nextTs(),
      cwd: CWD,
      toolName: 'Bash',
      toolUseId: 'tour-toolu-bash',
      toolInput: { command: 'curl -s http://localhost:4000/health' },
      toolResponse: { stdout: '{"ok":true}', stderr: '', exitCode: 0 },
      status: 'success',
    },
    delayMs: 600,
    narrationKey: 'tour.auto.tools1',
  },

  // Stop (turn 1 done)
  {
    payload: {
      id: nextId(),
      type: 'stop',
      sessionId: SESSION_ID,
      timestamp: nextTs(),
      cwd: CWD,
    },
    delayMs: 200,
    narrationKey: null,
  },

  // ═══════════════════════════════════════════════════════════════
  // 3. SECOND PROMPT — Explore subagent (Glob, Grep)
  // ═══════════════════════════════════════════════════════════════
  {
    payload: {
      id: nextId(),
      type: 'user_prompt',
      sessionId: SESSION_ID,
      timestamp: nextTs(),
      cwd: CWD,
      text: 'Find all TypeScript files that reference WebSocket',
    },
    delayMs: 800,
    narrationKey: 'tour.auto.prompt2',
  },

  // SubagentStart (Explore)
  {
    payload: {
      id: nextId(),
      type: 'agent_start',
      sessionId: SESSION_ID,
      timestamp: nextTs(),
      cwd: CWD,
      agentId: EXPLORE_AGENT,
      agentType: 'Explore',
      status: 'running',
    },
    delayMs: 600,
    narrationKey: 'tour.auto.explore',
  },

  // Explore: Glob (Pre)
  {
    payload: {
      id: nextId(),
      type: 'tool_start',
      sessionId: SESSION_ID,
      timestamp: nextTs(),
      cwd: CWD,
      agentId: EXPLORE_AGENT,
      toolName: 'Glob',
      toolUseId: 'tour-toolu-glob',
      toolInput: { pattern: '**/*.ts' },
      status: 'running',
    },
    delayMs: 300,
    narrationKey: null,
  },

  // Explore: Glob (Post)
  {
    payload: {
      id: nextId(),
      type: 'tool_end',
      sessionId: SESSION_ID,
      timestamp: nextTs(),
      cwd: CWD,
      agentId: EXPLORE_AGENT,
      toolName: 'Glob',
      toolUseId: 'tour-toolu-glob',
      toolInput: { pattern: '**/*.ts' },
      toolResponse: {
        files: ['server/index.ts', 'server/services/broadcaster.ts', 'src/store/agentStore.ts'],
      },
      status: 'success',
    },
    delayMs: 200,
    narrationKey: null,
  },

  // Explore: Grep (Pre)
  {
    payload: {
      id: nextId(),
      type: 'tool_start',
      sessionId: SESSION_ID,
      timestamp: nextTs(),
      cwd: CWD,
      agentId: EXPLORE_AGENT,
      toolName: 'Grep',
      toolUseId: 'tour-toolu-grep',
      toolInput: { pattern: 'WebSocket', path: 'server/' },
      status: 'running',
    },
    delayMs: 300,
    narrationKey: null,
  },

  // Explore: Grep (Post)
  {
    payload: {
      id: nextId(),
      type: 'tool_end',
      sessionId: SESSION_ID,
      timestamp: nextTs(),
      cwd: CWD,
      agentId: EXPLORE_AGENT,
      toolName: 'Grep',
      toolUseId: 'tour-toolu-grep',
      toolInput: { pattern: 'WebSocket', path: 'server/' },
      toolResponse: {
        matches: ['server/services/broadcaster.ts:1:import { WebSocket } from "ws"'],
      },
      status: 'success',
    },
    delayMs: 200,
    narrationKey: null,
  },

  // SubagentStop (Explore)
  {
    payload: {
      id: nextId(),
      type: 'agent_stop',
      sessionId: SESSION_ID,
      timestamp: nextTs(),
      cwd: CWD,
      agentId: EXPLORE_AGENT,
      agentType: 'Explore',
      agentTranscriptPath: `~/.claude/projects/sim/${EXPLORE_AGENT}.jsonl`,
      status: 'success',
    },
    delayMs: 200,
    narrationKey: null,
  },

  // Stop (turn 2 done)
  {
    payload: {
      id: nextId(),
      type: 'stop',
      sessionId: SESSION_ID,
      timestamp: nextTs(),
      cwd: CWD,
    },
    delayMs: 200,
    narrationKey: null,
  },

  // ═══════════════════════════════════════════════════════════════
  // 4. THIRD PROMPT — error tool, Write, Plan agent, Task, compact, notification
  // ═══════════════════════════════════════════════════════════════
  {
    payload: {
      id: nextId(),
      type: 'user_prompt',
      sessionId: SESSION_ID,
      timestamp: nextTs(),
      cwd: CWD,
      text: 'Refactor the broadcaster to support multiple channels, then write a plan',
    },
    delayMs: 600,
    narrationKey: null,
  },

  // PermissionRequest (timeline only)
  {
    payload: {
      id: nextId(),
      type: 'permission_request',
      sessionId: SESSION_ID,
      timestamp: nextTs(),
      cwd: CWD,
      toolName: 'Write',
    },
    delayMs: 200,
    narrationKey: null,
  },

  // Tool: Write (Pre)
  {
    payload: {
      id: nextId(),
      type: 'tool_start',
      sessionId: SESSION_ID,
      timestamp: nextTs(),
      cwd: CWD,
      toolName: 'Write',
      toolUseId: 'tour-toolu-write',
      toolInput: {
        file_path: 'server/services/channels.ts',
        content: 'export class ChannelBroadcaster {}',
      },
      status: 'running',
    },
    delayMs: 300,
    narrationKey: null,
  },

  // Tool: Write (Post)
  {
    payload: {
      id: nextId(),
      type: 'tool_end',
      sessionId: SESSION_ID,
      timestamp: nextTs(),
      cwd: CWD,
      toolName: 'Write',
      toolUseId: 'tour-toolu-write',
      toolInput: { file_path: 'server/services/channels.ts' },
      toolResponse: { success: true },
      status: 'success',
    },
    delayMs: 200,
    narrationKey: null,
  },

  // Tool: Bash that FAILS (Pre)
  {
    payload: {
      id: nextId(),
      type: 'tool_start',
      sessionId: SESSION_ID,
      timestamp: nextTs(),
      cwd: CWD,
      toolName: 'Bash',
      toolUseId: 'tour-toolu-bash-fail',
      toolInput: { command: 'npm run test:channels', description: 'Run channel tests' },
      status: 'running',
    },
    delayMs: 300,
    narrationKey: null,
  },

  // Tool: Bash (PostToolUseFailure)
  {
    payload: {
      id: nextId(),
      type: 'tool_error',
      sessionId: SESSION_ID,
      timestamp: nextTs(),
      cwd: CWD,
      toolName: 'Bash',
      toolUseId: 'tour-toolu-bash-fail',
      toolInput: { command: 'npm run test:channels' },
      error: 'npm ERR! Missing script: "test:channels"',
      status: 'error',
    },
    delayMs: 600,
    narrationKey: 'tour.auto.error',
  },

  // SubagentStart (Plan)
  {
    payload: {
      id: nextId(),
      type: 'agent_start',
      sessionId: SESSION_ID,
      timestamp: nextTs(),
      cwd: CWD,
      agentId: PLAN_AGENT,
      agentType: 'Plan',
      status: 'running',
    },
    delayMs: 300,
    narrationKey: null,
  },

  // Plan: Read (Pre)
  {
    payload: {
      id: nextId(),
      type: 'tool_start',
      sessionId: SESSION_ID,
      timestamp: nextTs(),
      cwd: CWD,
      agentId: PLAN_AGENT,
      toolName: 'Read',
      toolUseId: 'tour-toolu-plan-read',
      toolInput: { file_path: 'docs/ARCHITECTURE.md' },
      status: 'running',
    },
    delayMs: 200,
    narrationKey: null,
  },

  // Plan: Read (Post)
  {
    payload: {
      id: nextId(),
      type: 'tool_end',
      sessionId: SESSION_ID,
      timestamp: nextTs(),
      cwd: CWD,
      agentId: PLAN_AGENT,
      toolName: 'Read',
      toolUseId: 'tour-toolu-plan-read',
      toolInput: { file_path: 'docs/ARCHITECTURE.md' },
      toolResponse: { content: '# Synapse Architecture\n\n## Broadcasting\n...' },
      status: 'success',
    },
    delayMs: 200,
    narrationKey: null,
  },

  // SubagentStop (Plan)
  {
    payload: {
      id: nextId(),
      type: 'agent_stop',
      sessionId: SESSION_ID,
      timestamp: nextTs(),
      cwd: CWD,
      agentId: PLAN_AGENT,
      agentType: 'Plan',
      status: 'success',
    },
    delayMs: 200,
    narrationKey: null,
  },

  // Tool: Task (Pre — spawns child agent)
  {
    payload: {
      id: nextId(),
      type: 'tool_start',
      sessionId: SESSION_ID,
      timestamp: nextTs(),
      cwd: CWD,
      toolName: 'Task',
      toolUseId: 'tour-toolu-task',
      toolInput: { prompt: 'Search for auth files across the codebase', subagent_type: 'Explore' },
      status: 'running',
    },
    delayMs: 300,
    narrationKey: null,
  },

  // SubagentStart (Task child)
  {
    payload: {
      id: nextId(),
      type: 'agent_start',
      sessionId: SESSION_ID,
      timestamp: nextTs(),
      cwd: CWD,
      agentId: TASK_AGENT,
      agentType: 'Explore',
      toolUseId: 'tour-toolu-task',
      status: 'running',
    },
    delayMs: 600,
    narrationKey: 'tour.auto.taskChild',
  },

  // Task child: Grep (Pre)
  {
    payload: {
      id: nextId(),
      type: 'tool_start',
      sessionId: SESSION_ID,
      timestamp: nextTs(),
      cwd: CWD,
      agentId: TASK_AGENT,
      toolName: 'Grep',
      toolUseId: 'tour-toolu-task-grep',
      toolInput: { pattern: 'auth', path: 'server/' },
      status: 'running',
    },
    delayMs: 200,
    narrationKey: null,
  },

  // Task child: Grep (Post)
  {
    payload: {
      id: nextId(),
      type: 'tool_end',
      sessionId: SESSION_ID,
      timestamp: nextTs(),
      cwd: CWD,
      agentId: TASK_AGENT,
      toolName: 'Grep',
      toolUseId: 'tour-toolu-task-grep',
      toolInput: { pattern: 'auth' },
      toolResponse: { matches: ['server/lib/auth.ts:1:import { verify } from "jsonwebtoken"'] },
      status: 'success',
    },
    delayMs: 200,
    narrationKey: null,
  },

  // SubagentStop (Task child)
  {
    payload: {
      id: nextId(),
      type: 'agent_stop',
      sessionId: SESSION_ID,
      timestamp: nextTs(),
      cwd: CWD,
      agentId: TASK_AGENT,
      agentType: 'Explore',
      status: 'success',
    },
    delayMs: 200,
    narrationKey: null,
  },

  // PostToolUse (Task — with token usage for cost badge)
  {
    payload: {
      id: nextId(),
      type: 'tool_end',
      sessionId: SESSION_ID,
      timestamp: nextTs(),
      cwd: CWD,
      toolName: 'Task',
      toolUseId: 'tour-toolu-task',
      toolInput: { prompt: 'Search for auth files across the codebase' },
      toolResponse: {
        agentId: TASK_AGENT,
        result: 'Found auth.ts with JWT authentication',
        usage: { input_tokens: 12500, output_tokens: 3800, cache_read_input_tokens: 4200 },
      },
      status: 'success',
    },
    delayMs: 200,
    narrationKey: null,
  },

  // Notification (timeline only)
  {
    payload: {
      id: nextId(),
      type: 'notification',
      sessionId: SESSION_ID,
      timestamp: nextTs(),
      cwd: CWD,
      text: 'Context window approaching limit, compaction recommended',
      notificationType: 'warning',
    },
    delayMs: 200,
    narrationKey: null,
  },

  // PreCompact #1
  {
    payload: {
      id: nextId(),
      type: 'compact',
      sessionId: SESSION_ID,
      timestamp: nextTs(),
      cwd: CWD,
      compactTrigger: 'auto',
    },
    delayMs: 600,
    narrationKey: 'tour.auto.compaction',
  },

  // PreCompact #2
  {
    payload: {
      id: nextId(),
      type: 'compact',
      sessionId: SESSION_ID,
      timestamp: nextTs(),
      cwd: CWD,
      compactTrigger: 'auto',
    },
    delayMs: 200,
    narrationKey: null,
  },

  // Stop (turn 3 done)
  {
    payload: {
      id: nextId(),
      type: 'stop',
      sessionId: SESSION_ID,
      timestamp: nextTs(),
      cwd: CWD,
    },
    delayMs: 200,
    narrationKey: null,
  },

  // ═══════════════════════════════════════════════════════════════
  // 5. SESSION END
  // ═══════════════════════════════════════════════════════════════
  {
    payload: {
      id: nextId(),
      type: 'session_end',
      sessionId: SESSION_ID,
      timestamp: nextTs(),
      cwd: CWD,
      reason: 'prompt_input_exit',
    },
    delayMs: 1000,
    narrationKey: 'tour.auto.complete',
  },
];
