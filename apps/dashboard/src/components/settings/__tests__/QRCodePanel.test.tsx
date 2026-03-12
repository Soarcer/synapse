// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent, cleanup } from '@testing-library/react';

vi.mock('../../../utils/api', () => ({
  apiUrl: (path: string) => path,
}));

// Mock qrcode to avoid canvas dependency in jsdom
vi.mock('qrcode', () => ({
  default: { toDataURL: vi.fn().mockResolvedValue('data:image/png;base64,FAKE') },
}));

import { QRCodePanel } from '../QRCodePanel';

describe('QRCodePanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    cleanup();
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          ip: '192.168.1.100',
          port: 27246,
          url: 'http://192.168.1.100:27246',
        }),
    });
  });

  it('renders section heading', async () => {
    render(<QRCodePanel />);
    expect(screen.getByText(/open on your phone/i)).toBeTruthy();
  });

  it('fetches local URL on render', async () => {
    render(<QRCodePanel />);
    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(expect.stringContaining('/api/network/local-url'));
    });
  });

  it('displays the URL', async () => {
    render(<QRCodePanel />);
    await waitFor(() => {
      expect(screen.getByText('http://192.168.1.100:27246')).toBeTruthy();
    });
  });

  it('shows amber warning when present', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          ip: 'localhost',
          port: 27246,
          url: 'http://localhost:27246',
          warning: 'No LAN interface detected',
        }),
    });

    render(<QRCodePanel />);
    await waitFor(() => {
      expect(screen.getByText(/no lan interface/i)).toBeTruthy();
    });
  });

  it('has a Copy link button', async () => {
    render(<QRCodePanel />);
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /copy link/i })).toBeTruthy();
    });
  });

  it('has a Refresh QR button', async () => {
    render(<QRCodePanel />);
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /refresh/i })).toBeTruthy();
    });
  });

  it('re-fetches on Refresh QR click', async () => {
    render(<QRCodePanel />);
    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledTimes(1);
    });
    fireEvent.click(screen.getByRole('button', { name: /refresh/i }));
    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledTimes(2);
    });
  });
});
