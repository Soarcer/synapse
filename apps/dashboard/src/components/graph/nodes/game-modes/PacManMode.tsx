// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Synapse Contributors

import { useMemo, useState, useEffect, useRef, useCallback } from 'react';
import type { ToolCallSummary } from '@synapse-ai/core';
import { formatDuration } from '@synapse-ai/core';
import { Tooltip } from '../../../ui/Tooltip';

const TOOL_COLORS: Record<string, string> = {
  Read: '#0d9488', Edit: '#7c3aed', Bash: '#ea580c', Grep: '#2563eb',
  Glob: '#0891b2', Write: '#9333ea', Task: '#059669', WebSearch: '#d97706',
  WebFetch: '#d97706', TodoWrite: '#4f46e5',
};
const DEFAULT_COLOR = '#6b7280';
function getColor(name: string) { return TOOL_COLORS[name] ?? DEFAULT_COLOR; }

const GHOST_SIZE = 20;
const GHOST_GAP = 8;
const DOT_SIZE = 4;
const PAC_SIZE = 24;
const ROW_HEIGHT = 40;
const GHOSTS_PER_ROW = 10;
const VULNERABLE_COLOR = '#2563eb';

interface Props {
  tools: ToolCallSummary[];
  selectedNodeId: string | null;
  selectNode: (id: string | null, source?: 'graph' | 'lens') => void;
}

export function PacManMode({ tools, selectedNodeId, selectNode }: Props) {
  const allComplete = useMemo(
    () => tools.length > 0 && tools.every((t) => t.status === 'success' || t.status === 'error'),
    [tools],
  );

  // Sweep state
  const [sweeping, setSweeping] = useState(false);
  const [sweepIndex, setSweepIndex] = useState(-1);
  const [showClear, setShowClear] = useState(false);
  const prevAllCompleteRef = useRef(false);
  const [eatenSet, setEatenSet] = useState<Set<number>>(new Set());

  // Auto-trigger sweep when all tools first complete
  useEffect(() => {
    if (allComplete && !prevAllCompleteRef.current && tools.length > 0) {
      triggerSweep();
    }
    prevAllCompleteRef.current = allComplete;
  }, [allComplete, tools.length]); // eslint-disable-line react-hooks/exhaustive-deps

  const triggerSweep = useCallback(() => {
    if (sweeping) return;
    setSweeping(true);
    setSweepIndex(-1);
    setEatenSet(new Set());
    setShowClear(false);

    const speed = Math.max(80, Math.min(300, 1500 / Math.max(tools.length, 1)));
    let idx = 0;

    function advance() {
      if (idx >= tools.length) {
        setShowClear(true);
        setTimeout(() => {
          setShowClear(false);
          setSweeping(false);
          setSweepIndex(-1);
        }, 800);
        return;
      }
      const tool = tools[idx];
      setSweepIndex(idx);
      setEatenSet((prev) => new Set(prev).add(idx));

      if (tool.status === 'error') {
        // Bounce back briefly on error ghost
        setTimeout(() => { idx++; advance(); }, 200);
      } else {
        idx++;
        setTimeout(advance, speed);
      }
    }

    setTimeout(() => advance(), speed);
  }, [sweeping, tools]);

  const numRows = Math.ceil(tools.length / GHOSTS_PER_ROW) || 1;
  const containerW = Math.max(Math.min(tools.length, GHOSTS_PER_ROW) * (GHOST_SIZE + GHOST_GAP) + PAC_SIZE + 48, 200);
  const containerH = numRows * ROW_HEIGHT + 16;

  // Pac-Man position: during sweep follows sweepIndex; otherwise at left edge
  const pacRow = sweeping && sweepIndex >= 0 ? Math.floor(sweepIndex / GHOSTS_PER_ROW) : 0;
  const pacCol = sweeping && sweepIndex >= 0 ? sweepIndex % GHOSTS_PER_ROW : -1;
  const pacLeft = pacCol >= 0 ? 16 + pacCol * (GHOST_SIZE + GHOST_GAP) + GHOST_SIZE + 4 : 4;
  const pacTop = 8 + pacRow * ROW_HEIGHT + (ROW_HEIGHT - PAC_SIZE) / 2;

  return (
    <div className="relative" style={{ width: containerW, height: containerH }}>
      {/* Dots between ghosts */}
      {tools.map((_, i) => {
        const row = Math.floor(i / GHOSTS_PER_ROW);
        const col = i % GHOSTS_PER_ROW;
        const x = 16 + col * (GHOST_SIZE + GHOST_GAP) + GHOST_SIZE / 2;
        const y = 8 + row * ROW_HEIGHT + ROW_HEIGHT / 2;
        const isEaten = eatenSet.has(i);
        return (
          <div
            key={`dot-${i}`}
            className="absolute rounded-full transition-opacity"
            style={{
              width: DOT_SIZE,
              height: DOT_SIZE,
              left: x - DOT_SIZE / 2 - (GHOST_SIZE + GHOST_GAP) / 2,
              top: y - DOT_SIZE / 2,
              backgroundColor: isEaten ? 'transparent' : 'rgba(255,255,255,0.3)',
            }}
          />
        );
      })}

      {/* Pac-Man */}
      <div
        className="absolute"
        style={{
          width: PAC_SIZE,
          height: PAC_SIZE,
          left: pacLeft,
          top: pacTop,
          borderRadius: '50%',
          backgroundColor: '#ffdd00',
          clipPath: 'polygon(100% 50%, 50% 75%, 0% 100%, 0% 0%, 50% 25%)',
          animation: 'pacman-chomp 0.3s infinite alternate',
          transition: sweeping ? 'left 0.15s ease-out, top 0.15s ease-out' : undefined,
          zIndex: 5,
        }}
      />

      {/* Ghosts */}
      {tools.map((tc, i) => {
        const row = Math.floor(i / GHOSTS_PER_ROW);
        const col = i % GHOSTS_PER_ROW;
        const x = 16 + col * (GHOST_SIZE + GHOST_GAP);
        const y = 8 + row * ROW_HEIGHT + (ROW_HEIGHT - GHOST_SIZE) / 2;
        const nodeId = `tool-${tc.toolUseId}`;
        const isSelected = selectedNodeId === nodeId;
        const isRunning = tc.status === 'running';
        const isError = tc.status === 'error';
        const isEaten = eatenSet.has(i);
        const dur = tc.duration != null ? formatDuration(tc.duration) : null;
        const ghostColor = isRunning ? VULNERABLE_COLOR : isError ? '#ef4444' : getColor(tc.toolName);

        return (
          <Tooltip key={tc.toolUseId} content={`${tc.toolName}${dur ? ` \u00b7 ${dur}` : ''} \u00b7 ${tc.status}`}>
            <button
              onClick={(e) => { e.stopPropagation(); selectNode(nodeId, 'graph'); }}
              className={`absolute cursor-pointer transition-all ${
                isSelected ? 'ring-1 ring-purple-400 rounded z-10' : ''
              }`}
              style={{ left: x, top: y, width: GHOST_SIZE, height: GHOST_SIZE }}
            >
              {isEaten && !isError ? (
                <div className="relative w-full h-full" style={{ animation: 'ghost-eyes-float 2s ease-in-out infinite alternate' }}>
                  <div className="absolute bg-white rounded-full" style={{ width: 5, height: 6, left: 3, top: 4 }}>
                    <div className="absolute bg-blue-900 rounded-full" style={{ width: 3, height: 3, left: 1, top: 2 }} />
                  </div>
                  <div className="absolute bg-white rounded-full" style={{ width: 5, height: 6, left: 12, top: 4 }}>
                    <div className="absolute bg-blue-900 rounded-full" style={{ width: 3, height: 3, left: 1, top: 2 }} />
                  </div>
                </div>
              ) : (
                <div
                  className="relative w-full h-full"
                  style={{ animation: isRunning ? 'ghost-wobble 0.5s ease-in-out infinite alternate' : undefined }}
                >
                  <div
                    className="absolute inset-0"
                    style={{
                      backgroundColor: ghostColor,
                      borderRadius: '50% 50% 0 0',
                      clipPath: 'polygon(0% 0%, 100% 0%, 100% 85%, 85% 100%, 70% 85%, 50% 100%, 30% 85%, 15% 100%, 0% 85%)',
                    }}
                  />
                  <div className="absolute bg-white rounded-full" style={{ width: 5, height: 5, left: 3, top: 5 }}>
                    <div className="absolute bg-blue-900 rounded-full" style={{ width: 2.5, height: 2.5, left: 1.5, top: 1.5 }} />
                  </div>
                  <div className="absolute bg-white rounded-full" style={{ width: 5, height: 5, left: 11, top: 5 }}>
                    <div className="absolute bg-blue-900 rounded-full" style={{ width: 2.5, height: 2.5, left: 1.5, top: 1.5 }} />
                  </div>
                </div>
              )}
            </button>
          </Tooltip>
        );
      })}

      {/* CLEAR text */}
      {showClear && (
        <div
          className="absolute inset-0 flex items-center justify-center pointer-events-none z-20"
          style={{ animation: 'clear-flash 0.8s ease-out forwards' }}
        >
          <span className="text-yellow-300 font-bold text-lg" style={{ textShadow: '0 0 8px rgba(255,221,0,0.6)' }}>
            CLEAR!
          </span>
        </div>
      )}

      {/* Replay button */}
      {allComplete && !sweeping && (
        <button
          onClick={(e) => { e.stopPropagation(); setEatenSet(new Set()); triggerSweep(); }}
          className="absolute bottom-1 right-1 w-5 h-5 flex items-center justify-center rounded-full bg-gray-700/60 hover:bg-gray-600/80 text-gray-400 hover:text-white text-[10px] z-10 transition-colors"
          title="Replay sweep"
        >
          {'\u21BB'}
        </button>
      )}

      {/* Progress text */}
      {!allComplete && tools.length > 0 && (
        <div className="absolute top-0.5 left-1 text-[8px] text-gray-500 pointer-events-none">
          {tools.filter((t) => t.status !== 'running').length} / {tools.length}
        </div>
      )}

      <style>{`
        @keyframes pacman-chomp {
          0% { clip-path: polygon(100% 50%, 80% 100%, 0% 100%, 0% 0%, 80% 0%); }
          100% { clip-path: polygon(100% 50%, 50% 75%, 0% 100%, 0% 0%, 50% 25%); }
        }
        @keyframes ghost-wobble {
          from { transform: translateX(-1px); }
          to { transform: translateX(1px); }
        }
        @keyframes ghost-eyes-float {
          from { transform: translateY(0) translateX(2px); opacity: 0.6; }
          to { transform: translateY(-3px) translateX(-2px); opacity: 0.4; }
        }
        @keyframes clear-flash {
          0% { opacity: 0; transform: scale(0.5); }
          20% { opacity: 1; transform: scale(1.2); }
          80% { opacity: 1; transform: scale(1); }
          100% { opacity: 0; transform: scale(1); }
        }
      `}</style>
    </div>
  );
}
