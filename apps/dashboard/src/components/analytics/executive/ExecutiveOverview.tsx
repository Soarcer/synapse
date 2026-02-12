import { useMemo } from 'react';
import {
  AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer,
  BarChart, Bar, PieChart, Pie, Cell, CartesianGrid,
} from 'recharts';
import { KpiCard } from '../shared/KpiCard';
import { ChartCard } from '../shared/ChartCard';
import type { MockData } from '../mockData';
import {
  totalCost, totalTokens, totalToolCalls,
  toolBreakdown, modelBreakdown, latencyPercentiles, avgCacheHitRate,
} from '../mockData';

interface Props {
  data: MockData;
}

const MODEL_COLORS: Record<string, string> = {
  'claude-opus-4-6': '#e8956a',
  'claude-sonnet-4-5': '#3b82f6',
  'claude-haiku-4-5': '#22d3ee',
};

const MODEL_LABELS: Record<string, string> = {
  'claude-opus-4-6': 'Opus 4.6',
  'claude-sonnet-4-5': 'Sonnet 4.5',
  'claude-haiku-4-5': 'Haiku 4.5',
};

const TOOL_COLORS = [
  '#3b82f6', '#8b5cf6', '#ec4899', '#f59e0b', '#10b981',
  '#06b6d4', '#f97316', '#84cc16', '#e879f9', '#6366f1', '#14b8a6',
];

function formatUsd(n: number): string {
  if (n < 0.01) return '<$0.01';
  if (n < 1) return `$${n.toFixed(2)}`;
  if (n < 100) return `$${n.toFixed(2)}`;
  return `$${n.toFixed(0)}`;
}

function formatTokensShort(n: number): string {
  if (n < 1000) return String(n);
  if (n < 1_000_000) return `${(n / 1000).toFixed(1)}k`;
  return `${(n / 1_000_000).toFixed(2)}M`;
}

function formatMs(n: number): string {
  if (n < 1000) return `${Math.round(n)}ms`;
  return `${(n / 1000).toFixed(1)}s`;
}

export function ExecutiveOverview({ data }: Props) {
  const cost = useMemo(() => totalCost(data), [data]);
  const tokens = useMemo(() => totalTokens(data), [data]);
  const tools = useMemo(() => totalToolCalls(data), [data]);
  const toolData = useMemo(() => toolBreakdown(data), [data]);
  const modelData = useMemo(() => modelBreakdown(data), [data]);
  const latency = useMemo(() => latencyPercentiles(data), [data]);
  const cacheRate = useMemo(() => avgCacheHitRate(data), [data]);

  // Cost over time (daily)
  const costTimeSeries = useMemo(() =>
    data.dailyRollups.map((d) => ({
      date: d.date.slice(5), // MM-DD
      inputCost: d.totalInputTokens * 0.000003, // approximate
      outputCost: d.totalOutputTokens * 0.000015,
      totalCost: d.totalCost,
    })),
    [data],
  );

  // Token over time (daily)
  const tokenTimeSeries = useMemo(() =>
    data.dailyRollups.map((d) => ({
      date: d.date.slice(5),
      input: d.totalInputTokens,
      output: d.totalOutputTokens,
      cached: d.totalCacheRead,
    })),
    [data],
  );

  // Sparkline data for KPIs
  const costSpark = useMemo(() => data.dailyRollups.map((d) => d.totalCost), [data]);
  const tokenSpark = useMemo(() => data.dailyRollups.map((d) => d.totalInputTokens + d.totalOutputTokens), [data]);
  const sessionSpark = useMemo(() => data.dailyRollups.map((d) => d.sessions), [data]);
  const toolSpark = useMemo(() => data.dailyRollups.map((d) => d.totalToolCalls), [data]);
  const latencySpark = useMemo(() => data.dailyRollups.map((d) => d.avgLatencyMs), [data]);

  // Compute deltas (last day vs first day)
  const delta = (spark: number[]): number => {
    if (spark.length < 2) return 0;
    const first = spark[0] || 1;
    const last = spark[spark.length - 1];
    return ((last - first) / first) * 100;
  };

  // Tool bar chart data (top 8)
  const toolBarData = useMemo(() =>
    toolData.slice(0, 8).map((t) => ({ name: t.name, count: t.count })),
    [toolData],
  );

  // Model pie data
  const modelPieData = useMemo(() =>
    modelData.map((m) => ({
      name: MODEL_LABELS[m.model] ?? m.model,
      value: m.cost,
      color: MODEL_COLORS[m.model] ?? '#6b7280',
    })),
    [modelData],
  );

  return (
    <div className="space-y-4 p-4 max-w-[1400px] mx-auto">
      {/* KPI Cards Row */}
      <div className="grid grid-cols-5 gap-3">
        <KpiCard
          label="Total Cost"
          value={formatUsd(cost)}
          subtitle={`${data.sessions.length} sessions`}
          delta={delta(costSpark)}
          sparkData={costSpark}
          color="#f59e0b"
          icon="$"
        />
        <KpiCard
          label="Total Tokens"
          value={formatTokensShort(tokens.input + tokens.output)}
          subtitle={`${formatTokensShort(tokens.input)} in / ${formatTokensShort(tokens.output)} out`}
          delta={delta(tokenSpark)}
          sparkData={tokenSpark}
          color="#3b82f6"
        />
        <KpiCard
          label="Sessions"
          value={String(data.sessions.length)}
          subtitle={`Avg ${formatUsd(cost / data.sessions.length)}/session`}
          delta={delta(sessionSpark)}
          sparkData={sessionSpark}
          color="#10b981"
        />
        <KpiCard
          label="Tool Calls"
          value={formatTokensShort(tools)}
          subtitle={`${toolData.length} unique tools`}
          delta={delta(toolSpark)}
          sparkData={toolSpark}
          color="#8b5cf6"
        />
        <KpiCard
          label="Avg Latency"
          value={formatMs(latency.p50)}
          subtitle={`P90: ${formatMs(latency.p90)} / P99: ${formatMs(latency.p99)}`}
          delta={-delta(latencySpark)} // Lower is better, invert
          sparkData={latencySpark}
          color="#06b6d4"
        />
      </div>

      {/* Primary chart: Cost Over Time */}
      <ChartCard title="Cost Over Time" subtitle="Daily spend breakdown" height={280}>
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={costTimeSeries} margin={{ top: 8, right: 12, bottom: 0, left: 8 }}>
            <defs>
              <linearGradient id="costGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#f59e0b" stopOpacity={0.4} />
                <stop offset="100%" stopColor="#f59e0b" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="#1e2a3a" />
            <XAxis dataKey="date" tick={{ fill: '#6b7280', fontSize: 11 }} axisLine={false} tickLine={false} />
            <YAxis
              tick={{ fill: '#6b7280', fontSize: 11 }}
              axisLine={false}
              tickLine={false}
              tickFormatter={(v: number) => `$${v.toFixed(2)}`}
            />
            <Tooltip
              contentStyle={{
                backgroundColor: '#1c2128',
                border: '1px solid #30363d',
                borderRadius: 8,
                fontSize: 12,
              }}
              formatter={(value: number = 0) => [`$${value.toFixed(4)}`, '']}
              labelStyle={{ color: '#8b949e' }}
            />
            <Area
              type="monotone"
              dataKey="totalCost"
              stroke="#f59e0b"
              strokeWidth={2}
              fill="url(#costGrad)"
              isAnimationActive={false}
            />
          </AreaChart>
        </ResponsiveContainer>
      </ChartCard>

      {/* Secondary row: Token Usage, Tool Distribution, Model Mix */}
      <div className="grid grid-cols-3 gap-3">
        {/* Token Usage Over Time */}
        <ChartCard title="Token Usage" subtitle="Input vs Output vs Cached">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={tokenTimeSeries} margin={{ top: 8, right: 12, bottom: 0, left: 8 }}>
              <defs>
                <linearGradient id="inputGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#3b82f6" stopOpacity={0.4} />
                  <stop offset="100%" stopColor="#3b82f6" stopOpacity={0} />
                </linearGradient>
                <linearGradient id="outputGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#10b981" stopOpacity={0.4} />
                  <stop offset="100%" stopColor="#10b981" stopOpacity={0} />
                </linearGradient>
                <linearGradient id="cachedGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#8b5cf6" stopOpacity={0.3} />
                  <stop offset="100%" stopColor="#8b5cf6" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#1e2a3a" />
              <XAxis dataKey="date" tick={{ fill: '#6b7280', fontSize: 10 }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fill: '#6b7280', fontSize: 10 }} axisLine={false} tickLine={false} tickFormatter={(v: number) => formatTokensShort(v)} />
              <Tooltip
                contentStyle={{ backgroundColor: '#1c2128', border: '1px solid #30363d', borderRadius: 8, fontSize: 11 }}
                formatter={(v: number = 0) => [formatTokensShort(v), '']}
                labelStyle={{ color: '#8b949e' }}
              />
              <Area type="monotone" dataKey="input" stackId="1" stroke="#3b82f6" fill="url(#inputGrad)" strokeWidth={1.5} isAnimationActive={false} />
              <Area type="monotone" dataKey="output" stackId="1" stroke="#10b981" fill="url(#outputGrad)" strokeWidth={1.5} isAnimationActive={false} />
              <Area type="monotone" dataKey="cached" stroke="#8b5cf6" fill="url(#cachedGrad)" strokeWidth={1.5} strokeDasharray="4 2" isAnimationActive={false} />
            </AreaChart>
          </ResponsiveContainer>
        </ChartCard>

        {/* Tool Distribution */}
        <ChartCard title="Tool Usage" subtitle="Top tools by call count">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={toolBarData} layout="vertical" margin={{ top: 4, right: 12, bottom: 0, left: 4 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#1e2a3a" horizontal={false} />
              <XAxis type="number" tick={{ fill: '#6b7280', fontSize: 10 }} axisLine={false} tickLine={false} />
              <YAxis
                type="category"
                dataKey="name"
                tick={{ fill: '#9ca3af', fontSize: 11 }}
                axisLine={false}
                tickLine={false}
                width={70}
              />
              <Tooltip
                contentStyle={{ backgroundColor: '#1c2128', border: '1px solid #30363d', borderRadius: 8, fontSize: 11 }}
                labelStyle={{ color: '#8b949e' }}
              />
              <Bar dataKey="count" radius={[0, 4, 4, 0]} isAnimationActive={false}>
                {toolBarData.map((_, i) => (
                  <Cell key={i} fill={TOOL_COLORS[i % TOOL_COLORS.length]} fillOpacity={0.8} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>

        {/* Model Distribution */}
        <ChartCard title="Model Mix" subtitle="Cost by model">
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie
                data={modelPieData}
                cx="50%"
                cy="50%"
                innerRadius={50}
                outerRadius={80}
                paddingAngle={3}
                dataKey="value"
                isAnimationActive={false}
                stroke="none"
              >
                {modelPieData.map((entry, i) => (
                  <Cell key={i} fill={entry.color} />
                ))}
              </Pie>
              <Tooltip
                contentStyle={{ backgroundColor: '#1c2128', border: '1px solid #30363d', borderRadius: 8, fontSize: 11 }}
                formatter={(value: number = 0) => [formatUsd(value), 'Cost']}
              />
            </PieChart>
          </ResponsiveContainer>
          {/* Legend */}
          <div className="flex justify-center gap-4 -mt-2 px-4 pb-2">
            {modelPieData.map((m) => (
              <div key={m.name} className="flex items-center gap-1.5 text-[10px] text-gray-400">
                <div className="w-2 h-2 rounded-full" style={{ backgroundColor: m.color }} />
                {m.name}
              </div>
            ))}
          </div>
        </ChartCard>
      </div>

      {/* Tertiary row: Cache Hit Rate + Session Table */}
      <div className="grid grid-cols-2 gap-3">
        <ChartCard title="Cache Hit Rate" subtitle={`Average: ${(cacheRate * 100).toFixed(1)}%`}>
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart
              data={data.turns.map((t, i) => ({
                idx: i,
                rate: t.inputTokens > 0 ? (t.cacheReadTokens / t.inputTokens) * 100 : 0,
              }))}
              margin={{ top: 8, right: 12, bottom: 0, left: 8 }}
            >
              <defs>
                <linearGradient id="cacheGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#10b981" stopOpacity={0.3} />
                  <stop offset="100%" stopColor="#10b981" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#1e2a3a" />
              <XAxis tick={false} axisLine={false} />
              <YAxis domain={[0, 100]} tick={{ fill: '#6b7280', fontSize: 10 }} axisLine={false} tickLine={false} tickFormatter={(v: number) => `${v}%`} />
              <Tooltip
                contentStyle={{ backgroundColor: '#1c2128', border: '1px solid #30363d', borderRadius: 8, fontSize: 11 }}
                formatter={(v: number = 0) => [`${v.toFixed(1)}%`, 'Cache Hit']}
                labelStyle={{ color: '#8b949e' }}
              />
              <Area type="monotone" dataKey="rate" stroke="#10b981" fill="url(#cacheGrad)" strokeWidth={1.5} isAnimationActive={false} dot={false} />
            </AreaChart>
          </ResponsiveContainer>
        </ChartCard>

        {/* Session Summary Table */}
        <ChartCard title="Sessions" subtitle={`${data.sessions.length} total`} height={240}>
          <div className="overflow-auto h-full px-2">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-gray-500 text-[10px] uppercase">
                  <th className="text-left py-1 font-medium">Session</th>
                  <th className="text-right py-1 font-medium">Model</th>
                  <th className="text-right py-1 font-medium">Cost</th>
                  <th className="text-right py-1 font-medium">Tokens</th>
                  <th className="text-right py-1 font-medium">Tools</th>
                </tr>
              </thead>
              <tbody>
                {data.sessions.slice(-10).reverse().map((s) => (
                  <tr key={s.id} className="border-t border-gray-800/50 hover:bg-gray-800/30">
                    <td className="py-1.5 text-gray-300 truncate max-w-[140px]">{s.name}</td>
                    <td className="py-1.5 text-right">
                      <span
                        className="inline-block px-1.5 py-0.5 rounded text-[10px] font-medium"
                        style={{
                          backgroundColor: `${MODEL_COLORS[s.model] ?? '#6b7280'}20`,
                          color: MODEL_COLORS[s.model] ?? '#6b7280',
                        }}
                      >
                        {MODEL_LABELS[s.model] ?? s.model}
                      </span>
                    </td>
                    <td className="py-1.5 text-right text-gray-300">{formatUsd(s.totalCost)}</td>
                    <td className="py-1.5 text-right text-gray-400">{formatTokensShort(s.totalInputTokens + s.totalOutputTokens)}</td>
                    <td className="py-1.5 text-right text-gray-400">{s.toolCalls}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </ChartCard>
      </div>
    </div>
  );
}
