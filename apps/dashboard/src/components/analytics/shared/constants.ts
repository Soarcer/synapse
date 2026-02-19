// Shared color maps and formatters used by SessionReplay, PromptAnalyzer, and shared components

export const MODEL_COLORS: Record<string, string> = {
  'claude-opus-4-6': '#e8956a',
  'claude-sonnet-4-5': '#3b82f6',
  'claude-sonnet-4-5-20250929': '#3b82f6',
  'claude-haiku-4-5': '#22d3ee',
  'claude-haiku-4-5-20251001': '#22d3ee',
};

export const MODEL_LABELS: Record<string, string> = {
  'claude-opus-4-6': 'Opus 4.6',
  'claude-sonnet-4-5': 'Sonnet 4.5',
  'claude-sonnet-4-5-20250929': 'Sonnet 4.5',
  'claude-haiku-4-5': 'Haiku 4.5',
  'claude-haiku-4-5-20251001': 'Haiku 4.5',
};

export const TOOL_COLORS: Record<string, string> = {
  Read: '#3b82f6',
  Grep: '#8b5cf6',
  Glob: '#a78bfa',
  Edit: '#ec4899',
  Write: '#f59e0b',
  Bash: '#f97316',
  Task: '#10b981',
  WebFetch: '#06b6d4',
  WebSearch: '#14b8a6',
  TodoWrite: '#84cc16',
  NotebookEdit: '#e879f9',
};

export const CATEGORY_COLORS: Record<string, string> = {
  feature: '#3b82f6', bugfix: '#ef4444', refactor: '#a855f7', test: '#22c55e',
  docs: '#eab308', debug: '#f97316', review: '#06b6d4', config: '#6b7280', other: '#475569',
};

export function fmtTokens(n: number): string {
  if (n < 1000) return String(n);
  if (n < 1_000_000) return `${(n / 1000).toFixed(1)}k`;
  return `${(n / 1_000_000).toFixed(2)}M`;
}
