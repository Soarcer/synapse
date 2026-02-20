import { memo, useMemo } from 'react';
import { Handle, type NodeProps } from '@xyflow/react';
import type { AgentNodeData } from '@synapse-ai/core';
import { formatTokens, formatElapsed, formatTime, statusIcon, statusBorderColor, getVendorColor } from '@synapse-ai/core';
import { useHandlePositions } from '../../../hooks/useHandlePositions';
import { useAgentStore } from '../../../store/agentStore';
import { CollapsibleSourceHandle } from '../CollapsibleSourceHandle';
import { Tooltip } from '../../ui/Tooltip';

const EMPTY_AGENTS: AgentNodeData[] = [];

function AgentNodeComponent({ data }: NodeProps) {
  const agent = (data as { agent: AgentNodeData }).agent;
  const isRunning = agent.status === 'running';
  const preview = agent.streamingText
    ? agent.streamingText.slice(-50).replace(/\n/g, ' ')
    : null;
  const { source, target, sourceStyle } = useHandlePositions();
  const children = useAgentStore((s) => s.childAgents.get(agent.agentId)) ?? EMPTY_AGENTS;
  const selectedNodeId = useAgentStore((s) => s.selectedNodeId);
  const highlightedNodeIds = useAgentStore((s) => s.highlightedNodeIds);
  const nodeId = `agent-${agent.agentId}`;
  const isSelected = selectedNodeId === nodeId;
  const isHighlighted = !isSelected && highlightedNodeIds?.has(nodeId);
  // Tools are expanded when this agent (or one of its tools) is selected
  const toolsExpanded = isSelected ||
    agent.toolCalls.some((tc) => selectedNodeId === `tool-${tc.toolUseId}`);

  const { inputTokens, outputTokens } = useMemo(() => {
    let input = agent.tokenUsage.input;
    let output = agent.tokenUsage.output;
    for (const a of children) {
      input += a.tokenUsage.input;
      output += a.tokenUsage.output;
    }
    return { inputTokens: input, outputTokens: output };
  }, [children, agent.tokenUsage]);

  // Vendor color overrides the status border-left color when present
  const vendorBorderStyle = agent.vendor
    ? { borderLeftColor: getVendorColor(agent.vendor) }
    : undefined;

  return (
    <div
      className={`
        relative rounded-lg border-l-4 border border-gray-700 bg-gray-800/90 shadow-md min-w-[180px]
        ${statusBorderColor[agent.status]}
        ${isRunning ? 'ring-1 ring-green-400/30' : ''}
        ${isSelected ? 'node-selected' : isHighlighted ? 'node-highlighted' : ''}
      `}
      style={vendorBorderStyle}
    >
      <Handle type="target" position={target} className="!bg-gray-400 !w-2.5 !h-2.5 !border-2 !border-gray-800" />

      <div className="px-3 py-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5">
            <span className="text-green-400/60 text-[10px] font-semibold uppercase tracking-wider">Agent</span>
            {agent.parentAgentId && (
              <span className="bg-purple-900/50 text-purple-300 text-[9px] px-1.5 rounded">Task</span>
            )}
          </div>
          <span className="text-[10px] text-gray-400">
            {formatTime(agent.startTime)}
            {agent.endTime && <span className="text-gray-600"> → {formatTime(agent.endTime)}</span>}
          </span>
        </div>
        {/* Header */}
        <div className="flex items-center justify-between gap-2 mt-0.5">
          <div className="flex flex-col min-w-0">
            <span className="text-sm font-semibold text-gray-100 truncate">
              {agent.agentType}
            </span>
            <span className="text-[10px] text-gray-500 leading-tight">
              {formatElapsed(agent.startTime, agent.endTime)}
            </span>
          </div>
          <Tooltip content={`Agent status: ${agent.status}`}>
            <span
              className={`text-xs font-bold shrink-0 ${
                agent.status === 'running'
                  ? 'text-green-400'
                  : agent.status === 'error'
                    ? 'text-red-400'
                    : 'text-gray-400'
              }`}
            >
              {statusIcon[agent.status]}
            </span>
          </Tooltip>
        </div>

        {/* Info row */}
        <div className="flex items-center justify-end mt-1.5 text-xs text-gray-400">
          <div className="flex items-center gap-1.5">
            {(inputTokens > 0 || outputTokens > 0) && (
              <span className="text-[10px] font-mono">
                <Tooltip content="Input tokens">
                  <span className="text-cyan-400/60">{formatTokens(inputTokens)}{'\u2193'}</span>
                </Tooltip>
                {' '}
                <Tooltip content="Output tokens">
                  <span className="text-orange-400/60">{formatTokens(outputTokens)}{'\u2191'}</span>
                </Tooltip>
              </span>
            )}
            {agent.toolCalls.length > 0 && (
              <Tooltip content="Tool calls by this agent">
                <span className={`px-1.5 py-0.5 rounded-full text-[10px] ${
                  toolsExpanded
                    ? 'bg-purple-600/40 text-purple-200'
                    : 'bg-purple-600/20 text-purple-400'
                }`}>
                  {toolsExpanded ? '\u25BE' : '\u25B8'} {agent.toolCalls.length} tool{agent.toolCalls.length !== 1 ? 's' : ''}
                </span>
              </Tooltip>
            )}
          </div>
        </div>

        {/* Streaming preview */}
        {preview && (
          <div className="mt-1.5 text-[10px] text-gray-500 font-mono truncate leading-tight">
            {preview}
          </div>
        )}
      </div>

      {/* Progress bar */}
      {isRunning && (
        <div className="h-0.5 bg-gray-700 rounded-b-lg overflow-hidden">
          <div className="h-full bg-green-400/60 animate-indeterminate" />
        </div>
      )}

      <CollapsibleSourceHandle nodeId={nodeId} position={source} style={sourceStyle} baseClassName="!bg-gray-400 !w-2.5 !h-2.5 !border-2 !border-gray-800" />
    </div>
  );
}

export const AgentNode = memo(AgentNodeComponent);
