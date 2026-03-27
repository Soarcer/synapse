// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Bernhard

import type { GameModeDefinition, GameScorer } from './types';
import { getToolPoints } from './arcade-utils';
import { GameOfLifeMode } from './GameOfLifeMode';
import { TetrisMode } from './TetrisMode';
import { SnakeMode } from './SnakeMode';
import { BreakoutMode } from './BreakoutMode';

// ── Scoring functions ─────────────────────────────────────────

/** Game of Life: 50 pts per seeded cell, 200 bonus per frozen (completed) cell. */
const scoreGameOfLife: GameScorer = (tools) => {
  let score = 0;
  let combo = 0;
  for (const t of tools) {
    score += 50; // seeded
    if (t.status === 'success') {
      combo++;
      score += 200;
    } else if (t.status === 'error') {
      combo = 0;
      score += 25;
    }
  }
  return { score, combo, comboLabel: 'ALIVE!' };
};

/** Tetris: 100 pts per placed block, +300 bonus per consecutive success (line clear). */
const scoreTetris: GameScorer = (tools) => {
  let score = 0;
  let combo = 0;
  for (const t of tools) {
    if (t.status === 'success') {
      combo++;
      score += 100 + (combo >= 3 ? 300 : 0); // line clear bonus at 3+ streak
    } else if (t.status === 'error') {
      combo = 0;
    }
    if (t.status !== 'running') score += 50; // placement points
  }
  return { score, combo, comboLabel: combo >= 3 ? 'LINE!' : 'COMBO!' };
};

/** Snake: weighted points per tool eaten. Rarer tools = more points. Length = combo. */
const scoreSnake: GameScorer = (tools) => {
  let score = 0;
  let length = 0;
  for (const t of tools) {
    if (t.status !== 'running') {
      score += getToolPoints(t.toolName);
      length++;
    }
  }
  return { score, combo: length, comboLabel: 'LENGTH!' };
};

/** Breakout: weighted points per brick. Rarer tools = more points. Combo on consecutive success. */
const scoreBreakout: GameScorer = (tools) => {
  let score = 0;
  let combo = 0;
  for (const t of tools) {
    if (t.status === 'success') {
      combo++;
      score += getToolPoints(t.toolName) * combo;
    } else if (t.status === 'error') {
      combo = 0;
    }
  }
  return { score, combo, comboLabel: 'SMASH!' };
};
// ── Public API ───────────────────────────────────────────────

export type { GameModeProps, GameModeDefinition, GameScore, GameScorer } from './types';

/** Flip to false to hide all game modes from the UI. */
export const GAME_MODES_ENABLED = true;

/**
 * Game mode registry — the single source of truth.
 *
 * To add a new game mode:
 * 1. Create `YourMode.tsx` implementing `GameModeProps`
 * 2. Import it above
 * 3. Add an entry here (with optional `scorer`)
 * That's it — menus, rendering, and store all pick it up automatically.
 */
export const GAME_MODE_REGISTRY: GameModeDefinition[] = [
  {
    id: 'bubbles',
    label: 'Game of Life',
    component: GameOfLifeMode,
    scorer: scoreGameOfLife,
    hideScore: true,
  },
  { id: 'tetris', label: 'Tetris', component: TetrisMode, scorer: scoreTetris },
  { id: 'snake', label: 'Snake', component: SnakeMode, scorer: scoreSnake },
  { id: 'breakout', label: 'Breakout', component: BreakoutMode, scorer: scoreBreakout },
];

/** Derived options for settings menus (value + label). */
export const GAME_MODE_OPTIONS = GAME_MODE_REGISTRY.map((m) => ({
  value: m.id,
  label: m.label,
}));

export { ArcadeOverlay } from './ArcadeOverlay';
