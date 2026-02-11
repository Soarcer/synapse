import { getToolIcon } from '@synapse-ai/core';
import type { ToolCallSummary } from '@synapse-ai/core';
import { shortPath } from './shared';

// ── Types used by buildSummary and tool renderers ───────────────

export interface AskQuestion {
  question: string;
  header: string;
  options: Array<{ label: string; description: string }>;
  multiSelect: boolean;
}

export interface TodoItem {
  content: string;
  status: 'pending' | 'in_progress' | 'completed';
  activeForm: string;
}

// ── Tool Summary Line ──────────────────────────────────────────

export function ToolSummaryLine({ tc }: { tc: ToolCallSummary }) {
  const icon = getToolIcon(tc.toolName);
  const summary = buildSummary(tc);
  return (
    <div className="flex items-start gap-2 text-xs text-gray-200 bg-gray-900/50 rounded px-2.5 py-2 border border-gray-800/50">
      <span className="text-sm shrink-0 mt-px">{icon}</span>
      <span className="break-all leading-relaxed">{summary}</span>
    </div>
  );
}

function buildSummary(tc: ToolCallSummary): string {
  const input = tc.toolInput;
  if (!input) return tc.toolName;

  switch (tc.toolName) {
    case 'Read': {
      const path = shortPath(input.file_path as string);
      const offset = input.offset as number | undefined;
      const limit = input.limit as number | undefined;
      if (offset || limit) return `Read ${path} (lines ${offset ?? 1}–${(offset ?? 1) + (limit ?? 0)})`;
      return `Read ${path}`;
    }
    case 'Edit': {
      const path = shortPath(input.file_path as string);
      const oldStr = input.old_string as string | undefined;
      const lines = oldStr ? oldStr.split('\n').length : 0;
      const replaceAll = input.replace_all ? ' (all)' : '';
      return `Edit ${path} — ${lines} line${lines !== 1 ? 's' : ''} changed${replaceAll}`;
    }
    case 'Write': {
      const path = shortPath(input.file_path as string);
      return `Write ${path}`;
    }
    case 'Bash': {
      const desc = input.description as string | undefined;
      const cmd = input.command as string | undefined;
      if (desc) return `Run: ${desc}`;
      if (cmd) return `$ ${cmd.length > 60 ? cmd.slice(0, 57) + '...' : cmd}`;
      return 'Bash';
    }
    case 'Glob': {
      const pattern = input.pattern as string;
      const path = input.path as string | undefined;
      return `Find files: ${pattern}${path ? ` in ${shortPath(path)}` : ''}`;
    }
    case 'Grep': {
      const pattern = input.pattern as string;
      const path = input.path as string | undefined;
      const glob = input.glob as string | undefined;
      let suffix = '';
      if (path) suffix = ` in ${shortPath(path)}`;
      if (glob) suffix += ` (${glob})`;
      return `Search: "${pattern}"${suffix}`;
    }
    case 'WebSearch':
      return `Search: "${input.query as string}"`;
    case 'WebFetch': {
      const url = input.url as string;
      try { return `Fetch: ${new URL(url).hostname}`; } catch { return `Fetch: ${url?.slice(0, 50)}`; }
    }
    case 'Task': {
      const desc = input.description as string | undefined;
      const type = input.subagent_type as string | undefined;
      return `${type ?? 'Task'}: ${desc ?? (input.prompt as string)?.slice(0, 50) ?? 'agent task'}`;
    }
    case 'NotebookEdit': {
      const path = shortPath(input.notebook_path as string);
      const mode = input.edit_mode as string | undefined;
      return `Notebook ${mode ?? 'edit'}: ${path}`;
    }
    case 'AskUserQuestion': {
      const questions = input.questions as AskQuestion[] | undefined;
      if (!questions || questions.length === 0) return 'Ask user question';
      const headers = questions.map((q) => q.header).join(', ');
      return `Ask: ${headers} (${questions.length} question${questions.length !== 1 ? 's' : ''})`;
    }
    case 'TodoWrite': {
      const todos = input.todos as TodoItem[] | undefined;
      if (!todos || todos.length === 0) return 'Update task list';
      const done = todos.filter((t) => t.status === 'completed').length;
      const active = todos.filter((t) => t.status === 'in_progress').length;
      const parts: string[] = [];
      if (done > 0) parts.push(`${done} done`);
      if (active > 0) parts.push(`${active} active`);
      parts.push(`${todos.length} total`);
      return `Tasks: ${parts.join(', ')}`;
    }
    default:
      return tc.inputPreview ? `${tc.toolName}: ${tc.inputPreview}` : tc.toolName;
  }
}
