// @vitest-environment jsdom

// Mock api utility before imports
vi.mock('../../utils/api', () => ({
  apiUrl: (path: string) => path,
}));

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Import store after mocks
import {
  usePermissionStore,
  handlePermissionWsMessage,
  type PendingSummary,
} from '../permissionStore';

// ── Helper: reset store before each test ────────────────────
function resetStore() {
  usePermissionStore.setState({
    pending: [],
    resolved: [],
    errorIds: new Set<string>(),
  });
}

function makePending(overrides: Partial<PendingSummary> = {}): PendingSummary {
  return {
    id: overrides.id ?? 'perm-1',
    tool_name: overrides.tool_name ?? 'Bash',
    tool_input_preview: overrides.tool_input_preview ?? 'rm -rf build/',
    createdAt: overrides.createdAt ?? Date.now(),
    expiresAt: overrides.expiresAt ?? Date.now() + 1_800_000,
  };
}

describe('permissionStore', () => {
  beforeEach(() => resetStore());

  it('starts with empty pending and resolved arrays', () => {
    const { pending, resolved } = usePermissionStore.getState();
    expect(pending).toEqual([]);
    expect(resolved).toEqual([]);
  });

  it('addPending adds a permission to pending list', () => {
    const p = makePending({ id: 'perm-1' });
    usePermissionStore.getState().addPending(p);
    expect(usePermissionStore.getState().pending).toHaveLength(1);
    expect(usePermissionStore.getState().pending[0].id).toBe('perm-1');
  });

  it('addPending deduplicates by id', () => {
    const p = makePending({ id: 'perm-1' });
    usePermissionStore.getState().addPending(p);
    usePermissionStore.getState().addPending(p);
    expect(usePermissionStore.getState().pending).toHaveLength(1);
  });

  it('resolvePending moves permission from pending to resolved', () => {
    const p = makePending({ id: 'perm-2' });
    usePermissionStore.getState().addPending(p);
    usePermissionStore.getState().resolvePending('perm-2', 'allow');

    expect(usePermissionStore.getState().pending).toHaveLength(0);
    expect(usePermissionStore.getState().resolved).toHaveLength(1);
    expect(usePermissionStore.getState().resolved[0]).toMatchObject({
      id: 'perm-2',
      behavior: 'allow',
    });
  });

  it('resolvePending is a no-op for unknown id', () => {
    usePermissionStore.getState().resolvePending('nonexistent', 'deny');
    expect(usePermissionStore.getState().pending).toHaveLength(0);
    expect(usePermissionStore.getState().resolved).toHaveLength(0);
  });

  it('approve calls PUT and resolves on success', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ ok: true, latencyMs: 120 }),
    });

    const p = makePending({ id: 'perm-3' });
    usePermissionStore.getState().addPending(p);
    await usePermissionStore.getState().approve('perm-3');

    expect(global.fetch).toHaveBeenCalledWith(
      '/api/permissions/perm-3/decision',
      expect.objectContaining({
        method: 'PUT',
        body: JSON.stringify({ behavior: 'allow' }),
      }),
    );
  });

  it('deny calls PUT with deny behavior', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ ok: true, latencyMs: 50 }),
    });

    const p = makePending({ id: 'perm-4' });
    usePermissionStore.getState().addPending(p);
    await usePermissionStore.getState().deny('perm-4');

    expect(global.fetch).toHaveBeenCalledWith(
      '/api/permissions/perm-4/decision',
      expect.objectContaining({
        body: JSON.stringify({ behavior: 'deny' }),
      }),
    );
  });

  it('approve silently dismisses on 404 (already resolved)', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
      json: () => Promise.resolve({ error: 'already resolved' }),
    });

    const p = makePending({ id: 'perm-5' });
    usePermissionStore.getState().addPending(p);
    await usePermissionStore.getState().approve('perm-5');

    // Should remove from pending (silent dismiss)
    expect(usePermissionStore.getState().pending).toHaveLength(0);
  });

  // P1: hydrate now merges instead of replacing
  it('hydrate merges server data with existing pending (no duplicates)', () => {
    const existing = makePending({ id: 'local-1' });
    usePermissionStore.getState().addPending(existing);

    const serverData = [
      makePending({ id: 'local-1' }), // duplicate — should be skipped
      makePending({ id: 'server-1' }),
      makePending({ id: 'server-2' }),
    ];
    usePermissionStore.getState().hydrate(serverData);

    expect(usePermissionStore.getState().pending).toHaveLength(3);
    expect(usePermissionStore.getState().pending.map((p) => p.id)).toEqual([
      'local-1',
      'server-1',
      'server-2',
    ]);
  });

  it('hydrate skips items already in resolved list', () => {
    const p = makePending({ id: 'resolved-1' });
    usePermissionStore.getState().addPending(p);
    usePermissionStore.getState().resolvePending('resolved-1', 'allow');

    usePermissionStore.getState().hydrate([makePending({ id: 'resolved-1' })]);
    expect(usePermissionStore.getState().pending).toHaveLength(0);
  });

  it('caps resolved list at 50 entries', () => {
    const items = Array.from({ length: 55 }, (_, i) => makePending({ id: `perm-${i}` }));
    for (const item of items) {
      usePermissionStore.getState().addPending(item);
    }
    for (const item of items) {
      usePermissionStore.getState().resolvePending(item.id, 'allow');
    }
    expect(usePermissionStore.getState().resolved.length).toBeLessThanOrEqual(50);
  });
});

describe('handlePermissionWsMessage', () => {
  beforeEach(() => resetStore());

  it('handles pendingPermission message', () => {
    const handled = handlePermissionWsMessage({
      type: 'pendingPermission',
      data: makePending({ id: 'ws-1' }),
    });
    expect(handled).toBe(true);
    expect(usePermissionStore.getState().pending).toHaveLength(1);
    expect(usePermissionStore.getState().pending[0].id).toBe('ws-1');
  });

  it('handles permissionResolved message', () => {
    usePermissionStore.getState().addPending(makePending({ id: 'ws-2' }));
    const handled = handlePermissionWsMessage({
      type: 'permissionResolved',
      data: { id: 'ws-2', behavior: 'allow' },
    });
    expect(handled).toBe(true);
    expect(usePermissionStore.getState().pending).toHaveLength(0);
    expect(usePermissionStore.getState().resolved).toHaveLength(1);
  });

  it('returns false for unrelated message types', () => {
    const handled = handlePermissionWsMessage({
      type: 'event',
      data: {} as never,
    });
    expect(handled).toBe(false);
  });
});
