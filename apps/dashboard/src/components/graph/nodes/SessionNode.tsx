// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Bernhard

import { memo, useMemo } from 'react';
import { type NodeProps } from '@xyflow/react';
import type { SessionData, AgentNodeData } from '@synapse-ai/core';
import {
  formatTokens,
  formatRelativeTime,
  formatTime,
  getVendorColor,
  formatModelName,
} from '@synapse-ai/core';
import { useHandlePositions } from '../../../hooks/useHandlePositions';
import { useAgentStore } from '../../../store/agentStore';
import { CollapsibleSourceHandle } from '../CollapsibleSourceHandle';
import { Tooltip } from '../../ui/Tooltip';

const EMPTY_AGENTS: AgentNodeData[] = [];

function SessionNodeComponent({ data }: NodeProps) {
  const session = (data as { session: SessionData }).session;
  const shortId = session.sessionId.slice(0, 8);
  const isEnded = session.status === 'ended';
  const { source, sourceStyle } = useHandlePositions();
  const sessionAgents =
    useAgentStore((s) => s.agentsBySession.get(session.sessionId)) ?? EMPTY_AGENTS;
  const allPrompts = useAgentStore((s) => s.prompts);
  const selectedNodeId = useAgentStore((s) => s.selectedNodeId);
  const highlightedNodeIds = useAgentStore((s) => s.highlightedNodeIds);
  const nodeId = `session-${session.sessionId}`;
  const isSelected = selectedNodeId === nodeId;
  const isHighlighted = !isSelected && highlightedNodeIds?.has(nodeId);

  const transcripts = useAgentStore((s) => s.transcripts);

  const { inputTokens, outputTokens, toolCount } = useMemo(() => {
    let input = 0;
    let output = 0;
    let tc = 0;
    for (const a of sessionAgents) {
      input += a.tokenUsage.input;
      output += a.tokenUsage.output;
      tc += a.toolCalls.length;
    }
    // Fallback to transcript data when agent tokens are 0
    if (input === 0 && output === 0) {
      const t = transcripts.get(session.sessionId);
      if (t) {
        input = t.totalInputTokens;
        output = t.totalOutputTokens;
        if (tc === 0) tc = t.totalToolCalls;
      }
    }
    return { inputTokens: input, outputTokens: output, toolCount: tc };
  }, [sessionAgents, session.sessionId, transcripts]);

  // Sparkline: cumulative input tokens per turn
  const sparkData = useMemo(() => {
    const sessionPrompts = allPrompts.get(session.sessionId);
    if (!sessionPrompts || sessionPrompts.length < 2) return null;

    const sorted = [...sessionPrompts].sort((a, b) => a.timestamp - b.timestamp);
    const points: number[] = [];
    let cum = 0;

    // Try agent-based sparkline first
    for (let i = 0; i < sorted.length; i++) {
      const prompt = sorted[i];
      const next = sorted[i + 1];
      let turnInput = 0;
      for (const a of sessionAgents) {
        if (a.startTime >= prompt.timestamp && (!next || a.startTime < next.timestamp)) {
          turnInput += a.tokenUsage.input;
        }
      }
      cum += turnInput;
      points.push(cum);
    }

    if (cum > 0) return points;

    // Fallback: use transcript assistant turns matched to prompt windows
    const transcript = transcripts.get(session.sessionId);
    if (!transcript || transcript.turns.length === 0) return null;

    const assistantTurns = transcript.turns.filter((t) => t.type === 'assistant');
    if (assistantTurns.length === 0) return null;

    const txPoints: number[] = [];
    let txCum = 0;
    for (let i = 0; i < sorted.length; i++) {
      const prompt = sorted[i];
      const next = sorted[i + 1];
      const windowStart = prompt.timestamp - 2000;
      const windowEnd = next ? next.timestamp : prompt.timestamp + 600_000;
      let turnInput = 0;
      for (const at of assistantTurns) {
        if (at.timestamp >= windowStart && at.timestamp < windowEnd) {
          turnInput += at.totalInputTokens;
        }
      }
      txCum += turnInput;
      txPoints.push(txCum);
    }

    if (txCum === 0) return null;
    return txPoints;
  }, [allPrompts, sessionAgents, session.sessionId, transcripts]);

  return (
    <div
      className={`
        relative rounded-xl px-4 py-3 min-w-[200px] shadow-lg border
        ${isEnded ? 'border-gray-600 bg-gradient-to-br from-gray-800 to-gray-900' : 'border-blue-500/50 bg-gradient-to-br from-blue-900/80 to-indigo-900/80'}
        ${isSelected ? 'node-selected' : isHighlighted ? 'node-highlighted' : ''}
      `}
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <span className="text-blue-300/60 text-[10px] font-semibold uppercase tracking-wider">
            Session
          </span>
          {session.vendor && (
            <span
              className="px-1.5 py-0.5 rounded text-[9px] font-semibold uppercase leading-none"
              style={{
                backgroundColor: getVendorColor(session.vendor) + '25',
                color: getVendorColor(session.vendor),
              }}
            >
              {session.vendor}
            </span>
          )}
          {session.model && (
            <Tooltip content={session.model}>
              <span className="px-1.5 py-0.5 rounded text-[9px] font-medium leading-none bg-gray-700/60 text-gray-300">
                {formatModelName(session.model)}
              </span>
            </Tooltip>
          )}
        </div>
        <span className="text-[10px] text-gray-400">
          {formatTime(session.startTime)}{' '}
          <span className="text-gray-600">{formatRelativeTime(session.startTime)}</span>
        </span>
      </div>
      <div className="flex items-center gap-2 mt-0.5">
        <Tooltip content={isEnded ? 'Session ended' : 'Session active'}>
          <div
            className={`w-2.5 h-2.5 rounded-full shrink-0 ${isEnded ? 'bg-gray-500' : 'bg-blue-400 animate-pulse'}`}
          />
        </Tooltip>
        <div className="flex flex-col min-w-0">
          <span className="text-sm font-semibold text-gray-100 truncate max-w-[180px]">
            {session.title ?? shortId}
          </span>
          <div className="flex items-center gap-1.5">
            {session.gitBranch && (
              <span className="text-[9px] px-1.5 rounded bg-indigo-900/50 text-indigo-300 truncate max-w-[120px]">
                {session.gitBranch}
              </span>
            )}
            {session.source === 'resume' && (
              <span className="text-[9px] px-1 rounded bg-amber-900/40 text-amber-300">
                resumed
              </span>
            )}
            {session.title && <span className="text-[9px] text-gray-600 font-mono">{shortId}</span>}
          </div>
        </div>
      </div>

      {/* Stats footer */}
      <div className="flex items-center justify-between mt-1.5">
        <div className="flex items-center gap-2">
          {(inputTokens > 0 || outputTokens > 0) && (
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
          )}
          {sparkData && (
            <svg width={60} height={16} className="inline-block align-middle">
              <polyline
                points={sparkData
                  .map((v, i) => {
                    const x = (i / (sparkData.length - 1)) * 56 + 2;
                    const y = 14 - (v / sparkData[sparkData.length - 1]) * 12;
                    return `${x},${y}`;
                  })
                  .join(' ')}
                fill="none"
                stroke="#22c55e"
                strokeWidth={1.5}
                strokeLinejoin="round"
                opacity={0.6}
              />
            </svg>
          )}
        </div>
        <div className="flex items-center gap-1">
          {session.agentCount > 0 && (
            <Tooltip content="Agents in this session">
              <span className="px-1.5 py-0.5 rounded-full text-[10px] bg-green-600/20 text-green-400">
                {session.agentCount} agent{session.agentCount !== 1 ? 's' : ''}
              </span>
            </Tooltip>
          )}
          {toolCount > 0 && (
            <Tooltip content="Tool calls in this session">
              <span className="px-1.5 py-0.5 rounded-full text-[10px] bg-purple-600/20 text-purple-400">
                {toolCount} tool{toolCount !== 1 ? 's' : ''}
              </span>
            </Tooltip>
          )}
          {session.topTools && session.topTools.length > 0 && (
            <div className="flex items-center gap-0.5 ml-1">
              {session.topTools.map((t) => (
                <span
                  key={t}
                  className="px-1 py-0.5 rounded text-[8px] bg-gray-700/50 text-gray-400"
                >
                  {t}
                </span>
              ))}
            </div>
          )}
        </div>
      </div>

      <CollapsibleSourceHandle
        nodeId={nodeId}
        position={source}
        style={sourceStyle}
        baseClassName="!bg-blue-400 !w-3 !h-3 !border-2 !border-blue-900"
        id="structural"
      />
    </div>
  );
}

export const SessionNode = memo(SessionNodeComponent);
