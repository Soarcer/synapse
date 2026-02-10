import { useState, useRef, useEffect, useCallback } from 'react';
import { useAgentStore } from '../../store/agentStore';
import { ConfirmDialog } from '../ConfirmDialog';
import type { ToolCallSummary } from '../../types/agent';
import { formatTime, formatDuration } from '../../utils/format';
import { apiUrl } from '../../utils/api';
import { toast } from '../Toast';
import { ToolRenderer, ToolSummaryLine } from './ToolDetailRenderers';

export function AgentDetailPanel() {
  const selectedNodeId = useAgentStore((s) => s.selectedNodeId);
  const agents = useAgentStore((s) => s.agents);
  const sessions = useAgentStore((s) => s.sessions);
  const prompts = useAgentStore((s) => s.prompts);
  const toolCalls = useAgentStore((s) => s.toolCalls);
  const events = useAgentStore((s) => s.events);
  const selectNode = useAgentStore((s) => s.selectNode);
  const removeNode = useAgentStore((s) => s.removeNode);
  const [message, setMessage] = useState('');
  const [sending, setSending] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState<{ nodeId: string; label: string } | null>(null);
  const [confirmStop, setConfirmStop] = useState<string | null>(null);
  const textRef = useRef<HTMLPreElement>(null);

  // Determine what's selected
  const agentId = selectedNodeId?.startsWith('agent-')
    ? selectedNodeId.slice(6)
    : null;
  const sessionId = selectedNodeId?.startsWith('session-')
    ? selectedNodeId.slice(8)
    : null;
  const promptId = selectedNodeId?.startsWith('prompt-')
    ? selectedNodeId.slice(7)
    : null;
  const toolNodeId = selectedNodeId?.startsWith('tool-')
    ? selectedNodeId.slice(5)
    : null;

  const agent = agentId ? agents.get(agentId) : null;
  const session = sessionId ? sessions.get(sessionId) : null;

  // Auto-scroll streaming text
  useEffect(() => {
    if (textRef.current) {
      textRef.current.scrollTop = textRef.current.scrollHeight;
    }
  }, [agent?.streamingText]);

  const handleSendMessage = useCallback(async () => {
    if (!agentId || !message.trim()) return;
    setSending(true);
    try {
      const res = await fetch(apiUrl(`/api/agents/${agentId}/message`), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: message.trim() }),
      });
      if (!res.ok) throw new Error(`${res.status}`);
      setMessage('');
    } catch {
      toast('Failed to send message', 'error');
    } finally {
      setSending(false);
    }
  }, [agentId, message]);

  const handleStopAgent = useCallback(async (id?: string) => {
    const targetId = id ?? agentId;
    if (!targetId) return;
    try {
      const res = await fetch(apiUrl(`/api/agents/${targetId}`), { method: 'DELETE' });
      if (!res.ok) throw new Error(`${res.status}`);
    } catch {
      toast('Failed to stop agent', 'error');
    }
  }, [agentId]);

  if (!selectedNodeId || selectedNodeId === '__spawn__') {
    return null;
  }

  const dialogs = (
    <>
      <ConfirmDialog
        open={confirmRemove !== null}
        title="Remove Node"
        message="Remove this node and all its children?"
        confirmLabel="Remove"
        onConfirm={() => { if (confirmRemove) removeNode(confirmRemove.nodeId); setConfirmRemove(null); }}
        onCancel={() => setConfirmRemove(null)}
      />
      <ConfirmDialog
        open={confirmStop !== null}
        title="Stop Agent"
        message="Stop this running agent?"
        confirmLabel="Stop"
        onConfirm={() => { if (confirmStop) handleStopAgent(confirmStop); setConfirmStop(null); }}
        onCancel={() => setConfirmStop(null)}
      />
    </>
  );

  // ── Session detail view ────────────────────────────────────
  if (session) {
    // Gather related events for this session
    const sessionEvents = events.filter((e) => e.sessionId === session.sessionId);
    const sessionPrompts = prompts.get(session.sessionId) ?? [];
    const sessionAgents = [...agents.values()].filter((a) => a.sessionId === session.sessionId);
    // Compute duration
    const duration = session.endTime
      ? formatDuration(session.endTime - session.startTime)
      : formatDuration(Date.now() - session.startTime);

    return (
      <>
        <PanelShell title="Session" onClose={() => selectNode(null)}>
          <div className="p-4 space-y-3 text-sm flex-1 overflow-auto">
            <Detail label="Session ID" value={session.sessionId} mono />
            <div className="flex justify-between items-start">
              <Detail
                label="Status"
                value={session.placeholder ? 'running (placeholder)' : session.status}
                badge={session.status === 'running' ? 'green' : 'gray'}
              />
              <Detail label="Duration" value={duration} />
            </div>
            {session.model && <Detail label="Model" value={session.model} />}
            {session.source && <Detail label="Source" value={session.source} badge="blue" />}
            {session.cwd && <Detail label="Working Dir" value={session.cwd} mono />}
            <div className="flex justify-between">
              <Detail label="Started" value={formatTime(session.startTime)} />
              {session.endTime && <Detail label="Ended" value={formatTime(session.endTime)} />}
            </div>

            <Divider />

            <div className="flex gap-4">
              <Stat label="Prompts" value={sessionPrompts.length} />
              <Stat label="Agents" value={session.agentCount} />
              <Stat label="Events" value={sessionEvents.length} />
            </div>

            {/* Token rollup across all agents */}
            {(() => {
              const totals = sessionAgents.reduce(
                (acc, a) => ({
                  input: acc.input + a.tokenUsage.input,
                  output: acc.output + a.tokenUsage.output,
                }),
                { input: 0, output: 0 },
              );
              return (totals.input > 0 || totals.output > 0) ? (
                <div>
                  <span className="text-gray-500 text-xs block mb-1">Tokens (all agents)</span>
                  <div className="flex gap-4">
                    <Stat label="Input" value={totals.input} format />
                    <Stat label="Output" value={totals.output} format />
                    <Stat label="Total" value={totals.input + totals.output} format />
                  </div>
                </div>
              ) : null;
            })()}

            {/* Prompt list */}
            {sessionPrompts.length > 0 && (
              <div>
                <span className="text-gray-500 text-xs block mb-1.5">
                  Prompts ({sessionPrompts.length})
                </span>
                <div className="space-y-1 max-h-48 overflow-auto">
                  {sessionPrompts.map((p) => (
                    <button
                      key={p.id}
                      onClick={() => selectNode(`prompt-${p.id}`)}
                      className="w-full text-left bg-amber-900/20 hover:bg-amber-900/40 border border-amber-800/30 rounded px-2 py-1.5 text-xs text-gray-300 truncate transition-colors"
                    >
                      {p.text.slice(0, 60) || '(empty)'}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Agent list */}
            {sessionAgents.length > 0 && (
              <div>
                <span className="text-gray-500 text-xs block mb-1.5">
                  Agents ({sessionAgents.length})
                </span>
                <div className="space-y-1 max-h-48 overflow-auto">
                  {sessionAgents.map((a) => (
                    <button
                      key={a.agentId}
                      onClick={() => selectNode(`agent-${a.agentId}`)}
                      className="w-full text-left flex items-center justify-between bg-gray-900/50 hover:bg-gray-800/50 rounded px-2 py-1.5 text-xs transition-colors"
                    >
                      <span className="text-gray-300">{a.agentType}</span>
                      <StatusBadge status={a.status} />
                    </button>
                  ))}
                </div>
              </div>
            )}

            <Divider />

            <button
              onClick={() => setConfirmRemove({ nodeId: `session-${session.sessionId}`, label: 'session' })}
              className="w-full px-3 py-1.5 bg-red-900/30 hover:bg-red-800/40 border border-red-700/40 rounded text-xs text-red-300 transition-colors"
            >
              Remove Session
            </button>
          </div>
        </PanelShell>
        {dialogs}
      </>
    );
  }

  // ── User prompt detail view ────────────────────────────────
  if (promptId) {
    // Find the prompt across all session prompts
    let foundPrompt = null;
    for (const sessionPromptList of prompts.values()) {
      const p = sessionPromptList.find((pp) => pp.id === promptId);
      if (p) { foundPrompt = p; break; }
    }
    if (!foundPrompt) return null;

    // Find agents belonging to this prompt (started after this prompt, before the next)
    const sessionPromptList = prompts.get(foundPrompt.sessionId) ?? [];
    const promptIdx = sessionPromptList.findIndex((p) => p.id === promptId);
    const nextPrompt = sessionPromptList[promptIdx + 1];
    const promptAgents = [...agents.values()].filter(
      (a) =>
        a.sessionId === foundPrompt!.sessionId &&
        a.startTime >= foundPrompt!.timestamp &&
        (!nextPrompt || a.startTime < nextPrompt.timestamp),
    );
    const promptTokens = promptAgents.reduce(
      (acc, a) => ({
        input: acc.input + a.tokenUsage.input,
        output: acc.output + a.tokenUsage.output,
      }),
      { input: 0, output: 0 },
    );

    return (
      <>
        <PanelShell title="User Prompt" onClose={() => selectNode(null)}>
          <div className="p-4 space-y-3 text-sm flex-1 overflow-auto">
            <Detail label="Time" value={formatTime(foundPrompt.timestamp)} />
            <Detail label="Session" value={foundPrompt.sessionId.slice(0, 12)} mono />

            {/* Token rollup for agents under this prompt */}
            {(promptTokens.input > 0 || promptTokens.output > 0) && (
              <>
                <Divider />
                <div>
                  <span className="text-gray-500 text-xs block mb-1">Tokens ({promptAgents.length} agent{promptAgents.length !== 1 ? 's' : ''})</span>
                  <div className="flex gap-4">
                    <Stat label="Input" value={promptTokens.input} format />
                    <Stat label="Output" value={promptTokens.output} format />
                    <Stat label="Total" value={promptTokens.input + promptTokens.output} format />
                  </div>
                </div>
              </>
            )}

            <Divider />

            <div>
              <span className="text-gray-500 text-xs block mb-1.5">Prompt text</span>
              <pre className="text-xs bg-gray-900 rounded p-3 text-gray-200 overflow-auto max-h-80 font-mono whitespace-pre-wrap leading-relaxed">
                {foundPrompt.text || '(empty)'}
              </pre>
            </div>

            <Divider />

            <button
              onClick={() => setConfirmRemove({ nodeId: `prompt-${promptId}`, label: 'prompt' })}
              className="w-full px-3 py-1.5 bg-red-900/30 hover:bg-red-800/40 border border-red-700/40 rounded text-xs text-red-300 transition-colors"
            >
              Remove Prompt
            </button>
          </div>
        </PanelShell>
        {dialogs}
      </>
    );
  }

  // ── Tool call detail view ──────────────────────────────────
  if (toolNodeId) {
    // Search across all agents AND the '' key (main agent orphan tools)
    let foundTc: ToolCallSummary | null = null;
    let parentAgentId: string | null = null;

    for (const a of agents.values()) {
      const tc = a.toolCalls.find((t) => t.toolUseId === toolNodeId);
      if (tc) {
        foundTc = tc;
        parentAgentId = a.agentId;
        break;
      }
    }
    // Also check orphaned tool calls (main agent, agentId='')
    if (!foundTc) {
      for (const [key, tcs] of toolCalls.entries()) {
        const tc = tcs.find((t) => t.toolUseId === toolNodeId);
        if (tc) {
          foundTc = tc;
          parentAgentId = key || null;
          break;
        }
      }
    }

    if (!foundTc) return null;

    const duration = foundTc.duration != null
      ? `${(foundTc.duration / 1000).toFixed(2)}s`
      : foundTc.startTime && foundTc.endTime
        ? `${((foundTc.endTime - foundTc.startTime) / 1000).toFixed(2)}s`
        : null;

    const parentAgent = parentAgentId ? agents.get(parentAgentId) : null;

    return (
      <>
        <PanelShell
          title={foundTc.toolName}
          titleRight={<StatusBadge status={foundTc.status} />}
          onClose={() => selectNode(null)}
        >
          <div className="p-4 space-y-3 text-sm flex-1 overflow-auto">
            {/* Summary line */}
            <ToolSummaryLine tc={foundTc} />

            {/* Metadata row */}
            <div className="flex justify-between items-start">
              <div>
                <div className="flex items-center gap-2">
                  <span className="text-gray-500 text-xs">Tool Use ID</span>
                  {parentAgentId && (
                    <button
                      onClick={() => selectNode(`agent-${parentAgentId}`)}
                      className="text-[10px] text-blue-400 hover:text-blue-300 underline"
                    >
                      Parent: {parentAgent?.agentType ?? parentAgentId.slice(0, 12)}
                    </button>
                  )}
                </div>
                <p className="text-gray-300 break-all font-mono text-xs">{foundTc.toolUseId.slice(0, 16)}</p>
              </div>
              {duration && <Detail label="Duration" value={duration} />}
            </div>
            {(foundTc.startTime || foundTc.endTime) && (
              <div className="flex justify-between">
                {foundTc.startTime && <Detail label="Started" value={formatTime(foundTc.startTime)} />}
                {foundTc.endTime && <Detail label="Ended" value={formatTime(foundTc.endTime)} />}
              </div>
            )}

            <Divider />

            {/* Rich tool-specific renderer */}
            <ToolRenderer
              input={foundTc.toolInput}
              response={foundTc.toolResponse}
              status={foundTc.status}
              toolName={foundTc.toolName}
              toolUseId={foundTc.toolUseId}
            />

            <Divider />

            <button
              onClick={() => setConfirmRemove({ nodeId: `tool-${toolNodeId}`, label: 'tool call' })}
              className="w-full px-3 py-1.5 bg-red-900/30 hover:bg-red-800/40 border border-red-700/40 rounded text-xs text-red-300 transition-colors"
            >
              Remove Tool
            </button>
          </div>
        </PanelShell>
        {dialogs}
      </>
    );
  }

  // ── Agent detail view ──────────────────────────────────────
  if (!agent) return null;

  const agentDuration = agent.endTime
    ? formatDuration(agent.endTime - agent.startTime)
    : formatDuration(Date.now() - agent.startTime);

  return (
    <PanelShell title={agent.agentType} onClose={() => selectNode(null)}>
      {/* Scrollable content */}
      <div className="flex-1 overflow-auto">
        <div className="p-4 space-y-3 text-sm">
          <div className="flex justify-between items-start">
            <Detail
              label="Status"
              value={agent.status}
              badge={agent.status === 'running' ? 'green' : agent.status === 'error' ? 'red' : 'gray'}
            />
            <Detail label="Duration" value={agentDuration} />
          </div>
          <Detail label="Agent ID" value={agent.agentId} mono />
          <Detail label="Session" value={agent.sessionId.slice(0, 12)} mono />
          {agent.parentAgentId && (
            <Detail label="Parent Agent" value={agent.parentAgentId.slice(0, 12)} mono />
          )}
          <div className="flex justify-between">
            <Detail label="Started" value={formatTime(agent.startTime)} />
            {agent.endTime && <Detail label="Ended" value={formatTime(agent.endTime)} />}
          </div>

          <Divider />

          {/* Token usage (self) */}
          <div className="flex gap-4">
            <Stat label="Input tokens" value={agent.tokenUsage.input} format />
            <Stat label="Output tokens" value={agent.tokenUsage.output} format />
          </div>

          {/* Children token rollup */}
          {(() => {
            const childAgents = [...agents.values()].filter((a) => a.parentAgentId === agent.agentId);
            if (childAgents.length === 0) return null;
            const childTokens = childAgents.reduce(
              (acc, a) => ({
                input: acc.input + a.tokenUsage.input,
                output: acc.output + a.tokenUsage.output,
              }),
              { input: 0, output: 0 },
            );
            const total = {
              input: agent.tokenUsage.input + childTokens.input,
              output: agent.tokenUsage.output + childTokens.output,
            };
            return (total.input > 0 || total.output > 0) ? (
              <div>
                <span className="text-gray-500 text-xs block mb-1">Total (self + {childAgents.length} child{childAgents.length !== 1 ? 'ren' : ''})</span>
                <div className="flex gap-4">
                  <Stat label="Input" value={total.input} format />
                  <Stat label="Output" value={total.output} format />
                  <Stat label="Total" value={total.input + total.output} format />
                </div>
              </div>
            ) : null;
          })()}

          {/* Tool calls */}
          {agent.toolCalls.length > 0 && (
            <div>
              <span className="text-gray-500 text-xs block mb-1.5">
                Tool calls ({agent.toolCalls.length})
              </span>
              <div className="space-y-1 max-h-60 overflow-auto">
                {agent.toolCalls.map((tc) => (
                  <button
                    key={tc.toolUseId}
                    onClick={() => selectNode(`tool-${tc.toolUseId}`)}
                    className="w-full text-left flex items-center justify-between bg-gray-900/50 hover:bg-gray-800/50 rounded px-2 py-1.5 text-xs transition-colors"
                  >
                    <span className="text-gray-300 flex items-center gap-1.5">
                      {tc.toolName}
                      {tc.inputPreview && (
                        <span className="text-gray-600 text-[10px] truncate max-w-[100px]">
                          {tc.inputPreview}
                        </span>
                      )}
                    </span>
                    <div className="flex items-center gap-1.5">
                      {tc.duration != null && (
                        <span className="text-gray-600 text-[10px]">
                          {(tc.duration / 1000).toFixed(1)}s
                        </span>
                      )}
                      <StatusBadge status={tc.status} />
                    </div>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Streaming text */}
          {agent.streamingText && (
            <div>
              <span className="text-gray-500 text-xs block mb-1.5">Output</span>
              <pre
                ref={textRef}
                className="text-xs bg-gray-900 rounded p-2 text-gray-300 overflow-auto max-h-60 font-mono whitespace-pre-wrap"
              >
                {agent.streamingText}
              </pre>
            </div>
          )}
        </div>
      </div>

      {/* Actions */}
      <div className="p-3 border-t border-gray-800 space-y-2">
        {agent.status === 'running' && (
          <>
            <div className="flex gap-2">
              <input
                type="text"
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleSendMessage()}
                placeholder="Send message..."
                className="flex-1 bg-gray-900 border border-gray-700 rounded px-2 py-1.5 text-xs text-gray-200 placeholder-gray-600 focus:outline-none focus:border-blue-500"
              />
              <button
                onClick={handleSendMessage}
                disabled={sending || !message.trim()}
                className="px-3 py-1.5 bg-blue-600 hover:bg-blue-500 disabled:bg-gray-700 disabled:text-gray-500 rounded text-xs text-white transition-colors"
              >
                Send
              </button>
            </div>
            <button
              onClick={() => setConfirmStop(agent.agentId)}
              className="w-full px-3 py-1.5 bg-red-900/50 hover:bg-red-800/50 border border-red-700/50 rounded text-xs text-red-300 transition-colors"
            >
              Stop Agent
            </button>
          </>
        )}
        <button
          onClick={() => setConfirmRemove({ nodeId: `agent-${agent.agentId}`, label: 'agent' })}
          className="w-full px-3 py-1.5 bg-red-900/30 hover:bg-red-800/40 border border-red-700/40 rounded text-xs text-red-300 transition-colors"
        >
          Remove Agent
        </button>
      </div>

      {dialogs}
    </PanelShell>
  );
}

// ── Reusable components ──────────────────────────────────────

function PanelShell({
  title,
  titleRight,
  onClose,
  children,
}: {
  title: string;
  titleRight?: React.ReactNode;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="w-80 bg-[#161b22] border-l border-gray-800 flex flex-col overflow-hidden">
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-800">
        <h3 className="text-sm font-semibold text-gray-200">{title}</h3>
        <div className="flex items-center gap-2">
          {titleRight}
          <button
            onClick={onClose}
            className="text-gray-500 hover:text-gray-300 text-lg leading-none"
          >
            &times;
          </button>
        </div>
      </div>
      {children}
    </div>
  );
}

function Detail({
  label,
  value,
  mono,
  badge,
}: {
  label: string;
  value: string;
  mono?: boolean;
  badge?: 'green' | 'red' | 'gray' | 'purple' | 'blue' | 'amber';
}) {
  const badgeColors: Record<string, string> = {
    green: 'bg-green-900/50 text-green-300',
    red: 'bg-red-900/50 text-red-300',
    gray: 'bg-gray-700/50 text-gray-300',
    purple: 'bg-purple-900/50 text-purple-300',
    blue: 'bg-blue-900/50 text-blue-300',
    amber: 'bg-amber-900/50 text-amber-300',
  };

  return (
    <div>
      <span className="text-gray-500 text-xs">{label}</span>
      {badge ? (
        <span className={`text-xs px-2 py-0.5 rounded-full ml-2 ${badgeColors[badge] ?? ''}`}>
          {value}
        </span>
      ) : (
        <p className={`text-gray-300 break-all ${mono ? 'font-mono text-xs' : ''}`}>{value}</p>
      )}
    </div>
  );
}

function Divider() {
  return <hr className="border-gray-800" />;
}

function Stat({
  label,
  value,
  format,
}: {
  label: string;
  value: number;
  format?: boolean;
}) {
  return (
    <div>
      <span className="text-gray-500 text-xs">{label}</span>
      <p className="text-gray-300 font-mono text-sm">
        {format ? value.toLocaleString() : value}
      </p>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const cls =
    status === 'success'
      ? 'bg-teal-900/50 text-teal-300'
      : status === 'error'
        ? 'bg-red-900/50 text-red-300'
        : status === 'running'
          ? 'bg-purple-900/50 text-purple-300'
          : 'bg-gray-700/50 text-gray-400';
  return (
    <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${cls}`}>
      {status}
    </span>
  );
}

