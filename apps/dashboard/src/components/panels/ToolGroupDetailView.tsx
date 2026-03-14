// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Bernhard

import { useState, useMemo } from 'react';
import type { ToolCallSummary, AgentNodeData } from '@synapse-ai/core';
import { formatDuration, getToolIcon } from '@synapse-ai/core';
import { PanelShell, Detail, Stat, Divider, StatusBadge } from './AgentDetailPanel';
import { TOOL_COLORS } from '../analytics/shared/constants';
import { Tooltip } from '../ui/Tooltip';

// ── Types ────────────────────────────────────────────────────────

interface ToolGroupDetailViewProps {
  /** Parent node ID, e.g. 'agent-abc123' or 'prompt-xyz' */
  parentNodeId: string;
  /** Pre-resolved leaf tools from the toolgroup node's data */
  tools: ToolCallSummary[];
  agents: Map<string, AgentNodeData>;
  selectNode: (id: string | null, source?: 'graph' | 'lens') => void;
  onClose: () => void;
}

interface ToolTypeInfo {
  count: number;
  duration: number;
  errors: number;
}

interface ConcurrencyInterval {
  from: number;
  to: number;
  concurrency: number;
}

// ── Main Component ───────────────────────────────────────────────

export function ToolGroupDetailView({
  parentNodeId,
  tools: leafTools,
  agents,
  selectNode,
  onClose,
}: ToolGroupDetailViewProps) {
  // Extract the raw agent ID if parent is an agent node
  const agentId = parentNodeId.startsWith('agent-') ? parentNodeId.slice(6) : null;
  const parentAgent = agentId ? agents.get(agentId) : null;

  // Compute all stats in a single pass
  const stats = useMemo(() => {
    let ok = 0;
    let err = 0;
    let running = 0;
    let totalDuration = 0;
    let minStart = Infinity;
    let maxEnd = 0;
    let slowest: ToolCallSummary | null = null;
    const toolBreakdown = new Map<string, ToolTypeInfo>();
    const errorTools: ToolCallSummary[] = [];

    for (const t of leafTools) {
      if (t.status === 'success') ok++;
      else if (t.status === 'error') {
        err++;
        errorTools.push(t);
      } else running++;

      const dur = t.duration ?? 0;
      totalDuration += dur;

      if (t.startTime < minStart) minStart = t.startTime;
      const end = t.endTime ?? (t.status === 'running' ? Date.now() : t.startTime);
      if (end > maxEnd) maxEnd = end;

      if (!slowest || dur > (slowest.duration ?? 0)) slowest = t;

      const info = toolBreakdown.get(t.toolName) ?? { count: 0, duration: 0, errors: 0 };
      info.count++;
      info.duration += dur;
      if (t.status === 'error') info.errors++;
      toolBreakdown.set(t.toolName, info);
    }

    // Most called tool type
    let mostCalled: { name: string; count: number } | null = null;
    for (const [name, info] of toolBreakdown) {
      if (!mostCalled || info.count > mostCalled.count) {
        mostCalled = { name, count: info.count };
      }
    }

    const wallClock = maxEnd > minStart ? maxEnd - minStart : 0;

    // Sweep-line for concurrency
    const events: Array<{ time: number; delta: number }> = [];
    for (const t of leafTools) {
      events.push({ time: t.startTime, delta: 1 });
      events.push({
        time: t.endTime ?? (t.status === 'running' ? Date.now() : t.startTime),
        delta: -1,
      });
    }
    events.sort((a, b) => a.time - b.time || a.delta - b.delta);

    let current = 0;
    let peak = 0;
    const concurrencyPoints: Array<{ time: number; concurrency: number }> = [];
    for (const ev of events) {
      current += ev.delta;
      if (current > peak) peak = current;
      concurrencyPoints.push({ time: ev.time, concurrency: current });
    }

    // Build intervals for binning
    const intervals: ConcurrencyInterval[] = [];
    for (let i = 0; i < concurrencyPoints.length - 1; i++) {
      intervals.push({
        from: concurrencyPoints[i].time,
        to: concurrencyPoints[i + 1].time,
        concurrency: concurrencyPoints[i].concurrency,
      });
    }

    return {
      total: leafTools.length,
      ok,
      err,
      running,
      totalDuration,
      wallClock,
      minStart: minStart === Infinity ? 0 : minStart,
      maxEnd,
      distinctTools: toolBreakdown.size,
      toolBreakdown,
      slowest,
      mostCalled,
      errorTools,
      peakConcurrency: peak,
      intervals,
    };
  }, [leafTools]);

  if (leafTools.length === 0) {
    return (
      <PanelShell title="Tool Group" onClose={onClose}>
        <div className="p-4 text-sm text-gray-500">No leaf tools for this agent.</div>
      </PanelShell>
    );
  }

  return (
    <PanelShell
      title="Tool Group"
      titleRight={<span className="text-[10px] text-gray-500">{stats.total} calls</span>}
      onClose={onClose}
    >
      <div className="p-4 space-y-3 text-sm flex-1 overflow-auto">
        {/* Section 1: Summary */}
        <SummarySection
          stats={stats}
          parentNodeId={parentNodeId}
          parentAgent={parentAgent ?? undefined}
          selectNode={selectNode}
        />

        <Divider />

        {/* Section 2: Tool Breakdown */}
        <BreakdownTable breakdown={stats.toolBreakdown} />

        <Divider />

        {/* Section 3: Performance Insights */}
        <InsightsSection stats={stats} selectNode={selectNode} />

        <Divider />

        {/* Section 4: Timeline Minimap */}
        <TimelineMinimap tools={leafTools} stats={stats} selectNode={selectNode} />

        <Divider />

        {/* Section 5: Execution Pattern */}
        <ExecutionPattern stats={stats} />
      </div>
    </PanelShell>
  );
}

// ── Section 1: Summary ───────────────────────────────────────────

function SummarySection({
  stats,
  parentNodeId,
  parentAgent,
  selectNode,
}: {
  stats: {
    total: number;
    ok: number;
    err: number;
    running: number;
    totalDuration: number;
    wallClock: number;
    distinctTools: number;
  };
  parentNodeId: string;
  parentAgent: AgentNodeData | undefined;
  selectNode: (id: string | null, source?: 'graph' | 'lens') => void;
}) {
  return (
    <div className="space-y-2">
      <div className="flex gap-4">
        <Stat label="Total Calls" value={stats.total} />
        <Stat label="Tool Types" value={stats.distinctTools} />
      </div>

      <div className="flex items-center gap-2 text-xs">
        {stats.ok > 0 && (
          <>
            <StatusBadge status="success" />
            <span className="text-gray-400">{stats.ok}</span>
          </>
        )}
        {stats.err > 0 && (
          <>
            <StatusBadge status="error" />
            <span className="text-gray-400">{stats.err}</span>
          </>
        )}
        {stats.running > 0 && (
          <>
            <StatusBadge status="running" />
            <span className="text-gray-400">{stats.running}</span>
          </>
        )}
      </div>

      <div className="flex justify-between">
        <Detail label="Total Σ" value={formatDuration(stats.totalDuration)} />
        {stats.wallClock > 0 && (
          <Detail label="Wall Clock" value={formatDuration(stats.wallClock)} />
        )}
      </div>

      <div>
        <span className="text-gray-500 text-xs">Parent</span>
        <Tooltip content="Jump to parent agent">
          <button
            onClick={() => selectNode(parentNodeId, 'graph')}
            className="block text-xs text-blue-400 hover:text-blue-300 underline"
          >
            {parentAgent?.agentType ?? parentNodeId.slice(0, 18)}
          </button>
        </Tooltip>
      </div>
    </div>
  );
}

// ── Section 2: Breakdown Table ───────────────────────────────────

function BreakdownTable({ breakdown }: { breakdown: Map<string, ToolTypeInfo> }) {
  const [sortBy, setSortBy] = useState<'count' | 'duration'>('count');

  const rows = useMemo(() => {
    const arr = [...breakdown.entries()].map(([name, info]) => ({ name, ...info }));
    arr.sort((a, b) => (sortBy === 'count' ? b.count - a.count : b.duration - a.duration));
    return arr;
  }, [breakdown, sortBy]);

  return (
    <div>
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-gray-500 text-xs">Breakdown</span>
        <div className="flex items-center gap-0.5 bg-gray-900 border border-gray-700 rounded-md p-0.5">
          <Tooltip content="Sort by call count">
            <button
              onClick={() => setSortBy('count')}
              className={`px-2 py-0.5 text-[10px] font-medium rounded transition-colors ${
                sortBy === 'count'
                  ? 'bg-purple-500/20 text-purple-400'
                  : 'text-gray-500 hover:text-gray-300'
              }`}
            >
              Count
            </button>
          </Tooltip>
          <Tooltip content="Sort by total duration">
            <button
              onClick={() => setSortBy('duration')}
              className={`px-2 py-0.5 text-[10px] font-medium rounded transition-colors ${
                sortBy === 'duration'
                  ? 'bg-purple-500/20 text-purple-400'
                  : 'text-gray-500 hover:text-gray-300'
              }`}
            >
              Duration
            </button>
          </Tooltip>
        </div>
      </div>
      <div className="space-y-1">
        {rows.map((row) => (
          <div
            key={row.name}
            className="flex items-center gap-2 bg-gray-900/50 rounded px-2 py-1.5 text-xs"
          >
            <span className="text-gray-200 flex-shrink-0">{getToolIcon(row.name)}</span>
            <span className="text-gray-300 truncate flex-1">{row.name}</span>
            <span className="text-gray-400 font-mono text-[10px]">x{row.count}</span>
            <span className="text-gray-500 font-mono text-[10px]">
              Σ{formatDuration(row.duration)}
            </span>
            {row.errors > 0 && (
              <span className="text-red-400 font-mono text-[10px]">{row.errors} err</span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Section 3: Performance Insights ──────────────────────────────

function InsightsSection({
  stats,
  selectNode,
}: {
  stats: {
    total: number;
    totalDuration: number;
    slowest: ToolCallSummary | null;
    mostCalled: { name: string; count: number } | null;
    errorTools: ToolCallSummary[];
  };
  selectNode: (id: string | null, source?: 'graph' | 'lens') => void;
}) {
  return (
    <div className="space-y-1.5">
      <span className="text-gray-500 text-xs block">Insights</span>

      {/* Slowest */}
      {stats.slowest && stats.slowest.duration != null && (
        <div className="flex items-center justify-between bg-gray-900/50 rounded px-2 py-1.5">
          <span className="text-xs text-gray-400">Slowest</span>
          <button
            onClick={() => selectNode(`tool-${stats.slowest!.toolUseId}`, 'graph')}
            className="text-xs text-blue-400 hover:text-blue-300 underline font-mono"
          >
            {stats.slowest.toolName} — {formatDuration(stats.slowest.duration)}
          </button>
        </div>
      )}

      {/* Most called */}
      {stats.mostCalled && (
        <div className="flex items-center justify-between bg-gray-900/50 rounded px-2 py-1.5">
          <span className="text-xs text-gray-400">Most Called</span>
          <span className="text-xs text-gray-300 font-mono">
            {stats.mostCalled.name} x{stats.mostCalled.count}
          </span>
        </div>
      )}

      {/* Average duration */}
      <div className="flex items-center justify-between bg-gray-900/50 rounded px-2 py-1.5">
        <span className="text-xs text-gray-400">Avg Duration</span>
        <span className="text-xs text-gray-300 font-mono">
          {stats.total > 0 ? formatDuration(stats.totalDuration / stats.total) : '—'}
        </span>
      </div>

      {/* Errors */}
      {stats.errorTools.length > 0 && (
        <div>
          <span className="text-red-400 text-xs block mb-1">
            Errors ({stats.errorTools.length})
          </span>
          <div className="space-y-1 max-h-32 overflow-auto">
            {stats.errorTools.map((tc, i) => (
              <button
                key={`${tc.toolUseId}-${i}`}
                onClick={() => selectNode(`tool-${tc.toolUseId}`, 'graph')}
                className="w-full text-left flex items-center justify-between bg-red-900/20 hover:bg-red-900/30 border border-red-800/30 rounded px-2 py-1 text-xs text-red-300 transition-colors"
              >
                <span>{tc.toolName}</span>
                <span className="text-[10px] text-red-400 font-mono">
                  {tc.duration != null ? formatDuration(tc.duration) : '—'}
                </span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Section 4: Timeline Minimap ──────────────────────────────────

function TimelineMinimap({
  tools,
  stats,
  selectNode,
}: {
  tools: ToolCallSummary[];
  stats: { wallClock: number; minStart: number };
  selectNode: (id: string | null, source?: 'graph' | 'lens') => void;
}) {
  const segments = useMemo(() => {
    if (stats.wallClock === 0) return [];
    return tools.map((tc) => {
      const start = (tc.startTime - stats.minStart) / stats.wallClock;
      const end =
        ((tc.endTime ?? (tc.status === 'running' ? Date.now() : tc.startTime)) - stats.minStart) /
        stats.wallClock;
      const width = Math.max(end - start, 0.02);
      return { tc, left: start, width };
    });
  }, [tools, stats]);

  if (segments.length === 0) return null;

  return (
    <div>
      <span className="text-gray-500 text-xs block mb-1.5">Timeline</span>
      <div className="relative h-6 bg-gray-900 rounded overflow-hidden border border-gray-800">
        {segments.map(({ tc, left, width }, i) => (
          <button
            key={`${tc.toolUseId}-${i}`}
            onClick={() => selectNode(`tool-${tc.toolUseId}`, 'graph')}
            title={`${tc.toolName} — ${tc.duration != null ? formatDuration(tc.duration) : '?'}`}
            className="absolute top-0.5 bottom-0.5 rounded-sm cursor-pointer hover:brightness-125 transition-all"
            style={{
              left: `${left * 100}%`,
              width: `${width * 100}%`,
              backgroundColor: TOOL_COLORS[tc.toolName] ?? '#6b7280',
              opacity: tc.status === 'error' ? 0.85 : 0.7,
            }}
          />
        ))}
      </div>
      <div className="flex justify-between text-[8px] text-gray-600 mt-0.5 px-0.5">
        <span>0s</span>
        <span>{formatDuration(stats.wallClock)}</span>
      </div>
    </div>
  );
}

// ── Section 5: Execution Pattern ─────────────────────────────────

function ExecutionPattern({
  stats,
}: {
  stats: {
    total: number;
    totalDuration: number;
    peakConcurrency: number;
    wallClock: number;
    minStart: number;
    intervals: ConcurrencyInterval[];
  };
}) {
  const isParallel = stats.peakConcurrency > 1;
  const speedup =
    stats.wallClock > 0 && stats.totalDuration > 0 ? stats.totalDuration / stats.wallClock : 0;

  const bins = useMemo(() => {
    if (stats.wallClock === 0 || stats.intervals.length === 0) return [];
    const numBins = 40;
    const binWidth = stats.wallClock / numBins;
    const result = new Array<number>(numBins).fill(0);
    for (const interval of stats.intervals) {
      const startBin = Math.max(0, Math.floor((interval.from - stats.minStart) / binWidth));
      const endBin = Math.min(numBins - 1, Math.floor((interval.to - stats.minStart) / binWidth));
      for (let b = startBin; b <= endBin; b++) {
        result[b] = Math.max(result[b], interval.concurrency);
      }
    }
    return result;
  }, [stats]);

  const maxBin = Math.max(...bins, 1);
  const binWidth = bins.length > 0 ? stats.wallClock / bins.length : 0;

  return (
    <div>
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-gray-500 text-xs">Execution</span>
        <span
          className={`text-[10px] px-1.5 py-0.5 rounded-full ${
            isParallel ? 'bg-purple-900/50 text-purple-300' : 'bg-gray-700/50 text-gray-400'
          }`}
        >
          {isParallel ? `Parallel (peak ${stats.peakConcurrency})` : 'Sequential'}
        </span>
      </div>

      {bins.length > 0 && (
        <>
          <div className="flex items-end gap-px h-8 bg-gray-900 rounded border border-gray-800 p-0.5">
            {bins.map((val, i) => (
              <div
                key={i}
                title={`${val} concurrent · ${formatDuration(i * binWidth)}–${formatDuration((i + 1) * binWidth)}`}
                className="flex-1 rounded-sm cursor-default hover:brightness-150 transition-all"
                style={{
                  height: `${(val / maxBin) * 100}%`,
                  backgroundColor: val > 1 ? '#a78bfa' : '#4b5563',
                  minHeight: val > 0 ? 2 : 0,
                  opacity: 0.8,
                }}
              />
            ))}
          </div>
          <div className="flex justify-between text-[8px] text-gray-600 mt-0.5 px-0.5">
            <span>0s</span>
            <span>{formatDuration(stats.wallClock)}</span>
          </div>
        </>
      )}

      {/* Parallelism efficiency */}
      {stats.wallClock > 0 && stats.total > 1 && (
        <div className="flex items-center justify-between bg-gray-900/50 rounded px-2 py-1.5 mt-1.5">
          <span className="text-xs text-gray-400">Speedup</span>
          <span className="text-xs font-mono text-gray-300">
            {speedup >= 1.05
              ? `${speedup.toFixed(1)}x (saved ${formatDuration(stats.totalDuration - stats.wallClock)})`
              : '1.0x (sequential)'}
          </span>
        </div>
      )}
    </div>
  );
}
