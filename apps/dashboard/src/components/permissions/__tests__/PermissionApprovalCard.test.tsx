// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';

vi.mock('../../../utils/api', () => ({
  apiUrl: (path: string) => path,
}));

import { PermissionApprovalCard } from '../PermissionApprovalCard';
import type { PendingSummary } from '../../../store/permissionStore';

function makePending(overrides: Partial<PendingSummary> = {}): PendingSummary {
  return {
    id: 'perm-1',
    tool_name: 'Bash',
    tool_input_preview: 'rm -rf build/dist && npm run build',
    createdAt: Date.now(),
    expiresAt: Date.now() + 1_800_000, // 30 min
    ...overrides,
  };
}

describe('PermissionApprovalCard', () => {
  const mockApprove = vi.fn();
  const mockDeny = vi.fn();
  const mockDismiss = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    cleanup();
  });

  it('renders tool name and truncated input', () => {
    render(
      <PermissionApprovalCard
        permission={makePending()}
        onApprove={mockApprove}
        onDeny={mockDeny}
        onDismiss={mockDismiss}
      />,
    );
    expect(screen.getByText('Bash')).toBeTruthy();
    expect(screen.getByText(/rm -rf build/)).toBeTruthy();
  });

  it('shows Approve and Deny buttons', () => {
    render(
      <PermissionApprovalCard
        permission={makePending()}
        onApprove={mockApprove}
        onDeny={mockDeny}
        onDismiss={mockDismiss}
      />,
    );
    expect(screen.getByRole('button', { name: /approve/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: /deny/i })).toBeTruthy();
  });

  it('calls onApprove when Approve is clicked', () => {
    render(
      <PermissionApprovalCard
        permission={makePending()}
        onApprove={mockApprove}
        onDeny={mockDeny}
        onDismiss={mockDismiss}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /approve/i }));
    expect(mockApprove).toHaveBeenCalledWith('perm-1');
  });

  it('calls onDeny when Deny is clicked', () => {
    render(
      <PermissionApprovalCard
        permission={makePending()}
        onApprove={mockApprove}
        onDeny={mockDeny}
        onDismiss={mockDismiss}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /deny/i }));
    expect(mockDeny).toHaveBeenCalledWith('perm-1');
  });

  it('shows disabled "Always allow" placeholder', () => {
    render(
      <PermissionApprovalCard
        permission={makePending()}
        onApprove={mockApprove}
        onDeny={mockDeny}
        onDismiss={mockDismiss}
      />,
    );
    const alwaysBtn = screen.getByRole('button', { name: /always allow/i });
    expect(alwaysBtn).toBeTruthy();
    expect(
      alwaysBtn.hasAttribute('disabled') || alwaysBtn.getAttribute('aria-disabled') === 'true',
    ).toBe(true);
  });

  it('shows countdown timer', () => {
    render(
      <PermissionApprovalCard
        permission={makePending({ expiresAt: Date.now() + 1_800_000 })}
        onApprove={mockApprove}
        onDeny={mockDeny}
        onDismiss={mockDismiss}
      />,
    );
    // Should show ~29:xx or 30:00
    expect(screen.getByText(/\d+:\d{2}/)).toBeTruthy();
  });

  it('shows timed-out state when expired', () => {
    render(
      <PermissionApprovalCard
        permission={makePending({ expiresAt: Date.now() - 60_000 })}
        onApprove={mockApprove}
        onDeny={mockDeny}
        onDismiss={mockDismiss}
      />,
    );
    expect(screen.getByText(/timed out/i)).toBeTruthy();
    expect(screen.getByRole('button', { name: /dismiss/i })).toBeTruthy();
    // Approve/Deny buttons should NOT be visible in expired state
    expect(screen.queryByRole('button', { name: /^approve$/i })).toBeNull();
  });

  it('truncates long input at 80 chars with expand button', () => {
    const longInput = 'x'.repeat(120);
    render(
      <PermissionApprovalCard
        permission={makePending({ tool_input_preview: longInput })}
        onApprove={mockApprove}
        onDeny={mockDeny}
        onDismiss={mockDismiss}
      />,
    );
    // Should show truncated text and expand button
    expect(screen.getByText('[+]')).toBeTruthy();
  });
});
