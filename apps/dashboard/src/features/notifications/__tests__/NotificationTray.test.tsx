// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { NotificationTray } from '../NotificationTray';

vi.mock('../../../store/wsClient', () => ({
  wsClient: { setOnEvent: vi.fn(), setOnStatusChange: vi.fn(), connect: vi.fn(), disconnect: vi.fn() },
}));

vi.mock('../../../store/agentStore', () => ({
  useAgentStore: (sel: (s: Record<string, unknown>) => unknown) => sel({
    sessions: new Map([['s1', { sessionId: 's1', cwd: '/projects/feat-auth' }]]),
    selectNode: vi.fn(),
  }),
}));

vi.mock('../notificationStore', () => ({
  useNotificationStore: (sel: (s: Record<string, unknown>) => unknown) => sel({
    notifications: [{
      id: 'n1', type: 'notification', sessionId: 's1', timestamp: Date.now() - 30000,
      text: 'Permission to run git push', notificationType: 'permission_prompt',
    }],
    showToasts: true,
    dismiss: vi.fn(),
  }),
}));

describe('NotificationTray', () => {
  it('renders context snapshot cards', () => {
    render(<NotificationTray />);
    expect(screen.getByText(/git push/i)).toBeTruthy();
    expect(screen.getByText(/feat-auth/i)).toBeTruthy();
  });
});
