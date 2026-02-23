// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Synapse Contributors

import { useRef, useEffect, useCallback, useState, useMemo } from 'react';
import type { ToolCallSummary } from '@synapse-ai/core';
import { formatDuration } from '@synapse-ai/core';
import type { GameModeProps } from './types';

const GRID_COLS = 32;
const GRID_ROWS = 20;
const CELL_SIZE = 8;
const CONTAINER_W = GRID_COLS * CELL_SIZE;
const CONTAINER_H = GRID_ROWS * CELL_SIZE;
const TICK_INTERVAL = 150;

const TOOL_COLORS: Record<string, string> = {
  Read: '#0d9488',
  Edit: '#7c3aed',
  Bash: '#ea580c',
  Grep: '#2563eb',
  Glob: '#0891b2',
  Write: '#9333ea',
  Task: '#059669',
  WebSearch: '#d97706',
  WebFetch: '#d97706',
  TodoWrite: '#4f46e5',
};
const DEFAULT_COLOR = '#6b7280';
function getColor(name: string) {
  return TOOL_COLORS[name] ?? DEFAULT_COLOR;
}

type Direction = 'up' | 'down' | 'left' | 'right';
const ALL_DIRS: Direction[] = ['up', 'down', 'left', 'right'];

interface Segment {
  col: number;
  row: number;
  color: string;
  toolUseId: string;
  toolName: string;
}

/** A fruit waiting on the grid to be eaten. */
interface Fruit {
  col: number;
  row: number;
  color: string;
  toolUseId: string;
  toolName: string;
  status: 'running' | 'success' | 'error';
}

interface SnakeState {
  segments: Segment[];
  frozenSegments: Segment[];
  fruits: Fruit[];
  direction: Direction;
  processedCount: number;
  flashFrames: number;
}

const CORNERS: [number, number][] = [
  [0, 0],
  [GRID_COLS - 1, 0],
  [0, GRID_ROWS - 1],
  [GRID_COLS - 1, GRID_ROWS - 1],
];
const CORNER_DIRS: Direction[] = ['right', 'left', 'right', 'left'];

// ── Movement helpers ──────────────────────────────────────────

function move(col: number, row: number, dir: Direction): [number, number] {
  switch (dir) {
    case 'up':
      return [col, row - 1];
    case 'down':
      return [col, row + 1];
    case 'left':
      return [col - 1, row];
    case 'right':
      return [col + 1, row];
  }
}

function isOutOfBounds(col: number, row: number): boolean {
  return col < 0 || col >= GRID_COLS || row < 0 || row >= GRID_ROWS;
}

function isOccupied(segments: Segment[], col: number, row: number): boolean {
  return segments.some((s) => s.col === col && s.row === row);
}

function isBlocked(state: SnakeState, col: number, row: number): boolean {
  return (
    isOutOfBounds(col, row) ||
    isOccupied(state.segments, col, row) ||
    isOccupied(state.frozenSegments, col, row)
  );
}

function isSafe(state: SnakeState, dir: Direction): boolean {
  const [nc, nr] = move(state.segments[0].col, state.segments[0].row, dir);
  return !isBlocked(state, nc, nr);
}

/** Manhattan distance. */
function dist(c1: number, r1: number, c2: number, r2: number): number {
  return Math.abs(c1 - c2) + Math.abs(r1 - r2);
}

/**
 * Pick the best direction toward the nearest fruit.
 * Tries directions sorted by how much they reduce distance to target,
 * filtered to safe moves. Falls back to any safe move, or null if boxed in.
 */
function pickTowardFruit(state: SnakeState): Direction | null {
  const head = state.segments[0];

  // Find nearest fruit
  let nearest: Fruit | null = null;
  let nearestDist = Infinity;
  for (const f of state.fruits) {
    const d = dist(head.col, head.row, f.col, f.row);
    if (d < nearestDist) {
      nearestDist = d;
      nearest = f;
    }
  }

  // Rank directions by distance reduction to target
  const ranked = ALL_DIRS.filter((d) => isSafe(state, d)).sort((a, b) => {
    if (!nearest) return 0;
    const [ac, ar] = move(head.col, head.row, a);
    const [bc, br] = move(head.col, head.row, b);
    return dist(ac, ar, nearest.col, nearest.row) - dist(bc, br, nearest.col, nearest.row);
  });

  return ranked.length > 0 ? ranked[0] : null;
}

/** Find a random unoccupied cell for placing a fruit. */
function randomEmptyCell(state: SnakeState): [number, number] | null {
  // Try random picks first (fast for sparse grids)
  for (let attempt = 0; attempt < 50; attempt++) {
    const col = Math.floor(Math.random() * GRID_COLS);
    const row = Math.floor(Math.random() * GRID_ROWS);
    if (!isBlocked(state, col, row) && !state.fruits.some((f) => f.col === col && f.row === row)) {
      return [col, row];
    }
  }
  return null; // grid is too full
}

// ── Component ─────────────────────────────────────────────────

export function SnakeMode({ tools, selectedNodeId, selectNode }: GameModeProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stateRef = useRef<SnakeState>({
    segments: [{ col: 0, row: 0, color: DEFAULT_COLOR, toolUseId: '', toolName: 'head' }],
    frozenSegments: [],
    fruits: [],
    direction: 'right',
    processedCount: 0,
    flashFrames: 0,
  });
  const toolsRef = useRef<ToolCallSummary[]>(tools);
  const selectedNodeIdRef = useRef<string | null>(selectedNodeId);
  const [tooltipInfo, setTooltipInfo] = useState<{ text: string; x: number; y: number } | null>(
    null,
  );
  const [hoveredToolId, setHoveredToolId] = useState<string | null>(null);
  const hoveredToolIdRef = useRef<string | null>(null);
  const tickRef = useRef(0);

  useEffect(() => {
    toolsRef.current = tools;
  }, [tools]);
  useEffect(() => {
    selectedNodeIdRef.current = selectedNodeId;
  }, [selectedNodeId]);
  useEffect(() => {
    hoveredToolIdRef.current = hoveredToolId;
  }, [hoveredToolId]);

  // ── Render ──────────────────────────────────────────────────

  const renderGrid = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.clearRect(0, 0, CONTAINER_W, CONTAINER_H);

    // Faint grid
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

    const state = stateRef.current;
    const hovered = hoveredToolIdRef.current;
    const selected = selectedNodeIdRef.current;
    const tick = tickRef.current;

    // Frozen segments (faded obstacles from previous lives)
    for (const seg of state.frozenSegments) {
      const x = seg.col * CELL_SIZE;
      const y = seg.row * CELL_SIZE;
      const isHov = hovered !== null && seg.toolUseId === hovered;
      const isSel = selected === `tool-${seg.toolUseId}`;
      ctx.globalAlpha = isHov ? 0.55 : 0.3;
      ctx.fillStyle = seg.color;
      ctx.fillRect(x + 0.5, y + 0.5, CELL_SIZE - 1, CELL_SIZE - 1);
      if (isSel) {
        ctx.strokeStyle = '#a855f7';
        ctx.lineWidth = 1.5;
        ctx.globalAlpha = 0.8;
        ctx.strokeRect(x, y, CELL_SIZE, CELL_SIZE);
      }
      ctx.globalAlpha = 1;
    }

    // Fruits (pulsing dots on the grid)
    for (const fruit of state.fruits) {
      const x = fruit.col * CELL_SIZE;
      const y = fruit.row * CELL_SIZE;
      const isHov = hovered !== null && fruit.toolUseId === hovered;
      const isSel = selected === `tool-${fruit.toolUseId}`;
      const pulse = 0.6 + 0.3 * Math.sin(tick * 0.25);

      // Glow halo
      ctx.globalAlpha = 0.15 * pulse;
      ctx.fillStyle = fruit.color;
      ctx.beginPath();
      ctx.arc(x + CELL_SIZE / 2, y + CELL_SIZE / 2, CELL_SIZE * 0.8, 0, Math.PI * 2);
      ctx.fill();

      // Fruit body (diamond shape)
      ctx.globalAlpha = isHov ? 1.0 : 0.85 * pulse;
      ctx.fillStyle = fruit.status === 'error' ? '#ef4444' : fruit.color;
      ctx.save();
      ctx.translate(x + CELL_SIZE / 2, y + CELL_SIZE / 2);
      ctx.rotate(Math.PI / 4);
      const s = CELL_SIZE * 0.35;
      ctx.fillRect(-s, -s, s * 2, s * 2);
      ctx.restore();

      if (isSel) {
        ctx.strokeStyle = '#a855f7';
        ctx.lineWidth = 1.5;
        ctx.globalAlpha = 1;
        ctx.strokeRect(x, y, CELL_SIZE, CELL_SIZE);
      }
      ctx.globalAlpha = 1;
    }

    // Active snake segments
    for (let i = 0; i < state.segments.length; i++) {
      const seg = state.segments[i];
      const x = seg.col * CELL_SIZE;
      const y = seg.row * CELL_SIZE;
      const isHead = i === 0;
      const isHov = hovered !== null && seg.toolUseId === hovered;
      const isSel = selected === `tool-${seg.toolUseId}`;

      let color = seg.color;
      if (state.flashFrames > 0) color = '#ef4444';

      if (isHead && seg.toolUseId === '') {
        ctx.globalAlpha = 0.9;
      } else {
        ctx.globalAlpha = isHov ? 1.0 : 0.85;
      }

      ctx.fillStyle = color;
      ctx.fillRect(x + 0.5, y + 0.5, CELL_SIZE - 1, CELL_SIZE - 1);

      // Head highlight
      if (isHead) {
        ctx.fillStyle = '#ffffff';
        ctx.globalAlpha = 0.6;
        ctx.fillRect(x + 2, y + 2, CELL_SIZE - 4, CELL_SIZE - 4);
      }

      if (isSel) {
        ctx.strokeStyle = '#a855f7';
        ctx.lineWidth = 1.5;
        ctx.globalAlpha = 1;
        ctx.strokeRect(x, y, CELL_SIZE, CELL_SIZE);
      }
      ctx.globalAlpha = 1;
    }
  }, []);

  // ── Simulation loop ──────────────────────────────────────────

  useEffect(() => {
    const interval = setInterval(() => {
      const state = stateRef.current;
      const tools_ = toolsRef.current;
      tickRef.current++;

      if (state.flashFrames > 0) state.flashFrames--;

      // Spawn new tools as fruits on the grid
      while (state.processedCount < tools_.length) {
        const tc = tools_[state.processedCount];
        const pos = randomEmptyCell(state);
        if (pos) {
          state.fruits.push({
            col: pos[0],
            row: pos[1],
            color: getColor(tc.toolName),
            toolUseId: tc.toolUseId,
            toolName: tc.toolName,
            status: tc.status,
          });
        }
        state.processedCount++;
      }

      // Update fruit statuses (running → success/error)
      for (const fruit of state.fruits) {
        const tc = tools_.find((t) => t.toolUseId === fruit.toolUseId);
        if (tc) fruit.status = tc.status;
      }

      // Pick direction: steer toward nearest fruit, or wander if no fruits
      const chosenDir = pickTowardFruit(state);

      // Boxed in → freeze body, respawn
      if (chosenDir === null) {
        for (const seg of state.segments) {
          if (seg.toolUseId) state.frozenSegments.push({ ...seg });
        }
        let spawnCol = Math.floor(GRID_COLS / 2);
        let spawnRow = Math.floor(GRID_ROWS / 2);
        let spawnDir: Direction = 'right';
        for (let i = 0; i < CORNERS.length; i++) {
          const [cc, cr] = CORNERS[i];
          if (!isBlocked(state, cc, cr)) {
            spawnCol = cc;
            spawnRow = cr;
            spawnDir = CORNER_DIRS[i];
            break;
          }
        }
        for (const seg of state.segments) {
          seg.col = spawnCol;
          seg.row = spawnRow;
        }
        state.direction = spawnDir;
        state.flashFrames = 3;
        renderGrid();
        return;
      }

      state.direction = chosenDir;

      // Move head, body follows
      const [newCol, newRow] = move(state.segments[0].col, state.segments[0].row, state.direction);

      // Check if head lands on a fruit → eat it
      const fruitIdx = state.fruits.findIndex((f) => f.col === newCol && f.row === newRow);
      let ate = false;
      if (fruitIdx >= 0) {
        const fruit = state.fruits[fruitIdx];
        state.fruits.splice(fruitIdx, 1);
        // Grow: add new segment at current tail position before shifting
        const tail = state.segments[state.segments.length - 1];
        state.segments.push({
          col: tail.col,
          row: tail.row,
          color: fruit.color,
          toolUseId: fruit.toolUseId,
          toolName: fruit.toolName,
        });
        ate = true;
        if (fruit.status === 'error') state.flashFrames = 3;
      }

      // Shift body
      for (let i = state.segments.length - 1; i > 0; i--) {
        state.segments[i].col = state.segments[i - 1].col;
        state.segments[i].row = state.segments[i - 1].row;
      }
      state.segments[0].col = newCol;
      state.segments[0].row = newRow;

      // If we didn't eat but there are no fruits, keep wandering — the snake
      // just moves around waiting for new tools to appear
      void ate;

      renderGrid();
    }, TICK_INTERVAL);

    renderGrid();
    return () => clearInterval(interval);
  }, [renderGrid]);

  useEffect(() => {
    renderGrid();
  }, [hoveredToolId, selectedNodeId, renderGrid]);

  // ── Mouse interaction ───────────────────────────────────────

  const findAt = useCallback((col: number, row: number): { toolUseId: string } | undefined => {
    const state = stateRef.current;
    // Check fruits first (on top visually), then active segments, then frozen
    const fruit = state.fruits.find((f) => f.col === col && f.row === row);
    if (fruit) return fruit;
    const seg = state.segments.find((s) => s.col === col && s.row === row && s.toolUseId);
    if (seg) return seg;
    return state.frozenSegments.find((s) => s.col === col && s.row === row);
  }, []);

  const handleClick = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      e.stopPropagation();
      const canvas = canvasRef.current;
      if (!canvas) return;
      const rect = canvas.getBoundingClientRect();
      const col = Math.floor((e.clientX - rect.left) / CELL_SIZE);
      const row = Math.floor((e.clientY - rect.top) / CELL_SIZE);
      const item = findAt(col, row);
      if (item) selectNode(`tool-${item.toolUseId}`, 'graph');
    },
    [findAt, selectNode],
  );

  const handleMove = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const rect = canvas.getBoundingClientRect();
      const col = Math.floor((e.clientX - rect.left) / CELL_SIZE);
      const row = Math.floor((e.clientY - rect.top) / CELL_SIZE);
      const item = findAt(col, row);
      if (item) {
        setHoveredToolId(item.toolUseId);
        const tc = toolsRef.current.find((t) => t.toolUseId === item.toolUseId);
        if (tc) {
          const dur = tc.duration != null ? ` \u00b7 ${formatDuration(tc.duration)}` : '';
          setTooltipInfo({
            text: `${tc.toolName} \u00b7 ${tc.status}${dur}`,
            x: e.clientX - rect.left,
            y: e.clientY - rect.top,
          });
        }
        return;
      }
      setHoveredToolId(null);
      setTooltipInfo(null);
    },
    [findAt],
  );

  const handleLeave = useCallback(() => {
    setHoveredToolId(null);
    setTooltipInfo(null);
  }, []);

  // ── Legend ────────────────────────────────────────────────────

  const legend = useMemo(() => {
    const seen = new Set<string>();
    const items: { name: string; color: string }[] = [];
    for (const t of tools) {
      if (seen.has(t.toolName)) continue;
      seen.add(t.toolName);
      items.push({ name: t.toolName, color: getColor(t.toolName) });
    }
    return items;
  }, [tools]);

  return (
    <div className="relative" style={{ width: CONTAINER_W }}>
      <div style={{ width: CONTAINER_W, height: CONTAINER_H, position: 'relative' }}>
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
      {legend.length > 0 && (
        <div className="flex flex-wrap gap-x-2 gap-y-0.5 mt-1 px-0.5">
          {legend.map(({ name, color }) => (
            <span key={name} className="flex items-center gap-1 text-[8px] text-gray-400">
              <span
                className="w-2 h-2 rounded-sm flex-shrink-0"
                style={{ backgroundColor: color, opacity: 0.85 }}
              />
              {name}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
