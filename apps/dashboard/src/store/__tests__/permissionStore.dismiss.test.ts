// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { usePermissionStore } from '../permissionStore';

function resetStore() {
  usePermissionStore.setState({
    pending: [],
    resolved: [],
    errorIds: new Set(),
    dismissedIds: new Set(),
  });
  sessionStorage.clear();
}

function makePending(id: string) {
  return {
    id,
    tool_name: 'Bash',
    tool_input_preview: 'echo hello',
    createdAt: Date.now(),
    expiresAt: Date.now() + 1_800_000,
  };
}

describe('permissionStore dismiss', () => {
  beforeEach(() => resetStore());

  it('dismiss() removes from pending and adds to dismissedIds', () => {
    const store = usePermissionStore.getState();
    store.addPending(makePending('p-1'));
    store.dismiss('p-1');
    const state = usePermissionStore.getState();
    expect(state.pending).toHaveLength(0);
    expect(state.dismissedIds.has('p-1')).toBe(true);
  });

  it('dismiss() persists to sessionStorage', () => {
    const store = usePermissionStore.getState();
    store.addPending(makePending('p-1'));
    store.dismiss('p-1');
    const stored = sessionStorage.getItem('synapse-dismissed-permissions');
    expect(stored).toBeTruthy();
    expect(JSON.parse(stored!)).toContain('p-1');
  });

  it('hydrate() filters out dismissedIds', () => {
    usePermissionStore.setState({ dismissedIds: new Set(['p-2']) });
    usePermissionStore.getState().hydrate([makePending('p-1'), makePending('p-2')]);
    const state = usePermissionStore.getState();
    expect(state.pending).toHaveLength(1);
    expect(state.pending[0].id).toBe('p-1');
  });

  it('resolvePending() cleans up dismissedIds', () => {
    usePermissionStore.setState({ dismissedIds: new Set(['p-1']) });
    const store = usePermissionStore.getState();
    store.addPending(makePending('p-1'));
    store.resolvePending('p-1', 'allow');
    const state = usePermissionStore.getState();
    expect(state.dismissedIds.has('p-1')).toBe(false);
  });

  it('clearAllDismissed() dismisses all pending', () => {
    const store = usePermissionStore.getState();
    store.addPending(makePending('p-1'));
    store.addPending(makePending('p-2'));
    store.clearAllDismissed();
    const state = usePermissionStore.getState();
    expect(state.pending).toHaveLength(0);
    expect(state.dismissedIds.size).toBe(2);
  });
});
