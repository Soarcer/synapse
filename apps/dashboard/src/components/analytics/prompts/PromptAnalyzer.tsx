import { useState, useMemo } from 'react';
import {
  ScatterChart, Scatter, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ZAxis,
  PieChart, Pie, Cell,
} from 'recharts';
import type { MockData } from '../mockData';

interface PromptAnalyzerProps {
  data: MockData;
}

type Category = 'feature' | 'bugfix' | 'refactor' | 'test' | 'docs' | 'debug' | 'review' | 'config' | 'other';

const CATEGORY_PATTERNS: [Category, RegExp][] = [
  ['feature', /\b(add|create|implement|build|new feature|introduce)\b/i],
  ['bugfix', /\b(fix|bug|broken|issue|error|crash|failing|not working)\b/i],
  ['refactor', /\b(refactor|rename|restructure|clean up|simplify|move|extract)\b/i],
  ['test', /\b(test|spec|coverage|assert|mock|unit test|e2e)\b/i],
  ['docs', /\b(document|readme|comment|jsdoc|docs|explain)\b/i],
  ['debug', /\b(debug|log|trace|inspect|investigate|why)\b/i],
  ['review', /\b(review|check|audit|look at|examine)\b/i],
  ['config', /\b(config|setup|install|deploy|ci|pipeline)\b/i],
];

const CATEGORY_COLORS: Record<string, string> = {
  feature: '#3b82f6', bugfix: '#ef4444', refactor: '#a855f7', test: '#22c55e',
  docs: '#eab308', debug: '#f97316', review: '#06b6d4', config: '#6b7280', other: '#475569',
};

function classifyPrompt(text: string): Category {
  for (const [cat, pattern] of CATEGORY_PATTERNS) {
    if (pattern.test(text)) return cat;
  }
  return 'other';
}

function computeComplexity(text: string, outputTokens: number, toolCount: number): number {
  let score = 0;
  score += Math.min(25, text.split(/\s+/).length / 4);
  const techMatches = (text.match(/\b(function|class|interface|type|module|component|endpoint)\b/gi) || []).length +
    (text.match(/[a-zA-Z]+\.[a-zA-Z]+/g) || []).length +
    (text.match(/`[^`]+`/g) || []).length;
  score += Math.min(25, techMatches * 3);
  score += Math.min(25, outputTokens / 200);
  score += Math.min(25, toolCount * 5);
  return Math.min(100, Math.max(0, Math.round(score)));
}

const TOOL_COLORS: Record<string, string> = {
  Read: '#3b82f6', Write: '#22c55e', Edit: '#a855f7', Bash: '#f97316',
  Grep: '#06b6d4', Glob: '#eab308', Task: '#ef4444', WebFetch: '#ec4899',
  WebSearch: '#8b5cf6', TodoWrite: '#14b8a6', NotebookEdit: '#f43f5e',
};

const MODEL_LABELS: Record<string, string> = {
  'claude-opus-4-6': 'Opus 4.6',
  'claude-sonnet-4-5': 'Sonnet 4.5',
  'claude-sonnet-4-5-20250929': 'Sonnet 4.5',
  'claude-haiku-4-5': 'Haiku 4.5',
  'claude-haiku-4-5-20251001': 'Haiku 4.5',
};

const MODEL_COLORS: Record<string, string> = {
  'claude-opus-4-6': '#e8956a',
  'claude-sonnet-4-5': '#3b82f6',
  'claude-sonnet-4-5-20250929': '#3b82f6',
  'claude-haiku-4-5': '#22d3ee',
  'claude-haiku-4-5-20251001': '#22d3ee',
};

function fmtTokens(n: number): string {
  if (n < 1000) return String(n);
  if (n < 1_000_000) return `${(n / 1000).toFixed(1)}k`;
  return `${(n / 1_000_000).toFixed(2)}M`;
}

export function PromptAnalyzer({ data }: PromptAnalyzerProps) {
  const [sortField, setSortField] = useState<'complexity' | 'cost' | 'tokens'>('cost');
  const [sortAsc, setSortAsc] = useState(false);
  const [expandedRow, setExpandedRow] = useState<number | null>(null);

  const analyses = useMemo(() => {
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
      turnCount: number;
    }>();

    for (const t of data.turns) {
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
          turnCount: 1,
        });
      }
    }

    return [...grouped.values()].map((g) => ({
      ...g,
      category: classifyPrompt(g.promptText),
      complexity: computeComplexity(g.promptText, g.outputTokens, g.toolCount),
    }));
  }, [data.turns]);

  const sorted = useMemo(() => {
    const arr = [...analyses];
    arr.sort((a, b) => {
      let cmp = 0;
      if (sortField === 'complexity') cmp = a.complexity - b.complexity;
      else if (sortField === 'cost') cmp = a.costUsd - b.costUsd;
      else cmp = (a.inputTokens + a.outputTokens) - (b.inputTokens + b.outputTokens);
      return sortAsc ? cmp : -cmp;
    });
    return arr;
  }, [analyses, sortField, sortAsc]);

  // Scatter plot data: complexity vs cost
  const scatterData = useMemo(() => {
    return analyses.map((a) => ({
      complexity: a.complexity,
      cost: a.costUsd,
      tokens: a.inputTokens + a.outputTokens,
      category: a.category,
      fill: CATEGORY_COLORS[a.category],
    }));
  }, [analyses]);

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
                contentStyle={{ backgroundColor: '#161b22', border: '1px solid #30363d', borderRadius: '8px', fontSize: '11px' }}
                formatter={(v: number = 0, name: string = '') => {
                  if (name === 'Cost') return [`$${v.toFixed(4)}`, name];
                  return [v.toLocaleString(), name];
                }}
              />
              <Scatter data={scatterData} />
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
                contentStyle={{ backgroundColor: '#161b22', border: '1px solid #30363d', borderRadius: '8px', fontSize: '11px' }}
              />
            </PieChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Sortable prompt table */}
      <div className="bg-[#161b22] border border-gray-800 rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-gray-800">
                <th className="text-left p-3 text-gray-500 font-medium">#</th>
                <th className="text-left p-3 text-gray-500 font-medium">Prompt</th>
                <th className="text-left p-3 text-gray-500 font-medium">Category</th>
                <th className="text-left p-3 text-gray-500 font-medium cursor-pointer hover:text-gray-300" onClick={() => handleSort('complexity')}>
                  Complexity {sortField === 'complexity' ? (sortAsc ? '↑' : '↓') : ''}
                </th>
                <th className="text-left p-3 text-gray-500 font-medium cursor-pointer hover:text-gray-300" onClick={() => handleSort('cost')}>
                  Cost {sortField === 'cost' ? (sortAsc ? '↑' : '↓') : ''}
                </th>
                <th className="text-left p-3 text-gray-500 font-medium cursor-pointer hover:text-gray-300" onClick={() => handleSort('tokens')}>
                  Tokens {sortField === 'tokens' ? (sortAsc ? '↑' : '↓') : ''}
                </th>
                <th className="text-left p-3 text-gray-500 font-medium">Tools</th>
              </tr>
            </thead>
            <tbody>
              {sorted.slice(0, 50).map((a, i) => {
                const isExpanded = expandedRow === i;
                const cacheRate = (a.inputTokens + a.cacheReadTokens) > 0
                  ? (a.cacheReadTokens / (a.inputTokens + a.cacheReadTokens)) * 100
                  : 0;
                const totalTokens = a.inputTokens + a.outputTokens + a.cacheReadTokens;
                const wordCount = a.promptText.split(/\s+/).filter(Boolean).length;

                return (
                  <tr
                    key={i}
                    className={`border-b border-gray-800/50 cursor-pointer transition-colors ${isExpanded ? 'bg-[#0d1117]/70' : 'hover:bg-[#0d1117]/50'}`}
                    onClick={() => setExpandedRow(isExpanded ? null : i)}
                  >
                    <td className="p-3 align-top text-gray-600">
                      {i + 1}
                      {a.turnCount > 1 && (
                        <div className="text-[9px] text-gray-600 mt-0.5">{a.turnCount} turns</div>
                      )}
                    </td>
                    <td className="p-3 align-top" colSpan={isExpanded ? 6 : 1}>
                      {/* Prompt text — truncated or full */}
                      <p className={`text-gray-300 ${isExpanded ? '' : 'max-w-[300px] truncate'}`}>
                        {a.promptText || '\u2014'}
                      </p>

                      {/* Expanded detail panel */}
                      {isExpanded && (
                        <div className="mt-3 space-y-3">
                          {/* Stat cards row */}
                          <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-2">
                            <div className="bg-[#161b22] border border-gray-800 rounded-lg px-3 py-2">
                              <div className="text-[10px] text-gray-500">Cost</div>
                              <div className="text-sm font-semibold text-amber-400">${a.costUsd.toFixed(4)}</div>
                            </div>
                            <div className="bg-[#161b22] border border-gray-800 rounded-lg px-3 py-2">
                              <div className="text-[10px] text-gray-500">Total Tokens</div>
                              <div className="text-sm font-semibold text-gray-200">{fmtTokens(totalTokens)}</div>
                            </div>
                            <div className="bg-[#161b22] border border-gray-800 rounded-lg px-3 py-2">
                              <div className="text-[10px] text-gray-500">Cache Hit</div>
                              <div className={`text-sm font-semibold ${cacheRate > 50 ? 'text-emerald-400' : cacheRate > 20 ? 'text-yellow-400' : 'text-red-400'}`}>
                                {cacheRate.toFixed(1)}%
                              </div>
                            </div>
                            <div className="bg-[#161b22] border border-gray-800 rounded-lg px-3 py-2">
                              <div className="text-[10px] text-gray-500">Latency</div>
                              <div className="text-sm font-semibold text-gray-200">
                                {a.latencyMs < 1000 ? `${Math.round(a.latencyMs)}ms` : `${(a.latencyMs / 1000).toFixed(1)}s`}
                              </div>
                            </div>
                            <div className="bg-[#161b22] border border-gray-800 rounded-lg px-3 py-2">
                              <div className="text-[10px] text-gray-500">Complexity</div>
                              <div className="text-sm font-semibold" style={{ color: a.complexity > 70 ? '#ef4444' : a.complexity > 40 ? '#eab308' : '#22c55e' }}>
                                {a.complexity}/100
                              </div>
                            </div>
                            <div className="bg-[#161b22] border border-gray-800 rounded-lg px-3 py-2">
                              <div className="text-[10px] text-gray-500">Turns</div>
                              <div className="text-sm font-semibold text-gray-200">{a.turnCount}</div>
                            </div>
                          </div>

                          {/* Token breakdown bar */}
                          <div className="bg-[#161b22] border border-gray-800 rounded-lg px-3 py-2">
                            <div className="text-[10px] text-gray-500 mb-1.5">Token Breakdown</div>
                            <div className="flex h-3 rounded-full overflow-hidden bg-gray-800">
                              {a.cacheReadTokens > 0 && (
                                <div
                                  className="h-full"
                                  style={{ width: `${(a.cacheReadTokens / totalTokens) * 100}%`, backgroundColor: '#8b5cf6' }}
                                  title={`Cached: ${fmtTokens(a.cacheReadTokens)}`}
                                />
                              )}
                              <div
                                className="h-full"
                                style={{ width: `${(a.inputTokens / totalTokens) * 100}%`, backgroundColor: '#3b82f6' }}
                                title={`Input: ${fmtTokens(a.inputTokens)}`}
                              />
                              <div
                                className="h-full"
                                style={{ width: `${(a.outputTokens / totalTokens) * 100}%`, backgroundColor: '#10b981' }}
                                title={`Output: ${fmtTokens(a.outputTokens)}`}
                              />
                            </div>
                            <div className="flex items-center gap-4 mt-1.5">
                              <span className="text-[9px] text-purple-400 flex items-center gap-1">
                                <span className="inline-block w-2 h-2 rounded-sm bg-purple-500" /> cached {fmtTokens(a.cacheReadTokens)}
                              </span>
                              <span className="text-[9px] text-blue-400 flex items-center gap-1">
                                <span className="inline-block w-2 h-2 rounded-sm bg-blue-500" /> input {fmtTokens(a.inputTokens)}
                              </span>
                              <span className="text-[9px] text-emerald-400 flex items-center gap-1">
                                <span className="inline-block w-2 h-2 rounded-sm bg-emerald-500" /> output {fmtTokens(a.outputTokens)}
                              </span>
                              {a.thinkingTokens > 0 && (
                                <span className="text-[9px] text-pink-400 flex items-center gap-1">
                                  <span className="inline-block w-2 h-2 rounded-sm bg-pink-500" /> thinking {fmtTokens(a.thinkingTokens)}
                                </span>
                              )}
                            </div>
                          </div>

                          {/* Tools + Model row */}
                          <div className="flex items-start gap-3 flex-wrap">
                            {/* Tools */}
                            {a.toolNames.length > 0 && (
                              <div className="bg-[#161b22] border border-gray-800 rounded-lg px-3 py-2 flex-1 min-w-[200px]">
                                <div className="text-[10px] text-gray-500 mb-1.5">Tools Used ({a.toolCount})</div>
                                <div className="flex flex-wrap gap-1">
                                  {a.toolNames.map((name, ti) => (
                                    <span
                                      key={ti}
                                      className="px-2 py-0.5 rounded text-[10px] font-medium"
                                      style={{
                                        backgroundColor: `${TOOL_COLORS[name] ?? '#6b7280'}20`,
                                        color: TOOL_COLORS[name] ?? '#6b7280',
                                      }}
                                    >
                                      {name}
                                    </span>
                                  ))}
                                </div>
                              </div>
                            )}

                            {/* Model + Category */}
                            <div className="bg-[#161b22] border border-gray-800 rounded-lg px-3 py-2">
                              <div className="text-[10px] text-gray-500 mb-1.5">Model</div>
                              <span
                                className="px-2 py-0.5 rounded text-[10px] font-medium"
                                style={{
                                  backgroundColor: `${MODEL_COLORS[a.model] ?? '#6b7280'}20`,
                                  color: MODEL_COLORS[a.model] ?? '#6b7280',
                                }}
                              >
                                {MODEL_LABELS[a.model] ?? a.model}
                              </span>
                            </div>

                            <div className="bg-[#161b22] border border-gray-800 rounded-lg px-3 py-2">
                              <div className="text-[10px] text-gray-500 mb-1.5">Category</div>
                              <span
                                className="px-2 py-0.5 rounded-full text-[10px] font-medium"
                                style={{ backgroundColor: `${CATEGORY_COLORS[a.category]}20`, color: CATEGORY_COLORS[a.category] }}
                              >
                                {a.category}
                              </span>
                            </div>
                          </div>
                        </div>
                      )}
                    </td>
                    {/* Only render remaining cells when collapsed */}
                    {!isExpanded && (
                      <>
                        <td className="p-3">
                          <span
                            className="px-2 py-0.5 rounded-full text-[10px] font-medium"
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
