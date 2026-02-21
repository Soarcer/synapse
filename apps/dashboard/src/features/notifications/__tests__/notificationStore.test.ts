// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('../../../store/wsClient', () => ({
  wsClient: { setOnEvent: vi.fn(), setOnStatusChange: vi.fn(), connect: vi.fn(), disconnect: vi.fn() },
}));

import { useNotificationStore } from '../notificationStore';
import type { AgentEvent } from '@synapse-ai/core';

function makeNotification(overrides: Partial<AgentEvent> = {}): AgentEvent {
  return {
    id: `notif-${Math.random().toString(36).slice(2)}`,
    type: 'notification',
    sessionId: 'session-1',
    timestamp: Date.now(),
    eventSource: 'hook',
    vendor: 'anthropic',
    text: 'Claude needs your permission',
    notificationType: 'permission_prompt',
    ...overrides,
  } as AgentEvent;
}

function resetStores() {
  useNotificationStore.setState({
    notifications: [],
    enabled: true,
    showToasts: true,
    showPulse: true,
  });
}

describe('Notification Store', () => {
  beforeEach(resetStores);

  it('adds a notification', () => {
    useNotificationStore.getState().addNotification(makeNotification());
    expect(useNotificationStore.getState().notifications).toHaveLength(1);
  });

  it('limits notifications to MAX_NOTIFICATIONS', () => {
    for (let i = 0; i < 60; i++) {
      useNotificationStore.getState().addNotification(
        makeNotification({ id: `n-${i}`, timestamp: Date.now() + i }),
      );
    }
    expect(useNotificationStore.getState().notifications).toHaveLength(50);
  });

  it('newest notification is first', () => {
    useNotificationStore.getState().addNotification(makeNotification({ id: 'old', timestamp: 1 }));
    useNotificationStore.getState().addNotification(makeNotification({ id: 'new', timestamp: 2 }));
    expect(useNotificationStore.getState().notifications[0].id).toBe('new');
  });

  it('dismisses a notification by id', () => {
    const notif = makeNotification();
    useNotificationStore.getState().addNotification(notif);
    useNotificationStore.getState().dismiss(notif.id);
    expect(useNotificationStore.getState().notifications).toHaveLength(0);
  });

  it('clears all notifications', () => {
    useNotificationStore.getState().addNotification(makeNotification());
    useNotificationStore.getState().addNotification(makeNotification());
    useNotificationStore.getState().clearAll();
    expect(useNotificationStore.getState().notifications).toHaveLength(0);
  });

  it('skips duplicates', () => {
    const notif = makeNotification({ id: 'same' });
    useNotificationStore.getState().addNotification(notif);
    useNotificationStore.getState().addNotification(notif);
    expect(useNotificationStore.getState().notifications).toHaveLength(1);
  });

  it('does not add when enabled is false', () => {
    useNotificationStore.setState({ enabled: false });
    useNotificationStore.getState().addNotification(makeNotification());
    expect(useNotificationStore.getState().notifications).toHaveLength(0);
  });
});
