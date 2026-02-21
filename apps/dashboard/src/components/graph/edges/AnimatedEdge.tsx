// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Synapse Contributors

import { memo, useMemo } from 'react';
import { getSmoothStepPath, type EdgeProps } from '@xyflow/react';
import { formatTokens } from '@synapse-ai/core';
import { useAgentStore } from '../../../store/agentStore';

function AnimatedEdgeComponent({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  data,
  style = {},
}: EdgeProps) {
  const [edgePath, labelX, labelY] = getSmoothStepPath({
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
    borderRadius: 8,
  });

  const edgeData = data as { status?: string; isTaskEdge?: boolean } | undefined;
  const isActive = edgeData?.status === 'running';
  const isTaskEdge = edgeData?.isTaskEdge === true;

  // Look up child agent token usage for Task edges
  const edges = useAgentStore((s) => isTaskEdge ? s.edges : undefined);
  const agents = useAgentStore((s) => isTaskEdge ? s.agents : undefined);

  const { sidechainTokens, sidechainToolCount } = useMemo(() => {
    if (!isTaskEdge || !edges || !agents) return { sidechainTokens: 0, sidechainToolCount: 0 };
    const edge = edges.find((e) => e.id === id);
    const childAgentId = edge?.target?.replace('agent-', '');
    const childAgent = childAgentId ? agents.get(childAgentId) : undefined;
    return {
      sidechainTokens: childAgent
        ? childAgent.tokenUsage.input + childAgent.tokenUsage.output
        : 0,
      sidechainToolCount: childAgent?.toolCalls.length ?? 0,
    };
  }, [isTaskEdge, edges, agents, id]);

  return (
    <>
      <path
        id={id}
        className="react-flow__edge-path"
        d={edgePath}
        style={{
          stroke: isTaskEdge ? '#a78bfa' : isActive ? '#60a5fa' : '#4b5563',
          strokeWidth: isTaskEdge ? 2 : isActive ? 2 : 1.5,
          strokeDasharray: isActive ? '6 3' : 'none',
          animation: isActive ? 'dashFlow 0.5s linear infinite' : 'none',
          fill: 'none',
          ...style,
        }}
      />
      {isTaskEdge && sidechainTokens > 0 && (
        <foreignObject
          x={labelX - 40} y={labelY - 10}
          width={80} height={20}
          className="pointer-events-none"
        >
          <div className="flex items-center justify-center gap-1 bg-purple-900/80 border border-purple-500/30 rounded-full px-2 py-0.5 text-[9px] text-purple-200 whitespace-nowrap">
            <span>{sidechainToolCount} tools</span>
            <span className="text-purple-400">{'\u00b7'}</span>
            <span>{formatTokens(sidechainTokens)}</span>
          </div>
        </foreignObject>
      )}
    </>
  );
}

export const AnimatedEdge = memo(AnimatedEdgeComponent);
