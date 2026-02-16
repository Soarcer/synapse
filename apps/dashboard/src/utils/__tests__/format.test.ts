import {
  formatTokens,
  formatElapsed,
  formatCount,
  formatDuration,
  formatRelativeTime,
  getToolIcon,
  getKindColor,
  getVendorColor,
  inferVendor,
  getTypeColor,
} from '@synapse-ai/core';

// ── formatTokens ────────────────────────────────────────────

describe('formatTokens', () => {
  it('returns "0" for zero', () => {
    expect(formatTokens(0)).toBe('0');
  });

  it('returns plain number string below 1000', () => {
    expect(formatTokens(1)).toBe('1');
    expect(formatTokens(999)).toBe('999');
  });

  it('returns one-decimal "k" for 1000..9999', () => {
    expect(formatTokens(1000)).toBe('1.0k');
    expect(formatTokens(1500)).toBe('1.5k');
    expect(formatTokens(9999)).toBe('10.0k');
  });

  it('returns rounded "k" for 10000..999999', () => {
    expect(formatTokens(10000)).toBe('10k');
    expect(formatTokens(50000)).toBe('50k');
    expect(formatTokens(999999)).toBe('1000k');
  });

  it('returns one-decimal "M" for 1M..9.9M', () => {
    expect(formatTokens(1000000)).toBe('1.0M');
    expect(formatTokens(2500000)).toBe('2.5M');
    expect(formatTokens(9999999)).toBe('10.0M');
  });

  it('returns rounded "M" for >= 10M', () => {
    expect(formatTokens(10_000_000)).toBe('10M');
    expect(formatTokens(15_000_000)).toBe('15M');
    expect(formatTokens(150_000_000)).toBe('150M');
  });
});

// ── formatElapsed ───────────────────────────────────────────

describe('formatElapsed', () => {
  it('shows seconds when diff < 60s', () => {
    const start = 1000000;
    const end = 1000000 + 45_000; // 45 seconds
    expect(formatElapsed(start, end)).toBe('45s');
  });

  it('shows "Xm Xs" when diff >= 60s', () => {
    const start = 1000000;
    const end = 1000000 + 125_000; // 2m 5s
    expect(formatElapsed(start, end)).toBe('2m 5s');
  });

  it('uses Date.now() when endTime is omitted', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(1700000030000)); // fixed "now"
    const start = 1700000000000; // 30s earlier
    expect(formatElapsed(start)).toBe('30s');
    vi.useRealTimers();
  });
});

// ── formatCount ─────────────────────────────────────────────

describe('formatCount', () => {
  it('returns "0" for zero', () => {
    expect(formatCount(0)).toBe('0');
  });

  it('returns plain number below 1000', () => {
    expect(formatCount(500)).toBe('500');
  });

  it('returns one-decimal "k" for 1000..9999', () => {
    expect(formatCount(4200)).toBe('4.2k');
  });

  it('returns rounded "k" for >= 10000 (caps at thousands)', () => {
    expect(formatCount(15000)).toBe('15k');
    expect(formatCount(1500000)).toBe('1500k');
  });
});

// ── formatDuration ──────────────────────────────────────────

describe('formatDuration', () => {
  it('shows milliseconds when < 1000', () => {
    expect(formatDuration(0)).toBe('0ms');
    expect(formatDuration(500)).toBe('500ms');
    expect(formatDuration(999)).toBe('999ms');
  });

  it('shows seconds when < 60s', () => {
    expect(formatDuration(1000)).toBe('1s');
    expect(formatDuration(59_000)).toBe('59s');
  });

  it('shows "Xm Xs" when < 60m', () => {
    expect(formatDuration(90_000)).toBe('1m 30s');
    expect(formatDuration(3_599_000)).toBe('59m 59s');
  });

  it('shows "Xh Xm" when >= 60m', () => {
    expect(formatDuration(3_600_000)).toBe('1h 0m');
    expect(formatDuration(5_400_000)).toBe('1h 30m');
  });
});

// ── formatRelativeTime ──────────────────────────────────────

describe('formatRelativeTime', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('shows seconds ago when < 60s', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(1700000010000));
    expect(formatRelativeTime(1700000000000)).toBe('10s ago');
  });

  it('shows minutes ago when < 60m', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(1700000000000 + 300_000)); // 5 min later
    expect(formatRelativeTime(1700000000000)).toBe('5m ago');
  });

  it('shows hours ago when >= 60m', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(1700000000000 + 7_200_000)); // 2h later
    expect(formatRelativeTime(1700000000000)).toBe('2h ago');
  });
});

// ── getToolIcon ─────────────────────────────────────────────

describe('getToolIcon', () => {
  it('returns the mapped icon for a known tool', () => {
    expect(getToolIcon('Read')).toBe('\u2750');
    expect(getToolIcon('Bash')).toBe('\u25B8');
    expect(getToolIcon('TodoWrite')).toBe('\u2611');
  });

  it('returns the fallback wrench icon for an unknown tool', () => {
    expect(getToolIcon('UnknownTool')).toBe('\uD83D\uDD27');
  });
});

// ── getKindColor ────────────────────────────────────────────

describe('getKindColor', () => {
  it('returns the palette color for a non-agent kind', () => {
    expect(getKindColor('session')).toBe('#00d4ff');
    expect(getKindColor('tool')).toBe('#7c4dff');
  });

  it('delegates to getTypeColor when kind is "agent" and label is provided', () => {
    expect(getKindColor('agent', 'Explore')).toBe('#00b0ff');
    expect(getKindColor('agent', 'Plan')).toBe('#b388ff');
  });

  it('returns gray fallback for an unknown kind', () => {
    expect(getKindColor('unknown_kind')).toBe('#6b7280');
  });

  it('respects the paletteIndex parameter', () => {
    // palette index 1 = VSCode Dark
    expect(getKindColor('session', undefined, 1)).toBe('#569cd6');
  });

  it('falls back to palette 0 for out-of-range paletteIndex', () => {
    expect(getKindColor('session', undefined, 999)).toBe('#00d4ff');
  });
});

// ── getVendorColor ──────────────────────────────────────────

describe('getVendorColor', () => {
  it('returns the claude/anthropic color when vendor is undefined', () => {
    expect(getVendorColor()).toBe('#e8956a');
  });

  it('returns the correct color for known vendors (case-insensitive)', () => {
    expect(getVendorColor('OpenAI')).toBe('#74aa9c');
    expect(getVendorColor('GOOGLE')).toBe('#4285f4');
    expect(getVendorColor('groq')).toBe('#f55036');
  });

  it('returns the custom gray for an unknown vendor', () => {
    expect(getVendorColor('acme-corp')).toBe('#6b7280');
  });
});

// ── inferVendor ─────────────────────────────────────────────

describe('inferVendor', () => {
  it('returns "claude" when model is undefined', () => {
    expect(inferVendor()).toBe('claude');
  });

  it('detects anthropic from "claude" in the name', () => {
    expect(inferVendor('claude-opus-4-6')).toBe('anthropic');
    expect(inferVendor('anthropic/claude-sonnet')).toBe('anthropic');
  });

  it('detects openai from "gpt" in the name', () => {
    expect(inferVendor('gpt-4o')).toBe('openai');
    expect(inferVendor('openai/gpt-4-turbo')).toBe('openai');
  });

  it('detects google from "gemini" in the name', () => {
    expect(inferVendor('gemini-2.0-flash')).toBe('google');
    expect(inferVendor('google/gemini-pro')).toBe('google');
  });

  it('detects groq and openrouter by prefix', () => {
    expect(inferVendor('groq/llama-3')).toBe('groq');
    expect(inferVendor('openrouter/meta-llama')).toBe('openrouter');
  });

  it('returns "custom" for an unrecognized model', () => {
    expect(inferVendor('llama-3-70b')).toBe('custom');
  });
});

// ── getTypeColor ────────────────────────────────────────────

describe('getTypeColor', () => {
  it('returns the color for a known type in the default palette', () => {
    expect(getTypeColor('Explore')).toBe('#00b0ff');
    expect(getTypeColor('general-purpose')).toBe('#00e676');
  });

  it('returns the color from a specific palette index', () => {
    // palette 2 = Phosphor
    expect(getTypeColor('Bash', 2)).toBe('#fbbf24');
  });

  it('returns gray fallback for an unknown type', () => {
    expect(getTypeColor('SomeUnknownType')).toBe('#6b7280');
  });

  it('falls back to palette 0 for an out-of-range index', () => {
    expect(getTypeColor('Explore', 100)).toBe('#00b0ff');
  });
});
