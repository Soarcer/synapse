// @vitest-environment jsdom
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';

vi.mock('../../../utils/api', () => ({
  apiUrl: (path: string) => path,
}));

// Mock framer-motion to avoid animation complexity in tests
vi.mock('framer-motion', () => {
  return {
    motion: {
      div: React.forwardRef((props: Record<string, unknown>, ref: React.Ref<HTMLDivElement>) => {
        const {
          children,
          initial,
          animate,
          exit,
          transition,
          drag,
          dragSnapToOrigin,
          dragElastic,
          onDragEnd,
          whileHover,
          whileTap,
          layout,
          ...rest
        } = props;
        return React.createElement('div', { ...rest, ref }, children as React.ReactNode);
      }),
    },
    AnimatePresence: ({ children }: { children: React.ReactNode }) => children,
    useMotionValue: () => ({ get: () => 0, set: () => {} }),
    useTransform: () => ({ get: () => 1 }),
  };
});

import { PermissionStack } from '../PermissionStack';
import { usePermissionStore, type PendingSummary } from '../../../store/permissionStore';

function resetStore() {
  usePermissionStore.setState({
    pending: [],
    resolved: [],
    errorIds: new Set(),
    dismissedIds: new Set(),
  });
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

describe('PermissionStack', () => {
  beforeEach(() => {
    resetStore();
    cleanup();
  });

  it('renders nothing when no pending permissions', () => {
    const { container } = render(<PermissionStack />);
    expect(container.children.length).toBe(0);
  });

  it('renders a card for each visible pending permission', () => {
    usePermissionStore.getState().addPending(makePending({ id: 'p-1', tool_name: 'Bash' }));
    usePermissionStore.getState().addPending(makePending({ id: 'p-2', tool_name: 'Write' }));
    render(<PermissionStack />);
    expect(screen.getByText('Bash')).toBeTruthy();
    expect(screen.getByText('Write')).toBeTruthy();
  });

  it('shows clear-all button when more than 2 pending', () => {
    usePermissionStore.getState().addPending(makePending({ id: 'p-1' }));
    usePermissionStore.getState().addPending(makePending({ id: 'p-2' }));
    usePermissionStore.getState().addPending(makePending({ id: 'p-3' }));
    render(<PermissionStack />);
    expect(screen.getByText('Clear all (3)')).toBeTruthy();
  });

  it('shows +N more badge when more than 4 items', () => {
    for (let i = 0; i < 6; i++) {
      usePermissionStore.getState().addPending(makePending({ id: `p-${i}` }));
    }
    render(<PermissionStack />);
    expect(screen.getByText('+2 more')).toBeTruthy();
  });
});
