import { useState, useRef, useCallback } from 'react';
import { useAgentStore } from '../../store/agentStore';
import { wsClient } from '../../store/wsClient';
import { toast } from '../Toast';
import { ConfirmDialog } from '../ConfirmDialog';
import type { TranscriptSummary } from '@synapse-ai/core';
import { apiUrl } from '../../utils/api';
import { TimeFilterDropdown } from './TimeFilterDropdown';
import { SessionSelector } from './SessionSelector';
import { ViewSettingsDropdown } from './ViewSettingsDropdown';
import { KeyboardShortcutsTooltip } from './KeyboardShortcutsTooltip';
import { ActionsMenu } from './ActionsMenu';

export function Header() {
  const connectionStatus = useAgentStore((s) => s.connectionStatus);
  const filter = useAgentStore((s) => s.filter);
  const clearEvents = useAgentStore((s) => s.clearEvents);
  const paused = useAgentStore((s) => s.paused);
  const setPaused = useAgentStore((s) => s.setPaused);
  const events = useAgentStore((s) => s.events);
  const loadError = useAgentStore((s) => s.loadError);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const [showClearConfirm, setShowClearConfirm] = useState(false);

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
      JSON.parse(text);

      const resp = await fetch(apiUrl('/api/snapshot/import'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: text,
      });

      if (!resp.ok) throw new Error(`Import failed: ${resp.status}`);
      const result = await resp.json();

      if (result.allEvents && result.allEvents.length > 0) {
        useAgentStore.getState().loadEvents(result.allEvents);
      }

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
      e.target.value = '';
    }
  }, [handleImport]);

  // Banner flags
  const showServerBanner = connectionStatus === 'disconnected' || connectionStatus === 'reconnecting' || connectionStatus === 'failed' || !!loadError;
  const showEventCap = events.length >= 1000;

  return (
    <>
    <header role="banner" className="flex items-center h-12 bg-[#161b22] border-b border-gray-800 flex-shrink-0 gap-3 px-4">
      {/* Brand + connection dot */}
      <div className="flex items-center gap-2" role="status" aria-label={`Connection: ${statusLabel}`}>
        <span className="text-base font-bold text-gray-100 tracking-tight">Synapse</span>
        <span className={`w-2 h-2 rounded-full ${statusDot}`} title={statusLabel} />
        {connectionStatus === 'failed' && (
          <button
            onClick={() => wsClient.resetAndReconnect()}
            className="px-2 py-0.5 text-[10px] bg-blue-600 hover:bg-blue-500 text-white rounded"
          >
            Reconnect
          </button>
        )}
      </div>

      {/* Paused badge */}
      {paused && (
        <button
          onClick={() => setPaused(false)}
          className="px-2 py-0.5 bg-yellow-900/60 border border-yellow-600/40 rounded text-xs text-yellow-300 hover:bg-yellow-800/60 transition-colors"
        >
          Paused
        </button>
      )}

      <div className="flex-1" />

      {/* Time filter */}
      <TimeFilterDropdown />

      {/* Session selector */}
      <SessionSelector />

      {/* Analytics link */}
      <a
        href="?view=analytics"
        className="px-2.5 py-1 text-xs text-amber-400 hover:text-amber-200 bg-amber-900/20 hover:bg-amber-800/30 border border-amber-700/30 rounded transition-colors"
        title="Open Analytics Dashboard"
      >
        Analytics
      </a>

      {/* View settings */}
      <ViewSettingsDropdown />

      {/* Keyboard shortcuts help */}
      <KeyboardShortcutsTooltip />

      {/* Actions menu */}
      <ActionsMenu
        onExport={handleExport}
        onImportClick={() => fileInputRef.current?.click()}
        onClear={() => setShowClearConfirm(true)}
      />

      {/* Hidden file input for import */}
      <input
        id="snapshot-import-input"
        ref={fileInputRef}
        type="file"
        accept=".json"
        onChange={handleFileChange}
        className="hidden"
      />

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
