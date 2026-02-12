import { useMemo } from 'react';
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  BarChart, Bar, Cell, PieChart, Pie,
} from 'recharts';
import type { MockData } from '../mockData';

interface TokenVelocityViewProps {
  data: MockData;
}

interface VelocityMetrics {
  tokensPerMinute: number;
  costPerMinute: number;
  contextUtilization: number;
  efficiencyScore: number;
  cacheHitRate: number;
}

function computeVelocity(data: MockData): VelocityMetrics {
  if (data.sessions.length === 0) {
    return { tokensPerMinute: 0, costPerMinute: 0, contextUtilization: 0, efficiencyScore: 0, cacheHitRate: 0 };
  }

  const totalTokens = data.sessions.reduce((s, sess) => s + sess.totalInputTokens + sess.totalOutputTokens, 0);
  const totalCost = data.sessions.reduce((s, sess) => s + sess.totalCost, 0);
  const totalCacheRead = data.sessions.reduce((s, sess) => s + sess.totalCacheReadTokens, 0);
  const totalInput = data.sessions.reduce((s, sess) => s + sess.totalInputTokens, 0);

  // Total active minutes
  const totalMinutes = data.sessions.reduce((s, sess) => s + (sess.endTime - sess.startTime) / 60_000, 0);
  const activeMinutes = Math.max(1, totalMinutes);

  const cacheHitRate = totalInput > 0 ? totalCacheRead / totalInput : 0;
  const tokensPerDollar = totalCost > 0 ? totalTokens / totalCost : 0;
  const normalizedTpd = Math.min(1, tokensPerDollar / 500_000);

  // Max context usage
  const maxContext = data.turns.reduce((max, t) => Math.max(max, t.inputTokens), 0);
  const contextUtilization = Math.min(1, maxContext / 200_000);

  const efficiencyScore = Math.round(cacheHitRate * 40 + normalizedTpd * 35 + (1 - contextUtilization) * 25);

  return {
    tokensPerMinute: Math.round(totalTokens / activeMinutes),
    costPerMinute: Math.round((totalCost / activeMinutes) * 10000) / 10000,
    contextUtilization: Math.round(contextUtilization * 100) / 100,
    efficiencyScore: Math.min(100, Math.max(0, efficiencyScore)),
    cacheHitRate: Math.round(cacheHitRate * 100) / 100,
  };
}

// Gauge component
function GaugeChart({ value, max, label, color }: { value: number; max: number; label: string; color: string }) {
  const pct = Math.min(100, (value / max) * 100);
  return (
    <div className="flex flex-col items-center">
      <div className="relative w-32 h-16 overflow-hidden">
        <svg viewBox="0 0 100 50" className="w-full h-full">
          <path d="M 5 50 A 45 45 0 0 1 95 50" fill="none" stroke="#21262d" strokeWidth="8" strokeLinecap="round" />
          <path
            d="M 5 50 A 45 45 0 0 1 95 50"
            fill="none"
            stroke={color}
            strokeWidth="8"
            strokeLinecap="round"
            strokeDasharray={`${pct * 1.41} 141`}
          />
        </svg>
        <div className="absolute inset-0 flex items-end justify-center pb-0.5">
          <span className="text-lg font-bold text-gray-100">{value.toLocaleString()}</span>
        </div>
      </div>
      <span className="text-[10px] text-gray-500 mt-1">{label}</span>
    </div>
  );
}

export function TokenVelocityView({ data }: TokenVelocityViewProps) {
  const velocity = useMemo(() => computeVelocity(data), [data]);

  // Per-turn velocity sparkline
  const turnVelocities = useMemo(() => {
    if (data.turns.length === 0) return [];
    return data.turns.map((t, i) => {
      const prevTs = i > 0 ? data.turns[i - 1].timestamp : t.timestamp;
      const deltaMin = Math.max(0.01, (t.timestamp - prevTs) / 60_000);
      const tokens = t.inputTokens + t.outputTokens;
      return {
        turn: i,
        tokensPerMin: Math.round(tokens / deltaMin),
        contextSize: t.inputTokens,
        cost: t.costUsd,
      };
    });
  }, [data.turns]);

  // Context utilization distribution
  const contextBuckets = useMemo(() => {
    const buckets = [
      { range: '0-25%', count: 0, fill: '#22c55e' },
      { range: '25-50%', count: 0, fill: '#eab308' },
      { range: '50-75%', count: 0, fill: '#f97316' },
      { range: '75-100%', count: 0, fill: '#ef4444' },
    ];
    for (const t of data.turns) {
      const pct = t.inputTokens / 200_000;
      if (pct < 0.25) buckets[0].count++;
      else if (pct < 0.5) buckets[1].count++;
      else if (pct < 0.75) buckets[2].count++;
      else buckets[3].count++;
    }
    return buckets;
  }, [data.turns]);

  return (
    <div className="max-w-[1400px] mx-auto p-4 space-y-4">
      {/* Velocity Gauges */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        <div className="bg-[#161b22] border border-gray-800 rounded-xl p-4 flex justify-center">
          <GaugeChart value={velocity.tokensPerMinute} max={50000} label="Tokens/min" color="#3b82f6" />
        </div>
        <div className="bg-[#161b22] border border-gray-800 rounded-xl p-4 flex justify-center">
          <GaugeChart value={velocity.efficiencyScore} max={100} label="Efficiency Score" color="#22c55e" />
        </div>
        <div className="bg-[#161b22] border border-gray-800 rounded-xl p-4 flex justify-center">
          <GaugeChart value={Math.round(velocity.cacheHitRate * 100)} max={100} label="Cache Hit %" color="#a855f7" />
        </div>
        <div className="bg-[#161b22] border border-gray-800 rounded-xl p-4 flex justify-center">
          <GaugeChart value={Math.round(velocity.contextUtilization * 100)} max={100} label="Context Usage %" color="#f97316" />
        </div>
        <div className="bg-[#161b22] border border-gray-800 rounded-xl p-4 flex flex-col items-center justify-center">
          <div className="text-xl font-bold text-gray-100">${velocity.costPerMinute.toFixed(4)}</div>
          <div className="text-[10px] text-gray-500 mt-1">Cost/min</div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Velocity Sparkline */}
        <div className="bg-[#161b22] border border-gray-800 rounded-xl p-4">
          <h4 className="text-xs font-medium text-gray-400 mb-3">Token Velocity Over Turns</h4>
          <ResponsiveContainer width="100%" height={200}>
            <AreaChart data={turnVelocities}>
              <CartesianGrid strokeDasharray="3 3" stroke="#21262d" />
              <XAxis dataKey="turn" tick={{ fill: '#8b949e', fontSize: 10 }} />
              <YAxis tick={{ fill: '#8b949e', fontSize: 10 }} tickFormatter={(v: number = 0) => `${(v / 1000).toFixed(0)}k`} />
              <Tooltip
                contentStyle={{ backgroundColor: '#161b22', border: '1px solid #30363d', borderRadius: '8px', fontSize: '11px' }}
                formatter={(v: number = 0) => [`${v.toLocaleString()} tok/min`, undefined]}
              />
              <Area type="monotone" dataKey="tokensPerMin" stroke="#3b82f6" fill="#3b82f6" fillOpacity={0.2} />
            </AreaChart>
          </ResponsiveContainer>
        </div>

        {/* Context Utilization Distribution */}
        <div className="bg-[#161b22] border border-gray-800 rounded-xl p-4">
          <h4 className="text-xs font-medium text-gray-400 mb-3">Context Window Utilization</h4>
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={contextBuckets}>
              <CartesianGrid strokeDasharray="3 3" stroke="#21262d" />
              <XAxis dataKey="range" tick={{ fill: '#8b949e', fontSize: 10 }} />
              <YAxis tick={{ fill: '#8b949e', fontSize: 10 }} />
              <Tooltip
                contentStyle={{ backgroundColor: '#161b22', border: '1px solid #30363d', borderRadius: '8px', fontSize: '11px' }}
              />
              <Bar dataKey="count" radius={[4, 4, 0, 0]}>
                {contextBuckets.map((entry, idx) => (
                  <Cell key={idx} fill={entry.fill} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
}
