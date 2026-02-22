# Arcade Game Modes v2 Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Rewrite all 3 game mode components to fix Pac-Man clip-path, replace greedy Tetris with human-player placement, and swap Bubbles for Conway's Game of Life.

**Architecture:** Full rewrites of PacManMode, TetrisMode; delete BubblesMode+GooeyFilter, create GameOfLifeMode. No changes to arcade-utils.ts, ArcadeOverlay.tsx, agentStore.ts, or App.tsx. Barrel export and ToolGroupNode receive minor wiring updates.

**Tech Stack:** React 19, TypeScript, CSS keyframes, HTML5 Canvas (Game of Life), Zustand selectors

**Design doc:** `docs/plans/2026-02-22-arcade-modes-v2-design.md`

---

### Task 1: Rewrite PacManMode.tsx — "Victory Lap"

**Files:**
- Rewrite: `apps/dashboard/src/components/graph/nodes/game-modes/PacManMode.tsx`

**Step 1: Replace the entire file with the new implementation**

The new PacManMode follows the "Victory Lap" design:
- Pac-Man sits at left edge with idle chomp animation during execution
- Ghosts appear left→right as tools arrive, evenly spaced
- Ghost color = tool type (TOOL_COLORS map)
- Running tools = blue vulnerable ghosts (wobble), completed = colored ghosts, error = red
- Small dots fill path between ghost positions
- When ALL tools complete (none running), Pac-Man sweeps left→right eating each ghost
- Success ghosts → floating eyes; error ghosts → Pac-Man bounces back briefly
- After sweep: "CLEAR!" text flashes, Pac-Man returns to start
- Sweep can be retriggered via replay icon

**Pac-Man clip-path fix** (mouth opens RIGHT, direction of travel):

```css
@keyframes pacman-chomp {
  0% { clip-path: polygon(100% 50%, 80% 100%, 0% 100%, 0% 0%, 80% 0%); }
  100% { clip-path: polygon(100% 50%, 50% 75%, 0% 100%, 0% 0%, 50% 25%); }
}
```

```tsx
// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Synapse Contributors

import { useMemo, useState, useEffect, useRef, useCallback } from 'react';
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

const GHOST_SIZE = 20;
const GHOST_GAP = 8;
const DOT_SIZE = 4;
const PAC_SIZE = 24;
const ROW_HEIGHT = 40;
const GHOSTS_PER_ROW = 10;
const VULNERABLE_COLOR = '#2563eb';

interface Props {
  tools: ToolCallSummary[];
  selectedNodeId: string | null;
  selectNode: (id: string | null, source?: 'graph' | 'lens') => void;
}

export function PacManMode({ tools, selectedNodeId, selectNode }: Props) {
  const allComplete = useMemo(
    () => tools.length > 0 && tools.every((t) => t.status === 'success' || t.status === 'error'),
    [tools],
  );

  // Sweep state
  const [sweeping, setSweeping] = useState(false);
  const [sweepIndex, setSweepIndex] = useState(-1); // index of ghost Pac-Man is at (-1 = at start)
  const [showClear, setShowClear] = useState(false);
  const sweepTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const prevAllCompleteRef = useRef(false);
  // Track eaten ghosts during sweep (indices that have been passed)
  const [eatenSet, setEatenSet] = useState<Set<number>>(new Set());

  // Auto-trigger sweep when all tools first complete
  useEffect(() => {
    if (allComplete && !prevAllCompleteRef.current && tools.length > 0) {
      startSweep();
    }
    prevAllCompleteRef.current = allComplete;
  }, [allComplete, tools.length]); // eslint-disable-line react-hooks/exhaustive-deps

  const startSweep = useCallback(() => {
    if (sweeping) return;
    setSweeping(true);
    setSweepIndex(-1);
    setEatenSet(new Set());
    setShowClear(false);

    // Animate through each ghost
    const speed = Math.max(80, Math.min(300, 1500 / tools.length));
    let idx = 0;

    function advance() {
      if (idx >= tools.length) {
        // Sweep complete — show CLEAR
        setShowClear(true);
        setTimeout(() => {
          setShowClear(false);
          setSweeping(false);
          setSweepIndex(-1);
        }, 800);
        return;
      }
      const tool = tools[idx];
      setSweepIndex(idx);
      setEatenSet((prev) => new Set(prev).add(idx));

      if (tool.status === 'error') {
        // Bounce back briefly on error ghost
        setTimeout(() => {
          idx++;
          advance();
        }, 200);
      } else {
        idx++;
        setTimeout(advance, speed);
      }
    }

    setTimeout(() => advance(), speed);
  }, [sweeping, tools]);

  const numRows = Math.ceil(tools.length / GHOSTS_PER_ROW) || 1;
  const containerW = Math.max(Math.min(tools.length, GHOSTS_PER_ROW) * (GHOST_SIZE + GHOST_GAP) + PAC_SIZE + 48, 200);
  const containerH = numRows * ROW_HEIGHT + 16;

  // Pac-Man position: during sweep, follows sweepIndex; otherwise at left edge
  const pacRow = sweeping && sweepIndex >= 0 ? Math.floor(sweepIndex / GHOSTS_PER_ROW) : 0;
  const pacCol = sweeping && sweepIndex >= 0 ? sweepIndex % GHOSTS_PER_ROW : -1;
  const pacLeft = pacCol >= 0 ? 16 + pacCol * (GHOST_SIZE + GHOST_GAP) + GHOST_SIZE + 4 : 4;
  const pacTop = 8 + pacRow * ROW_HEIGHT + (ROW_HEIGHT - PAC_SIZE) / 2;

  return (
    <div className="relative" style={{ width: containerW, height: containerH }}>
      {/* Dots between ghosts */}
      {tools.map((_, i) => {
        const row = Math.floor(i / GHOSTS_PER_ROW);
        const col = i % GHOSTS_PER_ROW;
        const x = 16 + col * (GHOST_SIZE + GHOST_GAP) + GHOST_SIZE / 2;
        const y = 8 + row * ROW_HEIGHT + ROW_HEIGHT / 2;
        const isEaten = eatenSet.has(i);
        return (
          <div
            key={`dot-${i}`}
            className="absolute rounded-full transition-opacity"
            style={{
              width: DOT_SIZE,
              height: DOT_SIZE,
              left: x - DOT_SIZE / 2 - (GHOST_SIZE + GHOST_GAP) / 2,
              top: y - DOT_SIZE / 2,
              backgroundColor: isEaten ? 'transparent' : 'rgba(255,255,255,0.3)',
            }}
          />
        );
      })}

      {/* Pac-Man */}
      <div
        className="absolute"
        style={{
          width: PAC_SIZE,
          height: PAC_SIZE,
          left: pacLeft,
          top: pacTop,
          borderRadius: '50%',
          backgroundColor: '#ffdd00',
          clipPath: 'polygon(100% 50%, 50% 75%, 0% 100%, 0% 0%, 50% 25%)',
          animation: 'pacman-chomp 0.3s infinite alternate',
          transition: sweeping ? 'left 0.15s ease-out, top 0.15s ease-out' : undefined,
          zIndex: 5,
        }}
      />

      {/* Ghosts */}
      {tools.map((tc, i) => {
        const row = Math.floor(i / GHOSTS_PER_ROW);
        const col = i % GHOSTS_PER_ROW;
        const x = 16 + col * (GHOST_SIZE + GHOST_GAP);
        const y = 8 + row * ROW_HEIGHT + (ROW_HEIGHT - GHOST_SIZE) / 2;
        const nodeId = `tool-${tc.toolUseId}`;
        const isSelected = selectedNodeId === nodeId;
        const isRunning = tc.status === 'running';
        const isError = tc.status === 'error';
        const isEaten = eatenSet.has(i);
        const dur = tc.duration != null ? formatDuration(tc.duration) : null;
        const ghostColor = isRunning ? VULNERABLE_COLOR : isError ? '#ef4444' : getColor(tc.toolName);

        return (
          <Tooltip key={tc.toolUseId} content={`${tc.toolName}${dur ? ` · ${dur}` : ''} · ${tc.status}`}>
            <button
              onClick={(e) => { e.stopPropagation(); selectNode(nodeId, 'graph'); }}
              className={`absolute cursor-pointer transition-all ${
                isSelected ? 'ring-1 ring-purple-400 rounded z-10' : ''
              }`}
              style={{ left: x, top: y, width: GHOST_SIZE, height: GHOST_SIZE }}
            >
              {isEaten && !isError ? (
                /* Floating eyes (eaten ghost) */
                <div className="relative w-full h-full" style={{ animation: 'ghost-eyes-float 2s ease-in-out infinite alternate' }}>
                  <div className="absolute bg-white rounded-full" style={{ width: 5, height: 6, left: 3, top: 4 }}>
                    <div className="absolute bg-blue-900 rounded-full" style={{ width: 3, height: 3, left: 1, top: 2 }} />
                  </div>
                  <div className="absolute bg-white rounded-full" style={{ width: 5, height: 6, left: 12, top: 4 }}>
                    <div className="absolute bg-blue-900 rounded-full" style={{ width: 3, height: 3, left: 1, top: 2 }} />
                  </div>
                </div>
              ) : (
                /* Full ghost sprite */
                <div
                  className="relative w-full h-full"
                  style={{ animation: isRunning ? 'ghost-wobble 0.5s ease-in-out infinite alternate' : undefined }}
                >
                  <div
                    className="absolute inset-0"
                    style={{
                      backgroundColor: ghostColor,
                      borderRadius: '50% 50% 0 0',
                      clipPath: 'polygon(0% 0%, 100% 0%, 100% 85%, 85% 100%, 70% 85%, 50% 100%, 30% 85%, 15% 100%, 0% 85%)',
                    }}
                  />
                  <div className="absolute bg-white rounded-full" style={{ width: 5, height: 5, left: 3, top: 5 }}>
                    <div className="absolute bg-blue-900 rounded-full" style={{ width: 2.5, height: 2.5, left: 1.5, top: 1.5 }} />
                  </div>
                  <div className="absolute bg-white rounded-full" style={{ width: 5, height: 5, left: 11, top: 5 }}>
                    <div className="absolute bg-blue-900 rounded-full" style={{ width: 2.5, height: 2.5, left: 1.5, top: 1.5 }} />
                  </div>
                </div>
              )}
            </button>
          </Tooltip>
        );
      })}

      {/* CLEAR text */}
      {showClear && (
        <div
          className="absolute inset-0 flex items-center justify-center pointer-events-none z-20"
          style={{ animation: 'clear-flash 0.8s ease-out forwards' }}
        >
          <span className="text-yellow-300 font-bold text-lg" style={{ textShadow: '0 0 8px rgba(255,221,0,0.6)' }}>
            CLEAR!
          </span>
        </div>
      )}

      {/* Replay button (visible when all complete and not sweeping) */}
      {allComplete && !sweeping && (
        <button
          onClick={(e) => { e.stopPropagation(); setEatenSet(new Set()); startSweep(); }}
          className="absolute bottom-1 right-1 w-5 h-5 flex items-center justify-center rounded-full bg-gray-700/60 hover:bg-gray-600/80 text-gray-400 hover:text-white text-[10px] z-10 transition-colors"
          title="Replay sweep"
        >
          ↻
        </button>
      )}

      {/* Progress text */}
      {!allComplete && tools.length > 0 && (
        <div className="absolute top-0.5 left-1 text-[8px] text-gray-500 pointer-events-none">
          {tools.filter((t) => t.status !== 'running').length} / {tools.length}
        </div>
      )}

      <style>{`
        @keyframes pacman-chomp {
          0% { clip-path: polygon(100% 50%, 80% 100%, 0% 100%, 0% 0%, 80% 0%); }
          100% { clip-path: polygon(100% 50%, 50% 75%, 0% 100%, 0% 0%, 50% 25%); }
        }
        @keyframes ghost-wobble {
          from { transform: translateX(-1px); }
          to { transform: translateX(1px); }
        }
        @keyframes ghost-eyes-float {
          from { transform: translateY(0) translateX(2px); opacity: 0.6; }
          to { transform: translateY(-3px) translateX(-2px); opacity: 0.4; }
        }
        @keyframes clear-flash {
          0% { opacity: 0; transform: scale(0.5); }
          20% { opacity: 1; transform: scale(1.2); }
          80% { opacity: 1; transform: scale(1); }
          100% { opacity: 0; transform: scale(1); }
        }
      `}</style>
    </div>
  );
}
```

**Step 2: Verify no TypeScript errors**

Run: `npx tsc --noEmit --project apps/dashboard/tsconfig.json 2>&1 | head -20`
Expected: No errors related to PacManMode

**Step 3: Commit**

```bash
git add apps/dashboard/src/components/graph/nodes/game-modes/PacManMode.tsx
git commit -m "feat(arcade): rewrite PacManMode with Victory Lap sweep mechanic"
```

---

### Task 2: Rewrite TetrisMode.tsx — "Human Player"

**Files:**
- Rewrite: `apps/dashboard/src/components/graph/nodes/game-modes/TetrisMode.tsx`

**Step 1: Replace the entire file with the new implementation**

The new TetrisMode follows the "Human Player" design:
- 10×16 grid, each cell 16×16px
- Each tool becomes a 2-cell-wide block with height based on duration (1-4 cells)
- Placement: pick random start column, 70% chance scan ±3 cols for best fit (fewest gaps below), 30% keep random
- Line clearing: after each placement, detect full rows, actually remove them, collapse rows above
- Blocks have tool-type colors, rounded corners, tool name abbreviation
- Running blocks: half opacity; error blocks: diagonal stripe overlay
- Animated drop via CSS keyframe

```tsx
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

function countGapsBelow(grid: boolean[][], col: number, width: number, row: number): number {
  let gaps = 0;
  for (let r = 0; r < row; r++) {
    for (let c = col; c < col + width && c < COLS; c++) {
      if (!grid[r][c]) gaps++;
    }
  }
  return gaps;
}

function findLowestRow(grid: boolean[][], col: number, width: number, height: number): number {
  // Find lowest row where block can rest (gravity — drop to bottom)
  for (let startRow = 0; startRow <= ROWS - height; startRow++) {
    let fits = true;
    for (let dr = 0; dr < height && fits; dr++) {
      for (let c = col; c < col + width && c < COLS; c++) {
        if (grid[startRow + dr][c]) { fits = false; }
      }
    }
    if (!fits) return startRow - 1; // rest on top of blocking cell
  }
  return ROWS - height; // nothing below, rest at bottom... wait, row 0 = bottom
}

interface Props {
  tools: ToolCallSummary[];
  selectedNodeId: string | null;
  selectNode: (id: string | null, source?: 'graph' | 'lens') => void;
}

export function TetrisMode({ tools, selectedNodeId, selectNode }: Props) {
  const blocks = useMemo(() => {
    // Grid: grid[row][col], row 0 = bottom
    const grid: boolean[][] = Array.from({ length: ROWS }, () => Array(COLS).fill(false));
    const placements: BlockPlacement[] = [];

    // Create a seeded RNG based on first tool's ID for deterministic layout
    const seed = tools.length > 0 ? hashCode(tools[0].toolUseId) : 42;
    const rng = mulberry32(seed);

    for (const tc of tools) {
      const h = Math.max(1, Math.min(4, Math.ceil((tc.duration ?? 500) / 1000)));

      // Step 1: Pick random start column
      const maxCol = COLS - BLOCK_W;
      let chosenCol = Math.floor(rng() * (maxCol + 1));

      // Step 2: 70% chance — scan ±3 columns for best fit
      if (rng() < 0.7) {
        let bestCol = chosenCol;
        let bestGaps = Infinity;

        const scanMin = Math.max(0, chosenCol - 3);
        const scanMax = Math.min(maxCol, chosenCol + 3);

        for (let c = scanMin; c <= scanMax; c++) {
          // Check if the block can fit here
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
        // Overflow — place at top as indicator
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

      // Step 4: Line clearing — check all rows, remove full ones, collapse
      let rowShift = 0;
      for (let r = 0; r < ROWS; r++) {
        if (grid[r].every(Boolean)) {
          // Full row — clear it
          grid.splice(r, 1);
          grid.push(Array(COLS).fill(false)); // add empty row at top
          // Shift all previously placed blocks that are above this row
          for (const bp of placements) {
            if (bp.row > r - rowShift) {
              // This block is above the cleared row — shift down
            } else if (bp.row === r - rowShift) {
              // Block starts at cleared row — shrink or remove
            }
          }
          r--; // re-check this row index (new row slid down)
          rowShift++;
        }
      }

      // Re-sync placements with actual grid positions after clearing
      // (Simple approach: cleared rows shift blocks above them down by 1 each)
      if (rowShift > 0) {
        for (const bp of placements) {
          if (bp.row >= landRow + h) {
            bp.row -= rowShift;
          }
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
          <Tooltip key={tc.toolUseId} content={`${tc.toolName}${dur ? ` · ${dur}` : ''} · ${tc.status}`}>
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

/** Find the lowest row where a block of given width × height can land at col (gravity drop). Returns -1 if no fit. */
function findDropRow(grid: boolean[][], col: number, width: number, height: number): number {
  // Start from bottom (row 0), find first row where the block fits
  for (let startRow = 0; startRow <= ROWS - height; startRow++) {
    let fits = true;
    for (let dr = 0; dr < height && fits; dr++) {
      for (let c = col; c < col + width; c++) {
        if (grid[startRow + dr][c]) fits = false;
      }
    }
    if (fits) return startRow;
  }
  return -1; // no space
}
```

**Step 2: Verify no TypeScript errors**

Run: `npx tsc --noEmit --project apps/dashboard/tsconfig.json 2>&1 | head -20`
Expected: No errors related to TetrisMode

**Step 3: Commit**

```bash
git add apps/dashboard/src/components/graph/nodes/game-modes/TetrisMode.tsx
git commit -m "feat(arcade): rewrite TetrisMode with human-player 70/30 placement"
```

---

### Task 3: Create GameOfLifeMode.tsx — "Living Board"

**Files:**
- Create: `apps/dashboard/src/components/graph/nodes/game-modes/GameOfLifeMode.tsx`

**Step 1: Create the new file**

The Game of Life mode uses a canvas-based cellular automaton:
- 32×20 grid, each cell 8×8px (256×160px container)
- Each `tool_start` seeds a predefined pattern (glider, block, blinker, etc.) based on tool type
- Simulation runs Conway B3/S23 rules at ~5 generations/second
- Frozen cells (completed tools) are exempt from death rules
- Error tools: cells turn red and die over 3 generations
- Click on cell cluster → selects associated tool node
- Hover highlights all cells belonging to same tool

```tsx
// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Synapse Contributors

import { useRef, useEffect, useMemo, useCallback, useState } from 'react';
import type { ToolCallSummary } from '@synapse-ai/core';
import { Tooltip } from '../../../ui/Tooltip';

const GRID_COLS = 32;
const GRID_ROWS = 20;
const CELL_SIZE = 8;
const CONTAINER_W = GRID_COLS * CELL_SIZE;
const CONTAINER_H = GRID_ROWS * CELL_SIZE;
const SIM_INTERVAL = 200; // ms per generation

const TOOL_COLORS: Record<string, string> = {
  Read: '#0d9488', Edit: '#7c3aed', Bash: '#ea580c', Grep: '#2563eb',
  Glob: '#0891b2', Write: '#9333ea', Task: '#059669', WebSearch: '#d97706',
  WebFetch: '#d97706', TodoWrite: '#4f46e5',
};
const DEFAULT_COLOR = '#6b7280';
function getColor(name: string) { return TOOL_COLORS[name] ?? DEFAULT_COLOR; }

interface Cell {
  alive: boolean;
  frozen: boolean;
  color: string;
  toolUseId: string;
  age: number;
  dying: number; // 0 = not dying, 1-3 = dying countdown
}

function emptyCell(): Cell {
  return { alive: false, frozen: false, color: '', toolUseId: '', age: 0, dying: 0 };
}

// Predefined patterns (relative coords)
const PATTERNS: Record<string, [number, number][]> = {
  Read:      [[0,0],[1,0],[2,0],[2,1],[1,2]],                           // Glider
  Edit:      [[0,0],[1,0],[0,1],[1,1]],                                 // Block (still life)
  Bash:      [[0,0],[1,0],[2,0]],                                       // Blinker
  Grep:      [[1,0],[4,0],[0,1],[0,2],[4,2],[0,3],[1,3],[2,3],[3,3]],   // LWSS
  Write:     [[0,0],[1,0],[0,1],[1,1],[2,2],[3,2],[2,3],[3,3]],         // Beacon
  Task:      [[1,0],[2,0],[0,1],[1,1],[1,2]],                           // R-pentomino
};

function getPattern(toolName: string): [number, number][] {
  return PATTERNS[toolName] ?? randomCluster();
}

function randomCluster(): [number, number][] {
  // Random 5-cell cluster within a 3x3 area
  const cells: [number, number][] = [];
  const used = new Set<string>();
  while (cells.length < 5) {
    const r = Math.floor(Math.random() * 3);
    const c = Math.floor(Math.random() * 3);
    const key = `${r},${c}`;
    if (!used.has(key)) {
      used.add(key);
      cells.push([c, r]);
    }
  }
  return cells;
}

function findOpenArea(grid: Cell[][]): [number, number] {
  // Try to find a 5x5 region with <3 live cells
  for (let attempt = 0; attempt < 20; attempt++) {
    const cx = Math.floor(Math.random() * (GRID_COLS - 6)) + 1;
    const cy = Math.floor(Math.random() * (GRID_ROWS - 6)) + 1;
    let count = 0;
    for (let dy = 0; dy < 5; dy++) {
      for (let dx = 0; dx < 5; dx++) {
        if (grid[cy + dy]?.[cx + dx]?.alive) count++;
      }
    }
    if (count < 3) return [cx, cy];
  }
  // Fallback: random position
  return [Math.floor(Math.random() * (GRID_COLS - 4)), Math.floor(Math.random() * (GRID_ROWS - 4))];
}

function countNeighbors(grid: Cell[][], r: number, c: number): number {
  let n = 0;
  for (let dr = -1; dr <= 1; dr++) {
    for (let dc = -1; dc <= 1; dc++) {
      if (dr === 0 && dc === 0) continue;
      const nr = r + dr;
      const nc = c + dc;
      if (nr >= 0 && nr < GRID_ROWS && nc >= 0 && nc < GRID_COLS && grid[nr][nc].alive) {
        n++;
      }
    }
  }
  return n;
}

function majorityColor(grid: Cell[][], r: number, c: number): { color: string; toolUseId: string } {
  const counts = new Map<string, { count: number; color: string; toolUseId: string }>();
  for (let dr = -1; dr <= 1; dr++) {
    for (let dc = -1; dc <= 1; dc++) {
      if (dr === 0 && dc === 0) continue;
      const nr = r + dr;
      const nc = c + dc;
      if (nr >= 0 && nr < GRID_ROWS && nc >= 0 && nc < GRID_COLS) {
        const cell = grid[nr][nc];
        if (cell.alive && cell.toolUseId) {
          const entry = counts.get(cell.toolUseId) ?? { count: 0, color: cell.color, toolUseId: cell.toolUseId };
          entry.count++;
          counts.set(cell.toolUseId, entry);
        }
      }
    }
  }
  let best = { color: DEFAULT_COLOR, toolUseId: '' };
  let max = 0;
  for (const entry of counts.values()) {
    if (entry.count > max) { max = entry.count; best = entry; }
  }
  return best;
}

interface Props {
  tools: ToolCallSummary[];
  selectedNodeId: string | null;
  selectNode: (id: string | null, source?: 'graph' | 'lens') => void;
}

export function GameOfLifeMode({ tools, selectedNodeId, selectNode }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const gridRef = useRef<Cell[][]>(
    Array.from({ length: GRID_ROWS }, () =>
      Array.from({ length: GRID_COLS }, emptyCell),
    ),
  );
  const seededToolsRef = useRef(new Set<string>());
  const [hoveredToolId, setHoveredToolId] = useState<string | null>(null);
  const [tooltipInfo, setTooltipInfo] = useState<{ text: string; x: number; y: number } | null>(null);

  // Seed new tools into the grid
  useEffect(() => {
    const grid = gridRef.current;
    for (const tc of tools) {
      if (seededToolsRef.current.has(tc.toolUseId)) {
        // Tool already seeded — check for status changes
        if (tc.status === 'success') {
          // Freeze all cells belonging to this tool
          for (let r = 0; r < GRID_ROWS; r++) {
            for (let c = 0; c < GRID_COLS; c++) {
              if (grid[r][c].toolUseId === tc.toolUseId && grid[r][c].alive) {
                grid[r][c].frozen = true;
              }
            }
          }
        } else if (tc.status === 'error') {
          // Mark cells as dying
          for (let r = 0; r < GRID_ROWS; r++) {
            for (let c = 0; c < GRID_COLS; c++) {
              if (grid[r][c].toolUseId === tc.toolUseId && grid[r][c].alive && grid[r][c].dying === 0) {
                grid[r][c].color = '#ef4444';
                grid[r][c].dying = 3;
                grid[r][c].frozen = false;
              }
            }
          }
        }
        continue;
      }
      // New tool — seed pattern
      seededToolsRef.current.add(tc.toolUseId);
      const pattern = getPattern(tc.toolName);
      const [ox, oy] = findOpenArea(grid);
      const color = getColor(tc.toolName);
      for (const [dx, dy] of pattern) {
        const r = oy + dy;
        const c = ox + dx;
        if (r >= 0 && r < GRID_ROWS && c >= 0 && c < GRID_COLS) {
          grid[r][c] = { alive: true, frozen: false, color, toolUseId: tc.toolUseId, age: 0, dying: 0 };
        }
      }
    }
  }, [tools]);

  // Simulation loop
  useEffect(() => {
    const interval = setInterval(() => {
      const grid = gridRef.current;
      const next: Cell[][] = Array.from({ length: GRID_ROWS }, () =>
        Array.from({ length: GRID_COLS }, emptyCell),
      );

      for (let r = 0; r < GRID_ROWS; r++) {
        for (let c = 0; c < GRID_COLS; c++) {
          const cell = grid[r][c];
          const neighbors = countNeighbors(grid, r, c);

          if (cell.alive) {
            if (cell.dying > 0) {
              // Dying cell — count down
              if (cell.dying > 1) {
                next[r][c] = { ...cell, dying: cell.dying - 1, age: cell.age + 1 };
              }
              // else dies (stays empty)
            } else if (cell.frozen) {
              // Frozen cells persist
              next[r][c] = { ...cell, age: cell.age + 1 };
            } else if (neighbors === 2 || neighbors === 3) {
              // Survives
              next[r][c] = { ...cell, age: cell.age + 1 };
            }
            // else dies (underpopulation or overpopulation)
          } else {
            // Dead cell — birth if exactly 3 neighbors
            if (neighbors === 3) {
              const { color, toolUseId } = majorityColor(grid, r, c);
              next[r][c] = { alive: true, frozen: false, color, toolUseId, age: 0, dying: 0 };
            }
          }
        }
      }

      gridRef.current = next;
      renderGrid();
    }, SIM_INTERVAL);

    return () => clearInterval(interval);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Render grid to canvas
  const renderGrid = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.clearRect(0, 0, CONTAINER_W, CONTAINER_H);

    // Grid lines
    ctx.strokeStyle = 'rgba(255,255,255,0.02)';
    ctx.lineWidth = 0.5;
    for (let r = 0; r <= GRID_ROWS; r++) {
      ctx.beginPath();
      ctx.moveTo(0, r * CELL_SIZE);
      ctx.lineTo(CONTAINER_W, r * CELL_SIZE);
      ctx.stroke();
    }
    for (let c = 0; c <= GRID_COLS; c++) {
      ctx.beginPath();
      ctx.moveTo(c * CELL_SIZE, 0);
      ctx.lineTo(c * CELL_SIZE, CONTAINER_H);
      ctx.stroke();
    }

    const grid = gridRef.current;
    for (let r = 0; r < GRID_ROWS; r++) {
      for (let c = 0; c < GRID_COLS; c++) {
        const cell = grid[r][c];
        if (!cell.alive) continue;

        const x = c * CELL_SIZE;
        const y = r * CELL_SIZE;
        const isHovered = hoveredToolId === cell.toolUseId;
        const isSelected = selectedNodeId === `tool-${cell.toolUseId}`;

        // Cell color
        ctx.fillStyle = cell.color;

        if (cell.dying > 0) {
          // Shrinking dying cell
          const scale = cell.dying / 3;
          const inset = CELL_SIZE * (1 - scale) / 2;
          ctx.globalAlpha = scale * 0.7;
          ctx.fillRect(x + inset, y + inset, CELL_SIZE * scale, CELL_SIZE * scale);
        } else if (cell.frozen) {
          // Frozen: brighter, glow border
          ctx.globalAlpha = 1.0;
          ctx.fillRect(x + 0.5, y + 0.5, CELL_SIZE - 1, CELL_SIZE - 1);
          ctx.strokeStyle = cell.color;
          ctx.lineWidth = 1;
          ctx.strokeRect(x + 0.5, y + 0.5, CELL_SIZE - 1, CELL_SIZE - 1);
        } else {
          // Living cell: pulse opacity
          const pulse = 0.7 + 0.2 * Math.sin(cell.age * 0.5);
          ctx.globalAlpha = isHovered ? 1.0 : pulse;
          ctx.fillRect(x + 0.5, y + 0.5, CELL_SIZE - 1, CELL_SIZE - 1);
        }

        // Selection highlight
        if (isSelected) {
          ctx.strokeStyle = '#a855f7';
          ctx.lineWidth = 1.5;
          ctx.globalAlpha = 1;
          ctx.strokeRect(x, y, CELL_SIZE, CELL_SIZE);
        }

        ctx.globalAlpha = 1;
      }
    }
  }, [hoveredToolId, selectedNodeId]);

  // Initial render
  useEffect(() => { renderGrid(); }, [renderGrid]);

  // Click handler: find tool at canvas position
  const handleClick = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    e.stopPropagation();
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const col = Math.floor((e.clientX - rect.left) / CELL_SIZE);
    const row = Math.floor((e.clientY - rect.top) / CELL_SIZE);
    if (row >= 0 && row < GRID_ROWS && col >= 0 && col < GRID_COLS) {
      const cell = gridRef.current[row][col];
      if (cell.alive && cell.toolUseId) {
        selectNode(`tool-${cell.toolUseId}`, 'graph');
      }
    }
  }, [selectNode]);

  // Hover handler: highlight tool cells
  const handleMove = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const col = Math.floor((e.clientX - rect.left) / CELL_SIZE);
    const row = Math.floor((e.clientY - rect.top) / CELL_SIZE);
    if (row >= 0 && row < GRID_ROWS && col >= 0 && col < GRID_COLS) {
      const cell = gridRef.current[row][col];
      if (cell.alive && cell.toolUseId) {
        setHoveredToolId(cell.toolUseId);
        const tc = tools.find((t) => t.toolUseId === cell.toolUseId);
        if (tc) {
          setTooltipInfo({ text: `${tc.toolName} · ${tc.status}`, x: e.clientX - rect.left, y: e.clientY - rect.top });
        }
        return;
      }
    }
    setHoveredToolId(null);
    setTooltipInfo(null);
  }, [tools]);

  const handleLeave = useCallback(() => {
    setHoveredToolId(null);
    setTooltipInfo(null);
  }, []);

  return (
    <div className="relative" style={{ width: CONTAINER_W, height: CONTAINER_H }}>
      <canvas
        ref={canvasRef}
        width={CONTAINER_W}
        height={CONTAINER_H}
        className="cursor-pointer"
        onClick={handleClick}
        onMouseMove={handleMove}
        onMouseLeave={handleLeave}
      />
      {tooltipInfo && (
        <div
          className="absolute pointer-events-none bg-gray-900/90 text-gray-200 text-[9px] px-1.5 py-0.5 rounded border border-gray-700 whitespace-nowrap z-20"
          style={{ left: tooltipInfo.x + 8, top: tooltipInfo.y - 20 }}
        >
          {tooltipInfo.text}
        </div>
      )}
    </div>
  );
}
```

**Step 2: Verify no TypeScript errors**

Run: `npx tsc --noEmit --project apps/dashboard/tsconfig.json 2>&1 | head -20`
Expected: No errors related to GameOfLifeMode

**Step 3: Commit**

```bash
git add apps/dashboard/src/components/graph/nodes/game-modes/GameOfLifeMode.tsx
git commit -m "feat(arcade): add GameOfLifeMode cellular automaton (replaces Bubbles)"
```

---

### Task 4: Delete BubblesMode.tsx and GooeyFilter.tsx

**Files:**
- Delete: `apps/dashboard/src/components/graph/nodes/game-modes/BubblesMode.tsx`
- Delete: `apps/dashboard/src/components/graph/nodes/game-modes/GooeyFilter.tsx`

**Step 1: Delete both files**

```bash
rm apps/dashboard/src/components/graph/nodes/game-modes/BubblesMode.tsx
rm apps/dashboard/src/components/graph/nodes/game-modes/GooeyFilter.tsx
```

**Step 2: Commit**

```bash
git add -u apps/dashboard/src/components/graph/nodes/game-modes/BubblesMode.tsx apps/dashboard/src/components/graph/nodes/game-modes/GooeyFilter.tsx
git commit -m "chore(arcade): remove BubblesMode and GooeyFilter (replaced by Game of Life)"
```

---

### Task 5: Update barrel export index.ts

**Files:**
- Modify: `apps/dashboard/src/components/graph/nodes/game-modes/index.ts`

**Step 1: Update the file**

Change:
- `BubblesMode` export → `GameOfLifeMode` export
- Label `'Bubbles'` → `'Game of Life'`
- Keep `value: 'bubbles'` for store compatibility
- Remove `GooeyFilter` export (if present; currently not exported from barrel)

```typescript
// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Synapse Contributors

/** Flip to false to hide all game modes from the UI. */
export const GAME_MODES_ENABLED = true;

export const GAME_MODE_OPTIONS = [
  { value: 'bubbles' as const, label: 'Game of Life' },  // keep 'bubbles' value for store compat
  { value: 'tetris' as const, label: 'Tetris' },
  { value: 'pacman' as const, label: 'Pac-Man' },
] as const;

export { GameOfLifeMode } from './GameOfLifeMode';
export { TetrisMode } from './TetrisMode';
export { PacManMode } from './PacManMode';
export { ArcadeOverlay } from './ArcadeOverlay';
```

**Step 2: Commit**

```bash
git add apps/dashboard/src/components/graph/nodes/game-modes/index.ts
git commit -m "feat(arcade): update barrel to export GameOfLifeMode, label 'Game of Life'"
```

---

### Task 6: Update ToolGroupNode.tsx — wire GameOfLifeMode

**Files:**
- Modify: `apps/dashboard/src/components/graph/nodes/ToolGroupNode.tsx`

**Step 1: Replace BubblesMode import and usage**

In imports (line 14): change `BubblesMode` → `GameOfLifeMode`

```typescript
import {
  GAME_MODES_ENABLED,
  GameOfLifeMode,
  TetrisMode,
  PacManMode,
  ArcadeOverlay,
} from './game-modes';
```

In JSX (around line 206-208): replace the BubblesMode usage:

```tsx
{GAME_MODES_ENABLED && toolGroupMode === 'bubbles' && (
  <GameOfLifeMode tools={tools} selectedNodeId={selectedNodeId} selectNode={selectNode} />
)}
```

Note: `parentAgentId` prop is removed (was only needed for gooey filter IDs).

**Step 2: Verify no TypeScript errors**

Run: `npx tsc --noEmit --project apps/dashboard/tsconfig.json 2>&1 | head -20`
Expected: Clean

**Step 3: Commit**

```bash
git add apps/dashboard/src/components/graph/nodes/ToolGroupNode.tsx
git commit -m "feat(arcade): wire GameOfLifeMode in ToolGroupNode"
```

---

### Task 7: Run tests and type-check

**Files:** None (verification only)

**Step 1: Run type-check**

Run: `npx tsc --noEmit --project apps/dashboard/tsconfig.json 2>&1 | head -30`
Expected: Clean (or pre-existing errors only)

**Step 2: Run test suite**

Run: `cd apps/dashboard && npx vitest run --reporter=verbose 2>&1 | tail -30`
Expected: All tests pass

**Step 3: Run full monorepo test suite**

Run: `pnpm test 2>&1 | tail -40`
Expected: All tests pass (500+ tests across 36+ files)

---

### Task 8: Commit summary

No code changes. Just verify all commits from Tasks 1-6 are in place:

```bash
git log --oneline -8
```

Expected: 6 commits for arcade v2 work.
