import { useMemo, useCallback, useState, useRef, useEffect } from 'react';
import { useLens } from '../LensContext';
import { formatTokens } from '@synapse-ai/core';
import { buildCompactEvents, buildCostPerTurn } from '../lensComputations';

type ZeroTokenMode = 'show' | 'estimate' | 'hide';

/** Row height in px — must match the actual rendered row size */
const ROW_H = 22;
const COMPACT_ROW_H = 16;

function formatCost(usd: number): string {
  if (usd < 0.01) return `$${(usd * 100).toFixed(2)}\u00A2`;
  return `$${usd.toFixed(2)}`;
}

export function CostWaterfallView() {
  const { agents, events, prompts, transcripts, hasTokenData, selectedId, onSelect } = useLens();

  // Compute locally (only when cost tab is active)
  const compactEvents = useMemo(() => buildCompactEvents(events), [events]);
  const costPerTurn = useMemo(
    () => buildCostPerTurn(prompts, agents, compactEvents, transcripts),
    [prompts, agents, compactEvents, transcripts],
  );
  const [zeroMode, setZeroMode] = useState<ZeroTokenMode>('show');
  const scrollRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to selected turn row
  useEffect(() => {
    if (!selectedId) return;
    const row = scrollRef.current?.querySelector(`[data-node-id="${selectedId}"]`);
    if (row) row.scrollIntoView({ block: 'nearest' });
  }, [selectedId]);
  const hasTranscript = costPerTurn.some((t) => t.dataSource === 'transcript');

  // Filter or estimate turns based on zero-token mode
  const visibleTurns = useMemo(() => {
    if (zeroMode === 'show') return costPerTurn;
    if (zeroMode === 'hide') {
      // Filter out 0-token turns but carry their compactionBefore to the next visible turn
      const result = [];
      let pendingCompaction = false;
      for (const t of costPerTurn) {
        if (t.compactionBefore) pendingCompaction = true;
        if (t.inputTokens > 0) {
          result.push(pendingCompaction ? { ...t, compactionBefore: true } : t);
          pendingCompaction = false;
        }
      }
      return result;
    }

    const avgPerTool = (() => {
      let totalTokens = 0;
      let totalTools = 0;
      for (const t of costPerTurn) {
        if (t.inputTokens > 0 && t.toolCount > 0) {
          totalTokens += t.inputTokens;
          totalTools += t.toolCount;
        }
      }
      return totalTools > 0 ? totalTokens / totalTools : 0;
    })();

    return costPerTurn.map((t) => {
      if (t.inputTokens > 0) return t;
      const estimated = t.toolCount > 0 ? Math.round(avgPerTool * t.toolCount) : Math.round(avgPerTool);
      return { ...t, inputTokens: estimated, outputTokens: Math.round(estimated * 0.3) };
    });
  }, [costPerTurn, zeroMode]);

  // Recompute cumulative for estimated turns
  const turnsWithCumulative = useMemo(() => {
    if (zeroMode !== 'estimate') return visibleTurns;
    let cumIn = 0;
    let cumOut = 0;
    return visibleTurns.map((t) => {
      cumIn += t.inputTokens;
      cumOut += t.outputTokens;
      return { ...t, cumulativeInput: cumIn, cumulativeOutput: cumOut };
    });
  }, [visibleTurns, zeroMode]);

  const maxInput = useMemo(
    () => Math.max(...turnsWithCumulative.map((t) => t.inputTokens), 1),
    [turnsWithCumulative],
  );

  const maxCumulative = useMemo(
    () => Math.max(...turnsWithCumulative.map((t) => t.cumulativeInput), 1),
    [turnsWithCumulative],
  );

  const handleBarClick = useCallback(
    (promptId: string) => {
      onSelect(`prompt-${promptId}`);
    },
    [onSelect],
  );

  // Build cumulative context level: grows each turn, drops at compaction
  const { contextLevels, peakContext } = useMemo(() => {
    const levels: number[] = [];
    let level = 0;
    let peak = 0;
    for (const turn of turnsWithCumulative) {
      if (turn.compactionBefore) {
        // After compaction, context resets — this turn's input IS the new context size
        level = turn.inputTokens;
      } else {
        level += turn.inputTokens;
      }
      levels.push(level);
      if (level > peak) peak = level;
    }
    return { contextLevels: levels, peakContext: Math.max(peak, 1) };
  }, [turnsWithCumulative]);

  // Build the rotated area chart path: Y = time (top→bottom), X = cumulative context (left→right)
  const { areaPath, areaLinePath } = useMemo(() => {
    const n = turnsWithCumulative.length;
    if (n === 0) return { areaPath: '', areaLinePath: '', rowCenters: [] as number[] };

    // Compute Y center for each row accounting for compaction dividers
    const centers: number[] = [];
    let y = 0;
    for (let i = 0; i < n; i++) {
      if (turnsWithCumulative[i].compactionBefore) y += COMPACT_ROW_H;
      centers.push(y + ROW_H / 2);
      y += ROW_H;
    }

    const points: string[] = [];
    for (let i = 0; i < n; i++) {
      const x = (contextLevels[i] / peakContext) * 100;
      points.push(`${x},${centers[i]}`);
    }

    const area = `M0,0 L${points[0]} ${points.slice(1).map((p) => `L${p}`).join(' ')} L0,${centers[n - 1] + ROW_H / 2} Z`;
    const line = `M${points.join(' L')}`;

    return { areaPath: area, areaLinePath: line };
  }, [turnsWithCumulative, contextLevels, peakContext]);

  // Early return after all hooks
  if (!hasTokenData || costPerTurn.length === 0) {
    return (
      <div className="p-4 text-center text-gray-600 text-xs">
        No token data available yet.
      </div>
    );
  }

  // Compute total pixel height of the bar list (for SVG sizing)
  const compactionCount = turnsWithCumulative.filter((t) => t.compactionBefore).length;
  const totalH = turnsWithCumulative.length * ROW_H + compactionCount * COMPACT_ROW_H;

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* Header */}
      <div className="px-3 py-1.5 border-b border-gray-800 flex-shrink-0 flex items-center gap-2">
        <span className="text-[10px] text-gray-500 font-medium">Cost per Turn</span>
        {hasTranscript && (
          <span className="text-[8px] text-green-400/70 bg-green-900/30 px-1.5 py-0.5 rounded">JSONL</span>
        )}
        <div className="ml-auto flex items-center gap-1">
          <span className="text-[9px] text-gray-600">0-tok:</span>
          {(['show', 'estimate', 'hide'] as const).map((mode) => (
            <button
              key={mode}
              onClick={() => setZeroMode(mode)}
              className={`px-1.5 py-0.5 rounded text-[9px] transition-colors ${
                zeroMode === mode
                  ? 'bg-gray-700 text-gray-200'
                  : 'text-gray-500 hover:text-gray-300 hover:bg-gray-800/50'
              }`}
            >
              {mode}
            </button>
          ))}
        </div>
      </div>

      <div ref={scrollRef} className="flex-1 overflow-auto p-3">
        {/* Bar chart with rotated context-size area behind */}
        <div className="relative" style={{ minHeight: totalH }}>
          {/* Area chart background (rotated: Y=time top→bottom, X=context size left→right) */}
          <svg
            className="absolute left-6 top-0 pointer-events-none"
            style={{ width: 'calc(100% - 4rem)', height: totalH }}
            viewBox={`0 0 100 ${totalH}`}
            preserveAspectRatio="none"
          >
            <defs>
              <linearGradient id="ctxGradient" x1="0" y1="0" x2="1" y2="0">
                <stop offset="0%" stopColor="rgb(96, 165, 250)" stopOpacity="0.02" />
                <stop offset="100%" stopColor="rgb(96, 165, 250)" stopOpacity="0.18" />
              </linearGradient>
            </defs>
            {/* Filled area */}
            <path d={areaPath} fill="url(#ctxGradient)" />
            {/* Edge line */}
            <path d={areaLinePath} fill="none" stroke="rgb(96, 165, 250)" strokeWidth="1" strokeOpacity="0.4" vectorEffect="non-scaling-stroke" />
            {/* Max tokens reference line (right edge = peak context) */}
            <line x1="100" y1="0" x2="100" y2={totalH} stroke="rgb(239, 68, 68)" strokeWidth="1" strokeOpacity="0.25" strokeDasharray="3 3" vectorEffect="non-scaling-stroke" />
          </svg>

          {/* Max label */}
          <div
            className="absolute text-[8px] text-red-400/40 font-mono pointer-events-none"
            style={{ right: '0.25rem', top: 0 }}
          >
            {formatTokens(peakContext)}
          </div>

          {/* Bars */}
          <div className="relative">
            {turnsWithCumulative.map((turn) => {
              const barWidth = Math.max((turn.inputTokens / maxInput) * 100, 2);
              const costRatio = turn.cumulativeInput / maxCumulative;
              const hue = Math.round(120 - costRatio * 120);
              const barColor = `hsl(${hue}, 60%, 45%)`;
              const isOriginalZero = costPerTurn.find((t) => t.promptId === turn.promptId)?.inputTokens === 0;
              const isEstimated = zeroMode === 'estimate' && isOriginalZero;
              const nodeId = `prompt-${turn.promptId}`;
              const isSelected = selectedId === nodeId;

              return (
                <div key={turn.promptId} data-node-id={nodeId}>
                  {turn.compactionBefore && (
                    <div className="flex items-center gap-1.5 px-1" style={{ height: COMPACT_ROW_H }}>
                      <div className="flex-1 border-t border-dashed border-red-500/40" />
                      <span className="text-[9px] text-red-400/60">compaction</span>
                      <div className="flex-1 border-t border-dashed border-red-500/40" />
                    </div>
                  )}
                  <div
                    className={`flex items-center gap-2 group cursor-pointer rounded px-1 ${
                      isSelected ? 'bg-blue-900/20 ring-1 ring-blue-500/30' : 'hover:bg-gray-800/30'
                    }`}
                    style={{ height: ROW_H }}
                    onClick={() => handleBarClick(turn.promptId)}
                    title={[
                      `Turn ${turn.turnIndex + 1}: ${turn.promptText.slice(0, 80) || '(empty)'}${isEstimated ? ' (estimated)' : ''}`,
                      `Input: ${formatTokens(turn.inputTokens)} | Output: ${formatTokens(turn.outputTokens)}`,
                      turn.cacheReadTokens != null ? `Cache read: ${formatTokens(turn.cacheReadTokens)} | Cache write: ${formatTokens(turn.cacheCreationTokens ?? 0)}` : null,
                      turn.model ? `Model: ${turn.model}` : null,
                      turn.responseLatencyMs != null ? `Latency: ${(turn.responseLatencyMs / 1000).toFixed(1)}s` : null,
                      `Tools: ${turn.toolCount} | Cumulative: ${formatTokens(turn.cumulativeInput)}`,
                      `Source: ${turn.dataSource}`,
                    ].filter(Boolean).join('\n')}
                  >
                    <span className="text-gray-500 text-[10px] w-4 text-right font-mono flex-shrink-0">
                      {turn.turnIndex + 1}
                    </span>
                    <div className="flex-1 h-4 bg-gray-900/30 rounded overflow-hidden">
                      <div
                        className={`h-full rounded transition-all ${isEstimated ? 'opacity-50' : ''}`}
                        style={{
                          width: `${barWidth}%`,
                          backgroundColor: barColor,
                          backgroundImage: isEstimated ? 'repeating-linear-gradient(45deg, transparent, transparent 2px, rgba(0,0,0,0.2) 2px, rgba(0,0,0,0.2) 4px)' : undefined,
                        }}
                      />
                    </div>
                    <span className={`text-[10px] font-mono w-10 text-right flex-shrink-0 ${isEstimated ? 'text-gray-500 italic' : 'text-gray-400'}`}>
                      {formatTokens(turn.inputTokens)}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Legend */}
        <div className="flex items-center gap-3 mt-3 pt-2 border-t border-gray-800 text-[9px] text-gray-600">
          <span className="flex items-center gap-1">
            <span className="w-3 h-2 rounded" style={{ backgroundColor: 'hsl(120, 60%, 45%)' }} /> cheap
          </span>
          <span className="flex items-center gap-1">
            <span className="w-3 h-2 rounded" style={{ backgroundColor: 'hsl(60, 60%, 45%)' }} /> moderate
          </span>
          <span className="flex items-center gap-1">
            <span className="w-3 h-2 rounded" style={{ backgroundColor: 'hsl(0, 60%, 45%)' }} /> expensive
          </span>
          <span className="flex items-center gap-1">
            <span className="w-2 border-t border-dashed border-red-500/40" /> compaction
          </span>
          <span className="flex items-center gap-1">
            <span className="w-3 h-2 rounded bg-blue-400/15 border border-blue-400/30" /> context
          </span>
        </div>

        {/* Summary */}
        {(() => {
          const lastTurn = turnsWithCumulative[turnsWithCumulative.length - 1];
          const totalCacheRead = turnsWithCumulative.reduce((s, t) => s + (t.cacheReadTokens ?? 0), 0);
          const totalCacheWrite = turnsWithCumulative.reduce((s, t) => s + (t.cacheCreationTokens ?? 0), 0);
          const totalInput = lastTurn?.cumulativeInput ?? 0;
          const cacheHitRate = totalInput > 0 ? (totalCacheRead / totalInput) * 100 : 0;

          // Estimate cost from all transcripts
          let estimatedCost = 0;
          for (const t of transcripts.values()) {
            estimatedCost += t.estimatedCostUsd;
          }

          return (
            <div className={`mt-2 grid gap-2 text-[10px] ${hasTranscript ? 'grid-cols-3' : 'grid-cols-3'}`}>
              <div className="bg-gray-900/50 rounded px-2 py-1.5 border border-gray-800">
                <div className="text-gray-500">Total input</div>
                <div className="text-cyan-400 font-mono font-bold">
                  {formatTokens(totalInput)}
                </div>
              </div>
              <div className="bg-gray-900/50 rounded px-2 py-1.5 border border-gray-800">
                <div className="text-gray-500">Total output</div>
                <div className="text-orange-400 font-mono font-bold">
                  {formatTokens(lastTurn?.cumulativeOutput ?? 0)}
                </div>
              </div>
              <div className="bg-gray-900/50 rounded px-2 py-1.5 border border-gray-800">
                <div className="text-gray-500">Peak context</div>
                <div className="text-blue-400 font-mono font-bold">
                  {formatTokens(peakContext)}
                </div>
              </div>
              {hasTranscript && (
                <>
                  <div className="bg-gray-900/50 rounded px-2 py-1.5 border border-gray-800">
                    <div className="text-gray-500">Cache hit</div>
                    <div className="text-green-400 font-mono font-bold">
                      {cacheHitRate.toFixed(0)}%
                    </div>
                  </div>
                  <div className="bg-gray-900/50 rounded px-2 py-1.5 border border-gray-800">
                    <div className="text-gray-500">Cache R/W</div>
                    <div className="text-green-400/80 font-mono font-bold">
                      {formatTokens(totalCacheRead)}/{formatTokens(totalCacheWrite)}
                    </div>
                  </div>
                  <div className="bg-gray-900/50 rounded px-2 py-1.5 border border-gray-800">
                    <div className="text-gray-500">Est. cost</div>
                    <div className="text-yellow-400 font-mono font-bold">
                      {formatCost(estimatedCost)}
                    </div>
                  </div>
                </>
              )}
            </div>
          );
        })()}
      </div>
    </div>
  );
}
