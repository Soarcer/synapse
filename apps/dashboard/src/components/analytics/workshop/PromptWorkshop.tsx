// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Bernhard

import { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import { formatRewrite } from '../shared/formatMarkdown';
import { copyToClipboard } from '../../../utils/clipboard';
import type { AnalysisMode } from '../prompts/PromptAnalyzer';
import type { MockSession, MockTurn } from '../mockData';

// ─── Types ──────────────────────────────────────────────────────────

interface WorkshopResult {
  id: string;
  promptText: string;
  mode: AnalysisMode;
  score: number;
  explanation: string;
  rewrite: string;
  estimatedSavings: string;
  historyComparison: string;
  timestamp: number;
}

// ─── localStorage persistence ────────────────────────────────────────

const WORKSHOP_HISTORY_KEY = 'synapse-workshop-history';
const MAX_HISTORY = 20;

function loadHistory(): WorkshopResult[] {
  try {
    const raw = localStorage.getItem(WORKSHOP_HISTORY_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveHistory(history: WorkshopResult[]): void {
  try {
    localStorage.setItem(WORKSHOP_HISTORY_KEY, JSON.stringify(history));
  } catch {
    /* quota exceeded — silently skip */
  }
}

// ─── Workshop Context persistence ─────────────────────────────────────

const WORKSHOP_CONTEXT_KEY = 'synapse-workshop-context';

interface WorkshopContext {
  sessionId: string | null; // null = auto (most recent), '' = none
  notes: string;
  panelOpen: boolean;
}

const DEFAULT_CONTEXT: WorkshopContext = {
  sessionId: null,
  notes: '',
  panelOpen: false,
};

function loadContext(): WorkshopContext {
  try {
    const raw = localStorage.getItem(WORKSHOP_CONTEXT_KEY);
    return raw ? { ...DEFAULT_CONTEXT, ...JSON.parse(raw) } : DEFAULT_CONTEXT;
  } catch {
    return DEFAULT_CONTEXT;
  }
}

function saveContext(ctx: WorkshopContext): void {
  try {
    localStorage.setItem(WORKSHOP_CONTEXT_KEY, JSON.stringify(ctx));
  } catch {
    /* quota exceeded */
  }
}

// ─── Favorites persistence ────────────────────────────────────────────

const WORKSHOP_FAVORITES_KEY = 'synapse-workshop-favorites';
const MAX_FAVORITES = 50;

function loadFavorites(): WorkshopResult[] {
  try {
    const raw = localStorage.getItem(WORKSHOP_FAVORITES_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveFavorites(favorites: WorkshopResult[]): void {
  try {
    localStorage.setItem(WORKSHOP_FAVORITES_KEY, JSON.stringify(favorites));
  } catch {
    /* quota exceeded */
  }
}

// ─── SVG Icons ───────────────────────────────────────────────────────

function CopyIcon() {
  return (
    <svg
      className="w-3.5 h-3.5"
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={2}
    >
      <path d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
    </svg>
  );
}

function TerminalIcon() {
  return (
    <svg
      className="w-3.5 h-3.5"
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={2}
    >
      <path d="M8 9l3 3-3 3m5 0h3M5 20h14a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
    </svg>
  );
}

function PencilIcon() {
  return (
    <svg
      className="w-3.5 h-3.5"
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={2}
    >
      <path d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
    </svg>
  );
}

function SparkleIcon() {
  return (
    <svg
      className="w-3.5 h-3.5"
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={2}
    >
      <path d="M5 3v4M3 5h4M6 17v4m-2-2h4m5-16l2.286 6.857L21 12l-5.714 2.143L13 21l-2.286-6.857L5 12l5.714-2.143L13 3z" />
    </svg>
  );
}

function ClockIcon() {
  return (
    <svg
      className="w-3.5 h-3.5"
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={2}
    >
      <path d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
    </svg>
  );
}

function RegenIcon() {
  return (
    <svg
      className="w-3.5 h-3.5"
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={2}
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
      />
    </svg>
  );
}

function ChevronIcon({ open }: { open: boolean }) {
  return (
    <svg
      className={`w-3 h-3 transition-transform ${open ? 'rotate-90' : ''}`}
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={2}
    >
      <path d="M9 5l7 7-7 7" />
    </svg>
  );
}

function StarIcon({ filled }: { filled: boolean }) {
  return (
    <svg
      className="w-3 h-3"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={2}
      fill={filled ? 'currentColor' : 'none'}
    >
      <path d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z" />
    </svg>
  );
}

// ─── Component ───────────────────────────────────────────────────────

interface PromptWorkshopProps {
  analysisMode: AnalysisMode;
  modelId?: string;
  sessions: MockSession[];
  turns: MockTurn[];
}

export function PromptWorkshop({ analysisMode, modelId, sessions, turns }: PromptWorkshopProps) {
  const [promptText, setPromptText] = useState('');
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [currentResult, setCurrentResult] = useState<WorkshopResult | null>(null);
  const [history, setHistory] = useState<WorkshopResult[]>(loadHistory);
  const [showHistory, setShowHistory] = useState(false);
  const [copyFeedback, setCopyFeedback] = useState(false);
  const [sendFeedback, setSendFeedback] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [workshopCtx, setWorkshopCtx] = useState<WorkshopContext>(loadContext);
  const [sessionSpecificTurns, setSessionSpecificTurns] = useState<MockTurn[]>([]);

  // Persist history on change
  const [favorites, setFavorites] = useState<WorkshopResult[]>(loadFavorites);

  useEffect(() => {
    saveHistory(history);
  }, [history]);
  useEffect(() => {
    saveContext(workshopCtx);
  }, [workshopCtx]);
  useEffect(() => {
    saveFavorites(favorites);
  }, [favorites]);

  // Per-session turn fetch for explicitly selected sessions
  useEffect(() => {
    // Only fetch for explicitly selected sessions (not auto, not none)
    if (!workshopCtx.sessionId || workshopCtx.sessionId === '') {
      setSessionSpecificTurns([]);
      return;
    }
    fetch(`/api/analytics/turns?sessionId=${encodeURIComponent(workshopCtx.sessionId)}&limit=200`)
      .then((r) => r.json())
      .then((data) => {
        const raw = data.data ?? data;
        if (Array.isArray(raw)) {
          setSessionSpecificTurns(
            raw.map((t: Record<string, unknown>) => ({
              sessionId: (t.sessionId as string) || '',
              turnIndex: t.turnIndex as number,
              timestamp: t.timestamp as number,
              promptText: (t.promptText as string) || '',
              inputTokens: t.inputTokens as number,
              outputTokens: t.outputTokens as number,
              cacheReadTokens: (t.cacheReadTokens as number) || 0,
              cacheCreationTokens: (t.cacheCreationTokens as number) || 0,
              thinkingTokens: (t.thinkingTokens as number) || 0,
              toolCount: (t.toolCount as number) || 0,
              toolNames: (t.toolNames as string[]) || [],
              latencyMs: (t.latencyMs as number) || 0,
              costUsd: (t.costUsd as number) || 0,
              model: (t.model as string) || 'claude-sonnet-4-5',
              compactionBefore: (t.compactionBefore as boolean) || false,
            })),
          );
        }
      })
      .catch(() => setSessionSpecificTurns([]));
  }, [workshopCtx.sessionId]);

  // Resolve "auto" to the most recent session
  const resolvedSession = useMemo(() => {
    if (workshopCtx.sessionId === '') return null; // explicitly "none"
    if (workshopCtx.sessionId === null) {
      // Auto: pick most recent session
      return sessions.length > 0
        ? sessions.reduce((a, b) => (a.endTime > b.endTime ? a : b))
        : null;
    }
    return sessions.find((s) => s.id === workshopCtx.sessionId) ?? null;
  }, [workshopCtx.sessionId, sessions]);

  const sessionTurns = useMemo(() => {
    if (!resolvedSession) return [];
    // Prefer session-specific turns if fetched, otherwise fall back to global turns
    const source = sessionSpecificTurns.length > 0 ? sessionSpecificTurns : turns;
    return source
      .filter((t) => t.sessionId === resolvedSession.id)
      .sort((a, b) => a.turnIndex - b.turnIndex);
  }, [resolvedSession, turns, sessionSpecificTurns]);

  const conversationContext = useMemo(() => {
    if (sessionTurns.length === 0) return undefined;

    const lastTurn = sessionTurns[sessionTurns.length - 1];
    const priorTurns = sessionTurns.slice(-3); // last 3 turns as context

    // Detect conversational mode: 2+ of the last 3 turns within 2min AND all short
    const twoMinMs = 2 * 60 * 1000;
    const recentPrior = priorTurns.filter((t) => lastTurn.timestamp - t.timestamp < twoMinMs);
    const isConversationalMode =
      recentPrior.length >= 2 &&
      recentPrior.every((t) => t.promptText.split(/\s+/).filter(Boolean).length < 15);

    // Session goal: first sentence / first 100 chars of first prompt
    const firstTurn = sessionTurns[0];
    const goalText = firstTurn.promptText;
    const end = goalText.search(/[.!?]/);
    const sessionGoal = end > 0 && end < 100 ? goalText.slice(0, end + 1) : goalText.slice(0, 100);

    return {
      recentPrompts: priorTurns.map((t) => t.promptText.slice(0, 500)),
      sessionGoal,
      turnNumber: sessionTurns.length + 1, // next turn
      isConversationalMode,
    };
  }, [sessionTurns]);

  const handleImprove = useCallback(async () => {
    if (!promptText.trim() || isAnalyzing) return;
    setIsAnalyzing(true);
    setError(null);

    try {
      const response = await fetch('/api/analytics/ai-analyze-prompt', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          promptText: promptText.trim(),
          mode: analysisMode,
          skipCache: false,
          ...(modelId && { model: modelId }),
          sessionContext: {
            model: resolvedSession?.model ?? 'unknown',
            toolCount: 0,
            category: 'general',
            cost: 0,
          },
          conversationContext: conversationContext
            ? {
                ...conversationContext,
                sessionGoal: workshopCtx.notes
                  ? `${conversationContext.sessionGoal} | User notes: ${workshopCtx.notes.replace(/[\r\n]/g, ' ').slice(0, 300)}`
                  : conversationContext.sessionGoal,
              }
            : workshopCtx.notes
              ? {
                  recentPrompts: [],
                  sessionGoal: workshopCtx.notes.replace(/[\r\n]/g, ' ').slice(0, 500),
                  turnNumber: 1,
                  isConversationalMode: false,
                }
              : undefined,
        }),
      });
      const data = await response.json();
      if (data.data) {
        const result: WorkshopResult = {
          id: `ws-${Date.now()}`,
          promptText: promptText.trim(),
          mode: analysisMode,
          score: data.data.score,
          explanation: data.data.explanation,
          rewrite: data.data.rewrite,
          estimatedSavings: data.data.estimatedSavings,
          historyComparison: data.data.historyComparison,
          timestamp: Date.now(),
        };
        setCurrentResult(result);
        setHistory((prev) => {
          const next = [result, ...prev].slice(0, MAX_HISTORY);
          return next;
        });
      } else {
        setError(data.meta?.reason ?? 'Analysis failed — is an API key configured?');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Network error');
    } finally {
      setIsAnalyzing(false);
    }
  }, [
    promptText,
    analysisMode,
    isAnalyzing,
    modelId,
    resolvedSession,
    conversationContext,
    workshopCtx.notes,
  ]);

  const handleRegen = useCallback(async () => {
    if (!promptText.trim() || isAnalyzing) return;
    setIsAnalyzing(true);
    setError(null);

    try {
      const response = await fetch('/api/analytics/ai-analyze-prompt', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          promptText: promptText.trim(),
          mode: analysisMode,
          skipCache: true,
          ...(modelId && { model: modelId }),
          sessionContext: {
            model: resolvedSession?.model ?? 'unknown',
            toolCount: 0,
            category: 'general',
            cost: 0,
          },
          conversationContext: conversationContext
            ? {
                ...conversationContext,
                sessionGoal: workshopCtx.notes
                  ? `${conversationContext.sessionGoal} | User notes: ${workshopCtx.notes.replace(/[\r\n]/g, ' ').slice(0, 300)}`
                  : conversationContext.sessionGoal,
              }
            : workshopCtx.notes
              ? {
                  recentPrompts: [],
                  sessionGoal: workshopCtx.notes.replace(/[\r\n]/g, ' ').slice(0, 500),
                  turnNumber: 1,
                  isConversationalMode: false,
                }
              : undefined,
        }),
      });
      const data = await response.json();
      if (data.data) {
        const result: WorkshopResult = {
          id: `ws-${Date.now()}`,
          promptText: promptText.trim(),
          mode: analysisMode,
          score: data.data.score,
          explanation: data.data.explanation,
          rewrite: data.data.rewrite,
          estimatedSavings: data.data.estimatedSavings,
          historyComparison: data.data.historyComparison,
          timestamp: Date.now(),
        };
        setCurrentResult(result);
        setHistory((prev) => {
          const next = [result, ...prev].slice(0, MAX_HISTORY);
          return next;
        });
      } else {
        setError(data.meta?.reason ?? 'Re-analysis failed — is an API key configured?');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Network error');
    } finally {
      setIsAnalyzing(false);
    }
  }, [
    promptText,
    analysisMode,
    isAnalyzing,
    modelId,
    resolvedSession,
    conversationContext,
    workshopCtx.notes,
  ]);

  const handleCopy = useCallback(async (text: string) => {
    const ok = await copyToClipboard(text);
    if (ok) {
      setCopyFeedback(true);
      setTimeout(() => setCopyFeedback(false), 1500);
    }
  }, []);

  const handleSendToClaude = useCallback(async (text: string) => {
    setSendFeedback(null);
    try {
      const response = await fetch('/api/analytics/workshop/send-to-terminal', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
      });
      const data = await response.json();
      if (data.sent && data.clientCount > 0) {
        setSendFeedback('sent');
      } else {
        // Fallback: copy to clipboard
        await copyToClipboard(text);
        setSendFeedback('copied');
      }
    } catch {
      // Network error fallback: copy to clipboard
      await copyToClipboard(text);
      setSendFeedback('copied');
    }
    setTimeout(() => setSendFeedback(null), 2500);
  }, []);

  const handleIterate = useCallback(() => {
    if (currentResult?.rewrite) {
      setPromptText(currentResult.rewrite);
      setCurrentResult(null);
      textareaRef.current?.focus();
    }
  }, [currentResult]);

  const handleRestoreHistory = useCallback((item: WorkshopResult) => {
    setPromptText(item.promptText);
    setCurrentResult(item);
  }, []);

  const handleClearHistory = useCallback(() => {
    setHistory([]);
  }, []);

  const favoriteIds = useMemo(() => new Set(favorites.map((f) => f.id)), [favorites]);

  const handleToggleFavorite = useCallback((item: WorkshopResult) => {
    setFavorites((prev) => {
      if (prev.some((f) => f.id === item.id)) {
        return prev.filter((f) => f.id !== item.id);
      }
      return [item, ...prev].slice(0, MAX_FAVORITES);
    });
  }, []);

  const scoreColor = (score: number) =>
    score >= 8 ? 'text-emerald-400' : score >= 5 ? 'text-yellow-400' : 'text-red-400';

  const scoreLabel = (score: number, mode: AnalysisMode) => {
    if (mode === 'vibe') {
      if (score >= 9) return 'Nailed it!';
      if (score >= 7) return 'Pretty good';
      if (score >= 5) return 'Getting there';
      return 'Needs work';
    }
    return `${score}/10`;
  };

  const gradientClass =
    analysisMode === 'vibe'
      ? 'from-purple-500/5 to-pink-500/5 border-purple-500/15'
      : 'from-blue-500/5 to-purple-500/5 border-blue-500/15';

  return (
    <div className="max-w-[1400px] mx-auto p-4 space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-sm font-medium text-gray-200">Prompt Workshop</h2>
          <p className="text-xs text-gray-500 mt-0.5">
            {analysisMode === 'vibe'
              ? 'Write what you want, get a clearer version to use'
              : 'Draft a prompt, get AI-powered improvements, then send to Claude'}
          </p>
        </div>
        <button
          onClick={() => setShowHistory(!showHistory)}
          className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg transition-colors ${
            showHistory
              ? 'bg-blue-500/10 border border-blue-500/20 text-blue-400'
              : 'bg-[#161b22] border border-gray-700 text-gray-400 hover:text-gray-200 hover:border-gray-600'
          }`}
        >
          <ClockIcon />
          History ({favorites.length + history.filter((h) => !favoriteIds.has(h.id)).length})
        </button>
      </div>

      <div className="flex gap-4">
        {/* Main column */}
        <div className="flex-1 min-w-0 space-y-4">
          {/* Textarea input */}
          <div className="bg-[#161b22] border border-gray-800 rounded-xl p-4">
            <textarea
              ref={textareaRef}
              value={promptText}
              onChange={(e) => setPromptText(e.target.value)}
              placeholder={
                analysisMode === 'vibe'
                  ? 'Type what you want Claude to do... e.g. "make the sidebar wider and add a dark theme toggle"'
                  : 'Enter your prompt for improvement... e.g. "Add authentication to the Express API with JWT tokens and refresh flow"'
              }
              className="w-full h-32 bg-[#0d1117] border border-gray-800 rounded-lg p-3 text-sm text-gray-200 placeholder-gray-600 resize-y focus:border-blue-500/50 focus:outline-none transition-colors"
              onKeyDown={(e) => {
                if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                  e.preventDefault();
                  handleImprove();
                }
              }}
            />
            <div className="flex items-center justify-between mt-2">
              <span className="text-xs text-gray-600">
                {promptText.length} chars
                {promptText.length > 0 && ' | Ctrl+Enter to improve'}
              </span>
              <div className="flex items-center gap-2">
                <button
                  onClick={handleImprove}
                  disabled={!promptText.trim() || isAnalyzing}
                  className="flex items-center gap-1.5 px-4 py-1.5 text-xs font-medium rounded-lg transition-all disabled:opacity-40 disabled:cursor-not-allowed bg-blue-500/10 border border-blue-500/20 text-blue-400 hover:bg-blue-500/20 hover:border-blue-500/30"
                >
                  <SparkleIcon />
                  {isAnalyzing ? 'Improving...' : 'Improve'}
                </button>
                {currentResult && (
                  <button
                    onClick={handleRegen}
                    disabled={!promptText.trim() || isAnalyzing}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg transition-all disabled:opacity-40 disabled:cursor-not-allowed bg-amber-500/10 border border-amber-500/20 text-amber-400 hover:bg-amber-500/20 hover:border-amber-500/30"
                    title="Re-analyze the same prompt (skip cache)"
                  >
                    <RegenIcon />
                    Regen
                  </button>
                )}
              </div>
            </div>

            {/* ─── Context panel ─── */}
            <div className="mt-3 border-t border-gray-800/50 pt-2">
              {/* Collapsed status line — always visible */}
              <button
                onClick={() => setWorkshopCtx((prev) => ({ ...prev, panelOpen: !prev.panelOpen }))}
                className="flex items-center gap-1.5 w-full text-left group"
              >
                <ChevronIcon open={workshopCtx.panelOpen} />
                <span className="text-xs text-gray-500 group-hover:text-gray-300 transition-colors">
                  Context
                </span>
                <span className="text-xs text-gray-600 truncate">
                  {resolvedSession ? (
                    <>
                      &middot; {workshopCtx.sessionId === null ? 'auto' : 'linked'} &middot;{' '}
                      {resolvedSession.name} ({sessionTurns.length} turns)
                    </>
                  ) : workshopCtx.notes ? (
                    <>&middot; custom notes</>
                  ) : (
                    <>&middot; none</>
                  )}
                </span>
              </button>

              {/* Expanded panel */}
              {workshopCtx.panelOpen && (
                <div className="mt-2 space-y-3 bg-[#0d1117]/50 border border-gray-800/50 rounded-lg p-3">
                  {/* Session picker */}
                  <div>
                    <label className="text-[11px] font-medium text-gray-500 uppercase tracking-wider mb-1 block">
                      Session
                    </label>
                    <select
                      value={workshopCtx.sessionId ?? 'auto'}
                      onChange={(e) => {
                        const val = e.target.value;
                        setWorkshopCtx((prev) => ({
                          ...prev,
                          sessionId: val === 'auto' ? null : val === 'none' ? '' : val,
                        }));
                      }}
                      className="w-full bg-[#161b22] border border-gray-700 rounded-md px-2.5 py-1.5 text-xs text-gray-300 focus:border-blue-500/50 focus:outline-none"
                    >
                      <option value="auto">Auto (most recent)</option>
                      <option value="none">None</option>
                      {sessions.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.name} — {s.promptCount} prompts &middot; ${s.totalCost.toFixed(2)}
                        </option>
                      ))}
                    </select>
                  </div>

                  {/* Prior turns preview — only if session is linked */}
                  {sessionTurns.length > 0 && (
                    <div>
                      <span className="text-[11px] font-medium text-gray-500 uppercase tracking-wider mb-1 block">
                        Recent turns ({sessionTurns.length} total)
                      </span>
                      <div className="space-y-1 max-h-24 overflow-y-auto">
                        {sessionTurns.slice(-3).map((t, i) => (
                          <div key={i} className="flex items-start gap-2 text-[11px]">
                            <span className="text-gray-600 flex-shrink-0 font-mono">
                              {t.turnIndex + 1}.
                            </span>
                            <span className="text-gray-400 truncate">
                              {t.promptText.slice(0, 120)}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Additional notes */}
                  <div>
                    <label className="text-[11px] font-medium text-gray-500 uppercase tracking-wider mb-1 block">
                      Additional context (optional)
                    </label>
                    <textarea
                      value={workshopCtx.notes}
                      onChange={(e) =>
                        setWorkshopCtx((prev) => ({ ...prev, notes: e.target.value }))
                      }
                      placeholder="e.g. Working on the dashboard header, fixing a CSS z-index issue..."
                      className="w-full h-16 max-h-32 bg-[#161b22] border border-gray-700 rounded-md px-2.5 py-1.5 text-xs text-gray-300 placeholder-gray-600 resize-y focus:border-blue-500/50 focus:outline-none"
                    />
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Error display */}
          {error && (
            <div className="bg-red-500/10 border border-red-500/20 rounded-xl p-3 text-xs text-red-400">
              {error}
            </div>
          )}

          {/* Loading skeleton */}
          {isAnalyzing && !currentResult && (
            <div
              className={`bg-gradient-to-r ${gradientClass} border rounded-xl p-4 space-y-3 animate-pulse`}
            >
              <div className="flex items-center justify-between">
                <div className="h-3 bg-gray-700/50 rounded w-24" />
                <div className="h-4 bg-gray-700/50 rounded w-12" />
              </div>
              <div className="space-y-1.5">
                <div className="h-3 bg-gray-700/50 rounded w-3/4" />
                <div className="h-3 bg-gray-700/50 rounded w-1/2" />
              </div>
              <div className="h-20 bg-gray-800/30 rounded-lg" />
            </div>
          )}

          {/* Result display */}
          {currentResult && (
            <div className={`bg-gradient-to-r ${gradientClass} border rounded-xl p-4 space-y-3`}>
              {/* Score + header */}
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-medium uppercase tracking-wider text-gray-500">
                    {analysisMode === 'vibe' ? 'Prompt Coach' : 'AI Analysis'}
                  </span>
                  <span className="px-1.5 py-0.5 text-[10px] font-medium bg-blue-500/10 text-blue-400 rounded">
                    AI
                  </span>
                </div>
                <span className={`text-sm font-semibold ${scoreColor(currentResult.score)}`}>
                  {scoreLabel(currentResult.score, currentResult.mode)}
                </span>
              </div>

              {/* Explanation */}
              <div className="text-sm text-gray-300 leading-relaxed">
                {formatRewrite(currentResult.explanation)}
              </div>

              {/* Rewrite */}
              {currentResult.rewrite && (
                <div className="pt-2 border-t border-gray-800/50">
                  <div className="text-xs text-gray-500 mb-1.5 font-medium">
                    {analysisMode === 'vibe' ? 'Try saying it like this' : 'Improved Prompt'}
                  </div>
                  <div className="relative bg-[#0d1117] border border-gray-800 rounded-lg p-3 pr-12 text-sm text-gray-300 leading-relaxed">
                    {formatRewrite(currentResult.rewrite)}

                    {/* Action buttons */}
                    <div className="absolute top-1.5 right-1.5 flex flex-col gap-1">
                      {/* Copy */}
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleCopy(currentResult.rewrite);
                        }}
                        className="p-1.5 rounded-md bg-gray-800 hover:bg-gray-700 text-gray-400 hover:text-gray-200 transition-colors"
                        title="Copy to clipboard"
                      >
                        {copyFeedback ? (
                          <span className="text-emerald-400 text-[10px] font-medium">OK</span>
                        ) : (
                          <CopyIcon />
                        )}
                      </button>

                      {/* Send to Claude */}
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleSendToClaude(currentResult.rewrite);
                        }}
                        className="p-1.5 rounded-md bg-gray-800 hover:bg-gray-700 text-gray-400 hover:text-gray-200 transition-colors"
                        title="Send to Claude terminal"
                      >
                        {sendFeedback === 'sent' ? (
                          <span className="text-emerald-400 text-[10px] font-medium">Sent</span>
                        ) : sendFeedback === 'copied' ? (
                          <span className="text-yellow-400 text-[10px] font-medium">Clip</span>
                        ) : (
                          <TerminalIcon />
                        )}
                      </button>

                      {/* Iterate */}
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleIterate();
                        }}
                        className="p-1.5 rounded-md bg-gray-800 hover:bg-gray-700 text-gray-400 hover:text-gray-200 transition-colors"
                        title="Edit and re-analyze"
                      >
                        <PencilIcon />
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {/* Savings & comparison row */}
              {(currentResult.estimatedSavings || currentResult.historyComparison) && (
                <div className="pt-2 border-t border-gray-800/50 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px]">
                  {currentResult.estimatedSavings && (
                    <span className="text-emerald-400/80">
                      Potential savings: {currentResult.estimatedSavings}
                    </span>
                  )}
                  {currentResult.historyComparison && (
                    <span className="text-gray-500">
                      vs. typical: {currentResult.historyComparison}
                    </span>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Send feedback toast */}
          {sendFeedback === 'copied' && (
            <div className="bg-yellow-500/10 border border-yellow-500/20 rounded-xl p-3 text-xs text-yellow-400">
              No VS Code extension connected — prompt copied to clipboard instead. Paste it into
              your Claude session.
            </div>
          )}
        </div>

        {/* History sidebar */}
        {showHistory && (
          <div className="w-72 flex-shrink-0 bg-[#161b22] border border-gray-800 rounded-xl p-3 space-y-2 max-h-[600px] overflow-y-auto">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-medium text-gray-400">Recent Workshops</span>
              {history.length > 0 && (
                <button
                  onClick={handleClearHistory}
                  className="text-[10px] text-gray-600 hover:text-gray-400 transition-colors"
                >
                  Clear
                </button>
              )}
            </div>
            {history.length === 0 && favorites.length === 0 && (
              <p className="text-xs text-gray-600 text-center py-4">No history yet</p>
            )}

            {/* Favorites section */}
            {favorites.length > 0 && (
              <>
                <div className="text-[10px] font-medium text-amber-400/70 uppercase tracking-wider mb-1">
                  Favorites ({favorites.length})
                </div>
                {favorites.map((item) => (
                  <div key={`fav-${item.id}`} className="relative group">
                    <button
                      onClick={() => handleRestoreHistory(item)}
                      className={`w-full text-left p-2 rounded-lg transition-colors ${
                        currentResult?.id === item.id
                          ? 'bg-blue-500/10 border border-blue-500/20'
                          : 'hover:bg-[#0d1117]/50 border border-transparent'
                      }`}
                    >
                      <div className="text-xs text-gray-300 truncate pr-5">{item.promptText}</div>
                      <div className="flex items-center gap-2 mt-1">
                        <span className={`text-[10px] font-medium ${scoreColor(item.score)}`}>
                          {item.score}/10
                        </span>
                        <span className="text-[10px] text-gray-600">
                          {item.mode === 'vibe' ? 'Vibe' : 'Dev'}
                        </span>
                        <span className="text-[10px] text-gray-600 ml-auto">
                          {formatTimestamp(item.timestamp)}
                        </span>
                      </div>
                    </button>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleToggleFavorite(item);
                      }}
                      className="absolute top-2 right-2 text-amber-400 hover:text-amber-300 transition-colors"
                      title="Remove from favorites"
                    >
                      <StarIcon filled />
                    </button>
                  </div>
                ))}
                {history.filter((h) => !favoriteIds.has(h.id)).length > 0 && (
                  <div className="border-t border-gray-800/50 my-2" />
                )}
              </>
            )}

            {/* Regular history (excluding favorites) */}
            {history
              .filter((h) => !favoriteIds.has(h.id))
              .map((item) => (
                <div key={item.id} className="relative group">
                  <button
                    onClick={() => handleRestoreHistory(item)}
                    className={`w-full text-left p-2 rounded-lg transition-colors ${
                      currentResult?.id === item.id
                        ? 'bg-blue-500/10 border border-blue-500/20'
                        : 'hover:bg-[#0d1117]/50 border border-transparent'
                    }`}
                  >
                    <div className="text-xs text-gray-300 truncate pr-5">{item.promptText}</div>
                    <div className="flex items-center gap-2 mt-1">
                      <span className={`text-[10px] font-medium ${scoreColor(item.score)}`}>
                        {item.score}/10
                      </span>
                      <span className="text-[10px] text-gray-600">
                        {item.mode === 'vibe' ? 'Vibe' : 'Dev'}
                      </span>
                      <span className="text-[10px] text-gray-600 ml-auto">
                        {formatTimestamp(item.timestamp)}
                      </span>
                    </div>
                  </button>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      handleToggleFavorite(item);
                    }}
                    className="absolute top-2 right-2 text-gray-600 opacity-0 group-hover:opacity-100 hover:text-amber-400 transition-all"
                    title="Add to favorites"
                  >
                    <StarIcon filled={false} />
                  </button>
                </div>
              ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Helpers ─────────────────────────────────────────────────────────

function formatTimestamp(ts: number): string {
  const diff = Date.now() - ts;
  if (diff < 60_000) return 'just now';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}
