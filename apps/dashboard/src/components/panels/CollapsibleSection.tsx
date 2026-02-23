// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Synapse Contributors

import { useState, useRef, useEffect, type ReactNode } from 'react';

interface CollapsibleSectionProps {
  title: string;
  badge?: string;
  defaultOpen?: boolean;
  children: ReactNode;
}

export function CollapsibleSection({
  title,
  badge,
  defaultOpen = false,
  children,
}: CollapsibleSectionProps) {
  const [open, setOpen] = useState(defaultOpen);
  const contentRef = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState<number | undefined>(defaultOpen ? undefined : 0);

  useEffect(() => {
    if (!contentRef.current) return;
    setHeight(open ? contentRef.current.scrollHeight : 0);
  }, [open]);

  return (
    <div>
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center gap-2 py-1.5 text-left group"
      >
        <span className={`text-gray-500 text-xs transition-transform ${open ? 'rotate-90' : ''}`}>
          ▶
        </span>
        <span className="text-gray-400 text-xs font-medium">{title}</span>
        {badge && <span className="text-gray-600 text-[10px] ml-auto">{badge}</span>}
      </button>
      <div
        ref={contentRef}
        className="overflow-hidden transition-[height] duration-200"
        style={{ height: height !== undefined ? `${height}px` : 'auto' }}
      >
        {children}
      </div>
    </div>
  );
}
