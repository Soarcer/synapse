import { useRef, useEffect, useState, useCallback } from 'react';
import { SceneManager, type ClickTarget } from './engine/SceneManager';
import { RETRO_OFFICE } from './themes/retro-office';
import { usePixelBridge } from './bridge/usePixelBridge';
import { PixelHUD, type PixelMode } from './hud/PixelHUD';
import { DemoSequencer } from './modes/DemoSequencer';
import { ReplayController } from './modes/ReplayController';
import { ReplayBar } from './hud/ReplayBar';
import { useAgentStore } from '../../store/agentStore';

interface TooltipInfo {
  x: number;
  y: number;
  label: string;
  details: string[];
}

export function PixelScene() {
  const containerRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<SceneManager | null>(null);
  const demoRef = useRef<DemoSequencer | null>(null);
  const replayRef = useRef<ReplayController | null>(null);
  const [tooltip, setTooltip] = useState<TooltipInfo | null>(null);
  const [mode, setMode] = useState<PixelMode>('live');
  const [replayActive, setReplayActive] = useState(false);

  // Bridge only active in live mode
  usePixelBridge(mode === 'live' ? sceneRef : { current: null });

  // Handle mode changes
  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene) return;

    // Clean up previous mode
    if (demoRef.current) {
      demoRef.current.stop();
      demoRef.current = null;
    }
    if (replayRef.current) {
      replayRef.current.stop();
      replayRef.current = null;
      setReplayActive(false);
    }

    if (mode === 'demo') {
      scene.characters.clear();
      scene.currentCost = 0;
      const demo = new DemoSequencer(scene);
      demoRef.current = demo;
      demo.start();
    } else if (mode === 'replay') {
      scene.characters.clear();
      scene.currentCost = 0;
      const replay = new ReplayController(scene);
      replayRef.current = replay;
      // Load events from current store
      const events = useAgentStore.getState().events;
      if (events.length > 0) {
        replay.loadEvents(events);
        replay.start(1);
        setReplayActive(true);
      }
    }

    return () => {
      if (demoRef.current) {
        demoRef.current.stop();
        demoRef.current = null;
      }
      if (replayRef.current) {
        replayRef.current.stop();
        replayRef.current = null;
      }
    };
  }, [mode]);

  const handleClick = useCallback((target: ClickTarget) => {
    if (target.type === 'none') {
      setTooltip(null);
      return;
    }
    if (target.type === 'character') {
      const scene = sceneRef.current;
      const ch = scene?.characters.get(target.agentId ?? '');
      if (ch) {
        setTooltip({
          x: target.x,
          y: target.y,
          label: ch.label,
          details: [
            `Model: ${ch.model}`,
            `Type: ${ch.agentType}`,
            `State: ${ch.state}`,
            `ID: ${ch.agentId.slice(0, 12)}...`,
          ],
        });
      }
      return;
    }
    if (target.type === 'station') {
      const scene = sceneRef.current;
      const station = scene?.stations.find(s => s.name === target.stationName);
      if (station) {
        setTooltip({
          x: target.x,
          y: target.y,
          label: station.name,
          details: [
            `Tool: ${station.name}`,
            `Icon: ${station.icon}`,
            station.active ? 'Status: Active' : 'Status: Idle',
          ],
        });
      }
    }
  }, []);

  useEffect(() => {
    if (!containerRef.current) return;
    const scene = new SceneManager(containerRef.current, RETRO_OFFICE);
    sceneRef.current = scene;
    scene.onClickTarget = handleClick;
    scene.start();
    return () => {
      scene.destroy();
      sceneRef.current = null;
    };
  }, [handleClick]);

  return (
    <div
      ref={containerRef}
      className="relative h-screen w-screen bg-[#08080f] flex items-center justify-center"
    >
      <PixelHUD mode={mode} onModeChange={setMode} sceneRef={sceneRef} />
      {replayActive && replayRef.current && (
        <ReplayBar controller={replayRef.current} />
      )}
      {tooltip && (
        <div
          className="absolute z-50 pointer-events-none"
          style={{ left: tooltip.x + 12, top: tooltip.y - 10 }}
        >
          <div className="bg-gray-900/95 border border-gray-700 rounded px-3 py-2 text-xs shadow-lg max-w-48">
            <div className="font-bold text-amber-400 mb-1" style={{ fontFamily: "'Press Start 2P', monospace", fontSize: '8px' }}>
              {tooltip.label}
            </div>
            {tooltip.details.map((d, i) => (
              <div key={i} className="text-gray-400" style={{ fontFamily: 'monospace', fontSize: '9px' }}>
                {d}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
