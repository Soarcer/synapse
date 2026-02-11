import { useState, useMemo, useRef, useCallback } from 'react';
import { useAgentStore } from '../../store/agentStore';
import { toast } from '../Toast';
import { ConfirmDialog } from '../ConfirmDialog';
import type { TranscriptSummary } from '../../types/transcript';
import { apiUrl } from '../../utils/api';

export function Header() {
  const connectionStatus = useAgentStore((s) => s.connectionStatus);
  const sessions = useAgentStore((s) => s.sessions);
  const filter = useAgentStore((s) => s.filter);
  const setFilter = useAgentStore((s) => s.setFilter);
  const clearEvents = useAgentStore((s) => s.clearEvents);
  const paused = useAgentStore((s) => s.paused);
  const setPaused = useAgentStore((s) => s.setPaused);
  const layoutMode = useAgentStore((s) => s.layoutMode);
  const setLayoutMode = useAgentStore((s) => s.setLayoutMode);
  const showHookEvents = useAgentStore((s) => s.showHookEvents);
  const setShowHookEvents = useAgentStore((s) => s.setShowHookEvents);
  const showAllTools = useAgentStore((s) => s.showAllTools);
  const setShowAllTools = useAgentStore((s) => s.setShowAllTools);
  const lockViewport = useAgentStore((s) => s.lockViewport);
  const setLockViewport = useAgentStore((s) => s.setLockViewport);
  const autoClosePrompts = useAgentStore((s) => s.autoClosePrompts);
  const setAutoClosePrompts = useAgentStore((s) => s.setAutoClosePrompts);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const [showClearConfirm, setShowClearConfirm] = useState(false);

  const sessionList = useMemo(() => [...sessions.values()], [sessions]);

  const statusDot = {
    connected: 'bg-green-400',
    disconnected: 'bg-red-400',
    reconnecting: 'bg-yellow-400 animate-pulse',
  }[connectionStatus];

  const statusLabel = {
    connected: 'Connected',
    disconnected: 'Disconnected',
    reconnecting: 'Reconnecting...',
  }[connectionStatus];

  // ── Export ────────────────────────────────────────────────
  const handleExport = useCallback(async () => {
    try {
      const sessionId = filter.sessionId;
      const url = sessionId
        ? apiUrl(`/api/snapshot/export?sessionId=${encodeURIComponent(sessionId)}`)
        : apiUrl('/api/snapshot/export');
      const resp = await fetch(url);
      if (!resp.ok) throw new Error(`Export failed: ${resp.status}`);
      const blob = await resp.blob();
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `synapse-snapshot-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
      a.click();
      URL.revokeObjectURL(a.href);
      toast('Snapshot exported', 'info');
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      toast(`Export failed: ${message}`, 'error');
    }
  }, [filter.sessionId]);

  // ── Import ────────────────────────────────────────────────
  const handleImport = useCallback(async (file: File) => {
    try {
      const text = await file.text();
      JSON.parse(text); // validate JSON

      // Send to server for DB persistence
      const resp = await fetch(apiUrl('/api/snapshot/import'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: text,
      });

      if (!resp.ok) throw new Error(`Import failed: ${resp.status}`);
      const result = await resp.json();

      // Replay events into the store
      if (result.allEvents && result.allEvents.length > 0) {
        useAgentStore.getState().loadEvents(result.allEvents);
      }

      // Load transcripts into the store
      if (result.transcripts) {
        for (const { sessionId, transcript } of result.transcripts) {
          if (transcript) {
            useAgentStore.getState().setTranscript(sessionId, transcript as TranscriptSummary);
          }
        }
      }

      toast(`Imported ${result.sessions} session(s), ${result.events} events`, 'info');
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      toast(`Import failed: ${message}`, 'error');
    }
  }, []);

  const handleFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      handleImport(file);
      e.target.value = ''; // reset for re-import
    }
  }, [handleImport]);

  return (
    <header className="flex items-center gap-4 px-4 h-12 bg-[#161b22] border-b border-gray-800 flex-shrink-0">
      {/* Title */}
      <div className="flex items-center gap-2">
        <span className="text-base font-bold text-gray-100 tracking-tight">Synapse</span>
        <span className="text-xs text-gray-600">v0.1</span>
      </div>

      {/* Connection status */}
      <div className="flex items-center gap-1.5 ml-2">
        <span className={`w-2 h-2 rounded-full ${statusDot}`} />
        <span className="text-xs text-gray-500">{statusLabel}</span>
      </div>

      {/* Pause indicator */}
      {paused && (
        <button
          onClick={() => setPaused(false)}
          className="px-2 py-0.5 bg-yellow-900/60 border border-yellow-600/40 rounded text-xs text-yellow-300 hover:bg-yellow-800/60 transition-colors"
        >
          Paused
        </button>
      )}

      <div className="flex-1" />

      {/* Keyboard shortcuts hint */}
      <div className="hidden lg:flex items-center gap-3 text-[10px] text-gray-600">
        <span>1-9 lens</span>
        <span>T log</span>
        <span>L layout</span>
        <span>V lock</span>
        <span>F tools</span>
        <span>H hooks</span>
        <span>C collapse</span>
        <span>E export</span>
        <span>I import</span>
        <span>Space pause</span>
      </div>

      {/* Layout toggle */}
      <button
        onClick={() => setLayoutMode(layoutMode === 'graph' ? 'list' : 'graph')}
        className="px-3 py-1 text-xs text-gray-400 hover:text-gray-200 bg-gray-800 hover:bg-gray-700 rounded transition-colors"
        title="Toggle layout (L)"
      >
        {layoutMode === 'graph' ? 'List' : 'Graph'}
      </button>

      {/* Lock viewport toggle */}
      <button
        onClick={() => setLockViewport(!lockViewport)}
        className={`px-3 py-1 text-xs rounded transition-colors ${
          lockViewport
            ? 'text-blue-300 bg-blue-900/50 hover:bg-blue-800/50 border border-blue-600/40'
            : 'text-gray-400 hover:text-gray-200 bg-gray-800 hover:bg-gray-700'
        }`}
        title="Lock viewport — prevent auto-zoom on new nodes (V)"
      >
        {lockViewport ? 'Locked' : 'Lock'}
      </button>

      {/* Show all tools toggle */}
      <button
        onClick={() => setShowAllTools(!showAllTools)}
        className={`px-3 py-1 text-xs rounded transition-colors ${
          showAllTools
            ? 'text-purple-300 bg-purple-900/50 hover:bg-purple-800/50 border border-purple-600/40'
            : 'text-gray-400 hover:text-gray-200 bg-gray-800 hover:bg-gray-700'
        }`}
        title="Show all tool nodes (F)"
      >
        {showAllTools ? 'Tools ON' : 'Tools'}
      </button>

      {/* Auto-close prompts toggle */}
      <button
        onClick={() => setAutoClosePrompts(!autoClosePrompts)}
        className={`px-3 py-1 text-xs rounded transition-colors ${
          autoClosePrompts
            ? 'text-cyan-300 bg-cyan-900/50 hover:bg-cyan-800/50 border border-cyan-600/40'
            : 'text-gray-400 hover:text-gray-200 bg-gray-800 hover:bg-gray-700'
        }`}
        title="Auto-collapse prompt children (C)"
      >
        {autoClosePrompts ? 'Collapse ON' : 'Collapse'}
      </button>

      {/* Hook events toggle */}
      <button
        onClick={() => setShowHookEvents(!showHookEvents)}
        className={`px-3 py-1 text-xs rounded transition-colors ${
          showHookEvents
            ? 'text-gray-400 hover:text-gray-200 bg-gray-800 hover:bg-gray-700'
            : 'text-amber-300 bg-amber-900/50 hover:bg-amber-800/50 border border-amber-600/40'
        }`}
        title="Toggle hook event visibility (H)"
      >
        {showHookEvents ? 'Hide Hooks' : 'Hooks Hidden'}
      </button>

      {/* Session filter */}
      {sessionList.length > 0 && (
        <select
          value={filter.sessionId ?? ''}
          onChange={(e) => setFilter({ ...filter, sessionId: e.target.value || undefined })}
          className="bg-gray-900 border border-gray-700 rounded px-2 py-1 text-xs text-gray-300"
        >
          <option value="">All sessions</option>
          {sessionList.map((s) => (
            <option key={s.sessionId} value={s.sessionId}>
              {s.sessionId.slice(0, 8)}
            </option>
          ))}
        </select>
      )}

      {/* Export */}
      <button
        id="snapshot-export-btn"
        onClick={handleExport}
        className="px-3 py-1 text-xs text-green-400 hover:text-green-200 bg-green-900/30 hover:bg-green-800/40 border border-green-700/30 rounded transition-colors"
        title="Export snapshot (E)"
      >
        Export
      </button>

      {/* Import */}
      <button
        onClick={() => fileInputRef.current?.click()}
        className="px-3 py-1 text-xs text-blue-400 hover:text-blue-200 bg-blue-900/30 hover:bg-blue-800/40 border border-blue-700/30 rounded transition-colors"
        title="Import snapshot (I)"
      >
        Import
      </button>
      <input
        id="snapshot-import-input"
        ref={fileInputRef}
        type="file"
        accept=".json"
        onChange={handleFileChange}
        className="hidden"
      />

      {/* Clear */}
      <button
        onClick={() => setShowClearConfirm(true)}
        className="px-3 py-1 text-xs text-gray-400 hover:text-gray-200 bg-gray-800 hover:bg-gray-700 rounded transition-colors"
      >
        Clear
      </button>

      <ConfirmDialog
        open={showClearConfirm}
        title="Clear All Events"
        message="Clear all events? This cannot be undone."
        confirmLabel="Clear All"
        onConfirm={() => { clearEvents(); setShowClearConfirm(false); }}
        onCancel={() => setShowClearConfirm(false)}
      />
    </header>
  );
}
