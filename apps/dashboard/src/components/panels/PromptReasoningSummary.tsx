// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Bernhard

import { useState, useEffect, useMemo, useRef } from 'react';
import type { PromptTurnData, ReasoningTurn } from '@synapse-ai/core';
import { CollapsibleSection } from './CollapsibleSection.js';
import { apiUrl } from '../../utils/api.js';

interface PromptReasoningSummaryProps {
  sessionId: string;
  promptText: string;
  promptTimestamp: number;
}

export function PromptReasoningSummary({
  sessionId,
  promptText,
  promptTimestamp,
}: PromptReasoningSummaryProps) {
  const [data, setData] = useState<PromptTurnData | null>(null);
  const [loading, setLoading] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (!sessionId) return;

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setData(null);
    setLoading(true);

    fetch(apiUrl(`/api/transcript/${sessionId}/prompt-turns`), { signal: controller.signal })
      .then((r) => {
        if (!r.ok) throw new Error(`${r.status}`);
        return r.json();
      })
      .then((d: PromptTurnData) => {
        if (!controller.signal.aborted) setData(d);
      })
      .catch((e) => {
        if (e instanceof DOMException && e.name === 'AbortError') return;
        /* silently fail — reasoning is optional */
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });

    return () => {
      controller.abort();
    };
  }, [sessionId]);

  // Match to the specific prompt's group using timestamp + text
  const relevantTurns: ReasoningTurn[] = useMemo(() => {
    if (!data?.groups.length || !promptText) return [];

    // Primary: timestamp within ±5 seconds
    const candidates = data.groups.filter(
      (g) => Math.abs(g.promptTimestamp - promptTimestamp) < 5000,
    );
    if (candidates.length === 1) return candidates[0].turns;

    // Tiebreaker: text prefix match
    const prefix = promptText.slice(0, 80).toLowerCase();
    const match = (candidates.length > 1 ? candidates : data.groups).find(
      (g) =>
        g.promptText.toLowerCase().startsWith(prefix) ||
        prefix.startsWith(g.promptText.slice(0, 80).toLowerCase()),
    );
    return match?.turns ?? [];
  }, [data, promptText, promptTimestamp]);

  if (loading) return null;
  if (!data || relevantTurns.length === 0) return null;

  const thinkingTurns = relevantTurns.filter((t) => t.thinkingText);
  const totalChars = thinkingTurns.reduce((s, t) => s + (t.thinkingText?.length ?? 0), 0);
  const decisions = relevantTurns
    .map((t) => t.structured?.decision)
    .filter((d): d is string => d != null);

  // Tool summary: count by name
  const toolCounts = new Map<string, number>();
  for (const turn of relevantTurns) {
    for (const tc of turn.toolCalls) {
      toolCounts.set(tc.name, (toolCounts.get(tc.name) ?? 0) + 1);
    }
  }
  const toolSummary = [...toolCounts.entries()]
    .map(([name, count]) => `${name}(${count})`)
    .join(' ');

  // Confidence range
  const confidences = relevantTurns
    .map((t) => t.structured?.confidence)
    .filter((c): c is number => c != null);
  const confRange =
    confidences.length > 0
      ? `${Math.round(Math.min(...confidences) * 100)}–${Math.round(Math.max(...confidences) * 100)}%`
      : null;

  const badge = `${thinkingTurns.length} thinking · ${formatChars(totalChars)}`;

  return (
    <CollapsibleSection title="Reasoning Summary" badge={badge} defaultOpen={false}>
      <div className="space-y-1.5 pb-2">
        {/* Decisions */}
        {decisions.length > 0 && (
          <div>
            <span className="text-gray-500 text-[10px] block mb-0.5">Decisions</span>
            <ul className="space-y-0.5">
              {decisions.map((d, i) => (
                <li key={i} className="text-xs text-purple-200/70 flex gap-1.5">
                  <span className="text-purple-400 shrink-0">→</span>
                  <span className="truncate">{d}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Tool summary */}
        {toolSummary && (
          <div>
            <span className="text-gray-500 text-[10px] block mb-0.5">Tools</span>
            <span className="text-xs text-green-200/70 font-mono">{toolSummary}</span>
          </div>
        )}

        {/* Confidence range */}
        {confRange && (
          <div>
            <span className="text-gray-500 text-[10px] block mb-0.5">Confidence</span>
            <span className="text-xs text-gray-300">{confRange}</span>
          </div>
        )}
      </div>
    </CollapsibleSection>
  );
}

function formatChars(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k chars`;
  return `${n} chars`;
}
