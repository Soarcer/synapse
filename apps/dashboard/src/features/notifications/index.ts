// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Synapse Contributors
//
// Feature flag — set to false to disable all notification features.
// All exports become no-ops so existing touchpoints in the app
// silently do nothing without errors.

export { NOTIFICATIONS_ENABLED } from './constants';

export { useNotificationStore } from './notificationStore';
export { NOTIFICATION_TYPES, FALLBACK_TYPE, sessionLabel, formatElapsed, formatWait, targetNodeId } from './constants';

import { NOTIFICATIONS_ENABLED } from './constants';
import { useAgentStore } from '../../store/agentStore';
import { useNotificationStore } from './notificationStore';
import { toast } from '../../components/Toast';
import { targetNodeId } from './constants';

let initialized = false;

/**
 * Initialize the notification system — subscribes to agentStore for
 * notification events. Call once at app startup. No-op if disabled or
 * already initialized.
 */
export function initNotifications(): void {
  if (!NOTIFICATIONS_ENABLED || initialized) return;
  initialized = true;

  // Watch agentStore.events for new notification-type events
  let prevEventCount = 0;
  let seenIds = new Set<string>();

  useAgentStore.subscribe((state) => {
    if (state.events.length === prevEventCount) return;
    prevEventCount = state.events.length;

    // Check newest events (stored newest-first) for notifications
    for (const event of state.events) {
      if (seenIds.has(event.id)) break; // already processed everything after this
      if (event.type === 'notification') {
        useNotificationStore.getState().addNotification(event);

        // Fire toast if enabled
        if (useNotificationStore.getState().showToasts) {
          const typeLabel = event.notificationType === 'permission_prompt' ? 'Permission needed'
            : event.notificationType === 'elicitation_dialog' ? 'Question for you'
            : 'Notification';
          const preview = (event.text ?? '').slice(0, 80);
          toast(`${typeLabel}: ${preview}`, 'warning', targetNodeId(event));
        }
      }
      seenIds.add(event.id);
    }

    // Prevent unbounded growth of seenIds
    if (seenIds.size > 2000) {
      const keepIds = new Set(state.events.map((e) => e.id));
      seenIds = keepIds;
    }
  });
}
