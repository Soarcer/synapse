import { useMemo, useState } from 'react';
import {
  AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer,
  CartesianGrid, ReferenceLine, BarChart, Bar, Cell,
} from 'recharts';
import { ChartCard } from '../shared/ChartCard';
import type { MockData, MockTurn, MockSession } from '../mockData';

interface Props {
  data: MockData;
}

type SortField = 'date' | 'cost' | 'tokens' | 'turns';

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

const TOOL_COLORS: Record<string, string> = {
  Read: '#3b82f6', Grep: '#8b5cf6', Glob: '#a78bfa', Edit: '#ec4899',
  Write: '#f59e0b', Bash: '#f97316', Task: '#10b981', WebFetch: '#06b6d4',
  WebSearch: '#14b8a6', TodoWrite: '#84cc16', NotebookEdit: '#e879f9',
};

function fmtUsd(n: number): string {
  return n < 0.01 ? '<$0.01' : n < 1 ? `$${n.toFixed(3)}` : `$${n.toFixed(2)}`;
}

function fmtTokens(n: number): string {
  if (n < 1000) return String(n);
  if (n < 1_000_000) return `${(n / 1000).toFixed(1)}k`;
  return `${(n / 1_000_000).toFixed(2)}M`;
}

function fmtMs(n: number): string {
  return n < 1000 ? `${Math.round(n)}ms` : `${(n / 1000).toFixed(1)}s`;
}

function fmtTime(ts: number): string {
  return new Date(ts).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}

function TurnCard({
  turn,
  expanded,
  onToggle,
  cumulativeCost,
}: {
  turn: MockTurn;
  expanded: boolean;
  onToggle: () => void;
  cumulativeCost: number;
}) {
  const cacheRate = turn.inputTokens > 0 ? (turn.cacheReadTokens / turn.inputTokens) * 100 : 0;

  return (
    <div className="relative">
      {/* Timeline connector */}
      <div className="absolute left-[19px] top-0 bottom-0 w-px bg-gray-800" />

      {/* Compaction marker */}
      {turn.compactionBefore && (
        <div className="relative flex items-center gap-2 ml-[11px] mb-2">
          <div className="w-[17px] h-[17px] rounded-full bg-yellow-900/50 border border-yellow-600/50 flex items-center justify-center z-10">
            <span className="text-[9px]">{'\u26A0'}</span>
          </div>
          <span className="text-[10px] text-yellow-500/80 font-medium uppercase tracking-wider">Context Compacted</span>
        </div>
      )}

      {/* Turn card */}
      <div className="relative flex gap-3 mb-3">
        {/* Timeline dot */}
        <div className="relative z-10 flex-shrink-0">
          <div
            className="w-[39px] h-[39px] rounded-full flex items-center justify-center text-[11px] font-bold border-2"
            style={{
              borderColor: MODEL_COLORS[turn.model] ?? '#6b7280',
              backgroundColor: `${MODEL_COLORS[turn.model] ?? '#6b7280'}20`,
              color: MODEL_COLORS[turn.model] ?? '#6b7280',
            }}
          >
            {turn.turnIndex + 1}
          </div>
        </div>

        {/* Card body */}
        <button
          onClick={onToggle}
          className="flex-1 text-left bg-[#161b22] border border-gray-800 rounded-lg p-3 hover:border-gray-700 transition-colors"
        >
          {/* Prompt text card */}
          {turn.promptText ? (
            <div className="mb-2 px-2.5 py-2 bg-[#0d1117] border border-gray-800/70 rounded-md">
              <p className="text-[11px] text-gray-300 leading-relaxed line-clamp-3">{turn.promptText}</p>
            </div>
          ) : (
            <div className="mb-2 px-2.5 py-1.5 bg-[#0d1117]/50 border border-gray-800/40 rounded-md">
              <p className="text-[10px] text-gray-600 italic">no prompt text</p>
            </div>
          )}

          {/* Stats header */}
          <div className="flex items-start justify-between gap-2">
            <p className="text-[10px] text-gray-600">{fmtTime(turn.timestamp)}</p>
            <div className="flex items-center gap-3 flex-shrink-0">
              <div className="text-right">
                <div className="text-xs font-medium text-amber-400">{fmtUsd(turn.costUsd)}</div>
                <div className="text-[10px] text-gray-600">cum: {fmtUsd(cumulativeCost)}</div>
              </div>
            </div>
          </div>

          {/* Quick stats row */}
          <div className="flex items-center gap-3 mt-2 flex-wrap">
            <span className="text-[10px] text-gray-500">
              {fmtTokens(turn.inputTokens)} in / {fmtTokens(turn.outputTokens)} out
            </span>
            <span className="text-[10px] text-gray-500">{fmtMs(turn.latencyMs)} latency</span>
            <span className="text-[10px] text-gray-500">{cacheRate.toFixed(0)}% cached</span>
            {turn.toolCount > 0 && (
              <span className="text-[10px] text-gray-500">{turn.toolCount} tool{turn.toolCount > 1 ? 's' : ''}</span>
            )}
            {turn.thinkingTokens > 0 && (
              <span className="text-[10px] text-purple-400/70">{fmtTokens(turn.thinkingTokens)} thinking</span>
            )}
          </div>

          {/* Expanded details */}
          {expanded && (
            <div className="mt-3 pt-3 border-t border-gray-800">
              {/* Token breakdown bar */}
              <div className="mb-3">
                <div className="text-[10px] text-gray-500 mb-1">Token breakdown</div>
                <div className="flex h-3 rounded-full overflow-hidden bg-gray-800">
                  {turn.cacheReadTokens > 0 && (
                    <div
                      className="h-full"
                      style={{
                        width: `${(turn.cacheReadTokens / (turn.inputTokens + turn.outputTokens)) * 100}%`,
                        backgroundColor: '#8b5cf6',
                      }}
                      title={`Cached: ${fmtTokens(turn.cacheReadTokens)}`}
                    />
                  )}
                  <div
                    className="h-full"
                    style={{
                      width: `${((turn.inputTokens - turn.cacheReadTokens) / (turn.inputTokens + turn.outputTokens)) * 100}%`,
                      backgroundColor: '#3b82f6',
                    }}
                    title={`Fresh input: ${fmtTokens(turn.inputTokens - turn.cacheReadTokens)}`}
                  />
                  <div
                    className="h-full"
                    style={{
                      width: `${(turn.outputTokens / (turn.inputTokens + turn.outputTokens)) * 100}%`,
                      backgroundColor: '#10b981',
                    }}
                    title={`Output: ${fmtTokens(turn.outputTokens)}`}
                  />
                </div>
                <div className="flex justify-between mt-1">
                  <span className="text-[9px] text-purple-400">cached {fmtTokens(turn.cacheReadTokens)}</span>
                  <span className="text-[9px] text-blue-400">input {fmtTokens(turn.inputTokens - turn.cacheReadTokens)}</span>
                  <span className="text-[9px] text-emerald-400">output {fmtTokens(turn.outputTokens)}</span>
                </div>
              </div>

              {/* Tools used */}
              {turn.toolNames.length > 0 && (
                <div>
                  <div className="text-[10px] text-gray-500 mb-1">Tools used</div>
                  <div className="flex flex-wrap gap-1">
                    {turn.toolNames.map((name, i) => (
                      <span
                        key={i}
                        className="px-1.5 py-0.5 rounded text-[10px] font-medium"
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

              {/* Model badge */}
              <div className="mt-2 flex items-center gap-2">
                <span
                  className="px-2 py-0.5 rounded text-[10px] font-medium"
                  style={{
                    backgroundColor: `${MODEL_COLORS[turn.model] ?? '#6b7280'}20`,
                    color: MODEL_COLORS[turn.model] ?? '#6b7280',
                  }}
                >
                  {MODEL_LABELS[turn.model] ?? turn.model}
                </span>
              </div>
            </div>
          )}
        </button>
      </div>
    </div>
  );
}

export function SessionReplay({ data }: Props) {
  const [selectedSession, setSelectedSession] = useState<string>(data.sessions[data.sessions.length - 1]?.id ?? '');
  const [expandedTurn, setExpandedTurn] = useState<number | null>(null);
  const [sortField, setSortField] = useState<SortField>('date');
  const [sortAsc, setSortAsc] = useState(false);

  // Sort sessions
  const sortedSessions = useMemo(() => {
    const arr = [...data.sessions];
    arr.sort((a, b) => {
      let cmp = 0;
      switch (sortField) {
        case 'date': cmp = a.startTime - b.startTime; break;
        case 'cost': cmp = a.totalCost - b.totalCost; break;
        case 'tokens': cmp = (a.totalInputTokens + a.totalOutputTokens) - (b.totalInputTokens + b.totalOutputTokens); break;
        case 'turns': cmp = a.promptCount - b.promptCount; break;
      }
      return sortAsc ? cmp : -cmp;
    });
    return arr;
  }, [data.sessions, sortField, sortAsc]);

  // Group sorted sessions by day
  const groupedSessions = useMemo(() => {
    const groups: { date: string; sessions: MockSession[] }[] = [];
    let currentDate = '';
    for (const s of sortedSessions) {
      const dateKey = new Date(s.startTime).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
      if (dateKey !== currentDate) {
        currentDate = dateKey;
        groups.push({ date: dateKey, sessions: [] });
      }
      groups[groups.length - 1].sessions.push(s);
    }
    return groups;
  }, [sortedSessions]);

  const session = useMemo(() =>
    data.sessions.find((s) => s.id === selectedSession),
    [data.sessions, selectedSession],
  );

  const sessionTurns = useMemo(() =>
    data.turns.filter((t) => t.sessionId === selectedSession),
    [data.turns, selectedSession],
  );

  // Cumulative cost series for the chart
  const costTimeline = useMemo(() => {
    let cumCost = 0;
    let cumInput = 0;
    let cumOutput = 0;
    return sessionTurns.map((t) => {
      cumCost += t.costUsd;
      cumInput += t.inputTokens;
      cumOutput += t.outputTokens;
      return {
        turn: t.turnIndex + 1,
        cost: cumCost,
        inputTokens: cumInput,
        outputTokens: cumOutput,
        compaction: t.compactionBefore,
      };
    });
  }, [sessionTurns]);

  // Tool usage for this session
  const sessionToolData = useMemo(() => {
    const map = new Map<string, number>();
    for (const t of sessionTurns) {
      for (const name of t.toolNames) {
        map.set(name, (map.get(name) ?? 0) + 1);
      }
    }
    return [...map.entries()]
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count);
  }, [sessionTurns]);

  // Cumulative costs for turn cards
  const cumulativeCosts = useMemo(() => {
    let cum = 0;
    return sessionTurns.map((t) => {
      cum += t.costUsd;
      return cum;
    });
  }, [sessionTurns]);

  // Compaction turn indices for reference lines
  const compactionTurns = useMemo(() =>
    sessionTurns.filter((t) => t.compactionBefore).map((t) => t.turnIndex + 1),
    [sessionTurns],
  );

  const handleSortChange = (field: SortField) => {
    if (sortField === field) {
      setSortAsc(!sortAsc);
    } else {
      setSortField(field);
      setSortAsc(false);
    }
  };

  if (!session) {
    return <div className="p-8 text-center text-gray-500">No sessions available</div>;
  }

  return (
    <div className="flex h-full overflow-hidden">
      {/* Left: Session picker + timeline */}
      <div className="w-[420px] flex-shrink-0 border-r border-gray-800 flex flex-col overflow-hidden">
        {/* Sort controls */}
        <div className="p-3 border-b border-gray-800 bg-[#0d1117]">
          <label className="text-[10px] text-gray-500 uppercase tracking-wider font-medium block mb-1.5">Sort by</label>
          <div className="flex items-center gap-1">
            {([['date', 'Date'], ['cost', 'Cost'], ['tokens', 'Tokens'], ['turns', 'Turns']] as const).map(([field, label]) => (
              <button
                key={field}
                onClick={() => handleSortChange(field)}
                className={`px-2.5 py-1 text-[11px] rounded-md transition-all ${
                  sortField === field
                    ? 'bg-blue-500/20 text-blue-400 font-medium'
                    : 'text-gray-500 hover:text-gray-300 hover:bg-gray-800'
                }`}
              >
                {label}
                {sortField === field && (
                  <span className="ml-0.5">{sortAsc ? '\u2191' : '\u2193'}</span>
                )}
              </button>
            ))}
          </div>
        </div>

        {/* Session picker — grouped by day */}
        <div className="p-3 border-b border-gray-800 bg-[#0d1117] max-h-[260px] overflow-y-auto">
          <label className="text-[10px] text-gray-500 uppercase tracking-wider font-medium block mb-1.5">
            Sessions ({data.sessions.length})
          </label>
          <div className="space-y-2">
            {groupedSessions.map((group) => (
              <div key={group.date}>
                <div className="text-[10px] text-gray-600 font-medium mb-1 sticky top-0 bg-[#0d1117] py-0.5">{group.date}</div>
                <div className="space-y-0.5">
                  {group.sessions.map((s) => (
                    <button
                      key={s.id}
                      onClick={() => { setSelectedSession(s.id); setExpandedTurn(null); }}
                      className={`w-full text-left px-2.5 py-1.5 rounded-md text-[11px] transition-all ${
                        selectedSession === s.id
                          ? 'bg-blue-500/15 border border-blue-500/30 text-gray-200'
                          : 'text-gray-400 hover:bg-gray-800/50 hover:text-gray-300 border border-transparent'
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <span className="truncate flex-1 mr-2">{s.name}</span>
                        <span className="text-amber-400 font-medium flex-shrink-0">{fmtUsd(s.totalCost)}</span>
                      </div>
                      <div className="flex items-center gap-2 mt-0.5 text-[10px] text-gray-600">
                        <span>{s.promptCount} turns</span>
                        <span>{fmtTokens(s.totalInputTokens + s.totalOutputTokens)} tok</span>
                        <span
                          className="px-1 rounded"
                          style={{
                            backgroundColor: `${MODEL_COLORS[s.model] ?? '#6b7280'}15`,
                            color: MODEL_COLORS[s.model] ?? '#6b7280',
                          }}
                        >
                          {MODEL_LABELS[s.model] ?? s.model}
                        </span>
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Session summary */}
        <div className="px-3 py-2 border-b border-gray-800 bg-[#0d1117]">
          <div className="flex items-center gap-3 text-[10px] text-gray-500">
            <span>{sessionTurns.length} turns</span>
            <span>{fmtTokens(session.totalInputTokens + session.totalOutputTokens)} tokens</span>
            <span>{session.toolCalls} tool calls</span>
            <span>{session.compactions} compactions</span>
          </div>
        </div>

        {/* Timeline */}
        <div className="flex-1 overflow-y-auto p-3 space-y-0">
          {sessionTurns.map((turn, i) => (
            <TurnCard
              key={`${turn.sessionId}-${turn.turnIndex}`}
              turn={turn}
              expanded={expandedTurn === i}
              onToggle={() => setExpandedTurn(expandedTurn === i ? null : i)}
              cumulativeCost={cumulativeCosts[i]}
            />
          ))}
        </div>
      </div>

      {/* Right: Charts */}
      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {/* Cumulative cost chart */}
        <ChartCard title="Cumulative Cost" subtitle={`Total: ${fmtUsd(session.totalCost)}`} height={200}>
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={costTimeline} margin={{ top: 8, right: 12, bottom: 0, left: 8 }}>
              <defs>
                <linearGradient id="cumCostGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#f59e0b" stopOpacity={0.4} />
                  <stop offset="100%" stopColor="#f59e0b" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#1e2a3a" />
              <XAxis dataKey="turn" tick={{ fill: '#6b7280', fontSize: 10 }} axisLine={false} tickLine={false} label={{ value: 'Turn', position: 'insideBottomRight', fill: '#6b7280', fontSize: 10 }} />
              <YAxis tick={{ fill: '#6b7280', fontSize: 10 }} axisLine={false} tickLine={false} tickFormatter={(v: number) => fmtUsd(v)} />
              <Tooltip
                contentStyle={{ backgroundColor: '#1c2128', border: '1px solid #30363d', borderRadius: 8, fontSize: 11 }}
                formatter={(v: number = 0) => [fmtUsd(v), 'Cumulative Cost']}
                labelStyle={{ color: '#8b949e' }}
              />
              {compactionTurns.map((turn) => (
                <ReferenceLine key={turn} x={turn} stroke="#eab308" strokeDasharray="4 4" strokeWidth={1} label={{ value: 'Compact', fill: '#eab308', fontSize: 9, position: 'top' }} />
              ))}
              <Area type="monotone" dataKey="cost" stroke="#f59e0b" strokeWidth={2} fill="url(#cumCostGrad)" isAnimationActive={false} />
            </AreaChart>
          </ResponsiveContainer>
        </ChartCard>

        {/* Cumulative tokens */}
        <ChartCard title="Cumulative Tokens" subtitle="Input + Output over turns" height={200}>
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={costTimeline} margin={{ top: 8, right: 12, bottom: 0, left: 8 }}>
              <defs>
                <linearGradient id="cumInGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#3b82f6" stopOpacity={0.3} />
                  <stop offset="100%" stopColor="#3b82f6" stopOpacity={0} />
                </linearGradient>
                <linearGradient id="cumOutGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#10b981" stopOpacity={0.3} />
                  <stop offset="100%" stopColor="#10b981" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#1e2a3a" />
              <XAxis dataKey="turn" tick={{ fill: '#6b7280', fontSize: 10 }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fill: '#6b7280', fontSize: 10 }} axisLine={false} tickLine={false} tickFormatter={(v: number) => fmtTokens(v)} />
              <Tooltip
                contentStyle={{ backgroundColor: '#1c2128', border: '1px solid #30363d', borderRadius: 8, fontSize: 11 }}
                formatter={(v: number = 0) => [fmtTokens(v), '']}
                labelStyle={{ color: '#8b949e' }}
              />
              {compactionTurns.map((turn) => (
                <ReferenceLine key={turn} x={turn} stroke="#eab308" strokeDasharray="4 4" strokeWidth={1} />
              ))}
              <Area type="monotone" dataKey="inputTokens" stroke="#3b82f6" fill="url(#cumInGrad)" strokeWidth={1.5} name="Input" isAnimationActive={false} />
              <Area type="monotone" dataKey="outputTokens" stroke="#10b981" fill="url(#cumOutGrad)" strokeWidth={1.5} name="Output" isAnimationActive={false} />
            </AreaChart>
          </ResponsiveContainer>
        </ChartCard>

        {/* Tool usage for session */}
        <ChartCard title="Tools Used" subtitle={`${sessionToolData.length} unique tools`} height={180}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={sessionToolData} layout="vertical" margin={{ top: 4, right: 12, bottom: 0, left: 4 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#1e2a3a" horizontal={false} />
              <XAxis type="number" tick={{ fill: '#6b7280', fontSize: 10 }} axisLine={false} tickLine={false} />
              <YAxis type="category" dataKey="name" tick={{ fill: '#9ca3af', fontSize: 11 }} axisLine={false} tickLine={false} width={65} />
              <Tooltip
                contentStyle={{ backgroundColor: '#1c2128', border: '1px solid #30363d', borderRadius: 8, fontSize: 11 }}
                labelStyle={{ color: '#8b949e' }}
              />
              <Bar dataKey="count" radius={[0, 4, 4, 0]} isAnimationActive={false}>
                {sessionToolData.map((entry, i) => (
                  <Cell key={i} fill={TOOL_COLORS[entry.name] ?? '#6b7280'} fillOpacity={0.7} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>

        {/* Per-turn latency bar */}
        <ChartCard title="Response Latency" subtitle="Per-turn response time" height={160}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={sessionTurns.map((t) => ({ turn: t.turnIndex + 1, latency: t.latencyMs }))} margin={{ top: 4, right: 12, bottom: 0, left: 8 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#1e2a3a" />
              <XAxis dataKey="turn" tick={{ fill: '#6b7280', fontSize: 10 }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fill: '#6b7280', fontSize: 10 }} axisLine={false} tickLine={false} tickFormatter={(v: number) => fmtMs(v)} />
              <Tooltip
                contentStyle={{ backgroundColor: '#1c2128', border: '1px solid #30363d', borderRadius: 8, fontSize: 11 }}
                formatter={(v: number = 0) => [fmtMs(v), 'Latency']}
                labelStyle={{ color: '#8b949e' }}
              />
              <Bar dataKey="latency" radius={[4, 4, 0, 0]} isAnimationActive={false}>
                {sessionTurns.map((t, i) => (
                  <Cell key={i} fill={t.latencyMs > 3000 ? '#ef4444' : t.latencyMs > 2000 ? '#f59e0b' : '#06b6d4'} fillOpacity={0.6} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>
      </div>
    </div>
  );
}
