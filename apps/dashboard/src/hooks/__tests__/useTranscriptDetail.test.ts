// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Synapse Contributors

// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { findThinkingForTool } from '../useTranscriptDetail';
import type { ReasoningData } from '@synapse-ai/core';

describe('findThinkingForTool', () => {
  const reasoning: ReasoningData = {
    sessionId: 'sess1',
    turns: [
      {
        uuid: 'a1',
        parentUuid: 'u1',
        timestamp: 1000,
        isSidechain: false,
        isApiErrorMessage: false,
        thinkingText: 'I need to read the file first to understand the structure before editing.',
        structured: null,
        responseText: null,
        toolCalls: [
          { id: 'tu1', name: 'Read', input: { file_path: '/foo.ts' }, resultContent: null, isError: false, durationMs: null },
          { id: 'tu2', name: 'Edit', input: { file_path: '/foo.ts' }, resultContent: null, isError: false, durationMs: null },
        ],
        usage: { inputTokens: 100, outputTokens: 50, cacheReadTokens: 0 },
      },
    ],
  };

  it('returns thinking for a matching toolUseId', () => {
    const result = findThinkingForTool(reasoning, 'tu1');
    expect(result).toContain('read the file first');
  });

  it('returns null for unknown toolUseId', () => {
    expect(findThinkingForTool(reasoning, 'unknown')).toBeNull();
  });

  it('returns null when reasoning is undefined', () => {
    expect(findThinkingForTool(undefined, 'tu1')).toBeNull();
  });

  it('truncates long thinking to last 200 chars', () => {
    const longThinking: ReasoningData = {
      sessionId: 'sess1',
      turns: [{
        ...reasoning.turns[0],
        thinkingText: 'x'.repeat(300),
      }],
    };
    const result = findThinkingForTool(longThinking, 'tu1');
    expect(result).not.toBeNull();
    expect(result!.length).toBe(203); // '...' + 200 chars
    expect(result!.startsWith('...')).toBe(true);
  });
});
