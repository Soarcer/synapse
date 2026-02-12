import { useMemo, useState } from 'react';
import {
  AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer,
  BarChart, Bar, Cell, CartesianGrid, LineChart, Line,
  ScatterChart, Scatter, ReferenceLine, ComposedChart,
} from 'recharts';
import { ChartCard } from '../shared/ChartCard';
import type { MockData } from '../mockData';
import { toolBreakdown, modelBreakdown } from '../mockData';

interface Props {
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

const TOOL_COLORS: Record<string, string> = {
  Read: '#3b82f6', Grep: '#8b5cf6', Glob: '#a78bfa', Edit: '#ec4899',
  Write: '#f59e0b', Bash: '#f97316', Task: '#10b981', WebFetch: '#06b6d4',
  WebSearch: '#14b8a6', TodoWrite: '#84cc16', NotebookEdit: '#e879f9',
};

function fmt(n: number): string {
  if (n < 1000) return String(Math.round(n));
  if (n < 1_000_000) return `${(n / 1000).toFixed(1)}k`;
  return `${(n / 1_000_000).toFixed(2)}M`;
}

function fmtUsd(n: number): string {
  return n < 1 ? `$${n.toFixed(3)}` : `$${n.toFixed(2)}`;
}

export function DeepDiveExplorer({ data }: Props) {
  const [selectedModel, setSelectedModel] = useState<string | null>(null);
  const [selectedTool, setSelectedTool] = useState<string | null>(null);

  const filteredTurns = useMemo(() => {
    let turns = data.turns;
    if (selectedModel) turns = turns.filter((t) => t.model === selectedModel);
    return turns;
  }, [data.turns, selectedModel]);

  const filteredToolCalls = useMemo(() => {
    let tcs = data.toolCalls;
    if (selectedTool) tcs = tcs.filter((t) => t.toolName === selectedTool);
    return tcs;
  }, [data.toolCalls, selectedTool]);

  // 1. Cost stacked by model over time
  const costByModelTime = useMemo(() => {
    return data.dailyRollups.map((d) => {
      const row: Record<string, unknown> = { date: d.date.slice(5) };
      for (const [model, stats] of Object.entries(d.models)) {
        row[model] = stats.cost;
      }
      return row;
    });
  }, [data.dailyRollups]);

  const allModels = useMemo(() => {
    const set = new Set<string>();
    for (const d of data.dailyRollups) {
      for (const model of Object.keys(d.models)) set.add(model);
    }
    return [...set];
  }, [data.dailyRollups]);

  // 2. Token breakdown per session (stacked bar)
  const tokenPerSession = useMemo(() => {
    return data.sessions.map((s) => ({
      name: s.name.slice(0, 16),
      input: s.totalInputTokens - s.totalCacheReadTokens,
      cached: s.totalCacheReadTokens,
      output: s.totalOutputTokens,
    }));
  }, [data.sessions]);

  // 3. Latency distribution (histogram)
  const latencyHistogram = useMemo(() => {
    const buckets: { range: string; count: number; min: number }[] = [];
    const ranges = [0, 500, 1000, 1500, 2000, 2500, 3000, 4000, 5000, 8000];
    for (let i = 0; i < ranges.length - 1; i++) {
      const min = ranges[i];
      const max = ranges[i + 1];
      const count = filteredTurns.filter((t) => t.latencyMs >= min && t.latencyMs < max).length;
      buckets.push({ range: `${min / 1000}-${max / 1000}s`, count, min });
    }
    // Overflow bucket
    const overflow = filteredTurns.filter((t) => t.latencyMs >= 8000).length;
    if (overflow > 0) buckets.push({ range: '8s+', count: overflow, min: 8000 });
    return buckets;
  }, [filteredTurns]);

  // Percentile lines
  const sortedLatencies = useMemo(() =>
    [...filteredTurns.map((t) => t.latencyMs)].sort((a, b) => a - b),
    [filteredTurns],
  );
  const p50 = sortedLatencies[Math.floor(sortedLatencies.length * 0.5)] ?? 0;
  const p99 = sortedLatencies[Math.floor(sortedLatencies.length * 0.99)] ?? 0;

  // 4. Tool usage heatmap (tool x hour)
  const toolHeatmapData = useMemo(() => {
    const tools = toolBreakdown(data).slice(0, 8).map((t) => t.name);
    const hours = Array.from({ length: 24 }, (_, i) => i);
    const grid: { tool: string; hour: number; count: number }[] = [];

    for (const tool of tools) {
      for (const hour of hours) {
        const count = data.toolCalls.filter((tc) => {
          const h = new Date(tc.timestamp).getHours();
          return tc.toolName === tool && h === hour;
        }).length;
        grid.push({ tool, hour, count });
      }
    }
    return { tools, hours, grid };
  }, [data]);

  // 5. Cache hit rate over turns
  const cacheRateOverTime = useMemo(() => {
    let cumInput = 0;
    let cumCached = 0;
    return filteredTurns.map((t, i) => {
      cumInput += t.inputTokens;
      cumCached += t.cacheReadTokens;
      return {
        turn: i,
        instantRate: t.inputTokens > 0 ? (t.cacheReadTokens / t.inputTokens) * 100 : 0,
        cumulativeRate: cumInput > 0 ? (cumCached / cumInput) * 100 : 0,
      };
    });
  }, [filteredTurns]);

  // 6. Cost per turn (scatter)
  const costPerTurn = useMemo(() =>
    filteredTurns.map((t, i) => ({
      turn: i,
      cost: t.costUsd,
      tokens: t.inputTokens + t.outputTokens,
      model: t.model,
    })),
    [filteredTurns],
  );

  // Max cell value for heatmap
  const maxHeatCount = useMemo(() =>
    Math.max(1, ...toolHeatmapData.grid.map((c) => c.count)),
    [toolHeatmapData],
  );

  return (
    <div className="space-y-3 p-4 max-w-[1400px] mx-auto">
      {/* Filter bar */}
      <div className="flex items-center gap-4 p-3 bg-[#161b22] rounded-xl border border-gray-800">
        <span className="text-xs text-gray-500 uppercase tracking-wider font-medium">Filters</span>
        <div className="flex items-center gap-1">
          <button
            onClick={() => setSelectedModel(null)}
            className={`px-2.5 py-1 text-xs rounded-md transition-all ${!selectedModel ? 'bg-gray-700 text-gray-100' : 'text-gray-500 hover:text-gray-300'}`}
          >
            All Models
          </button>
          {allModels.map((m) => (
            <button
              key={m}
              onClick={() => setSelectedModel(selectedModel === m ? null : m)}
              className={`px-2.5 py-1 text-xs rounded-md transition-all ${selectedModel === m ? 'text-gray-100' : 'text-gray-500 hover:text-gray-300'}`}
              style={selectedModel === m ? { backgroundColor: `${MODEL_COLORS[m]}30`, color: MODEL_COLORS[m] } : undefined}
            >
              {MODEL_LABELS[m] ?? m}
            </button>
          ))}
        </div>
        <div className="w-px h-5 bg-gray-700" />
        <div className="flex items-center gap-1">
          <button
            onClick={() => setSelectedTool(null)}
            className={`px-2.5 py-1 text-xs rounded-md transition-all ${!selectedTool ? 'bg-gray-700 text-gray-100' : 'text-gray-500 hover:text-gray-300'}`}
          >
            All Tools
          </button>
          {toolBreakdown(data).slice(0, 6).map((t) => (
            <button
              key={t.name}
              onClick={() => setSelectedTool(selectedTool === t.name ? null : t.name)}
              className={`px-2.5 py-1 text-xs rounded-md transition-all ${selectedTool === t.name ? 'text-gray-100' : 'text-gray-500 hover:text-gray-300'}`}
              style={selectedTool === t.name ? { backgroundColor: `${TOOL_COLORS[t.name] ?? '#6b7280'}30`, color: TOOL_COLORS[t.name] ?? '#6b7280' } : undefined}
            >
              {t.name}
            </button>
          ))}
        </div>
      </div>

      {/* Row 1: Cost by model + Token per session */}
      <div className="grid grid-cols-2 gap-3">
        <ChartCard title="Cost by Model" subtitle="Daily breakdown" height={220}>
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={costByModelTime} margin={{ top: 8, right: 12, bottom: 0, left: 8 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#1e2a3a" />
              <XAxis dataKey="date" tick={{ fill: '#6b7280', fontSize: 10 }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fill: '#6b7280', fontSize: 10 }} axisLine={false} tickLine={false} tickFormatter={(v: number) => fmtUsd(v)} />
              <Tooltip
                contentStyle={{ backgroundColor: '#1c2128', border: '1px solid #30363d', borderRadius: 8, fontSize: 11 }}
                formatter={(v: number = 0, name: string = '') => [fmtUsd(v), MODEL_LABELS[name] ?? name]}
                labelStyle={{ color: '#8b949e' }}
              />
              {allModels.map((model) => (
                <Area
                  key={model}
                  type="monotone"
                  dataKey={model}
                  stackId="1"
                  stroke={MODEL_COLORS[model] ?? '#6b7280'}
                  fill={MODEL_COLORS[model] ?? '#6b7280'}
                  fillOpacity={0.3}
                  strokeWidth={1.5}
                  isAnimationActive={false}
                />
              ))}
            </AreaChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard title="Tokens per Session" subtitle="Input (fresh) + Cached + Output" height={220}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={tokenPerSession} margin={{ top: 8, right: 12, bottom: 0, left: 8 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#1e2a3a" />
              <XAxis dataKey="name" tick={{ fill: '#6b7280', fontSize: 9 }} axisLine={false} tickLine={false} angle={-20} />
              <YAxis tick={{ fill: '#6b7280', fontSize: 10 }} axisLine={false} tickLine={false} tickFormatter={(v: number) => fmt(v)} />
              <Tooltip
                contentStyle={{ backgroundColor: '#1c2128', border: '1px solid #30363d', borderRadius: 8, fontSize: 11 }}
                formatter={(v: number = 0) => [fmt(v), '']}
                labelStyle={{ color: '#8b949e' }}
              />
              <Bar dataKey="input" stackId="1" fill="#3b82f6" fillOpacity={0.8} name="Fresh Input" radius={[0, 0, 0, 0]} isAnimationActive={false} />
              <Bar dataKey="cached" stackId="1" fill="#8b5cf6" fillOpacity={0.6} name="Cached" radius={[0, 0, 0, 0]} isAnimationActive={false} />
              <Bar dataKey="output" stackId="1" fill="#10b981" fillOpacity={0.7} name="Output" radius={[4, 4, 0, 0]} isAnimationActive={false} />
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>
      </div>

      {/* Row 2: Latency histogram + Tool heatmap */}
      <div className="grid grid-cols-2 gap-3">
        <ChartCard title="Latency Distribution" subtitle={`P50: ${(p50 / 1000).toFixed(1)}s  |  P99: ${(p99 / 1000).toFixed(1)}s`} height={220}>
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={latencyHistogram} margin={{ top: 8, right: 12, bottom: 0, left: 8 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#1e2a3a" />
              <XAxis dataKey="range" tick={{ fill: '#6b7280', fontSize: 10 }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fill: '#6b7280', fontSize: 10 }} axisLine={false} tickLine={false} />
              <Tooltip
                contentStyle={{ backgroundColor: '#1c2128', border: '1px solid #30363d', borderRadius: 8, fontSize: 11 }}
                labelStyle={{ color: '#8b949e' }}
              />
              <Bar dataKey="count" fill="#06b6d4" fillOpacity={0.7} radius={[4, 4, 0, 0]} name="Turns" isAnimationActive={false}>
                {latencyHistogram.map((entry, i) => (
                  <Cell
                    key={i}
                    fill={entry.min >= p99 ? '#ef4444' : entry.min >= p50 ? '#f59e0b' : '#06b6d4'}
                    fillOpacity={0.7}
                  />
                ))}
              </Bar>
            </ComposedChart>
          </ResponsiveContainer>
        </ChartCard>

        {/* Tool × Hour Heatmap (custom rendered) */}
        <ChartCard title="Tool Activity Heatmap" subtitle="Tool calls by hour of day" height={220}>
          <div className="h-full px-2 pb-1 overflow-hidden">
            <div className="h-full flex flex-col">
              {/* Hour labels */}
              <div className="flex ml-[60px]">
                {[0, 4, 8, 12, 16, 20].map((h) => (
                  <div key={h} className="text-[9px] text-gray-600" style={{ width: `${(4 / 24) * 100}%` }}>
                    {h}:00
                  </div>
                ))}
              </div>
              {/* Rows */}
              <div className="flex-1 flex flex-col gap-0.5">
                {toolHeatmapData.tools.map((tool) => (
                  <div key={tool} className="flex items-center gap-1 flex-1">
                    <div className="w-[56px] text-[10px] text-gray-400 text-right truncate pr-1">{tool}</div>
                    <div className="flex-1 flex gap-px">
                      {toolHeatmapData.hours.map((hour) => {
                        const cell = toolHeatmapData.grid.find((c) => c.tool === tool && c.hour === hour);
                        const intensity = cell ? cell.count / maxHeatCount : 0;
                        const bg = intensity === 0
                          ? '#161b22'
                          : `rgba(59, 130, 246, ${0.15 + intensity * 0.85})`;
                        return (
                          <div
                            key={hour}
                            className="flex-1 rounded-[2px] min-h-[12px]"
                            style={{ backgroundColor: bg }}
                            title={`${tool} @ ${hour}:00 — ${cell?.count ?? 0} calls`}
                          />
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </ChartCard>
      </div>

      {/* Row 3: Cache hit rate + Cost per turn scatter */}
      <div className="grid grid-cols-2 gap-3">
        <ChartCard title="Cache Hit Rate" subtitle="Per-turn (dots) and cumulative (line)" height={220}>
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={cacheRateOverTime} margin={{ top: 8, right: 12, bottom: 0, left: 8 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#1e2a3a" />
              <XAxis dataKey="turn" tick={{ fill: '#6b7280', fontSize: 10 }} axisLine={false} tickLine={false} />
              <YAxis domain={[0, 100]} tick={{ fill: '#6b7280', fontSize: 10 }} axisLine={false} tickLine={false} tickFormatter={(v: number) => `${v}%`} />
              <Tooltip
                contentStyle={{ backgroundColor: '#1c2128', border: '1px solid #30363d', borderRadius: 8, fontSize: 11 }}
                formatter={(v: number = 0, name: string = '') => [`${v.toFixed(1)}%`, name === 'instantRate' ? 'Instant' : 'Cumulative']}
                labelStyle={{ color: '#8b949e' }}
              />
              <Area type="monotone" dataKey="instantRate" stroke="none" fill="#10b981" fillOpacity={0.15} isAnimationActive={false} />
              <Line type="monotone" dataKey="cumulativeRate" stroke="#10b981" strokeWidth={2} dot={false} isAnimationActive={false} />
              <ReferenceLine y={50} stroke="#6b7280" strokeDasharray="4 4" strokeWidth={0.5} />
            </ComposedChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard title="Cost per Turn" subtitle="Each dot = one prompt/response" height={220}>
          <ResponsiveContainer width="100%" height="100%">
            <ScatterChart margin={{ top: 8, right: 12, bottom: 0, left: 8 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#1e2a3a" />
              <XAxis type="number" dataKey="turn" name="Turn" tick={{ fill: '#6b7280', fontSize: 10 }} axisLine={false} tickLine={false} />
              <YAxis type="number" dataKey="cost" name="Cost" tick={{ fill: '#6b7280', fontSize: 10 }} axisLine={false} tickLine={false} tickFormatter={(v: number) => fmtUsd(v)} />
              <Tooltip
                contentStyle={{ backgroundColor: '#1c2128', border: '1px solid #30363d', borderRadius: 8, fontSize: 11 }}
                formatter={(v: number = 0, name: string = '') => [name === 'Cost' ? fmtUsd(v) : fmt(v), name]}
                labelStyle={{ color: '#8b949e' }}
              />
              <Scatter data={costPerTurn} isAnimationActive={false}>
                {costPerTurn.map((entry, i) => (
                  <Cell
                    key={i}
                    fill={MODEL_COLORS[entry.model] ?? '#6b7280'}
                    fillOpacity={0.6}
                    r={3}
                  />
                ))}
              </Scatter>
            </ScatterChart>
          </ResponsiveContainer>
        </ChartCard>
      </div>
    </div>
  );
}
