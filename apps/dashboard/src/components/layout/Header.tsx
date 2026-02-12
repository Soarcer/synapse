import { useState, useMemo, useRef, useCallback, useEffect } from 'react';
import { useAgentStore, projectCwd } from '../../store/agentStore';
import { wsClient } from '../../store/wsClient';
import { toast } from '../Toast';
import { ConfirmDialog } from '../ConfirmDialog';
import { useBreakpoint } from '../../hooks/useBreakpoint';
import type { TranscriptSummary } from '@synapse-ai/core';
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
  const cwdFilterActive = useAgentStore((s) => s.cwdFilterActive);
  const setCwdFilterActive = useAgentStore((s) => s.setCwdFilterActive);
  const events = useAgentStore((s) => s.events);
  const loadError = useAgentStore((s) => s.loadError);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const overflowRef = useRef<HTMLDivElement>(null);
  const [showClearConfirm, setShowClearConfirm] = useState(false);
  const [showOverflow, setShowOverflow] = useState(false);
  const bp = useBreakpoint();
  const isSmall = bp === 'sm';

  // Close overflow menu on outside click
  useEffect(() => {
    if (!showOverflow) return;
    const handleClick = (e: MouseEvent) => {
      if (overflowRef.current && !overflowRef.current.contains(e.target as Node)) {
        setShowOverflow(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [showOverflow]);

  const sessionList = useMemo(() => [...sessions.values()], [sessions]);

  const statusDot = {
    connected: 'bg-green-400',
    disconnected: 'bg-red-400',
    reconnecting: 'bg-yellow-400 animate-pulse',
    failed: 'bg-red-600',
  }[connectionStatus];

  const statusLabel = {
    connected: 'Connected',
    disconnected: 'Disconnected',
    reconnecting: 'Reconnecting...',
    failed: 'Connection Failed',
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

  // Banner flags
  const showServerBanner = connectionStatus === 'disconnected' || connectionStatus === 'reconnecting' || connectionStatus === 'failed' || !!loadError;
  const showEventCap = events.length >= 1000;

  return (
    <>
    <header role="banner" className={`flex items-center h-12 bg-[#161b22] border-b border-gray-800 flex-shrink-0 ${isSmall ? 'gap-2 px-2' : 'gap-4 px-4'}`}>
      {/* Title */}
      <div className="flex items-center gap-2">
        <span className="text-base font-bold text-gray-100 tracking-tight">Synapse</span>
        <span className="text-xs text-gray-600">v0.1</span>
      </div>

      {/* Connection status */}
      <div className="flex items-center gap-1.5 ml-2" role="status" aria-label={`Connection: ${statusLabel}`}>
        <span className={`w-2 h-2 rounded-full ${statusDot}`} aria-hidden="true" />
        {!isSmall && <span className="text-xs text-gray-500">{statusLabel}</span>}
        {connectionStatus === 'failed' && (
          <button
            onClick={() => wsClient.resetAndReconnect()}
            className="ml-1 px-2 py-0.5 text-[10px] bg-blue-600 hover:bg-blue-500 text-white rounded"
          >
            Reconnect
          </button>
        )}
      </div>

      {/* Project scope selector — hidden on small screens */}
      {projectCwd && !isSmall && (
        <select
          value={cwdFilterActive ? 'project' : 'all'}
          onChange={(e) => setCwdFilterActive(e.target.value === 'project')}
          className="bg-gray-900 border border-gray-700 rounded px-2 py-1 text-xs text-gray-300"
          title={cwdFilterActive ? `Filtered to: ${projectCwd}` : 'Showing all projects'}
        >
          <option value="project">This Project</option>
          <option value="all">All Projects</option>
        </select>
      )}

      {/* Pause indicator */}
      {paused && (
        <button
          onClick={() => setPaused(false)}
          className="px-2 py-0.5 bg-yellow-900/60 border border-yellow-600/40 rounded text-xs text-yellow-300 hover:bg-yellow-800/60 transition-colors"
        >
          Paused
        </button>
      )}

      {/* Analytics link */}
      <a
        href="?view=analytics"
        className="px-3 py-1 text-xs text-amber-400 hover:text-amber-200 bg-amber-900/20 hover:bg-amber-800/30 border border-amber-700/30 rounded transition-colors"
        title="Open Analytics Dashboard"
      >
        Analytics
      </a>

      <div className="flex-1" />

      {/* Keyboard shortcuts hint — large screens only */}
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

      {/* ── Toolbar buttons (inline on md+, overflow menu on sm) ── */}
      {!isSmall ? (
        <>
          <button
            onClick={() => setLayoutMode(layoutMode === 'graph' ? 'list' : 'graph')}
            className="px-3 py-1 text-xs text-gray-400 hover:text-gray-200 bg-gray-800 hover:bg-gray-700 rounded transition-colors"
            title="Toggle layout (L)"
          >
            {layoutMode === 'graph' ? 'List' : 'Graph'}
          </button>

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

          <button
            id="snapshot-export-btn"
            onClick={handleExport}
            className="px-3 py-1 text-xs text-green-400 hover:text-green-200 bg-green-900/30 hover:bg-green-800/40 border border-green-700/30 rounded transition-colors"
            title="Export snapshot (E)"
          >
            Export
          </button>

          <button
            onClick={() => fileInputRef.current?.click()}
            className="px-3 py-1 text-xs text-blue-400 hover:text-blue-200 bg-blue-900/30 hover:bg-blue-800/40 border border-blue-700/30 rounded transition-colors"
            title="Import snapshot (I)"
          >
            Import
          </button>

          <button
            onClick={() => setShowClearConfirm(true)}
            className="px-3 py-1 text-xs text-gray-400 hover:text-gray-200 bg-gray-800 hover:bg-gray-700 rounded transition-colors"
            aria-label="Clear all events"
          >
            Clear
          </button>
        </>
      ) : (
        /* ── Small-screen overflow menu ── */
        <div ref={overflowRef} className="relative">
          <button
            onClick={() => setShowOverflow(!showOverflow)}
            className="px-2 py-1 text-xs text-gray-400 hover:text-gray-200 bg-gray-800 hover:bg-gray-700 rounded transition-colors"
            aria-label="More options"
            aria-expanded={showOverflow}
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <circle cx="12" cy="5" r="1.5" fill="currentColor" stroke="none" />
              <circle cx="12" cy="12" r="1.5" fill="currentColor" stroke="none" />
              <circle cx="12" cy="19" r="1.5" fill="currentColor" stroke="none" />
            </svg>
          </button>

          {showOverflow && (
            <div className="absolute right-0 top-full mt-1 w-56 bg-[#1c2128] border border-gray-700 rounded-lg shadow-xl z-50 py-1 max-h-[70vh] overflow-auto">
              {/* View toggles */}
              <div className="px-2 py-1 text-[10px] text-gray-500 uppercase tracking-wider">View</div>
              <OverflowItem
                label={layoutMode === 'graph' ? 'Switch to List' : 'Switch to Graph'}
                shortcut="L"
                onClick={() => { setLayoutMode(layoutMode === 'graph' ? 'list' : 'graph'); setShowOverflow(false); }}
              />
              <OverflowToggle
                label="Lock Viewport"
                shortcut="V"
                active={lockViewport}
                onClick={() => setLockViewport(!lockViewport)}
              />
              <OverflowToggle
                label="Show All Tools"
                shortcut="F"
                active={showAllTools}
                onClick={() => setShowAllTools(!showAllTools)}
              />
              <OverflowToggle
                label="Collapse Prompts"
                shortcut="C"
                active={autoClosePrompts}
                onClick={() => setAutoClosePrompts(!autoClosePrompts)}
              />
              <OverflowToggle
                label="Show Hook Events"
                shortcut="H"
                active={showHookEvents}
                onClick={() => setShowHookEvents(!showHookEvents)}
              />

              {/* Session filter */}
              {sessionList.length > 0 && (
                <>
                  <div className="border-t border-gray-700 my-1" />
                  <div className="px-2 py-1 text-[10px] text-gray-500 uppercase tracking-wider">Session</div>
                  <div className="px-2 py-1">
                    <select
                      value={filter.sessionId ?? ''}
                      onChange={(e) => { setFilter({ ...filter, sessionId: e.target.value || undefined }); setShowOverflow(false); }}
                      className="w-full bg-gray-900 border border-gray-700 rounded px-2 py-1 text-xs text-gray-300"
                    >
                      <option value="">All sessions</option>
                      {sessionList.map((s) => (
                        <option key={s.sessionId} value={s.sessionId}>
                          {s.sessionId.slice(0, 8)}
                        </option>
                      ))}
                    </select>
                  </div>
                </>
              )}

              {/* Actions */}
              <div className="border-t border-gray-700 my-1" />
              <div className="px-2 py-1 text-[10px] text-gray-500 uppercase tracking-wider">Actions</div>
              <OverflowItem
                label="Export Snapshot"
                shortcut="E"
                className="text-green-400"
                onClick={() => { handleExport(); setShowOverflow(false); }}
              />
              <OverflowItem
                label="Import Snapshot"
                shortcut="I"
                className="text-blue-400"
                onClick={() => { fileInputRef.current?.click(); setShowOverflow(false); }}
              />
              <OverflowItem
                label="Clear All"
                className="text-red-400"
                onClick={() => { setShowClearConfirm(true); setShowOverflow(false); }}
              />
            </div>
          )}
        </div>
      )}

      {/* Hidden file input (always present for keyboard shortcut) */}
      <input
        id="snapshot-import-input"
        ref={fileInputRef}
        type="file"
        accept=".json"
        onChange={handleFileChange}
        className="hidden"
      />
      {/* Hidden export button for keyboard shortcut — only when inline button isn't rendered */}
      {isSmall && (
        <button id="snapshot-export-btn" onClick={handleExport} className="hidden" aria-hidden="true" />
      )}

      <ConfirmDialog
        open={showClearConfirm}
        title="Clear All Events"
        message="Clear all events? This cannot be undone."
        confirmLabel="Clear All"
        onConfirm={() => { clearEvents(); setShowClearConfirm(false); }}
        onCancel={() => setShowClearConfirm(false)}
      />
    </header>

    {/* Server-down banner */}
    {showServerBanner && (
      <div className="flex items-center gap-2 px-4 py-1.5 bg-red-950/60 border-b border-red-900/40 text-xs flex-shrink-0">
        {connectionStatus === 'reconnecting' && (
          <>
            <svg className="animate-spin h-3 w-3 text-yellow-400" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
            <span className="text-yellow-300">Server connection lost. Retrying...</span>
          </>
        )}
        {connectionStatus === 'failed' && (
          <>
            <span className="text-red-300">Connection failed.</span>
            <button
              onClick={() => wsClient.resetAndReconnect()}
              className="px-2 py-0.5 bg-blue-600 hover:bg-blue-500 text-white rounded text-[10px]"
            >
              Reconnect
            </button>
          </>
        )}
        {connectionStatus === 'disconnected' && !loadError && (
          <span className="text-gray-400">Disconnected from server.</span>
        )}
        {loadError && (
          <span className="text-red-300">Server not running. Start the server and refresh.</span>
        )}
      </div>
    )}

    {/* Event cap warning banner */}
    {showEventCap && (
      <div className="flex items-center gap-2 px-4 py-1 bg-blue-950/40 border-b border-blue-900/30 text-xs text-blue-300 flex-shrink-0">
        Showing last 1,000 events. Older events are available in the database.
      </div>
    )}
    </>
  );
}

/** A simple row in the overflow dropdown menu. */
function OverflowItem({ label, shortcut, className, onClick }: {
  label: string;
  shortcut?: string;
  className?: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`w-full flex items-center gap-2 px-3 py-1.5 text-xs hover:bg-gray-800/80 transition-colors text-left ${className ?? 'text-gray-300'}`}
    >
      <span className="flex-1">{label}</span>
      {shortcut && <kbd className="text-[10px] text-gray-600 bg-gray-800 px-1 rounded">{shortcut}</kbd>}
    </button>
  );
}

/** A toggle row in the overflow dropdown menu with active indicator. */
function OverflowToggle({ label, shortcut, active, onClick }: {
  label: string;
  shortcut?: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="w-full flex items-center gap-2 px-3 py-1.5 text-xs hover:bg-gray-800/80 transition-colors text-left text-gray-300"
      role="switch"
      aria-checked={active}
    >
      <span className={`w-2 h-2 rounded-full flex-shrink-0 ${active ? 'bg-green-400' : 'bg-gray-600'}`} />
      <span className="flex-1">{label}</span>
      {shortcut && <kbd className="text-[10px] text-gray-600 bg-gray-800 px-1 rounded">{shortcut}</kbd>}
    </button>
  );
}
