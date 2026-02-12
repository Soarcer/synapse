import { useMemo, useState } from 'react';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  CartesianGrid, RadarChart, PolarGrid, PolarAngleAxis, Radar,
  AreaChart, Area, Legend,
} from 'recharts';
import { ChartCard } from '../shared/ChartCard';
import { MetricDelta } from '../shared/MetricDelta';
import type { MockData, MockSession, MockTurn } from '../mockData';

interface Props {
  data: MockData;
}

const COLORS = {
  left: '#3b82f6',
  right: '#10b981',
  leftFill: '#3b82f620',
  rightFill: '#10b98120',
};

function fmtUsd(n: number): string {
  return n < 0.01 ? '<$0.01' : n < 1 ? `$${n.toFixed(3)}` : `$${n.toFixed(2)}`;
}

function fmtTokens(n: number): string {
  if (n < 1000) return String(Math.round(n));
  if (n < 1_000_000) return `${(n / 1000).toFixed(1)}k`;
  return `${(n / 1_000_000).toFixed(2)}M`;
}

function fmtMs(n: number): string {
  return n < 1000 ? `${Math.round(n)}ms` : `${(n / 1000).toFixed(1)}s`;
}

function pctChange(a: number, b: number): number {
  if (a === 0) return b === 0 ? 0 : 100;
  return ((b - a) / a) * 100;
}

interface SessionMetrics {
  session: MockSession;
  turns: MockTurn[];
  avgInputTokens: number;
  avgOutputTokens: number;
  avgLatency: number;
  avgCacheRate: number;
  totalCost: number;
  totalTokens: number;
  avgToolsPerTurn: number;
  costPerTurn: number;
  uniqueTools: string[];
  thinkingRatio: number;
}

function computeMetrics(session: MockSession, turns: MockTurn[]): SessionMetrics {
  const avgInput = turns.reduce((s, t) => s + t.inputTokens, 0) / turns.length;
  const avgOutput = turns.reduce((s, t) => s + t.outputTokens, 0) / turns.length;
  const avgLatency = turns.reduce((s, t) => s + t.latencyMs, 0) / turns.length;
  const totalInput = turns.reduce((s, t) => s + t.inputTokens, 0);
  const totalCached = turns.reduce((s, t) => s + t.cacheReadTokens, 0);
  const avgCacheRate = totalInput > 0 ? totalCached / totalInput : 0;
  const totalTools = turns.reduce((s, t) => s + t.toolCount, 0);
  const totalThinking = turns.reduce((s, t) => s + t.thinkingTokens, 0);
  const totalOut = turns.reduce((s, t) => s + t.outputTokens, 0);
  const uniqueTools = [...new Set(turns.flatMap((t) => t.toolNames))];

  return {
    session,
    turns,
    avgInputTokens: avgInput,
    avgOutputTokens: avgOutput,
    avgLatency,
    avgCacheRate,
    totalCost: session.totalCost,
    totalTokens: session.totalInputTokens + session.totalOutputTokens,
    avgToolsPerTurn: totalTools / turns.length,
    costPerTurn: session.totalCost / turns.length,
    uniqueTools,
    thinkingRatio: totalOut > 0 ? totalThinking / totalOut : 0,
  };
}

function ComparisonRow({
  label,
  leftValue,
  rightValue,
  leftFormatted,
  rightFormatted,
  lowerIsBetter = false,
}: {
  label: string;
  leftValue: number;
  rightValue: number;
  leftFormatted: string;
  rightFormatted: string;
  lowerIsBetter?: boolean;
}) {
  const delta = pctChange(leftValue, rightValue);
  const betterIsRight = lowerIsBetter ? delta < 0 : delta > 0;

  return (
    <div className="flex items-center py-2 border-b border-gray-800/50 last:border-0">
      {/* Left value */}
      <div className="flex-1 text-right pr-4">
        <span className={`text-sm font-medium ${!betterIsRight ? 'text-blue-400' : 'text-gray-400'}`}>
          {leftFormatted}
        </span>
      </div>
      {/* Label + delta */}
      <div className="w-[160px] text-center flex flex-col items-center gap-0.5">
        <span className="text-[10px] text-gray-500 uppercase tracking-wider">{label}</span>
        {delta !== 0 && <MetricDelta value={lowerIsBetter ? -delta : delta} size="sm" />}
      </div>
      {/* Right value */}
      <div className="flex-1 pl-4">
        <span className={`text-sm font-medium ${betterIsRight ? 'text-emerald-400' : 'text-gray-400'}`}>
          {rightFormatted}
        </span>
      </div>
    </div>
  );
}

export function ComparisonLab({ data }: Props) {
  const sessions = data.sessions;
  const [leftId, setLeftId] = useState(sessions[0]?.id ?? '');
  const [rightId, setRightId] = useState(sessions[sessions.length - 1]?.id ?? '');

  const leftSession = useMemo(() => sessions.find((s) => s.id === leftId), [sessions, leftId]);
  const rightSession = useMemo(() => sessions.find((s) => s.id === rightId), [sessions, rightId]);

  const leftTurns = useMemo(() => data.turns.filter((t) => t.sessionId === leftId), [data.turns, leftId]);
  const rightTurns = useMemo(() => data.turns.filter((t) => t.sessionId === rightId), [data.turns, rightId]);

  const left = useMemo(() =>
    leftSession ? computeMetrics(leftSession, leftTurns) : null,
    [leftSession, leftTurns],
  );
  const right = useMemo(() =>
    rightSession ? computeMetrics(rightSession, rightTurns) : null,
    [rightSession, rightTurns],
  );

  // Radar chart data
  const radarData = useMemo(() => {
    if (!left || !right) return [];
    // Normalize each metric to 0-100 scale
    const metrics = [
      { name: 'Cost Eff.', left: 1 / Math.max(left.costPerTurn, 0.001), right: 1 / Math.max(right.costPerTurn, 0.001) },
      { name: 'Cache Rate', left: left.avgCacheRate, right: right.avgCacheRate },
      { name: 'Speed', left: 1 / Math.max(left.avgLatency, 1), right: 1 / Math.max(right.avgLatency, 1) },
      { name: 'Tool Use', left: left.avgToolsPerTurn, right: right.avgToolsPerTurn },
      { name: 'Throughput', left: left.avgOutputTokens, right: right.avgOutputTokens },
    ];

    return metrics.map((m) => {
      const max = Math.max(m.left, m.right, 0.001);
      return {
        metric: m.name,
        left: (m.left / max) * 100,
        right: (m.right / max) * 100,
      };
    });
  }, [left, right]);

  // Mirrored cost per turn bar chart
  const costComparison = useMemo(() => {
    if (!left || !right) return [];
    const maxTurns = Math.max(left.turns.length, right.turns.length);
    return Array.from({ length: maxTurns }, (_, i) => ({
      turn: i + 1,
      left: left.turns[i]?.costUsd ?? 0,
      right: right.turns[i]?.costUsd ?? 0,
    }));
  }, [left, right]);

  // Cumulative token comparison
  const tokenComparison = useMemo(() => {
    if (!left || !right) return [];
    const maxTurns = Math.max(left.turns.length, right.turns.length);
    let cumLeft = 0;
    let cumRight = 0;
    return Array.from({ length: maxTurns }, (_, i) => {
      cumLeft += (left.turns[i]?.inputTokens ?? 0) + (left.turns[i]?.outputTokens ?? 0);
      cumRight += (right.turns[i]?.inputTokens ?? 0) + (right.turns[i]?.outputTokens ?? 0);
      return { turn: i + 1, left: cumLeft, right: cumRight };
    });
  }, [left, right]);

  if (!left || !right) {
    return <div className="p-8 text-center text-gray-500">Select two sessions to compare</div>;
  }

  return (
    <div className="p-4 max-w-[1400px] mx-auto space-y-4">
      {/* Session pickers */}
      <div className="grid grid-cols-2 gap-4">
        <div className="bg-[#161b22] rounded-xl border border-blue-500/30 p-3">
          <label className="text-[10px] text-blue-400 uppercase tracking-wider font-medium block mb-1.5">Session A</label>
          <select
            value={leftId}
            onChange={(e) => setLeftId(e.target.value)}
            className="w-full bg-[#0d1117] border border-gray-700 rounded-lg px-3 py-1.5 text-xs text-gray-300 focus:outline-none focus:border-blue-500"
          >
            {sessions.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name} — {fmtUsd(s.totalCost)} — {new Date(s.startTime).toLocaleDateString()}
              </option>
            ))}
          </select>
          <div className="flex items-center gap-3 mt-1.5 text-[10px] text-gray-500">
            <span>{leftTurns.length} turns</span>
            <span>{fmtTokens(left.totalTokens)} tokens</span>
            <span>{left.uniqueTools.length} tools</span>
          </div>
        </div>

        <div className="bg-[#161b22] rounded-xl border border-emerald-500/30 p-3">
          <label className="text-[10px] text-emerald-400 uppercase tracking-wider font-medium block mb-1.5">Session B</label>
          <select
            value={rightId}
            onChange={(e) => setRightId(e.target.value)}
            className="w-full bg-[#0d1117] border border-gray-700 rounded-lg px-3 py-1.5 text-xs text-gray-300 focus:outline-none focus:border-emerald-500"
          >
            {sessions.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name} — {fmtUsd(s.totalCost)} — {new Date(s.startTime).toLocaleDateString()}
              </option>
            ))}
          </select>
          <div className="flex items-center gap-3 mt-1.5 text-[10px] text-gray-500">
            <span>{rightTurns.length} turns</span>
            <span>{fmtTokens(right.totalTokens)} tokens</span>
            <span>{right.uniqueTools.length} tools</span>
          </div>
        </div>
      </div>

      {/* Metric comparison table + Radar */}
      <div className="grid grid-cols-5 gap-3">
        {/* Comparison table */}
        <div className="col-span-3 bg-[#161b22] rounded-xl border border-gray-800 p-4">
          <h3 className="text-xs text-gray-400 uppercase tracking-wider font-medium mb-3">Metric Comparison</h3>
          <ComparisonRow label="Total Cost" leftValue={left.totalCost} rightValue={right.totalCost} leftFormatted={fmtUsd(left.totalCost)} rightFormatted={fmtUsd(right.totalCost)} lowerIsBetter />
          <ComparisonRow label="Cost / Turn" leftValue={left.costPerTurn} rightValue={right.costPerTurn} leftFormatted={fmtUsd(left.costPerTurn)} rightFormatted={fmtUsd(right.costPerTurn)} lowerIsBetter />
          <ComparisonRow label="Total Tokens" leftValue={left.totalTokens} rightValue={right.totalTokens} leftFormatted={fmtTokens(left.totalTokens)} rightFormatted={fmtTokens(right.totalTokens)} />
          <ComparisonRow label="Avg Latency" leftValue={left.avgLatency} rightValue={right.avgLatency} leftFormatted={fmtMs(left.avgLatency)} rightFormatted={fmtMs(right.avgLatency)} lowerIsBetter />
          <ComparisonRow label="Cache Hit Rate" leftValue={left.avgCacheRate * 100} rightValue={right.avgCacheRate * 100} leftFormatted={`${(left.avgCacheRate * 100).toFixed(1)}%`} rightFormatted={`${(right.avgCacheRate * 100).toFixed(1)}%`} />
          <ComparisonRow label="Tools / Turn" leftValue={left.avgToolsPerTurn} rightValue={right.avgToolsPerTurn} leftFormatted={left.avgToolsPerTurn.toFixed(1)} rightFormatted={right.avgToolsPerTurn.toFixed(1)} />
          <ComparisonRow label="Turns" leftValue={left.turns.length} rightValue={right.turns.length} leftFormatted={String(left.turns.length)} rightFormatted={String(right.turns.length)} />
          <ComparisonRow label="Thinking %" leftValue={left.thinkingRatio * 100} rightValue={right.thinkingRatio * 100} leftFormatted={`${(left.thinkingRatio * 100).toFixed(1)}%`} rightFormatted={`${(right.thinkingRatio * 100).toFixed(1)}%`} />
        </div>

        {/* Radar chart */}
        <div className="col-span-2">
          <ChartCard title="Session Profile" subtitle="Relative performance comparison" height={280}>
            <ResponsiveContainer width="100%" height="100%">
              <RadarChart data={radarData} cx="50%" cy="50%" outerRadius="70%">
                <PolarGrid stroke="#1e2a3a" />
                <PolarAngleAxis dataKey="metric" tick={{ fill: '#9ca3af', fontSize: 10 }} />
                <Radar name="Session A" dataKey="left" stroke={COLORS.left} fill={COLORS.left} fillOpacity={0.15} strokeWidth={2} isAnimationActive={false} />
                <Radar name="Session B" dataKey="right" stroke={COLORS.right} fill={COLORS.right} fillOpacity={0.15} strokeWidth={2} isAnimationActive={false} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Tooltip
                  contentStyle={{ backgroundColor: '#1c2128', border: '1px solid #30363d', borderRadius: 8, fontSize: 11 }}
                  formatter={(v: number = 0) => [`${v.toFixed(0)}%`, '']}
                />
              </RadarChart>
            </ResponsiveContainer>
          </ChartCard>
        </div>
      </div>

      {/* Mirrored charts */}
      <div className="grid grid-cols-2 gap-3">
        <ChartCard title="Cost per Turn" subtitle="Side-by-side per-turn cost" height={200}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={costComparison} margin={{ top: 8, right: 12, bottom: 0, left: 8 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#1e2a3a" />
              <XAxis dataKey="turn" tick={{ fill: '#6b7280', fontSize: 10 }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fill: '#6b7280', fontSize: 10 }} axisLine={false} tickLine={false} tickFormatter={(v: number) => fmtUsd(v)} />
              <Tooltip
                contentStyle={{ backgroundColor: '#1c2128', border: '1px solid #30363d', borderRadius: 8, fontSize: 11 }}
                formatter={(v: number = 0, name: string = '') => [fmtUsd(v), name === 'left' ? 'Session A' : 'Session B']}
                labelStyle={{ color: '#8b949e' }}
              />
              <Bar dataKey="left" fill={COLORS.left} fillOpacity={0.7} radius={[4, 4, 0, 0]} name="Session A" isAnimationActive={false} />
              <Bar dataKey="right" fill={COLORS.right} fillOpacity={0.7} radius={[4, 4, 0, 0]} name="Session B" isAnimationActive={false} />
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard title="Cumulative Tokens" subtitle="Token accumulation comparison" height={200}>
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={tokenComparison} margin={{ top: 8, right: 12, bottom: 0, left: 8 }}>
              <defs>
                <linearGradient id="leftTokenGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={COLORS.left} stopOpacity={0.2} />
                  <stop offset="100%" stopColor={COLORS.left} stopOpacity={0} />
                </linearGradient>
                <linearGradient id="rightTokenGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={COLORS.right} stopOpacity={0.2} />
                  <stop offset="100%" stopColor={COLORS.right} stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#1e2a3a" />
              <XAxis dataKey="turn" tick={{ fill: '#6b7280', fontSize: 10 }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fill: '#6b7280', fontSize: 10 }} axisLine={false} tickLine={false} tickFormatter={(v: number) => fmtTokens(v)} />
              <Tooltip
                contentStyle={{ backgroundColor: '#1c2128', border: '1px solid #30363d', borderRadius: 8, fontSize: 11 }}
                formatter={(v: number = 0, name: string = '') => [fmtTokens(v), name === 'left' ? 'Session A' : 'Session B']}
                labelStyle={{ color: '#8b949e' }}
              />
              <Area type="monotone" dataKey="left" stroke={COLORS.left} fill="url(#leftTokenGrad)" strokeWidth={2} name="Session A" isAnimationActive={false} />
              <Area type="monotone" dataKey="right" stroke={COLORS.right} fill="url(#rightTokenGrad)" strokeWidth={2} name="Session B" isAnimationActive={false} />
            </AreaChart>
          </ResponsiveContainer>
        </ChartCard>
      </div>

      {/* Tool comparison */}
      <ChartCard title="Tool Usage Comparison" subtitle="Which tools each session relied on" height={200}>
        <div className="h-full overflow-auto px-4">
          <div className="grid grid-cols-2 gap-8">
            {/* Left session tools */}
            <div>
              <div className="text-[10px] text-blue-400 uppercase tracking-wider font-medium mb-2">Session A</div>
              <div className="space-y-1.5">
                {(() => {
                  const toolMap = new Map<string, number>();
                  for (const t of leftTurns) {
                    for (const name of t.toolNames) {
                      toolMap.set(name, (toolMap.get(name) ?? 0) + 1);
                    }
                  }
                  const tools = [...toolMap.entries()].sort((a, b) => b[1] - a[1]);
                  const max = tools[0]?.[1] ?? 1;
                  return tools.map(([name, count]) => (
                    <div key={name} className="flex items-center gap-2">
                      <span className="text-[10px] text-gray-400 w-[52px] text-right">{name}</span>
                      <div className="flex-1 h-3 bg-gray-800 rounded-full overflow-hidden">
                        <div
                          className="h-full rounded-full"
                          style={{ width: `${(count / max) * 100}%`, backgroundColor: COLORS.left }}
                        />
                      </div>
                      <span className="text-[10px] text-gray-500 w-6">{count}</span>
                    </div>
                  ));
                })()}
              </div>
            </div>

            {/* Right session tools */}
            <div>
              <div className="text-[10px] text-emerald-400 uppercase tracking-wider font-medium mb-2">Session B</div>
              <div className="space-y-1.5">
                {(() => {
                  const toolMap = new Map<string, number>();
                  for (const t of rightTurns) {
                    for (const name of t.toolNames) {
                      toolMap.set(name, (toolMap.get(name) ?? 0) + 1);
                    }
                  }
                  const tools = [...toolMap.entries()].sort((a, b) => b[1] - a[1]);
                  const max = tools[0]?.[1] ?? 1;
                  return tools.map(([name, count]) => (
                    <div key={name} className="flex items-center gap-2">
                      <span className="text-[10px] text-gray-400 w-[52px] text-right">{name}</span>
                      <div className="flex-1 h-3 bg-gray-800 rounded-full overflow-hidden">
                        <div
                          className="h-full rounded-full"
                          style={{ width: `${(count / max) * 100}%`, backgroundColor: COLORS.right }}
                        />
                      </div>
                      <span className="text-[10px] text-gray-500 w-6">{count}</span>
                    </div>
                  ));
                })()}
              </div>
            </div>
          </div>
        </div>
      </ChartCard>
    </div>
  );
}
