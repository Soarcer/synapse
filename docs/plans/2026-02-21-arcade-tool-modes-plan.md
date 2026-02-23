# Arcade Tool Group Modes — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add 3 game-like tool group visualization modes (Bubbles, Tetris, Pac-Man) + a separate arcade overlay (CRT, pixel font, score, particles, sounds) to the existing ToolGroupNode.

**Architecture:** New game modes are isolated in `game-modes/` subfolder under the existing nodes directory. The store, dropdown, layout, and keyboard handler get minimal additive changes. A killswitch constant allows disabling everything by flipping one boolean.

**Tech Stack:** React 19, CSS keyframes/transitions, SVG filters (gooey effect), CSS clip-path (Pac-Man), CSS box-shadow (pixel sprites), Canvas 2D (particles), Web Audio API (8-bit sounds), Google Fonts (Press Start 2P).

**Design doc:** `docs/plans/2026-02-21-arcade-tool-modes-design.md`

---

### Task 1: Store — Add arcade state + widen toolGroupMode type

**Files:**

- Modify: `apps/dashboard/src/store/agentStore.ts`

**Step 1: Widen the ToolGroupMode type**

In the `PersistedViewSettings` interface (line 48), change:

```typescript
toolGroupMode?: 'pillGrid' | 'timeline' | 'heatmap';
```

to:

```typescript
toolGroupMode?: 'pillGrid' | 'timeline' | 'heatmap' | 'bubbles' | 'tetris' | 'pacman';
```

Do the same in the `AgentStore` interface (line 212) and the `setToolGroupMode` action type (line 244).

**Step 2: Add arcade state fields**

Add to `PersistedViewSettings` (line 45-51):

```typescript
arcadeMode?: boolean;
arcadeSoundEnabled?: boolean;
arcadeVolume?: number;
```

Add to `AgentStore` interface (after `toolGroupMode` on line 212):

```typescript
arcadeMode: boolean;
arcadeSoundEnabled: boolean;
arcadeVolume: number;
```

Add actions (after `setToolGroupMode` on line 244):

```typescript
setArcadeMode: (on: boolean) => void;
setArcadeSoundEnabled: (on: boolean) => void;
setArcadeVolume: (vol: number) => void;
```

**Step 3: Add initial state + setters**

After the `toolGroupMode` initial state (line 299), add:

```typescript
arcadeMode: savedViewSettings.arcadeMode ?? false,
arcadeSoundEnabled: savedViewSettings.arcadeSoundEnabled ?? false,
arcadeVolume: savedViewSettings.arcadeVolume ?? 15,
```

After the `setToolGroupMode` setter (line 439), add:

```typescript
setArcadeMode: (arcadeMode) => { persistViewSettings({ arcadeMode }); set({ arcadeMode }); },
setArcadeSoundEnabled: (arcadeSoundEnabled) => { persistViewSettings({ arcadeSoundEnabled }); set({ arcadeSoundEnabled }); },
setArcadeVolume: (arcadeVolume) => { persistViewSettings({ arcadeVolume }); set({ arcadeVolume }); },
```

**Step 4: Verify tests pass**

Run: `cd apps/dashboard && npx vitest run src/store/__tests__/agentStore.test.ts`
Expected: All existing tests pass (no API changes to existing actions).

**Step 5: Commit**

```bash
git add apps/dashboard/src/store/agentStore.ts
git commit -m "feat(arcade): add arcade state + widen toolGroupMode type"
```

---

### Task 2: Keyboard shortcut — `G` key for arcade mode

**Files:**

- Modify: `apps/dashboard/src/App.tsx`

**Step 1: Add `G` key handler**

The `A` key is already taken by notifications (line 211). Use `G` (for "game") instead.

After the `a` key handler (line 214), add:

```typescript
if (e.key === 'g' && !e.ctrlKey && !e.metaKey) {
  const store = useAgentStore.getState();
  store.setArcadeMode(!store.arcadeMode);
}
```

**Step 2: Commit**

```bash
git add apps/dashboard/src/App.tsx
git commit -m "feat(arcade): G key toggles arcade mode"
```

---

### Task 3: Game modes barrel + killswitch

**Files:**

- Create: `apps/dashboard/src/components/graph/nodes/game-modes/index.ts`

**Step 1: Create the barrel export with killswitch**

```typescript
// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Synapse Contributors

/** Flip to false to hide all game modes from the UI. */
export const GAME_MODES_ENABLED = true;

export const GAME_MODE_OPTIONS = [
  { value: 'bubbles' as const, label: 'Bubbles' },
  { value: 'tetris' as const, label: 'Tetris' },
  { value: 'pacman' as const, label: 'Pac-Man' },
] as const;
```

**Step 2: Commit**

```bash
git add apps/dashboard/src/components/graph/nodes/game-modes/index.ts
git commit -m "feat(arcade): game-modes barrel export + killswitch"
```

---

### Task 4: GooeyFilter component

**Files:**

- Create: `apps/dashboard/src/components/graph/nodes/game-modes/GooeyFilter.tsx`

**Step 1: Create the SVG filter component**

```tsx
// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Synapse Contributors

/**
 * Inline SVG filter definitions for the gooey merge effect.
 * Renders a hidden <svg> with one <filter> per tool type so that
 * same-color blobs merge visually while different colors stay separate.
 *
 * Usage: <GooeyFilter id="goo-parentId" toolNames={['Read','Edit']} />
 * Then on wrapper divs: style={{ filter: `url(#goo-parentId-Read)` }}
 */
export function GooeyFilter({ id, toolNames }: { id: string; toolNames: string[] }) {
  return (
    <svg style={{ position: 'absolute', width: 0, height: 0 }} aria-hidden>
      <defs>
        {toolNames.map((name) => (
          <filter key={name} id={`${id}-${name}`}>
            <feGaussianBlur in="SourceGraphic" stdDeviation="10" result="blur" />
            <feColorMatrix
              in="blur"
              mode="matrix"
              values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 18 -7"
              result="goo"
            />
            <feComposite in="SourceGraphic" in2="goo" operator="atop" />
          </filter>
        ))}
      </defs>
    </svg>
  );
}
```

**Step 2: Commit**

```bash
git add apps/dashboard/src/components/graph/nodes/game-modes/GooeyFilter.tsx
git commit -m "feat(arcade): GooeyFilter SVG component"
```

---

### Task 5: BubblesMode component

**Files:**

- Create: `apps/dashboard/src/components/graph/nodes/game-modes/BubblesMode.tsx`

**Step 1: Create the bubbles visualization**

This component renders tool calls as floating, gooey-merging bubbles. Key elements:

```tsx
// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Synapse Contributors

import { useMemo, useState } from 'react';
import type { ToolCallSummary } from '@synapse-ai/core';
import { formatDuration } from '@synapse-ai/core';
import { GooeyFilter } from './GooeyFilter';
import { Tooltip } from '../../../ui/Tooltip';

// Import TOOL_COLORS from parent — or duplicate the subset needed
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

const CONTAINER_W = 264;
const CONTAINER_H = 168;

interface Props {
  tools: ToolCallSummary[];
  parentAgentId: string;
  selectedNodeId: string | null;
  selectNode: (id: string | null, source?: 'graph' | 'lens') => void;
}

export function BubblesMode({ tools, parentAgentId, selectedNodeId, selectNode }: Props) {
  const [hoveredType, setHoveredType] = useState<string | null>(null);

  // Group tools by type
  const toolsByType = useMemo(() => {
    const map = new Map<string, ToolCallSummary[]>();
    for (const t of tools) {
      const list = map.get(t.toolName) ?? [];
      list.push(t);
      map.set(t.toolName, list);
    }
    return map;
  }, [tools]);

  const toolNames = useMemo(() => [...toolsByType.keys()], [toolsByType]);

  // Position blobs: spread types across X, tools within type along Y
  const blobPositions = useMemo(() => {
    const positions = new Map<string, { x: number; y: number; r: number }>();
    const types = [...toolsByType.entries()];
    const slotW = CONTAINER_W / Math.max(types.length, 1);

    for (let ti = 0; ti < types.length; ti++) {
      const [, tcs] = types[ti];
      const cx = slotW * ti + slotW / 2;
      for (let i = 0; i < tcs.length; i++) {
        const tc = tcs[i];
        const r = Math.max(12, Math.min(36, (tc.duration ?? 200) / 50));
        // Spread vertically within the type's column
        const slotH = CONTAINER_H / Math.max(tcs.length, 1);
        const cy = slotH * i + slotH / 2;
        positions.set(tc.toolUseId, { x: cx, y: cy, r });
      }
    }
    return positions;
  }, [toolsByType]);

  const filterId = `goo-${parentAgentId}`;

  return (
    <div
      className="relative"
      style={{ width: CONTAINER_W, height: CONTAINER_H, overflow: 'hidden' }}
    >
      <GooeyFilter id={filterId} toolNames={toolNames} />

      {[...toolsByType.entries()].map(([toolName, tcs]) => {
        const isHovered = hoveredType === toolName;
        return (
          <div
            key={toolName}
            className="absolute inset-0"
            style={{
              filter: `url(#${filterId}-${toolName})`,
              // Reduce blur on hover to un-goo and reveal individuals
              ...(isHovered ? { filter: 'none' } : {}),
            }}
            onMouseEnter={() => setHoveredType(toolName)}
            onMouseLeave={() => setHoveredType(null)}
          >
            {tcs.map((tc) => {
              const pos = blobPositions.get(tc.toolUseId);
              if (!pos) return null;
              const nodeId = `tool-${tc.toolUseId}`;
              const isSelected = selectedNodeId === nodeId;
              const isRunning = tc.status === 'running';
              const isError = tc.status === 'error';
              const dur = tc.duration != null ? formatDuration(tc.duration) : null;

              return (
                <Tooltip
                  key={tc.toolUseId}
                  content={`${tc.toolName}${dur ? ` · ${dur}` : ''} · ${tc.status}`}
                >
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      selectNode(nodeId, 'graph');
                    }}
                    className={`absolute rounded-full transition-all cursor-pointer ${
                      isSelected ? 'ring-2 ring-purple-400 ring-offset-1 ring-offset-gray-900' : ''
                    }`}
                    style={{
                      width: pos.r * 2,
                      height: pos.r * 2,
                      left: pos.x - pos.r,
                      top: pos.y - pos.r,
                      backgroundColor: getColor(tc.toolName),
                      opacity: isError ? 0.5 : 0.85,
                      animation: isRunning
                        ? 'bubble-float 2s ease-in-out infinite alternate'
                        : isError
                          ? 'bubble-sink 3s ease-in forwards'
                          : undefined,
                    }}
                  />
                </Tooltip>
              );
            })}
          </div>
        );
      })}

      {/* CSS keyframes */}
      <style>{`
        @keyframes bubble-float {
          0% { transform: translateY(0) rotate(0deg); }
          100% { transform: translateY(-4px) rotate(2deg); }
        }
        @keyframes bubble-sink {
          to { transform: translateY(16px); opacity: 0.3; filter: saturate(0.3); }
        }
        @keyframes bubble-pop {
          0% { transform: scale(1); opacity: 1; }
          50% { transform: scale(1.4); opacity: 0.6; }
          100% { transform: scale(0); opacity: 0; }
        }
      `}</style>
    </div>
  );
}
```

**Step 2: Commit**

```bash
git add apps/dashboard/src/components/graph/nodes/game-modes/BubblesMode.tsx
git commit -m "feat(arcade): BubblesMode gooey merge visualization"
```

---

### Task 6: TetrisMode component

**Files:**

- Create: `apps/dashboard/src/components/graph/nodes/game-modes/TetrisMode.tsx`

**Step 1: Create the Tetris stacking visualization**

Key design decisions:

- 10 columns × 16 rows, each cell 16×16px
- Tool blocks are 2 cells wide, 1-4 cells tall (based on duration)
- Blocks stack bottom-up using a greedy column-fit algorithm
- New blocks animate from top with spring bounce
- Error blocks get diagonal stripe overlay
- Row-clear animation when full rows are detected

```tsx
// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Synapse Contributors

import { useMemo } from 'react';
import type { ToolCallSummary } from '@synapse-ai/core';
import { formatDuration } from '@synapse-ai/core';
import { Tooltip } from '../../../ui/Tooltip';

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
            if (grid[r][c]) {
              blocked = true;
              break;
            }
          }
          if (blocked) {
            startRow = r + 1;
          } else {
            // Check if there's room for the full height
            let fits = true;
            for (let dr = 0; dr < h && fits; dr++) {
              if (startRow + dr >= ROWS) {
                fits = false;
                break;
              }
              for (let c = col; c < col + BLOCK_W; c++) {
                if (grid[startRow + dr][c]) {
                  fits = false;
                  break;
                }
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
          <Tooltip
            key={tc.toolUseId}
            content={`${tc.toolName}${dur ? ` · ${dur}` : ''} · ${tc.status}`}
          >
            <button
              onClick={(e) => {
                e.stopPropagation();
                selectNode(nodeId, 'graph');
              }}
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
                animation: isRunning
                  ? 'tetris-drop 0.5s cubic-bezier(0.34, 1.56, 0.64, 1)'
                  : undefined,
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
```

**Step 2: Commit**

```bash
git add apps/dashboard/src/components/graph/nodes/game-modes/TetrisMode.tsx
git commit -m "feat(arcade): TetrisMode stacking blocks visualization"
```

---

### Task 7: PacManMode component

**Files:**

- Create: `apps/dashboard/src/components/graph/nodes/game-modes/PacManMode.tsx`

**Step 1: Create the Pac-Man ghost-eating visualization**

Key design:

- Horizontal corridor, Pac-Man moves left→right
- Each tool call = a ghost sprite (colored by tool type)
- Completed tools = floating eyes (ghost was eaten)
- Running tools = blue vulnerable ghost
- Error tools = solid ghost (caught Pac-Man)
- Ghost sprites rendered via CSS box-shadow pixel art
- Pac-Man animated with CSS clip-path

```tsx
// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Synapse Contributors

import { useMemo } from 'react';
import type { ToolCallSummary } from '@synapse-ai/core';
import { formatDuration } from '@synapse-ai/core';
import { Tooltip } from '../../../ui/Tooltip';

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

const GHOST_SIZE = 20;
const GHOST_GAP = 8;
const DOT_SIZE = 4;
const PAC_SIZE = 24;
const ROW_HEIGHT = 40;
const GHOSTS_PER_ROW = 10;

// Vulnerable ghost color (classic blue)
const VULNERABLE_COLOR = '#2563eb';

interface Props {
  tools: ToolCallSummary[];
  selectedNodeId: string | null;
  selectNode: (id: string | null, source?: 'graph' | 'lens') => void;
}

export function PacManMode({ tools, selectedNodeId, selectNode }: Props) {
  // Find Pac-Man position: after last completed tool
  const pacIndex = useMemo(() => {
    let last = -1;
    for (let i = 0; i < tools.length; i++) {
      if (tools[i].status === 'success') last = i;
    }
    return last;
  }, [tools]);

  const numRows = Math.ceil(tools.length / GHOSTS_PER_ROW) || 1;
  const containerW =
    Math.min(tools.length, GHOSTS_PER_ROW) * (GHOST_SIZE + GHOST_GAP) + PAC_SIZE + 32;
  const containerH = numRows * ROW_HEIGHT + 16;

  return (
    <div
      className="relative"
      style={{ width: Math.max(containerW, 200), height: Math.max(containerH, 60) }}
    >
      {/* Dot path (small dots between ghosts) */}
      {tools.map((_, i) => {
        const row = Math.floor(i / GHOSTS_PER_ROW);
        const col = i % GHOSTS_PER_ROW;
        const x = 16 + col * (GHOST_SIZE + GHOST_GAP) + GHOST_SIZE / 2;
        const y = 8 + row * ROW_HEIGHT + ROW_HEIGHT / 2;
        const isEaten = tools[i].status === 'success';
        return (
          <div
            key={`dot-${i}`}
            className="absolute rounded-full"
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
          left:
            16 +
            (pacIndex >= 0
              ? (pacIndex % GHOSTS_PER_ROW) * (GHOST_SIZE + GHOST_GAP) + GHOST_SIZE + 4
              : -4),
          top:
            8 +
            Math.floor(Math.max(0, pacIndex) / GHOSTS_PER_ROW) * ROW_HEIGHT +
            (ROW_HEIGHT - PAC_SIZE) / 2,
          borderRadius: '50%',
          backgroundColor: '#ffdd00',
          animation: 'pacman-chomp 0.3s infinite alternate',
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
        const isEaten = tc.status === 'success';
        const isRunning = tc.status === 'running';
        const isError = tc.status === 'error';
        const dur = tc.duration != null ? formatDuration(tc.duration) : null;

        // Ghost color: blue if running (vulnerable), tool color if pending, red flash if error
        const ghostColor = isRunning
          ? VULNERABLE_COLOR
          : isError
            ? '#ef4444'
            : getColor(tc.toolName);

        return (
          <Tooltip
            key={tc.toolUseId}
            content={`${tc.toolName}${dur ? ` · ${dur}` : ''} · ${tc.status}`}
          >
            <button
              onClick={(e) => {
                e.stopPropagation();
                selectNode(nodeId, 'graph');
              }}
              className={`absolute cursor-pointer transition-all ${
                isSelected ? 'ring-1 ring-purple-400 rounded z-10' : ''
              }`}
              style={{
                left: x,
                top: y,
                width: GHOST_SIZE,
                height: GHOST_SIZE,
              }}
            >
              {isEaten ? (
                // Floating eyes (ghost was eaten)
                <div
                  className="relative w-full h-full"
                  style={{ animation: 'ghost-eyes-float 2s ease-in-out infinite alternate' }}
                >
                  <div
                    className="absolute bg-white rounded-full"
                    style={{ width: 5, height: 6, left: 3, top: 4 }}
                  >
                    <div
                      className="absolute bg-blue-900 rounded-full"
                      style={{ width: 3, height: 3, left: 1, top: 2 }}
                    />
                  </div>
                  <div
                    className="absolute bg-white rounded-full"
                    style={{ width: 5, height: 6, left: 12, top: 4 }}
                  >
                    <div
                      className="absolute bg-blue-900 rounded-full"
                      style={{ width: 3, height: 3, left: 1, top: 2 }}
                    />
                  </div>
                </div>
              ) : (
                // Full ghost sprite
                <div
                  className="relative w-full h-full"
                  style={{
                    animation: isRunning
                      ? 'ghost-wobble 0.5s ease-in-out infinite alternate'
                      : undefined,
                  }}
                >
                  {/* Ghost body: dome top + wavy bottom */}
                  <div
                    className="absolute inset-0"
                    style={{
                      backgroundColor: ghostColor,
                      borderRadius: '50% 50% 0 0',
                      clipPath:
                        'polygon(0% 0%, 100% 0%, 100% 85%, 85% 100%, 70% 85%, 50% 100%, 30% 85%, 15% 100%, 0% 85%)',
                    }}
                  />
                  {/* Eyes */}
                  <div
                    className="absolute bg-white rounded-full"
                    style={{ width: 5, height: 5, left: 3, top: 5 }}
                  >
                    <div
                      className="absolute bg-blue-900 rounded-full"
                      style={{ width: 2.5, height: 2.5, left: 1.5, top: 1.5 }}
                    />
                  </div>
                  <div
                    className="absolute bg-white rounded-full"
                    style={{ width: 5, height: 5, left: 11, top: 5 }}
                  >
                    <div
                      className="absolute bg-blue-900 rounded-full"
                      style={{ width: 2.5, height: 2.5, left: 1.5, top: 1.5 }}
                    />
                  </div>
                </div>
              )}
            </button>
          </Tooltip>
        );
      })}

      <style>{`
        @keyframes pacman-chomp {
          0% { clip-path: polygon(100% 50%, 50% 5%, 0% 0%, 0% 100%, 50% 95%); }
          100% { clip-path: polygon(100% 50%, 50% 35%, 0% 0%, 0% 100%, 50% 65%); }
        }
        @keyframes ghost-wobble {
          from { transform: translateX(-1px); }
          to { transform: translateX(1px); }
        }
        @keyframes ghost-eyes-float {
          from { transform: translateY(0) translateX(2px); opacity: 0.6; }
          to { transform: translateY(-3px) translateX(-2px); opacity: 0.4; }
        }
      `}</style>
    </div>
  );
}
```

**Step 2: Commit**

```bash
git add apps/dashboard/src/components/graph/nodes/game-modes/PacManMode.tsx
git commit -m "feat(arcade): PacManMode ghost-eating trail visualization"
```

---

### Task 8: Arcade utility functions — particles, sound, score

**Files:**

- Create: `apps/dashboard/src/components/graph/nodes/game-modes/arcade-utils.ts`

**Step 1: Create shared arcade utilities**

```typescript
// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Synapse Contributors

// ── Particle system ──────────────────────────────────────────

export interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  color: string;
  size: number;
}

export function spawnBurst(x: number, y: number, color: string, count = 12): Particle[] {
  return Array.from({ length: count }, () => ({
    x,
    y,
    vx: (Math.random() - 0.5) * 6,
    vy: (Math.random() - 0.5) * 6 - 2, // upward bias
    life: 1,
    color,
    size: Math.random() * 3 + 1,
  }));
}

export function updateParticles(particles: Particle[], dt: number): Particle[] {
  const alive: Particle[] = [];
  for (const p of particles) {
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    p.vy += 4 * dt; // gravity
    p.life -= dt * 2; // fade over ~0.5s
    if (p.life > 0) alive.push(p);
  }
  return alive;
}

export function drawParticles(ctx: CanvasRenderingContext2D, particles: Particle[]) {
  for (const p of particles) {
    ctx.globalAlpha = Math.max(0, p.life);
    ctx.fillStyle = p.color;
    ctx.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
  }
  ctx.globalAlpha = 1;
}

// ── Score computation ────────────────────────────────────────

export interface ScoreState {
  score: number;
  combo: number;
  lastStatus: 'success' | 'error' | 'running' | null;
}

export function computeScore(statuses: Array<'success' | 'error' | 'running'>): ScoreState {
  let score = 0;
  let combo = 0;
  let lastStatus: ScoreState['lastStatus'] = null;

  for (const status of statuses) {
    if (status === 'success') {
      combo++;
      score += 100 + combo * 50;
    } else if (status === 'error') {
      combo = 0;
    }
    // running doesn't affect score
    if (status !== 'running') lastStatus = status;
  }

  return { score, combo, lastStatus };
}

// ── 8-bit sound ──────────────────────────────────────────────

let audioCtx: AudioContext | null = null;

function getAudioCtx(): AudioContext {
  if (!audioCtx) audioCtx = new AudioContext();
  return audioCtx;
}

export function playChirp(volume: number) {
  if (volume <= 0) return;
  const ctx = getAudioCtx();
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = 'square';
  osc.frequency.setValueAtTime(660, ctx.currentTime);
  osc.frequency.exponentialRampToValueAtTime(880, ctx.currentTime + 0.08);
  gain.gain.setValueAtTime((volume / 100) * 0.15, ctx.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.1);
  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.start();
  osc.stop(ctx.currentTime + 0.1);
}

export function playBuzz(volume: number) {
  if (volume <= 0) return;
  const ctx = getAudioCtx();
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = 'sawtooth';
  osc.frequency.setValueAtTime(120, ctx.currentTime);
  gain.gain.setValueAtTime((volume / 100) * 0.12, ctx.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.3);
  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.start();
  osc.stop(ctx.currentTime + 0.3);
}

export function playCombo(volume: number) {
  if (volume <= 0) return;
  const ctx = getAudioCtx();
  const notes = [523, 659, 784]; // C5 E5 G5
  for (let i = 0; i < notes.length; i++) {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'square';
    osc.frequency.setValueAtTime(notes[i], ctx.currentTime + i * 0.05);
    gain.gain.setValueAtTime((volume / 100) * 0.1, ctx.currentTime + i * 0.05);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + i * 0.05 + 0.15);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(ctx.currentTime + i * 0.05);
    osc.stop(ctx.currentTime + i * 0.05 + 0.15);
  }
}

// ── Pixel font loader ────────────────────────────────────────

let fontLoaded = false;

export function ensurePixelFont() {
  if (fontLoaded) return;
  fontLoaded = true;
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = 'https://fonts.googleapis.com/css2?family=Press+Start+2P&display=swap';
  document.head.appendChild(link);
}
```

**Step 2: Commit**

```bash
git add apps/dashboard/src/components/graph/nodes/game-modes/arcade-utils.ts
git commit -m "feat(arcade): shared arcade utilities (particles, sound, score, font)"
```

---

### Task 9: ArcadeOverlay component

**Files:**

- Create: `apps/dashboard/src/components/graph/nodes/game-modes/ArcadeOverlay.tsx`

**Step 1: Create the arcade overlay wrapper**

```tsx
// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Synapse Contributors

import { useEffect, useRef, useMemo, useCallback, useState, type ReactNode } from 'react';
import type { ToolCallSummary } from '@synapse-ai/core';
import {
  computeScore,
  ensurePixelFont,
  spawnBurst,
  updateParticles,
  drawParticles,
  playChirp,
  playBuzz,
  playCombo,
  type Particle,
} from './arcade-utils';

interface Props {
  enabled: boolean;
  soundEnabled: boolean;
  volume: number;
  tools: ToolCallSummary[];
  children: ReactNode;
}

export function ArcadeOverlay({ enabled, soundEnabled, volume, tools, children }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const particlesRef = useRef<Particle[]>([]);
  const prevCountRef = useRef(tools.length);
  const [shaking, setShaking] = useState(false);

  // Load pixel font on first enable
  useEffect(() => {
    if (enabled) ensurePixelFont();
  }, [enabled]);

  // Score
  const { score, combo } = useMemo(() => computeScore(tools.map((t) => t.status)), [tools]);

  // Spawn particles + play sounds on tool count changes
  const handleNewTools = useCallback(() => {
    if (!enabled) return;
    const prev = prevCountRef.current;
    const curr = tools.length;
    if (curr <= prev) {
      prevCountRef.current = curr;
      return;
    }

    for (let i = prev; i < curr; i++) {
      const tc = tools[i];
      const color = tc.status === 'error' ? '#ef4444' : '#2dd4bf';
      // Spawn particles at a random position within the container
      const x = 40 + Math.random() * 100;
      const y = 20 + Math.random() * 40;
      particlesRef.current.push(...spawnBurst(x, y, color, 8));

      if (soundEnabled) {
        if (tc.status === 'error') {
          playBuzz(volume);
          setShaking(true);
          setTimeout(() => setShaking(false), 400);
        } else if (combo > 3) {
          playCombo(volume);
        } else {
          playChirp(volume);
        }
      }
    }
    prevCountRef.current = curr;
  }, [enabled, tools, soundEnabled, volume, combo]);

  useEffect(() => {
    handleNewTools();
  }, [handleNewTools]);

  // Particle animation loop
  useEffect(() => {
    if (!enabled) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let raf: number;
    let lastTime = performance.now();

    function loop(now: number) {
      const dt = Math.min((now - lastTime) / 1000, 0.05);
      lastTime = now;

      canvas!.width = canvas!.offsetWidth;
      canvas!.height = canvas!.offsetHeight;
      ctx!.clearRect(0, 0, canvas!.width, canvas!.height);

      particlesRef.current = updateParticles(particlesRef.current, dt);
      drawParticles(ctx!, particlesRef.current);

      if (particlesRef.current.length > 0) {
        raf = requestAnimationFrame(loop);
      }
    }

    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [enabled, tools.length]); // restart loop when new tools arrive

  if (!enabled) return <>{children}</>;

  return (
    <div
      className="relative"
      style={{
        fontFamily: "'Press Start 2P', monospace",
        fontSize: '8px',
        animation: shaking ? 'arcade-shake 0.4s ease-out' : undefined,
      }}
    >
      {children}

      {/* CRT scanlines overlay */}
      <div
        className="absolute inset-0 pointer-events-none rounded-lg"
        style={{
          zIndex: 100,
          background: `repeating-linear-gradient(
            to bottom,
            transparent 0px, transparent 1px,
            rgba(0, 0, 0, 0.12) 1px, rgba(0, 0, 0, 0.12) 2px
          )`,
          animation: 'crt-flicker 0.05s infinite alternate',
        }}
      />

      {/* Phosphor glow on text */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{ textShadow: '0 0 4px currentColor', zIndex: 99 }}
      />

      {/* Particle canvas */}
      <canvas
        ref={canvasRef}
        className="absolute inset-0 pointer-events-none"
        style={{ zIndex: 101 }}
      />

      {/* Score counter */}
      <div
        className="absolute top-1 right-2 text-yellow-400 z-50 pointer-events-none"
        style={{ fontFamily: "'Press Start 2P', monospace", fontSize: '7px' }}
      >
        <div>{String(score).padStart(6, '0')}</div>
        {combo > 1 && (
          <div
            className="text-red-400 mt-0.5"
            style={{
              animation: 'combo-bounce 0.3s ease-out',
              fontSize: '6px',
            }}
          >
            x{combo} COMBO!
          </div>
        )}
      </div>

      <style>{`
        @keyframes crt-flicker {
          from { opacity: 0.97; }
          to { opacity: 1; }
        }
        @keyframes arcade-shake {
          0%, 100% { transform: translate(0, 0); }
          10% { transform: translate(-2px, 1px); }
          20% { transform: translate(3px, -1px); }
          30% { transform: translate(-1px, 2px); }
          40% { transform: translate(2px, -2px); }
          50% { transform: translate(-3px, 1px); }
          60% { transform: translate(1px, -1px); }
          70% { transform: translate(-2px, 2px); }
          80% { transform: translate(3px, 1px); }
          90% { transform: translate(-1px, -2px); }
        }
        @keyframes combo-bounce {
          0% { transform: scale(1.5); }
          100% { transform: scale(1); }
        }
      `}</style>
    </div>
  );
}
```

**Step 2: Commit**

```bash
git add apps/dashboard/src/components/graph/nodes/game-modes/ArcadeOverlay.tsx
git commit -m "feat(arcade): ArcadeOverlay with CRT, particles, score, shake"
```

---

### Task 10: Update barrel export with all components

**Files:**

- Modify: `apps/dashboard/src/components/graph/nodes/game-modes/index.ts`

**Step 1: Add all exports**

```typescript
// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Synapse Contributors

/** Flip to false to hide all game modes from the UI. */
export const GAME_MODES_ENABLED = true;

export const GAME_MODE_OPTIONS = [
  { value: 'bubbles' as const, label: 'Bubbles' },
  { value: 'tetris' as const, label: 'Tetris' },
  { value: 'pacman' as const, label: 'Pac-Man' },
] as const;

export { BubblesMode } from './BubblesMode';
export { TetrisMode } from './TetrisMode';
export { PacManMode } from './PacManMode';
export { ArcadeOverlay } from './ArcadeOverlay';
```

**Step 2: Commit**

```bash
git add apps/dashboard/src/components/graph/nodes/game-modes/index.ts
git commit -m "feat(arcade): barrel export all game mode components"
```

---

### Task 11: Wire game modes into ToolGroupNode

**Files:**

- Modify: `apps/dashboard/src/components/graph/nodes/ToolGroupNode.tsx`

**Step 1: Add imports**

At the top of the file (after line 11), add:

```typescript
import {
  GAME_MODES_ENABLED,
  BubblesMode,
  TetrisMode,
  PacManMode,
  ArcadeOverlay,
} from './game-modes';
```

**Step 2: Read arcade state from store**

In the `ToolGroupNodeComponent` function (after `const { target } = useHandlePositions();` on line 86), add:

```typescript
const arcadeMode = useAgentStore((s) => s.arcadeMode);
const arcadeSoundEnabled = useAgentStore((s) => s.arcadeSoundEnabled);
const arcadeVolume = useAgentStore((s) => s.arcadeVolume);
```

**Step 3: Add game mode branches in the expanded content**

Replace the mode content section (lines 180-190):

```tsx
{
  /* Mode content */
}
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
</div>;
```

with:

```tsx
{
  /* Mode content */
}
<ArcadeOverlay
  enabled={arcadeMode && GAME_MODES_ENABLED}
  soundEnabled={arcadeSoundEnabled}
  volume={arcadeVolume}
  tools={tools}
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
    {GAME_MODES_ENABLED && toolGroupMode === 'bubbles' && (
      <BubblesMode
        tools={tools}
        parentAgentId={parentAgentId}
        selectedNodeId={selectedNodeId}
        selectNode={selectNode}
      />
    )}
    {GAME_MODES_ENABLED && toolGroupMode === 'tetris' && (
      <TetrisMode tools={tools} selectedNodeId={selectedNodeId} selectNode={selectNode} />
    )}
    {GAME_MODES_ENABLED && toolGroupMode === 'pacman' && (
      <PacManMode tools={tools} selectedNodeId={selectedNodeId} selectNode={selectNode} />
    )}
  </div>
</ArcadeOverlay>;
```

**Step 4: Commit**

```bash
git add apps/dashboard/src/components/graph/nodes/ToolGroupNode.tsx
git commit -m "feat(arcade): wire game modes + arcade overlay into ToolGroupNode"
```

---

### Task 12: Update ViewSettingsDropdown

**Files:**

- Modify: `apps/dashboard/src/components/layout/ViewSettingsDropdown.tsx`

**Step 1: Import game mode options + add store selectors**

At the top, add import:

```typescript
import { GAME_MODES_ENABLED, GAME_MODE_OPTIONS } from '../graph/nodes/game-modes';
```

After the existing store selectors (line 28), add:

```typescript
const arcadeMode = useAgentStore((s) => s.arcadeMode);
const setArcadeMode = useAgentStore((s) => s.setArcadeMode);
const arcadeSoundEnabled = useAgentStore((s) => s.arcadeSoundEnabled);
const setArcadeSoundEnabled = useAgentStore((s) => s.setArcadeSoundEnabled);
```

**Step 2: Add Game Modes section after Tool View section**

After the closing `</div>` of the Tool View section (after line 99, before `<NotificationSettings>`), add:

```tsx
{
  /* Game modes section */
}
{
  GAME_MODES_ENABLED && (
    <div className="border-t border-gray-700/50 mt-1 pt-1">
      <div className="px-2 py-1 text-[10px] text-gray-500 uppercase tracking-wider">Game Modes</div>
      {GAME_MODE_OPTIONS.map(({ value, label }) => (
        <button
          key={value}
          onClick={() => {
            setToolGroupMode(value);
            setOpen(false);
          }}
          className="w-full flex items-center gap-2 px-3 py-1.5 text-xs hover:bg-gray-800/80 transition-colors text-left text-gray-300"
        >
          <span
            className={`w-2 h-2 rounded-full flex-shrink-0 ${toolGroupMode === value ? 'bg-blue-400' : 'bg-gray-600'}`}
          />
          <span className="flex-1">{label}</span>
        </button>
      ))}
    </div>
  );
}

{
  /* Arcade overlay section */
}
<div className="border-t border-gray-700/50 mt-1 pt-1">
  <div className="px-2 py-1 text-[10px] text-gray-500 uppercase tracking-wider">Arcade</div>
  <button
    onClick={() => {
      setArcadeMode(!arcadeMode);
    }}
    className="w-full flex items-center gap-2 px-3 py-1.5 text-xs hover:bg-gray-800/80 transition-colors text-left text-gray-300"
    role="switch"
    aria-checked={arcadeMode}
  >
    <span
      className={`w-2 h-2 rounded-full flex-shrink-0 ${arcadeMode ? 'bg-green-400' : 'bg-gray-600'}`}
    />
    <span className="flex-1">Arcade Mode</span>
    <kbd className="text-[10px] text-gray-600 bg-gray-800 px-1 rounded">G</kbd>
  </button>
  {arcadeMode && (
    <button
      onClick={() => {
        setArcadeSoundEnabled(!arcadeSoundEnabled);
      }}
      className="w-full flex items-center gap-2 px-3 py-1.5 text-xs hover:bg-gray-800/80 transition-colors text-left text-gray-300"
      role="switch"
      aria-checked={arcadeSoundEnabled}
    >
      <span
        className={`w-2 h-2 rounded-full flex-shrink-0 ${arcadeSoundEnabled ? 'bg-green-400' : 'bg-gray-600'}`}
      />
      <span className="flex-1">Sound Effects</span>
    </button>
  )}
</div>;
```

**Step 3: The `setToolGroupMode` type needs to accept new values**

This was already handled in Task 1 (store type widening). Verify that `setToolGroupMode` now accepts `'bubbles' | 'tetris' | 'pacman'` values.

**Step 4: Commit**

```bash
git add apps/dashboard/src/components/layout/ViewSettingsDropdown.tsx
git commit -m "feat(arcade): add game modes + arcade toggle to ViewSettingsDropdown"
```

---

### Task 13: Update useAutoLayout dimensions

**Files:**

- Modify: `apps/dashboard/src/hooks/useAutoLayout.ts`

**Step 1: Add game mode dimensions to NODE_DEFAULTS**

The `NODE_DEFAULTS` (line 10-17) currently has `toolGroup: { width: 280, height: 120 }`. This is the fallback. The actual dimension computation happens in `useVisibleGraph.ts` where measured dimensions are fed back. The game modes will self-size via their container dimensions, and React Flow will measure them.

No changes needed to `useAutoLayout.ts` because the toolGroup node dimensions come from React Flow measurement (the `measured` property), not from hardcoded values. The `NODE_DEFAULTS.toolGroup` is only a fallback before first measurement.

**Step 2: Verify layout tests still pass**

Run: `cd apps/dashboard && npx vitest run src/hooks/__tests__/useAutoLayout.test.ts`
Expected: All 11 tests pass.

**Step 3: Commit (skip if no changes)**

No file changes needed for this task.

---

### Task 14: Update MobileSettingsButton (if it exists)

**Files:**

- Modify: `apps/dashboard/src/components/mobile/MobileSettingsButton.tsx`

**Step 1: Check if mobile settings needs game mode options**

Read the file and add the same GAME_MODE_OPTIONS to the mobile tool view mode selector (around line 137 where existing modes are rendered).

Add import:

```typescript
import { GAME_MODES_ENABLED, GAME_MODE_OPTIONS } from '../graph/nodes/game-modes';
```

After the existing tool mode buttons, add:

```tsx
{
  GAME_MODES_ENABLED &&
    GAME_MODE_OPTIONS.map((m) => (
      <button
        key={m.value}
        className={`px-2 py-1 rounded text-xs ${
          useAgentStore.getState().toolGroupMode === m.value
            ? 'bg-blue-600 text-white'
            : 'bg-gray-700 text-gray-300'
        }`}
        onClick={() => useAgentStore.getState().setToolGroupMode(m.value)}
      >
        {m.label}
      </button>
    ));
}
```

**Step 2: Commit**

```bash
git add apps/dashboard/src/components/mobile/MobileSettingsButton.tsx
git commit -m "feat(arcade): add game modes to mobile settings"
```

---

### Task 15: Run full test suite

**Step 1: Run all tests**

Run: `pnpm test`
Expected: All tests pass (existing 356+ tests should be unaffected since all changes are additive).

**Step 2: Fix any failing tests**

If any tests reference the `toolGroupMode` type literally (e.g., in store tests), update them to include the new values.

**Step 3: Commit any test fixes**

```bash
git add -A
git commit -m "test: fix any type issues from widened toolGroupMode"
```

---

### Task 16: Manual smoke test

**Step 1: Start the dashboard**

Run both terminals:

- Terminal 1: `.\start-server.ps1`
- Terminal 2: `.\start-client.ps1`

**Step 2: Simulate a session**

Run: `npx tsx scripts/simulate_all_nodes.ts`

**Step 3: Verify each mode**

1. Open ViewSettingsDropdown → verify "Game Modes" section with Bubbles/Tetris/Pac-Man
2. Select "Bubbles" → verify gooey blobs appear, same-type blobs merge
3. Select "Tetris" → verify stacking blocks, color by tool type
4. Select "Pac-Man" → verify ghost sprites, Pac-Man animation
5. Toggle arcade mode (G key or settings) → verify CRT scanlines, pixel font, score counter
6. Toggle sound → verify 8-bit chirps on new tools
7. Toggle back to Pill Grid → verify existing modes still work
8. Press F to collapse → verify collapsed chip still works

**Step 4: Commit**

No code changes — this is a verification step.

---

### Task 17: Final commit + docs update

**Step 1: Update CLAUDE.md keyboard shortcuts table**

Add `G` key to the shortcuts table in the project `CLAUDE.md`:

```
| **G**     | Toggle arcade mode              |
```

**Step 2: Commit everything**

```bash
git add CLAUDE.md
git commit -m "docs: add G key shortcut for arcade mode"
```

---

## Summary of All Files

### New files (7):

| File                           | Purpose                              |
| ------------------------------ | ------------------------------------ |
| `game-modes/index.ts`          | Barrel export + killswitch           |
| `game-modes/GooeyFilter.tsx`   | SVG filter for blob merging          |
| `game-modes/BubblesMode.tsx`   | Gooey merge visualization            |
| `game-modes/TetrisMode.tsx`    | Stacking blocks visualization        |
| `game-modes/PacManMode.tsx`    | Ghost-eating trail visualization     |
| `game-modes/arcade-utils.ts`   | Particles, sound, score, font loader |
| `game-modes/ArcadeOverlay.tsx` | CRT, scanlines, score counter, shake |

### Modified files (4):

| File                       | Change                                                                              |
| -------------------------- | ----------------------------------------------------------------------------------- |
| `agentStore.ts`            | Widen `toolGroupMode` type + add `arcadeMode`, `arcadeSoundEnabled`, `arcadeVolume` |
| `App.tsx`                  | Add `G` key handler                                                                 |
| `ToolGroupNode.tsx`        | Import + render game modes + wrap in ArcadeOverlay                                  |
| `ViewSettingsDropdown.tsx` | Add Game Modes section + Arcade toggle                                              |

### Optionally modified (2):

| File                       | Change                       |
| -------------------------- | ---------------------------- |
| `MobileSettingsButton.tsx` | Add game mode options        |
| `CLAUDE.md`                | Add G key to shortcuts table |

### To fully remove:

1. Delete `game-modes/` folder
2. Revert 3 case branches in `ToolGroupNode.tsx`
3. Remove `arcadeMode` / `arcadeSoundEnabled` / `arcadeVolume` from store
4. Remove G key handler from `App.tsx`
5. Remove Game Modes + Arcade sections from `ViewSettingsDropdown.tsx`
