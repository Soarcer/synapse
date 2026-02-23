// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Synapse Contributors

import { useState, useCallback, useMemo, useRef, useEffect } from 'react';
import { useAgentStore } from '../../store/agentStore';
import { apiUrl } from '../../utils/api';
import { toast } from '../Toast';

const AVAILABLE_TOOLS = [
  'Read',
  'Write',
  'Edit',
  'Bash',
  'Glob',
  'Grep',
  'WebSearch',
  'WebFetch',
  'Task',
];

export function SpawnAgentDialog() {
  const showSpawnDialog = useAgentStore((s) => s.showSpawnDialog);
  const setShowSpawnDialog = useAgentStore((s) => s.setShowSpawnDialog);
  const sessions = useAgentStore((s) => s.sessions);

  // Build session list for the dropdown
  const sessionList = useMemo(() => [...sessions.values()], [sessions]);
  const latestSessionId = useMemo(() => {
    const running = sessionList.filter((s) => s.status === 'running');
    if (running.length > 0) return running[running.length - 1].sessionId;
    if (sessionList.length > 0) return sessionList[sessionList.length - 1].sessionId;
    return '';
  }, [sessionList]);

  const [prompt, setPrompt] = useState('');
  const [model, setModel] = useState<'opus' | 'sonnet' | 'haiku'>('sonnet');
  const [targetSessionId, setTargetSessionId] = useState('');
  const [tools, setTools] = useState<Set<string>>(
    new Set(['Read', 'Edit', 'Bash', 'Glob', 'Grep']),
  );
  const [permissionMode, setPermissionMode] = useState<'acceptEdits' | 'bypassPermissions'>(
    'acceptEdits',
  );
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [systemPrompt, setSystemPrompt] = useState('');
  const [cwd, setCwd] = useState('');
  const [spawning, setSpawning] = useState(false);

  const toggleTool = useCallback((tool: string) => {
    setTools((prev) => {
      const next = new Set(prev);
      if (next.has(tool)) next.delete(tool);
      else next.add(tool);
      return next;
    });
  }, []);

  const handleSpawn = useCallback(async () => {
    if (!prompt.trim()) return;
    setSpawning(true);
    try {
      const sid = targetSessionId || latestSessionId;
      await fetch(apiUrl('/api/agents/spawn'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: prompt.trim(),
          model,
          tools: [...tools],
          permissionMode,
          ...(sid ? { sessionId: sid } : {}),
          ...(systemPrompt.trim() ? { systemPrompt: systemPrompt.trim() } : {}),
          ...(cwd.trim() ? { cwd: cwd.trim() } : {}),
        }),
      });
      setShowSpawnDialog(false);
      setPrompt('');
      setSystemPrompt('');
      setCwd('');
    } catch {
      toast('Failed to spawn agent', 'error');
    } finally {
      setSpawning(false);
    }
  }, [
    prompt,
    model,
    tools,
    permissionMode,
    systemPrompt,
    cwd,
    targetSessionId,
    latestSessionId,
    setShowSpawnDialog,
  ]);

  const promptRef = useRef<HTMLTextAreaElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);

  // Auto-focus the prompt textarea when dialog opens
  useEffect(() => {
    if (showSpawnDialog) {
      setTimeout(() => promptRef.current?.focus(), 50);
    }
  }, [showSpawnDialog]);

  // Escape key + focus trap
  useEffect(() => {
    if (!showSpawnDialog) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setShowSpawnDialog(false);
        return;
      }
      // Focus trap: cycle Tab within dialog
      if (e.key === 'Tab' && dialogRef.current) {
        const focusable = dialogRef.current.querySelectorAll<HTMLElement>(
          'button:not([disabled]), textarea, input, select, [tabindex]:not([tabindex="-1"])',
        );
        if (focusable.length === 0) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          last.focus();
          e.preventDefault();
        } else if (!e.shiftKey && document.activeElement === last) {
          first.focus();
          e.preventDefault();
        }
      }
    };
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [showSpawnDialog, setShowSpawnDialog]);

  if (!showSpawnDialog) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
      role="dialog"
      aria-modal="true"
      aria-labelledby="spawn-dialog-title"
      onClick={() => setShowSpawnDialog(false)}
    >
      <div
        ref={dialogRef}
        className="bg-[#161b22] border border-gray-700 rounded-xl shadow-2xl w-full max-w-lg mx-4"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-800">
          <h2 id="spawn-dialog-title" className="text-base font-semibold text-gray-100">
            Spawn Agent
          </h2>
          <button
            onClick={() => setShowSpawnDialog(false)}
            className="text-gray-500 hover:text-gray-300 text-xl leading-none"
            aria-label="Close dialog"
          >
            &times;
          </button>
        </div>

        {/* Body */}
        <div className="px-5 py-4 space-y-4 max-h-[70vh] overflow-auto">
          {/* Prompt */}
          <div>
            <label className="text-xs text-gray-400 block mb-1">Prompt *</label>
            <textarea
              ref={promptRef}
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="What should the agent do?"
              rows={3}
              className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-200 placeholder-gray-600 focus:outline-none focus:border-blue-500 resize-none"
            />
          </div>

          {/* Model */}
          <div>
            <label className="text-xs text-gray-400 block mb-1">Model</label>
            <select
              value={model}
              onChange={(e) => setModel(e.target.value as 'opus' | 'sonnet' | 'haiku')}
              className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-200"
            >
              <option value="opus">Claude Opus</option>
              <option value="sonnet">Claude Sonnet</option>
              <option value="haiku">Claude Haiku</option>
            </select>
          </div>

          {/* Tools */}
          <div>
            <label className="text-xs text-gray-400 block mb-1.5">Tools</label>
            <div className="flex flex-wrap gap-2">
              {AVAILABLE_TOOLS.map((tool) => (
                <button
                  key={tool}
                  onClick={() => toggleTool(tool)}
                  aria-pressed={tools.has(tool)}
                  className={`
                    px-2.5 py-1 rounded-full text-xs border transition-colors
                    ${
                      tools.has(tool)
                        ? 'bg-blue-900/50 border-blue-500/50 text-blue-300'
                        : 'bg-gray-900 border-gray-700 text-gray-500 hover:text-gray-300'
                    }
                  `}
                >
                  {tool}
                </button>
              ))}
            </div>
          </div>

          {/* Permission mode */}
          <div>
            <label className="text-xs text-gray-400 block mb-1">Permission Mode</label>
            <select
              value={permissionMode}
              onChange={(e) =>
                setPermissionMode(e.target.value as 'acceptEdits' | 'bypassPermissions')
              }
              className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-200"
            >
              <option value="acceptEdits">Accept Edits (recommended)</option>
              <option value="bypassPermissions">Bypass Permissions</option>
            </select>
          </div>

          {/* Session */}
          {sessionList.length > 0 && (
            <div>
              <label className="text-xs text-gray-400 block mb-1">Attach to Session</label>
              <select
                value={targetSessionId || latestSessionId}
                onChange={(e) => setTargetSessionId(e.target.value)}
                className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-200"
              >
                {sessionList.map((s) => (
                  <option key={s.sessionId} value={s.sessionId}>
                    {s.sessionId.slice(0, 12)} {s.status === 'running' ? '(active)' : ''}
                  </option>
                ))}
                <option value="">New session</option>
              </select>
            </div>
          )}

          {/* Advanced */}
          <button
            onClick={() => setShowAdvanced(!showAdvanced)}
            aria-expanded={showAdvanced}
            className="text-xs text-gray-500 hover:text-gray-300 transition-colors"
          >
            {showAdvanced ? '▾' : '▸'} Advanced options
          </button>

          {showAdvanced && (
            <div className="space-y-3 pl-2 border-l-2 border-gray-800">
              <div>
                <label className="text-xs text-gray-400 block mb-1">System Prompt</label>
                <textarea
                  value={systemPrompt}
                  onChange={(e) => setSystemPrompt(e.target.value)}
                  placeholder="Optional system prompt..."
                  rows={2}
                  className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-200 placeholder-gray-600 focus:outline-none focus:border-blue-500 resize-none"
                />
              </div>
              <div>
                <label className="text-xs text-gray-400 block mb-1">Working Directory</label>
                <input
                  type="text"
                  value={cwd}
                  onChange={(e) => setCwd(e.target.value)}
                  placeholder="Defaults to project root"
                  className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-200 placeholder-gray-600 focus:outline-none focus:border-blue-500"
                />
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 px-5 py-3 border-t border-gray-800">
          <button
            onClick={() => setShowSpawnDialog(false)}
            className="px-4 py-2 rounded-lg text-sm text-gray-400 hover:text-gray-200 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSpawn}
            disabled={!prompt.trim() || spawning}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-500 disabled:bg-gray-700 disabled:text-gray-500 rounded-lg text-sm text-white font-medium transition-colors"
          >
            {spawning ? 'Spawning...' : 'Spawn Agent'}
          </button>
        </div>
      </div>
    </div>
  );
}
