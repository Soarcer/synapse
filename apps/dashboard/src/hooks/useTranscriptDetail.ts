// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Bernhard

import { useCallback, useRef } from 'react';
import type { ReasoningData } from '@synapse-ai/core';
import { useAgentStore } from '../store/agentStore';
import { fetchTranscriptReasoning } from '../utils/api';

/** Lazily fetches transcript reasoning for a session, caching in store. */
export function useTranscriptDetail(sessionId: string | undefined) {
  const reasoning = useAgentStore((s) =>
    sessionId ? s.transcriptReasoning.get(sessionId) : undefined,
  );
  const setReasoning = useAgentStore((s) => s.setTranscriptReasoning);
  const inflightRef = useRef<Set<string>>(new Set());

  const ensureLoaded = useCallback(() => {
    if (!sessionId || reasoning || inflightRef.current.has(sessionId)) return;
    inflightRef.current.add(sessionId);
    fetchTranscriptReasoning(sessionId)
      .then((data) => {
        inflightRef.current.delete(sessionId);
        if (data) setReasoning(sessionId, data);
      })
      .catch(() => {
        inflightRef.current.delete(sessionId);
      });
  }, [sessionId, reasoning, setReasoning]);

  return { reasoning, ensureLoaded };
}

/** Finds the thinking excerpt that preceded a specific tool call. */
export function findThinkingForTool(
  reasoning: ReasoningData | undefined,
  toolUseId: string,
): string | null {
  if (!reasoning) return null;
  for (const turn of reasoning.turns) {
    const match = turn.toolCalls.find((tc) => tc.id === toolUseId);
    if (match && turn.thinkingText) {
      // Return last 200 chars of thinking (the decision portion)
      const text = turn.thinkingText;
      return text.length > 200 ? '...' + text.slice(-200) : text;
    }
  }
  return null;
}
