import { useMemo } from 'react';
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  BarChart, Bar, Cell, ComposedChart,
} from 'recharts';
import type { MockData } from '../mockData';

interface TokenVelocityViewProps {
  data: MockData;
}

const MODEL_COLORS: Record<string, string> = {
  'claude-opus-4-6': '#e8956a',
  'claude-sonnet-4-5': '#3b82f6',
  'claude-haiku-4-5': '#22d3ee',
};

const MODEL_LABELS: Record<string, string> = {
  'claude-opus-4-6': 'Opus',
  'claude-sonnet-4-5': 'Sonnet',
  'claude-haiku-4-5': 'Haiku',
};

function fmtTokens(n: number): string {
  if (n < 1000) return String(Math.round(n));
  if (n < 1_000_000) return `${(n / 1000).toFixed(1)}k`;
  return `${(n / 1_000_000).toFixed(2)}M`;
}

function fmtUsd(n: number): string {
  return n < 0.01 ? '<$0.01' : n < 1 ? `$${n.toFixed(3)}` : `$${n.toFixed(2)}`;
}

function fmtDuration(ms: number): string {
  if (ms < 60_000) return `${(ms / 1000).toFixed(0)}s`;
  if (ms < 3_600_000) return `${Math.round(ms / 60_000)}m`;
  return `${(ms / 3_600_000).toFixed(1)}h`;
}

// ── Computed Metrics ──────────────────────────────────────────────

interface VelocityMetrics {
  totalSessions: number;
  totalTurns: number;
  totalCost: number;
  totalTokens: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCacheReadTokens: number;
  totalDurationMs: number;
  avgTurnsPerSession: number;
  avgCostPerTurn: number;
  avgToolsPerTurn: number;
  outputAmplification: number; // output / fresh_input
  cacheHitRate: number;
  cacheSavingsUsd: number;
  costPerKToken: number;
}

function computeMetrics(data: MockData): VelocityMetrics {
  const totalSessions = data.sessions.length;
  const totalTurns = data.turns.length;
  const totalCost = data.sessions.reduce((s, sess) => s + sess.totalCost, 0);
  const totalInputTokens = data.sessions.reduce((s, sess) => s + sess.totalInputTokens, 0);
  const totalOutputTokens = data.sessions.reduce((s, sess) => s + sess.totalOutputTokens, 0);
  const totalCacheReadTokens = data.sessions.reduce((s, sess) => s + sess.totalCacheReadTokens, 0);
  const totalTokens = totalInputTokens + totalOutputTokens;
  const totalDurationMs = data.sessions.reduce((s, sess) => s + (sess.endTime - sess.startTime), 0);
  const totalTools = data.turns.reduce((s, t) => s + t.toolCount, 0);

  const freshInput = totalInputTokens - totalCacheReadTokens;
  const cacheHitRate = totalInputTokens > 0 ? totalCacheReadTokens / totalInputTokens : 0;

  // Estimate savings: cached tokens cost ~10x less than fresh tokens
  // Savings = cacheRead * (full_price - cached_price) / 1M
  // Approximate with average pricing: $3/M input, $0.30/M cached
  const cacheSavingsUsd = (totalCacheReadTokens / 1_000_000) * (3 - 0.3);

  return {
    totalSessions,
    totalTurns,
    totalCost,
    totalTokens,
    totalInputTokens,
    totalOutputTokens,
    totalCacheReadTokens,
    totalDurationMs,
    avgTurnsPerSession: totalSessions > 0 ? totalTurns / totalSessions : 0,
    avgCostPerTurn: totalTurns > 0 ? totalCost / totalTurns : 0,
    avgToolsPerTurn: totalTurns > 0 ? totalTools / totalTurns : 0,
    outputAmplification: freshInput > 0 ? totalOutputTokens / freshInput : 0,
    cacheHitRate,
    cacheSavingsUsd,
    costPerKToken: totalTokens > 0 ? (totalCost / totalTokens) * 1000 : 0,
  };
}

// ── Gauge component ──────────────────────────────────────────────

function GaugeChart({ value, max, label, color, format }: { value: number; max: number; label: string; color: string; format?: (v: number) => string }) {
  const pct = Math.min(100, (value / max) * 100);
  const display = format ? format(value) : value.toLocaleString();
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
          <span className="text-lg font-bold text-gray-100">{display}</span>
        </div>
      </div>
      <span className="text-[10px] text-gray-500 mt-1">{label}</span>
    </div>
  );
}

// ── Stat card ────────────────────────────────────────────────────

function StatCard({ label, value, sub, color }: { label: string; value: string; sub?: string; color?: string }) {
  return (
    <div className="bg-[#161b22] border border-gray-800 rounded-xl p-4">
      <div className="text-[10px] text-gray-500 uppercase tracking-wider mb-1">{label}</div>
      <div className="text-xl font-bold" style={{ color: color ?? '#e5e7eb' }}>{value}</div>
      {sub && <div className="text-[10px] text-gray-600 mt-0.5">{sub}</div>}
    </div>
  );
}

export function TokenVelocityView({ data }: TokenVelocityViewProps) {
  const metrics = useMemo(() => computeMetrics(data), [data]);

  // Per-session productivity chart
  const sessionProductivity = useMemo(() => {
    return data.sessions.map((s) => {
      const durationMin = Math.max(1, (s.endTime - s.startTime) / 60_000);
      return {
        name: s.name.length > 14 ? s.name.slice(0, 12) + '..' : s.name,
        turnsPerHour: Math.round((s.promptCount / durationMin) * 60),
        costPerTurn: s.promptCount > 0 ? s.totalCost / s.promptCount : 0,
        toolsPerTurn: s.promptCount > 0 ? s.toolCalls / s.promptCount : 0,
        model: s.model,
        tokens: s.totalInputTokens + s.totalOutputTokens,
        cost: s.totalCost,
      };
    });
  }, [data.sessions]);

  // Per-turn token velocity sparkline
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
        outputRatio: t.inputTokens > 0 ? t.outputTokens / t.inputTokens : 0,
      };
    });
  }, [data.turns]);

  // Cache savings over time (cumulative)
  const cacheSavingsOverTime = useMemo(() => {
    let cumSaved = 0;
    let cumCacheTokens = 0;
    return data.turns.map((t, i) => {
      cumCacheTokens += t.cacheReadTokens;
      // Approximate savings: difference between full price and cached price
      cumSaved += (t.cacheReadTokens / 1_000_000) * (3 - 0.3);
      return {
        turn: i,
        savedUsd: Math.round(cumSaved * 100) / 100,
        cacheTokensK: Math.round(cumCacheTokens / 1000),
      };
    });
  }, [data.turns]);

  // Cost efficiency by model
  const modelEfficiency = useMemo(() => {
    const map = new Map<string, { tokens: number; cost: number; sessions: number; turns: number }>();
    for (const s of data.sessions) {
      const entry = map.get(s.model) ?? { tokens: 0, cost: 0, sessions: 0, turns: 0 };
      entry.tokens += s.totalInputTokens + s.totalOutputTokens;
      entry.cost += s.totalCost;
      entry.sessions++;
      entry.turns += s.promptCount;
      map.set(s.model, entry);
    }
    return [...map.entries()].map(([model, stats]) => ({
      model,
      label: MODEL_LABELS[model] ?? model,
      costPerKToken: stats.tokens > 0 ? (stats.cost / stats.tokens) * 1000 : 0,
      tokensPerDollar: stats.cost > 0 ? Math.round(stats.tokens / stats.cost) : 0,
      avgTurnsPerSession: stats.sessions > 0 ? Math.round(stats.turns / stats.sessions) : 0,
      sessions: stats.sessions,
      fill: MODEL_COLORS[model] ?? '#6b7280',
    }));
  }, [data.sessions]);

  return (
    <div className="max-w-[1400px] mx-auto p-4 space-y-4">
      {/* Top-level KPI gauges */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        <div className="bg-[#161b22] border border-gray-800 rounded-xl p-4 flex justify-center">
          <GaugeChart
            value={Math.round(metrics.cacheHitRate * 100)}
            max={100}
            label="Cache Hit %"
            color="#a855f7"
            format={(v) => `${v}%`}
          />
        </div>
        <div className="bg-[#161b22] border border-gray-800 rounded-xl p-4 flex justify-center">
          <GaugeChart
            value={Math.round(metrics.outputAmplification * 100) / 100}
            max={2}
            label="Output / Fresh Input"
            color="#3b82f6"
            format={(v) => `${v.toFixed(2)}x`}
          />
        </div>
        <div className="bg-[#161b22] border border-gray-800 rounded-xl p-4 flex justify-center">
          <GaugeChart
            value={Math.round(metrics.avgToolsPerTurn * 10) / 10}
            max={10}
            label="Tools / Turn"
            color="#22c55e"
            format={(v) => v.toFixed(1)}
          />
        </div>
        <div className="bg-[#161b22] border border-gray-800 rounded-xl p-4 flex justify-center">
          <GaugeChart
            value={Math.round(metrics.avgTurnsPerSession * 10) / 10}
            max={30}
            label="Turns / Session"
            color="#f97316"
            format={(v) => v.toFixed(1)}
          />
        </div>
        <div className="bg-[#161b22] border border-gray-800 rounded-xl p-4 flex flex-col items-center justify-center">
          <div className="text-xl font-bold text-emerald-400">{fmtUsd(metrics.cacheSavingsUsd)}</div>
          <div className="text-[10px] text-gray-500 mt-1">Cache Savings</div>
        </div>
      </div>

      {/* Summary stats row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard label="Avg Cost / Turn" value={fmtUsd(metrics.avgCostPerTurn)} color="#f59e0b" />
        <StatCard label="Cost / 1K Tokens" value={fmtUsd(metrics.costPerKToken)} sub="Across all models" color="#f59e0b" />
        <StatCard label="Total Duration" value={fmtDuration(metrics.totalDurationMs)} sub={`${metrics.totalSessions} sessions`} />
        <StatCard label="Total Tokens" value={fmtTokens(metrics.totalTokens)} sub={`${fmtTokens(metrics.totalInputTokens)} in / ${fmtTokens(metrics.totalOutputTokens)} out`} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Token velocity over turns */}
        <div className="bg-[#161b22] border border-gray-800 rounded-xl p-4">
          <h4 className="text-xs font-medium text-gray-400 mb-3">Token Velocity Over Turns</h4>
          <ResponsiveContainer width="100%" height={200}>
            <AreaChart data={turnVelocities}>
              <CartesianGrid strokeDasharray="3 3" stroke="#21262d" />
              <XAxis dataKey="turn" tick={{ fill: '#8b949e', fontSize: 10 }} />
              <YAxis tick={{ fill: '#8b949e', fontSize: 10 }} tickFormatter={(v: number) => `${(v / 1000).toFixed(0)}k`} />
              <Tooltip
                contentStyle={{ backgroundColor: '#161b22', border: '1px solid #30363d', borderRadius: '8px', fontSize: '11px' }}
                formatter={(v: number = 0) => [`${v.toLocaleString()} tok/min`, undefined]}
              />
              <Area type="monotone" dataKey="tokensPerMin" stroke="#3b82f6" fill="#3b82f6" fillOpacity={0.2} isAnimationActive={false} />
            </AreaChart>
          </ResponsiveContainer>
        </div>

        {/* Cumulative cache savings */}
        <div className="bg-[#161b22] border border-gray-800 rounded-xl p-4">
          <h4 className="text-xs font-medium text-gray-400 mb-3">Cumulative Cache Savings</h4>
          <ResponsiveContainer width="100%" height={200}>
            <ComposedChart data={cacheSavingsOverTime}>
              <CartesianGrid strokeDasharray="3 3" stroke="#21262d" />
              <XAxis dataKey="turn" tick={{ fill: '#8b949e', fontSize: 10 }} />
              <YAxis yAxisId="usd" tick={{ fill: '#8b949e', fontSize: 10 }} tickFormatter={(v: number) => `$${v}`} />
              <Tooltip
                contentStyle={{ backgroundColor: '#161b22', border: '1px solid #30363d', borderRadius: '8px', fontSize: '11px' }}
                formatter={(v: number = 0, name: string = '') => {
                  if (name === 'savedUsd') return [`$${v.toFixed(2)}`, 'Saved'];
                  return [`${v.toLocaleString()}k`, 'Cache Tokens'];
                }}
              />
              <Area yAxisId="usd" type="monotone" dataKey="savedUsd" stroke="#a855f7" fill="#a855f7" fillOpacity={0.15} isAnimationActive={false} />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Session productivity */}
        <div className="bg-[#161b22] border border-gray-800 rounded-xl p-4">
          <h4 className="text-xs font-medium text-gray-400 mb-3">Cost per Turn by Session</h4>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={sessionProductivity} margin={{ top: 4, right: 12, bottom: 0, left: 4 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#21262d" />
              <XAxis dataKey="name" tick={{ fill: '#8b949e', fontSize: 9 }} angle={-15} />
              <YAxis tick={{ fill: '#8b949e', fontSize: 10 }} tickFormatter={(v: number) => fmtUsd(v)} />
              <Tooltip
                contentStyle={{ backgroundColor: '#161b22', border: '1px solid #30363d', borderRadius: '8px', fontSize: '11px' }}
                formatter={(v: number = 0) => [fmtUsd(v), 'Cost/Turn']}
              />
              <Bar dataKey="costPerTurn" radius={[4, 4, 0, 0]} isAnimationActive={false}>
                {sessionProductivity.map((entry, i) => (
                  <Cell key={i} fill={MODEL_COLORS[entry.model] ?? '#6b7280'} fillOpacity={0.7} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>

        {/* Model efficiency comparison */}
        <div className="bg-[#161b22] border border-gray-800 rounded-xl p-4">
          <h4 className="text-xs font-medium text-gray-400 mb-3">Cost Efficiency by Model</h4>
          <div className="space-y-4 mt-4">
            {modelEfficiency.map((m) => (
              <div key={m.model} className="flex items-center gap-3">
                <div className="w-16 text-right">
                  <span className="text-xs font-medium" style={{ color: m.fill }}>{m.label}</span>
                </div>
                <div className="flex-1">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-[10px] text-gray-500">{m.sessions} sessions, {m.avgTurnsPerSession} turns/sess avg</span>
                    <span className="text-[10px] text-gray-400">{m.tokensPerDollar.toLocaleString()} tok/$</span>
                  </div>
                  <div className="h-2 bg-gray-800 rounded-full overflow-hidden">
                    <div
                      className="h-full rounded-full"
                      style={{
                        width: `${Math.min(100, (m.tokensPerDollar / Math.max(1, ...modelEfficiency.map(e => e.tokensPerDollar))) * 100)}%`,
                        backgroundColor: m.fill,
                        opacity: 0.7,
                      }}
                    />
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
