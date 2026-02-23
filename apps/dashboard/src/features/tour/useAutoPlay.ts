// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Synapse Contributors

import { useEffect, useRef } from 'react';
import { useTourStore } from './tourStore';
import { DEMO_EVENTS } from './demoEvents';
import { useAgentStore, reloadAllEvents } from '../../store/agentStore';
import { wsClient } from '../../store/wsClient';

/** Saved viewport lock state — restored when tour ends. */
let savedLockViewport = false;

/** Narration entries extracted once — only events with a narrationKey */
const NARRATIONS = DEMO_EVENTS.filter((e) => e.narrationKey !== null).map((e) => e.narrationKey!);

/** Delay between narration captions (ms) */
const NARRATION_INTERVAL = 800;

/**
 * Prepare the graph for the tour demo. Must be called synchronously
 * in the click handler BEFORE startTour() — this ensures the graph is
 * fully built before React renders the tour overlay.
 */
export function prepareTourDemo(): void {
  // Disconnect WS to prevent real events during demo
  wsClient.disconnect();

  const store = useAgentStore.getState();
  savedLockViewport = store.lockViewport;
  store.clearEvents();
  store.setLockViewport(false);
  store.setPaused(false);

  // Pre-inject ALL demo events so every node exists immediately
  for (const event of DEMO_EVENTS) {
    store.addEvent(event.payload);
  }
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
 * Drives the auto-play phase: cycles through narration captions on a
 * fast timer. All graph nodes are pre-injected by prepareTourDemo().
 *
 * IMPORTANT: Graph isolation (clearEvents, WS disconnect, event injection)
 * is handled by prepareTourDemo() which runs in the click handler before
 * startTour(). This hook only handles narration cycling and cleanup.
 */
export function useAutoPlay() {
  const phase = useTourStore((s) => s.phase);
  const advanceAutoPlay = useTourStore((s) => s.advanceAutoPlay);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cleanupNeeded = useRef(false);

  // Auto-play narration loop
  useEffect(() => {
    if (phase !== 'autoPlay') return;

    let cancelled = false;
    let idx = 0;
    cleanupNeeded.current = true;

    function showNext() {
      if (cancelled || idx >= NARRATIONS.length) {
        if (!cancelled) {
          useTourStore.getState().transitionToManual();
        }
        return;
      }

      timerRef.current = setTimeout(() => {
        if (cancelled) return;
        advanceAutoPlay();
        idx++;
        showNext();
      }, NARRATION_INTERVAL);
    }

    showNext();

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
