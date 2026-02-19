import { useState, useMemo, useRef, useCallback, useEffect } from 'react';
import {
  ScatterChart, Scatter, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ZAxis,
  PieChart, Pie, Cell,
} from 'recharts';
import { TokenBreakdownBar } from '../shared/TokenBreakdownBar';
import { ToolBadges } from '../shared/ToolBadges';
import { ModelBadge } from '../shared/ModelBadge';
import { InfoTooltip } from '../shared/InfoTooltip';
import { TOOL_COLORS, CATEGORY_COLORS, fmtTokens } from '../shared/constants';
import { classifyPrompt, computeComplexity, type PromptCategory } from '../shared/promptUtils';
import { formatInline, formatRewrite } from '../shared/formatMarkdown';
import type { MockData } from '../mockData';

const AI_ANALYSIS_STORAGE_KEY = 'synapse-ai-analyses';
const AI_MODE_STORAGE_KEY = 'synapse-ai-analysis-mode';

export type AnalysisMode = 'developer' | 'vibe';

export function loadAnalysisMode(): AnalysisMode {
  try {
    const raw = localStorage.getItem(AI_MODE_STORAGE_KEY);
    return raw === 'vibe' ? 'vibe' : 'developer';
  } catch { return 'developer'; }
}

interface AiAnalysisResult {
  score: number; explanation: string; rewrite: string; estimatedSavings: string; historyComparison: string;
}

/** Stable key for a prompt analysis — includes mode so dev/vibe get separate cache entries */
function promptKey(sessionId: string, promptText: string, mode: AnalysisMode): string {
  return `${mode}::${sessionId}::${promptText.slice(0, 120)}`;
}

function loadStoredAnalyses(): Record<string, AiAnalysisResult> {
  try {
    const raw = localStorage.getItem(AI_ANALYSIS_STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch { return {}; }
}

function saveStoredAnalyses(analyses: Record<string, AiAnalysisResult>): void {
  try { localStorage.setItem(AI_ANALYSIS_STORAGE_KEY, JSON.stringify(analyses)); }
  catch { /* quota exceeded — silently skip */ }
}

interface PromptAnalyzerProps {
  data: MockData;
  analysisMode: AnalysisMode;
}

type Category = PromptCategory;

export function PromptAnalyzer({ data, analysisMode }: PromptAnalyzerProps) {
  const [sortField, setSortField] = useState<'complexity' | 'cost' | 'tokens' | 'time'>('cost');
  const [sortAsc, setSortAsc] = useState(false);
  const [expandedRow, setExpandedRow] = useState<number | null>(null);
  const [selectedScatterIdx, setSelectedScatterIdx] = useState<number | null>(null);
  const [aiAnalysis, setAiAnalysis] = useState<Record<string, AiAnalysisResult>>(loadStoredAnalyses);
  const [aiAnalyzing, setAiAnalyzing] = useState<Record<string, boolean>>({});
  const [selectedSession, setSelectedSession] = useState<string | undefined>();
  const [aiSummary, setAiSummary] = useState<string | null>(null);
  const [aiSummaryLoading, setAiSummaryLoading] = useState(false);
  const tableRef = useRef<HTMLTableSectionElement>(null);

  // Persist AI analyses to localStorage whenever they change
  useEffect(() => {
    saveStoredAnalyses(aiAnalysis);
  }, [aiAnalysis]);

  // Fetch AI session summary when session changes
  useEffect(() => {
    if (!selectedSession) { setAiSummary(null); return; }
    setAiSummaryLoading(true);
    setAiSummary(null);
    const now = Date.now();
    fetch(`/api/analytics/ai-summary?from=${now - 30 * 86_400_000}&to=${now}`)
      .then((r) => r.json())
      .then((d) => { if (d.data?.summary) setAiSummary(d.data.summary); })
      .catch(() => {})
      .finally(() => setAiSummaryLoading(false));
  }, [selectedSession]);

  const analyzeWithAi = useCallback((
    key: string, promptText: string, model: string, toolCount: number,
    category: string, cost: number, turnIndex: number, sessionId: string,
    timestamp: number, skipCache = false,
  ) => {
    // Build conversation context from neighboring turns
    const sessionTurns = data.turns
      .filter((t) => t.sessionId === sessionId)
      .sort((a, b) => a.turnIndex - b.turnIndex);

    const priorTurns = sessionTurns
      .filter((t) => t.turnIndex < turnIndex)
      .slice(-3);

    // Detect conversational mode: 2+ turns within 2min AND avg words < 15
    const twoMinMs = 2 * 60 * 1000;
    const recentInWindow = sessionTurns.filter(
      (t) => t.turnIndex <= turnIndex && timestamp - t.timestamp < twoMinMs,
    );
    const isConversationalMode = recentInWindow.length >= 2 &&
      priorTurns.length > 0 &&
      priorTurns.every((t) => t.promptText.split(/\s+/).filter(Boolean).length < 15);

    // Session goal: first sentence / first 100 chars of the first prompt
    const firstTurn = sessionTurns[0];
    const sessionGoal = firstTurn
      ? (() => {
          const text = firstTurn.promptText;
          const end = text.search(/[.!?]/);
          return end > 0 && end < 100 ? text.slice(0, end + 1) : text.slice(0, 100);
        })()
      : '';

    const conversationContext = priorTurns.length > 0
      ? {
          recentPrompts: priorTurns.map((t) => t.promptText.slice(0, 500)),
          sessionGoal,
          turnNumber: turnIndex + 1,
          isConversationalMode,
        }
      : undefined;

    console.log('[PromptAnalyzer] analyzeWithAi called', { key, skipCache, mode: analysisMode });
    setAiAnalyzing((prev) => ({ ...prev, [key]: true }));
    fetch('/api/analytics/ai-analyze-prompt', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        promptText, mode: analysisMode, skipCache,
        sessionContext: { model, toolCount, category, cost },
        conversationContext,
      }),
    })
      .then((r) => {
        console.log('[PromptAnalyzer] fetch response', r.status);
        return r.json();
      })
      .then((d) => {
        console.log('[PromptAnalyzer] response data', d);
        if (d.data) setAiAnalysis((prev) => ({ ...prev, [key]: d.data }));
      })
      .catch((err) => console.error('[PromptAnalyzer] fetch error', err))
      .finally(() => setAiAnalyzing((prev) => ({ ...prev, [key]: false })));
  }, [analysisMode, data.turns]);

  const analyses = useMemo(() => {
    const filteredTurns = selectedSession
      ? data.turns.filter((t) => t.sessionId === selectedSession)
      : data.turns;

    // Group turns by sessionId + promptText to aggregate work from one user prompt
    const grouped = new Map<string, {
      promptText: string;
      sessionId: string;
      costUsd: number;
      inputTokens: number;
      outputTokens: number;
      cacheReadTokens: number;
      thinkingTokens: number;
      toolCount: number;
      toolNames: string[];
      latencyMs: number;
      model: string;
      turnIndex: number;
      timestamp: number;
      turnCount: number;
    }>();

    for (const t of filteredTurns) {
      if (t.promptText.trim().length === 0) continue;
      const key = `${t.sessionId}::${t.promptText}`;
      const existing = grouped.get(key);
      if (existing) {
        existing.costUsd += t.costUsd;
        existing.inputTokens += t.inputTokens;
        existing.outputTokens += t.outputTokens;
        existing.cacheReadTokens += t.cacheReadTokens;
        existing.thinkingTokens += t.thinkingTokens;
        existing.toolCount += t.toolCount;
        existing.latencyMs += t.latencyMs;
        existing.turnCount += 1;
        // Merge tool names (deduplicate)
        for (const name of t.toolNames) {
          if (!existing.toolNames.includes(name)) existing.toolNames.push(name);
        }
      } else {
        grouped.set(key, {
          promptText: t.promptText,
          sessionId: t.sessionId,
          costUsd: t.costUsd,
          inputTokens: t.inputTokens,
          outputTokens: t.outputTokens,
          cacheReadTokens: t.cacheReadTokens,
          thinkingTokens: t.thinkingTokens,
          toolCount: t.toolCount,
          toolNames: [...t.toolNames],
          latencyMs: t.latencyMs,
          model: t.model,
          turnIndex: t.turnIndex,
          timestamp: t.timestamp,
          turnCount: 1,
        });
      }
    }

    return [...grouped.values()].map((g) => ({
      ...g,
      category: classifyPrompt(g.promptText),
      complexity: computeComplexity(g.promptText, g.outputTokens, g.toolCount),
    }));
  }, [data.turns, selectedSession]);

  const sorted = useMemo(() => {
    const arr = [...analyses];
    arr.sort((a, b) => {
      let cmp = 0;
      if (sortField === 'complexity') cmp = a.complexity - b.complexity;
      else if (sortField === 'cost') cmp = a.costUsd - b.costUsd;
      else if (sortField === 'time') cmp = a.turnIndex - b.turnIndex;
      else cmp = (a.inputTokens + a.outputTokens) - (b.inputTokens + b.outputTokens);
      return sortAsc ? cmp : -cmp;
    });
    return arr;
  }, [analyses, sortField, sortAsc]);

  // Scatter plot data: complexity vs cost
  const scatterData = useMemo(() => {
    return analyses.map((a, i) => ({
      complexity: a.complexity,
      cost: a.costUsd,
      tokens: a.inputTokens + a.outputTokens,
      category: a.category,
      fill: CATEGORY_COLORS[a.category],
      idx: i,
    }));
  }, [analyses]);

  // Handle scatter dot click — highlight in table
  const handleScatterClick = useCallback((entry: Record<string, unknown>) => {
    const idx = entry.idx as number;
    // Find this analysis in the sorted array
    const analysis = analyses[idx];
    if (!analysis) return;
    const sortedIdx = sorted.findIndex((s) => s === analysis);
    if (sortedIdx >= 0 && sortedIdx < 50) {
      setSelectedScatterIdx(idx);
      setExpandedRow(sortedIdx);
      // Scroll to the row
      if (tableRef.current) {
        const row = tableRef.current.children[sortedIdx] as HTMLElement | undefined;
        row?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    }
  }, [analyses, sorted]);

  // Category pie
  const categoryData = useMemo(() => {
    const counts = new Map<string, number>();
    for (const a of analyses) {
      counts.set(a.category, (counts.get(a.category) || 0) + 1);
    }
    return [...counts.entries()].map(([name, value]) => ({
      name,
      value,
      fill: CATEGORY_COLORS[name] || CATEGORY_COLORS.other,
    }));
  }, [analyses]);

  const handleSort = (field: typeof sortField) => {
    if (sortField === field) setSortAsc(!sortAsc);
    else { setSortField(field); setSortAsc(false); }
  };

  return (
    <div className="max-w-[1400px] mx-auto p-4 space-y-4">
      {/* Session dropdown + Analysis mode toggle */}
      <div className="flex items-center gap-3">
        <select
          value={selectedSession ?? ''}
          onChange={(e) => {
            setSelectedSession(e.target.value || undefined);
            setExpandedRow(null);
          }}
          className="bg-[#161b22] border border-gray-700 rounded-lg px-3 py-1.5 text-sm text-gray-300 focus:border-blue-500 focus:outline-none min-w-[240px]"
        >
          <option value="">All Sessions ({data.sessions.length})</option>
          {data.sessions.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name} &mdash; ${s.totalCost.toFixed(2)}
            </option>
          ))}
        </select>
        {selectedSession && (
          <button
            onClick={() => { setSelectedSession(undefined); setExpandedRow(null); }}
            className="text-xs text-gray-500 hover:text-gray-300 transition-colors"
          >
            Clear
          </button>
        )}
      </div>

      {/* AI Session Summary banner — only when a session is selected */}
      {selectedSession && (aiSummary || aiSummaryLoading) && (
        <div className="bg-gradient-to-r from-blue-500/5 to-purple-500/5 border border-blue-500/15 rounded-xl p-4">
          <div className="flex items-center gap-2 mb-1.5">
            <span className="text-xs font-medium text-blue-400 uppercase tracking-wider">AI Summary</span>
            <span className="px-1.5 py-0.5 text-[10px] font-medium rounded bg-blue-500/20 text-blue-300">AI</span>
          </div>
          {aiSummaryLoading ? (
            <div className="space-y-1.5 animate-pulse">
              <div className="h-3 bg-gray-700/50 rounded w-3/4" />
              <div className="h-3 bg-gray-700/50 rounded w-1/2" />
            </div>
          ) : (
            <p className="text-sm text-gray-300 leading-relaxed">{aiSummary}</p>
          )}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Scatter: Complexity vs Cost */}
        <div className="bg-[#161b22] border border-gray-800 rounded-xl p-4">
          <h4 className="text-xs font-medium text-gray-400 mb-3">Prompt Complexity vs Cost</h4>
          <ResponsiveContainer width="100%" height={280}>
            <ScatterChart>
              <CartesianGrid strokeDasharray="3 3" stroke="#21262d" />
              <XAxis dataKey="complexity" name="Complexity" tick={{ fill: '#8b949e', fontSize: 10 }} label={{ value: 'Complexity', position: 'bottom', fill: '#6b7280', fontSize: 10 }} />
              <YAxis dataKey="cost" name="Cost" tick={{ fill: '#8b949e', fontSize: 10 }} tickFormatter={(v: number = 0) => `$${v.toFixed(3)}`} />
              <ZAxis dataKey="tokens" range={[20, 200]} />
              <Tooltip
                contentStyle={{ backgroundColor: '#161b22', border: '1px solid #374151', borderRadius: '8px', fontSize: '11px', color: '#e5e7eb' }}
                labelStyle={{ color: '#9ca3af' }}
                formatter={(v: number = 0, name: string = '') => {
                  if (name === 'Cost') return [`$${v.toFixed(4)}`, name];
                  return [v.toLocaleString(), name];
                }}
              />
              <Scatter
                data={scatterData}
                onClick={(data: Record<string, unknown>) => handleScatterClick(data)}
                cursor="pointer"
                activeShape={{ r: 8 }}
              />
            </ScatterChart>
          </ResponsiveContainer>
        </div>

        {/* Category Pie */}
        <div className="bg-[#161b22] border border-gray-800 rounded-xl p-4">
          <h4 className="text-xs font-medium text-gray-400 mb-3">Prompt Categories</h4>
          <ResponsiveContainer width="100%" height={280}>
            <PieChart>
              <Pie
                data={categoryData}
                cx="50%"
                cy="50%"
                outerRadius={100}
                innerRadius={50}
                paddingAngle={2}
                dataKey="value"
                label={({ name = '', percent = 0 }: { name?: string; percent?: number }) => `${name} ${(percent * 100).toFixed(0)}%`}
              >
                {categoryData.map((entry, idx) => (
                  <Cell key={idx} fill={entry.fill} />
                ))}
              </Pie>
              <Tooltip
                contentStyle={{ backgroundColor: '#161b22', border: '1px solid #374151', borderRadius: '8px', fontSize: '11px', color: '#e5e7eb' }}
                labelStyle={{ color: '#9ca3af' }}
              />
            </PieChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Sortable prompt table */}
      <div className="bg-[#161b22] border border-gray-800 rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="sticky top-0 z-10 bg-[#161b22]">
              <tr className="border-b border-gray-800">
                <th className="text-left p-3 text-gray-500 font-medium text-xs">#</th>
                <th className="text-left p-3 text-gray-500 font-medium text-xs cursor-pointer hover:text-gray-300" onClick={() => handleSort('time')}>
                  Time {sortField === 'time' ? (sortAsc ? '↑' : '↓') : ''}
                </th>
                <th className="text-left p-3 text-gray-500 font-medium text-xs">Prompt</th>
                <th className="text-left p-3 text-gray-500 font-medium text-xs">Category</th>
                <th className="text-left p-3 text-gray-500 font-medium text-xs cursor-pointer hover:text-gray-300" onClick={() => handleSort('complexity')}>
                  Complexity<InfoTooltip text="Composite score (0-100) based on prompt length, technical terms, output tokens, and tool count" /> {sortField === 'complexity' ? (sortAsc ? '↑' : '↓') : ''}
                </th>
                <th className="text-left p-3 text-gray-500 font-medium text-xs cursor-pointer hover:text-gray-300" onClick={() => handleSort('cost')}>
                  Cost<InfoTooltip text="Total API cost including input, output, and cached tokens at model-specific rates" /> {sortField === 'cost' ? (sortAsc ? '↑' : '↓') : ''}
                </th>
                <th className="text-left p-3 text-gray-500 font-medium text-xs cursor-pointer hover:text-gray-300" onClick={() => handleSort('tokens')}>
                  Tokens<InfoTooltip text="Sum of input + output tokens. Cache hits reduce effective cost but still count toward total" /> {sortField === 'tokens' ? (sortAsc ? '↑' : '↓') : ''}
                </th>
                <th className="text-left p-3 text-gray-500 font-medium text-xs">Tools</th>
              </tr>
            </thead>
            <tbody ref={tableRef}>
              {sorted.slice(0, 50).map((a, i) => {
                const isExpanded = expandedRow === i;
                const pk = promptKey(a.sessionId, a.promptText, analysisMode);
                const cacheRate = (a.inputTokens + a.cacheReadTokens) > 0
                  ? (a.cacheReadTokens / (a.inputTokens + a.cacheReadTokens)) * 100
                  : 0;
                const totalTokens = a.inputTokens + a.outputTokens + a.cacheReadTokens;
                const wordCount = a.promptText.split(/\s+/).filter(Boolean).length;

                return (
                  <tr
                    key={i}
                    className={`border-b border-gray-800/50 cursor-pointer transition-colors ${isExpanded ? 'bg-[#0d1117]/70' : 'hover:bg-[#0d1117]/50'}`}
                    onClick={() => { if (!isExpanded) setExpandedRow(i); }}
                  >
                    <td className="p-3 align-top text-gray-600">
                      {i + 1}
                      {a.turnCount > 1 && (
                        <div className="text-[11px] text-gray-600 mt-0.5">{a.turnCount} turns</div>
                      )}
                    </td>
                    {!isExpanded && (
                      <td className="p-3 align-top text-gray-500 whitespace-nowrap text-xs">
                        {new Date(a.timestamp).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                      </td>
                    )}
                    <td className="p-3 align-top" colSpan={isExpanded ? 7 : 1}>
                      {/* Prompt text — truncated or full, highlighted when expanded */}
                      <div className={isExpanded
                        ? 'bg-blue-500/10 border border-blue-500/30 rounded-lg px-3 py-2 -mx-1 text-gray-100 font-medium'
                        : 'max-w-[300px] truncate text-gray-300'
                      }>
                        {isExpanded && <div className="text-[10px] uppercase tracking-wider text-blue-400/70 mb-1 font-semibold">Prompt</div>}
                        {a.promptText || '\u2014'}
                      </div>

                      {/* Expanded detail panel */}
                      {isExpanded && (
                        <div className="mt-3 space-y-3">
                          {/* Stat cards row */}
                          <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-2">
                            <div className="bg-[#161b22] border border-gray-800 rounded-lg px-3 py-2">
                              <div className="text-xs text-gray-500">Cost</div>
                              <div className="text-base font-semibold text-amber-400">${a.costUsd.toFixed(4)}</div>
                            </div>
                            <div className="bg-[#161b22] border border-gray-800 rounded-lg px-3 py-2">
                              <div className="text-xs text-gray-500">Total Tokens</div>
                              <div className="text-base font-semibold text-gray-200">{fmtTokens(totalTokens)}</div>
                            </div>
                            <div className="bg-[#161b22] border border-gray-800 rounded-lg px-3 py-2">
                              <div className="text-xs text-gray-500">Cache Hit</div>
                              <div className={`text-base font-semibold ${cacheRate > 50 ? 'text-emerald-400' : cacheRate > 20 ? 'text-yellow-400' : 'text-red-400'}`}>
                                {cacheRate.toFixed(1)}%
                              </div>
                            </div>
                            <div className="bg-[#161b22] border border-gray-800 rounded-lg px-3 py-2">
                              <div className="text-xs text-gray-500">Latency</div>
                              <div className="text-base font-semibold text-gray-200">
                                {a.latencyMs < 1000 ? `${Math.round(a.latencyMs)}ms` : `${(a.latencyMs / 1000).toFixed(1)}s`}
                              </div>
                            </div>
                            <div className="bg-[#161b22] border border-gray-800 rounded-lg px-3 py-2">
                              <div className="text-xs text-gray-500">Complexity</div>
                              <div className="text-base font-semibold" style={{ color: a.complexity > 70 ? '#ef4444' : a.complexity > 40 ? '#eab308' : '#22c55e' }}>
                                {a.complexity}/100
                              </div>
                            </div>
                            <div className="bg-[#161b22] border border-gray-800 rounded-lg px-3 py-2">
                              <div className="text-xs text-gray-500">Turns</div>
                              <div className="text-base font-semibold text-gray-200">{a.turnCount}</div>
                            </div>
                          </div>

                          {/* Token breakdown bar */}
                          <div className="bg-[#161b22] border border-gray-800 rounded-lg px-3 py-2">
                            <TokenBreakdownBar
                              cacheReadTokens={a.cacheReadTokens}
                              inputTokens={a.inputTokens}
                              outputTokens={a.outputTokens}
                              thinkingTokens={a.thinkingTokens}
                            />
                          </div>

                          {/* Tools + Model row */}
                          <div className="flex items-start gap-3 flex-wrap">
                            {a.toolNames.length > 0 && (
                              <div className="bg-[#161b22] border border-gray-800 rounded-lg px-3 py-2 flex-1 min-w-[200px]">
                                <ToolBadges toolNames={a.toolNames} label={`Tools Used (${a.toolCount})`} />
                              </div>
                            )}

                            <div className="bg-[#161b22] border border-gray-800 rounded-lg px-3 py-2">
                              <div className="text-xs text-gray-500 mb-1.5">Model</div>
                              <ModelBadge model={a.model} />
                            </div>

                            <div className="bg-[#161b22] border border-gray-800 rounded-lg px-3 py-2">
                              <div className="text-xs text-gray-500 mb-1.5">Category</div>
                              <span
                                className="px-2 py-0.5 rounded-full text-xs font-medium"
                                style={{ backgroundColor: `${CATEGORY_COLORS[a.category]}20`, color: CATEGORY_COLORS[a.category] }}
                              >
                                {a.category}
                              </span>
                            </div>
                          </div>

                          {/* AI Analysis Section */}
                          {aiAnalysis[pk] ? (
                            <div className={`mt-3 relative bg-gradient-to-r ${
                              analysisMode === 'vibe'
                                ? 'from-purple-500/5 to-pink-500/5 border-purple-500/15'
                                : 'from-blue-500/5 to-purple-500/5 border-blue-500/15'
                            } border rounded-xl p-4 space-y-3 ${aiAnalyzing[pk] ? 'opacity-40 pointer-events-none' : ''}`}>
                              {aiAnalyzing[pk] && (
                                <div className="absolute inset-0 flex items-center justify-center z-10">
                                  <div className={`text-xs font-medium ${analysisMode === 'vibe' ? 'text-purple-400' : 'text-blue-400'}`}>Re-analyzing...</div>
                                </div>
                              )}
                              {/* Header row */}
                              <div className="flex items-center gap-2">
                                <span className={`text-xs font-medium uppercase tracking-wider ${
                                  analysisMode === 'vibe' ? 'text-purple-400' : 'text-blue-400'
                                }`}>
                                  {analysisMode === 'vibe' ? 'Prompt Coach' : 'AI Analysis'}
                                </span>
                                <span className={`px-1.5 py-0.5 text-[10px] font-medium rounded ${
                                  analysisMode === 'vibe'
                                    ? 'bg-purple-500/20 text-purple-300'
                                    : 'bg-blue-500/20 text-blue-300'
                                }`}>
                                  {analysisMode === 'vibe' ? 'Vibe' : 'AI'}
                                </span>
                                <button
                                  title="Re-analyze with AI"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    analyzeWithAi(pk, a.promptText, a.model, a.toolCount, a.category, a.costUsd, a.turnIndex, a.sessionId, a.timestamp, true);
                                  }}
                                  disabled={aiAnalyzing[pk]}
                                  className={`ml-1 p-1 rounded transition-colors disabled:opacity-40 ${
                                    analysisMode === 'vibe'
                                      ? 'text-purple-400/60 hover:text-purple-300 hover:bg-purple-500/10'
                                      : 'text-blue-400/60 hover:text-blue-300 hover:bg-blue-500/10'
                                  }`}
                                >
                                  <svg className={`w-3.5 h-3.5 ${aiAnalyzing[pk] ? 'animate-spin' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                                  </svg>
                                </button>
                                <span className={`ml-auto text-sm font-semibold ${
                                  aiAnalysis[pk].score >= 8 ? 'text-emerald-400' : aiAnalysis[pk].score >= 5 ? 'text-yellow-400' : 'text-red-400'
                                }`}>
                                  {analysisMode === 'vibe'
                                    ? (aiAnalysis[pk].score >= 8 ? 'Great!' : aiAnalysis[pk].score >= 5 ? 'Decent' : 'Needs work')
                                    : `Score: ${aiAnalysis[pk].score}/10`
                                  }
                                  {' '}{aiAnalysis[pk].score}/10
                                </span>
                              </div>

                              {/* Explanation — formatted with inline markdown */}
                              <div className="text-sm text-gray-300 leading-relaxed">
                                {formatRewrite(aiAnalysis[pk].explanation)}
                              </div>

                              {/* Suggested rewrite */}
                              {aiAnalysis[pk].rewrite && (
                                <div className="pt-2 border-t border-gray-800/50">
                                  <div className="text-xs text-gray-500 mb-1.5 font-medium">
                                    {analysisMode === 'vibe' ? 'Try saying it like this' : 'Suggested Rewrite'}
                                  </div>
                                  <div className="relative bg-[#0d1117] border border-gray-800 rounded-lg p-3 pr-10 text-sm text-gray-300 leading-relaxed">
                                    {formatRewrite(aiAnalysis[pk].rewrite)}
                                    <button
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        navigator.clipboard.writeText(aiAnalysis[pk].rewrite);
                                        const btn = e.currentTarget;
                                        const orig = btn.innerHTML;
                                        btn.innerHTML = '<span class="text-emerald-400">Copied!</span>';
                                        setTimeout(() => { btn.innerHTML = orig; }, 1500);
                                      }}
                                      className="absolute top-1.5 right-1.5 p-1.5 rounded-md bg-gray-800 hover:bg-gray-700 text-gray-400 hover:text-gray-200 transition-colors"
                                      title="Copy rewrite to clipboard"
                                    >
                                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                        <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                                        <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                                      </svg>
                                    </button>
                                  </div>
                                </div>
                              )}

                              {/* Savings & comparison — separated with divider */}
                              {(aiAnalysis[pk].estimatedSavings || aiAnalysis[pk].historyComparison) && (
                                <div className="pt-2 border-t border-gray-800/50 flex items-center gap-4">
                                  {aiAnalysis[pk].estimatedSavings && (
                                    <div className="flex items-center gap-1.5 text-xs">
                                      <span className="text-gray-500">
                                        {analysisMode === 'vibe' ? 'Could save' : 'Savings'}
                                      </span>
                                      <span className="text-emerald-400 font-medium">{aiAnalysis[pk].estimatedSavings}</span>
                                    </div>
                                  )}
                                  {aiAnalysis[pk].estimatedSavings && aiAnalysis[pk].historyComparison && (
                                    <span className="text-gray-700">|</span>
                                  )}
                                  {aiAnalysis[pk].historyComparison && (
                                    <div className="flex items-center gap-1.5 text-xs">
                                      <span className="text-gray-500">
                                        {analysisMode === 'vibe' ? 'vs. usual' : 'Comparison'}
                                      </span>
                                      <span className="text-gray-300">{aiAnalysis[pk].historyComparison}</span>
                                    </div>
                                  )}
                                </div>
                              )}
                            </div>
                          ) : (
                            <button
                              onClick={(e) => { e.stopPropagation(); analyzeWithAi(pk, a.promptText, a.model, a.toolCount, a.category, a.costUsd, a.turnIndex, a.sessionId, a.timestamp); }}
                              disabled={aiAnalyzing[pk]}
                              className={`mt-3 px-3 py-1.5 text-xs font-medium rounded-lg transition-colors disabled:opacity-50 ${
                                analysisMode === 'vibe'
                                  ? 'bg-purple-500/10 border border-purple-500/20 text-purple-400 hover:bg-purple-500/20'
                                  : 'bg-blue-500/10 border border-blue-500/20 text-blue-400 hover:bg-blue-500/20'
                              }`}
                            >
                              {aiAnalyzing[pk]
                                ? 'Analyzing...'
                                : analysisMode === 'vibe' ? 'Get prompt tips' : 'Analyze with AI'
                              }
                            </button>
                          )}
                        </div>
                      )}
                    </td>
                    {/* Only render remaining cells when collapsed */}
                    {!isExpanded && (
                      <>
                        <td className="p-3">
                          <span
                            className="px-2 py-0.5 rounded-full text-xs font-medium"
                            style={{ backgroundColor: `${CATEGORY_COLORS[a.category]}20`, color: CATEGORY_COLORS[a.category] }}
                          >
                            {a.category}
                          </span>
                        </td>
                        <td className="p-3">
                          <div className="flex items-center gap-2">
                            <div className="w-16 h-1.5 bg-gray-800 rounded-full overflow-hidden">
                              <div className="h-full rounded-full" style={{ width: `${a.complexity}%`, backgroundColor: a.complexity > 70 ? '#ef4444' : a.complexity > 40 ? '#eab308' : '#22c55e' }} />
                            </div>
                            <span className="text-gray-400">{a.complexity}</span>
                          </div>
                        </td>
                        <td className="p-3 text-gray-300">${a.costUsd.toFixed(4)}</td>
                        <td className="p-3 text-gray-400">{(a.inputTokens + a.outputTokens).toLocaleString()}</td>
                        <td className="p-3 text-gray-500">{a.toolNames.join(', ') || '\u2014'}</td>
                      </>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
