// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Bernhard

import { useState, useRef, useCallback, useEffect } from 'react';
import { useAgentStore } from '../../store/agentStore';
import { GAME_MODE_REGISTRY } from '../graph/nodes/game-modes';
import { wsClient } from '../../store/wsClient';
import { toast } from '../Toast';
import { ConfirmDialog } from '../ConfirmDialog';
import type { TranscriptSummary } from '@synapse-ai/core';
import { apiUrl } from '../../utils/api';
import { Tooltip } from '../ui/Tooltip';
import { Features } from '@synapse-ai/core';
import { TimeFilterDropdown } from './TimeFilterDropdown';
import { SessionSelector } from './SessionSelector';
import { ViewSettingsDropdown } from './ViewSettingsDropdown';
import { KeyboardShortcutsTooltip } from './KeyboardShortcutsTooltip';
import { GraphStats } from './GraphStats';
import { HookControlsTab } from '../settings/HookControlsTab';

export function Header() {
  const connectionStatus = useAgentStore((s) => s.connectionStatus);
  const filter = useAgentStore((s) => s.filter);
  const clearEvents = useAgentStore((s) => s.clearEvents);
  const paused = useAgentStore((s) => s.paused);
  const setPaused = useAgentStore((s) => s.setPaused);
  const events = useAgentStore((s) => s.events);
  const loadError = useAgentStore((s) => s.loadError);
  const cwdFilter = useAgentStore((s) => s.cwdFilter);
  const setCwdFilter = useAgentStore((s) => s.setCwdFilter);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const [showClearConfirm, setShowClearConfirm] = useState(false);
  const [projects, setProjects] = useState<string[]>([]);
  const [hookControlsOpen, setHookControlsOpen] = useState(false);

  // Fetch project list; refresh when connection status changes to 'connected'
  useEffect(() => {
    fetch(apiUrl('/api/events/projects'))
      .then((r) => r.json())
      .then((data: { projects?: string[] }) => setProjects(data.projects ?? []))
      .catch(() => {});
  }, [connectionStatus]);

  // Easter egg: 7 rapid clicks on the Synapse title
  const clickTimesRef = useRef<number[]>([]);
  const handleTitleClick = useCallback(() => {
    const now = Date.now();
    clickTimesRef.current.push(now);
    // Keep only clicks within last 2 seconds
    clickTimesRef.current = clickTimesRef.current.filter((t) => now - t < 2000);
    if (clickTimesRef.current.length >= 7) {
      clickTimesRef.current = [];
      const store = useAgentStore.getState();
      if (store.arcadeMode) return;
      store.setArcadeUnlocked(true);
      store.setArcadeMode(true);
      store.setShowAllTools(true);
      const modes = GAME_MODE_REGISTRY.map((m) => m.id);
      store.setToolGroupMode(modes[Math.floor(Math.random() * modes.length)]);
      toast('SECRET UNLOCKED — Arcade mode activated!', 'info');
    }
  }, []);

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

  const handleFileChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) {
        handleImport(file);
        e.target.value = '';
      }
    },
    [handleImport],
  );

  // Banner flags
  const showServerBanner =
    connectionStatus === 'disconnected' ||
    connectionStatus === 'reconnecting' ||
    connectionStatus === 'failed' ||
    !!loadError;
  const showEventCap = events.length >= 1000;

  return (
    <>
      <header
        role="banner"
        className="relative z-40 flex items-center h-12 bg-syn-bg-surface border-b border-gray-800 flex-shrink-0 gap-3 px-4"
      >
        {/* Brand + connection dot */}
        <div
          className="flex items-center gap-2 connection-status"
          role="status"
          aria-label={`Connection: ${statusLabel}`}
        >
          <span
            className="text-base font-bold text-gray-100 tracking-tight cursor-default select-none"
            onClick={handleTitleClick}
          >
            Synapse
          </span>
          <Tooltip content={statusLabel}>
            <span className={`w-2 h-2 rounded-full ${statusDot}`} />
          </Tooltip>
          {connectionStatus === 'failed' && (
            <Tooltip content="Reconnect to server">
              <button
                onClick={() => wsClient.resetAndReconnect()}
                className="px-2 py-0.5 text-[10px] bg-blue-600 hover:bg-blue-500 text-white rounded"
              >
                Reconnect
              </button>
            </Tooltip>
          )}
        </div>

        {/* Paused badge */}
        {paused && (
          <Tooltip content="Resume live updates" shortcut="Space">
            <button
              onClick={() => setPaused(false)}
              className="px-2 py-0.5 bg-yellow-900/60 border border-yellow-600/40 rounded text-xs text-yellow-300 hover:bg-yellow-800/60 transition-colors"
            >
              Paused
            </button>
          </Tooltip>
        )}

        {/* Graph stats */}
        <GraphStats />

        <div className="flex-1" />

        {/* Project filter */}
        {projects.length > 0 && (
          <div className="flex items-center gap-1.5">
            <span className="text-xs text-white/40 select-none">Project</span>
            <select
              value={cwdFilter ?? ''}
              onChange={(e) => setCwdFilter(e.target.value || null)}
              className="text-xs border border-white/20 rounded px-2 py-1 hover:border-white/40 cursor-pointer"
              style={{ background: '#1e1e2e', color: 'rgba(255,255,255,0.8)' }}
              title={cwdFilter ?? 'All projects'}
            >
              <option value="" style={{ background: '#1e1e2e', color: '#cdd6f4' }}>
                All projects
              </option>
              {projects.map((p) => (
                <option
                  key={p}
                  value={p}
                  title={p}
                  style={{ background: '#1e1e2e', color: '#cdd6f4' }}
                >
                  {p.split(/[/\\]/).pop() ?? p}
                </option>
              ))}
            </select>
          </div>
        )}

        {/* Time filter */}

        <TimeFilterDropdown />

        {/* Session selector */}
        <SessionSelector />

        {/* Prompt Lab button */}
        {Features.promptLab && (
          <Tooltip content="Open Prompt Lab" shortcut="W">
            <button
              onClick={() => useAgentStore.getState().setShowWorkshop(true)}
              className="px-2.5 py-1 text-xs text-purple-400 hover:text-purple-200 bg-purple-900/20 hover:bg-purple-800/30 border border-purple-700/30 rounded transition-colors"
            >
              Prompt Lab
            </button>
          </Tooltip>
        )}

        {Features.analyticsDeep && (
          <Tooltip content="Open Analytics Dashboard">
            <a
              href="?view=analytics"
              className="px-2.5 py-1 text-xs text-amber-400 hover:text-amber-200 bg-amber-900/20 hover:bg-amber-800/30 border border-amber-700/30 rounded transition-colors"
            >
              Analytics
            </a>
          </Tooltip>
        )}

        {/* Keyboard shortcuts help */}
        <KeyboardShortcutsTooltip />

        {/* Hook Controls */}
        <Tooltip content="Hook Controls">
          <button
            onClick={() => setHookControlsOpen(true)}
            className="flex items-center justify-center w-7 h-7 rounded text-gray-400 hover:text-gray-200 bg-gray-800 hover:bg-gray-700 transition-colors"
            aria-label="Hook Controls"
          >
            <svg
              className="w-3.5 h-3.5"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z"
              />
            </svg>
          </button>
        </Tooltip>

        {/* View settings & actions */}
        <ViewSettingsDropdown
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
          onConfirm={() => {
            clearEvents();
            setShowClearConfirm(false);
          }}
          onCancel={() => setShowClearConfirm(false)}
        />
      </header>

      <HookControlsTab open={hookControlsOpen} onClose={() => setHookControlsOpen(false)} />

      {/* Server-down banner */}
      {showServerBanner && (
        <div className="flex items-center gap-2 px-4 py-1.5 bg-red-950/60 border-b border-red-900/40 text-xs flex-shrink-0">
          {connectionStatus === 'reconnecting' && (
            <>
              <svg className="animate-spin h-3 w-3 text-yellow-400" viewBox="0 0 24 24">
                <circle
                  className="opacity-25"
                  cx="12"
                  cy="12"
                  r="10"
                  stroke="currentColor"
                  strokeWidth="4"
                  fill="none"
                />
                <path
                  className="opacity-75"
                  fill="currentColor"
                  d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
                />
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
