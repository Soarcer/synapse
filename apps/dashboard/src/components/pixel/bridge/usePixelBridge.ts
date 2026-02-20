import { useEffect, useRef } from 'react';
import { useAgentStore } from '../../../store/agentStore';
import type { SceneManager } from '../engine/SceneManager';
import type { SceneCommand } from '../engine/types';
import { mapEventToCommands } from './eventMapper';

export { mapEventToCommands } from './eventMapper';

/** Minimum ms between dispatching queued commands — gives the scene time to animate. */
const DRIP_INTERVAL_MS = 600;

/** React hook: subscribes to store events, translates to scene commands, dispatches to SceneManager. */
export function usePixelBridge(sceneRef: React.RefObject<SceneManager | null>): void {
  const processedRef = useRef(new Set<string>());
  const queueRef = useRef<SceneCommand[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    // Drip-feed queued commands at a steady pace
    function startDrip() {
      if (timerRef.current) return;
      timerRef.current = setInterval(() => {
        const scene = sceneRef.current;
        if (!scene || queueRef.current.length === 0) {
          if (timerRef.current) clearInterval(timerRef.current);
          timerRef.current = null;
          return;
        }
        const cmd = queueRef.current.shift()!;
        scene.handleCommand(cmd);
      }, DRIP_INTERVAL_MS);
    }

    const unsub = useAgentStore.subscribe((state, prev) => {
      const scene = sceneRef.current;
      if (!scene) return;
      const events = state.events;
      const prevEvents = prev.events;
      if (events === prevEvents) return;

      // Collect new commands (events array is newest-first, so collect in reverse)
      const newCmds: SceneCommand[] = [];
      for (const event of events) {
        if (processedRef.current.has(event.id)) break;
        processedRef.current.add(event.id);
        const cmds = mapEventToCommands(event);
        newCmds.push(...cmds);
      }

      if (newCmds.length === 0) return;

      // If only 1-2 commands, dispatch immediately (real-time single events)
      if (newCmds.length <= 2) {
        for (const cmd of newCmds) scene.handleCommand(cmd);
      } else {
        // Batch arrival — queue and drip-feed so animations have time to play
        queueRef.current.push(...newCmds.reverse());
        startDrip();
      }

      // Prevent memory growth
      if (processedRef.current.size > 2000) {
        const ids = events.map(e => e.id);
        processedRef.current = new Set(ids);
      }
    });

    return () => {
      unsub();
      if (timerRef.current) clearInterval(timerRef.current);
      timerRef.current = null;
    };
  }, [sceneRef]);
}
