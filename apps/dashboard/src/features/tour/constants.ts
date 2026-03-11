// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Bernhard

export const TOUR_ENABLED = true;
export const LS_KEY_COMPLETED = 'synapse-tour-completed';
export const LS_KEY_PROGRESS = 'synapse-tour-progress';

export type TourPhase = 'idle' | 'autoPlay' | 'manual' | 'finished';

export interface TourStep {
  /** CSS selector or element ID to spotlight (without #) */
  target: string;
  /** i18n key for step title */
  titleKey: string;
  /** i18n key for step body */
  bodyKey: string;
  /** Preferred tooltip placement relative to target */
  placement: 'top' | 'right' | 'bottom' | 'left';
  /** Optional: action to perform when this step activates (e.g., switch lens tab) */
  onEnter?: () => void;
  /** Optional: wait for this condition before allowing Next (returns unsub) */
  waitFor?: () => (() => void) | undefined;
}

export interface TourChapter {
  id: string;
  titleKey: string;
  steps: TourStep[];
}

/** Chapter IDs for optional continuation prompt */
export const OPTIONAL_CHAPTERS = ['analytics'];
