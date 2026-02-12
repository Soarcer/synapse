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

export function PromptAnalyzer({ data }: PromptAnalyzerProps) {
  const [sortField, setSortField] = useState<'complexity' | 'cost' | 'tokens'>('cost');
  const [sortAsc, setSortAsc] = useState(false);

  const analyses = useMemo(() => {
    return data.turns.map((t) => ({
      ...t,
      category: classifyPrompt(t.promptText),
      complexity: computeComplexity(t.promptText, t.outputTokens, t.toolCount),
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
              {sorted.slice(0, 50).map((a, i) => (
                <tr key={i} className="border-b border-gray-800/50 hover:bg-[#0d1117]/50">
                  <td className="p-3 text-gray-600">{a.turnIndex + 1}</td>
                  <td className="p-3 text-gray-300 max-w-[300px] truncate">{a.promptText || '—'}</td>
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
                  <td className="p-3 text-gray-500">{a.toolNames.join(', ') || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
