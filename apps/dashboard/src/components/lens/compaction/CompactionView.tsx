// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Bernhard

import { useMemo, useRef, useEffect } from 'react';
import { useLens } from '../LensContext';
import type { CompactEvent } from '../LensContext';
import { formatTokens, formatDuration } from '@synapse-ai/core';
import { buildCompactEvents, buildCostPerTurn } from '../lensComputations';

/** Small SVG sparkline showing cumulative tokens with compaction drop markers */
function ContextGrowthChart({
  turns,
  height = 120,
}: {
  turns: { cumulativeInput: number; compactionBefore: boolean }[];
  height?: number;
}) {
  if (turns.length < 2) return null;

  const maxTokens = Math.max(...turns.map((t) => t.cumulativeInput), 1);
  const w = Math.max(turns.length * 16, 200);

  const points = turns.map((t, i) => {
    const x = (i / (turns.length - 1)) * (w - 8) + 4;
    const y = height - 8 - (t.cumulativeInput / maxTokens) * (height - 16);
    return { x, y, compactionBefore: t.compactionBefore };
  });

  const linePath = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ');

  // Area fill under the line
  const areaPath = `${linePath} L ${points[points.length - 1].x} ${height - 4} L ${points[0].x} ${height - 4} Z`;

  return (
    <div className="overflow-x-auto">
      <svg width={w} height={height} className="block">
        {/* Grid lines */}
        {[0.25, 0.5, 0.75].map((frac) => (
          <line
            key={frac}
            x1={4}
            x2={w - 4}
            y1={height - 8 - frac * (height - 16)}
            y2={height - 8 - frac * (height - 16)}
            stroke="#1e293b"
            strokeWidth={1}
          />
        ))}

        {/* Compaction markers */}
        {points.map((p, i) =>
          p.compactionBefore ? (
            <g key={`c-${i}`}>
              <line
                x1={p.x}
                x2={p.x}
                y1={4}
                y2={height - 4}
                stroke="#ef4444"
                strokeWidth={1.5}
                strokeDasharray="3 2"
                opacity={0.6}
              />
              <text x={p.x} y={10} textAnchor="middle" fill="#ef4444" fontSize={9} opacity={0.8}>
                C
              </text>
            </g>
          ) : null,
        )}

        {/* Area fill */}
        <path d={areaPath} fill="url(#growthGrad)" opacity={0.3} />

        {/* Line */}
        <path d={linePath} fill="none" stroke="#22c55e" strokeWidth={1.5} />

        {/* Dots */}
        {points.map((p, i) => (
          <circle
            key={i}
            cx={p.x}
            cy={p.y}
            r={2.5}
            fill={p.compactionBefore ? '#ef4444' : '#22c55e'}
          />
        ))}

        {/* Y-axis labels */}
        <text x={4} y={height - 4} fill="#6b7280" fontSize={8} textAnchor="start">
          0
        </text>
        <text x={4} y={12} fill="#6b7280" fontSize={8} textAnchor="start">
          {formatTokens(maxTokens)}
        </text>

        <defs>
          <linearGradient id="growthGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#22c55e" />
            <stop offset="100%" stopColor="#22c55e" stopOpacity={0} />
          </linearGradient>
        </defs>
      </svg>
    </div>
  );
}

export function CompactionView() {
  const { agents, events, prompts, transcripts, hasTokenData, selectedId, onSelect } = useLens();

  // Compute locally (only when compaction tab is active)
  const compactEvents = useMemo(() => buildCompactEvents(events), [events]);
  const costPerTurn = useMemo(
    () => buildCostPerTurn(prompts, agents, compactEvents, transcripts),
    [prompts, agents, compactEvents, transcripts],
  );
  const scrollRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to selected turn row
  useEffect(() => {
    if (!selectedId) return;
    const row = scrollRef.current?.querySelector(`[data-node-id="${selectedId}"]`);
    if (row) row.scrollIntoView({ block: 'nearest' });
  }, [selectedId]);

  const stats = useMemo(() => {
    if (compactEvents.length === 0 && costPerTurn.length === 0) return null;

    // Group by session
    const sessionCompactions = new Map<string, number[]>();
    for (const c of compactEvents) {
      const list = sessionCompactions.get(c.sessionId) ?? [];
      list.push(c.timestamp);
      sessionCompactions.set(c.sessionId, list);
    }

    // Sessions with/without compaction
    const sessionIds = new Set<string>();
    for (const t of costPerTurn) sessionIds.add(t.sessionId);
    for (const c of compactEvents) sessionIds.add(c.sessionId);
    const sessionsWithCompaction = sessionCompactions.size;
    const sessionsWithout = sessionIds.size - sessionsWithCompaction;

    // Time between compactions
    const intervals: number[] = [];
    for (const [, timestamps] of sessionCompactions) {
      const sorted = [...timestamps].sort((a, b) => a - b);
      for (let i = 1; i < sorted.length; i++) {
        intervals.push(sorted[i] - sorted[i - 1]);
      }
    }
    const avgInterval =
      intervals.length > 0 ? intervals.reduce((a, b) => a + b, 0) / intervals.length : 0;

    // Prompts before first compaction (per session)
    const promptsBeforeFirst: number[] = [];
    for (const [sessionId, timestamps] of sessionCompactions) {
      const firstCompact = Math.min(...timestamps);
      const promptsBefore = costPerTurn.filter(
        (t) => t.sessionId === sessionId && t.timestamp < firstCompact,
      ).length;
      promptsBeforeFirst.push(promptsBefore);
    }
    const avgPromptsBefore =
      promptsBeforeFirst.length > 0
        ? Math.round(promptsBeforeFirst.reduce((a, b) => a + b, 0) / promptsBeforeFirst.length)
        : 0;

    // Token accumulation rate
    const totalInput = costPerTurn.reduce((s, t) => s + t.inputTokens, 0);
    const tokensPerTurn = costPerTurn.length > 0 ? totalInput / costPerTurn.length : 0;

    // Trigger distribution
    const triggers = new Map<string, number>();
    for (const c of compactEvents) {
      const t = c.trigger ?? 'unknown';
      triggers.set(t, (triggers.get(t) ?? 0) + 1);
    }

    // Cache stats (from transcript data)
    const totalCacheRead = costPerTurn.reduce((s, t) => s + (t.cacheReadTokens ?? 0), 0);
    const totalCacheWrite = costPerTurn.reduce((s, t) => s + (t.cacheCreationTokens ?? 0), 0);
    const cacheHitRate =
      totalInput > 0 && totalCacheRead > 0
        ? (totalCacheRead / (totalInput + totalCacheRead)) * 100
        : 0;
    const hasTranscript = costPerTurn.some((t) => t.dataSource === 'transcript');

    // Estimated cost from transcripts
    let estimatedCost = 0;
    for (const t of transcripts.values()) {
      estimatedCost += t.estimatedCostUsd;
    }

    return {
      totalCompactions: compactEvents.length,
      sessionsWithCompaction,
      sessionsWithout,
      avgInterval,
      avgPromptsBefore,
      tokensPerTurn,
      triggers,
      totalTurns: costPerTurn.length,
      totalInput,
      totalCacheRead,
      totalCacheWrite,
      cacheHitRate,
      hasTranscript,
      estimatedCost,
    };
  }, [compactEvents, costPerTurn, transcripts]);

  if (!stats || (stats.totalCompactions === 0 && stats.totalTurns === 0)) {
    return (
      <div className="p-4 text-center text-gray-600 text-xs">No compaction or prompt data yet.</div>
    );
  }

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* Header */}
      <div className="px-3 py-1.5 border-b border-gray-800 flex-shrink-0">
        <span className="text-[10px] text-gray-500 font-medium">Compaction & Context Growth</span>
      </div>

      <div ref={scrollRef} className="flex-1 min-h-0 overflow-auto p-3 space-y-3">
        {/* Stats grid */}
        <div className="grid grid-cols-2 gap-2">
          <StatCard
            label="Compactions"
            value={String(stats.totalCompactions)}
            sub={
              stats.totalCompactions > 0
                ? `across ${stats.sessionsWithCompaction} session${stats.sessionsWithCompaction !== 1 ? 's' : ''}`
                : 'none yet'
            }
            color="text-red-400"
          />
          <StatCard
            label="Sessions"
            value={`${stats.sessionsWithCompaction}/${stats.sessionsWithCompaction + stats.sessionsWithout}`}
            sub="with compaction"
            color="text-blue-400"
          />
          {stats.avgInterval > 0 && (
            <StatCard
              label="Avg interval"
              value={formatDuration(stats.avgInterval)}
              sub="between compactions"
              color="text-amber-400"
            />
          )}
          {stats.avgPromptsBefore > 0 && (
            <StatCard
              label="Turns before 1st"
              value={String(stats.avgPromptsBefore)}
              sub="prompts avg"
              color="text-purple-400"
            />
          )}
          <StatCard
            label="Tokens/turn"
            value={formatTokens(stats.tokensPerTurn)}
            sub="input avg"
            color="text-cyan-400"
          />
          <StatCard
            label="Total turns"
            value={String(stats.totalTurns)}
            sub={`${formatTokens(stats.totalInput)} total input`}
            color="text-green-400"
          />
          {stats.hasTranscript && stats.cacheHitRate > 0 && (
            <StatCard
              label="Cache hit"
              value={`${stats.cacheHitRate.toFixed(0)}%`}
              sub={`R: ${formatTokens(stats.totalCacheRead)} / W: ${formatTokens(stats.totalCacheWrite)}`}
              color="text-green-400"
            />
          )}
          {stats.hasTranscript && stats.estimatedCost > 0 && (
            <StatCard
              label="Est. cost"
              value={`$${stats.estimatedCost.toFixed(2)}`}
              sub="from JSONL"
              color="text-yellow-400"
            />
          )}
        </div>

        {/* Trigger distribution */}
        {stats.triggers.size > 0 && (
          <div>
            <div className="text-[10px] text-gray-500 font-medium mb-1">Trigger types</div>
            <div className="flex gap-1.5 flex-wrap">
              {[...stats.triggers.entries()].map(([trigger, count]) => (
                <span
                  key={trigger}
                  className="px-2 py-0.5 rounded-full text-[10px] bg-red-900/30 text-red-300 border border-red-800/30"
                >
                  {trigger}: {count}
                </span>
              ))}
            </div>
          </div>
        )}

        {/* Compaction detail with preTokens (from transcript v2) */}
        {compactEvents.some((c) => c.preTokens != null) && (
          <div>
            <div className="text-[10px] text-gray-500 font-medium mb-1">Compaction events</div>
            <div className="space-y-0.5">
              {compactEvents
                .filter((c) => c.preTokens != null)
                .map((c) => (
                  <CompactionEventRow key={c.id} event={c} />
                ))}
            </div>
          </div>
        )}

        {/* Context growth chart */}
        {hasTokenData && costPerTurn.length > 1 && (
          <div>
            <div className="text-[10px] text-gray-500 font-medium mb-1">
              Context growth (cumulative input tokens per turn)
            </div>
            <div className="bg-gray-900/50 rounded-lg p-2 border border-gray-800">
              <ContextGrowthChart turns={costPerTurn} />
            </div>
            <div className="flex items-center gap-3 mt-1 text-[9px] text-gray-600">
              <span className="flex items-center gap-1">
                <span className="w-2 h-2 rounded-full bg-green-500 inline-block" /> token growth
              </span>
              <span className="flex items-center gap-1">
                <span
                  className="w-2 h-0.5 bg-red-500 inline-block"
                  style={{ borderTop: '1px dashed' }}
                />{' '}
                compaction
              </span>
            </div>
          </div>
        )}

        {/* Turn-by-turn detail */}
        {costPerTurn.length > 0 && (
          <div>
            <div className="text-[10px] text-gray-500 font-medium mb-1">Turn details</div>
            <div className="space-y-0.5">
              {costPerTurn.map((turn) => {
                const nodeId = `prompt-${turn.promptId}`;
                const isSelected = selectedId === nodeId;
                return (
                  <div
                    key={turn.promptId}
                    data-node-id={nodeId}
                    className={`flex items-center gap-2 text-[10px] cursor-pointer rounded px-0.5 ${
                      isSelected ? 'bg-blue-900/30 text-blue-200' : 'hover:bg-gray-800/30'
                    }`}
                    onClick={() => onSelect(nodeId)}
                  >
                    {turn.compactionBefore && (
                      <span className="text-red-400 text-[9px]" title="Compaction occurred">
                        C
                      </span>
                    )}
                    <span className="text-gray-500 w-4 text-right font-mono">
                      {turn.turnIndex + 1}
                    </span>
                    <span
                      className={`truncate flex-1 ${isSelected ? 'text-blue-200' : 'text-gray-400'}`}
                    >
                      {turn.promptText.slice(0, 30) || '(empty)'}
                    </span>
                    <span className="text-cyan-400/60 font-mono" title="Input tokens">
                      {formatTokens(turn.inputTokens)}
                    </span>
                    <span className="text-orange-400/60 font-mono" title="Output tokens">
                      {formatTokens(turn.outputTokens)}
                    </span>
                    <span className="text-gray-600 font-mono" title="Cumulative input">
                      {formatTokens(turn.cumulativeInput)}
                    </span>
                    {turn.dataSource === 'transcript' && (
                      <span className="text-[7px] text-green-400/50" title="From JSONL transcript">
                        J
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function CompactionEventRow({ event }: { event: CompactEvent }) {
  const time = new Date(event.timestamp);
  const timeStr = `${time.getHours().toString().padStart(2, '0')}:${time.getMinutes().toString().padStart(2, '0')}:${time.getSeconds().toString().padStart(2, '0')}`;
  return (
    <div className="flex items-center gap-2 text-[10px] rounded px-1 py-0.5 bg-red-950/20 border border-red-900/30">
      <span className="text-red-400 font-mono">{timeStr}</span>
      <span className="text-gray-500">{event.trigger ?? 'auto'}</span>
      {event.preTokens != null && (
        <span className="text-gray-400 ml-auto font-mono" title="Context tokens before compaction">
          {formatTokens(event.preTokens)} before
        </span>
      )}
    </div>
  );
}

function StatCard({
  label,
  value,
  sub,
  color,
}: {
  label: string;
  value: string;
  sub: string;
  color: string;
}) {
  return (
    <div className="bg-gray-900/50 rounded-lg px-2.5 py-2 border border-gray-800">
      <div className="text-[9px] text-gray-500 uppercase tracking-wider">{label}</div>
      <div className={`text-lg font-bold font-mono ${color}`}>{value}</div>
      <div className="text-[9px] text-gray-600">{sub}</div>
    </div>
  );
}
