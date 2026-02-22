// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Synapse Contributors

import { useMemo, useState } from 'react';
import type { ToolCallSummary } from '@synapse-ai/core';
import { formatDuration } from '@synapse-ai/core';
import { GooeyFilter } from './GooeyFilter';
import { Tooltip } from '../../../ui/Tooltip';

const TOOL_COLORS: Record<string, string> = {
  Read: '#0d9488', Edit: '#7c3aed', Bash: '#ea580c', Grep: '#2563eb',
  Glob: '#0891b2', Write: '#9333ea', Task: '#059669', WebSearch: '#d97706',
  WebFetch: '#d97706', TodoWrite: '#4f46e5',
};
const DEFAULT_COLOR = '#6b7280';

function getColor(name: string) { return TOOL_COLORS[name] ?? DEFAULT_COLOR; }

const CONTAINER_W = 264;
const CONTAINER_H = 168;

interface Props {
  tools: ToolCallSummary[];
  parentAgentId: string;
  selectedNodeId: string | null;
  selectNode: (id: string | null, source?: 'graph' | 'lens') => void;
}

export function BubblesMode({ tools, parentAgentId, selectedNodeId, selectNode }: Props) {
  const [hoveredType, setHoveredType] = useState<string | null>(null);

  // Group tools by type
  const toolsByType = useMemo(() => {
    const map = new Map<string, ToolCallSummary[]>();
    for (const t of tools) {
      const list = map.get(t.toolName) ?? [];
      list.push(t);
      map.set(t.toolName, list);
    }
    return map;
  }, [tools]);

  const toolNames = useMemo(() => [...toolsByType.keys()], [toolsByType]);

  // Position blobs: spread types across X, tools within type along Y
  const blobPositions = useMemo(() => {
    const positions = new Map<string, { x: number; y: number; r: number }>();
    const types = [...toolsByType.entries()];
    const slotW = CONTAINER_W / Math.max(types.length, 1);

    for (let ti = 0; ti < types.length; ti++) {
      const [, tcs] = types[ti];
      const cx = slotW * ti + slotW / 2;
      for (let i = 0; i < tcs.length; i++) {
        const tc = tcs[i];
        const r = Math.max(12, Math.min(36, (tc.duration ?? 200) / 50));
        // Spread vertically within the type's column
        const slotH = CONTAINER_H / Math.max(tcs.length, 1);
        const cy = slotH * i + slotH / 2;
        positions.set(tc.toolUseId, { x: cx, y: cy, r });
      }
    }
    return positions;
  }, [toolsByType]);

  const filterId = `goo-${parentAgentId}`;

  return (
    <div className="relative" style={{ width: CONTAINER_W, height: CONTAINER_H, overflow: 'hidden' }}>
      <GooeyFilter id={filterId} toolNames={toolNames} />

      {[...toolsByType.entries()].map(([toolName, tcs]) => {
        const isHovered = hoveredType === toolName;
        return (
          <div
            key={toolName}
            className="absolute inset-0"
            style={{
              filter: `url(#${filterId}-${toolName})`,
              // Reduce blur on hover to un-goo and reveal individuals
              ...(isHovered ? { filter: 'none' } : {}),
            }}
            onMouseEnter={() => setHoveredType(toolName)}
            onMouseLeave={() => setHoveredType(null)}
          >
            {tcs.map((tc) => {
              const pos = blobPositions.get(tc.toolUseId);
              if (!pos) return null;
              const nodeId = `tool-${tc.toolUseId}`;
              const isSelected = selectedNodeId === nodeId;
              const isRunning = tc.status === 'running';
              const isError = tc.status === 'error';
              const dur = tc.duration != null ? formatDuration(tc.duration) : null;

              return (
                <Tooltip key={tc.toolUseId} content={`${tc.toolName}${dur ? ` \u00b7 ${dur}` : ''} \u00b7 ${tc.status}`}>
                  <button
                    onClick={(e) => { e.stopPropagation(); selectNode(nodeId, 'graph'); }}
                    className={`absolute rounded-full transition-all cursor-pointer ${
                      isSelected ? 'ring-2 ring-purple-400 ring-offset-1 ring-offset-gray-900' : ''
                    }`}
                    style={{
                      width: pos.r * 2,
                      height: pos.r * 2,
                      left: pos.x - pos.r,
                      top: pos.y - pos.r,
                      backgroundColor: getColor(tc.toolName),
                      opacity: isError ? 0.5 : 0.85,
                      animation: isRunning
                        ? 'bubble-float 2s ease-in-out infinite alternate'
                        : isError
                          ? 'bubble-sink 3s ease-in forwards'
                          : undefined,
                    }}
                  />
                </Tooltip>
              );
            })}
          </div>
        );
      })}

      {/* CSS keyframes */}
      <style>{`
        @keyframes bubble-float {
          0% { transform: translateY(0) rotate(0deg); }
          100% { transform: translateY(-4px) rotate(2deg); }
        }
        @keyframes bubble-sink {
          to { transform: translateY(16px); opacity: 0.3; filter: saturate(0.3); }
        }
        @keyframes bubble-pop {
          0% { transform: scale(1); opacity: 1; }
          50% { transform: scale(1.4); opacity: 0.6; }
          100% { transform: scale(0); opacity: 0; }
        }
      `}</style>
    </div>
  );
}
