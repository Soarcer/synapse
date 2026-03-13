// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Bernhard

import { useEffect, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import type { PendingSummary } from '../../store/permissionStore';
import { PermissionCard } from './PermissionCard';

interface Props {
  permission: PendingSummary | null;
  onClose: () => void;
  onApprove: (id: string, answers?: Record<string, string>) => void;
  onDeny: (id: string) => void;
  onDismiss: (id: string) => void;
}

const SPRING = { type: 'spring' as const, stiffness: 300, damping: 30 };

export function PermissionModal({ permission, onClose, onApprove, onDeny, onDismiss }: Props) {
  const modalRef = useRef<HTMLDivElement>(null);

  // Escape key closes modal — capture phase to intercept before other handlers
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    },
    [onClose],
  );

  useEffect(() => {
    if (!permission) return;
    document.addEventListener('keydown', handleKeyDown, true);
    return () => document.removeEventListener('keydown', handleKeyDown, true);
  }, [permission, handleKeyDown]);

  // Focus trap: cycle Tab within modal
  useEffect(() => {
    if (!permission || !modalRef.current) return;
    const modal = modalRef.current;
    const focusable = modal.querySelectorAll<HTMLElement>(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
    );
    if (focusable.length > 0) focusable[0].focus();

    const handleTab = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last?.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first?.focus();
      }
    };

    modal.addEventListener('keydown', handleTab);
    return () => modal.removeEventListener('keydown', handleTab);
  }, [permission]);

  return (
    <AnimatePresence>
      {permission && (
        <motion.div
          className="fixed inset-0 z-[60] flex items-center justify-center p-4"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
        >
          {/* Backdrop */}
          <motion.div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />

          {/* Modal content */}
          <motion.div
            ref={modalRef}
            className="relative z-10 w-full max-w-[480px] max-h-[80vh] overflow-y-auto"
            initial={{ scale: 0.9, y: 20 }}
            animate={{ scale: 1, y: 0 }}
            exit={{ scale: 0.9, y: 20 }}
            transition={SPRING}
            role="dialog"
            aria-modal="true"
            aria-label="Permission details"
          >
            <PermissionCard
              permission={permission}
              onApprove={(...args) => {
                onApprove(...args);
                onClose();
              }}
              onDeny={(id) => {
                onDeny(id);
                onClose();
              }}
              onDismiss={(id) => {
                onDismiss(id);
                onClose();
              }}
              onCycle={() => {}}
              onExpandToModal={() => {}}
            />
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
