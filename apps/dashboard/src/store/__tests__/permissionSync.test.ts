// apps/dashboard/src/store/__tests__/permissionSync.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock fetch globally
const fetchSpy = vi.fn();
vi.stubGlobal('fetch', fetchSpy);

describe('adaptive permission sync', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    fetchSpy.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('exports createAdaptiveSync that returns start/stop/notify', async () => {
    const { createAdaptiveSync } = await import('../permissionStore.js');
    const sync = createAdaptiveSync();
    expect(typeof sync.start).toBe('function');
    expect(typeof sync.stop).toBe('function');
    expect(typeof sync.notifyPendingChange).toBe('function');
  });

  it('uses fast interval (5s) when pending count > 0', async () => {
    fetchSpy.mockResolvedValue({ ok: true, json: () => Promise.resolve([]) });
    const { createAdaptiveSync } = await import('../permissionStore.js');
    const sync = createAdaptiveSync();
    sync.start();
    sync.notifyPendingChange(1); // Signal that we have pending cards

    // Advance 5s — should trigger a sync
    await vi.advanceTimersByTimeAsync(5000);
    expect(fetchSpy).toHaveBeenCalled();

    sync.stop();
  });

  it('uses slow interval (30s) when pending count is 0', async () => {
    fetchSpy.mockResolvedValue({ ok: true, json: () => Promise.resolve([]) });
    const { createAdaptiveSync } = await import('../permissionStore.js');
    const sync = createAdaptiveSync();
    sync.start();
    sync.notifyPendingChange(0); // No pending cards

    // Advance 5s — should NOT trigger
    await vi.advanceTimersByTimeAsync(5000);
    expect(fetchSpy).not.toHaveBeenCalled();

    // Advance to 30s — should trigger
    await vi.advanceTimersByTimeAsync(25000);
    expect(fetchSpy).toHaveBeenCalled();

    sync.stop();
  });
});
