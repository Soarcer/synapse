// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, cleanup } from '@testing-library/react';

vi.mock('../../../utils/api', () => ({
  apiUrl: (path: string) => path,
}));

vi.mock('../QRCodePanel', () => ({
  QRCodePanel: () => <div data-testid="qr-stub">QR stub</div>,
}));

import { HookControlsTab } from '../HookControlsTab';

describe('HookControlsTab', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    cleanup();
  });

  it('renders Hook Controls heading', () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ running: true, port: 27247, pending: 0 }),
    });

    render(<HookControlsTab open onClose={() => {}} />);
    expect(screen.getByText(/hook controls/i)).toBeTruthy();
  });

  it('shows green status when hook server is running', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ running: true, port: 27247, pending: 0 }),
    });

    render(<HookControlsTab open onClose={() => {}} />);
    await waitFor(() => {
      expect(screen.getByText(/running/i)).toBeTruthy();
    });
  });

  it('shows red status when hook server is unavailable', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ running: false, port: 27247 }),
    });

    render(<HookControlsTab open onClose={() => {}} />);
    await waitFor(() => {
      expect(screen.getByText(/unavailable/i)).toBeTruthy();
    });
  });

  it('shows config snippet', () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ running: true, port: 27247, pending: 0 }),
    });

    render(<HookControlsTab open onClose={() => {}} />);
    expect(screen.getByText(/PermissionRequest/)).toBeTruthy();
  });

  it('has a copy config button', () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ running: true, port: 27247, pending: 0 }),
    });

    render(<HookControlsTab open onClose={() => {}} />);
    expect(screen.getByRole('button', { name: /copy/i })).toBeTruthy();
  });

  it('shows permissions.allow bypass note', () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ running: true, port: 27247, pending: 0 }),
    });

    render(<HookControlsTab open onClose={() => {}} />);
    expect(screen.getByText(/permissions\.allow/)).toBeTruthy();
  });

  it('renders nothing when not open', () => {
    const { container } = render(<HookControlsTab open={false} onClose={() => {}} />);
    expect(container.children.length).toBe(0);
  });
});
