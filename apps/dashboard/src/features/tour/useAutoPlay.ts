// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Synapse Contributors

import { useEffect, useRef } from 'react';
import { useTourStore } from './tourStore';
import { DEMO_EVENTS } from './demoEvents';

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

    async function setup() {
      // Disconnect WS first to prevent real events during demo
      const { wsClient } = await import('../../store/wsClient');
      wsClient.disconnect();

      const { useAgentStore } = await import('../../store/agentStore');
      const store = useAgentStore.getState();

      // Save current viewport lock state, then clear graph and unlock
      savedLockViewport.current = store.lockViewport;
      store.clearEvents();
      store.setLockViewport(false);
      store.setPaused(false);
    }

    async function playNext() {
      if (cancelled || idx >= DEMO_EVENTS.length) {
        if (!cancelled && idx >= DEMO_EVENTS.length) {
          useTourStore.getState().transitionToManual();
        }
        return;
      }

      const event = DEMO_EVENTS[idx];
      await new Promise<void>((r) => {
        timerRef.current = setTimeout(r, event.delayMs);
      });
      if (cancelled) return;

      const { useAgentStore } = await import('../../store/agentStore');
      useAgentStore.getState().addEvent(event.payload as any);

      if (event.narrationKey) {
        advanceAutoPlay();
      }

      idx++;
      playNext();
    }

    setup().then(() => {
      if (!cancelled) playNext();
    });

    return () => {
      cancelled = true;
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [phase, advanceAutoPlay]);

  // Cleanup: restore original graph data when tour ends
  useEffect(() => {
    if (phase === 'idle' && cleanupNeeded.current) {
      cleanupNeeded.current = false;
      Promise.all([
        import('../../store/agentStore'),
        import('../../store/wsClient'),
      ]).then(([{ useAgentStore, reloadAllEvents }, { wsClient }]) => {
        // Restore lockViewport setting
        useAgentStore.getState().setLockViewport(savedLockViewport.current);
        // Reconnect WS and reload all events from backend DB
        wsClient.connect();
        reloadAllEvents({ showLoading: true });
      });
    }
  }, [phase]);
}
