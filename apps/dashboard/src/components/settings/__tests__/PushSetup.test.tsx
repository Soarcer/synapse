// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { PushSetup } from '../PushSetup';

// Mock usePush hook
vi.mock('../../../hooks/usePush', () => ({
  usePush: vi.fn().mockReturnValue({
    state: 'default',
    error: null,
    enable: vi.fn(),
    disable: vi.fn(),
    clearError: vi.fn(),
    sendTest: vi.fn(),
  }),
}));

// Mock fetch for subscription list
global.fetch = vi.fn().mockResolvedValue({
  ok: true,
  json: () => Promise.resolve([]),
});

import { usePush } from '../../../hooks/usePush';

describe('PushSetup', () => {
  it('shows enable button in default state', () => {
    render(<PushSetup />);
    expect(screen.getByText('Enable Push Notifications')).toBeDefined();
  });

  it('shows unsupported message when not available', () => {
    vi.mocked(usePush).mockReturnValue({
      state: 'unsupported',
      error: null,
      enable: vi.fn(),
      disable: vi.fn(),
      clearError: vi.fn(),
      sendTest: vi.fn(),
    });
    render(<PushSetup />);
    expect(screen.getByText(/support push|HTTPS required/i)).toBeDefined();
  });

  it('shows denied message with reset instructions', () => {
    vi.mocked(usePush).mockReturnValue({
      state: 'denied',
      error: null,
      enable: vi.fn(),
      disable: vi.fn(),
      clearError: vi.fn(),
      sendTest: vi.fn(),
    });
    render(<PushSetup />);
    expect(screen.getByText(/blocked/i)).toBeDefined();
  });

  it('shows enabled state with controls', () => {
    vi.mocked(usePush).mockReturnValue({
      state: 'subscribed',
      error: null,
      enable: vi.fn(),
      disable: vi.fn(),
      clearError: vi.fn(),
      sendTest: vi.fn(),
    });
    render(<PushSetup />);
    expect(screen.getByText(/enabled/i)).toBeDefined();
    expect(screen.getByText(/test notification/i)).toBeDefined();
  });
});
