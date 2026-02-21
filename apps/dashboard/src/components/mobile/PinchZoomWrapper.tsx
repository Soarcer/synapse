// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Synapse Contributors

import { useRef, useCallback, useEffect, type ReactNode } from 'react';

interface PinchZoomWrapperProps {
  children: ReactNode;
  className?: string;
  minScale?: number;
  maxScale?: number;
}

/**
 * Wraps content with pinch-to-zoom + pan support on touch devices.
 * Sets `touch-action: none` so the browser won't capture pinch as page zoom.
 * Uses CSS transforms for smooth scaling/panning.
 */
export function PinchZoomWrapper({
  children,
  className = '',
  minScale = 0.5,
  maxScale = 4,
}: PinchZoomWrapperProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);

  // Transform state stored in refs to avoid re-renders during gestures
  const scaleRef = useRef(1);
  const translateRef = useRef({ x: 0, y: 0 });
  const gestureRef = useRef<{
    initialDistance: number;
    initialScale: number;
    initialMidpoint: { x: number; y: number };
    initialTranslate: { x: number; y: number };
  } | null>(null);
  const panRef = useRef<{
    startX: number;
    startY: number;
    startTranslate: { x: number; y: number };
  } | null>(null);
  const rafRef = useRef<number>(0);

  const applyTransform = useCallback(() => {
    if (!contentRef.current) return;
    const s = scaleRef.current;
    const { x, y } = translateRef.current;
    contentRef.current.style.transform = `translate(${x}px, ${y}px) scale(${s})`;
  }, []);

  const getDistance = (t1: Touch, t2: Touch) =>
    Math.hypot(t2.clientX - t1.clientX, t2.clientY - t1.clientY);

  const getMidpoint = (t1: Touch, t2: Touch) => ({
    x: (t1.clientX + t2.clientX) / 2,
    y: (t1.clientY + t2.clientY) / 2,
  });

  const handleTouchStart = useCallback(
    (e: TouchEvent) => {
      if (e.touches.length === 2) {
        // Start pinch
        e.preventDefault();
        panRef.current = null;
        const d = getDistance(e.touches[0], e.touches[1]);
        const mid = getMidpoint(e.touches[0], e.touches[1]);
        gestureRef.current = {
          initialDistance: d,
          initialScale: scaleRef.current,
          initialMidpoint: mid,
          initialTranslate: { ...translateRef.current },
        };
      } else if (e.touches.length === 1 && scaleRef.current > 1) {
        // Start pan (only when zoomed in)
        e.preventDefault();
        panRef.current = {
          startX: e.touches[0].clientX,
          startY: e.touches[0].clientY,
          startTranslate: { ...translateRef.current },
        };
      }
    },
    [],
  );

  const handleTouchMove = useCallback(
    (e: TouchEvent) => {
      if (e.touches.length === 2 && gestureRef.current) {
        e.preventDefault();
        const g = gestureRef.current;
        const newDist = getDistance(e.touches[0], e.touches[1]);
        const ratio = newDist / g.initialDistance;
        const newScale = Math.min(maxScale, Math.max(minScale, g.initialScale * ratio));

        // Zoom toward pinch midpoint
        const newMid = getMidpoint(e.touches[0], e.touches[1]);
        const scaleDelta = newScale / g.initialScale;
        const newX = newMid.x - (g.initialMidpoint.x - g.initialTranslate.x) * scaleDelta;
        const newY = newMid.y - (g.initialMidpoint.y - g.initialTranslate.y) * scaleDelta;

        scaleRef.current = newScale;
        translateRef.current = { x: newX, y: newY };

        cancelAnimationFrame(rafRef.current);
        rafRef.current = requestAnimationFrame(applyTransform);
      } else if (e.touches.length === 1 && panRef.current) {
        e.preventDefault();
        const p = panRef.current;
        const dx = e.touches[0].clientX - p.startX;
        const dy = e.touches[0].clientY - p.startY;
        translateRef.current = {
          x: p.startTranslate.x + dx,
          y: p.startTranslate.y + dy,
        };

        cancelAnimationFrame(rafRef.current);
        rafRef.current = requestAnimationFrame(applyTransform);
      }
    },
    [minScale, maxScale, applyTransform],
  );

  const handleTouchEnd = useCallback(
    (e: TouchEvent) => {
      if (e.touches.length < 2) {
        gestureRef.current = null;
      }
      if (e.touches.length === 0) {
        panRef.current = null;
        // Snap back to 1x if close
        if (scaleRef.current < 1.05 && scaleRef.current > 0.95) {
          scaleRef.current = 1;
          translateRef.current = { x: 0, y: 0 };
          if (contentRef.current) {
            contentRef.current.style.transition = 'transform 0.2s ease-out';
            applyTransform();
            setTimeout(() => {
              if (contentRef.current) contentRef.current.style.transition = '';
            }, 200);
          }
        }
      }
    },
    [applyTransform],
  );

  // Double-tap to reset zoom
  const lastTapRef = useRef(0);
  const handleDoubleTap = useCallback(
    (e: TouchEvent) => {
      if (e.touches.length !== 1) return;
      const now = Date.now();
      if (now - lastTapRef.current < 300) {
        e.preventDefault();
        scaleRef.current = 1;
        translateRef.current = { x: 0, y: 0 };
        if (contentRef.current) {
          contentRef.current.style.transition = 'transform 0.2s ease-out';
          applyTransform();
          setTimeout(() => {
            if (contentRef.current) contentRef.current.style.transition = '';
          }, 200);
        }
      }
      lastTapRef.current = now;
    },
    [applyTransform],
  );

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    el.addEventListener('touchstart', handleTouchStart, { passive: false });
    el.addEventListener('touchmove', handleTouchMove, { passive: false });
    el.addEventListener('touchend', handleTouchEnd);
    el.addEventListener('touchcancel', handleTouchEnd);
    el.addEventListener('touchstart', handleDoubleTap, { passive: false });

    return () => {
      el.removeEventListener('touchstart', handleTouchStart);
      el.removeEventListener('touchmove', handleTouchMove);
      el.removeEventListener('touchend', handleTouchEnd);
      el.removeEventListener('touchcancel', handleTouchEnd);
      el.removeEventListener('touchstart', handleDoubleTap);
      cancelAnimationFrame(rafRef.current);
    };
  }, [handleTouchStart, handleTouchMove, handleTouchEnd, handleDoubleTap]);

  return (
    <div
      ref={containerRef}
      className={`overflow-hidden ${className}`}
      style={{ touchAction: 'none' }}
    >
      <div ref={contentRef} className="w-full h-full" style={{ transformOrigin: '0 0' }}>
        {children}
      </div>
    </div>
  );
}
