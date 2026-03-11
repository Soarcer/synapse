// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Bernhard

import { useState, useEffect, useRef, useCallback } from 'react';
import type { ReasoningData, ReasoningTurn } from '@synapse-ai/core';
import { apiUrl } from '../../utils/api.js';
import { getToolIcon } from '@synapse-ai/core';

const POLL_INTERVAL_MS = 5000;
const AUTO_SCROLL_KEY = 'synapse-reasoning-autoscroll';

function loadAutoScroll(): boolean {
  try {
    return localStorage.getItem(AUTO_SCROLL_KEY) !== 'false';
  } catch {
    return true;
  }
}

interface ReasoningSectionProps {
  sessionId: string;
}

export function ReasoningSection({ sessionId }: ReasoningSectionProps) {
  const [data, setData] = useState<ReasoningData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<'structured' | 'raw'>('structured');
  const [autoScroll, setAutoScroll] = useState(loadAutoScroll);

  const bottomRef = useRef<HTMLDivElement>(null);
  const prevTurnCount = useRef(0);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (!sessionId) return;

    // Abort any in-flight fetches from previous sessionId
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    // Clear stale data immediately so old reasoning never shows under new node
    setData(null);
    setLoading(true);
    setError(null);

    const doFetch = (isInitial: boolean) => {
      if (controller.signal.aborted) return;
      fetch(apiUrl(`/api/transcript/${sessionId}/reasoning`), { signal: controller.signal })
        .then((r) => {
          if (!r.ok) throw new Error(`${r.status}`);
          return r.json();
        })
        .then((d: ReasoningData) => {
          if (!controller.signal.aborted) setData(d);
        })
        .catch((e) => {
          if (e instanceof DOMException && e.name === 'AbortError') return;
          if (isInitial && !controller.signal.aborted) setError('Failed to load reasoning data');
        })
        .finally(() => {
          if (isInitial && !controller.signal.aborted) setLoading(false);
        });
    };

    doFetch(true);
    pollRef.current = setInterval(() => doFetch(false), POLL_INTERVAL_MS);

    return () => {
      controller.abort();
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [sessionId]);

  const toggleAutoScroll = useCallback(() => {
    setAutoScroll((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(AUTO_SCROLL_KEY, String(next));
      } catch {
        /* quota */
      }
      return next;
    });
  }, []);

  const thinkingTurns = data?.turns.filter((t) => t.thinkingText) ?? [];
  const errorTurns = data?.turns.filter((t) => t.isApiErrorMessage || t.error) ?? [];
  const totalChars = thinkingTurns.reduce((s, t) => s + (t.thinkingText?.length ?? 0), 0);

  // Auto-scroll when new turns arrive
  useEffect(() => {
    const count = thinkingTurns.length;
    if (autoScroll && count > prevTurnCount.current && bottomRef.current) {
      bottomRef.current.scrollIntoView({ behavior: 'smooth', block: 'end' });
    }
    prevTurnCount.current = count;
  }, [thinkingTurns.length, autoScroll]);

  const badgeParts: string[] = [];
  if (thinkingTurns.length > 0)
    badgeParts.push(`${thinkingTurns.length} thinking · ${formatChars(totalChars)}`);
  if (errorTurns.length > 0)
    badgeParts.push(`${errorTurns.length} error${errorTurns.length !== 1 ? 's' : ''}`);
  const badge = badgeParts.length > 0 ? badgeParts.join(' · ') : undefined;

  return (
    <div aria-label="Reasoning section">
      {badge && <div className="text-gray-500 text-[10px] mb-2">{badge}</div>}
      <div className="space-y-2 pb-2">
        {loading && <div className="text-gray-600 text-xs py-2">Loading reasoning data...</div>}

        {error && <div className="text-red-400/60 text-xs py-2">{error}</div>}

        {!loading && !error && thinkingTurns.length === 0 && (
          <div className="text-gray-600 text-xs py-2">
            No reasoning data available — thinking may have been disabled for this session.
          </div>
        )}

        {/* Error summary */}
        {!loading && !error && errorTurns.length > 0 && (
          <div className="bg-red-950/20 border border-red-900/40 rounded-lg px-3 py-2">
            <span className="text-red-400 text-xs font-medium">
              {errorTurns.length} API error{errorTurns.length !== 1 ? 's' : ''}
            </span>
            <div className="flex gap-1.5 mt-1 flex-wrap">
              {[...new Set(errorTurns.map((t) => t.error).filter(Boolean))].map((errType) => {
                const count = errorTurns.filter((t) => t.error === errType).length;
                return (
                  <span
                    key={errType}
                    className="px-1.5 py-0.5 rounded text-[9px] bg-red-900/50 text-red-300"
                  >
                    {errType} ({count})
                  </span>
                );
              })}
            </div>
          </div>
        )}

        {!loading && !error && thinkingTurns.length > 0 && (
          <>
            {/* Mode toggle + auto-scroll */}
            <div className="flex gap-1 items-center">
              <button
                onClick={() => setMode('structured')}
                className={`px-2 py-0.5 rounded text-[10px] transition-colors ${
                  mode === 'structured'
                    ? 'bg-blue-900/50 text-blue-300 border border-blue-800/50'
                    : 'bg-gray-900/30 text-gray-500 border border-gray-800/30 hover:text-gray-400'
                }`}
              >
                Structured
              </button>
              <button
                onClick={() => setMode('raw')}
                className={`px-2 py-0.5 rounded text-[10px] transition-colors ${
                  mode === 'raw'
                    ? 'bg-blue-900/50 text-blue-300 border border-blue-800/50'
                    : 'bg-gray-900/30 text-gray-500 border border-gray-800/30 hover:text-gray-400'
                }`}
              >
                Raw
              </button>
              <button
                onClick={toggleAutoScroll}
                title={
                  autoScroll
                    ? 'Auto-scroll on — click to disable'
                    : 'Auto-scroll off — click to enable'
                }
                className={`ml-auto px-2 py-0.5 rounded text-[10px] transition-colors flex items-center gap-1 ${
                  autoScroll
                    ? 'bg-emerald-900/40 text-emerald-300 border border-emerald-800/40'
                    : 'bg-gray-900/30 text-gray-500 border border-gray-800/30 hover:text-gray-400'
                }`}
              >
                <span className="text-[10px]">{autoScroll ? '↓' : '⏸'}</span>
                Auto-scroll
              </button>
            </div>

            {/* Turn cards */}
            {thinkingTurns.map((turn, i) =>
              mode === 'structured' ? (
                <StructuredTurnCard key={turn.uuid} turn={turn} index={i} />
              ) : (
                <RawTurnCard key={turn.uuid} turn={turn} index={i} />
              ),
            )}
            <div ref={bottomRef} />
          </>
        )}
      </div>
    </div>
  );
}

// ─── Structured Turn Card ────────────────────────────────────────

function StructuredTurnCard({ turn, index }: { turn: ReasoningTurn; index: number }) {
  const isError = turn.isApiErrorMessage || !!turn.error;
  return (
    <div
      className={`bg-[#0d1117] border rounded-lg p-3 space-y-2 ${
        isError ? 'border-red-800/60' : 'border-gray-800'
      }`}
    >
      {/* Header */}
      <div className="flex items-center gap-2">
        <span className="text-gray-500 text-[10px] font-mono">#{index + 1}</span>
        {turn.model && <span className="text-gray-600 text-[10px]">{turn.model}</span>}
        {turn.isSidechain && (
          <span className="bg-purple-900/50 text-purple-300 text-[9px] px-1.5 rounded">Task</span>
        )}
        {isError && (
          <span className="bg-red-900/50 text-red-300 text-[9px] px-1.5 rounded">
            {turn.error ?? 'error'}
          </span>
        )}
        {turn.structured?.confidence != null && (
          <ConfidenceBadge confidence={turn.structured.confidence} />
        )}
      </div>

      {/* Intent */}
      {turn.structured?.intent && (
        <div className="bg-blue-950/30 border border-blue-900/50 rounded p-2">
          <span className="text-gray-500 text-[10px] block mb-0.5">Intent</span>
          <span className="text-blue-200/80 text-xs">{turn.structured.intent}</span>
        </div>
      )}

      {/* Plan steps */}
      {turn.structured?.planSteps && turn.structured.planSteps.length > 0 && (
        <div className="space-y-0.5">
          <span className="text-gray-500 text-[10px]">Plan</span>
          {turn.structured.planSteps.map((step, si) => (
            <div key={si} className="flex items-start gap-1.5 text-xs">
              <span className={step.done ? 'text-green-400' : 'text-blue-400'}>
                {step.done ? '✓' : '→'}
              </span>
              <span className={step.done ? 'text-gray-500 line-through' : 'text-gray-300'}>
                {step.text}
              </span>
            </div>
          ))}
        </div>
      )}

      {/* Decision */}
      {turn.structured?.decision && (
        <div className="bg-purple-950/30 border border-purple-900/50 rounded p-2">
          <span className="text-gray-500 text-[10px] block mb-0.5">Decision</span>
          <span className="text-purple-200/80 text-xs">{turn.structured.decision}</span>
        </div>
      )}

      {/* Confidence bar */}
      {turn.structured?.confidence != null && (
        <div className="space-y-0.5">
          <span className="text-gray-500 text-[10px]">Confidence</span>
          <div className="h-1.5 bg-gray-800 rounded-full overflow-hidden">
            <div
              className={`h-full rounded-full transition-all ${confidenceColor(turn.structured.confidence)}`}
              style={{ width: `${Math.round(turn.structured.confidence * 100)}%` }}
            />
          </div>
        </div>
      )}

      {/* Tool calls */}
      {turn.toolCalls.length > 0 && (
        <div className="space-y-1">
          <span className="text-gray-500 text-[10px]">Tools ({turn.toolCalls.length})</span>
          {turn.toolCalls.map((tc) => (
            <div
              key={tc.id}
              className={`rounded px-2 py-1.5 flex items-center gap-2 text-xs ${
                tc.isError
                  ? 'bg-red-950/20 border border-red-900/40'
                  : 'bg-green-950/20 border border-green-900/40'
              }`}
            >
              <span className="text-gray-500">{getToolIcon(tc.name)}</span>
              <span className={tc.isError ? 'text-red-300' : 'text-green-300'}>{tc.name}</span>
              <span className="text-gray-600 truncate flex-1 text-[10px]">
                {formatToolInput(tc.input)}
              </span>
              {tc.durationMs != null && tc.durationMs > 0 && (
                <span className="text-gray-600 text-[10px] shrink-0">{tc.durationMs}ms</span>
              )}
              <span className={tc.isError ? 'text-red-400' : 'text-green-400'}>
                {tc.isError ? '✗' : '✓'}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Raw Turn Card ──────────────────────────────────────────────

function RawTurnCard({ turn, index }: { turn: ReasoningTurn; index: number }) {
  const [expanded, setExpanded] = useState(index === 0);

  return (
    <div className="bg-[#0d1117] border border-gray-800 rounded-lg overflow-hidden">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-gray-800/30"
      >
        <span
          className={`text-gray-500 text-xs transition-transform ${expanded ? 'rotate-90' : ''}`}
        >
          ▶
        </span>
        <span className="text-gray-400 text-xs">Turn #{index + 1}</span>
        <span className="text-gray-600 text-[10px] ml-auto">
          {formatChars(turn.thinkingText?.length ?? 0)}
        </span>
      </button>
      {expanded && (
        <pre className="px-3 pb-3 text-[11px] text-blue-200/60 font-mono whitespace-pre-wrap max-h-60 overflow-auto leading-relaxed">
          {turn.thinkingText}
        </pre>
      )}
    </div>
  );
}

// ─── Helpers ─────────────────────────────────────────────────────

function ConfidenceBadge({ confidence }: { confidence: number }) {
  const pct = Math.round(confidence * 100);
  const color =
    confidence >= 0.8
      ? 'bg-green-900/50 text-green-300'
      : confidence >= 0.5
        ? 'bg-yellow-900/50 text-yellow-300'
        : 'bg-red-900/50 text-red-300';

  return <span className={`text-[9px] px-1.5 rounded ${color}`}>{pct}%</span>;
}

function confidenceColor(c: number): string {
  if (c >= 0.8) return 'bg-green-500';
  if (c >= 0.5) return 'bg-yellow-500';
  return 'bg-red-500';
}

function formatChars(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k chars`;
  return `${n} chars`;
}

function formatToolInput(input: Record<string, unknown>): string {
  const first = Object.values(input)[0];
  if (typeof first === 'string') return first.slice(0, 80);
  return JSON.stringify(input).slice(0, 80);
}
