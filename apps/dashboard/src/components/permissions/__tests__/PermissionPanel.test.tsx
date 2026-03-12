// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';

vi.mock('../../../utils/api', () => ({
  apiUrl: (path: string) => path,
}));

import { PermissionPanel } from '../PermissionPanel';
import { usePermissionStore, type PendingSummary } from '../../../store/permissionStore';

function resetStore() {
  usePermissionStore.setState({ pending: [], resolved: [], errorIds: new Set() });
}

function makePending(overrides: Partial<PendingSummary> = {}): PendingSummary {
  return {
    id: overrides.id ?? 'perm-1',
    tool_name: overrides.tool_name ?? 'Bash',
    tool_input_preview: overrides.tool_input_preview ?? 'echo hello',
    createdAt: overrides.createdAt ?? Date.now(),
    expiresAt: overrides.expiresAt ?? Date.now() + 1_800_000,
  };
}

describe('PermissionPanel', () => {
  beforeEach(() => {
    resetStore();
    cleanup();
  });

  it('renders nothing when no pending permissions', () => {
    const { container } = render(<PermissionPanel />);
    expect(container.children.length).toBe(0);
  });

  it('renders a card for each pending permission', () => {
    usePermissionStore.getState().addPending(makePending({ id: 'p-1', tool_name: 'Bash' }));
    usePermissionStore.getState().addPending(makePending({ id: 'p-2', tool_name: 'Write' }));

    render(<PermissionPanel />);
    expect(screen.getByText('Bash')).toBeTruthy();
    expect(screen.getByText('Write')).toBeTruthy();
  });

  it('shows pending count badge when multiple cards', () => {
    usePermissionStore.getState().addPending(makePending({ id: 'p-1' }));
    usePermissionStore.getState().addPending(makePending({ id: 'p-2' }));
    usePermissionStore.getState().addPending(makePending({ id: 'p-3' }));

    render(<PermissionPanel />);
    expect(screen.getByText('3 pending')).toBeTruthy();
  });
});
