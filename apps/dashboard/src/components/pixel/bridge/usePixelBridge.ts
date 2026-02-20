import { useEffect, useRef } from 'react';
import { useAgentStore } from '../../../store/agentStore';
import type { SceneManager } from '../engine/SceneManager';
import { mapEventToCommands } from './eventMapper';

export { mapEventToCommands } from './eventMapper';

/** React hook: subscribes to store events, translates to scene commands, dispatches to SceneManager. */
export function usePixelBridge(sceneRef: React.RefObject<SceneManager | null>): void {
  const processedRef = useRef(new Set<string>());

  useEffect(() => {
    const unsub = useAgentStore.subscribe((state, prev) => {
      const scene = sceneRef.current;
      if (!scene) return;
      const events = state.events;
      const prevEvents = prev.events;
      if (events === prevEvents) return;

      // Find new events (events array is newest-first)
      for (const event of events) {
        if (processedRef.current.has(event.id)) break;
        processedRef.current.add(event.id);
        const cmds = mapEventToCommands(event);
        for (const cmd of cmds) scene.handleCommand(cmd);
      }

      // Prevent memory growth
      if (processedRef.current.size > 2000) {
        const ids = events.map(e => e.id);
        processedRef.current = new Set(ids);
      }
    });
    return unsub;
  }, [sceneRef]);
}
