// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Bernhard

import { memo, useMemo } from 'react';
import { Handle, type NodeProps } from '@xyflow/react';
import type { UserPromptData, AgentNodeData } from '@synapse-ai/core';
import { formatTokens, formatTime } from '@synapse-ai/core';
import { useHandlePositions } from '../../../hooks/useHandlePositions';
import { useAgentStore } from '../../../store/agentStore';
import { CollapsibleSourceHandle } from '../CollapsibleSourceHandle';
import { extractUserMessage } from '../../../utils/promptText';
import { Tooltip } from '../../ui/Tooltip';

const EMPTY_AGENTS: AgentNodeData[] = [];

function UserPromptNodeComponent({ data }: NodeProps) {
  const prompt = (data as { prompt: UserPromptData }).prompt;
  const userText = extractUserMessage(prompt.text);
  const preview = userText.length > 80 ? userText.slice(0, 80) + '...' : userText;
  const { source, target, sourceStyle } = useHandlePositions();
  const sessionAgents =
    useAgentStore((s) => s.agentsBySession.get(prompt.sessionId)) ?? EMPTY_AGENTS;
  const prompts = useAgentStore((s) => s.prompts);
  const nodeId = `prompt-${prompt.id}`;
  const isSelected = useAgentStore((s) => s.selectedNodeId === nodeId);
  const isHighlighted = useAgentStore(
    (s) => s.selectedNodeId !== nodeId && (s.highlightedNodeIds?.has(nodeId) ?? false),
  );

  const transcripts = useAgentStore((s) => s.transcripts);

  const { inputTokens, outputTokens, agentCount, toolCount } = useMemo(() => {
    const sessionPrompts = prompts.get(prompt.sessionId) ?? [];
    const idx = sessionPrompts.findIndex((p) => p.id === prompt.id);
    const next = sessionPrompts[idx + 1];
    let inp = 0;
    let out = 0;
    let ac = 0;
    let tc = 0;
    for (const a of sessionAgents) {
      if (a.startTime >= prompt.timestamp && (!next || a.startTime < next.timestamp)) {
        inp += a.tokenUsage.input;
        out += a.tokenUsage.output;
        ac++;
        tc += a.toolCalls.length;
      }
    }
    // Fallback to transcript data when agent tokens are 0
    if (inp === 0 && out === 0) {
      const transcript = transcripts.get(prompt.sessionId);
      if (transcript) {
        const assistantTurns = transcript.turns.filter((t) => t.type === 'assistant');
        const windowStart = prompt.timestamp - 2000;
        const windowEnd = next ? next.timestamp : prompt.timestamp + 600_000;
        for (const at of assistantTurns) {
          if (at.timestamp >= windowStart && at.timestamp < windowEnd) {
            inp += at.totalInputTokens;
            out += at.outputTokens;
            if (tc === 0) tc += at.toolUseCount;
          }
        }
      }
    }
    return { inputTokens: inp, outputTokens: out, agentCount: ac, toolCount: tc };
  }, [sessionAgents, prompts, prompt, transcripts]);

  return (
    <div
      className={`relative rounded-lg px-3 py-2 min-w-[200px] max-w-[260px] shadow-md border border-amber-600/40 bg-gradient-to-br from-amber-900/60 to-yellow-900/40 ${isSelected ? 'node-selected' : isHighlighted ? 'node-highlighted' : ''}`}
    >
      <Handle
        type="target"
        position={target}
        className="!bg-amber-400 !w-2.5 !h-2.5 !border-2 !border-gray-900"
      />

      <div className="flex items-center justify-between mb-1">
        <span className="text-amber-300 text-xs font-semibold">Prompt</span>
        <span className="text-[10px] text-gray-400">{formatTime(prompt.timestamp)}</span>
      </div>
      <p className="text-xs text-gray-300 leading-relaxed line-clamp-3">{preview || '(empty)'}</p>

      {/* Compaction indicator */}
      {prompt.compactedAfter && (
        <div className="mt-1.5 pt-1 border-t border-dashed border-red-500/40 flex items-center gap-1">
          <Tooltip content="Context was compacted — earlier messages were summarized">
            <span className="text-red-400 text-[9px] compaction-pulse">{'\u2702'} compacted</span>
          </Tooltip>
        </div>
      )}

      {/* Stats footer */}
      {(inputTokens > 0 || outputTokens > 0 || agentCount > 0 || toolCount > 0) && (
        <div className="flex items-center justify-between mt-1.5">
          {inputTokens > 0 || outputTokens > 0 ? (
            <span className="text-[10px] font-mono">
              <Tooltip content="Input tokens">
                <span className="text-cyan-400/60">
                  {formatTokens(inputTokens)}
                  {'\u2193'}
                </span>
              </Tooltip>{' '}
              <Tooltip content="Output tokens">
                <span className="text-orange-400/60">
                  {formatTokens(outputTokens)}
                  {'\u2191'}
                </span>
              </Tooltip>
            </span>
          ) : (
            <span />
          )}
          <div className="flex items-center gap-1">
            {agentCount > 0 && (
              <Tooltip content="Agents spawned from this prompt">
                <span className="px-1.5 py-0.5 rounded-full text-[10px] bg-green-600/20 text-green-400">
                  {agentCount} agent{agentCount !== 1 ? 's' : ''}
                </span>
              </Tooltip>
            )}
            {toolCount > 0 && (
              <Tooltip content="Total tool calls">
                <span className="px-1.5 py-0.5 rounded-full text-[10px] bg-purple-600/20 text-purple-400">
                  {toolCount} tool{toolCount !== 1 ? 's' : ''}
                </span>
              </Tooltip>
            )}
          </div>
        </div>
      )}

      <CollapsibleSourceHandle
        nodeId={nodeId}
        position={source}
        style={sourceStyle}
        baseClassName="!bg-amber-400 !w-2.5 !h-2.5 !border-2 !border-gray-900"
      />
    </div>
  );
}

export const UserPromptNode = memo(UserPromptNodeComponent);
