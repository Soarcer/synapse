// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Bernhard

import { useEffect, useRef } from 'react';
import { useNotificationStore } from './notificationStore';
import { useAgentStore } from '../../store/agentStore';
import { NOTIFICATION_TYPES, FALLBACK_TYPE, NOTIFICATIONS_ENABLED } from './constants';

export function NotificationPulse() {
  const notifications = useNotificationStore((s) => s.notifications);
  const showPulse = useNotificationStore((s) => s.showPulse);
  const dismiss = useNotificationStore((s) => s.dismiss);
  const latest = NOTIFICATIONS_ENABLED && showPulse ? (notifications[0] ?? null) : null;

  // Auto-zoom to the notification's agent/session node
  const prevIdRef = useRef<string | null>(null);
  useEffect(() => {
    if (!latest || latest.id === prevIdRef.current) return;
    prevIdRef.current = latest.id;
    const targetId = latest.agentId ? `agent-${latest.agentId}` : `session-${latest.sessionId}`;
    useAgentStore.getState().selectNode(targetId, 'lens');
  }, [latest]);

  if (!latest) return null;

  const config = NOTIFICATION_TYPES[latest.notificationType ?? ''] ?? FALLBACK_TYPE;
  const isRed = latest.notificationType === 'permission_prompt';

  return (
    <div className="absolute top-4 left-1/2 -translate-x-1/2 z-20 animate-[notifSlideDown_0.3s_ease-out]">
      <style>{`@keyframes notifSlideDown {
        from { opacity: 0; transform: translateX(-50%) translateY(-12px); }
        to { opacity: 1; transform: translateX(-50%) translateY(0); }
      }`}</style>
      <div
        className={`
        flex items-center gap-3 px-4 py-2.5 rounded-lg border backdrop-blur-sm shadow-lg
        ${
          isRed
            ? 'bg-red-950/90 border-red-700/50 text-red-200'
            : 'bg-amber-950/90 border-amber-700/50 text-amber-200'
        }
      `}
      >
        <span
          className={`w-2.5 h-2.5 rounded-full flex-shrink-0 animate-pulse ${config.dot}
          ${isRed ? 'shadow-[0_0_8px_rgba(248,113,113,0.6)]' : 'shadow-[0_0_8px_rgba(251,191,36,0.6)]'}
        `}
        />
        <div className="flex-1 min-w-0">
          <div className="text-[10px] font-semibold uppercase tracking-wider opacity-70">
            {config.label}
          </div>
          <div className="text-xs font-medium truncate max-w-[300px]">
            {latest.text ?? 'No details'}
          </div>
        </div>
        <button
          onClick={() => dismiss(latest.id)}
          className={`ml-2 px-2 py-1 rounded text-[10px] font-medium transition-colors ${
            isRed ? 'hover:bg-red-800/50 text-red-400' : 'hover:bg-amber-800/50 text-amber-400'
          }`}
          aria-label="Dismiss notification"
        >
          &times;
        </button>
      </div>
    </div>
  );
}
