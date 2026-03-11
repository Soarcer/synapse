// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Bernhard

import { useState, useEffect, useCallback } from 'react';
import { useTourStore } from './tourStore';
import { prepareTourDemo } from './useAutoPlay';
import { TOUR_ENABLED } from './constants';
import { t } from '../../i18n';

/**
 * Renders:
 * 1. A first-run welcome card (if tour never completed)
 * 2. A persistent small "?" button to restart the tour anytime
 */
export function TourLauncher() {
  const active = useTourStore((s) => s.active);
  const startTour = useTourStore((s) => s.startTour);
  const hasCompleted = useTourStore((s) => s.hasCompleted);
  const [showWelcome, setShowWelcome] = useState(false);

  // Prepare graph + start tour in one synchronous click handler.
  // prepareTourDemo() clears the graph and disconnects WS BEFORE
  // startTour() triggers the React re-render cycle.
  const handleStart = useCallback(() => {
    prepareTourDemo();
    startTour();
  }, [startTour]);

  // Show welcome card on first load if tour hasn't been completed
  useEffect(() => {
    if (!TOUR_ENABLED) return;
    if (!hasCompleted() && !active) {
      const timer = setTimeout(() => setShowWelcome(true), 2000);
      return () => clearTimeout(timer);
    }
  }, [hasCompleted, active]);

  if (!TOUR_ENABLED) return null;
  if (active) return null; // Tour is running, overlay handles everything

  return (
    <>
      {/* First-run welcome card */}
      {showWelcome && (
        <div className="fixed bottom-6 right-6 z-[9990] w-72 bg-gradient-to-br from-[#1a1a2e] to-[#16162a] border border-violet-500/30 rounded-xl p-5 shadow-2xl animate-[fadeIn_0.3s_ease]">
          <div className="text-sm font-semibold text-gray-100 mb-1">{t('tour.launcher.title')}</div>
          <div className="text-xs text-gray-400 mb-4">{t('tour.launcher.body')}</div>
          <div className="flex gap-2">
            <button
              onClick={() => {
                setShowWelcome(false);
                handleStart();
              }}
              className="flex-1 px-3 py-1.5 rounded-md bg-violet-600 text-white text-xs font-semibold hover:bg-violet-500 transition-colors"
            >
              {t('tour.launcher.start')}
            </button>
            <button
              onClick={() => {
                setShowWelcome(false);
                localStorage.setItem('synapse-tour-completed', '1');
              }}
              className="px-3 py-1.5 rounded-md border border-gray-700 text-gray-400 text-xs hover:text-gray-200 transition-colors"
            >
              {t('tour.launcher.dismiss')}
            </button>
          </div>
        </div>
      )}

      {/* Persistent restart button */}
      <button
        onClick={handleStart}
        title="Start guided tour"
        className="fixed bottom-4 right-4 z-[9980] w-8 h-8 rounded-full bg-violet-600/20 border border-violet-500/30 text-violet-400 text-xs font-bold hover:bg-violet-600/40 transition-colors flex items-center justify-center"
      >
        ?
      </button>
    </>
  );
}
