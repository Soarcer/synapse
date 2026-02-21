// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Synapse Contributors

import { useNotificationStore } from './notificationStore';
import { useAgentStore } from '../../store/agentStore';
import { NOTIFICATION_TYPES, FALLBACK_TYPE, sessionLabel, formatElapsed, targetNodeId } from './constants';

export function AlertsView() {
  const notifications = useNotificationStore((s) => s.notifications);
  const dismiss = useNotificationStore((s) => s.dismiss);
  const clearAll = useNotificationStore((s) => s.clearAll);
  const sessions = useAgentStore((s) => s.sessions);
  const selectNode = useAgentStore((s) => s.selectNode);

  if (notifications.length === 0) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center text-gray-600 text-xs gap-2 p-4">
        <svg className="w-8 h-8 opacity-30" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M14.857 17.082a23.848 23.848 0 005.454-1.31A8.967 8.967 0 0118 9.75v-.7V9A6 6 0 006 9v.75a8.967 8.967 0 01-2.312 6.022c1.733.64 3.56 1.085 5.455 1.31m5.714 0a24.255 24.255 0 01-5.714 0m5.714 0a3 3 0 11-5.714 0" />
        </svg>
        No alerts
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="flex items-center justify-between px-3 py-2 border-b border-gray-800 flex-shrink-0">
        <span className="text-[10px] text-gray-500 uppercase tracking-wider font-semibold">
          {notifications.length} alert{notifications.length !== 1 ? 's' : ''}
        </span>
        <button onClick={clearAll} className="text-[10px] text-gray-500 hover:text-gray-300 transition-colors">
          Clear all
        </button>
      </div>
      <div className="flex-1 overflow-y-auto p-2 space-y-1.5">
        {notifications.map((notif) => {
          const config = NOTIFICATION_TYPES[notif.notificationType ?? ''] ?? FALLBACK_TYPE;
          return (
            <div
              key={notif.id}
              className={`rounded-md border-l-[3px] ${config.border} ${config.bg} border border-gray-800 p-2.5 group transition-all duration-300 ease-out`}
            >
              <div className="flex items-center gap-2 mb-1">
                <span className={`text-[9px] font-bold uppercase tracking-wider ${config.color}`}>{config.label}</span>
                <span className="text-[9px] text-gray-600 font-mono ml-auto">{formatElapsed(Date.now() - notif.timestamp)}</span>
              </div>
              <div className="text-xs text-gray-300 mb-1.5 leading-snug line-clamp-2">{notif.text ?? 'No details'}</div>
              <div className="flex items-center justify-between">
                <span className="text-[10px] text-gray-600 font-mono truncate max-w-[120px]">{sessionLabel(notif.sessionId, sessions)}</span>
                <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                  <button
                    onClick={() => selectNode(targetNodeId(notif), 'lens')}
                    className="text-[10px] text-blue-400 hover:text-blue-300 px-1.5 py-0.5 rounded hover:bg-blue-900/30 transition-colors"
                  >Go to</button>
                  <button
                    onClick={() => dismiss(notif.id)}
                    className="text-[10px] text-gray-500 hover:text-gray-300 px-1 py-0.5 rounded hover:bg-gray-700/50 transition-colors"
                  >&times;</button>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
