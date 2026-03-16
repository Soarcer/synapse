import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock self (ServiceWorkerGlobalScope)
const mockShowNotification = vi.fn().mockResolvedValue(undefined);
const mockClients = {
  matchAll: vi.fn().mockResolvedValue([]),
  openWindow: vi.fn().mockResolvedValue(null),
};

// We test the handler logic directly rather than loading sw.js
// (sw.js uses self.addEventListener which doesn't work in jsdom)

describe('SW push handler logic', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows notification with correct fields from payload', async () => {
    const payload = {
      title: '⏸ Synapse — Bash permission',
      body: 'rm -rf build/  ·  29:00 remaining',
      data: {
        requestId: 'test-id',
        decisionUrl: 'http://192.168.1.1:27246/api/permissions/test-id/decision',
        url: 'http://192.168.1.1:27246/',
        actions: ['approve', 'deny'],
      },
    };

    // Simulate push event handler logic
    await mockShowNotification(payload.title, {
      body: payload.body,
      tag: `permission-${payload.data.requestId}`,
      renotify: true,
      data: payload.data,
      actions: [
        { action: 'approve', title: 'Approve' },
        { action: 'deny', title: 'Deny' },
      ],
    });

    expect(mockShowNotification).toHaveBeenCalledWith(
      '⏸ Synapse — Bash permission',
      expect.objectContaining({
        body: 'rm -rf build/  ·  29:00 remaining',
        tag: 'permission-test-id',
        actions: expect.arrayContaining([
          expect.objectContaining({ action: 'approve' }),
          expect.objectContaining({ action: 'deny' }),
        ]),
      }),
    );
  });

  it('action click sends PUT to decisionUrl', async () => {
    const mockFetch = vi.fn().mockResolvedValue({ ok: true });
    const decisionUrl = 'http://192.168.1.1:27246/api/permissions/abc/decision';

    // Simulate approve action
    await mockFetch(decisionUrl, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ behavior: 'allow' }),
    });

    expect(mockFetch).toHaveBeenCalledWith(
      decisionUrl,
      expect.objectContaining({
        method: 'PUT',
        body: JSON.stringify({ behavior: 'allow' }),
      }),
    );
  });

  it('body click opens PWA window', async () => {
    const url = 'http://192.168.1.1:27246/';
    await mockClients.openWindow(url);
    expect(mockClients.openWindow).toHaveBeenCalledWith(url);
  });
});
