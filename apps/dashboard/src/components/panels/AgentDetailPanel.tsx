import { useState, useMemo, useRef, useEffect, useCallback, type ReactNode } from 'react';
import { useAgentStore } from '../../store/agentStore';
import { ConfirmDialog } from '../ConfirmDialog';
import type { ToolCallSummary, PromptAnalysis } from '@synapse-ai/core';
import { formatTime, formatDuration } from '@synapse-ai/core';
import { apiUrl } from '../../utils/api';
import { copyToClipboard } from '../../utils/clipboard';
import { extractUserMessage } from '../../utils/promptText';
import { toast } from '../Toast';
import { Tooltip } from '../ui/Tooltip';
import { ToolRenderer, ToolSummaryLine } from './ToolDetailRenderers';
import { ToolGroupDetailView } from './ToolGroupDetailView';
import { TokenBreakdownBar } from '../analytics/shared/TokenBreakdownBar';
import { ToolBadges } from '../analytics/shared/ToolBadges';
import { ModelBadge } from '../analytics/shared/ModelBadge';
import { ReasoningSection } from './ReasoningSection';
import { PromptReasoningSummary } from './PromptReasoningSummary';
import { CATEGORY_COLORS, fmtTokens } from '../analytics/shared/constants';
import { computeCostUsd, classifyPrompt, computeComplexity, computeCacheRate } from '../analytics/shared/promptUtils';

// ── AI Analysis helpers ─────────────────────────────────────────

type AnalysisMode = 'developer' | 'vibe';
const AI_PANEL_CACHE_KEY = 'synapse-panel-ai-analyses';
const AI_PANEL_MODE_KEY = 'synapse-panel-ai-mode';

function loadPanelMode(): AnalysisMode {
  try {
    const raw = localStorage.getItem(AI_PANEL_MODE_KEY);
    return raw === 'vibe' ? 'vibe' : 'developer';
  } catch { return 'developer'; }
}

function loadPanelCache(): Record<string, PromptAnalysis> {
  try {
    const raw = localStorage.getItem(AI_PANEL_CACHE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch { return {}; }
}

function savePanelCache(cache: Record<string, PromptAnalysis>): void {
  try { localStorage.setItem(AI_PANEL_CACHE_KEY, JSON.stringify(cache)); }
  catch { /* quota exceeded */ }
}

function panelCacheKey(promptText: string, mode: AnalysisMode): string {
  return `${mode}::${promptText.slice(0, 120)}`;
}

/** Render inline markdown: **bold**, *italic*, `code` */
function formatInlinePanel(text: string): ReactNode[] {
  const parts: ReactNode[] = [];
  const re = /(\*\*(.+?)\*\*|\*(.+?)\*|`(.+?)`)/g;
  let last = 0;
  let match: RegExpExecArray | null;
  let key = 0;
  while ((match = re.exec(text)) !== null) {
    if (match.index > last) parts.push(text.slice(last, match.index));
    if (match[2]) parts.push(<strong key={key++} className="font-semibold text-gray-200">{match[2]}</strong>);
    else if (match[3]) parts.push(<em key={key++} className="italic text-gray-300">{match[3]}</em>);
    else if (match[4]) parts.push(<code key={key++} className="px-1 py-0.5 rounded bg-gray-800 text-gray-300 text-[10px] font-mono">{match[4]}</code>);
    last = match.index + match[0].length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return parts;
}

/** Render text with line breaks, bullet/numbered lists, and inline markdown */
function formatPanelText(text: string): ReactNode {
  const lines = text.split('\n');
  const elements: ReactNode[] = [];
  let listItems: { ordered: boolean; content: string }[] = [];

  const flushList = () => {
    if (listItems.length === 0) return;
    const ordered = listItems[0].ordered;
    const Tag = ordered ? 'ol' : 'ul';
    const cls = ordered ? 'list-decimal' : 'list-disc';
    elements.push(
      <Tag key={elements.length} className={`${cls} pl-4 my-1 space-y-0.5`}>
        {listItems.map((item, j) => <li key={j}>{formatInlinePanel(item.content)}</li>)}
      </Tag>,
    );
    listItems = [];
  };

  for (const line of lines) {
    const bulletMatch = line.match(/^\s*[-*]\s+(.+)/);
    const orderedMatch = line.match(/^\s*\d+[.)]\s+(.+)/);
    if (bulletMatch) {
      if (listItems.length > 0 && listItems[0].ordered) flushList();
      listItems.push({ ordered: false, content: bulletMatch[1] });
    } else if (orderedMatch) {
      if (listItems.length > 0 && !listItems[0].ordered) flushList();
      listItems.push({ ordered: true, content: orderedMatch[1] });
    } else {
      flushList();
      if (line.trim()) elements.push(<p key={elements.length} className="my-0.5">{formatInlinePanel(line)}</p>);
    }
  }
  flushList();
  return <>{elements}</>;
}

// ── Main Component ──────────────────────────────────────────────

export function AgentDetailPanel() {
  const selectedNodeId = useAgentStore((s) => s.selectedNodeId);
  const agents = useAgentStore((s) => s.agents);
  const sessions = useAgentStore((s) => s.sessions);
  const prompts = useAgentStore((s) => s.prompts);
  const toolCalls = useAgentStore((s) => s.toolCalls);
  const events = useAgentStore((s) => s.events);
  const taskToolAgentMap = useAgentStore((s) => s.taskToolAgentMap);
  const toolAgentMap = useAgentStore((s) => s.toolAgentMap);
  const storeEdges = useAgentStore((s) => s.edges);
  const transcripts = useAgentStore((s) => s.transcripts);
  const selectNode = useAgentStore((s) => s.selectNode);
  const removeNode = useAgentStore((s) => s.removeNode);
  const [message, setMessage] = useState('');
  const [sending, setSending] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState<{ nodeId: string; label: string } | null>(null);
  const [confirmStop, setConfirmStop] = useState<string | null>(null);
  const textRef = useRef<HTMLPreElement>(null);
  const [detailTab, setDetailTab] = useState<'stats' | 'reasoning'>('stats');

  // AI analysis state for prompt panel
  const [analysisMode, setAnalysisMode] = useState<AnalysisMode>(loadPanelMode);
  const [aiCache, setAiCache] = useState<Record<string, PromptAnalysis>>(loadPanelCache);
  const [aiLoading, setAiLoading] = useState(false);

  const handleModeChange = useCallback((mode: AnalysisMode) => {
    setAnalysisMode(mode);
    try { localStorage.setItem(AI_PANEL_MODE_KEY, mode); } catch { /* quota */ }
  }, []);

  useEffect(() => { savePanelCache(aiCache); }, [aiCache]);

  const runAiAnalysis = useCallback((promptText: string, skipCache = false) => {
    const key = panelCacheKey(promptText, analysisMode);
    if (!skipCache && aiCache[key]) return; // already cached

    // Build conversation context from session prompts
    let conversationContext: Record<string, unknown> | undefined;
    let sessionContext = { model: 'unknown', toolCount: 0, category: classifyPrompt(promptText), cost: 0 };

    // Find the session this prompt belongs to
    for (const [sid, sessionPromptList] of prompts.entries()) {
      const idx = sessionPromptList.findIndex((p) => extractUserMessage(p.text) === promptText);
      if (idx < 0) continue;

      const currentPrompt = sessionPromptList[idx];
      const priorPrompts = sessionPromptList.slice(Math.max(0, idx - 3), idx);
      const twoMinMs = 2 * 60 * 1000;
      const recentInWindow = sessionPromptList
        .slice(0, idx + 1)
        .filter((p) => currentPrompt.timestamp - p.timestamp < twoMinMs);
      const isConversationalMode = recentInWindow.length >= 2 &&
        priorPrompts.length > 0 &&
        priorPrompts.every((p) => extractUserMessage(p.text).split(/\s+/).filter(Boolean).length < 15);

      const firstPrompt = sessionPromptList[0];
      const firstText = firstPrompt ? extractUserMessage(firstPrompt.text) : '';
      const goalEnd = firstText.search(/[.!?]/);
      const sessionGoal = goalEnd > 0 && goalEnd < 100 ? firstText.slice(0, goalEnd + 1) : firstText.slice(0, 100);

      const sess = sessions.get(sid);
      sessionContext = {
        model: sess?.model ?? 'unknown',
        toolCount: 0,
        category: classifyPrompt(promptText),
        cost: 0,
      };

      if (priorPrompts.length > 0) {
        conversationContext = {
          recentPrompts: priorPrompts.map((p) => extractUserMessage(p.text).slice(0, 500)),
          sessionGoal,
          turnNumber: idx + 1,
          isConversationalMode,
        };
      }
      break;
    }

    setAiLoading(true);
    fetch(apiUrl('/api/analytics/ai-analyze-prompt'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        promptText,
        mode: analysisMode,
        skipCache,
        sessionContext,
        conversationContext,
      }),
    })
      .then((r) => r.json())
      .then((d) => {
        if (d.data) setAiCache((prev) => ({ ...prev, [key]: d.data }));
        else if (d.meta?.reason) toast(d.meta.reason, 'warning');
      })
      .catch(() => toast('Failed to analyze prompt', 'error'))
      .finally(() => setAiLoading(false));
  }, [analysisMode, aiCache, prompts, sessions]);

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
  const toolGroupParentId = selectedNodeId?.startsWith('toolgroup-')
    ? selectedNodeId.slice('toolgroup-'.length)
    : null;

  const agent = agentId ? agents.get(agentId) : null;
  const session = sessionId ? sessions.get(sessionId) : null;

  // Compute rich metrics for agent panel (must be before conditional returns)
  const agentMetrics = useMemo(() => {
    if (!agent) return null;

    const childAgents = [...agents.values()].filter((a) => a.parentAgentId === agent.agentId);

    // Aggregate tokens: self + children
    const selfTokens = agent.tokenUsage;
    const childTokens = childAgents.reduce(
      (acc, a) => ({
        input: acc.input + a.tokenUsage.input,
        output: acc.output + a.tokenUsage.output,
        cacheRead: acc.cacheRead + (a.tokenUsage.cacheRead ?? 0),
        cacheCreation: acc.cacheCreation + (a.tokenUsage.cacheCreation ?? 0),
        thinking: acc.thinking + (a.tokenUsage.thinking ?? 0),
      }),
      { input: 0, output: 0, cacheRead: 0, cacheCreation: 0, thinking: 0 },
    );
    const totalInput = selfTokens.input + childTokens.input;
    const totalOutput = selfTokens.output + childTokens.output;
    const totalCacheRead = (selfTokens.cacheRead ?? 0) + childTokens.cacheRead;
    const totalCacheCreation = (selfTokens.cacheCreation ?? 0) + childTokens.cacheCreation;
    const totalThinking = (selfTokens.thinking ?? 0) + childTokens.thinking;
    const totalTokens = totalInput + totalOutput + totalCacheRead;

    const model = agent.model ?? 'unknown';
    const costUsd = computeCostUsd(totalInput, totalOutput, totalCacheRead, model);
    const cacheRate = computeCacheRate(totalInput, totalCacheRead);

    // Tool summary
    const toolCountMap = new Map<string, number>();
    for (const tc of agent.toolCalls) {
      toolCountMap.set(tc.toolName, (toolCountMap.get(tc.toolName) ?? 0) + 1);
    }

    return {
      childAgents,
      totalInput,
      totalOutput,
      totalCacheRead,
      totalCacheCreation,
      totalThinking,
      totalTokens,
      model,
      costUsd,
      cacheRate,
      toolNames: [...toolCountMap.keys()],
      toolCounts: Object.fromEntries(toolCountMap),
    };
  }, [agent, agents]);

  // Auto-scroll streaming text
  useEffect(() => {
    if (textRef.current) {
      textRef.current.scrollTop = textRef.current.scrollHeight;
    }
  }, [agent?.streamingText]);

  // Reset detail tab when selected node changes
  useEffect(() => {
    setDetailTab('stats');
  }, [selectedNodeId]);

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
                      {(() => { const t = extractUserMessage(p.text); return t.slice(0, 60) || '(empty)'; })()}
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
    return (
      <PromptDetailView
        promptId={promptId}
        prompts={prompts}
        agents={agents}
        sessions={sessions}
        toolCalls={toolCalls}
        aiCache={aiCache}
        aiLoading={aiLoading}
        analysisMode={analysisMode}
        onModeChange={handleModeChange}
        onAnalyze={runAiAnalysis}
        onClose={() => selectNode(null)}
        onRemove={(nodeId) => setConfirmRemove({ nodeId, label: 'prompt' })}
        dialogs={dialogs}
      />
    );
  }

  // ── Tool group detail view ────────────────────────────────
  if (toolGroupParentId) {
    // Resolve the raw agentId that toolCalls is keyed by.
    // For agent parents (agent-xxx) we strip the prefix. For prompt/session
    // parents we walk edges → toolAgentMap to find the correct key (which
    // may be '' when hooks don't send agent_id on tool events).
    let resolvedAgentId: string | undefined;
    if (toolGroupParentId.startsWith('agent-')) {
      resolvedAgentId = toolGroupParentId.slice(6);
    } else {
      for (const edge of storeEdges) {
        if (edge.source === toolGroupParentId && edge.target.startsWith('tool-')) {
          resolvedAgentId = toolAgentMap.get(edge.target.slice(5));
          if (resolvedAgentId !== undefined) break;
        }
      }
    }
    const tools = resolvedAgentId !== undefined
      ? (toolCalls.get(resolvedAgentId) ?? [])
      : [];
    return (
      <>
        <ToolGroupDetailView
          parentNodeId={toolGroupParentId}
          tools={tools}
          agents={agents}
          selectNode={selectNode}
          onClose={() => selectNode(null)}
        />
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

            {/* Transcript data (full tool I/O) */}
            {parentAgent && (
              <TranscriptToolDetail
                sessionId={parentAgent.sessionId}
                toolUseId={foundTc.toolUseId}
              />
            )}

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
  if (!agent || !agentMetrics) return null;

  const agentDuration = agent.endTime
    ? formatDuration(agent.endTime - agent.startTime)
    : formatDuration(Date.now() - agent.startTime);
  const agentDurationMs = agent.endTime
    ? agent.endTime - agent.startTime
    : Date.now() - agent.startTime;

  const hasAgentTokens = agentMetrics.totalTokens > 0;
  const hasAgentMetrics = hasAgentTokens || agent.toolCalls.length > 0;
  const agentCacheColor = agentMetrics.cacheRate > 50 ? 'text-emerald-400' : agentMetrics.cacheRate > 20 ? 'text-yellow-400' : 'text-red-400';

  return (
    <PanelShell
      title={agent.agentType}
      titleRight={<StatusBadge status={agent.status} />}
      tabs={{
        items: [
          { key: 'stats', label: 'Stats' },
          { key: 'reasoning', label: 'Reasoning' },
        ],
        activeKey: detailTab,
        onChange: (k) => setDetailTab(k as 'stats' | 'reasoning'),
      }}
      onClose={() => selectNode(null)}
    >
      {/* Stats tab */}
      {detailTab === 'stats' && (
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

            {/* Transcript metadata */}
            {(() => {
              const tx = transcripts.get(agent.sessionId);
              if (!tx) return null;
              const hasMetadata = tx.permissionMode || tx.gitBranch || tx.slug;
              if (!hasMetadata) return null;
              return (
                <>
                  {tx.permissionMode && <Detail label="Permission" value={tx.permissionMode} />}
                  {tx.gitBranch && <Detail label="Branch" value={tx.gitBranch} mono />}
                  {tx.slug && <Detail label="Slug" value={tx.slug} mono />}
                </>
              );
            })()}

            {/* MetricCard grid */}
            {hasAgentMetrics && (
              <>
                <Divider />
                <div className="grid grid-cols-2 gap-2">
                  {hasAgentTokens && (
                    <>
                      <MetricCard label="Cost" value={`$${agentMetrics.costUsd.toFixed(4)}`} color="text-amber-400" />
                      <MetricCard label="Total Tokens" value={fmtTokens(agentMetrics.totalTokens)} color="text-gray-200" />
                      <MetricCard label="Cache Hit" value={`${agentMetrics.cacheRate.toFixed(0)}%`} color={agentCacheColor} />
                    </>
                  )}
                  <MetricCard
                    label="Duration"
                    value={agentDurationMs < 1000 ? `${Math.round(agentDurationMs)}ms` : `${(agentDurationMs / 1000).toFixed(1)}s`}
                    color="text-gray-200"
                  />
                  {agent.toolCalls.length > 0 && (
                    <MetricCard label="Tools" value={String(agent.toolCalls.length)} color="text-gray-200" />
                  )}
                  {agentMetrics.childAgents.length > 0 && (
                    <MetricCard label="Children" value={String(agentMetrics.childAgents.length)} color="text-gray-200" />
                  )}
                  {(() => {
                    const tx = transcripts.get(agent.sessionId);
                    return <>
                      {tx?.webSearchRequests != null && tx.webSearchRequests > 0 && (
                        <MetricCard label="Web Searches" value={String(tx.webSearchRequests)} color="text-blue-400" />
                      )}
                      {tx?.webFetchRequests != null && tx.webFetchRequests > 0 && (
                        <MetricCard label="Web Fetches" value={String(tx.webFetchRequests)} color="text-blue-400" />
                      )}
                    </>;
                  })()}
                </div>
              </>
            )}

            {/* Token Breakdown Bar */}
            {hasAgentTokens && (
              <div className="bg-[#0d1117] border border-gray-800 rounded-lg px-3 py-2">
                <TokenBreakdownBar
                  cacheReadTokens={agentMetrics.totalCacheRead}
                  inputTokens={agentMetrics.totalInput}
                  outputTokens={agentMetrics.totalOutput}
                  thinkingTokens={agentMetrics.totalThinking}
                />
              </div>
            )}

            {/* Tool Badges + Model */}
            {(agentMetrics.toolNames.length > 0 || agentMetrics.model !== 'unknown') && (
              <div className="space-y-2">
                {agentMetrics.toolNames.length > 0 && (
                  <div className="bg-[#0d1117] border border-gray-800 rounded-lg px-3 py-2">
                    <ToolBadges toolNames={agentMetrics.toolNames} toolCounts={agentMetrics.toolCounts} label={`Tools (${agent.toolCalls.length})`} />
                  </div>
                )}
                {agentMetrics.model !== 'unknown' && (
                  <div className="bg-[#0d1117] border border-gray-800 rounded-lg px-3 py-2">
                    <span className="text-xs text-gray-500 block mb-1">Model</span>
                    <ModelBadge model={agentMetrics.model} />
                  </div>
                )}
              </div>
            )}

            {/* Children token rollup */}
            {agentMetrics.childAgents.length > 0 && hasAgentTokens && (
              <>
                <Divider />
                <div>
                  <span className="text-gray-500 text-xs block mb-1">Total (self + {agentMetrics.childAgents.length} child{agentMetrics.childAgents.length !== 1 ? 'ren' : ''})</span>
                  <div className="flex gap-4">
                    <Stat label="Input" value={agentMetrics.totalInput} format />
                    <Stat label="Output" value={agentMetrics.totalOutput} format />
                    <Stat label="Total" value={agentMetrics.totalTokens} format />
                  </div>
                </div>
              </>
            )}

            <Divider />

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
      )}

      {/* Reasoning tab */}
      {detailTab === 'reasoning' && (
        <div className="flex-1 overflow-auto">
          <div className="p-4">
            <ReasoningSection sessionId={agent.sessionId} />
          </div>
        </div>
      )}

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

export function PanelShell({
  title,
  titleRight,
  tabs,
  onClose,
  children,
}: {
  title: string;
  titleRight?: React.ReactNode;
  tabs?: {
    items: { key: string; label: string }[];
    activeKey: string;
    onChange: (key: string) => void;
  };
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="w-80 h-full bg-[#161b22] border-l border-gray-800 flex flex-col overflow-hidden">
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-800">
        <div className="flex items-center gap-3">
          <h3 className="text-sm font-semibold text-gray-200">{title}</h3>
          {tabs && (
            <div className="flex items-center gap-1">
              {tabs.items.map((tab) => (
                <button
                  key={tab.key}
                  onClick={() => tabs.onChange(tab.key)}
                  className={`px-2 py-1 text-xs font-medium border-b-2 transition-colors ${
                    tabs.activeKey === tab.key
                      ? 'text-gray-200 border-blue-400'
                      : 'text-gray-500 border-transparent hover:text-gray-300'
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>
          )}
        </div>
        <div className="flex items-center gap-2">
          {titleRight}
          <Tooltip content="Close panel" shortcut="Esc">
            <button
              onClick={onClose}
              className="text-gray-500 hover:text-gray-300 text-lg leading-none"
            >
              &times;
            </button>
          </Tooltip>
        </div>
      </div>
      {children}
    </div>
  );
}

export function Detail({
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

export function Divider({ label }: { label?: string } = {}) {
  if (label) {
    return (
      <div className="flex items-center gap-2">
        <hr className="border-gray-800 flex-1" />
        <span className="text-gray-600 text-[10px] shrink-0">{label}</span>
        <hr className="border-gray-800 flex-1" />
      </div>
    );
  }
  return <hr className="border-gray-800" />;
}

export function Stat({
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

export function StatusBadge({ status }: { status: string }) {
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

// ── Prompt Detail View (extracted for rich metrics) ─────────────

function PromptDetailView({
  promptId,
  prompts,
  agents,
  sessions,
  toolCalls,
  aiCache,
  aiLoading,
  analysisMode,
  onModeChange,
  onAnalyze,
  onClose,
  onRemove,
  dialogs,
}: {
  promptId: string;
  prompts: Map<string, import('@synapse-ai/core').UserPromptData[]>;
  agents: Map<string, import('@synapse-ai/core').AgentNodeData>;
  sessions: Map<string, import('@synapse-ai/core').SessionData>;
  toolCalls: Map<string, ToolCallSummary[]>;
  aiCache: Record<string, PromptAnalysis>;
  aiLoading: boolean;
  analysisMode: AnalysisMode;
  onModeChange: (mode: AnalysisMode) => void;
  onAnalyze: (promptText: string, skipCache?: boolean) => void;
  onClose: () => void;
  onRemove: (nodeId: string) => void;
  dialogs: React.ReactNode;
}) {
  // Find the prompt across all session prompts
  let foundPrompt = null;
  for (const sessionPromptList of prompts.values()) {
    const p = sessionPromptList.find((pp) => pp.id === promptId);
    if (p) { foundPrompt = p; break; }
  }
  if (!foundPrompt) return null;

  const promptText = extractUserMessage(foundPrompt.text);
  const session = sessions.get(foundPrompt.sessionId);

  // Find agents belonging to this prompt (started after this prompt, before the next)
  const sessionPromptList = prompts.get(foundPrompt.sessionId) ?? [];
  const promptIdx = sessionPromptList.findIndex((p) => p.id === promptId);
  const nextPrompt = sessionPromptList[promptIdx + 1];

  // Compute rich metrics from child agents AND direct tool calls
  const metrics = useMemo(() => {
    const promptTs = foundPrompt!.timestamp;
    const nextTs = nextPrompt?.timestamp ?? Infinity;

    // ── Child agents in this prompt's time window ──────────────
    const promptAgents = [...agents.values()].filter(
      (a) =>
        a.sessionId === foundPrompt!.sessionId &&
        a.startTime >= promptTs &&
        a.startTime < nextTs,
    );

    const inputTokens = promptAgents.reduce((s, a) => s + a.tokenUsage.input, 0);
    const outputTokens = promptAgents.reduce((s, a) => s + a.tokenUsage.output, 0);
    const cacheReadTokens = promptAgents.reduce((s, a) => s + (a.tokenUsage.cacheRead ?? 0), 0);
    const cacheCreationTokens = promptAgents.reduce((s, a) => s + (a.tokenUsage.cacheCreation ?? 0), 0);
    const thinkingTokens = promptAgents.reduce((s, a) => s + (a.tokenUsage.thinking ?? 0), 0);

    const model = promptAgents.find((a) => a.model)?.model ?? session?.model ?? 'unknown';

    // ── Tool summary: agents + direct tools ───────────────────
    // Collect tool IDs already counted via agents
    const agentToolIds = new Set<string>();
    const toolCountMap = new Map<string, number>();
    let toolCount = 0;
    for (const a of promptAgents) {
      for (const tc of a.toolCalls) {
        agentToolIds.add(tc.toolUseId);
        toolCountMap.set(tc.toolName, (toolCountMap.get(tc.toolName) ?? 0) + 1);
        toolCount++;
      }
    }

    // Find direct tools in the time window not already counted via agents.
    // These are tools from the main conversation (hooks don't fire agent_start).
    let latestToolEnd = 0;
    for (const [, tcs] of toolCalls) {
      for (const tc of tcs) {
        if (tc.startTime >= promptTs && tc.startTime < nextTs && !agentToolIds.has(tc.toolUseId)) {
          toolCountMap.set(tc.toolName, (toolCountMap.get(tc.toolName) ?? 0) + 1);
          toolCount++;
          const end = tc.endTime ?? (tc.status === 'running' ? Date.now() : tc.startTime);
          if (end > latestToolEnd) latestToolEnd = end;
        }
      }
    }

    // Latency: time from prompt to last agent completion or last direct tool end
    const endTimes = promptAgents.filter((a) => a.endTime).map((a) => a.endTime!);
    if (latestToolEnd > 0) endTimes.push(latestToolEnd);
    const latencyMs = endTimes.length > 0
      ? Math.max(...endTimes) - promptTs
      : 0;

    const costUsd = computeCostUsd(inputTokens, outputTokens, cacheReadTokens, model);
    const cacheRate = computeCacheRate(inputTokens, cacheReadTokens);
    const complexity = computeComplexity(promptText, outputTokens, toolCount);
    const category = classifyPrompt(promptText);

    return {
      agentCount: promptAgents.length,
      inputTokens,
      outputTokens,
      cacheReadTokens,
      cacheCreationTokens,
      thinkingTokens,
      model,
      latencyMs,
      toolNames: [...toolCountMap.keys()],
      toolCounts: Object.fromEntries(toolCountMap),
      toolCount,
      costUsd,
      cacheRate,
      complexity,
      category,
    };
  }, [agents, toolCalls, foundPrompt, nextPrompt, session, promptText]);

  const cacheColor = metrics.cacheRate > 50 ? 'text-emerald-400' : metrics.cacheRate > 20 ? 'text-yellow-400' : 'text-red-400';
  const complexityColor = metrics.complexity > 70 ? 'text-red-400' : metrics.complexity > 40 ? 'text-yellow-400' : 'text-emerald-400';
  const totalTokens = metrics.inputTokens + metrics.outputTokens + metrics.cacheReadTokens;
  const hasTokens = totalTokens > 0;
  const hasMetrics = hasTokens || metrics.toolCount > 0;

  const [detailTab, setDetailTab] = useState<'stats' | 'reasoning'>('stats');

  // Reset tab when prompt changes
  useEffect(() => {
    setDetailTab('stats');
  }, [promptId]);

  return (
    <>
      <PanelShell
        title="User Prompt"
        titleRight={
          <span
            className="px-2 py-0.5 rounded-full text-[10px] font-medium"
            style={{
              backgroundColor: `${CATEGORY_COLORS[metrics.category] ?? CATEGORY_COLORS.other}20`,
              color: CATEGORY_COLORS[metrics.category] ?? CATEGORY_COLORS.other,
            }}
          >
            {metrics.category}
          </span>
        }
        tabs={{
          items: [
            { key: 'stats', label: 'Stats' },
            { key: 'reasoning', label: 'Reasoning' },
          ],
          activeKey: detailTab,
          onChange: (k) => setDetailTab(k as 'stats' | 'reasoning'),
        }}
        onClose={onClose}
      >
        {/* Stats tab */}
        {detailTab === 'stats' && (
          <div className="p-4 space-y-3 text-sm flex-1 overflow-auto">
            <Detail label="Time" value={formatTime(foundPrompt.timestamp)} />
            <Detail label="Session" value={foundPrompt.sessionId.slice(0, 12)} mono />

            {/* Metrics stat cards — 2-column grid for 320px panel */}
            {hasMetrics && (
              <>
                <Divider />
                <div className="grid grid-cols-2 gap-2">
                  {hasTokens && (
                    <>
                      <MetricCard label="Cost" value={`$${metrics.costUsd.toFixed(4)}`} color="text-amber-400" />
                      <MetricCard label="Total Tokens" value={fmtTokens(totalTokens)} color="text-gray-200" />
                      <MetricCard label="Cache Hit" value={`${metrics.cacheRate.toFixed(0)}%`} color={cacheColor} />
                    </>
                  )}
                  <MetricCard
                    label="Latency"
                    value={metrics.latencyMs > 0
                      ? (metrics.latencyMs < 1000 ? `${Math.round(metrics.latencyMs)}ms` : `${(metrics.latencyMs / 1000).toFixed(1)}s`)
                      : '\u2014'}
                    color="text-gray-200"
                  />
                  <MetricCard label="Complexity" value={`${metrics.complexity}/100`} color={complexityColor} />
                  {metrics.agentCount > 0 ? (
                    <MetricCard label="Agents" value={String(metrics.agentCount)} color="text-gray-200" />
                  ) : (
                    <MetricCard label="Tools" value={String(metrics.toolCount)} color="text-gray-200" />
                  )}
                </div>
              </>
            )}

            {/* Token Breakdown Bar */}
            {hasTokens && (
              <div className="bg-[#0d1117] border border-gray-800 rounded-lg px-3 py-2">
                <TokenBreakdownBar
                  cacheReadTokens={metrics.cacheReadTokens}
                  inputTokens={metrics.inputTokens}
                  outputTokens={metrics.outputTokens}
                  thinkingTokens={metrics.thinkingTokens}
                />
              </div>
            )}

            {/* Tool Badges + Model */}
            {(metrics.toolNames.length > 0 || metrics.model !== 'unknown') && (
              <div className="space-y-2">
                {metrics.toolNames.length > 0 && (
                  <div className="bg-[#0d1117] border border-gray-800 rounded-lg px-3 py-2">
                    <ToolBadges toolNames={metrics.toolNames} toolCounts={metrics.toolCounts} label={`Tools (${metrics.toolCount})`} />
                  </div>
                )}
                {metrics.model !== 'unknown' && (
                  <div className="bg-[#0d1117] border border-gray-800 rounded-lg px-3 py-2">
                    <span className="text-xs text-gray-500 block mb-1">Model</span>
                    <ModelBadge model={metrics.model} />
                  </div>
                )}
              </div>
            )}

            <Divider />

            {/* Prompt text */}
            <div>
              <span className="text-gray-500 text-xs block mb-1.5">Prompt text</span>
              <pre className="text-xs bg-gray-900 rounded p-3 text-gray-200 overflow-auto max-h-80 font-mono whitespace-pre-wrap leading-relaxed">
                {promptText || '(empty)'}
              </pre>
            </div>

            <Divider />

            {/* AI Analysis Section */}
            <PromptAiSection
              promptText={promptText}
              devAnalysis={aiCache[panelCacheKey(promptText, 'developer')] ?? null}
              vibeAnalysis={aiCache[panelCacheKey(promptText, 'vibe')] ?? null}
              loading={aiLoading}
              mode={analysisMode}
              onModeChange={onModeChange}
              onAnalyze={(skipCache) => onAnalyze(promptText, skipCache)}
            />

            <Divider />

            <button
              onClick={() => onRemove(`prompt-${promptId}`)}
              className="w-full px-3 py-1.5 bg-red-900/30 hover:bg-red-800/40 border border-red-700/40 rounded text-xs text-red-300 transition-colors"
            >
              Remove Prompt
            </button>
          </div>
        )}

        {/* Reasoning tab */}
        {detailTab === 'reasoning' && (
          <div className="p-4 flex-1 overflow-auto">
            <PromptReasoningSummary sessionId={foundPrompt.sessionId} promptTimestamp={foundPrompt.timestamp} />
          </div>
        )}
      </PanelShell>
      {dialogs}
    </>
  );
}

// ── Transcript Tool Detail (full I/O from transcript v2) ────────

function TranscriptToolDetail({ sessionId, toolUseId }: { sessionId: string; toolUseId: string }) {
  const [toolInput, setToolInput] = useState<Record<string, unknown> | null>(null);
  const [toolResult, setToolResult] = useState<{ content: string; is_error: boolean } | null>(null);
  const [loading, setLoading] = useState(false);
  const [tried, setTried] = useState(false);

  useEffect(() => {
    if (!sessionId || tried) return;
    setLoading(true);
    setTried(true);

    fetch(apiUrl(`/api/transcript/${sessionId}/full`))
      .then(r => {
        if (!r.ok) throw new Error(`${r.status}`);
        return r.json();
      })
      .then((full: { conversations: Array<{ content: Array<{ type: string; id?: string; tool_use_id?: string; name?: string; input?: Record<string, unknown>; content?: string; is_error?: boolean }> }> }) => {
        // Find matching tool_use block
        for (const conv of full.conversations) {
          for (const block of conv.content) {
            if (block.type === 'tool_use' && block.id === toolUseId) {
              setToolInput(block.input ?? null);
            }
            if (block.type === 'tool_result' && block.tool_use_id === toolUseId) {
              setToolResult({ content: block.content ?? '', is_error: block.is_error ?? false });
            }
          }
        }
      })
      .catch(() => { /* silently fail — transcript data is optional */ })
      .finally(() => setLoading(false));
  }, [sessionId, toolUseId, tried]);

  if (loading) return <div className="text-gray-600 text-xs py-1">Loading transcript data...</div>;
  if (!toolInput && !toolResult) return null;

  return (
    <>
      <Divider label="Transcript Data" />
      {toolInput && (
        <div>
          <span className="text-gray-500 text-[10px] block mb-1">Full Input (JSON)</span>
          <pre className="text-[11px] bg-gray-900 rounded p-2 text-gray-300 overflow-auto max-h-40 font-mono whitespace-pre-wrap">
            {JSON.stringify(toolInput, null, 2)}
          </pre>
        </div>
      )}
      {toolResult && (
        <div>
          <span className="text-gray-500 text-[10px] block mb-1">
            Full Output
            {toolResult.is_error && (
              <span className="ml-1.5 bg-red-900/50 text-red-300 text-[9px] px-1.5 rounded">error</span>
            )}
          </span>
          <pre className={`text-[11px] bg-gray-900 rounded p-2 overflow-auto max-h-60 font-mono whitespace-pre-wrap ${toolResult.is_error ? 'text-red-300' : 'text-gray-300'}`}>
            {toolResult.content || '(empty)'}
          </pre>
        </div>
      )}
    </>
  );
}

function MetricCard({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div className="bg-[#0d1117] border border-gray-800 rounded-lg px-3 py-2">
      <div className="text-xs text-gray-500">{label}</div>
      <div className={`text-sm font-semibold ${color}`}>{value}</div>
    </div>
  );
}

// ── Prompt AI Analysis Section ──────────────────────────────────

function PromptAiSection({
  promptText,
  devAnalysis,
  vibeAnalysis,
  loading,
  mode,
  onModeChange,
  onAnalyze,
}: {
  promptText: string;
  devAnalysis: PromptAnalysis | null;
  vibeAnalysis: PromptAnalysis | null;
  loading: boolean;
  mode: AnalysisMode;
  onModeChange: (mode: AnalysisMode) => void;
  onAnalyze: (skipCache?: boolean) => void;
}) {
  const isVibe = mode === 'vibe';
  const analysis = isVibe ? vibeAnalysis : devAnalysis;

  if (!promptText) return null;

  // Mode toggle (always visible)
  const modeToggle = (
    <div className="flex items-center gap-0.5 bg-gray-900 border border-gray-700 rounded-md p-0.5">
      <Tooltip content="Technical analysis — token metrics and structural critique">
        <button
          onClick={() => onModeChange('developer')}
          className={`px-2 py-0.5 text-[10px] font-medium rounded transition-colors ${
            mode === 'developer'
              ? 'bg-blue-500/20 text-blue-400'
              : 'text-gray-500 hover:text-gray-300'
          }`}
        >
          Dev
        </button>
      </Tooltip>
      <Tooltip content="Plain-language feedback — conversational coaching">
        <button
          onClick={() => onModeChange('vibe')}
          className={`px-2 py-0.5 text-[10px] font-medium rounded transition-colors ${
            mode === 'vibe'
              ? 'bg-purple-500/20 text-purple-400'
              : 'text-gray-500 hover:text-gray-300'
          }`}
        >
          Vibe
        </button>
      </Tooltip>
    </div>
  );

  // No analysis yet — show the button
  if (!analysis) {
    return (
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-gray-500 text-xs">AI Analysis</span>
          {modeToggle}
        </div>
        <button
          onClick={() => onAnalyze()}
          disabled={loading}
          className={`w-full px-3 py-2 text-xs font-medium rounded-lg transition-colors disabled:opacity-50 ${
            isVibe
              ? 'bg-purple-500/10 border border-purple-500/20 text-purple-400 hover:bg-purple-500/20'
              : 'bg-blue-500/10 border border-blue-500/20 text-blue-400 hover:bg-blue-500/20'
          }`}
        >
          {loading
            ? 'Analyzing...'
            : isVibe ? 'Get prompt tips' : 'Analyze with AI'
          }
        </button>
      </div>
    );
  }

  // Analysis result display
  const scoreColor = analysis.score >= 8 ? 'text-emerald-400' : analysis.score >= 5 ? 'text-yellow-400' : 'text-red-400';

  return (
    <div className={`relative bg-gradient-to-b ${
      isVibe
        ? 'from-purple-500/5 to-pink-500/5 border-purple-500/15'
        : 'from-blue-500/5 to-purple-500/5 border-blue-500/15'
    } border rounded-lg p-3 space-y-2.5 ${loading ? 'opacity-40 pointer-events-none' : ''}`}>
      {loading && (
        <div className="absolute inset-0 flex items-center justify-center z-10">
          <div className={`text-xs font-medium ${isVibe ? 'text-purple-400' : 'text-blue-400'}`}>Re-analyzing...</div>
        </div>
      )}

      {/* Header: label + mode toggle + score + refresh */}
      <div className="flex items-center gap-2">
        <span className={`text-[10px] font-medium uppercase tracking-wider ${isVibe ? 'text-purple-400' : 'text-blue-400'}`}>
          {isVibe ? 'Prompt Coach' : 'AI Analysis'}
        </span>
        <span className={`px-1 py-0.5 text-[9px] font-medium rounded ${
          isVibe ? 'bg-purple-500/20 text-purple-300' : 'bg-blue-500/20 text-blue-300'
        }`}>
          {isVibe ? 'Vibe' : 'AI'}
        </span>
        {modeToggle}
        <Tooltip content="Re-analyze this prompt">
          <button
            onClick={() => onAnalyze(true)}
            disabled={loading}
            className={`ml-auto p-0.5 rounded transition-colors disabled:opacity-40 ${
              isVibe
                ? 'text-purple-400/60 hover:text-purple-300 hover:bg-purple-500/10'
                : 'text-blue-400/60 hover:text-blue-300 hover:bg-blue-500/10'
            }`}
          >
            <svg className={`w-3 h-3 ${loading ? 'animate-spin' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
          </button>
        </Tooltip>
      </div>

      {/* Score */}
      <div className="flex items-center gap-2">
        <span className={`text-sm font-semibold ${scoreColor}`}>
          {isVibe
            ? (analysis.score >= 8 ? 'Great!' : analysis.score >= 5 ? 'Decent' : 'Needs work')
            : `Score: ${analysis.score}/10`
          }
        </span>
        <span className="text-[10px] text-gray-500">{analysis.score}/10</span>
      </div>

      {/* Explanation */}
      <div className="text-xs text-gray-300 leading-relaxed">
        {formatPanelText(analysis.explanation)}
      </div>

      {/* Suggested rewrite */}
      {analysis.rewrite && (
        <div className="pt-2 border-t border-gray-800/50">
          <div className="text-[10px] text-gray-500 mb-1 font-medium">
            {isVibe ? 'Try saying it like this' : 'Suggested Rewrite'}
          </div>
          <div className="relative bg-[#0d1117] border border-gray-800 rounded p-2 pr-8 text-xs text-gray-300 leading-relaxed">
            {formatPanelText(analysis.rewrite)}
            <button
              onClick={async () => {
                const ok = await copyToClipboard(analysis.rewrite);
                if (ok) toast('Copied to clipboard', 'success');
              }}
              className="absolute top-1 right-1 p-1 rounded bg-gray-800 hover:bg-gray-700 text-gray-400 hover:text-gray-200 transition-colors"
              title="Copy rewrite"
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
              </svg>
            </button>
          </div>
        </div>
      )}

      {/* Savings & comparison */}
      {(analysis.estimatedSavings || analysis.historyComparison) && (
        <div className="pt-2 border-t border-gray-800/50 flex flex-wrap items-center gap-x-3 gap-y-1">
          {analysis.estimatedSavings && (
            <div className="flex items-center gap-1 text-[10px]">
              <span className="text-gray-500">{isVibe ? 'Could save' : 'Savings'}</span>
              <span className="text-emerald-400 font-medium">{analysis.estimatedSavings}</span>
            </div>
          )}
          {analysis.estimatedSavings && analysis.historyComparison && (
            <span className="text-gray-700">|</span>
          )}
          {analysis.historyComparison && (
            <div className="flex items-center gap-1 text-[10px]">
              <span className="text-gray-500">{isVibe ? 'vs. usual' : 'Comparison'}</span>
              <span className="text-gray-300">{analysis.historyComparison}</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

