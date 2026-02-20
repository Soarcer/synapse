import { useState, useEffect, useRef } from 'react';
import type { SceneManager } from '../engine/SceneManager';

export type PixelMode = 'live' | 'demo' | 'replay';

interface PixelHUDProps {
  mode: PixelMode;
  onModeChange: (mode: PixelMode) => void;
  sceneRef: React.RefObject<SceneManager | null>;
}

interface HUDStats {
  agents: number;
  cost: number;
  tokens: number;
  tools: number;
}

interface LogEntry {
  id: number;
  text: string;
  cls: string;
  time: number;
}

const PIXEL_FONT = "'Press Start 2P', monospace";
let logId = 0;

export function PixelHUD({ mode, onModeChange, sceneRef }: PixelHUDProps) {
  const [stats, setStats] = useState<HUDStats>({ agents: 0, cost: 0, tokens: 0, tools: 0 });
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const statsRef = useRef(stats);
  statsRef.current = stats;

  // Update stats from scene on interval
  useEffect(() => {
    const iv = setInterval(() => {
      const scene = sceneRef.current;
      if (!scene) return;
      setStats({
        agents: scene.getActiveAgentCount(),
        cost: scene.getCurrentCost(),
        tokens: 0, // updated via events
        tools: 0,
      });
    }, 250);
    return () => clearInterval(iv);
  }, [sceneRef]);

  // Public method to add log entries (called via ref from parent)
  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene) return;
    // Intercept commands to populate event log
    const origHandle = scene.handleCommand.bind(scene);
    scene.handleCommand = (cmd) => {
      origHandle(cmd);
      let text = '';
      let cls = '';
      switch (cmd.type) {
        case 'spawnAgent':
          text = `agent_start: ${cmd.model}`;
          cls = 'text-amber-400';
          break;
        case 'despawnAgent':
          text = `agent_stop ${cmd.success ? '✓' : '✗'}`;
          cls = cmd.success ? 'text-green-400' : 'text-red-400';
          break;
        case 'dispatchToStation':
          text = `→ ${cmd.stationName}`;
          cls = 'text-blue-400';
          break;
        case 'stationComplete':
          text = `${cmd.stationName} ${cmd.success ? '✓' : '✗'}`;
          cls = cmd.success ? 'text-green-400' : 'text-red-400';
          break;
        case 'promptArrived':
          text = `▶ prompt received`;
          cls = 'text-amber-400';
          break;
      }
      if (text) {
        setLogs(prev => [{ id: logId++, text, cls, time: Date.now() }, ...prev].slice(0, 8));
      }
    };
  }, [sceneRef]);

  // Fade out old logs
  useEffect(() => {
    const iv = setInterval(() => {
      const now = Date.now();
      setLogs(prev => prev.filter(l => now - l.time < 6000));
    }, 1000);
    return () => clearInterval(iv);
  }, []);

  return (
    <div className="absolute inset-0 pointer-events-none" style={{ fontFamily: PIXEL_FONT, fontSize: '8px', lineHeight: '1.4', textShadow: '1px 1px 0 #000, 0 0 4px rgba(0,0,0,0.8)' }}>
      {/* Top Left — Agent count */}
      <div className="absolute top-2 left-3 text-gray-300">
        <span className="text-amber-400">⚡</span> {stats.agents} agent{stats.agents !== 1 ? 's' : ''} active
      </div>

      {/* Top Right — Cost */}
      <div className="absolute top-2 right-3 text-right text-gray-300">
        <span className="text-amber-400">◆</span> ${stats.cost.toFixed(2)}
        {/* Settings gear */}
        <button
          className="pointer-events-auto ml-2 text-gray-500 hover:text-gray-300 transition-colors"
          onClick={() => setSettingsOpen(!settingsOpen)}
          style={{ fontSize: '10px' }}
        >
          ⚙
        </button>
      </div>

      {/* Settings Panel */}
      {settingsOpen && (
        <div className="absolute top-6 right-3 pointer-events-auto bg-gray-900/95 border border-gray-700 rounded px-3 py-2 text-gray-300 min-w-36" style={{ fontSize: '7px' }}>
          <div className="text-amber-400 mb-2" style={{ fontSize: '8px' }}>Settings</div>
          <div className="space-y-1.5">
            <div className="flex items-center gap-2">
              <span>Mode:</span>
              {(['live', 'demo', 'replay'] as const).map(m => (
                <button
                  key={m}
                  className={`px-1.5 py-0.5 rounded ${mode === m ? 'bg-amber-400/20 text-amber-400' : 'text-gray-500 hover:text-gray-300'}`}
                  onClick={() => { onModeChange(m); setSettingsOpen(false); }}
                >
                  {m}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Bottom Left — Mode */}
      <div className="absolute bottom-2 left-3 text-gray-300">
        <span className={mode === 'live' ? 'text-green-400' : mode === 'demo' ? 'text-amber-400' : 'text-blue-400'}>▶</span> {mode.charAt(0).toUpperCase() + mode.slice(1)} Mode
      </div>

      {/* Bottom Right — Theme */}
      <div className="absolute bottom-2 right-3 text-gray-500">
        Retro Office
      </div>

      {/* Bottom Center — Tool calls */}
      <div className="absolute bottom-2 left-1/2 -translate-x-1/2 text-gray-500">
        {stats.tools} tool calls
      </div>

      {/* Event Log */}
      <div className="absolute top-8 left-3 max-w-44" style={{ fontSize: '6px' }}>
        {logs.map(l => (
          <div
            key={l.id}
            className={`${l.cls} whitespace-nowrap overflow-hidden text-ellipsis animate-pulse`}
            style={{
              opacity: Math.max(0, 1 - (Date.now() - l.time) / 6000),
              lineHeight: '1.6',
            }}
          >
            {l.text}
          </div>
        ))}
      </div>
    </div>
  );
}
