// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { Features } from '@synapse-ai/core';
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

describe.skipIf(!Features.pushNotifications)('PushSetup', () => {
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
    // jsdom defaults isSecureContext to false, which would show the HTTPS message instead
    Object.defineProperty(window, 'isSecureContext', { value: true, configurable: true });
    render(<PushSetup />);
    expect(screen.getByText(/doesn.*support push/i)).toBeDefined();
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
