// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Bernhard

import { memo, useMemo } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import type { UserPromptData, AgentNodeData, AssistantResponseData } from '@synapse-ai/core';
import { formatTokens, formatTime, formatModelName } from '@synapse-ai/core';
import { useAgentStore } from '../../../store/agentStore';
import { Tooltip } from '../../ui/Tooltip';

const EMPTY_PROMPTS: UserPromptData[] = [];
const EMPTY_AGENTS: AgentNodeData[] = [];
const EMPTY_RESPONSES: AssistantResponseData[] = [];

interface AssistantResponseNodeData {
  response: AssistantResponseData;
  index: number;
  total: number;
}

function AssistantResponseNodeComponent({ data, id }: NodeProps) {
  const { response, index, total } = data as unknown as AssistantResponseNodeData;
  // Shelf node: hardcode Left target, Right source (not from useHandlePositions)
  const target = Position.Left;
  const source = Position.Right;
  const selectedNodeId = useAgentStore((s) => s.selectedNodeId);
  const highlightedNodeIds = useAgentStore((s) => s.highlightedNodeIds);
  const isSelected = selectedNodeId === id;
  const isHighlighted = !isSelected && highlightedNodeIds?.has(id ?? '');

  const isFinal = index === total - 1;
  const preview = response.text.length > 120 ? response.text.slice(0, 120) + '...' : response.text;

  // Session-scoped store subscriptions (avoid re-renders from unrelated sessions)
  const sessionPrompts = useAgentStore((s) => s.prompts.get(response.sessionId)) ?? EMPTY_PROMPTS;
  const sessionAgents =
    useAgentStore((s) => s.agentsBySession.get(response.sessionId)) ?? EMPTY_AGENTS;
  const transcript = useAgentStore((s) => s.transcripts.get(response.sessionId));
  const sessionModel = useAgentStore((s) => s.sessions.get(response.sessionId))?.model;
  const responseModel = response.model ?? sessionModel;

  // Sibling responses for per-response tool windowing
  const allSessionResponses =
    useAgentStore((s) => s.responses.get(response.sessionId)) ?? EMPTY_RESPONSES;
  const siblings = useMemo(
    () =>
      allSessionResponses
        .filter((r) => r.promptId === response.promptId)
        .sort((a, b) => a.timestamp - b.timestamp),
    [allSessionResponses, response.promptId],
  );

  const metrics = useMemo(() => {
    // Latency: response timestamp - prompt timestamp
    const prompt = sessionPrompts.find((p) => p.id === response.promptId);
    const latencyMs = prompt ? response.timestamp - prompt.timestamp : 0;

    // Output tokens from nearest transcript turn (within 30s window)
    const assistantTurns = transcript?.turns.filter((t) => t.type === 'assistant') ?? [];
    const nearestTurn = assistantTurns
      .filter((t) => Math.abs(t.timestamp - response.timestamp) < 30_000)
      .sort(
        (a, b) =>
          Math.abs(a.timestamp - response.timestamp) - Math.abs(b.timestamp - response.timestamp),
      )[0];
    const outputTokens = nearestTurn?.outputTokens ?? 0;

    // Tool count: per-response timestamp-window attribution
    // Window: [this response timestamp, next sibling timestamp)
    const siblingIdx = siblings.findIndex((s) => s.id === response.id);
    const windowStart = response.timestamp;
    const windowEnd = siblings[siblingIdx + 1]?.timestamp ?? Infinity;
    let toolCount = 0;
    if (prompt) {
      const promptWindowEnd =
        sessionPrompts.find((p) => p.timestamp > prompt.timestamp)?.timestamp ?? Infinity;
      for (const agent of sessionAgents) {
        if (agent.startTime >= prompt.timestamp && agent.startTime < promptWindowEnd) {
          for (const tc of agent.toolCalls) {
            // Fallback to agent start time if tool timestamp is missing (0)
            const tcTime = tc.startTime || agent.startTime;
            if (tcTime >= windowStart && tcTime < windowEnd) {
              toolCount++;
            }
          }
        }
      }
    }

    return { outputTokens, latencyMs, toolCount };
  }, [response, sessionPrompts, transcript, sessionAgents, siblings]);

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
        <div className="flex items-center gap-1.5">
          <span className="text-blue-300 text-xs font-semibold">
            Claude{total > 1 ? ` (${index + 1}/${total})` : ''}
          </span>
          {responseModel && (
            <span className="text-[9px] text-gray-400 font-medium">
              {formatModelName(responseModel)}
            </span>
          )}
        </div>
        <span className="text-[10px] text-gray-400">{formatTime(response.timestamp)}</span>
      </div>
      <p className="text-[11px] text-blue-100/80 leading-relaxed line-clamp-4">{preview}</p>

      {/* Stats footer */}
      {(metrics.outputTokens > 0 || metrics.latencyMs > 0 || metrics.toolCount > 0) && (
        <div className="flex items-center justify-between mt-1.5 pt-1 border-t border-blue-500/20">
          <div className="flex items-center gap-2">
            {metrics.outputTokens > 0 && (
              <Tooltip content="Output tokens">
                <span className="text-[10px] font-mono text-orange-400/60">
                  {formatTokens(metrics.outputTokens)}
                  {'\u2191'}
                </span>
              </Tooltip>
            )}
            {metrics.latencyMs > 0 && (
              <Tooltip content="Time since prompt">
                <span className="text-[10px] text-gray-400">
                  +
                  {metrics.latencyMs < 1000
                    ? `${Math.round(metrics.latencyMs)}ms`
                    : `${(metrics.latencyMs / 1000).toFixed(1)}s`}
                </span>
              </Tooltip>
            )}
          </div>
          {metrics.toolCount > 0 && (
            <Tooltip content="Tools triggered after this response">
              <span className="px-1.5 py-0.5 rounded-full text-[10px] bg-purple-600/20 text-purple-400">
                {'\u25B8'} {metrics.toolCount} tool{metrics.toolCount !== 1 ? 's' : ''}
              </span>
            </Tooltip>
          )}
        </div>
      )}

      <Handle
        type="source"
        position={source}
        className="!bg-blue-400 !w-2.5 !h-2.5 !border-2 !border-gray-900"
      />
    </div>
  );
}

export const AssistantResponseNode = memo(AssistantResponseNodeComponent);
