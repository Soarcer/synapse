import { useState, useMemo } from 'react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
  Cell,
} from 'recharts';
import type { MockSession } from '../mockData';

interface WhatIfCalculatorProps {
  sessions: MockSession[];
}

// Model pricing for what-if calculations
const MODEL_OPTIONS = [
  { id: 'claude-opus-4-6', name: 'Claude Opus 4.6', inputPer1M: 15, cachedPer1M: 1.5, outputPer1M: 75, quality: 1.0 },
  { id: 'claude-sonnet-4-5', name: 'Claude Sonnet 4.5', inputPer1M: 3, cachedPer1M: 0.3, outputPer1M: 15, quality: 0.85 },
  { id: 'claude-haiku-4-5', name: 'Claude Haiku 4.5', inputPer1M: 0.8, cachedPer1M: 0.08, outputPer1M: 4, quality: 0.7 },
  { id: 'gpt-4o', name: 'GPT-4o', inputPer1M: 2.5, cachedPer1M: 1.25, outputPer1M: 10, quality: 0.82 },
  { id: 'gpt-4o-mini', name: 'GPT-4o Mini', inputPer1M: 0.15, cachedPer1M: 0.075, outputPer1M: 0.6, quality: 0.65 },
  { id: 'gemini-2.5-pro', name: 'Gemini 2.5 Pro', inputPer1M: 1.25, cachedPer1M: 0.3125, outputPer1M: 10, quality: 0.83 },
  { id: 'gemini-2.5-flash', name: 'Gemini 2.5 Flash', inputPer1M: 0.15, cachedPer1M: 0.0375, outputPer1M: 0.6, quality: 0.68 },
  { id: 'o3-mini', name: 'O3 Mini', inputPer1M: 1.1, cachedPer1M: 0.55, outputPer1M: 4.4, quality: 0.78 },
];

function computeCost(model: typeof MODEL_OPTIONS[0], inputTokens: number, outputTokens: number, cacheReadTokens: number): number {
  const freshInput = Math.max(0, inputTokens - cacheReadTokens);
  return (
    (freshInput / 1_000_000) * model.inputPer1M +
    (cacheReadTokens / 1_000_000) * model.cachedPer1M +
    (outputTokens / 1_000_000) * model.outputPer1M
  );
}

export function WhatIfCalculator({ sessions }: WhatIfCalculatorProps) {
  const [targetModelId, setTargetModelId] = useState('claude-haiku-4-5');
  const [qualityFactor, setQualityFactor] = useState(1.0);

  const targetModel = MODEL_OPTIONS.find((m) => m.id === targetModelId) || MODEL_OPTIONS[2];

  const comparison = useMemo(() => {
    const currentCost = sessions.reduce((sum, s) => sum + s.totalCost, 0);

    // Calculate what the cost would be with the target model
    // Quality factor adjusts token usage (lower quality = more tokens needed)
    const adjustedSessions = sessions.map((s) => {
      const tokenMultiplier = qualityFactor < 1 ? 1 + (1 - qualityFactor) * 0.5 : 1;
      const adjustedInput = Math.round(s.totalInputTokens * tokenMultiplier);
      const adjustedOutput = Math.round(s.totalOutputTokens * tokenMultiplier);
      const adjustedCache = Math.round(s.totalCacheReadTokens * tokenMultiplier);
      const newCost = computeCost(targetModel, adjustedInput, adjustedOutput, adjustedCache);
      return {
        name: s.name || s.id.slice(0, 8),
        currentCost: s.totalCost,
        newCost,
        savings: s.totalCost - newCost,
      };
    });

    const newTotalCost = adjustedSessions.reduce((sum, s) => sum + s.newCost, 0);
    const totalSavings = currentCost - newTotalCost;
    const savingsPercent = currentCost > 0 ? (totalSavings / currentCost) * 100 : 0;

    return {
      currentCost,
      newTotalCost,
      totalSavings,
      savingsPercent,
      perSession: adjustedSessions,
    };
  }, [sessions, targetModel, qualityFactor]);

  const chartData = comparison.perSession.slice(0, 15).map((s) => ({
    name: s.name.length > 12 ? s.name.slice(0, 12) + '...' : s.name,
    Current: Math.round(s.currentCost * 100) / 100,
    'What-If': Math.round(s.newCost * 100) / 100,
  }));

  return (
    <div className="max-w-[1400px] mx-auto p-4 space-y-4">
      {/* Controls */}
      <div className="bg-[#161b22] border border-gray-800 rounded-xl p-4">
        <h3 className="text-sm font-semibold text-gray-200 mb-3">What-If Model Comparison</h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div>
            <label className="text-xs text-gray-400 mb-1 block">Target Model</label>
            <select
              value={targetModelId}
              onChange={(e) => setTargetModelId(e.target.value)}
              className="w-full bg-[#0d1117] border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-200 focus:outline-none focus:border-blue-500"
            >
              {MODEL_OPTIONS.map((m) => (
                <option key={m.id} value={m.id}>{m.name} — ${m.inputPer1M}/${m.outputPer1M} per 1M</option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-xs text-gray-400 mb-1 block">Quality Factor: {Math.round(qualityFactor * 100)}%</label>
            <input
              type="range"
              min={0.5}
              max={1.5}
              step={0.05}
              value={qualityFactor}
              onChange={(e) => setQualityFactor(parseFloat(e.target.value))}
              className="w-full accent-blue-500"
            />
            <div className="flex justify-between text-[10px] text-gray-600 mt-1">
              <span>More tokens needed</span>
              <span>Same</span>
              <span>Fewer tokens</span>
            </div>
          </div>
          <div className="flex items-center justify-center">
            <div className={`text-center p-3 rounded-lg border ${comparison.totalSavings >= 0 ? 'bg-emerald-500/10 border-emerald-500/20' : 'bg-red-500/10 border-red-500/20'}`}>
              <div className={`text-2xl font-bold ${comparison.totalSavings >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                {comparison.totalSavings >= 0 ? '-' : '+'}${Math.abs(comparison.totalSavings).toFixed(2)}
              </div>
              <div className="text-[10px] text-gray-400 mt-1">
                {Math.abs(comparison.savingsPercent).toFixed(1)}% {comparison.totalSavings >= 0 ? 'savings' : 'increase'}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-3 gap-4">
        <div className="bg-[#161b22] border border-gray-800 rounded-xl p-4">
          <div className="text-[10px] text-gray-500 uppercase tracking-wider">Current Spend</div>
          <div className="text-xl font-bold text-gray-100 mt-1">${comparison.currentCost.toFixed(2)}</div>
        </div>
        <div className="bg-[#161b22] border border-gray-800 rounded-xl p-4">
          <div className="text-[10px] text-gray-500 uppercase tracking-wider">With {targetModel.name}</div>
          <div className="text-xl font-bold text-blue-400 mt-1">${comparison.newTotalCost.toFixed(2)}</div>
        </div>
        <div className="bg-[#161b22] border border-gray-800 rounded-xl p-4">
          <div className="text-[10px] text-gray-500 uppercase tracking-wider">Quality Estimate</div>
          <div className="text-xl font-bold text-amber-400 mt-1">{Math.round(targetModel.quality * qualityFactor * 100)}%</div>
        </div>
      </div>

      {/* Comparison Chart */}
      <div className="bg-[#161b22] border border-gray-800 rounded-xl p-4">
        <h4 className="text-xs font-medium text-gray-400 mb-3">Cost per Session — Current vs What-If</h4>
        <ResponsiveContainer width="100%" height={300}>
          <BarChart data={chartData} barGap={2}>
            <CartesianGrid strokeDasharray="3 3" stroke="#21262d" />
            <XAxis dataKey="name" tick={{ fill: '#8b949e', fontSize: 10 }} />
            <YAxis tick={{ fill: '#8b949e', fontSize: 10 }} tickFormatter={(v: number = 0) => `$${v.toFixed(2)}`} />
            <Tooltip
              contentStyle={{ backgroundColor: '#161b22', border: '1px solid #30363d', borderRadius: '8px', fontSize: '11px' }}
              formatter={(v: number = 0) => [`$${v.toFixed(4)}`, undefined]}
            />
            <Legend wrapperStyle={{ fontSize: '11px' }} />
            <Bar dataKey="Current" fill="#6366f1" radius={[4, 4, 0, 0]} />
            <Bar dataKey="What-If" fill="#22d3ee" radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
