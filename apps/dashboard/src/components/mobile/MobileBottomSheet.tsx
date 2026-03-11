// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Bernhard

import { useRef, useEffect, useCallback, useState } from 'react';
import { useAgentStore } from '../../store/agentStore';
import { AgentDetailPanel } from '../panels/AgentDetailPanel';
import { ErrorBoundary } from '../ErrorBoundary';

type SnapPoint = 'closed' | 'peek' | 'full';

const SNAP_FRACTIONS: Record<SnapPoint, number> = {
  closed: 0,
  peek: 0.4,
  full: 0.9,
};

const TAB_BAR_HEIGHT = 56; // px, must match MobileTabBar height

export function MobileBottomSheet() {
  const selectedNodeId = useAgentStore((s) => s.selectedNodeId);
  const selectNode = useAgentStore((s) => s.selectNode);
  const [snap, setSnap] = useState<SnapPoint>('closed');
  const sheetRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{
    startY: number;
    startTranslate: number;
    rafId: number | null;
    currentY: number;
  } | null>(null);

  const isOpen = snap !== 'closed';

  // Open to peek when a node is selected
  useEffect(() => {
    if (selectedNodeId && selectedNodeId !== '__spawn__') {
      setSnap('peek');
    } else {
      setSnap('closed');
    }
  }, [selectedNodeId]);

  // Cleanup rAF on unmount
  useEffect(() => {
    return () => {
      if (dragRef.current?.rafId !== null && dragRef.current?.rafId !== undefined) {
        cancelAnimationFrame(dragRef.current.rafId);
      }
    };
  }, []);

  const getSheetHeight = useCallback(() => window.innerHeight - TAB_BAR_HEIGHT, []);

  const getTranslateForSnap = useCallback(
    (s: SnapPoint) => {
      const h = getSheetHeight();
      return h * (1 - SNAP_FRACTIONS[s]);
    },
    [getSheetHeight],
  );

  const snapToNearest = useCallback(
    (currentTranslateY: number) => {
      const h = getSheetHeight();
      const fraction = 1 - currentTranslateY / h;
      let closest: SnapPoint = 'closed';
      let minDist = Infinity;
      for (const [sp, frac] of Object.entries(SNAP_FRACTIONS) as Array<[SnapPoint, number]>) {
        const dist = Math.abs(fraction - frac);
        if (dist < minDist) {
          minDist = dist;
          closest = sp;
        }
      }
      setSnap(closest);
      if (closest === 'closed') {
        selectNode(null);
      }
    },
    [getSheetHeight, selectNode],
  );

  const onTouchStart = useCallback(
    (e: React.TouchEvent) => {
      const touch = e.touches[0];
      const currentTranslate = getTranslateForSnap(snap);
      dragRef.current = {
        startY: touch.clientY,
        startTranslate: currentTranslate,
        rafId: null,
        currentY: currentTranslate,
      };
      if (sheetRef.current) {
        sheetRef.current.style.transition = 'none';
      }
    },
    [snap, getTranslateForSnap],
  );

  const onTouchMove = useCallback((e: React.TouchEvent) => {
    if (!dragRef.current || !sheetRef.current) return;
    const touch = e.touches[0];
    const delta = touch.clientY - dragRef.current.startY;
    const newY = Math.max(0, dragRef.current.startTranslate + delta);
    dragRef.current.currentY = newY;

    if (dragRef.current.rafId === null) {
      dragRef.current.rafId = requestAnimationFrame(() => {
        if (sheetRef.current && dragRef.current) {
          sheetRef.current.style.transform = `translateY(${dragRef.current.currentY}px)`;
        }
        if (dragRef.current) dragRef.current.rafId = null;
      });
    }
  }, []);

  const finishDrag = useCallback(() => {
    if (!dragRef.current) return;
    if (dragRef.current.rafId !== null) {
      cancelAnimationFrame(dragRef.current.rafId);
    }
    if (sheetRef.current) {
      sheetRef.current.style.transition = '';
    }
    snapToNearest(dragRef.current.currentY);
    dragRef.current = null;
  }, [snapToNearest]);

  // Recalculate on orientation change
  useEffect(() => {
    const handler = () => {
      if (sheetRef.current && snap !== 'closed') {
        sheetRef.current.style.transform = `translateY(${getTranslateForSnap(snap)}px)`;
      }
    };
    window.addEventListener('resize', handler);
    return () => window.removeEventListener('resize', handler);
  }, [snap, getTranslateForSnap]);

  if (!isOpen) return null;

  const translateY = getTranslateForSnap(snap);

  return (
    <>
      {/* Backdrop — stops above tab bar */}
      <div
        className="absolute inset-x-0 top-0 bg-black/20 z-40"
        style={{ bottom: `${TAB_BAR_HEIGHT}px` }}
        onClick={() => selectNode(null)}
      />

      {/* Sheet */}
      <div
        ref={sheetRef}
        className="absolute inset-x-0 z-50 bg-[#161b22] rounded-t-2xl flex flex-col transition-transform duration-300 ease-out [&>div]:w-full"
        style={{
          bottom: `${TAB_BAR_HEIGHT}px`,
          height: `${getSheetHeight()}px`,
          transform: `translateY(${translateY}px)`,
        }}
      >
        {/* Drag handle */}
        <div
          className="flex-shrink-0 flex justify-center py-3 cursor-grab active:cursor-grabbing"
          onTouchStart={onTouchStart}
          onTouchMove={onTouchMove}
          onTouchEnd={finishDrag}
          onTouchCancel={finishDrag}
        >
          <div className="w-10 h-1 bg-gray-600 rounded-full" />
        </div>

        {/* Content — override PanelShell w-80 */}
        <div className="flex-1 overflow-y-auto px-1 [&>div]:w-full">
          <ErrorBoundary name="AgentDetailPanel">
            <AgentDetailPanel />
          </ErrorBoundary>
        </div>
      </div>
    </>
  );
}
