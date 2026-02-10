import { memo, useMemo } from 'react';
import { Handle, type NodeProps } from '@xyflow/react';
import type { ToolCallSummary } from '../../../types/agent';
import { useHandlePositions } from '../../../hooks/useHandlePositions';
import { useAgentStore } from '../../../store/agentStore';
import { CollapsibleSourceHandle } from '../CollapsibleSourceHandle';

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
  const duration = tc.duration != null ? `${(tc.duration / 1000).toFixed(1)}s` : null;
  const { target, source, sourceStyle } = useHandlePositions();
  const selectedNodeId = useAgentStore((s) => s.selectedNodeId);
  const highlightedNodeIds = useAgentStore((s) => s.highlightedNodeIds);
  const edges = useAgentStore((s) => s.edges);
  const nodeId = `tool-${tc.toolUseId}`;
  const isSelected = selectedNodeId === nodeId;
  const isHighlighted = !isSelected && highlightedNodeIds?.has(nodeId);
  const hasChildren = useMemo(() => edges.some((e) => e.source === nodeId), [edges, nodeId]);

  return (
    <div
      className={`
        rounded-full px-3 py-1.5 border text-xs font-medium shadow-sm
        flex items-center gap-1.5 min-w-[120px]
        ${statusColors[tc.status]}
        ${isSelected ? 'node-selected' : isHighlighted ? 'node-highlighted' : ''}
      `}
    >
      <Handle type="target" position={target} className="!bg-purple-300 !w-2 !h-2 !border !border-gray-800" />

      <span className="text-purple-300/50 text-[9px] font-semibold uppercase tracking-wider">Tool</span>
      <span className="text-gray-200 truncate">{tc.toolName}</span>
      <span className="text-gray-400 text-[10px]">{statusIcon[tc.status]}</span>
      {duration && <span className="text-gray-400 text-[10px] ml-auto">{duration}</span>}

      {hasChildren && (
        <CollapsibleSourceHandle nodeId={nodeId} position={source} style={sourceStyle} baseClassName="!bg-purple-300 !w-2 !h-2 !border !border-gray-800" />
      )}
    </div>
  );
}

export const ToolCallNode = memo(ToolCallNodeComponent);
