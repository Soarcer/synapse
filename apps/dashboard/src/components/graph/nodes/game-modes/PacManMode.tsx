// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Synapse Contributors

import { useMemo } from 'react';
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

// Vulnerable ghost color (classic blue)
const VULNERABLE_COLOR = '#2563eb';

interface Props {
  tools: ToolCallSummary[];
  selectedNodeId: string | null;
  selectNode: (id: string | null, source?: 'graph' | 'lens') => void;
}

export function PacManMode({ tools, selectedNodeId, selectNode }: Props) {
  // Find Pac-Man position: after last completed tool
  const pacIndex = useMemo(() => {
    let last = -1;
    for (let i = 0; i < tools.length; i++) {
      if (tools[i].status === 'success') last = i;
    }
    return last;
  }, [tools]);

  const numRows = Math.ceil(tools.length / GHOSTS_PER_ROW) || 1;
  const containerW = Math.min(tools.length, GHOSTS_PER_ROW) * (GHOST_SIZE + GHOST_GAP) + PAC_SIZE + 32;
  const containerH = numRows * ROW_HEIGHT + 16;

  return (
    <div className="relative" style={{ width: Math.max(containerW, 200), height: Math.max(containerH, 60) }}>
      {/* Dot path (small dots between ghosts) */}
      {tools.map((_, i) => {
        const row = Math.floor(i / GHOSTS_PER_ROW);
        const col = i % GHOSTS_PER_ROW;
        const x = 16 + col * (GHOST_SIZE + GHOST_GAP) + GHOST_SIZE / 2;
        const y = 8 + row * ROW_HEIGHT + ROW_HEIGHT / 2;
        const isEaten = tools[i].status === 'success';
        return (
          <div
            key={`dot-${i}`}
            className="absolute rounded-full"
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
          left: 16 + (pacIndex >= 0 ? (pacIndex % GHOSTS_PER_ROW) * (GHOST_SIZE + GHOST_GAP) + GHOST_SIZE + 4 : -4),
          top: 8 + Math.floor(Math.max(0, pacIndex) / GHOSTS_PER_ROW) * ROW_HEIGHT + (ROW_HEIGHT - PAC_SIZE) / 2,
          borderRadius: '50%',
          backgroundColor: '#ffdd00',
          animation: 'pacman-chomp 0.3s infinite alternate',
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
        const isEaten = tc.status === 'success';
        const isRunning = tc.status === 'running';
        const isError = tc.status === 'error';
        const dur = tc.duration != null ? formatDuration(tc.duration) : null;

        // Ghost color: blue if running (vulnerable), tool color if pending, red flash if error
        const ghostColor = isRunning ? VULNERABLE_COLOR : isError ? '#ef4444' : getColor(tc.toolName);

        return (
          <Tooltip key={tc.toolUseId} content={`${tc.toolName}${dur ? ` \u00b7 ${dur}` : ''} \u00b7 ${tc.status}`}>
            <button
              onClick={(e) => { e.stopPropagation(); selectNode(nodeId, 'graph'); }}
              className={`absolute cursor-pointer transition-all ${
                isSelected ? 'ring-1 ring-purple-400 rounded z-10' : ''
              }`}
              style={{
                left: x,
                top: y,
                width: GHOST_SIZE,
                height: GHOST_SIZE,
              }}
            >
              {isEaten ? (
                // Floating eyes (ghost was eaten)
                <div className="relative w-full h-full" style={{ animation: 'ghost-eyes-float 2s ease-in-out infinite alternate' }}>
                  <div className="absolute bg-white rounded-full" style={{ width: 5, height: 6, left: 3, top: 4 }}>
                    <div className="absolute bg-blue-900 rounded-full" style={{ width: 3, height: 3, left: 1, top: 2 }} />
                  </div>
                  <div className="absolute bg-white rounded-full" style={{ width: 5, height: 6, left: 12, top: 4 }}>
                    <div className="absolute bg-blue-900 rounded-full" style={{ width: 3, height: 3, left: 1, top: 2 }} />
                  </div>
                </div>
              ) : (
                // Full ghost sprite
                <div
                  className="relative w-full h-full"
                  style={{
                    animation: isRunning ? 'ghost-wobble 0.5s ease-in-out infinite alternate' : undefined,
                  }}
                >
                  {/* Ghost body: dome top + wavy bottom */}
                  <div
                    className="absolute inset-0"
                    style={{
                      backgroundColor: ghostColor,
                      borderRadius: '50% 50% 0 0',
                      clipPath: 'polygon(0% 0%, 100% 0%, 100% 85%, 85% 100%, 70% 85%, 50% 100%, 30% 85%, 15% 100%, 0% 85%)',
                    }}
                  />
                  {/* Eyes */}
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

      <style>{`
        @keyframes pacman-chomp {
          0% { clip-path: polygon(100% 50%, 50% 5%, 0% 0%, 0% 100%, 50% 95%); }
          100% { clip-path: polygon(100% 50%, 50% 35%, 0% 0%, 0% 100%, 50% 65%); }
        }
        @keyframes ghost-wobble {
          from { transform: translateX(-1px); }
          to { transform: translateX(1px); }
        }
        @keyframes ghost-eyes-float {
          from { transform: translateY(0) translateX(2px); opacity: 0.6; }
          to { transform: translateY(-3px) translateX(-2px); opacity: 0.4; }
        }
      `}</style>
    </div>
  );
}
