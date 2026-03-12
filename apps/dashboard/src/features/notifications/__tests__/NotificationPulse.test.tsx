// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import type { AgentEvent } from '@synapse-ai/core';
import { NotificationPulse } from '../NotificationPulse';
import { useNotificationStore } from '../notificationStore';

vi.mock('../../../store/wsClient', () => ({
  wsClient: {
    setOnEvent: vi.fn(),
    setOnBatchEvent: vi.fn(),
    setOnStatusChange: vi.fn(),
    connect: vi.fn(),
    disconnect: vi.fn(),
  },
}));

vi.mock('../../../store/agentStore', () => ({
  useAgentStore: Object.assign(
    (sel: (s: Record<string, unknown>) => unknown) => sel({ selectNode: vi.fn() }),
    { getState: () => ({ selectNode: vi.fn() }), subscribe: vi.fn() },
  ),
}));

describe('NotificationPulse', () => {
  beforeEach(() => {
    cleanup();
    useNotificationStore.setState({ notifications: [], showPulse: true });
  });

  it('renders nothing when notification is null', () => {
    const { container } = render(<NotificationPulse />);
    expect(container.innerHTML).toBe('');
  });

  it('renders pulse overlay with message when notification exists', () => {
    useNotificationStore.setState({
      notifications: [
        {
          id: 'n1',
          type: 'notification',
          sessionId: 's1',
          timestamp: Date.now(),
          text: 'Claude needs permission for git push',
          notificationType: 'permission_prompt',
        } as AgentEvent,
      ],
      showPulse: true,
    });

    render(<NotificationPulse />);
    expect(screen.getAllByText(/Permission/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/git push/i).length).toBeGreaterThan(0);
  });

  it('renders nothing when showPulse is false', () => {
    useNotificationStore.setState({
      notifications: [
        {
          id: 'n1',
          type: 'notification',
          sessionId: 's1',
          timestamp: Date.now(),
          text: 'test',
          notificationType: 'permission_prompt',
        } as AgentEvent,
      ],
      showPulse: false,
    });

    const { container } = render(<NotificationPulse />);
    expect(container.innerHTML).toBe('');
  });
});
