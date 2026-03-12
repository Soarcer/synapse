// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Bernhard

import { useCallback } from 'react';
import { usePermissionStore } from '../../store/permissionStore';
import { PermissionApprovalCard } from './PermissionApprovalCard';

export function PermissionPanel() {
  const pending = usePermissionStore((s) => s.pending);
  const approve = usePermissionStore((s) => s.approve);
  const deny = usePermissionStore((s) => s.deny);
  const resolvePending = usePermissionStore((s) => s.resolvePending);

  const handleDismiss = useCallback((id: string) => resolvePending(id, 'deny'), [resolvePending]);

  if (pending.length === 0) return null;

  return (
    // P1: position left of ToolLogPanel (which is right-0 w-80) to avoid overlap
    <div className="fixed bottom-4 right-[340px] z-50 flex flex-col gap-3 w-80 max-h-[80vh] overflow-y-auto">
      {/* Badge showing count */}
      {pending.length > 1 && (
        <div className="text-xs text-gray-400 text-center bg-gray-900/80 rounded-full px-3 py-1 self-center backdrop-blur-sm border border-gray-700/40">
          {pending.length} pending
        </div>
      )}
      {/* Stacked cards — oldest first */}
      {pending.map((p) => (
        <PermissionApprovalCard
          key={p.id}
          permission={p}
          onApprove={approve}
          onDeny={deny}
          onDismiss={handleDismiss}
        />
      ))}
    </div>
  );
}
