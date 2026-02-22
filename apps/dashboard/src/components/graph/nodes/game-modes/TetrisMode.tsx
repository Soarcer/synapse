// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Synapse Contributors

import { useMemo } from 'react';
import type { ToolCallSummary } from '@synapse-ai/core';
import { formatDuration } from '@synapse-ai/core';
import { Tooltip } from '../../../ui/Tooltip';

const TOOL_COLORS: Record<string, string> = {
  Read: '#0d9488', Edit: '#7c3aed', Bash: '#ea580c', Grep: '#2563eb',
  Glob: '#0891b2', Write: '#9333ea', Task: '#059669', WebSearch: '#d97706',
  WebFetch: '#d97706', TodoWrite: '#4f46e5',
};
const DEFAULT_COLOR = '#6b7280';
function getColor(name: string) { return TOOL_COLORS[name] ?? DEFAULT_COLOR; }

const COLS = 10;
const ROWS = 16;
const CELL = 16;
const BLOCK_W = 2; // cells wide

interface BlockPlacement {
  tc: ToolCallSummary;
  col: number;
  row: number; // bottom row (0 = bottom)
  height: number; // cells tall
}

interface Props {
  tools: ToolCallSummary[];
  selectedNodeId: string | null;
  selectNode: (id: string | null, source?: 'graph' | 'lens') => void;
}

export function TetrisMode({ tools, selectedNodeId, selectNode }: Props) {
  const { blocks, clearedRows } = useMemo(() => {
    // Grid tracks occupied cells: grid[row][col] = true if occupied
    const grid: boolean[][] = Array.from({ length: ROWS }, () => Array(COLS).fill(false));
    const placements: BlockPlacement[] = [];

    for (const tc of tools) {
      const h = Math.max(1, Math.min(4, Math.ceil((tc.duration ?? 500) / 1000)));

      // Find first column that fits this block (greedy left-to-right, bottom-up)
      let placed = false;
      for (let col = 0; col <= COLS - BLOCK_W && !placed; col++) {
        // Find lowest available row at this column
        let startRow = 0;
        for (let r = 0; r < ROWS; r++) {
          let blocked = false;
          for (let c = col; c < col + BLOCK_W; c++) {
            if (grid[r][c]) { blocked = true; break; }
          }
          if (blocked) {
            startRow = r + 1;
          } else {
            // Check if there's room for the full height
            let fits = true;
            for (let dr = 0; dr < h && fits; dr++) {
              if (startRow + dr >= ROWS) { fits = false; break; }
              for (let c = col; c < col + BLOCK_W; c++) {
                if (grid[startRow + dr][c]) { fits = false; break; }
              }
            }
            if (fits) {
              // Place the block
              for (let dr = 0; dr < h; dr++) {
                for (let c = col; c < col + BLOCK_W; c++) {
                  grid[startRow + dr][c] = true;
                }
              }
              placements.push({ tc, col, row: startRow, height: h });
              placed = true;
            }
          }
        }
        // If can't fit, skip (overflow — too many tools)
      }

      if (!placed) {
        // Overflow: place at top as visual indicator
        placements.push({ tc, col: 0, row: ROWS - 1, height: 1 });
      }
    }

    // Detect full rows
    const cleared: number[] = [];
    for (let r = 0; r < ROWS; r++) {
      if (grid[r].every(Boolean)) cleared.push(r);
    }

    return { blocks: placements, clearedRows: new Set(cleared) };
  }, [tools]);

  return (
    <div className="relative" style={{ width: COLS * CELL, height: ROWS * CELL }}>
      {/* Grid background */}
      <div
        className="absolute inset-0"
        style={{
          backgroundImage: `
            linear-gradient(to right, rgba(255,255,255,0.03) 1px, transparent 1px),
            linear-gradient(to bottom, rgba(255,255,255,0.03) 1px, transparent 1px)
          `,
          backgroundSize: `${CELL}px ${CELL}px`,
        }}
      />

      {/* Blocks */}
      {blocks.map(({ tc, col, row, height }) => {
        const nodeId = `tool-${tc.toolUseId}`;
        const isSelected = selectedNodeId === nodeId;
        const isRunning = tc.status === 'running';
        const isError = tc.status === 'error';
        const color = getColor(tc.toolName);
        const dur = tc.duration != null ? formatDuration(tc.duration) : null;
        // Y: invert because row 0 = bottom
        const y = (ROWS - row - height) * CELL;
        const x = col * CELL;

        return (
          <Tooltip key={tc.toolUseId} content={`${tc.toolName}${dur ? ` \u00b7 ${dur}` : ''} \u00b7 ${tc.status}`}>
            <button
              onClick={(e) => { e.stopPropagation(); selectNode(nodeId, 'graph'); }}
              className={`absolute transition-all cursor-pointer rounded-sm border border-white/10 ${
                isSelected ? 'ring-1 ring-purple-400 z-10' : 'hover:brightness-125'
              }`}
              style={{
                left: x,
                top: y,
                width: BLOCK_W * CELL - 1,
                height: height * CELL - 1,
                backgroundColor: color,
                opacity: isRunning ? 0.6 : 0.85,
                animation: isRunning ? 'tetris-drop 0.5s cubic-bezier(0.34, 1.56, 0.64, 1)' : undefined,
                backgroundImage: isError
                  ? 'repeating-linear-gradient(45deg, transparent, transparent 3px, rgba(0,0,0,0.25) 3px, rgba(0,0,0,0.25) 6px)'
                  : undefined,
              }}
            >
              <span className="text-[6px] font-mono text-white/70 block text-center leading-none mt-0.5 truncate px-px">
                {tc.toolName.slice(0, 4)}
              </span>
            </button>
          </Tooltip>
        );
      })}

      {/* Row clear flashes */}
      {[...clearedRows].map((row) => (
        <div
          key={`clear-${row}`}
          className="absolute left-0 right-0 pointer-events-none"
          style={{
            top: (ROWS - row - 1) * CELL,
            height: CELL,
            animation: 'tetris-row-clear 0.6s ease-out forwards',
          }}
        />
      ))}

      <style>{`
        @keyframes tetris-drop {
          from { transform: translateY(-${ROWS * CELL}px); opacity: 0.3; }
          to { transform: translateY(0); opacity: 0.85; }
        }
        @keyframes tetris-row-clear {
          0% { background: rgba(255,255,255,0.6); }
          50% { background: rgba(255,255,255,0.3); }
          100% { background: transparent; }
        }
      `}</style>
    </div>
  );
}
