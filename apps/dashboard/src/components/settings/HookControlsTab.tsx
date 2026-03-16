// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Bernhard

import { useState, useEffect, useCallback } from 'react';
import { apiUrl } from '../../utils/api';
import { QRCodePanel } from './QRCodePanel';
import { PushSetup } from './PushSetup';
import { usePermissionStore } from '../../store/permissionStore';

interface Props {
  open: boolean;
  onClose: () => void;
}

interface HookStatus {
  running: boolean;
  port: number;
  pending?: number;
}

function buildConfigSnippet(hookPort: number): string {
  return JSON.stringify(
    {
      hooks: {
        PermissionRequest: [
          {
            type: 'http',
            url: `http://localhost:${hookPort}/api/hooks/permission`,
          },
        ],
      },
    },
    null,
    2,
  );
}

export function HookControlsTab({ open, onClose }: Props) {
  const [status, setStatus] = useState<HookStatus | null>(null);
  const [copied, setCopied] = useState(false);
  const resolved = usePermissionStore((s) => s.resolved);

  // Poll hook server status when tab opens
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    fetch(apiUrl('/api/hook-server/status'))
      .then((r) => r.json())
      .then((data: HookStatus) => {
        if (!cancelled) setStatus(data);
      })
      .catch(() => {
        if (!cancelled) setStatus({ running: false, port: 27247 });
      });
    return () => {
      cancelled = true;
    };
  }, [open]);

  const configSnippet = buildConfigSnippet(status?.port ?? 27247);

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(configSnippet);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback — clipboard API unavailable
    }
  }, [configSnippet]);

  if (!open) return null;

  const approved = resolved.filter((r) => r.behavior === 'allow').length;
  const denied = resolved.filter((r) => r.behavior === 'deny').length;

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

          {/* Hook Server Status */}
          <section>
            <h3 className="text-xs text-gray-500 uppercase tracking-wider mb-2">
              Hook Server Status
            </h3>
            <div className="flex items-center gap-2">
              <span
                className={`w-2 h-2 rounded-full ${status?.running ? 'bg-green-400' : 'bg-red-400'}`}
              />
              <span className="text-xs text-gray-300">
                {status?.running
                  ? `Running on port ${status.port}`
                  : 'Unavailable — using terminal fallback'}
              </span>
              {status?.running && status.pending != null && status.pending > 0 && (
                <span className="text-[10px] text-amber-400 ml-auto">{status.pending} pending</span>
              )}
            </div>
          </section>

          {/* Permission Approval Setup */}
          <section>
            <h3 className="text-xs text-gray-500 uppercase tracking-wider mb-2">
              Permission Approval
            </h3>
            <p className="text-xs text-gray-400 mb-3">
              Route permission prompts to this dashboard. Add to{' '}
              <code className="text-gray-300 bg-gray-800 px-1 rounded">.claude/settings.json</code>:
            </p>
            <pre className="bg-gray-950/60 border border-gray-800 rounded-lg p-3 text-[11px] text-gray-300 font-mono overflow-x-auto">
              {configSnippet}
            </pre>
            <button
              onClick={handleCopy}
              className="mt-2 flex items-center gap-1.5 px-3 py-1.5 text-xs rounded bg-gray-800 text-gray-300 hover:bg-gray-700 transition-colors border border-gray-700/50"
              aria-label={copied ? 'Copied' : 'Copy config snippet'}
            >
              {copied ? 'Copied!' : 'Copy config snippet'}
            </button>
          </section>

          {/* Session stats (only when there are resolved permissions) */}
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
          <PushSetup />

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
