// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Synapse Contributors

import { useEffect, useRef } from 'react';
import { useTourStore } from './tourStore';
import { DEMO_EVENTS } from './demoEvents';
import { useAgentStore, reloadAllEvents } from '../../store/agentStore';
import { wsClient } from '../../store/wsClient';

/** Saved viewport lock state — restored when tour ends. */
let savedLockViewport = false;

/**
 * Prepare the graph for the tour demo. Must be called synchronously
 * in the click handler BEFORE startTour() — this ensures the graph is
 * clean before React renders the tour overlay.
 */
export function prepareTourDemo(): void {
  // Disconnect WS to prevent real events during demo
  wsClient.disconnect();

  const store = useAgentStore.getState();
  savedLockViewport = store.lockViewport;
  store.clearEvents();
  store.setLockViewport(false);
  store.setPaused(false);
}

/**
 * Restore the graph after the tour ends. Called from the cleanup effect.
 */
function restoreGraph(): void {
  useAgentStore.getState().setLockViewport(savedLockViewport);
  wsClient.connect();
  reloadAllEvents({ showLoading: true });
}

/**
 * Drives the auto-play phase: feeds demo events into agentStore on a
 * timer, advancing the narration callout at milestone events.
 *
 * IMPORTANT: Graph isolation (clearEvents, WS disconnect) is handled by
 * prepareTourDemo() which runs in the click handler before startTour().
 * This hook only handles event injection and cleanup.
 */
export function useAutoPlay() {
  const phase = useTourStore((s) => s.phase);
  const advanceAutoPlay = useTourStore((s) => s.advanceAutoPlay);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cleanupNeeded = useRef(false);

  // Auto-play event injection loop
  useEffect(() => {
    if (phase !== 'autoPlay') return;

    let cancelled = false;
    let idx = 0;
    cleanupNeeded.current = true;

    function playNext() {
      if (cancelled || idx >= DEMO_EVENTS.length) {
        if (!cancelled && idx >= DEMO_EVENTS.length) {
          useTourStore.getState().transitionToManual();
        }
        return;
      }

      const event = DEMO_EVENTS[idx];
      timerRef.current = setTimeout(() => {
        if (cancelled) return;

        useAgentStore.getState().addEvent(event.payload as any);

        if (event.narrationKey) {
          advanceAutoPlay();
        }

        idx++;
        playNext();
      }, event.delayMs);
    }

    playNext();

    return () => {
      cancelled = true;
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [phase, advanceAutoPlay]);

  // Cleanup: restore original graph data when tour ends
  useEffect(() => {
    if (phase === 'idle' && cleanupNeeded.current) {
      cleanupNeeded.current = false;
      restoreGraph();
    }
  }, [phase]);
}
