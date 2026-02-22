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
