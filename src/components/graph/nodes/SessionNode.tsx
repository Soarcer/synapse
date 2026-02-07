import { memo, useMemo } from 'react';
import { Handle, type NodeProps } from '@xyflow/react';
import type { SessionData } from '../../../types/agent';
import { useHandlePositions } from '../../../hooks/useHandlePositions';
import { useAgentStore } from '../../../store/agentStore';
import { formatTokens, formatRelativeTime } from '../../../utils/format';

function SessionNodeComponent({ data }: NodeProps) {
  const session = (data as { session: SessionData }).session;
  const shortId = session.sessionId.slice(0, 8);
  const isEnded = session.status === 'ended';
  const { source, sourceStyle } = useHandlePositions();
  const agents = useAgentStore((s) => s.agents);
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
    for (const a of agents.values()) {
      if (a.sessionId === session.sessionId) {
        input += a.tokenUsage.input;
        output += a.tokenUsage.output;
        tc += a.toolCalls.length;
      }
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
  }, [agents, session.sessionId, transcripts]);

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
      for (const a of agents.values()) {
        if (
          a.sessionId === session.sessionId &&
          a.startTime >= prompt.timestamp &&
          (!next || a.startTime < next.timestamp)
        ) {
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
  }, [allPrompts, agents, session.sessionId, transcripts]);

  return (
    <div
      className={`
        relative rounded-xl px-4 py-3 min-w-[200px] shadow-lg border
        ${isEnded ? 'border-gray-600 bg-gradient-to-br from-gray-800 to-gray-900' : 'border-blue-500/50 bg-gradient-to-br from-blue-900/80 to-indigo-900/80'}
        ${isSelected ? 'node-selected' : isHighlighted ? 'node-highlighted' : ''}
      `}
    >
      <span className="text-blue-300/60 text-[10px] font-semibold uppercase tracking-wider">Session</span>
      <div className="flex items-center gap-2 mt-0.5">
        <div
          className={`w-2.5 h-2.5 rounded-full ${isEnded ? 'bg-gray-500' : 'bg-blue-400 animate-pulse'}`}
        />
        <span className="text-sm font-semibold text-gray-100 font-mono">{shortId}</span>
        <span className="text-xs text-gray-400 ml-auto">{formatRelativeTime(session.startTime)}</span>
      </div>

      {/* Stats footer */}
      <div className="flex items-center justify-between mt-1.5">
        <div className="flex items-center gap-2">
          {(inputTokens > 0 || outputTokens > 0) && (
            <span className="text-[10px] font-mono">
              <span className="text-cyan-400/60">{formatTokens(inputTokens)}{'\u2193'}</span>
              {' '}
              <span className="text-orange-400/60">{formatTokens(outputTokens)}{'\u2191'}</span>
            </span>
          )}
          {sparkData && (
            <svg width={60} height={16} className="inline-block align-middle">
              <polyline
                points={sparkData.map((v, i) => {
                  const x = (i / (sparkData.length - 1)) * 56 + 2;
                  const y = 14 - (v / sparkData[sparkData.length - 1]) * 12;
                  return `${x},${y}`;
                }).join(' ')}
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
            <span className="px-1.5 py-0.5 rounded-full text-[10px] bg-green-600/20 text-green-400">
              {session.agentCount} agent{session.agentCount !== 1 ? 's' : ''}
            </span>
          )}
          {toolCount > 0 && (
            <span className="px-1.5 py-0.5 rounded-full text-[10px] bg-purple-600/20 text-purple-400">
              {toolCount} tool{toolCount !== 1 ? 's' : ''}
            </span>
          )}
        </div>
      </div>

      <Handle type="source" position={source} style={sourceStyle} className="!bg-blue-400 !w-3 !h-3 !border-2 !border-blue-900" />
    </div>
  );
}

export const SessionNode = memo(SessionNodeComponent);
