// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Synapse Contributors

import { useMemo } from 'react';
import type { ToolCallSummary } from '@synapse-ai/core';
import { formatDuration } from '@synapse-ai/core';
import type { GameModeProps } from './types';
import { Tooltip } from '../../../ui/Tooltip';

// ── Constants ────────────────────────────────────────────────

const TOOL_COLORS: Record<string, string> = {
  Read: '#0d9488', Edit: '#7c3aed', Bash: '#ea580c', Grep: '#2563eb',
  Glob: '#0891b2', Write: '#9333ea', Task: '#059669', WebSearch: '#d97706',
  WebFetch: '#d97706', TodoWrite: '#4f46e5',
};
const DEFAULT_COLOR = '#6b7280';

function getColor(name: string) { return TOOL_COLORS[name] ?? DEFAULT_COLOR; }

const CELL = 24;

// ── Seeded PRNG ──────────────────────────────────────────────

function mulberry32(seed: number) {
  return () => {
    seed |= 0; seed = seed + 0x6D2B79F5 | 0;
    let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

function hashCode(str: string): number {
  let h = 0;
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(31, h) + str.charCodeAt(i) | 0;
  }
  return h;
}

// ── Fisher-Yates shuffle (seeded) ───────────────────────────

function shuffle<T>(arr: T[], rng: () => number): T[] {
  const out = [...arr];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

// ── Cell types ───────────────────────────────────────────────

interface ToolCell {
  kind: 'tool';
  tool: ToolCallSummary;
}

interface FillerCell {
  kind: 'filler';
}

type Cell = ToolCell | FillerCell;

// ── Component ────────────────────────────────────────────────

export function MinesweeperMode({ tools, selectedNodeId, selectNode }: GameModeProps) {
  const { cols, cells, revealed, total } = useMemo(() => {
    const totalCells = tools.length + 4;
    const c = Math.min(10, Math.max(4, Math.ceil(Math.sqrt(totalCells))));
    const rows = Math.ceil(totalCells / c);
    const gridSize = rows * c;

    // Build cell array: tools + filler
    const toolCells: Cell[] = tools.map((t) => ({ kind: 'tool' as const, tool: t }));
    const fillerCount = gridSize - tools.length;
    const fillerCells: Cell[] = Array.from({ length: fillerCount }, () => ({ kind: 'filler' as const }));

    // Create index array and shuffle deterministically
    const seed = tools.length > 0 ? hashCode(tools[0].toolUseId) : 42;
    const rng = mulberry32(seed);

    const allCells: Cell[] = [...toolCells, ...fillerCells];
    const indices = Array.from({ length: gridSize }, (_, i) => i);
    const shuffled = shuffle(indices, rng);

    // Place cells at shuffled positions
    const grid: Cell[] = Array(gridSize).fill(null);
    for (let i = 0; i < allCells.length; i++) {
      grid[shuffled[i]] = allCells[i];
    }

    const rev = tools.filter((t) => t.status !== 'running').length;

    return { cols: c, cells: grid, revealed: rev, total: tools.length };
  }, [tools]);

  const rows = Math.ceil(cells.length / cols);

  return (
    <div className="flex flex-col items-center gap-1">
      {/* LED counter */}
      <div
        className="flex items-center justify-center rounded px-2 py-0.5 mb-0.5"
        style={{ background: '#1a1a1a', border: '1px solid #333' }}
      >
        <span
          className="font-mono text-[11px] tracking-wider"
          style={{ color: '#ff2020', textShadow: '0 0 4px rgba(255,32,32,0.5)' }}
        >
          {revealed} / {total} revealed
        </span>
      </div>

      {/* Grid */}
      <div
        className="relative"
        style={{
          display: 'grid',
          gridTemplateColumns: `repeat(${cols}, ${CELL}px)`,
          gridTemplateRows: `repeat(${rows}, ${CELL}px)`,
          gap: '1px',
          background: '#374151',
        }}
      >
        {cells.map((cell, i) => {
          if (cell.kind === 'filler') {
            return (
              <div
                key={`filler-${i}`}
                className="bg-gray-600 border-2 border-t-gray-500 border-l-gray-500 border-b-gray-700 border-r-gray-700"
                style={{ width: CELL, height: CELL }}
              />
            );
          }

          const tc = cell.tool;
          const nodeId = `tool-${tc.toolUseId}`;
          const isSelected = selectedNodeId === nodeId;
          const isRunning = tc.status === 'running';
          const isError = tc.status === 'error';
          const isRevealed = tc.status !== 'running';
          const color = getColor(tc.toolName);
          const dur = tc.duration != null ? formatDuration(tc.duration) : null;
          const durationSec = tc.duration != null ? Math.round(tc.duration / 1000) : 0;

          const tooltipText = `${tc.toolName}${dur ? ` \u00b7 ${dur}` : ''} \u00b7 ${tc.status}`;

          // Unrevealed (running): raised 3D button with pulse
          if (!isRevealed) {
            return (
              <Tooltip key={tc.toolUseId} content={tooltipText}>
                <button
                  onClick={(e) => { e.stopPropagation(); selectNode(nodeId, 'graph'); }}
                  className={`bg-gray-600 border-2 border-t-gray-500 border-l-gray-500 border-b-gray-700 border-r-gray-700 cursor-pointer ${
                    isSelected ? 'ring-2 ring-purple-400 z-10' : ''
                  }`}
                  style={{
                    width: CELL,
                    height: CELL,
                    animation: 'ms-pulse 1.5s ease-in-out infinite',
                  }}
                />
              </Tooltip>
            );
          }

          // Error: mine cell
          if (isError) {
            return (
              <Tooltip key={tc.toolUseId} content={tooltipText}>
                <button
                  onClick={(e) => { e.stopPropagation(); selectNode(nodeId, 'graph'); }}
                  className={`flex items-center justify-center cursor-pointer ${
                    isSelected ? 'ring-2 ring-purple-400 z-10' : ''
                  }`}
                  style={{
                    width: CELL,
                    height: CELL,
                    background: '#dc2626',
                  }}
                >
                  <span className="text-[12px] leading-none select-none">{'\u2715'}</span>
                </button>
              </Tooltip>
            );
          }

          // Revealed success: flat cell with duration number
          return (
            <Tooltip key={tc.toolUseId} content={tooltipText}>
              <button
                onClick={(e) => { e.stopPropagation(); selectNode(nodeId, 'graph'); }}
                className={`flex items-center justify-center cursor-pointer ${
                  isSelected ? 'ring-2 ring-purple-400 z-10' : ''
                }`}
                style={{
                  width: CELL,
                  height: CELL,
                  background: `${color}18`,
                  borderLeft: '1px solid rgba(255,255,255,0.05)',
                  borderTop: '1px solid rgba(255,255,255,0.05)',
                }}
              >
                <span
                  className="font-mono text-[10px] font-bold leading-none select-none"
                  style={{ color }}
                >
                  {durationSec > 0 ? durationSec : ''}
                </span>
              </button>
            </Tooltip>
          );
        })}
      </div>

      <style>{`
        @keyframes ms-pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.7; }
        }
      `}</style>
    </div>
  );
}
