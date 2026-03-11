// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Bernhard

export { useTourStore } from './tourStore';
export { TourOverlay } from './TourOverlay';
export { TourLauncher } from './TourLauncher';
export { useAutoPlay, prepareTourDemo } from './useAutoPlay';
export { TOUR_ENABLED } from './constants';

let initialized = false;

/**
 * Initialize the tour system. Call once at module level in App.tsx.
 * Safe to call multiple times (guarded).
 */
export function initTour(): void {
  if (initialized) return;
  initialized = true;
  // Any one-time setup goes here.
  // Currently a no-op — the TourLauncher handles first-run detection via useEffect.
}
