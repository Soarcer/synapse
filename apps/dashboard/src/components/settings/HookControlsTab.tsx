// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Bernhard

import { useState, useEffect, useCallback } from 'react';
import { apiUrl } from '../../utils/api';
import { QRCodePanel } from './QRCodePanel';
import { PushSetup } from './PushSetup';
import { usePermissionStore } from '../../store/permissionStore';
import { Features } from '@synapse-ai/core';
import { projectCwd } from '../../store/agentStore';

interface Props {
  open: boolean;
  onClose: () => void;
}

interface HookConfig {
  observation: boolean;
  remoteApproval: boolean;
  cwd: string;
}

type UiState = 'loading' | 'ready' | 'saving' | 'error' | 'no-project';

export function HookControlsTab({ open, onClose }: Props) {
  const [config, setConfig] = useState<HookConfig | null>(null);
  const [hookServerRunning, setHookServerRunning] = useState(false);
  const [uiState, setUiState] = useState<UiState>('loading');
  const [error, setError] = useState<string | null>(null);
  const resolved = usePermissionStore((s) => s.resolved);

  // Resolve cwd — use projectCwd from URL, fallback to most recent session
  const resolveCwd = useCallback(async (): Promise<string | null> => {
    if (projectCwd) return projectCwd;
    try {
      // Server returns up to 500 sessions; we only need the first one
      const res = await fetch(apiUrl('/api/events/sessions'));
      if (!res.ok) return null;
      const sessions = await res.json();
      if (Array.isArray(sessions) && sessions.length > 0 && sessions[0].cwd) {
        return sessions[0].cwd;
      }
    } catch {
      /* ok */
    }
    return null;
  }, []);

  // Fetch hook config + hook server status on open
  useEffect(() => {
    if (!open) return;
    let cancelled = false;

    async function load() {
      setUiState('loading');
      setError(null);

      // Fetch hook server status in parallel
      const hookStatusP = fetch(apiUrl('/api/hook-server/status'))
        .then((r) => r.json())
        .then((d: Record<string, unknown>) => d.running === true)
        .catch(() => false);

      const cwd = await resolveCwd();
      if (cancelled) return;

      if (!cwd) {
        setUiState('no-project');
        setHookServerRunning(await hookStatusP);
        return;
      }

      try {
        const [hookRunning, configRes] = await Promise.all([
          hookStatusP,
          fetch(apiUrl(`/api/hook-config?cwd=${encodeURIComponent(cwd)}`)),
        ]);
        if (cancelled) return;

        setHookServerRunning(hookRunning);

        if (configRes.ok) {
          const data: HookConfig = await configRes.json();
          setConfig(data);
          setUiState('ready');
        } else {
          const err = await configRes.json().catch(() => ({ error: 'Unknown error' }));
          setError((err as Record<string, string>).error ?? 'Failed to load hook config');
          setUiState('error');
        }
      } catch {
        if (!cancelled) {
          setError('Could not reach server');
          setUiState('error');
        }
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [open, resolveCwd]);

  // Toggle handler
  const handleToggle = useCallback(
    async (field: 'observation' | 'remoteApproval') => {
      if (!config) return;

      const prev = { ...config };
      const next = { ...config, [field]: !config[field] };

      // Dependency: enabling remoteApproval auto-enables observation
      if (field === 'remoteApproval' && !config.remoteApproval) {
        next.observation = true;
      }
      // Dependency: disabling observation auto-disables remoteApproval
      if (field === 'observation' && config.observation) {
        next.remoteApproval = false;
      }

      setConfig(next);
      setUiState('saving');
      setError(null);

      try {
        const res = await fetch(apiUrl('/api/hook-config'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            cwd: config.cwd,
            observation: next.observation,
            remoteApproval: next.remoteApproval,
          }),
        });

        if (res.ok) {
          const data = await res.json();
          setConfig({
            cwd: config.cwd,
            observation: data.observation,
            remoteApproval: data.remoteApproval,
          });
          setUiState('ready');
        } else {
          const err = await res.json().catch(() => ({ error: 'Unknown error' }));
          setConfig(prev); // revert
          setError((err as Record<string, string>).error ?? 'Failed to update hooks');
          setUiState('error');
        }
      } catch {
        setConfig(prev); // revert
        setError('Could not reach server');
        setUiState('error');
      }
    },
    [config],
  );

  if (!open) return null;

  const approved = resolved.filter((r) => r.behavior === 'allow').length;
  const denied = resolved.filter((r) => r.behavior === 'deny').length;
  const isSaving = uiState === 'saving';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="bg-syn-bg-elevated border border-gray-700 rounded-xl shadow-2xl w-full max-w-lg max-h-[85vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-700/50">
          <h2 className="text-sm font-semibold text-gray-200">Hook Controls</h2>
          <button
            onClick={onClose}
            className="text-gray-500 hover:text-gray-300 transition-colors"
            aria-label="Close"
          >
            <svg
              className="w-4 h-4"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="p-5 space-y-6">
          {/* QR Code section */}
          <QRCodePanel />

          {/* Hook Setup */}
          <section>
            <h3 className="text-xs text-gray-500 uppercase tracking-wider mb-3">Hook Setup</h3>

            {uiState === 'loading' && (
              <div className="space-y-3">
                <div className="h-10 bg-gray-800/50 rounded-lg animate-pulse" />
                <div className="h-10 bg-gray-800/50 rounded-lg animate-pulse" />
              </div>
            )}

            {uiState === 'no-project' && (
              <p className="text-xs text-gray-500 italic">
                No project detected. Open Synapse from a project directory to configure hooks.
              </p>
            )}

            {(uiState === 'ready' || uiState === 'saving' || uiState === 'error') && config && (
              <div className="space-y-3">
                {/* Observation toggle */}
                <div className="flex items-center justify-between rounded-lg bg-gray-800/30 px-3 py-2.5">
                  <div className="flex items-center gap-2">
                    <span
                      className={`w-2 h-2 rounded-full ${config.observation ? 'bg-green-400' : 'bg-gray-600'}`}
                    />
                    <div>
                      <p className="text-xs text-gray-200 font-medium">Observation Hooks</p>
                      <p className="text-[10px] text-gray-500">
                        Monitor sessions, tools, and agent activity
                      </p>
                    </div>
                  </div>
                  <button
                    onClick={() => handleToggle('observation')}
                    disabled={isSaving}
                    className={`relative w-9 h-5 rounded-full transition-colors ${
                      config.observation ? 'bg-green-600' : 'bg-gray-600'
                    } ${isSaving ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
                    aria-label={
                      config.observation ? 'Disable observation hooks' : 'Enable observation hooks'
                    }
                  >
                    <span
                      className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${
                        config.observation ? 'translate-x-4' : ''
                      }`}
                    />
                  </button>
                </div>

                {/* Remote Approval toggle */}
                <div className="flex items-center justify-between rounded-lg bg-gray-800/30 px-3 py-2.5">
                  <div className="flex items-center gap-2">
                    <span
                      className={`w-2 h-2 rounded-full ${config.remoteApproval ? 'bg-green-400' : 'bg-gray-600'}`}
                    />
                    <div>
                      <p className="text-xs text-gray-200 font-medium">Remote Approval</p>
                      <p className="text-[10px] text-gray-500">
                        Route permission prompts to this dashboard
                      </p>
                    </div>
                  </div>
                  <div className="relative group">
                    <button
                      onClick={() => handleToggle('remoteApproval')}
                      disabled={isSaving || !hookServerRunning}
                      className={`relative w-9 h-5 rounded-full transition-colors ${
                        config.remoteApproval ? 'bg-green-600' : 'bg-gray-600'
                      } ${isSaving || !hookServerRunning ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
                      aria-label={
                        config.remoteApproval ? 'Disable remote approval' : 'Enable remote approval'
                      }
                    >
                      <span
                        className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${
                          config.remoteApproval ? 'translate-x-4' : ''
                        }`}
                      />
                    </button>
                    {!hookServerRunning && (
                      <div className="absolute right-0 bottom-full mb-1.5 px-2 py-1 text-[10px] text-gray-300 bg-gray-900 border border-gray-700 rounded shadow-lg whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none">
                        Start Synapse with remote approval to enable
                      </div>
                    )}
                  </div>
                </div>

                {/* Error message */}
                {error && <p className="text-[10px] text-red-400 mt-1">{error}</p>}
              </div>
            )}
          </section>

          {/* Session stats */}
          {resolved.length > 0 && (
            <section>
              <h3 className="text-xs text-gray-500 uppercase tracking-wider mb-2">Session Stats</h3>
              <div className="flex items-center gap-4 text-xs text-gray-400">
                <span className="text-green-400">{approved} approved</span>
                <span className="text-red-400">{denied} denied</span>
              </div>
            </section>
          )}

          {/* Push Notifications */}
          {Features.pushNotifications && <PushSetup />}

          {/* Bypass note */}
          <div className="bg-blue-950/20 border border-blue-800/30 rounded-lg p-3">
            <p className="text-[11px] text-blue-300/80 leading-relaxed">
              Tools in your{' '}
              <code className="text-blue-200 bg-blue-900/30 px-1 rounded">permissions.allow</code>{' '}
              list bypass this routing — they run without a prompt. Only tools not yet in your allow
              list will appear as permission cards.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
