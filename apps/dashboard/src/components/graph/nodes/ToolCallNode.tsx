// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Synapse Contributors

import { memo, useMemo } from 'react';
import { Handle, type NodeProps } from '@xyflow/react';
import type { ToolCallSummary } from '@synapse-ai/core';
import { formatTime } from '@synapse-ai/core';
import { useHandlePositions } from '../../../hooks/useHandlePositions';
import { useTranscriptDetail, findThinkingForTool } from '../../../hooks/useTranscriptDetail';
import { useAgentStore } from '../../../store/agentStore';
import { CollapsibleSourceHandle } from '../CollapsibleSourceHandle';
import { Tooltip } from '../../ui/Tooltip';

const statusColors: Record<string, string> = {
  running: 'bg-purple-700/80 border-purple-500/50',
  success: 'bg-teal-800/80 border-teal-500/50',
  error: 'bg-red-900/80 border-red-500/50',
};

const statusIcon: Record<string, string> = {
  running: '\u27F3',
  success: '\u2713',
  error: '\u2717',
};

function ToolCallNodeComponent({ data }: NodeProps) {
  const tc = (data as { toolCall: ToolCallSummary }).toolCall;
  const durationMs = tc.duration ?? (tc.endTime != null ? tc.endTime - tc.startTime : null);
  const duration = durationMs != null ? `${(durationMs / 1000).toFixed(1)}s` : null;
  const { target, source, sourceStyle } = useHandlePositions();
  const selectedNodeId = useAgentStore((s) => s.selectedNodeId);
  const highlightedNodeIds = useAgentStore((s) => s.highlightedNodeIds);
  const edges = useAgentStore((s) => s.edges);
  const nodeId = `tool-${tc.toolUseId}`;
  const isSelected = selectedNodeId === nodeId;
  const isHighlighted = !isSelected && highlightedNodeIds?.has(nodeId);
  const hasChildren = useMemo(() => edges.some((e) => e.source === nodeId), [edges, nodeId]);

  // Resolve session for this tool via toolAgentMap → agent → sessionId
  const toolAgentMap = useAgentStore((s) => s.toolAgentMap);
  const agents = useAgentStore((s) => s.agents);
  const agentId = toolAgentMap.get(tc.toolUseId);
  const sessionId = agentId ? agents.get(agentId)?.sessionId : undefined;
  const { reasoning, ensureLoaded } = useTranscriptDetail(sessionId);
  const thinkingExcerpt = findThinkingForTool(reasoning, tc.toolUseId);

  return (
    <div
      onMouseEnter={ensureLoaded}
      className={`
        relative rounded-lg px-3 py-1.5 border text-xs font-medium shadow-sm min-w-[120px]
        ${statusColors[tc.status]}
        ${isSelected ? 'node-selected' : isHighlighted ? 'node-highlighted' : ''}
      `}
    >
      <Handle
        type="target"
        position={target}
        className="!bg-purple-300 !w-2 !h-2 !border !border-gray-800"
      />

      <div className="flex items-center justify-between">
        <span className="text-purple-300/50 text-[8px] font-semibold uppercase tracking-wider">
          Tool
        </span>
        <span className="text-gray-500 text-[7px]">
          {formatTime(tc.startTime)}
          {duration && <span className="ml-1">{duration}</span>}
        </span>
      </div>
      <div className="flex items-center gap-1.5 mt-0.5">
        <Tooltip
          content={
            thinkingExcerpt
              ? `Reasoning: ${thinkingExcerpt}`
              : `${tc.status}${duration ? ` \u00b7 ${duration}` : ''}`
          }
        >
          <span className="text-white truncate">{tc.toolName}</span>
        </Tooltip>
        {thinkingExcerpt && (
          <span className="text-yellow-500/60 text-[8px]" title="Has reasoning context">
            {'\uD83D\uDCAD'}
          </span>
        )}
        <Tooltip content={`${tc.status}${duration ? ` \u00b7 ${duration}` : ''}`}>
          <span className="text-gray-400 text-[10px]">{statusIcon[tc.status]}</span>
        </Tooltip>
      </div>

      {hasChildren && (
        <CollapsibleSourceHandle
          nodeId={nodeId}
          position={source}
          style={sourceStyle}
          baseClassName="!bg-purple-300 !w-2 !h-2 !border !border-gray-800"
        />
      )}
    </div>
  );
}

export const ToolCallNode = memo(ToolCallNodeComponent);
