// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Bernhard

import { useState, useCallback } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { usePermissionStore, type PendingSummary } from '../../store/permissionStore';
import { PermissionCard } from './PermissionCard';
import { PermissionModal } from './PermissionModal';

const MAX_VISIBLE_BEHIND = 3;
const SPRING = { type: 'spring' as const, stiffness: 300, damping: 30 };

// Depth styling for stacked cards behind the top card
// Each level shifts up and right so the stack fan is visible
const DEPTH_STYLES = [
  {}, // top card — no transform
  { scale: 0.97, x: 16, y: -16, opacity: 0.7 },
  { scale: 0.94, x: 32, y: -32, opacity: 0.5 },
  { scale: 0.91, x: 48, y: -48, opacity: 0.35 },
];

export function PermissionStack() {
  const pending = usePermissionStore((s) => s.pending);
  const approve = usePermissionStore((s) => s.approve);
  const deny = usePermissionStore((s) => s.deny);
  const dismiss = usePermissionStore((s) => s.dismiss);
  const cycleToBottom = usePermissionStore((s) => s.cycleToBottom);
  const clearAllDismissed = usePermissionStore((s) => s.clearAllDismissed);

  const [modalPermission, setModalPermission] = useState<PendingSummary | null>(null);

  const handleDismiss = useCallback(
    (id: string) => {
      dismiss(id);
    },
    [dismiss],
  );

  const handleCycle = useCallback(
    (id: string) => {
      cycleToBottom(id);
    },
    [cycleToBottom],
  );

  const handleExpandToModal = useCallback((p: PendingSummary) => setModalPermission(p), []);

  // Newest on top (reverse of store order which is oldest-first)
  const displayItems = [...pending].reverse();
  const visibleCount = Math.min(displayItems.length, MAX_VISIBLE_BEHIND + 1);
  const hiddenCount = Math.max(0, displayItems.length - visibleCount);

  if (displayItems.length === 0) return null;

  return (
    <>
      {/* Stack container — bottom-center, pointer-events-none wrapper */}
      {/* bottom-16 on mobile clears the tab bar (56px), bottom-6 on desktop */}
      <div className="fixed bottom-16 sm:bottom-6 left-1/2 -translate-x-1/2 z-50 w-full max-w-96 px-4 sm:px-0 pointer-events-none overflow-visible">
        {/* Clear-all button */}
        {pending.length > 2 && (
          <div className="flex justify-center mb-2 pointer-events-auto">
            <button
              onClick={clearAllDismissed}
              className="px-3 py-1 text-[10px] font-medium rounded-full bg-gray-800/80 text-gray-300 hover:bg-gray-700 hover:text-gray-100 border border-gray-700/50 backdrop-blur-sm transition-colors"
            >
              Clear all ({pending.length})
            </button>
          </div>
        )}

        {/* "+N more" badge */}
        {hiddenCount > 0 && (
          <div className="flex justify-center mb-1.5 pointer-events-none">
            <span className="text-[10px] text-gray-500 bg-gray-900/60 rounded-full px-2 py-0.5">
              +{hiddenCount} more
            </span>
          </div>
        )}

        {/* Card stack */}
        <div className="relative pointer-events-auto overflow-visible">
          <AnimatePresence mode="popLayout">
            {displayItems.slice(0, visibleCount).map((p, index) => {
              const depth = DEPTH_STYLES[index] ?? DEPTH_STYLES[MAX_VISIBLE_BEHIND];
              const isTop = index === 0;
              const offsetX = depth.x ?? 0;
              const offsetY = depth.y ?? 0;
              return (
                <motion.div
                  key={p.id}
                  style={{
                    position: index === 0 ? 'relative' : 'absolute',
                    bottom: index === 0 ? undefined : -offsetY,
                    left: offsetX,
                    width: '100%',
                    zIndex: visibleCount - index,
                    pointerEvents: isTop ? 'auto' : 'none',
                  }}
                  animate={{
                    scale: depth.scale ?? 1,
                    opacity: depth.opacity ?? 1,
                  }}
                  transition={SPRING}
                >
                  <PermissionCard
                    permission={p}
                    onApprove={approve}
                    onDeny={deny}
                    onDismiss={handleDismiss}
                    onCycle={handleCycle}
                    onExpandToModal={handleExpandToModal}
                  />
                </motion.div>
              );
            })}
          </AnimatePresence>
        </div>
      </div>

      {/* Modal */}
      <PermissionModal
        permission={modalPermission}
        onClose={() => setModalPermission(null)}
        onApprove={approve}
        onDeny={deny}
        onDismiss={handleDismiss}
      />
    </>
  );
}
