// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Bernhard

import { memo } from 'react';
import { Handle, type NodeProps } from '@xyflow/react';
import type { AssistantResponseData } from '@synapse-ai/core';
import { formatTime } from '@synapse-ai/core';
import { useHandlePositions } from '../../../hooks/useHandlePositions';
import { useAgentStore } from '../../../store/agentStore';

interface AssistantResponseNodeData {
  response: AssistantResponseData;
  index: number;
  total: number;
}

function AssistantResponseNodeComponent({ data, id }: NodeProps) {
  const { response, index, total } = data as unknown as AssistantResponseNodeData;
  const { source, target } = useHandlePositions();
  const selectedNodeId = useAgentStore((s) => s.selectedNodeId);
  const highlightedNodeIds = useAgentStore((s) => s.highlightedNodeIds);
  const isSelected = selectedNodeId === id;
  const isHighlighted = !isSelected && highlightedNodeIds?.has(id ?? '');

  const isFinal = index === total - 1;
  const preview = response.text.length > 120 ? response.text.slice(0, 120) + '...' : response.text;

  return (
    <div
      className={`relative rounded-lg px-3 py-2 min-w-[180px] max-w-[240px] shadow-md border bg-gradient-to-br from-blue-900/50 to-indigo-900/40 ${
        isFinal ? 'border-blue-500/40' : 'border-blue-500/20 border-dashed opacity-80'
      } ${isSelected ? 'node-selected' : isHighlighted ? 'node-highlighted' : ''}`}
    >
      <Handle
        type="target"
        position={target}
        className="!bg-blue-400 !w-2.5 !h-2.5 !border-2 !border-gray-900"
      />

      <div className="flex items-center justify-between mb-1">
        <span className="text-blue-300 text-xs font-semibold">
          Claude{total > 1 ? ` (${index + 1}/${total})` : ''}
        </span>
        <span className="text-[10px] text-gray-400">{formatTime(response.timestamp)}</span>
      </div>
      <p className="text-[11px] text-blue-100/80 leading-relaxed line-clamp-4">{preview}</p>

      <Handle
        type="source"
        position={source}
        className="!bg-blue-400 !w-2.5 !h-2.5 !border-2 !border-gray-900"
      />
    </div>
  );
}

export const AssistantResponseNode = memo(AssistantResponseNodeComponent);
