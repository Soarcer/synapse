// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { AlertsView } from '../AlertsView';

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
    notifications: [
      { id: 'n1', type: 'notification', sessionId: 's1', text: 'Permission needed', notificationType: 'permission_prompt', timestamp: Date.now() - 60000 },
      { id: 'n2', type: 'notification', sessionId: 's1', text: 'Redis or in-memory?', notificationType: 'elicitation_dialog', timestamp: Date.now() },
    ],
    dismiss: vi.fn(),
    clearAll: vi.fn(),
  }),
}));

describe('AlertsView', () => {
  beforeEach(() => cleanup());

  it('renders notification cards', () => {
    render(<AlertsView />);
    expect(screen.getByText(/Permission needed/)).toBeTruthy();
    expect(screen.getByText(/Redis/)).toBeTruthy();
  });

  it('shows clear all button', () => {
    render(<AlertsView />);
    expect(screen.getByText('Clear all')).toBeTruthy();
  });
});
