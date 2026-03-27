// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Bernhard

import { memo, useCallback, useMemo } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import type {
  UserPromptData,
  AgentNodeData,
  AssistantResponseData,
  PromptTurnGroup,
} from '@synapse-ai/core';
import { formatTokens, formatTime, formatModelName } from '@synapse-ai/core';
import { useHandlePositions } from '../../../hooks/useHandlePositions';
import { useAgentStore } from '../../../store/agentStore';
import { usePromptTurnsContext } from '../../../hooks/usePromptTurns';
import { CollapsibleSourceHandle } from '../CollapsibleSourceHandle';
import { extractUserMessage } from '../../../utils/promptText';
import { Tooltip } from '../../ui/Tooltip';

const EMPTY_AGENTS: AgentNodeData[] = [];
const EMPTY_RESPONSES: AssistantResponseData[] = [];

function UserPromptNodeComponent({ data }: NodeProps) {
  const prompt = (data as { prompt: UserPromptData }).prompt;
  const userText = extractUserMessage(prompt.text);
  const preview = userText.length > 80 ? userText.slice(0, 80) + '...' : userText;
  const { source, target, sourceStyle } = useHandlePositions();
  const sessionAgents =
    useAgentStore((s) => s.agentsBySession.get(prompt.sessionId)) ?? EMPTY_AGENTS;
  const prompts = useAgentStore((s) => s.prompts);
  const selectedNodeId = useAgentStore((s) => s.selectedNodeId);
  const highlightedNodeIds = useAgentStore((s) => s.highlightedNodeIds);
  const nodeId = `prompt-${prompt.id}`;
  const isSelected = selectedNodeId === nodeId;
  const isHighlighted = !isSelected && highlightedNodeIds?.has(nodeId);

  const transcripts = useAgentStore((s) => s.transcripts);
  const sessionModel = useAgentStore((s) => s.sessions.get(prompt.sessionId))?.model;

  // Response data for conversation threading
  const allResponses = useAgentStore((s) => s.responses.get(prompt.sessionId)) ?? EMPTY_RESPONSES;
  const responses = useMemo(
    () => allResponses.filter((r) => r.promptId === prompt.id),
    [allResponses, prompt.id],
  );
  const lastResponse = responses.length > 0 ? responses[responses.length - 1] : null;

  // Transcript-derived response data (richer than hook-based)
  const promptTurnGroupMap = usePromptTurnsContext();
  const promptTurnGroups = promptTurnGroupMap.get(prompt.sessionId);
  const transcriptGroup = useMemo((): PromptTurnGroup | null => {
    if (!promptTurnGroups?.length || !prompt.text) return null;

    // Primary match: timestamp within ±5 seconds
    const candidates = promptTurnGroups.filter(
      (g) => Math.abs(g.promptTimestamp - prompt.timestamp) < 5000,
    );

    if (candidates.length === 1) return candidates[0];

    // Tiebreaker: text prefix confirmation
    const promptPrefix = prompt.text.slice(0, 80).toLowerCase();
    if (candidates.length > 1) {
      return (
        candidates.find(
          (g) =>
            g.promptText.toLowerCase().startsWith(promptPrefix) ||
            promptPrefix.startsWith(g.promptText.slice(0, 80).toLowerCase()),
        ) ?? candidates[0]
      );
    }

    // Fallback: text-only match (timestamps may differ due to clock skew)
    return (
      promptTurnGroups.find(
        (g) =>
          g.promptText.toLowerCase().startsWith(promptPrefix) ||
          promptPrefix.startsWith(g.promptText.slice(0, 80).toLowerCase()),
      ) ?? null
    );
  }, [promptTurnGroups, prompt.text, prompt.timestamp]);

  // Merge: prefer transcript data, fall back to hook-derived responses
  const displayResponseText = transcriptGroup?.responseText ?? responses[0]?.text ?? null;
  const displayResponseCount = Math.max(transcriptGroup?.turns.length ?? 0, responses.length);
  const isExpanded = useAgentStore((s) => s.expandedTurns.has(nodeId));
  const toggleTurnExpanded = useAgentStore((s) => s.toggleTurnExpanded);
  const selectNode = useAgentStore((s) => s.selectNode);
  const handleToggleExpand = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      toggleTurnExpanded(nodeId);
    },
    [toggleTurnExpanded, nodeId],
  );

  // Expand turn + zoom to response node
  const handleResponseClick = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      if (lastResponse) {
        // Ensure the turn is expanded so the response node gets created
        if (!isExpanded) {
          toggleTurnExpanded(nodeId);
        }
        // Delay zoom to let the graph create the response node
        setTimeout(() => {
          selectNode(`response-${lastResponse.id}`, 'lens');
        }, 150);
      } else {
        toggleTurnExpanded(nodeId);
      }
    },
    [lastResponse, isExpanded, selectNode, toggleTurnExpanded, nodeId],
  );

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
      className={`relative rounded-lg px-3 py-2 w-[260px] shadow-md border border-amber-600/40 bg-gradient-to-br from-amber-900/60 to-yellow-900/40 ${isSelected ? 'node-selected' : isHighlighted ? 'node-highlighted' : ''}`}
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

      {/* Assistant response section — always visible, chevron toggles expand/collapse */}
      {displayResponseText && (
        <Tooltip
          content={
            lastResponse
              ? 'Click to zoom to response'
              : isExpanded
                ? 'Click to collapse'
                : 'Click to expand response chain'
          }
        >
          <div
            className={`relative mt-1.5 pt-1.5 border-t border-blue-500/30 -mx-3 -mb-2 px-3 pb-2 rounded-b-lg cursor-pointer hover:brightness-125 transition-[filter] ${
              isExpanded ? 'bg-blue-900/30' : 'bg-blue-900/20'
            }`}
            onClick={handleResponseClick}
          >
            <span className="absolute right-2 top-1/2 -translate-y-1/2 text-blue-300/50 text-[11px] font-bold pointer-events-none">
              {isExpanded ? '\u25BE' : '>'}
            </span>
            <div className="flex items-center gap-1 mb-0.5">
              <span className="text-blue-400 text-[10px] font-semibold">
                {formatModelName(sessionModel) ?? 'Claude'}
              </span>
              <span className="text-gray-500 text-[10px]">{isExpanded ? '\u25BE' : '\u25B8'}</span>
              {displayResponseCount > 1 && (
                <span className="text-gray-500 text-[10px] ml-auto">
                  {displayResponseCount} responses
                </span>
              )}
            </div>
            <p className="text-[11px] text-blue-200/70 leading-snug line-clamp-2">
              {displayResponseText.length > 160
                ? displayResponseText.slice(0, 160) + '...'
                : displayResponseText}
            </p>
          </div>
        </Tooltip>
      )}

      <CollapsibleSourceHandle
        nodeId={nodeId}
        position={source}
        style={sourceStyle}
        baseClassName="!bg-amber-400 !w-2.5 !h-2.5 !border-2 !border-gray-900"
      />

      {/* Thread handles: bottom (source) → top (target) for conversation chaining */}
      <Handle
        type="source"
        position={Position.Bottom}
        id="thread-out"
        className="!bg-blue-500/40 !w-1.5 !h-1.5 !border-0"
      />
      <Handle
        type="target"
        position={Position.Top}
        id="thread-in"
        className="!bg-blue-500/40 !w-1.5 !h-1.5 !border-0"
      />
    </div>
  );
}

export const UserPromptNode = memo(UserPromptNodeComponent);
