// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Synapse Contributors

import { useState, useRef, useCallback, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

interface TooltipProps {
  content: string;
  shortcut?: string;
  side?: 'top' | 'bottom';
  delay?: number;
  children: ReactNode;
}

let _counter = 0;

export function Tooltip({ content, shortcut, side, delay = 300, children }: TooltipProps) {
  const [visible, setVisible] = useState(false);
  const [coords, setCoords] = useState({ x: 0, y: 0, placement: 'top' as 'top' | 'bottom' });
  const triggerRef = useRef<HTMLSpanElement>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const idRef = useRef(`tt-${++_counter}`);

  const show = useCallback(() => {
    timerRef.current = setTimeout(() => {
      const wrapper = triggerRef.current;
      if (!wrapper) return;
      // display:contents makes the wrapper invisible to layout — measure the first child instead
      const el = (wrapper.firstElementChild as HTMLElement) ?? wrapper;
      const rect = el.getBoundingClientRect();
      if (rect.width === 0 && rect.height === 0) return;
      const placement: 'top' | 'bottom' = side ?? (rect.top < 40 ? 'bottom' : 'top');
      setCoords({
        x: rect.left + rect.width / 2,
        y: placement === 'top' ? rect.top - 6 : rect.bottom + 6,
        placement,
      });
      setVisible(true);
    }, delay);
  }, [side, delay]);

  const hide = useCallback(() => {
    clearTimeout(timerRef.current);
    setVisible(false);
  }, []);

  const id = idRef.current;

  return (
    <span
      ref={triggerRef}
      onMouseEnter={show}
      onMouseLeave={hide}
      onFocus={show}
      onBlur={hide}
      aria-describedby={visible ? id : undefined}
      style={{ display: 'contents' }}
    >
      {children}
      {visible &&
        createPortal(
          <span
            id={id}
            role="tooltip"
            className="fixed z-50 pointer-events-none px-2 py-1 bg-gray-900 border border-gray-700 rounded text-[11px] text-gray-200 shadow-lg whitespace-nowrap"
            style={{
              left: coords.x,
              top: coords.y,
              transform: coords.placement === 'top' ? 'translate(-50%, -100%)' : 'translateX(-50%)',
            }}
          >
            {content}
            {shortcut && (
              <kbd className="ml-1.5 px-1 py-0.5 rounded bg-gray-800 text-gray-400 text-[10px] font-mono border border-gray-600">
                {shortcut}
              </kbd>
            )}
          </span>,
          document.body,
        )}
    </span>
  );
}
