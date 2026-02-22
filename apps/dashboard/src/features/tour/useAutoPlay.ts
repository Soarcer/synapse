// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Synapse Contributors

import { useEffect, useRef } from 'react';
import { useTourStore } from './tourStore';
import { DEMO_EVENTS } from './demoEvents';

/**
 * Drives the auto-play phase: feeds demo events into agentStore
 * on a timer, advancing the narration callout at milestone events.
 * Cleans up demo session data when the tour ends.
 */
export function useAutoPlay() {
  const phase = useTourStore((s) => s.phase);
  const advanceAutoPlay = useTourStore((s) => s.advanceAutoPlay);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cleanupNeeded = useRef(false);

  useEffect(() => {
    if (phase !== 'autoPlay') return;

    let cancelled = false;
    let idx = 0;
    cleanupNeeded.current = true;

    async function playNext() {
      if (cancelled || idx >= DEMO_EVENTS.length) {
        // Auto-play complete — transition to manual if not cancelled
        if (!cancelled && idx >= DEMO_EVENTS.length) {
          useTourStore.getState().transitionToManual();
        }
        return;
      }

      const event = DEMO_EVENTS[idx];
      // Wait the specified delay
      await new Promise<void>((r) => {
        timerRef.current = setTimeout(r, event.delayMs);
      });
      if (cancelled) return;

      // Inject event into the real store (dynamic import to avoid circular deps)
      const { useAgentStore } = await import('../../store/agentStore');
      useAgentStore.getState().addEvent(event.payload as any);

      // Advance narration if this event has one
      if (event.narrationKey) {
        advanceAutoPlay();
      }

      idx++;
      playNext();
    }

    playNext();

    return () => {
      cancelled = true;
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [phase, advanceAutoPlay]);

  // Cleanup: remove demo session data when tour ends/becomes idle
  useEffect(() => {
    if (phase === 'idle' && cleanupNeeded.current) {
      cleanupNeeded.current = false;
      // Remove the demo session from the store
      import('../../store/agentStore').then(({ useAgentStore }) => {
        useAgentStore.getState().removeSession?.('tour-demo-session');
      });
    }
  }, [phase]);
}
