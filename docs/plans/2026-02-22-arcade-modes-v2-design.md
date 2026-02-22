# Arcade Game Modes v2 — Redesign

**Date:** 2026-02-22
**Status:** Approved
**Scope:** Rewrite all 3 game mode components; fix Pac-Man clip-path; replace Bubbles with Game of Life

## Changes from v1

| Mode | v1 Problem | v2 Fix |
|------|-----------|--------|
| Pac-Man | Clip-path reversed (mouth invisible); Pac-Man never moves; ghosts appear but no gameplay arc | Pac-Man waits at start, ghosts accumulate, dramatic sweep on all-complete |
| Tetris | Greedy column-fill = no line clears until column 6+; no animation; unrealistic | Human-player placement with 70/30 best/random fit; varied piece shapes; real line clears |
| Bubbles | Gooey filter not rendering properly | Replace entirely with Conway's Game of Life (seed + freeze model) |

## Files Changed

Only the 3 mode components + barrel export are rewritten. No changes to:
- `agentStore.ts` (already has correct types)
- `App.tsx` (G key already works)
- `ToolGroupNode.tsx` (already wired)
- `ViewSettingsDropdown.tsx` (already has menu entries)
- `ArcadeOverlay.tsx` (overlay works independently)
- `arcade-utils.ts` (shared utils still valid)

### Files to rewrite:
- `game-modes/PacManMode.tsx` — full rewrite
- `game-modes/TetrisMode.tsx` — full rewrite
- `game-modes/BubblesMode.tsx` — delete, replace with `GameOfLifeMode.tsx`
- `game-modes/GooeyFilter.tsx` — delete (no longer needed)
- `game-modes/index.ts` — update exports (GameOfLifeMode replaces BubblesMode, remove GooeyFilter)

---

## Mode 1: Pac-Man — "Victory Lap"

### During Execution (tools still running)

- Pac-Man sits at left edge with idle chomp animation
- Ghosts appear left→right as `tool_start` events arrive, spaced evenly
- Ghost color = tool type (TOOL_COLORS map)
- Running tools = blue vulnerable ghosts (wobble animation)
- Completed tools = normal colored ghosts (waiting to be eaten)
- Error tools = red ghosts (solid, no wobble)
- Small dots fill the path between ghost positions
- Progress text: "14 / 20 complete" (optional, top-left)

### Pac-Man Clip-Path Fix

The v1 clip-path had the mouth opening on the wrong side. Correct animation:

```css
@keyframes pacman-chomp {
  0% { clip-path: polygon(100% 50%, 80% 100%, 0% 100%, 0% 0%, 80% 0%); }
  100% { clip-path: polygon(100% 50%, 50% 75%, 0% 100%, 0% 0%, 50% 25%); }
}
```

Mouth opens toward the right (direction of travel). At 0% the mouth is nearly closed (thin wedge). At 100% the mouth is wide open (45-degree wedge).

### All-Complete Sweep

Triggered when every tool in the group has status `success` or `error` (none `running`).

1. Pac-Man begins moving left→right at speed: `containerWidth / (tools.length * 80)` ms per ghost
2. As Pac-Man reaches each ghost:
   - Success ghost: transforms to floating eyes (fade up + drift), dot below disappears
   - Error ghost: Pac-Man bounces back briefly (100ms), then continues past. Ghost stays red.
3. After last ghost: "CLEAR!" text flashes for 800ms + particle burst (if arcade overlay enabled)
4. Pac-Man returns to left edge

### Interaction

- Click any ghost → `selectNode('tool-' + toolUseId)`
- Tooltip on hover: tool name + duration + status
- Selected ghost: purple ring
- Sweep animation can be retriggered by clicking a "replay" icon (small circular arrow)

### Container

Width: `max(tools.length * 28 + 48, 200)` px
Height: `numRows * 40 + 16` px (wraps at 10 ghosts per row)

---

## Mode 2: Tetris — "Human Player"

### Grid

10 columns x 16 rows, each cell 16x16px. Total: 160x256px.

### Piece Shapes by Tool Type

| Tool Type | Shape | Cells | Description |
|-----------|-------|-------|-------------|
| Read, Grep | I-piece | 1×h | Vertical bar, h=1-4 based on duration |
| Bash, Edit | O-piece | 2×max(1,h/2) | Square-ish block |
| Task | T-piece | 3×1 + 1×1 center | T-shape (3 wide, 1 tall + 1 cell below center) |
| Write, Glob | L-piece | 1×h + 1×1 | Vertical bar with 1-cell foot |
| Others | S/Z-piece | 2×2 offset | Standard S or Z tetromino |

Height `h = clamp(1, ceil(duration_ms / 1000), 4)`.

For simplicity in v2, keep 2-cell-wide blocks but vary height. Fancy shapes can come in v3.

### Placement Algorithm

```
for each new tool:
  1. Pick random start column (0 to COLS - BLOCK_W)
  2. With 70% probability: scan ±3 columns for best fit (minimize gaps below)
     With 30% probability: keep random column
  3. Find lowest available row at chosen column (bottom-up stack)
  4. Animate: appear at top → slide to chosen column (150ms) → drop to row (300ms spring bounce)
```

"Best fit" = column where the block rests with fewest empty cells directly below it.

### Line Clearing

After each block placement:
1. Scan all rows bottom-up
2. If a row is fully occupied: mark for clearing
3. Clear animation: flash white (200ms) → blocks in row slide out left (200ms) → rows above collapse down (200ms)
4. **Actually remove** cleared blocks: update the grid state, recompute positions for blocks above

### Visual

- Grid background: subtle 1px lines at 3% white opacity
- Blocks: rounded-sm corners, tool-type color, white/10 border
- Running blocks: half opacity, no drop animation yet (appear at landing position)
- Error blocks: diagonal stripe overlay
- Cleared row flash: white glow that fades

### Interaction

- Click block → `selectNode('tool-' + toolUseId)`
- Tooltip: tool name + duration + status
- Selected: purple ring

---

## Mode 3: Game of Life — "Living Board" (replaces Bubbles)

### Grid

32 columns x 20 rows, each cell 8x8px. Total: 256x160px container.

### Cell State

```typescript
interface Cell {
  alive: boolean;
  frozen: boolean;      // completed tool — exempt from rules
  color: string;        // tool type color
  toolUseId: string;    // which tool this cell belongs to
  age: number;          // generations alive (for fade effects)
}
```

### Seeding (tool_start)

Each new `tool_start` event plants a cluster of live cells:

1. Find a random open area on the grid (scan for 5x5 region with <3 live cells)
2. Plant a predefined pattern centered at that position:
   - **Read**: Glider (5 cells, moves diagonally)
   - **Edit**: Block (4 cells, stable still-life)
   - **Bash**: Blinker (3 cells, oscillates)
   - **Grep**: Lightweight spaceship (9 cells, moves horizontally)
   - **Write**: Beacon (8 cells, oscillates)
   - **Task**: R-pentomino (5 cells, chaotic growth)
   - **Others**: Random 5-cell cluster

All cells in the cluster get the tool's color and toolUseId.

### Simulation Rules

- Standard Conway B3/S23 rules
- Run at ~5 generations per second (200ms interval)
- **Frozen cells** (completed tools) are exempt: they don't die, and they count as live neighbors for adjacent cells
- New cells born from frozen+active neighbors inherit the color of the majority neighbor

### Lifecycle

| Event | Effect |
|-------|--------|
| `tool_start` | Seed cluster at random open area |
| `tool_end` (success) | All surviving cells with that toolUseId freeze (brighter, glow border) |
| `tool_end` (error) | All cells with that toolUseId turn red, die over 3 generations (shrink + fade) |

### Visual

- Live cells: tool-type colored squares with slight pulse between generations (opacity 0.7→0.9)
- Frozen cells: same color but brighter (opacity 1.0), 1px glow border in cell color
- Dying cells (error): red, shrinking over 3 frames
- Grid lines: barely visible (2% white, `rgba(255,255,255,0.02)`)
- Background: transparent (inherits node bg)

### Performance

- 32x20 = 640 cells, computed every 200ms
- Pure array computation, no DOM per cell — render via single canvas or CSS grid
- Canvas approach: single `<canvas>` element, fillRect per live cell
- Frozen cell count grows monotonically → simulation gets simpler over time

### Interaction

- Click on a cell cluster → find the toolUseId at that position → `selectNode('tool-' + toolUseId)`
- Hover: highlight all cells belonging to same tool (brighter)
- Tooltip: tool name + status

---

## Barrel Export Update

```typescript
// game-modes/index.ts
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

Note: keep the store value as `'bubbles'` to avoid needing store migration. Just change the display label to "Game of Life".

## ToolGroupNode.tsx Update

Replace `BubblesMode` import/usage with `GameOfLifeMode`. The `parentAgentId` prop is no longer needed (was only for gooey filter IDs).

```tsx
{GAME_MODES_ENABLED && toolGroupMode === 'bubbles' && (
  <GameOfLifeMode tools={tools} selectedNodeId={selectedNodeId} selectNode={selectNode} />
)}
```
