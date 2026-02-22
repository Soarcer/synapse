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
const BLOCK_W = 2;

interface BlockPlacement {
  tc: ToolCallSummary;
  col: number;
  row: number; // bottom row (0 = bottom)
  height: number;
}

// Seeded PRNG for deterministic placement (same tools → same layout)
function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = seed + 0x6D2B79F5 | 0;
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

/** Find the lowest row where a block of given width × height can land at col. Returns -1 if no fit. */
function findDropRow(grid: boolean[][], col: number, width: number, height: number): number {
  for (let startRow = 0; startRow <= ROWS - height; startRow++) {
    let fits = true;
    for (let dr = 0; dr < height && fits; dr++) {
      for (let c = col; c < col + width; c++) {
        if (grid[startRow + dr][c]) fits = false;
      }
    }
    if (fits) return startRow;
  }
  return -1;
}

/** Count empty cells below a potential landing position — fewer gaps = better fit. */
function countGapsBelow(grid: boolean[][], col: number, width: number, landRow: number): number {
  let gaps = 0;
  for (let r = 0; r < landRow; r++) {
    for (let c = col; c < col + width && c < COLS; c++) {
      if (!grid[r][c]) gaps++;
    }
  }
  return gaps;
}

interface Props {
  tools: ToolCallSummary[];
  selectedNodeId: string | null;
  selectNode: (id: string | null, source?: 'graph' | 'lens') => void;
}

export function TetrisMode({ tools, selectedNodeId, selectNode }: Props) {
  const blocks = useMemo(() => {
    const grid: boolean[][] = Array.from({ length: ROWS }, () => Array(COLS).fill(false));
    const placements: BlockPlacement[] = [];

    const seed = tools.length > 0 ? hashCode(tools[0].toolUseId) : 42;
    const rng = mulberry32(seed);

    for (const tc of tools) {
      const h = Math.max(1, Math.min(4, Math.ceil((tc.duration ?? 500) / 1000)));
      const maxCol = COLS - BLOCK_W;

      // Step 1: Pick random start column
      let chosenCol = Math.floor(rng() * (maxCol + 1));

      // Step 2: 70% chance — scan ±3 columns for best fit (fewest gaps below)
      if (rng() < 0.7) {
        let bestCol = chosenCol;
        let bestGaps = Infinity;
        const scanMin = Math.max(0, chosenCol - 3);
        const scanMax = Math.min(maxCol, chosenCol + 3);

        for (let c = scanMin; c <= scanMax; c++) {
          const row = findDropRow(grid, c, BLOCK_W, h);
          if (row < 0) continue;
          const gaps = countGapsBelow(grid, c, BLOCK_W, row);
          if (gaps < bestGaps) {
            bestGaps = gaps;
            bestCol = c;
          }
        }
        chosenCol = bestCol;
      }

      // Step 3: Find landing row (gravity drop)
      const landRow = findDropRow(grid, chosenCol, BLOCK_W, h);
      if (landRow < 0) {
        placements.push({ tc, col: chosenCol, row: ROWS - 1, height: 1 });
        continue;
      }

      // Place block in grid
      for (let dr = 0; dr < h; dr++) {
        for (let c = chosenCol; c < chosenCol + BLOCK_W; c++) {
          if (landRow + dr < ROWS) grid[landRow + dr][c] = true;
        }
      }
      placements.push({ tc, col: chosenCol, row: landRow, height: h });

      // Step 4: Line clearing — detect full rows, remove, collapse above
      for (let r = 0; r < ROWS; r++) {
        if (grid[r].every(Boolean)) {
          // Clear this row: shift all rows above down by 1
          grid.splice(r, 1);
          grid.push(Array(COLS).fill(false));
          // Adjust placements for blocks above the cleared row
          for (const bp of placements) {
            if (bp.row > r) bp.row--;
          }
          r--; // re-check same index
        }
      }
    }

    return placements;
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
                opacity: isRunning ? 0.5 : 0.85,
                animation: isRunning ? undefined : 'tetris-drop 0.45s cubic-bezier(0.34, 1.56, 0.64, 1)',
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

      <style>{`
        @keyframes tetris-drop {
          0% { transform: translateY(-${ROWS * CELL}px); opacity: 0.3; }
          70% { transform: translateY(4px); opacity: 0.85; }
          100% { transform: translateY(0); opacity: 0.85; }
        }
      `}</style>
    </div>
  );
}
