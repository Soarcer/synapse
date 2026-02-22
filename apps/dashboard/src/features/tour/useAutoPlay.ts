// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Synapse Contributors

import { useEffect, useRef } from 'react';
import { useTourStore } from './tourStore';
import { DEMO_EVENTS } from './demoEvents';
import { useAgentStore, reloadAllEvents } from '../../store/agentStore';
import { wsClient } from '../../store/wsClient';

/**
 * Drives the auto-play phase: isolates the graph, feeds demo events into
 * agentStore on a timer, and restores the original session data when done.
 *
 * Graph isolation strategy:
 * 1. Disconnect WS to stop real events from contaminating the demo
 * 2. Clear frontend graph state, unlock viewport, unpause
 * 3. Inject demo events into the now-empty graph (only visible nodes)
 * 4. On tour end: reconnect WS + reload all events from backend DB
 */
export function useAutoPlay() {
  const phase = useTourStore((s) => s.phase);
  const advanceAutoPlay = useTourStore((s) => s.advanceAutoPlay);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cleanupNeeded = useRef(false);
  const savedLockViewport = useRef(false);

  // Auto-play event injection loop
  useEffect(() => {
    if (phase !== 'autoPlay') return;

    let cancelled = false;
    let idx = 0;
    cleanupNeeded.current = true;

    // Synchronous setup — no dynamic imports, no race conditions
    wsClient.disconnect();
    const store = useAgentStore.getState();
    savedLockViewport.current = store.lockViewport;
    store.clearEvents();
    store.setLockViewport(false);
    store.setPaused(false);

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
      // Restore lockViewport setting
      useAgentStore.getState().setLockViewport(savedLockViewport.current);
      // Reconnect WS and reload all events from backend DB
      wsClient.connect();
      reloadAllEvents({ showLoading: true });
    }
  }, [phase]);
}
