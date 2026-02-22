// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Synapse Contributors

import { useRef, useEffect, useCallback, useState } from 'react';
import type { ToolCallSummary } from '@synapse-ai/core';

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

// Predefined Conway patterns (relative [col, row] coords)
const PATTERNS: Record<string, [number, number][]> = {
  Read:  [[0, 0], [1, 0], [2, 0], [2, 1], [1, 2]],                                     // Glider
  Edit:  [[0, 0], [1, 0], [0, 1], [1, 1]],                                               // Block (still life)
  Bash:  [[0, 0], [1, 0], [2, 0]],                                                       // Blinker
  Grep:  [[1, 0], [4, 0], [0, 1], [0, 2], [4, 2], [0, 3], [1, 3], [2, 3], [3, 3]],     // LWSS
  Write: [[0, 0], [1, 0], [0, 1], [1, 1], [2, 2], [3, 2], [2, 3], [3, 3]],             // Beacon
  Task:  [[1, 0], [2, 0], [0, 1], [1, 1], [1, 2]],                                     // R-pentomino
};

function getPattern(toolName: string): [number, number][] {
  if (PATTERNS[toolName]) return PATTERNS[toolName];
  // Random 5-cell cluster within a 3×3 area
  const cells: [number, number][] = [];
  const used = new Set<string>();
  while (cells.length < 5) {
    const r = Math.floor(Math.random() * 3);
    const c = Math.floor(Math.random() * 3);
    const key = `${r},${c}`;
    if (!used.has(key)) { used.add(key); cells.push([c, r]); }
  }
  return cells;
}

function findOpenArea(grid: Cell[][]): [number, number] {
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
  return [Math.floor(Math.random() * (GRID_COLS - 4)), Math.floor(Math.random() * (GRID_ROWS - 4))];
}

function countNeighbors(grid: Cell[][], r: number, c: number): number {
  let n = 0;
  for (let dr = -1; dr <= 1; dr++) {
    for (let dc = -1; dc <= 1; dc++) {
      if (dr === 0 && dc === 0) continue;
      const nr = r + dr;
      const nc = c + dc;
      if (nr >= 0 && nr < GRID_ROWS && nc >= 0 && nc < GRID_COLS && grid[nr][nc].alive) n++;
    }
  }
  return n;
}

function majorityNeighbor(grid: Cell[][], r: number, c: number): { color: string; toolUseId: string } {
  const counts = new Map<string, { count: number; color: string; toolUseId: string }>();
  for (let dr = -1; dr <= 1; dr++) {
    for (let dc = -1; dc <= 1; dc++) {
      if (dr === 0 && dc === 0) continue;
      const nr = r + dr;
      const nc = c + dc;
      if (nr >= 0 && nr < GRID_ROWS && nc >= 0 && nc < GRID_COLS) {
        const cell = grid[nr][nc];
        if (cell.alive && cell.toolUseId) {
          const e = counts.get(cell.toolUseId) ?? { count: 0, color: cell.color, toolUseId: cell.toolUseId };
          e.count++;
          counts.set(cell.toolUseId, e);
        }
      }
    }
  }
  let best = { color: DEFAULT_COLOR, toolUseId: '' };
  let max = 0;
  for (const e of counts.values()) {
    if (e.count > max) { max = e.count; best = e; }
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
    Array.from({ length: GRID_ROWS }, () => Array.from({ length: GRID_COLS }, emptyCell)),
  );
  const seededToolsRef = useRef(new Set<string>());
  const toolStatusRef = useRef(new Map<string, string>());
  const [hoveredToolId, setHoveredToolId] = useState<string | null>(null);
  const hoveredToolIdRef = useRef<string | null>(null);
  const selectedNodeIdRef = useRef<string | null>(null);
  const [tooltipInfo, setTooltipInfo] = useState<{ text: string; x: number; y: number } | null>(null);

  // Keep refs in sync
  useEffect(() => { hoveredToolIdRef.current = hoveredToolId; }, [hoveredToolId]);
  useEffect(() => { selectedNodeIdRef.current = selectedNodeId; }, [selectedNodeId]);

  // Seed new tools and handle status changes
  useEffect(() => {
    const grid = gridRef.current;
    for (const tc of tools) {
      const prevStatus = toolStatusRef.current.get(tc.toolUseId);
      toolStatusRef.current.set(tc.toolUseId, tc.status);

      if (!seededToolsRef.current.has(tc.toolUseId)) {
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
      } else if (tc.status !== prevStatus) {
        // Status changed — apply freeze or dying
        if (tc.status === 'success') {
          for (let r = 0; r < GRID_ROWS; r++) {
            for (let c = 0; c < GRID_COLS; c++) {
              if (grid[r][c].toolUseId === tc.toolUseId && grid[r][c].alive) {
                grid[r][c].frozen = true;
              }
            }
          }
        } else if (tc.status === 'error') {
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
      }
    }
  }, [tools]);

  // Render grid to canvas
  const renderGrid = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.clearRect(0, 0, CONTAINER_W, CONTAINER_H);

    // Faint grid lines
    ctx.strokeStyle = 'rgba(255,255,255,0.02)';
    ctx.lineWidth = 0.5;
    for (let r = 0; r <= GRID_ROWS; r++) {
      ctx.beginPath(); ctx.moveTo(0, r * CELL_SIZE); ctx.lineTo(CONTAINER_W, r * CELL_SIZE); ctx.stroke();
    }
    for (let c = 0; c <= GRID_COLS; c++) {
      ctx.beginPath(); ctx.moveTo(c * CELL_SIZE, 0); ctx.lineTo(c * CELL_SIZE, CONTAINER_H); ctx.stroke();
    }

    const grid = gridRef.current;
    const hovered = hoveredToolIdRef.current;
    const selected = selectedNodeIdRef.current;

    for (let r = 0; r < GRID_ROWS; r++) {
      for (let c = 0; c < GRID_COLS; c++) {
        const cell = grid[r][c];
        if (!cell.alive) continue;

        const x = c * CELL_SIZE;
        const y = r * CELL_SIZE;
        const isHovered = hovered === cell.toolUseId;
        const isSelected = selected === `tool-${cell.toolUseId}`;

        ctx.fillStyle = cell.color;

        if (cell.dying > 0) {
          const scale = cell.dying / 3;
          const inset = CELL_SIZE * (1 - scale) / 2;
          ctx.globalAlpha = scale * 0.7;
          ctx.fillRect(x + inset, y + inset, CELL_SIZE * scale, CELL_SIZE * scale);
        } else if (cell.frozen) {
          ctx.globalAlpha = isHovered ? 1.0 : 0.95;
          ctx.fillRect(x + 0.5, y + 0.5, CELL_SIZE - 1, CELL_SIZE - 1);
          // Glow border
          ctx.strokeStyle = cell.color;
          ctx.lineWidth = 1;
          ctx.strokeRect(x + 0.5, y + 0.5, CELL_SIZE - 1, CELL_SIZE - 1);
        } else {
          const pulse = 0.7 + 0.2 * Math.sin(cell.age * 0.5);
          ctx.globalAlpha = isHovered ? 1.0 : pulse;
          ctx.fillRect(x + 0.5, y + 0.5, CELL_SIZE - 1, CELL_SIZE - 1);
        }

        if (isSelected) {
          ctx.strokeStyle = '#a855f7';
          ctx.lineWidth = 1.5;
          ctx.globalAlpha = 1;
          ctx.strokeRect(x, y, CELL_SIZE, CELL_SIZE);
        }

        ctx.globalAlpha = 1;
      }
    }
  }, []);

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
              if (cell.dying > 1) {
                next[r][c] = { ...cell, dying: cell.dying - 1, age: cell.age + 1 };
              }
              // else dies completely
            } else if (cell.frozen) {
              next[r][c] = { ...cell, age: cell.age + 1 };
            } else if (neighbors === 2 || neighbors === 3) {
              next[r][c] = { ...cell, age: cell.age + 1 };
            }
            // else dies (underpopulation / overpopulation)
          } else if (neighbors === 3) {
            const { color, toolUseId } = majorityNeighbor(grid, r, c);
            next[r][c] = { alive: true, frozen: false, color, toolUseId, age: 0, dying: 0 };
          }
        }
      }

      gridRef.current = next;
      renderGrid();
    }, SIM_INTERVAL);

    // Initial render
    renderGrid();

    return () => clearInterval(interval);
  }, [renderGrid]);

  // Re-render on hover/selection changes
  useEffect(() => { renderGrid(); }, [hoveredToolId, selectedNodeId, renderGrid]);

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
          setTooltipInfo({ text: `${tc.toolName} \u00b7 ${tc.status}`, x: e.clientX - rect.left, y: e.clientY - rect.top });
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
