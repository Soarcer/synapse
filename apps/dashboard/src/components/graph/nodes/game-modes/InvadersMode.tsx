// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Synapse Contributors

import { useMemo, useState, useEffect, useCallback } from 'react';
import type { ToolCallSummary } from '@synapse-ai/core';
import { formatDuration } from '@synapse-ai/core';
import type { GameModeProps } from './types';
import { Tooltip } from '../../../ui/Tooltip';

const TOOL_COLORS: Record<string, string> = {
  Read: '#0d9488', Edit: '#7c3aed', Bash: '#ea580c', Grep: '#2563eb',
  Glob: '#0891b2', Write: '#9333ea', Task: '#059669', WebSearch: '#d97706',
  WebFetch: '#d97706', TodoWrite: '#4f46e5',
};
const DEFAULT_COLOR = '#6b7280';
function getColor(name: string) { return TOOL_COLORS[name] ?? DEFAULT_COLOR; }

const COLS = 8;
const CELL_W = 28;
const CELL_H = 24;
const GAP = 4;
const CANNON_H = 20;

interface InvaderPos {
  tc: ToolCallSummary;
  col: number;
  row: number;
}

/**
 * Space Invaders visualization of tool calls.
 * Tools are arranged as "invaders" in an 8-column grid formation that bobs
 * left/right. Completed tools show an explosion + score, errors turn red,
 * and running tools pulse. A cannon sits at the bottom; laser lines animate
 * from cannon to invader on completion.
 */
export function InvadersMode({ tools, selectedNodeId, selectNode }: GameModeProps) {
  // Track which tool IDs have "just completed" for the laser + explosion animation
  const [recentlyCompleted, setRecentlyCompleted] = useState<Set<string>>(new Set());
  const [exploded, setExploded] = useState<Set<string>>(new Set());

  // When a tool transitions to success, trigger laser then explosion
  useEffect(() => {
    const nowComplete = tools.filter(
      (t) => t.status === 'success' && !exploded.has(t.toolUseId),
    );
    if (nowComplete.length === 0) return;

    const newRecent = new Set(recentlyCompleted);
    const ids: string[] = [];
    for (const t of nowComplete) {
      if (!newRecent.has(t.toolUseId)) {
        newRecent.add(t.toolUseId);
        ids.push(t.toolUseId);
      }
    }
    if (ids.length === 0) return;

    setRecentlyCompleted(newRecent);

    // After laser animation (200ms), mark as exploded
    const timer = setTimeout(() => {
      setExploded((prev) => {
        const next = new Set(prev);
        for (const id of ids) next.add(id);
        return next;
      });
    }, 200);
    return () => clearTimeout(timer);
  }, [tools, recentlyCompleted, exploded]);

  const invaders = useMemo<InvaderPos[]>(() => {
    return tools.map((tc, i) => ({
      tc,
      col: i % COLS,
      row: Math.floor(i / COLS),
    }));
  }, [tools]);

  const rows = Math.max(1, Math.ceil(tools.length / COLS));
  const containerW = Math.max(tools.length * CELL_W, 200);
  const gridW = COLS * (CELL_W + GAP) - GAP;
  const gridH = rows * (CELL_H + GAP) - GAP;
  const totalH = gridH + CANNON_H + 16; // 16px spacing above cannon

  const cannonX = gridW / 2;
  const cannonY = gridH + 16 + CANNON_H / 2;

  const getInvaderCenter = useCallback(
    (col: number, row: number) => ({
      x: col * (CELL_W + GAP) + CELL_W / 2,
      y: row * (CELL_H + GAP) + CELL_H / 2,
    }),
    [],
  );

  return (
    <div
      className="relative overflow-visible"
      style={{ width: Math.max(containerW, gridW), height: totalH }}
    >
      {/* Invader formation — bobs left/right */}
      <div className="invaders-formation absolute" style={{ top: 0, left: 0, width: gridW, height: gridH }}>
        {invaders.map(({ tc, col, row }) => {
          const nodeId = `tool-${tc.toolUseId}`;
          const isSelected = selectedNodeId === nodeId;
          const isRunning = tc.status === 'running';
          const isError = tc.status === 'error';
          const isExploded = exploded.has(tc.toolUseId);
          const color = getColor(tc.toolName);
          const dur = tc.duration != null ? formatDuration(tc.duration) : null;
          const x = col * (CELL_W + GAP);
          const y = row * (CELL_H + GAP);

          return (
            <Tooltip key={tc.toolUseId} content={`${tc.toolName}${dur ? ` \u00b7 ${dur}` : ''} \u00b7 ${tc.status}`}>
              <button
                onClick={(e) => { e.stopPropagation(); selectNode(nodeId, 'graph'); }}
                className={`absolute cursor-pointer ${
                  isSelected ? 'z-10' : ''
                }`}
                style={{
                  left: x,
                  top: y,
                  width: CELL_W,
                  height: CELL_H,
                }}
              >
                {/* Exploded state: score text drifting up */}
                {isExploded && (
                  <span
                    className="invader-score absolute inset-0 flex items-center justify-center text-[8px] font-mono font-bold pointer-events-none"
                    style={{ color }}
                  >
                    +100
                  </span>
                )}

                {/* Active invader (not yet exploded) */}
                {!isExploded && (
                  <span
                    className={`invader-body absolute inset-0 flex items-center justify-center ${
                      isRunning ? 'invader-pulse' : ''
                    }`}
                    style={{
                      backgroundColor: isError ? '#ef4444' : color,
                      clipPath:
                        'polygon(20% 0%, 30% 0%, 30% 15%, 0% 15%, 0% 40%, 10% 40%, 10% 60%, 0% 60%, 0% 85%, 20% 85%, 20% 100%, 35% 100%, 35% 85%, 65% 85%, 65% 100%, 80% 100%, 80% 85%, 100% 85%, 100% 60%, 90% 60%, 90% 40%, 100% 40%, 100% 15%, 70% 15%, 70% 0%, 80% 0%, 80% 0%, 50% 0%, 50% 0%, 20% 0%)',
                      opacity: 0.9,
                      boxShadow: isSelected
                        ? '0 0 0 2px #a855f7'
                        : undefined,
                      borderRadius: isSelected ? '2px' : undefined,
                    }}
                  >
                    {/* Eyes */}
                    <span className="flex gap-[3px] mt-[1px]">
                      <span className="w-[4px] h-[4px] rounded-sm bg-white/80" />
                      <span className="w-[4px] h-[4px] rounded-sm bg-white/80" />
                    </span>
                    {isError && (
                      <span className="absolute text-[8px] font-bold text-white" style={{ top: -2, right: -2 }}>
                        X
                      </span>
                    )}
                  </span>
                )}

                {/* Selected ring */}
                {isSelected && !isExploded && (
                  <span
                    className="absolute inset-[-3px] rounded border-2 border-purple-400 pointer-events-none"
                  />
                )}
              </button>
            </Tooltip>
          );
        })}
      </div>

      {/* Laser lines from cannon to recently completed invaders */}
      <svg
        className="absolute inset-0 pointer-events-none"
        style={{ width: gridW, height: totalH, overflow: 'visible' }}
      >
        {invaders
          .filter(({ tc }) => recentlyCompleted.has(tc.toolUseId) && !exploded.has(tc.toolUseId))
          .map(({ tc, col, row }) => {
            const target = getInvaderCenter(col, row);
            return (
              <line
                key={`laser-${tc.toolUseId}`}
                className="invader-laser"
                x1={cannonX}
                y1={cannonY}
                x2={target.x}
                y2={target.y}
                stroke="#22c55e"
                strokeWidth={2}
                strokeLinecap="round"
              />
            );
          })}
      </svg>

      {/* Cannon at bottom center */}
      <div
        className="absolute flex items-center justify-center"
        style={{
          left: cannonX - 10,
          top: gridH + 16,
          width: 20,
          height: CANNON_H,
        }}
      >
        <span
          style={{
            width: 0,
            height: 0,
            borderLeft: '8px solid transparent',
            borderRight: '8px solid transparent',
            borderBottom: '16px solid #22c55e',
            display: 'block',
            filter: 'drop-shadow(0 0 4px rgba(34,197,94,0.5))',
          }}
        />
      </div>

      <style>{`
        .invaders-formation {
          animation: invaders-bob 3s ease-in-out infinite;
        }
        @keyframes invaders-bob {
          0%, 100% { transform: translateX(-8px); }
          50% { transform: translateX(8px); }
        }
        .invader-pulse {
          animation: invader-pulse-anim 0.8s ease-in-out infinite;
        }
        @keyframes invader-pulse-anim {
          0%, 100% { transform: scale(1); }
          50% { transform: scale(1.12); }
        }
        .invader-score {
          animation: invader-score-drift 1.2s ease-out forwards;
        }
        @keyframes invader-score-drift {
          0% { opacity: 1; transform: translateY(0) scale(1.3); }
          60% { opacity: 0.8; transform: translateY(-10px) scale(1); }
          100% { opacity: 0; transform: translateY(-18px) scale(0.8); }
        }
        .invader-laser {
          animation: invader-laser-flash 0.2s ease-out forwards;
        }
        @keyframes invader-laser-flash {
          0% { opacity: 0; stroke-dasharray: 4 4; }
          50% { opacity: 1; stroke-dasharray: none; }
          100% { opacity: 0; }
        }
      `}</style>
    </div>
  );
}
