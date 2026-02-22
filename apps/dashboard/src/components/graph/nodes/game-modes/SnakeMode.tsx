// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Synapse Contributors

import { useRef, useEffect, useCallback, useState, useMemo } from 'react';
import type { ToolCallSummary } from '@synapse-ai/core';
import type { GameModeProps } from './types';

const GRID_COLS = 32;
const GRID_ROWS = 20;
const CELL_SIZE = 8;
const CONTAINER_W = GRID_COLS * CELL_SIZE;
const CONTAINER_H = GRID_ROWS * CELL_SIZE;
const TICK_INTERVAL = 150; // ms per movement tick

const TOOL_COLORS: Record<string, string> = {
  Read: '#0d9488', Edit: '#7c3aed', Bash: '#ea580c', Grep: '#2563eb',
  Glob: '#0891b2', Write: '#9333ea', Task: '#059669', WebSearch: '#d97706',
  WebFetch: '#d97706', TodoWrite: '#4f46e5',
};
const DEFAULT_COLOR = '#6b7280';
function getColor(name: string) { return TOOL_COLORS[name] ?? DEFAULT_COLOR; }

type Direction = 'up' | 'down' | 'left' | 'right';

interface Segment {
  col: number;
  row: number;
  color: string;
  toolUseId: string;
  toolName: string;
}

interface SnakeState {
  segments: Segment[];          // head is index 0
  direction: Direction;
  processedCount: number;       // how many tools we've consumed
  flashFrames: number;          // countdown for red flash on error
}

function move(col: number, row: number, dir: Direction): [number, number] {
  switch (dir) {
    case 'up':    return [col, (row - 1 + GRID_ROWS) % GRID_ROWS];
    case 'down':  return [col, (row + 1) % GRID_ROWS];
    case 'left':  return [(col - 1 + GRID_COLS) % GRID_COLS, row];
    case 'right': return [(col + 1) % GRID_COLS, row];
  }
}

function turnLeft(dir: Direction): Direction {
  switch (dir) {
    case 'up':    return 'left';
    case 'left':  return 'down';
    case 'down':  return 'right';
    case 'right': return 'up';
  }
}

function turnRight(dir: Direction): Direction {
  switch (dir) {
    case 'up':    return 'right';
    case 'right': return 'down';
    case 'down':  return 'left';
    case 'left':  return 'up';
  }
}

function reverse(dir: Direction): Direction {
  switch (dir) {
    case 'up':    return 'down';
    case 'down':  return 'up';
    case 'left':  return 'right';
    case 'right': return 'left';
  }
}

/** Check if a cell is occupied by any segment (returns true if occupied). */
function isOccupied(segments: Segment[], col: number, row: number): boolean {
  return segments.some((s) => s.col === col && s.row === row);
}

/** Pick the best direction to avoid self-collision. Tries: current, left, right, reverse. */
function pickDirection(segments: Segment[], dir: Direction): Direction {
  const head = segments[0];
  const candidates: Direction[] = [dir, turnLeft(dir), turnRight(dir), reverse(dir)];
  for (const d of candidates) {
    const [nc, nr] = move(head.col, head.row, d);
    if (!isOccupied(segments, nc, nr)) return d;
  }
  // All blocked (shouldn't happen in a 32x20 grid) — just go forward
  return dir;
}

export function SnakeMode({ tools, selectedNodeId, selectNode }: GameModeProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stateRef = useRef<SnakeState>({
    segments: [{ col: 0, row: 0, color: DEFAULT_COLOR, toolUseId: '', toolName: 'head' }],
    direction: 'right',
    processedCount: 0,
    flashFrames: 0,
  });
  const toolsRef = useRef<ToolCallSummary[]>(tools);
  const selectedNodeIdRef = useRef<string | null>(selectedNodeId);
  const [tooltipInfo, setTooltipInfo] = useState<{ text: string; x: number; y: number } | null>(null);
  const [hoveredToolId, setHoveredToolId] = useState<string | null>(null);
  const hoveredToolIdRef = useRef<string | null>(null);
  const tickRef = useRef(0); // global tick counter for pulse animation

  // Keep refs in sync
  useEffect(() => { toolsRef.current = tools; }, [tools]);
  useEffect(() => { selectedNodeIdRef.current = selectedNodeId; }, [selectedNodeId]);
  useEffect(() => { hoveredToolIdRef.current = hoveredToolId; }, [hoveredToolId]);

  // Render
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

    const { segments, flashFrames } = stateRef.current;
    const hovered = hoveredToolIdRef.current;
    const selected = selectedNodeIdRef.current;
    const tick = tickRef.current;
    const completedTools = toolsRef.current;

    for (let i = 0; i < segments.length; i++) {
      const seg = segments[i];
      const x = seg.col * CELL_SIZE;
      const y = seg.row * CELL_SIZE;
      const isHead = i === 0;
      const isHovered = hovered !== null && seg.toolUseId === hovered;
      const isSelected = selected === `tool-${seg.toolUseId}`;

      // Check if this tool is still running (translucent pulse at tail)
      const tc = seg.toolUseId
        ? completedTools.find((t) => t.toolUseId === seg.toolUseId)
        : undefined;
      const isRunning = tc?.status === 'running';

      // Flash red on error
      let color = seg.color;
      if (flashFrames > 0) {
        color = '#ef4444';
      }

      if (isRunning) {
        // Pulsing translucent segment
        const pulse = 0.3 + 0.25 * Math.sin(tick * 0.3);
        ctx.globalAlpha = pulse;
      } else if (isHead && seg.toolUseId === '') {
        // The initial head segment (no tool associated)
        ctx.globalAlpha = 0.9;
      } else {
        ctx.globalAlpha = isHovered ? 1.0 : 0.85;
      }

      ctx.fillStyle = color;
      ctx.fillRect(x + 0.5, y + 0.5, CELL_SIZE - 1, CELL_SIZE - 1);

      // Head gets a brighter inner pixel
      if (isHead) {
        ctx.fillStyle = '#ffffff';
        ctx.globalAlpha = 0.6;
        ctx.fillRect(x + 2, y + 2, CELL_SIZE - 4, CELL_SIZE - 4);
      }

      // Selection ring
      if (isSelected) {
        ctx.strokeStyle = '#a855f7';
        ctx.lineWidth = 1.5;
        ctx.globalAlpha = 1;
        ctx.strokeRect(x, y, CELL_SIZE, CELL_SIZE);
      }

      ctx.globalAlpha = 1;
    }
  }, []);

  // Simulation loop
  useEffect(() => {
    const interval = setInterval(() => {
      const state = stateRef.current;
      const tools_ = toolsRef.current;
      tickRef.current++;

      // Decrease flash counter
      if (state.flashFrames > 0) {
        state.flashFrames--;
      }

      // Process new completed/error tools: add segments
      while (state.processedCount < tools_.length) {
        const tc = tools_[state.processedCount];
        const color = getColor(tc.toolName);
        // Add new segment at the tail position (it will naturally trail)
        const tail = state.segments[state.segments.length - 1];
        state.segments.push({
          col: tail.col,
          row: tail.row,
          color,
          toolUseId: tc.toolUseId,
          toolName: tc.toolName,
        });

        // If error, trigger red flash
        if (tc.status === 'error') {
          state.flashFrames = 3;
        }

        state.processedCount++;
      }

      // Auto-avoidance direction pick
      state.direction = pickDirection(state.segments, state.direction);

      // Move: head advances, body follows
      const [newCol, newRow] = move(state.segments[0].col, state.segments[0].row, state.direction);

      // Shift body: each segment takes the position of the one ahead of it
      for (let i = state.segments.length - 1; i > 0; i--) {
        state.segments[i].col = state.segments[i - 1].col;
        state.segments[i].row = state.segments[i - 1].row;
      }

      // Move head
      state.segments[0].col = newCol;
      state.segments[0].row = newRow;

      renderGrid();
    }, TICK_INTERVAL);

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
    const seg = stateRef.current.segments.find((s) => s.col === col && s.row === row);
    if (seg && seg.toolUseId) {
      selectNode(`tool-${seg.toolUseId}`, 'graph');
    }
  }, [selectNode]);

  const handleMove = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const col = Math.floor((e.clientX - rect.left) / CELL_SIZE);
    const row = Math.floor((e.clientY - rect.top) / CELL_SIZE);
    const seg = stateRef.current.segments.find((s) => s.col === col && s.row === row);
    if (seg && seg.toolUseId) {
      setHoveredToolId(seg.toolUseId);
      const tc = toolsRef.current.find((t) => t.toolUseId === seg.toolUseId);
      if (tc) {
        setTooltipInfo({ text: `${tc.toolName} \u00b7 ${tc.status}`, x: e.clientX - rect.left, y: e.clientY - rect.top });
      }
      return;
    }
    setHoveredToolId(null);
    setTooltipInfo(null);
  }, []);

  const handleLeave = useCallback(() => {
    setHoveredToolId(null);
    setTooltipInfo(null);
  }, []);

  // Legend: distinct tool types
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
              <span className="w-2 h-2 rounded-sm flex-shrink-0" style={{ backgroundColor: color, opacity: 0.85 }} />
              {name}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
