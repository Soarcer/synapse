// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Synapse Contributors

import { memo } from 'react';
import type { LensTreeNode } from '../LensContext';
import {
  statusIcon,
  formatTokens,
  formatElapsed,
  KIND_ICONS,
  getKindColor,
  getToolIcon,
} from '@synapse-ai/core';
import { useAgentStore } from '../../../store/agentStore';

interface TreeRowProps {
  node: LensTreeNode;
  zoom: number;
  isExpanded: boolean;
  isSelected: boolean;
  isFocused: boolean;
  onToggle: () => void;
  onClick: () => void;
}

function TreeRowComponent({
  node,
  zoom,
  isExpanded,
  isSelected,
  isFocused,
  onToggle,
  onClick,
}: TreeRowProps) {
  const paletteIndex = useAgentStore((s) => s.paletteIndex);
  const hasChildren = node.children.length > 0 || (node.groupCount && node.groupCount > 1);
  const indent = node.depth * 16 * zoom;

  // Kind icon with status overlay for running/error states
  // Tools get specific icons based on tool name
  const kindIcon =
    node.kind === 'tool'
      ? getToolIcon(node.label.split(' ')[0])
      : (KIND_ICONS[node.kind] ?? '\u2022');
  const icon =
    node.status === 'running'
      ? statusIcon.running
      : node.status === 'error'
        ? statusIcon.error
        : kindIcon;

  const kindColor = getKindColor(node.kind, node.label, paletteIndex);

  const h = Math.round(18 * zoom);
  const fontSize = Math.round(11 * zoom);
  const chevronSize = Math.round(18 * zoom);

  return (
    <button
      onClick={onClick}
      className={`
        w-full flex items-center gap-0 pr-2 text-left transition-colors group
        ${isSelected ? 'bg-blue-900/30 text-blue-200' : 'hover:bg-gray-800/50 text-gray-300'}
        ${isFocused ? 'outline outline-1 outline-blue-500/50 -outline-offset-1' : ''}
      `}
      style={{ paddingLeft: indent + 4, height: h, fontSize }}
      data-node-id={node.id}
    >
      {/* Expand/collapse chevron */}
      <span
        className="flex items-center justify-center flex-shrink-0 text-gray-600 hover:text-gray-300"
        style={{ width: 20 * zoom, height: chevronSize, fontSize: chevronSize }}
        onClick={(e) => {
          e.stopPropagation();
          if (hasChildren) onToggle();
        }}
      >
        {hasChildren ? (isExpanded ? '\u25BE' : '\u25B8') : ''}
      </span>

      {/* Kind icon — colored to match waterfall/profile bars */}
      <span
        className="flex-shrink-0"
        style={{
          color: node.status === 'error' ? '#f87171' : kindColor,
          fontSize: Math.round(10 * zoom),
        }}
      >
        {icon}
      </span>

      {/* Label */}
      <span className="truncate flex-1 min-w-0">{node.label}</span>

      {/* Group count badge */}
      {node.groupCount && node.groupCount > 1 && (
        <span className="text-[9px] text-gray-600 flex-shrink-0">x{node.groupCount}</span>
      )}

      {/* Metric (tokens or elapsed) */}
      <span className="text-[10px] text-gray-600 font-mono flex-shrink-0 ml-auto tabular-nums">
        {node.tokens > 0
          ? formatTokens(node.tokens)
          : node.kind !== 'tool'
            ? formatElapsed(node.startTime, node.endTime)
            : ''}
      </span>
    </button>
  );
}

export const TreeRow = memo(TreeRowComponent);
