// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Bernhard

import { memo, useMemo } from 'react';
import { Handle, type NodeProps } from '@xyflow/react';
import type { ToolCallSummary } from '@synapse-ai/core';
import { formatDuration, getToolIcon } from '@synapse-ai/core';
import { useHandlePositions } from '../../../hooks/useHandlePositions';
import { useTranscriptDetail, findThinkingForTool } from '../../../hooks/useTranscriptDetail';
import { useAgentStore } from '../../../store/agentStore';
import { Tooltip } from '../../ui/Tooltip';
import { GAME_MODES_ENABLED, GAME_MODE_REGISTRY, ArcadeOverlay } from './game-modes';

// ── Tool color map (shared across modes) ─────────────────────

const TOOL_COLORS: Record<string, string> = {
  Read: '#0d9488', // teal-600
  Edit: '#7c3aed', // violet-600
  Bash: '#ea580c', // orange-600
  Grep: '#2563eb', // blue-600
  Glob: '#0891b2', // cyan-600
  Write: '#9333ea', // purple-600
  Task: '#059669', // emerald-600
  WebSearch: '#d97706', // amber-600
  WebFetch: '#d97706', // amber-600
  TodoWrite: '#4f46e5', // indigo-600
};

const TOOL_BG_CLASSES: Record<string, string> = {
  Read: 'bg-teal-900/60 border-teal-700/40 text-teal-200',
  Edit: 'bg-violet-900/60 border-violet-700/40 text-violet-200',
  Bash: 'bg-orange-900/60 border-orange-700/40 text-orange-200',
  Grep: 'bg-blue-900/60 border-blue-700/40 text-blue-200',
  Glob: 'bg-cyan-900/60 border-cyan-700/40 text-cyan-200',
  Write: 'bg-purple-900/60 border-purple-700/40 text-purple-200',
  Task: 'bg-emerald-900/60 border-emerald-700/40 text-emerald-200',
  WebSearch: 'bg-amber-900/60 border-amber-700/40 text-amber-200',
  WebFetch: 'bg-amber-900/60 border-amber-700/40 text-amber-200',
  TodoWrite: 'bg-indigo-900/60 border-indigo-700/40 text-indigo-200',
};

const DEFAULT_COLOR = '#6b7280';
const DEFAULT_BG_CLASS = 'bg-gray-800/60 border-gray-700/40 text-gray-300';

function getToolColor(name: string): string {
  return TOOL_COLORS[name] ?? DEFAULT_COLOR;
}

function getToolBgClass(name: string): string {
  return TOOL_BG_CLASSES[name] ?? DEFAULT_BG_CLASS;
}

// ── Status colors ────────────────────────────────────────────

const STATUS_DOT: Record<string, string> = {
  running: 'bg-purple-400',
  success: 'bg-teal-400',
  error: 'bg-red-400',
};

const STATUS_HEATMAP: Record<string, string> = {
  running: '#a78bfa',
  success: '#2dd4bf',
  error: '#f87171',
};

// ── Data shape ───────────────────────────────────────────────

export interface ToolGroupData {
  tools: ToolCallSummary[];
  parentAgentId: string;
}

// ── Max items per pill grid column ───────────────────────────

export const PILL_MAX_ROWS = 6;

// ── Component ────────────────────────────────────────────────

function ToolGroupNodeComponent({ data }: NodeProps) {
  const { tools, parentAgentId } = data as unknown as ToolGroupData;
  const showAllTools = useAgentStore((s) => s.showAllTools);
  const toolGroupMode = useAgentStore((s) => s.toolGroupMode);
  // Only subscribe to selectedNodeId when expanded — collapsed mode doesn't use it
  const selectedNodeId = useAgentStore((s) => (s.showAllTools ? s.selectedNodeId : null));
  const selectNode = useAgentStore((s) => s.selectNode);
  // Narrow selector: only re-render when THIS agent's data changes
  const agentData = useAgentStore((s) => s.agents.get(parentAgentId));
  const { target } = useHandlePositions();
  const arcadeMode = useAgentStore((s) => s.arcadeMode);
  const arcadeSoundEnabled = useAgentStore((s) => s.arcadeSoundEnabled);
  const arcadeVolume = useAgentStore((s) => s.arcadeVolume);

  // Find the active game mode's scorer (if any)
  const activeScorer = useMemo(() => {
    const mode = GAME_MODE_REGISTRY.find((m) => m.id === toolGroupMode);
    return mode?.scorer;
  }, [toolGroupMode]);

  // Reasoning tooltip support
  const { reasoning, ensureLoaded } = useTranscriptDetail(agentData?.sessionId);

  // Stats
  const stats = useMemo(() => {
    let ok = 0;
    let err = 0;
    let running = 0;
    let totalDuration = 0;
    let minStart = Infinity;
    let maxEnd = 0;
    const toolNames = new Set<string>();
    for (const t of tools) {
      if (t.status === 'success') ok++;
      else if (t.status === 'error') err++;
      else running++;
      if (t.duration != null) totalDuration += t.duration;
      if (t.startTime < minStart) minStart = t.startTime;
      const end = t.endTime ?? t.startTime;
      if (end > maxEnd) maxEnd = end;
      toolNames.add(t.toolName);
    }
    const wallClock = maxEnd > minStart ? maxEnd - minStart : 0;
    return {
      ok,
      err,
      running,
      totalDuration,
      wallClock,
      startTime: minStart === Infinity ? 0 : minStart,
      endTime: maxEnd,
      distinctTools: toolNames.size,
    };
  }, [tools]);

  // ── Collapsed state ──────────────────────────────────────

  if (!showAllTools) {
    return (
      <div
        onMouseEnter={ensureLoaded}
        className="relative bg-gray-800/80 border border-gray-700/50 rounded-lg px-3 py-1.5 flex items-center gap-2 text-xs shadow-sm"
        style={{ minWidth: 180 }}
      >
        <Handle
          type="target"
          position={target}
          className="!bg-purple-300 !w-2 !h-2 !border !border-gray-800"
        />
        <Tooltip content={`${tools.length} tool calls — click or press F to expand`} shortcut="F">
          <span className="text-gray-400 font-medium">[{tools.length}] tools</span>
        </Tooltip>
        {stats.totalDuration > 0 && (
          <span className="text-gray-500 text-[9px] font-mono">
            Σ {formatDuration(stats.totalDuration)}
          </span>
        )}
        <span className="flex gap-0.5 ml-auto">
          {tools.slice(0, 8).map((t, i) => (
            <span
              key={`${t.toolUseId}-${i}`}
              className={`w-1.5 h-1.5 rounded-full ${STATUS_DOT[t.status]}`}
            />
          ))}
          {tools.length > 8 && (
            <span className="text-gray-600 text-[8px] ml-0.5">+{tools.length - 8}</span>
          )}
        </span>
      </div>
    );
  }

  // ── Expanded: render by mode ─────────────────────────────

  return (
    <div
      onMouseEnter={ensureLoaded}
      className="relative bg-[#1a1d27] border border-gray-700/50 rounded-lg shadow-md"
      style={{ minWidth: 200 }}
    >
      <Handle
        type="target"
        position={target}
        className="!bg-purple-300 !w-2 !h-2 !border !border-gray-800"
      />

      {/* Header */}
      <div className="px-3 py-1.5 border-b border-gray-700/30 space-y-0.5">
        {/* Row 1: title + count + types + status breakdown */}
        <div className="flex items-center justify-between">
          <span className="flex items-center gap-1.5">
            <span className="text-[9px] font-semibold uppercase tracking-wider text-purple-400/70">
              Tool Calls
            </span>
            <span className="text-[10px] text-gray-400 font-medium">{tools.length}</span>
            {stats.distinctTools > 1 && (
              <span className="text-[9px] text-gray-600">· {stats.distinctTools} types</span>
            )}
          </span>
          <span className="text-[10px] text-gray-500">
            {stats.ok > 0 && <span className="text-teal-400">{stats.ok} ok</span>}
            {stats.err > 0 && <span className="text-red-400 ml-1.5">{stats.err} err</span>}
            {stats.running > 0 && (
              <span className="text-purple-400 ml-1.5">{stats.running} running</span>
            )}
          </span>
        </div>
        {/* Row 2: total duration */}
        {stats.totalDuration > 0 && (
          <div className="flex items-center">
            <Tooltip content="Sum of individual durations (not wall-clock)">
              <span className="text-[10px] text-gray-400 font-mono">
                Σ {formatDuration(stats.totalDuration)}
              </span>
            </Tooltip>
          </div>
        )}
      </div>

      {/* Mode content */}
      <ArcadeOverlay
        enabled={arcadeMode && GAME_MODES_ENABLED}
        soundEnabled={arcadeSoundEnabled}
        volume={arcadeVolume}
        tools={tools}
        scorer={activeScorer}
      >
        <div className="p-2">
          {toolGroupMode === 'pillGrid' && (
            <PillGridView
              tools={tools}
              selectedNodeId={selectedNodeId}
              selectNode={selectNode}
              reasoning={reasoning}
            />
          )}
          {toolGroupMode === 'timeline' && (
            <TimelineView tools={tools} selectedNodeId={selectedNodeId} selectNode={selectNode} />
          )}
          {toolGroupMode === 'heatmap' && (
            <HeatmapView tools={tools} selectedNodeId={selectedNodeId} selectNode={selectNode} />
          )}
          {GAME_MODES_ENABLED &&
            (() => {
              const mode = GAME_MODE_REGISTRY.find((m) => m.id === toolGroupMode);
              if (!mode) return null;
              const GameMode = mode.component;
              return (
                <GameMode tools={tools} selectedNodeId={selectedNodeId} selectNode={selectNode} />
              );
            })()}
        </div>
      </ArcadeOverlay>
    </div>
  );
}

// ── Pill Grid View ───────────────────────────────────────────

function PillGridView({
  tools,
  selectedNodeId,
  selectNode,
  reasoning,
}: {
  tools: ToolCallSummary[];
  selectedNodeId: string | null;
  selectNode: (id: string | null, source?: 'graph' | 'lens') => void;
  reasoning?: import('@synapse-ai/core').ReasoningData;
}) {
  const numCols = Math.ceil(tools.length / PILL_MAX_ROWS);
  return (
    <div
      role="listbox"
      aria-label="Tool calls"
      className="grid gap-1"
      style={{
        gridTemplateColumns: `repeat(${numCols}, minmax(110px, 1fr))`,
        gridAutoFlow: 'column',
        gridTemplateRows: `repeat(${Math.min(tools.length, PILL_MAX_ROWS)}, 1fr)`,
      }}
    >
      {tools.map((tc, i) => {
        const nodeId = `tool-${tc.toolUseId}`;
        const isSelected = selectedNodeId === nodeId;
        const duration = tc.duration != null ? formatDuration(tc.duration) : null;
        const thinking = findThinkingForTool(reasoning, tc.toolUseId);
        return (
          <Tooltip
            key={`${tc.toolUseId}-${i}`}
            content={
              thinking
                ? `Reasoning: ${thinking}`
                : `${tc.toolName} \u00b7 ${tc.status}${duration ? ` \u00b7 ${duration}` : ''}`
            }
          >
            <button
              role="option"
              aria-selected={isSelected}
              data-tool-id={nodeId}
              onClick={(e) => {
                e.stopPropagation();
                selectNode(nodeId, 'graph');
              }}
              className={`
                flex items-center gap-1 px-1.5 py-0.5 rounded border text-[10px] font-medium
                transition-all cursor-pointer text-left truncate
                ${getToolBgClass(tc.toolName)}
                ${isSelected ? 'ring-1 ring-purple-400 ring-offset-1 ring-offset-gray-900' : 'hover:brightness-125'}
              `}
            >
              <span className="text-[8px] text-white/80 flex-shrink-0 font-mono w-3 text-right">
                {i + 1}
              </span>
              <span className="opacity-70 flex-shrink-0">{getToolIcon(tc.toolName)}</span>
              <span className="truncate">{tc.toolName}</span>
              {thinking && (
                <span className="text-yellow-500/60 text-[8px] flex-shrink-0">
                  {'\uD83D\uDCAD'}
                </span>
              )}
              {duration && <span className="text-[8px] opacity-60 flex-shrink-0">{duration}</span>}
              <span
                className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ml-auto ${STATUS_DOT[tc.status]}`}
              />
            </button>
          </Tooltip>
        );
      })}
    </div>
  );
}

// ── Timeline View ────────────────────────────────────────────

function TimelineView({
  tools,
  selectedNodeId,
  selectNode,
}: {
  tools: ToolCallSummary[];
  selectedNodeId: string | null;
  selectNode: (id: string | null, source?: 'graph' | 'lens') => void;
}) {
  const { totalDuration, segments } = useMemo(() => {
    let total = 0;
    for (const t of tools) total += t.duration ?? 100;
    const segs = tools.map((t) => ({
      tc: t,
      pct: Math.max(((t.duration ?? 100) / total) * 100, 3),
      color: getToolColor(t.toolName),
    }));
    // Normalize to ~100%
    const sumPct = segs.reduce((a, s) => a + s.pct, 0);
    if (sumPct > 0) {
      for (const s of segs) s.pct = (s.pct / sumPct) * 100;
    }
    return { totalDuration: total, segments: segs };
  }, [tools]);

  // Unique tool names for legend
  const legend = useMemo(() => {
    const seen = new Set<string>();
    const items: { name: string; color: string }[] = [];
    for (const t of tools) {
      if (seen.has(t.toolName)) continue;
      seen.add(t.toolName);
      items.push({ name: t.toolName, color: getToolColor(t.toolName) });
    }
    return items;
  }, [tools]);

  return (
    <div style={{ minWidth: 350 }}>
      {/* Bar */}
      <div
        role="listbox"
        aria-label="Tool calls timeline"
        className="flex rounded overflow-hidden h-8"
      >
        {segments.map(({ tc, pct, color }, i) => {
          const nodeId = `tool-${tc.toolUseId}`;
          const isSelected = selectedNodeId === nodeId;
          const isError = tc.status === 'error';
          return (
            <button
              key={`${tc.toolUseId}-${i}`}
              role="option"
              aria-selected={isSelected}
              data-tool-id={nodeId}
              onClick={(e) => {
                e.stopPropagation();
                selectNode(nodeId, 'graph');
              }}
              title={`${tc.toolName} · ${tc.status}${tc.duration != null ? ` · ${formatDuration(tc.duration)}` : ''}`}
              className={`relative transition-all cursor-pointer border-r border-gray-900/30 last:border-r-0 ${isSelected ? 'ring-1 ring-purple-400 z-10' : 'hover:brightness-125'}`}
              style={{
                width: `${pct}%`,
                minWidth: 4,
                backgroundColor: color,
                opacity: isError ? 0.85 : 0.7,
                backgroundImage: isError
                  ? 'repeating-linear-gradient(45deg, transparent, transparent 3px, rgba(0,0,0,0.2) 3px, rgba(0,0,0,0.2) 6px)'
                  : undefined,
              }}
            />
          );
        })}
      </div>

      {/* Time axis */}
      <div className="flex justify-between text-[8px] text-gray-600 mt-0.5 px-0.5">
        <span>0s</span>
        <span>{formatDuration(totalDuration)}</span>
      </div>

      {/* Legend */}
      <div className="flex flex-wrap gap-x-2 gap-y-0.5 mt-1">
        {legend.map(({ name, color }) => (
          <span key={name} className="flex items-center gap-1 text-[9px] text-gray-400">
            <span
              className="w-2 h-2 rounded-sm flex-shrink-0"
              style={{ backgroundColor: color, opacity: 0.7 }}
            />
            {name}
          </span>
        ))}
      </div>
    </div>
  );
}

// ── Heatmap View ─────────────────────────────────────────────

function HeatmapView({
  tools,
  selectedNodeId,
  selectNode,
}: {
  tools: ToolCallSummary[];
  selectedNodeId: string | null;
  selectNode: (id: string | null, source?: 'graph' | 'lens') => void;
}) {
  const { rows, maxDuration, chronoIndex } = useMemo(() => {
    // Group by toolName, each invocation is a column
    const byName = new Map<string, ToolCallSummary[]>();
    for (const t of tools) {
      const list = byName.get(t.toolName) ?? [];
      list.push(t);
      byName.set(t.toolName, list);
    }
    const sorted = [...byName.entries()].sort((a, b) => a[0].localeCompare(b[0]));
    let maxDur = 0;
    // Build chronological index: toolUseId → 1-based position in flat array
    const chrono = new Map<string, number>();
    for (let i = 0; i < tools.length; i++) {
      if (tools[i].duration != null && tools[i].duration! > maxDur) maxDur = tools[i].duration!;
      chrono.set(tools[i].toolUseId, i + 1);
    }
    return { rows: sorted, maxDuration: maxDur || 1, chronoIndex: chrono };
  }, [tools]);

  return (
    <div role="listbox" aria-label="Tool calls heatmap" style={{ minWidth: 200 }}>
      {rows.map(([name, calls]) => (
        <div key={name} className="flex items-center gap-1 mb-0.5">
          <span
            className="text-[9px] text-gray-500 truncate w-14 flex-shrink-0 text-right"
            title={name}
          >
            {name}
          </span>
          <div className="flex flex-wrap gap-0.5" style={{ maxWidth: 20 * 22 + 19 * 2 }}>
            {calls.map((tc, i) => {
              const nodeId = `tool-${tc.toolUseId}`;
              const isSelected = selectedNodeId === nodeId;
              const alpha = 0.3 + ((tc.duration ?? 0) / maxDuration) * 0.7;
              const hex = STATUS_HEATMAP[tc.status] ?? STATUS_HEATMAP.success;
              const r = parseInt(hex.slice(1, 3), 16);
              const g = parseInt(hex.slice(3, 5), 16);
              const b = parseInt(hex.slice(5, 7), 16);
              return (
                <button
                  key={`${tc.toolUseId}-${i}`}
                  role="option"
                  aria-selected={isSelected}
                  data-tool-id={nodeId}
                  onClick={(e) => {
                    e.stopPropagation();
                    selectNode(nodeId, 'graph');
                  }}
                  title={`#${chronoIndex.get(tc.toolUseId)} ${tc.toolName} · ${tc.status}${tc.duration != null ? ` · ${formatDuration(tc.duration)}` : ''}`}
                  className={`rounded-sm transition-all cursor-pointer flex items-center justify-center ${isSelected ? 'ring-1 ring-purple-400' : 'hover:brightness-125'}`}
                  style={{
                    width: 22,
                    height: 22,
                    backgroundColor: `rgba(${r},${g},${b},${alpha})`,
                  }}
                >
                  <span className="text-[7px] font-mono leading-none text-white/90">
                    {chronoIndex.get(tc.toolUseId)}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      ))}
      {/* Legend */}
      <div className="flex gap-2 mt-1.5 pt-1 border-t border-gray-700/30">
        {Object.entries(STATUS_HEATMAP).map(([status, color]) => (
          <span key={status} className="flex items-center gap-1 text-[8px] text-gray-500">
            <span className="w-2 h-2 rounded-sm" style={{ backgroundColor: color, opacity: 0.7 }} />
            {status}
          </span>
        ))}
      </div>
    </div>
  );
}

export const ToolGroupNode = memo(ToolGroupNodeComponent);
