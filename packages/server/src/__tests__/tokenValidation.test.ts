// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Bernhard

// Set DB path BEFORE any server imports
import path from 'path';
import os from 'os';

process.env.SYNAPSE_DB_PATH = path.join(
  os.tmpdir(),
  'synapse-test-tokenvalidation-' + Date.now() + '.db',
);

import { describe, it, expect, vi, beforeAll } from 'vitest';
import { initDb } from '../db.js';
import { validateTokenCounts } from '../services/eventStore.js';
import type { Logger } from '../lib/logger.js';

beforeAll(async () => {
  await initDb();
});

// Minimal no-op logger for tests
const noopLog = {
  warn: vi.fn(),
  debug: vi.fn(),
  info: vi.fn(),
  error: vi.fn(),
  trace: vi.fn(),
  fatal: vi.fn(),
  child: vi.fn(),
} as unknown as Logger;

describe('validateTokenCounts', () => {
  it('passes through valid positive values unchanged', () => {
    const result = validateTokenCounts(
      {
        inputTokens: 1000,
        outputTokens: 500,
        cacheReadTokens: 200,
        cacheCreationTokens: 100,
        thinkingTokens: 50,
      },
      noopLog,
    );

    expect(result.inputTokens).toBe(1000);
    expect(result.outputTokens).toBe(500);
    expect(result.cacheReadTokens).toBe(200);
    expect(result.cacheCreationTokens).toBe(100);
    expect(result.thinkingTokens).toBe(50);
  });

  it('clamps negative inputTokens to 0', () => {
    const result = validateTokenCounts(
      {
        inputTokens: -5,
        outputTokens: 0,
        cacheReadTokens: 0,
        cacheCreationTokens: 0,
        thinkingTokens: 0,
      },
      noopLog,
    );
    expect(result.inputTokens).toBe(0);
  });

  it('clamps negative outputTokens to 0', () => {
    const result = validateTokenCounts(
      {
        inputTokens: 0,
        outputTokens: -100,
        cacheReadTokens: 0,
        cacheCreationTokens: 0,
        thinkingTokens: 0,
      },
      noopLog,
    );
    expect(result.outputTokens).toBe(0);
  });

  it('clamps negative cacheReadTokens to 0 and logs a warning', () => {
    const log = { ...noopLog, warn: vi.fn() } as unknown as Logger;
    const result = validateTokenCounts(
      {
        inputTokens: 100,
        outputTokens: 50,
        cacheReadTokens: -10,
        cacheCreationTokens: 0,
        thinkingTokens: 0,
      },
      log,
    );
    expect(result.cacheReadTokens).toBe(0);
    expect(log.warn).toHaveBeenCalled();
  });

  it('clamps negative cacheCreationTokens to 0', () => {
    const result = validateTokenCounts(
      {
        inputTokens: 100,
        outputTokens: 50,
        cacheReadTokens: 0,
        cacheCreationTokens: -20,
        thinkingTokens: 0,
      },
      noopLog,
    );
    expect(result.cacheCreationTokens).toBe(0);
  });

  it('clamps negative thinkingTokens to 0', () => {
    const result = validateTokenCounts(
      {
        inputTokens: 100,
        outputTokens: 50,
        cacheReadTokens: 0,
        cacheCreationTokens: 0,
        thinkingTokens: -999,
      },
      noopLog,
    );
    expect(result.thinkingTokens).toBe(0);
  });

  it('clamps all negative fields simultaneously', () => {
    const result = validateTokenCounts(
      {
        inputTokens: -1,
        outputTokens: -2,
        cacheReadTokens: -3,
        cacheCreationTokens: -4,
        thinkingTokens: -5,
      },
      noopLog,
    );
    expect(result.inputTokens).toBe(0);
    expect(result.outputTokens).toBe(0);
    expect(result.cacheReadTokens).toBe(0);
    expect(result.cacheCreationTokens).toBe(0);
    expect(result.thinkingTokens).toBe(0);
  });

  it('passes through zero values unchanged', () => {
    const result = validateTokenCounts(
      {
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 0,
        cacheCreationTokens: 0,
        thinkingTokens: 0,
      },
      noopLog,
    );
    expect(result.inputTokens).toBe(0);
    expect(result.outputTokens).toBe(0);
    expect(result.cacheReadTokens).toBe(0);
    expect(result.cacheCreationTokens).toBe(0);
    expect(result.thinkingTokens).toBe(0);
  });

  it('warns when cacheCreationTokens > inputTokens', () => {
    const log = { ...noopLog, warn: vi.fn() } as unknown as Logger;
    validateTokenCounts(
      {
        inputTokens: 100,
        outputTokens: 50,
        cacheReadTokens: 0,
        cacheCreationTokens: 200,
        thinkingTokens: 0,
      },
      log,
    );
    expect(log.warn).toHaveBeenCalled();
  });

  it('does not warn when cacheCreationTokens <= inputTokens', () => {
    const log = { ...noopLog, warn: vi.fn() } as unknown as Logger;
    validateTokenCounts(
      {
        inputTokens: 500,
        outputTokens: 50,
        cacheReadTokens: 0,
        cacheCreationTokens: 100,
        thinkingTokens: 0,
      },
      log,
    );
    // warn is called only for negative cacheRead, not for creation <= input
    const warnCalls = (log.warn as ReturnType<typeof vi.fn>).mock.calls;
    const hasCreationWarn = warnCalls.some(
      (call: unknown[]) =>
        typeof call[1] === 'string' && (call[1] as string).includes('cacheCreation'),
    );
    expect(hasCreationWarn).toBe(false);
  });

  it('warns for token counts exceeding 10M', () => {
    const log = { ...noopLog, warn: vi.fn() } as unknown as Logger;
    validateTokenCounts(
      {
        inputTokens: 11_000_000,
        outputTokens: 0,
        cacheReadTokens: 0,
        cacheCreationTokens: 0,
        thinkingTokens: 0,
      },
      log,
    );
    expect(log.warn).toHaveBeenCalled();
  });

  it('returns a new object (does not mutate input)', () => {
    const input = {
      inputTokens: -5,
      outputTokens: 100,
      cacheReadTokens: 0,
      cacheCreationTokens: 0,
      thinkingTokens: 0,
    };
    const result = validateTokenCounts(input, noopLog);
    // Input should be unchanged
    expect(input.inputTokens).toBe(-5);
    // Result is clamped
    expect(result.inputTokens).toBe(0);
  });
});
