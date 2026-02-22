// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Synapse Contributors

import type { GameModeDefinition } from './types';
import { GameOfLifeMode } from './GameOfLifeMode';
import { TetrisMode } from './TetrisMode';
import { SnakeMode } from './SnakeMode';
import { InvadersMode } from './InvadersMode';
import { BreakoutMode } from './BreakoutMode';
import { MinesweeperMode } from './MinesweeperMode';
import { TowerDefenseMode } from './TowerDefenseMode';

// ── Public API ───────────────────────────────────────────────

export type { GameModeProps, GameModeDefinition } from './types';

/** Flip to false to hide all game modes from the UI. */
export const GAME_MODES_ENABLED = true;

/**
 * Game mode registry — the single source of truth.
 *
 * To add a new game mode:
 * 1. Create `YourMode.tsx` implementing `GameModeProps`
 * 2. Import it above
 * 3. Add an entry here
 * That's it — menus, rendering, and store all pick it up automatically.
 */
export const GAME_MODE_REGISTRY: GameModeDefinition[] = [
  { id: 'bubbles', label: 'Game of Life', component: GameOfLifeMode },
  { id: 'tetris', label: 'Tetris', component: TetrisMode },
  { id: 'snake', label: 'Snake', component: SnakeMode },
  { id: 'invaders', label: 'Space Invaders', component: InvadersMode },
  { id: 'breakout', label: 'Breakout', component: BreakoutMode },
  { id: 'minesweeper', label: 'Minesweeper', component: MinesweeperMode },
  { id: 'tower-defense', label: 'Tower Defense', component: TowerDefenseMode },
];

/** Derived options for settings menus (value + label). */
export const GAME_MODE_OPTIONS = GAME_MODE_REGISTRY.map((m) => ({
  value: m.id,
  label: m.label,
}));

export { ArcadeOverlay } from './ArcadeOverlay';
