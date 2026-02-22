// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Synapse Contributors

import type { ComponentType } from 'react';
import type { ToolCallSummary } from '@synapse-ai/core';

/**
 * Standard props every game mode component receives.
 * Implement this interface to create a new game mode.
 */
export interface GameModeProps {
  tools: ToolCallSummary[];
  selectedNodeId: string | null;
  selectNode: (id: string | null, source?: 'graph' | 'lens') => void;
}

/**
 * Registry entry for a game mode.
 *
 * To add a new game mode:
 * 1. Create `YourMode.tsx` exporting a component matching `GameModeProps`
 * 2. Add an entry to `GAME_MODE_REGISTRY` in `index.ts`
 * That's it — menus, rendering, and store all pick it up automatically.
 */
export interface GameModeDefinition {
  /** Store value — must be unique, kebab-case. Persisted in localStorage. */
  id: string;
  /** Display name shown in settings menus. */
  label: string;
  /** React component to render. */
  component: ComponentType<GameModeProps>;
}
