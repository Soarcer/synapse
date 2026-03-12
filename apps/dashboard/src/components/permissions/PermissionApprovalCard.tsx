// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Bernhard

import { useState, useEffect, useCallback } from 'react';
import type { PendingSummary } from '../../store/permissionStore';
import { apiUrl } from '../../utils/api';

interface Props {
  permission: PendingSummary;
  onApprove: (id: string) => void;
  onDeny: (id: string) => void;
  onDismiss: (id: string) => void;
}

const TRUNCATE_LENGTH = 80;

function formatCountdown(ms: number): string {
  if (ms <= 0) return '0:00';
  const totalSec = Math.ceil(ms / 1000);
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  return `${min}:${sec.toString().padStart(2, '0')}`;
}

export function PermissionApprovalCard({ permission, onApprove, onDeny, onDismiss }: Props) {
  const { id, tool_name, tool_input_preview, expiresAt } = permission;

  // ── Countdown timer ──
  const [remaining, setRemaining] = useState(() => Math.max(0, expiresAt - Date.now()));

  useEffect(() => {
    if (remaining <= 0) return;
    const interval = setInterval(() => {
      const ms = Math.max(0, expiresAt - Date.now());
      setRemaining(ms);
      if (ms <= 0) clearInterval(interval);
    }, 1000);
    return () => clearInterval(interval);
  }, [expiresAt]); // eslint-disable-line react-hooks/exhaustive-deps

  const isExpired = remaining <= 0;

  // ── Expand input ──
  const [expanded, setExpanded] = useState(false);
  const [fullInput, setFullInput] = useState<string | null>(null);

  const needsTruncation = tool_input_preview.length > TRUNCATE_LENGTH;
  const displayInput =
    expanded && fullInput
      ? fullInput
      : needsTruncation
        ? tool_input_preview.slice(0, TRUNCATE_LENGTH)
        : tool_input_preview;

  const handleExpand = useCallback(async () => {
    if (expanded) {
      setExpanded(false);
      return;
    }
    // Fetch full detail from GET /api/permissions/:id
    try {
      const res = await fetch(apiUrl(`/api/permissions/${id}`));
      if (res.ok) {
        const data = await res.json();
        setFullInput(
          typeof data.event?.tool_input === 'string'
            ? data.event.tool_input
            : JSON.stringify(data.event?.tool_input, null, 2),
        );
      }
    } catch {
      // Expand with what we have
      setFullInput(tool_input_preview);
    }
    setExpanded(true);
  }, [expanded, id, tool_input_preview]);

  // ── Expired state ──
  if (isExpired) {
    return (
      <div className="bg-amber-950/40 border border-amber-700/40 rounded-lg p-4 shadow-lg">
        <div className="flex items-center justify-between mb-2">
          <span className="text-sm font-medium text-amber-300">Permission Request</span>
          <span className="text-xs text-amber-400 font-mono">0:00</span>
        </div>
        <p className="text-xs text-amber-300/80 mb-3">
          Timed out — Claude denied and fell back to terminal. You can retry the task.
        </p>
        <div className="flex justify-end">
          <button
            onClick={() => onDismiss(id)}
            className="px-3 py-1.5 text-xs rounded bg-amber-800/50 text-amber-200 hover:bg-amber-800/70 transition-colors"
            aria-label="Dismiss"
          >
            Dismiss
          </button>
        </div>
      </div>
    );
  }

  // ── Active state ──
  return (
    <div className="bg-gray-900/90 border border-gray-700/60 rounded-lg p-4 shadow-lg backdrop-blur-sm">
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <span className="text-sm font-medium text-gray-200">Permission Request</span>
        <span
          className={`text-xs font-mono ${remaining < 60_000 ? 'text-red-400' : 'text-gray-400'}`}
        >
          {formatCountdown(remaining)}
        </span>
      </div>

      {/* Tool info */}
      <div className="space-y-1.5 mb-3">
        <div className="flex items-center gap-2">
          <span className="text-[10px] text-gray-500 uppercase w-10">Tool</span>
          <span className="text-xs text-gray-200 font-medium">{tool_name}</span>
        </div>
        <div className="flex items-start gap-2">
          <span className="text-[10px] text-gray-500 uppercase w-10 pt-0.5">Input</span>
          <div className="flex-1 min-w-0">
            <pre
              className={`text-xs text-gray-300 font-mono whitespace-pre-wrap break-all ${expanded ? 'max-h-40 overflow-auto bg-gray-950/50 rounded p-2' : ''}`}
            >
              {displayInput}
            </pre>
            {needsTruncation && (
              <button
                onClick={handleExpand}
                className="text-[10px] text-blue-400 hover:text-blue-300 mt-0.5"
              >
                {expanded ? '[-]' : '[+]'}
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Action buttons */}
      <div className="flex items-center gap-2">
        <button
          onClick={() => onDeny(id)}
          className="px-3 py-1.5 text-xs rounded bg-red-900/40 text-red-300 hover:bg-red-900/60 border border-red-800/40 transition-colors"
          aria-label="Deny"
        >
          Deny
        </button>
        <button
          disabled
          aria-disabled="true"
          className="px-3 py-1.5 text-xs rounded bg-gray-800/40 text-gray-600 border border-gray-700/30 cursor-not-allowed"
          aria-label="Always allow"
          title="Coming in v2"
        >
          Always allow
        </button>
        <button
          onClick={() => onApprove(id)}
          className="ml-auto px-4 py-1.5 text-xs rounded bg-green-900/40 text-green-300 hover:bg-green-900/60 border border-green-800/40 transition-colors font-medium"
          aria-label="Approve"
        >
          Approve
        </button>
      </div>
    </div>
  );
}
