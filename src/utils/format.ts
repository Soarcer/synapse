// ── Shared formatting utilities ─────────────────────────────

export function formatTokens(n: number): string {
  if (n === 0) return '0';
  if (n < 1000) return String(n);
  if (n < 10000) return `${(n / 1000).toFixed(1)}k`;
  if (n < 1000000) return `${Math.round(n / 1000)}k`;
  return `${(n / 1000000).toFixed(1)}M`;
}

export function formatElapsed(startTime: number, endTime?: number): string {
  const end = endTime ?? Date.now();
  const diff = Math.floor((end - startTime) / 1000);
  if (diff < 60) return `${diff}s`;
  const mins = Math.floor(diff / 60);
  const secs = diff % 60;
  return `${mins}m ${secs}s`;
}

export function formatCount(n: number): string {
  if (n === 0) return '0';
  if (n < 1000) return String(n);
  if (n < 10000) return `${(n / 1000).toFixed(1)}k`;
  return `${Math.round(n / 1000)}k`;
}

export function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const secs = Math.floor(ms / 1000);
  if (secs < 60) return `${secs}s`;
  const mins = Math.floor(secs / 60);
  const remSecs = secs % 60;
  if (mins < 60) return `${mins}m ${remSecs}s`;
  const hrs = Math.floor(mins / 60);
  const remMins = mins % 60;
  return `${hrs}h ${remMins}m`;
}

export function formatRelativeTime(ts: number): string {
  const diff = Date.now() - ts;
  const secs = Math.floor(diff / 1000);
  if (secs < 60) return `${secs}s ago`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  return `${hrs}h ago`;
}

export function formatTime(ts: number): string {
  return new Date(ts).toLocaleTimeString(undefined, {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

export const statusIcon: Record<string, string> = {
  running: '\u27F3',
  success: '\u2713',
  error: '\u2717',
  stopped: '\u25A0',
};

// ── Consistent kind-based colors & icons ─────────────────────

export interface ColorPalette {
  name: string;
  kind: Record<string, string>;
  type: Record<string, string>;
}

export const PALETTES: ColorPalette[] = [
  {
    name: 'Neon Circuit',
    kind: {
      session: '#00d4ff',
      prompt: '#ff9f1a',
      agent: '#00e676',
      tool: '#7c4dff',
    },
    type: {
      Explore: '#00b0ff',
      Plan: '#b388ff',
      Bash: '#ff9f1a',
      'general-purpose': '#00e676',
      custom: '#18ffff',
    },
  },
  {
    name: 'VSCode Dark',
    kind: {
      session: '#569cd6',
      prompt: '#dcdcaa',
      agent: '#4ec9b0',
      tool: '#c586c0',
    },
    type: {
      Explore: '#569cd6',
      Plan: '#c586c0',
      Bash: '#ce9178',
      'general-purpose': '#4ec9b0',
      custom: '#9cdcfe',
    },
  },
  {
    name: 'Phosphor',
    kind: {
      session: '#38bdf8',
      prompt: '#fbbf24',
      agent: '#22d3ee',
      tool: '#a78bfa',
    },
    type: {
      Explore: '#38bdf8',
      Plan: '#c084fc',
      Bash: '#fbbf24',
      'general-purpose': '#22d3ee',
      custom: '#2dd4bf',
    },
  },
];

/** Canonical hex colors for each node kind, used across all Lens views */
export const KIND_COLORS: Record<string, string> = PALETTES[0].kind;

/** Emoji icons for each node kind */
export const KIND_ICONS: Record<string, string> = {
  session: '\uD83D\uDCC1',   // 📁 folder — session container
  prompt: '\uD83D\uDCAC',    // 💬 speech balloon — user input
  agent: '\uD83E\uDD16',     // 🤖 robot — autonomous agent
  tool: '\uD83D\uDD27',      // 🔧 wrench — tool action
};

/** Tool-specific icons for common Claude Code tools */
const TOOL_ICONS: Record<string, string> = {
  Read: '\u2750',      // ❐ document
  Write: '\u270E',     // ✎ pencil
  Edit: '\u270E',      // ✎ pencil
  Bash: '\u25B8',      // ▸ terminal prompt
  Glob: '\u2315',      // ⌕ search/find
  Grep: '\u2315',      // ⌕ search
  Task: '\uD83E\uDD16', // 🤖 robot (sub-agent)
  WebFetch: '\u21E3',  // ⇣ download arrow
  WebSearch: '\u2315', // ⌕ search
  NotebookEdit: '\u2395', // ⎕ notebook
  TodoWrite: '\u2611', // ☑ checkbox
};

/** Get icon for a tool by name, with fallback to generic gear */
export function getToolIcon(toolName: string): string {
  return TOOL_ICONS[toolName] ?? KIND_ICONS.tool;
}

/** Resolve the display color for a lens node. Agents use their type color. */
export function getKindColor(kind: string, label?: string, paletteIndex = 0): string {
  if (kind === 'agent' && label) return getTypeColor(label, paletteIndex);
  const palette = PALETTES[paletteIndex] ?? PALETTES[0];
  return palette.kind[kind] ?? '#6b7280';
}

// ── Vendor colors (multi-model support) ─────────────────────

export const VENDOR_COLORS: Record<string, string> = {
  anthropic:  '#e8956a',     // warm orange
  openai:     '#74aa9c',     // teal green
  google:     '#4285f4',     // blue
  groq:       '#f55036',     // red
  openrouter: '#9333ea',     // purple
  custom:     '#6b7280',     // gray
  claude:     '#e8956a',     // alias for anthropic
};

export function getVendorColor(vendor?: string): string {
  if (!vendor) return VENDOR_COLORS.claude;
  return VENDOR_COLORS[vendor.toLowerCase()] ?? VENDOR_COLORS.custom;
}

export function inferVendor(model?: string): string {
  if (!model) return 'claude';
  const m = model.toLowerCase();
  if (m.includes('claude') || m.startsWith('anthropic/')) return 'anthropic';
  if (m.includes('gpt') || m.startsWith('openai/')) return 'openai';
  if (m.includes('gemini') || m.startsWith('google/')) return 'google';
  if (m.startsWith('groq/')) return 'groq';
  if (m.startsWith('openrouter/')) return 'openrouter';
  return 'custom';
}

export const statusBorderColor: Record<string, string> = {
  running: 'border-l-green-400',
  success: 'border-l-gray-500',
  error: 'border-l-red-500',
  stopped: 'border-l-yellow-500',
};

export const TYPE_COLORS: Record<string, string> = PALETTES[0].type;

export function getTypeColor(agentType: string, paletteIndex = 0): string {
  const palette = PALETTES[paletteIndex] ?? PALETTES[0];
  return palette.type[agentType] ?? '#6b7280';
}
