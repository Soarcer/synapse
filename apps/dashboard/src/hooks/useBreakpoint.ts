// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Bernhard

import { useState, useEffect, useRef } from 'react';

export type Breakpoint = 'sm' | 'md' | 'lg';

function getBreakpoint(): Breakpoint {
  const w = window.innerWidth;
  if (w < 768) return 'sm';
  if (w < 1024) return 'md';
  return 'lg';
}

export function useBreakpoint(): Breakpoint {
  const [bp, setBp] = useState(getBreakpoint);
  const timerRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => {
    const handler = () => {
      clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => setBp(getBreakpoint()), 150);
    };
    window.addEventListener('resize', handler);
    return () => {
      clearTimeout(timerRef.current);
      window.removeEventListener('resize', handler);
    };
  }, []);

  return bp;
}
