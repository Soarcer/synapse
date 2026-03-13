// @vitest-environment jsdom
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';

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

import { PermissionCard } from '../PermissionCard';
import type { PendingSummary } from '../../../store/permissionStore';

function makePending(overrides: Partial<PendingSummary> = {}): PendingSummary {
  return {
    id: 'perm-1',
    tool_name: 'Bash',
    tool_input_preview: 'rm -rf build/dist && npm run build',
    createdAt: Date.now(),
    expiresAt: Date.now() + 1_800_000,
    ...overrides,
  };
}

describe('PermissionCard', () => {
  const mockApprove = vi.fn();
  const mockDeny = vi.fn();
  const mockDismiss = vi.fn();
  const mockCycle = vi.fn();
  const mockExpand = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    cleanup();
  });

  it('renders tool name and truncated input', () => {
    render(
      <PermissionCard
        permission={makePending()}
        onApprove={mockApprove}
        onDeny={mockDeny}
        onDismiss={mockDismiss}
        onCycle={mockCycle}
        onExpandToModal={mockExpand}
      />,
    );
    expect(screen.getByText('Bash')).toBeTruthy();
    expect(screen.getByText(/rm -rf build/)).toBeTruthy();
  });

  it('shows Approve and Deny buttons', () => {
    render(
      <PermissionCard
        permission={makePending()}
        onApprove={mockApprove}
        onDeny={mockDeny}
        onDismiss={mockDismiss}
        onCycle={mockCycle}
        onExpandToModal={mockExpand}
      />,
    );
    expect(screen.getByText('Approve')).toBeTruthy();
    expect(screen.getByText('Deny')).toBeTruthy();
  });

  it('calls onApprove when Approve is clicked', () => {
    render(
      <PermissionCard
        permission={makePending()}
        onApprove={mockApprove}
        onDeny={mockDeny}
        onDismiss={mockDismiss}
        onCycle={mockCycle}
        onExpandToModal={mockExpand}
      />,
    );
    fireEvent.click(screen.getByText('Approve'));
    expect(mockApprove).toHaveBeenCalledWith('perm-1');
  });

  it('calls onDeny when Deny is clicked', () => {
    render(
      <PermissionCard
        permission={makePending()}
        onApprove={mockApprove}
        onDeny={mockDeny}
        onDismiss={mockDismiss}
        onCycle={mockCycle}
        onExpandToModal={mockExpand}
      />,
    );
    fireEvent.click(screen.getByText('Deny'));
    expect(mockDeny).toHaveBeenCalledWith('perm-1');
  });

  it('has a close X button that calls onDismiss', () => {
    render(
      <PermissionCard
        permission={makePending()}
        onApprove={mockApprove}
        onDeny={mockDeny}
        onDismiss={mockDismiss}
        onCycle={mockCycle}
        onExpandToModal={mockExpand}
      />,
    );
    const dismissBtn = screen.getByRole('button', { name: /dismiss/i });
    fireEvent.click(dismissBtn);
    expect(mockDismiss).toHaveBeenCalledWith('perm-1');
  });

  it('shows countdown timer', () => {
    render(
      <PermissionCard
        permission={makePending({ expiresAt: Date.now() + 1_800_000 })}
        onApprove={mockApprove}
        onDeny={mockDeny}
        onDismiss={mockDismiss}
        onCycle={mockCycle}
        onExpandToModal={mockExpand}
      />,
    );
    expect(screen.getByText(/\d+:\d{2}/)).toBeTruthy();
  });

  it('shows timed-out state when expired', () => {
    render(
      <PermissionCard
        permission={makePending({ expiresAt: Date.now() - 60_000 })}
        onApprove={mockApprove}
        onDeny={mockDeny}
        onDismiss={mockDismiss}
        onCycle={mockCycle}
        onExpandToModal={mockExpand}
      />,
    );
    expect(screen.getByText(/timed out/i)).toBeTruthy();
  });

  it('truncates long input at 80 chars with expand button', () => {
    const longInput = 'x'.repeat(120);
    render(
      <PermissionCard
        permission={makePending({ tool_input_preview: longInput })}
        onApprove={mockApprove}
        onDeny={mockDeny}
        onDismiss={mockDismiss}
        onCycle={mockCycle}
        onExpandToModal={mockExpand}
      />,
    );
    expect(screen.getByText('[+]')).toBeTruthy();
  });
});
