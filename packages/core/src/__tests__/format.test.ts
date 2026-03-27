// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Bernhard

import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  formatTokens,
  formatElapsed,
  formatCount,
  formatDuration,
  formatRelativeTime,
  formatTime,
  statusIcon,
  PALETTES,
  KIND_COLORS,
  KIND_ICONS,
  getToolIcon,
  getKindColor,
  getTypeColor,
  VENDOR_COLORS,
  getVendorColor,
  inferVendor,
  statusBorderColor,
  TYPE_COLORS,
  normalizeCwd,
} from '../utils/format.js';

// ── formatTokens ────────────────────────────────────────────

describe('formatTokens', () => {
  it('returns "0" for zero', () => {
    expect(formatTokens(0)).toBe('0');
  });

  it('returns raw number for values under 1000', () => {
    expect(formatTokens(1)).toBe('1');
    expect(formatTokens(999)).toBe('999');
    expect(formatTokens(500)).toBe('500');
  });

  it('returns one-decimal k for 1000–9999', () => {
    expect(formatTokens(1000)).toBe('1.0k');
    expect(formatTokens(1500)).toBe('1.5k');
    expect(formatTokens(9999)).toBe('10.0k');
  });

  it('returns rounded k for 10000–999999', () => {
    expect(formatTokens(10_000)).toBe('10k');
    expect(formatTokens(50_000)).toBe('50k');
    expect(formatTokens(999_999)).toBe('1000k');
  });

  it('returns one-decimal M for 1M–9.9M', () => {
    expect(formatTokens(1_000_000)).toBe('1.0M');
    expect(formatTokens(5_500_000)).toBe('5.5M');
    expect(formatTokens(9_999_999)).toBe('10.0M');
  });

  it('returns rounded M for 10M+', () => {
    expect(formatTokens(10_000_000)).toBe('10M');
    expect(formatTokens(100_000_000)).toBe('100M');
    expect(formatTokens(1_000_000_000)).toBe('1000M');
  });
});

// ── formatElapsed ───────────────────────────────────────────

describe('formatElapsed', () => {
  it('returns seconds for durations under 60s', () => {
    const now = Date.now();
    expect(formatElapsed(now - 5000, now)).toBe('5s');
    expect(formatElapsed(now, now)).toBe('0s');
    expect(formatElapsed(now - 59_000, now)).toBe('59s');
  });

  it('returns minutes and seconds for 60s+', () => {
    const now = Date.now();
    expect(formatElapsed(now - 60_000, now)).toBe('1m 0s');
    expect(formatElapsed(now - 90_000, now)).toBe('1m 30s');
    expect(formatElapsed(now - 3661_000, now)).toBe('61m 1s');
  });

  it('uses Date.now() when endTime is omitted', () => {
    const fakeNow = 1700000000000;
    vi.spyOn(Date, 'now').mockReturnValue(fakeNow);
    expect(formatElapsed(fakeNow - 10_000)).toBe('10s');
    vi.restoreAllMocks();
  });

  it('handles very large durations', () => {
    const now = Date.now();
    // 2 hours = 7200s = 120m 0s
    expect(formatElapsed(now - 7_200_000, now)).toBe('120m 0s');
  });
});

// ── formatCount ─────────────────────────────────────────────

describe('formatCount', () => {
  it('returns "0" for zero', () => {
    expect(formatCount(0)).toBe('0');
  });

  it('returns raw number for values under 1000', () => {
    expect(formatCount(1)).toBe('1');
    expect(formatCount(999)).toBe('999');
  });

  it('returns one-decimal k for 1000–9999', () => {
    expect(formatCount(1000)).toBe('1.0k');
    expect(formatCount(5678)).toBe('5.7k');
    expect(formatCount(9999)).toBe('10.0k');
  });

  it('returns rounded k for 10000+', () => {
    expect(formatCount(10_000)).toBe('10k');
    expect(formatCount(99_999)).toBe('100k');
    expect(formatCount(1_000_000)).toBe('1000k');
  });
});

// ── formatDuration ──────────────────────────────────────────

describe('formatDuration', () => {
  it('returns milliseconds for values under 1000ms', () => {
    expect(formatDuration(0)).toBe('0ms');
    expect(formatDuration(1)).toBe('1ms');
    expect(formatDuration(999)).toBe('999ms');
  });

  it('returns seconds for 1s–59s', () => {
    expect(formatDuration(1000)).toBe('1s');
    expect(formatDuration(1500)).toBe('1s'); // floor
    expect(formatDuration(59_999)).toBe('59s');
  });

  it('returns minutes and seconds for 1m–59m', () => {
    expect(formatDuration(60_000)).toBe('1m 0s');
    expect(formatDuration(90_000)).toBe('1m 30s');
    expect(formatDuration(3_599_000)).toBe('59m 59s');
  });

  it('returns hours and minutes for 1h+', () => {
    expect(formatDuration(3_600_000)).toBe('1h 0m');
    expect(formatDuration(5_400_000)).toBe('1h 30m');
    expect(formatDuration(86_400_000)).toBe('24h 0m');
  });
});

// ── formatRelativeTime ──────────────────────────────────────

describe('formatRelativeTime', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns seconds ago for <60s', () => {
    const fakeNow = 1700000000000;
    vi.spyOn(Date, 'now').mockReturnValue(fakeNow);
    expect(formatRelativeTime(fakeNow - 5000)).toBe('5s ago');
    expect(formatRelativeTime(fakeNow - 59_000)).toBe('59s ago');
  });

  it('returns minutes ago for 1m–59m', () => {
    const fakeNow = 1700000000000;
    vi.spyOn(Date, 'now').mockReturnValue(fakeNow);
    expect(formatRelativeTime(fakeNow - 60_000)).toBe('1m ago');
    expect(formatRelativeTime(fakeNow - 3_540_000)).toBe('59m ago');
  });

  it('returns hours ago for 60m+', () => {
    const fakeNow = 1700000000000;
    vi.spyOn(Date, 'now').mockReturnValue(fakeNow);
    expect(formatRelativeTime(fakeNow - 3_600_000)).toBe('1h ago');
    expect(formatRelativeTime(fakeNow - 86_400_000)).toBe('24h ago');
  });

  it('returns 0s ago for current time', () => {
    const fakeNow = 1700000000000;
    vi.spyOn(Date, 'now').mockReturnValue(fakeNow);
    expect(formatRelativeTime(fakeNow)).toBe('0s ago');
  });
});

// ── formatTime ──────────────────────────────────────────────

describe('formatTime', () => {
  it('returns a string with colons (HH:MM:SS format)', () => {
    const result = formatTime(1700000000000);
    // Locale-dependent, but should contain two colons for HH:MM:SS
    expect(result.split(':').length).toBe(3);
  });

  it('returns consistent output for the same timestamp', () => {
    const ts = 1700000000000;
    expect(formatTime(ts)).toBe(formatTime(ts));
  });
});

// ── statusIcon ──────────────────────────────────────────────

describe('statusIcon', () => {
  it('has entries for all expected statuses', () => {
    expect(statusIcon).toHaveProperty('running');
    expect(statusIcon).toHaveProperty('success');
    expect(statusIcon).toHaveProperty('error');
    expect(statusIcon).toHaveProperty('stopped');
  });

  it('each value is a non-empty string', () => {
    for (const val of Object.values(statusIcon)) {
      expect(typeof val).toBe('string');
      expect(val.length).toBeGreaterThan(0);
    }
  });
});

// ── statusBorderColor ───────────────────────────────────────

describe('statusBorderColor', () => {
  it('maps statuses to Tailwind border classes', () => {
    expect(statusBorderColor.running).toContain('border-l-');
    expect(statusBorderColor.success).toContain('border-l-');
    expect(statusBorderColor.error).toContain('border-l-');
    expect(statusBorderColor.stopped).toContain('border-l-');
  });
});

// ── PALETTES & KIND_COLORS ──────────────────────────────────

describe('PALETTES', () => {
  it('has at least 3 palettes', () => {
    expect(PALETTES.length).toBeGreaterThanOrEqual(3);
  });

  it('every palette has name, kind, and type records', () => {
    for (const p of PALETTES) {
      expect(typeof p.name).toBe('string');
      expect(p.kind).toBeDefined();
      expect(p.type).toBeDefined();
      expect(Object.keys(p.kind).length).toBeGreaterThan(0);
      expect(Object.keys(p.type).length).toBeGreaterThan(0);
    }
  });

  it('every palette has session, prompt, agent, tool kinds', () => {
    for (const p of PALETTES) {
      expect(p.kind).toHaveProperty('session');
      expect(p.kind).toHaveProperty('prompt');
      expect(p.kind).toHaveProperty('agent');
      expect(p.kind).toHaveProperty('tool');
    }
  });
});

describe('KIND_COLORS', () => {
  it('is the first palette kind colors', () => {
    expect(KIND_COLORS).toBe(PALETTES[0].kind);
  });
});

describe('TYPE_COLORS', () => {
  it('is the first palette type colors', () => {
    expect(TYPE_COLORS).toBe(PALETTES[0].type);
  });
});

// ── KIND_ICONS ──────────────────────────────────────────────

describe('KIND_ICONS', () => {
  it('has icons for session, prompt, agent, tool', () => {
    expect(KIND_ICONS).toHaveProperty('session');
    expect(KIND_ICONS).toHaveProperty('prompt');
    expect(KIND_ICONS).toHaveProperty('agent');
    expect(KIND_ICONS).toHaveProperty('tool');
  });
});

// ── getToolIcon ─────────────────────────────────────────────

describe('getToolIcon', () => {
  it('returns specific icons for known tools', () => {
    expect(getToolIcon('Read')).toBe('\u2750');
    expect(getToolIcon('Write')).toBe('\u270E');
    expect(getToolIcon('Bash')).toBe('\u25B8');
    expect(getToolIcon('Glob')).toBe('\u2315');
    expect(getToolIcon('Task')).toBe('\uD83E\uDD16');
  });

  it('returns the generic tool icon for unknown tools', () => {
    expect(getToolIcon('UnknownTool')).toBe(KIND_ICONS.tool);
    expect(getToolIcon('')).toBe(KIND_ICONS.tool);
  });
});

// ── getKindColor ────────────────────────────────────────────

describe('getKindColor', () => {
  it('returns palette kind color for non-agent kinds', () => {
    expect(getKindColor('session')).toBe(PALETTES[0].kind.session);
    expect(getKindColor('prompt')).toBe(PALETTES[0].kind.prompt);
    expect(getKindColor('tool')).toBe(PALETTES[0].kind.tool);
  });

  it('returns type color for agent kind with label', () => {
    expect(getKindColor('agent', 'Explore')).toBe(PALETTES[0].type.Explore);
    expect(getKindColor('agent', 'Plan')).toBe(PALETTES[0].type.Plan);
  });

  it('returns agent kind color when label is not provided', () => {
    expect(getKindColor('agent')).toBe(PALETTES[0].kind.agent);
  });

  it('returns fallback gray for unknown kinds', () => {
    expect(getKindColor('unknown')).toBe('#6b7280');
  });

  it('respects paletteIndex parameter', () => {
    expect(getKindColor('session', undefined, 1)).toBe(PALETTES[1].kind.session);
    expect(getKindColor('session', undefined, 2)).toBe(PALETTES[2].kind.session);
  });

  it('falls back to palette 0 for out-of-range paletteIndex', () => {
    expect(getKindColor('session', undefined, 999)).toBe(PALETTES[0].kind.session);
  });
});

// ── getTypeColor ────────────────────────────────────────────

describe('getTypeColor', () => {
  it('returns the type color from the specified palette', () => {
    expect(getTypeColor('Explore')).toBe(PALETTES[0].type.Explore);
    expect(getTypeColor('Plan', 1)).toBe(PALETTES[1].type.Plan);
  });

  it('returns fallback gray for unknown types', () => {
    expect(getTypeColor('nonexistent')).toBe('#6b7280');
  });

  it('falls back to palette 0 for out-of-range index', () => {
    expect(getTypeColor('Explore', 999)).toBe(PALETTES[0].type.Explore);
  });
});

// ── VENDOR_COLORS & getVendorColor ──────────────────────────

describe('VENDOR_COLORS', () => {
  it('has entries for all expected vendors', () => {
    expect(VENDOR_COLORS).toHaveProperty('anthropic');
    expect(VENDOR_COLORS).toHaveProperty('openai');
    expect(VENDOR_COLORS).toHaveProperty('google');
    expect(VENDOR_COLORS).toHaveProperty('groq');
    expect(VENDOR_COLORS).toHaveProperty('openrouter');
    expect(VENDOR_COLORS).toHaveProperty('custom');
    expect(VENDOR_COLORS).toHaveProperty('claude');
  });

  it('claude and anthropic share the same color', () => {
    expect(VENDOR_COLORS.claude).toBe(VENDOR_COLORS.anthropic);
  });
});

describe('getVendorColor', () => {
  it('returns claude color when vendor is undefined', () => {
    expect(getVendorColor()).toBe(VENDOR_COLORS.claude);
    expect(getVendorColor(undefined)).toBe(VENDOR_COLORS.claude);
  });

  it('returns correct color for known vendors', () => {
    expect(getVendorColor('anthropic')).toBe(VENDOR_COLORS.anthropic);
    expect(getVendorColor('openai')).toBe(VENDOR_COLORS.openai);
    expect(getVendorColor('google')).toBe(VENDOR_COLORS.google);
  });

  it('is case-insensitive', () => {
    expect(getVendorColor('Anthropic')).toBe(VENDOR_COLORS.anthropic);
    expect(getVendorColor('OPENAI')).toBe(VENDOR_COLORS.openai);
  });

  it('returns custom color for unknown vendors', () => {
    expect(getVendorColor('unknown-vendor')).toBe(VENDOR_COLORS.custom);
  });
});

// ── inferVendor ─────────────────────────────────────────────

describe('inferVendor', () => {
  it('returns "claude" when model is undefined', () => {
    expect(inferVendor()).toBe('claude');
    expect(inferVendor(undefined)).toBe('claude');
  });

  it('returns "anthropic" for claude models', () => {
    expect(inferVendor('claude-opus-4-6')).toBe('anthropic');
    expect(inferVendor('claude-sonnet-4-5')).toBe('anthropic');
    expect(inferVendor('anthropic/claude-3')).toBe('anthropic');
  });

  it('returns "openai" for GPT models', () => {
    expect(inferVendor('gpt-4o')).toBe('openai');
    expect(inferVendor('gpt-4-turbo')).toBe('openai');
    expect(inferVendor('openai/gpt-4o')).toBe('openai');
  });

  it('returns "google" for Gemini models', () => {
    expect(inferVendor('gemini-2.5-pro')).toBe('google');
    expect(inferVendor('google/gemini-pro')).toBe('google');
  });

  it('returns "groq" for groq-prefixed models', () => {
    expect(inferVendor('groq/llama-3')).toBe('groq');
  });

  it('returns "openrouter" for openrouter-prefixed models', () => {
    expect(inferVendor('openrouter/mistral-7b')).toBe('openrouter');
  });

  it('returns "custom" for unrecognized models', () => {
    expect(inferVendor('llama-3-70b')).toBe('custom');
    expect(inferVendor('some-random-model')).toBe('custom');
  });

  it('is case-insensitive', () => {
    expect(inferVendor('Claude-Opus-4-6')).toBe('anthropic');
    expect(inferVendor('GPT-4o')).toBe('openai');
    expect(inferVendor('Gemini-Pro')).toBe('google');
  });
});

// ── normalizeCwd ────────────────────────────────────────────

describe('normalizeCwd', () => {
  it('converts backslashes to forward slashes', () => {
    const result = normalizeCwd('C:\\Users\\test\\project');
    expect(result).not.toContain('\\');
    // On Windows it also lowercases
    if (process.platform === 'win32') {
      expect(result).toBe('c:/users/test/project');
    } else {
      expect(result).toBe('C:/Users/test/project');
    }
  });

  it('removes trailing slash', () => {
    const result = normalizeCwd('/home/user/project/');
    expect(result).not.toMatch(/\/$/);
  });

  it('handles already-normalized paths', () => {
    // On Windows, will also lowercase
    const input = '/home/user/project';
    const result = normalizeCwd(input);
    expect(result).toContain('home/user/project');
  });

  it('handles empty string', () => {
    expect(normalizeCwd('')).toBe('');
  });

  it('handles paths with mixed separators', () => {
    const result = normalizeCwd('C:\\Users/test\\project/');
    expect(result).not.toContain('\\');
    expect(result).not.toMatch(/\/$/);
    if (process.platform === 'win32') {
      expect(result).toBe('c:/users/test/project');
    } else {
      expect(result).toBe('C:/Users/test/project');
    }
  });

  it('lowercases on Windows (platform-dependent behavior)', () => {
    // This test runs on Windows per the environment info
    if (process.platform === 'win32') {
      expect(normalizeCwd('C:\\Users\\Test')).toBe('c:/users/test');
    }
  });
});
