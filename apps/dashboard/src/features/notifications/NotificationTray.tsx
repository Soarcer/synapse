// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Synapse Contributors

import { useNotificationStore } from './notificationStore';
import { useAgentStore } from '../../store/agentStore';
import {
  NOTIFICATION_TYPES,
  FALLBACK_TYPE,
  NOTIFICATIONS_ENABLED,
  sessionLabel,
  formatWait,
  targetNodeId,
} from './constants';

const MAX_VISIBLE = 4;

export function NotificationTray() {
  const notifications = useNotificationStore((s) => s.notifications);
  const showToasts = useNotificationStore((s) => s.showToasts);
  const dismiss = useNotificationStore((s) => s.dismiss);
  const sessions = useAgentStore((s) => s.sessions);
  const selectNode = useAgentStore((s) => s.selectNode);

  if (!NOTIFICATIONS_ENABLED || !showToasts || notifications.length === 0) return null;

  const visible = notifications.slice(0, MAX_VISIBLE);
  const overflow = notifications.length - MAX_VISIBLE;

  return (
    <div className="absolute bottom-3 left-3 right-3 z-10 flex gap-2 items-end pointer-events-none">
      <style>{`@keyframes notifSlideUp {
        from { opacity: 0; transform: translateY(16px); }
        to { opacity: 1; transform: translateY(0); }
      }`}</style>
      {visible.map((notif, i) => {
        const style = NOTIFICATION_TYPES[notif.notificationType ?? ''] ?? FALLBACK_TYPE;
        return (
          <div
            key={notif.id}
            data-testid="notification-card"
            className={`
              pointer-events-auto flex-1 max-w-[280px] min-w-[200px]
              ${style.bg} border ${style.border} backdrop-blur-sm
              rounded-lg p-3 shadow-lg
              animate-[notifSlideUp_0.4s_ease-out_both]
            `}
            style={{ animationDelay: `${i * 80}ms` }}
          >
            <div className="flex items-center gap-2 mb-1.5">
              <span className={`w-2 h-2 rounded-full flex-shrink-0 animate-pulse ${style.dot}`} />
              <span className="text-[9px] font-bold uppercase tracking-wider text-gray-400">
                {style.label}
              </span>
              <span className="text-[9px] text-gray-600 font-mono ml-auto">
                {formatWait(Date.now() - notif.timestamp)}
              </span>
            </div>
            <div className="text-[11px] text-gray-200 mb-1 leading-snug line-clamp-2 font-medium">
              {notif.text ?? 'No details'}
            </div>
            <div className="text-[10px] text-gray-500 font-mono mb-2 truncate">
              {sessionLabel(notif.sessionId, sessions)}
            </div>
            <div className="flex gap-1.5">
              <button
                onClick={() => selectNode(targetNodeId(notif), 'lens')}
                className="text-[10px] font-medium text-blue-400 hover:text-blue-300 bg-blue-950/50 hover:bg-blue-900/50 border border-blue-800/30 px-2.5 py-1 rounded transition-colors"
              >
                Go to Node
              </button>
              <button
                onClick={() => dismiss(notif.id)}
                className="text-[10px] text-gray-500 hover:text-gray-300 px-1.5 py-1 rounded hover:bg-gray-700/50 transition-colors"
              >
                &times;
              </button>
            </div>
          </div>
        );
      })}
      {overflow > 0 && (
        <div className="pointer-events-auto text-[10px] text-gray-500 bg-gray-900/80 border border-gray-700/40 backdrop-blur-sm rounded-lg px-3 py-2 self-end">
          +{overflow} more
        </div>
      )}
    </div>
  );
}
