// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Synapse Contributors

import { describe, it, expect } from 'vitest';
import { buildCostPerTurn } from '../lensComputations';
import type { UserPromptData, AgentNodeData, TranscriptSummary, TranscriptTurn } from '@synapse-ai/core';

function makeTurn(overrides: Partial<TranscriptTurn> & { uuid: string; type: 'user' | 'assistant'; timestamp: number }): TranscriptTurn {
  return {
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheCreationTokens: 0,
    contentTypes: ['text'],
    toolNames: [],
    toolUseCount: 0,
    textLength: 0,
    thinkingLength: 0,
    totalInputTokens: 0,
    cacheHitRate: 0,
    isMeta: false,
    ...overrides,
  };
}

describe('buildCostPerTurn isMeta filtering', () => {
  it('should exclude isMeta turns from transcript token matching', () => {
    const prompts = new Map<string, UserPromptData[]>([
      ['sess1', [{ id: 'p1', sessionId: 'sess1', text: 'hello', timestamp: 1000 } as UserPromptData]],
    ]);
    const agents = new Map<string, AgentNodeData>();

    const transcript: TranscriptSummary = {
      sessionId: 'sess1',
      transcriptPath: '/tmp/test.jsonl',
      turns: [
        makeTurn({ uuid: 'u1', type: 'user', timestamp: 1000, isMeta: true, textLength: 20 }),
        makeTurn({ uuid: 'a1', type: 'assistant', timestamp: 1001, isMeta: true, inputTokens: 5000, outputTokens: 2000, totalInputTokens: 5000 }),
        makeTurn({ uuid: 'a2', type: 'assistant', timestamp: 1002, isMeta: false, inputTokens: 1000, outputTokens: 500, totalInputTokens: 1000 }),
      ],
      totalInputTokens: 6000,
      totalOutputTokens: 2500,
      totalCacheReadTokens: 0,
      totalCacheCreationTokens: 0,
      modelUsage: [],
      estimatedCostUsd: 0,
      avgCacheHitRate: 0,
      peakCacheHitRate: 0,
      totalDurationMs: 2000,
      avgResponseLatencyMs: 0,
      totalThinkingChars: 0,
      totalTextChars: 0,
      totalToolCalls: 0,
      uniqueToolNames: [],
    };

    const transcripts = new Map<string, TranscriptSummary>([['sess1', transcript]]);

    const result = buildCostPerTurn(prompts, agents, [], transcripts);
    // The isMeta assistant turn (5000 input tokens) should be excluded
    // Only the real assistant turn (1000 input tokens) should count
    expect(result).toHaveLength(1);
    expect(result[0].inputTokens).toBe(1000);
    expect(result[0].outputTokens).toBe(500);
  });
});
