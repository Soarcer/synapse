// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Bernhard

import { useState, useRef, useEffect } from 'react';
import { useAgentStore } from '../../store/agentStore';
import { GAME_MODE_OPTIONS } from '../graph/nodes/game-modes';
import { PushSetup } from '../settings/PushSetup';

const TOOL_VIEW_MODES = [
  { value: 'pillGrid' as const, label: 'Pill Grid' },
  { value: 'timeline' as const, label: 'Timeline' },
  { value: 'heatmap' as const, label: 'Heatmap' },
];

function startOfDay(): number {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

function startOfWeek(): number {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - d.getDay());
  return d.getTime();
}

interface TimePreset {
  label: string;
  range: (() => { from: number; to: number }) | null;
}

const TIME_PRESETS: TimePreset[] = [
  { label: 'Last hour', range: () => ({ from: Date.now() - 3_600_000, to: Date.now() }) },
  { label: 'Last 4h', range: () => ({ from: Date.now() - 14_400_000, to: Date.now() }) },
  { label: 'Today', range: () => ({ from: startOfDay(), to: Date.now() }) },
  { label: 'This week', range: () => ({ from: startOfWeek(), to: Date.now() }) },
  { label: 'All time', range: null },
];

export function MobileSettingsButton() {
  const [open, setOpen] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);

  const toolGroupMode = useAgentStore((s) => s.toolGroupMode);
  const lockViewport = useAgentStore((s) => s.lockViewport);
  const paused = useAgentStore((s) => s.paused);
  const timePresetLabel = useAgentStore((s) => s.timePresetLabel);
  const setTimeRange = useAgentStore((s) => s.setTimeRange);
  const arcadeUnlocked = useAgentStore((s) => s.arcadeUnlocked);
  const arcadeMode = useAgentStore((s) => s.arcadeMode);
  const arcadeSoundEnabled = useAgentStore((s) => s.arcadeSoundEnabled);

  // Close on outside tap
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent | TouchEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    document.addEventListener('touchstart', handler);
    return () => {
      document.removeEventListener('mousedown', handler);
      document.removeEventListener('touchstart', handler);
    };
  }, [open]);

  return (
    <div
      ref={panelRef}
      className="absolute right-2 z-20"
      style={{ top: 'calc(env(safe-area-inset-top, 0px) + 0.5rem)' }}
    >
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-8 h-8 flex items-center justify-center bg-gray-800/90 border border-gray-700 rounded-full text-gray-400 text-sm backdrop-blur-sm"
        aria-label="Settings"
      >
        {'\u2699'}
      </button>

      {open && (
        <div className="absolute top-10 right-0 w-56 max-h-[70vh] overflow-y-auto bg-syn-bg-overlay border border-gray-700 rounded-lg shadow-xl p-3 space-y-3">
          {/* Time range filter */}
          <div>
            <div className="text-[10px] text-gray-500 uppercase tracking-wider mb-1.5">
              Time range
            </div>
            <div className="flex flex-wrap gap-1">
              {TIME_PRESETS.map((p) => (
                <button
                  key={p.label}
                  onClick={() => {
                    const range = p.range ? p.range() : null;
                    setTimeRange(range, p.label);
                  }}
                  className={`px-2 py-1 text-[10px] rounded border transition-colors ${
                    timePresetLabel === p.label
                      ? 'bg-blue-600/30 border-blue-500/50 text-blue-300'
                      : 'bg-gray-800 border-gray-700 text-gray-500'
                  }`}
                >
                  {p.label}
                </button>
              ))}
            </div>
          </div>

          <div className="border-t border-gray-700 pt-2 space-y-3">
            <Toggle
              label="Lock viewport"
              checked={lockViewport}
              onChange={(v) => useAgentStore.getState().setLockViewport(v)}
            />
            <Toggle
              label="Pause updates"
              checked={paused}
              onChange={(v) => useAgentStore.getState().setPaused(v)}
            />
          </div>

          <div className="border-t border-gray-700 pt-2">
            <div className="text-[10px] text-gray-500 uppercase tracking-wider mb-1.5">
              Tool view
            </div>
            <div className="flex gap-1">
              {TOOL_VIEW_MODES.map((m) => (
                <button
                  key={m.value}
                  onClick={() => useAgentStore.getState().setToolGroupMode(m.value)}
                  className={`flex-1 px-1.5 py-1 text-[10px] rounded border transition-colors ${
                    toolGroupMode === m.value
                      ? 'bg-blue-600/30 border-blue-500/50 text-blue-300'
                      : 'bg-gray-800 border-gray-700 text-gray-500'
                  }`}
                >
                  {m.label}
                </button>
              ))}
            </div>
          </div>

          {/* Push Notifications */}
          <div className="border-t border-gray-700 pt-2">
            <PushSetup />
          </div>

          {/* Arcade — only visible after easter egg unlock */}
          {arcadeUnlocked && (
            <div className="border-t border-gray-700 pt-2 space-y-2">
              <Toggle
                label="Arcade Mode"
                checked={arcadeMode}
                onChange={(v) => {
                  useAgentStore.getState().setArcadeMode(v);
                  if (!v) useAgentStore.getState().setToolGroupMode('heatmap');
                }}
              />
              {arcadeMode && (
                <>
                  <div className="grid grid-cols-2 gap-1">
                    {GAME_MODE_OPTIONS.map((m) => (
                      <button
                        key={m.value}
                        onClick={() => useAgentStore.getState().setToolGroupMode(m.value)}
                        className={`px-2 py-1 text-[10px] rounded border transition-colors ${
                          toolGroupMode === m.value
                            ? 'bg-purple-600/30 border-purple-500/50 text-purple-300'
                            : 'bg-gray-800 border-gray-700 text-gray-500'
                        }`}
                      >
                        {m.label}
                      </button>
                    ))}
                  </div>
                  <Toggle
                    label="Sound effects"
                    checked={arcadeSoundEnabled}
                    onChange={(v) => useAgentStore.getState().setArcadeSoundEnabled(v)}
                  />
                </>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function Toggle({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <button
      onClick={() => onChange(!checked)}
      className="w-full flex items-center justify-between text-xs"
    >
      <span className="text-gray-300">{label}</span>
      <span
        className={`w-8 h-[18px] shrink-0 rounded-full relative transition-colors ${
          checked ? 'bg-blue-600' : 'bg-gray-700'
        }`}
      >
        <span
          className={`absolute top-0.5 left-0 w-3.5 h-3.5 rounded-full bg-white transition-transform ${
            checked ? 'translate-x-[14px]' : 'translate-x-0.5'
          }`}
        />
      </span>
    </button>
  );
}
