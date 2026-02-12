import { useState, useEffect } from 'react';

export type Breakpoint = 'sm' | 'md' | 'lg';

function getBreakpoint(): Breakpoint {
  const w = window.innerWidth;
  if (w < 768) return 'sm';
  if (w < 1024) return 'md';
  return 'lg';
}

export function useBreakpoint(): Breakpoint {
  const [bp, setBp] = useState(getBreakpoint);

  useEffect(() => {
    const handler = () => setBp(getBreakpoint());
    window.addEventListener('resize', handler);
    return () => window.removeEventListener('resize', handler);
  }, []);

  return bp;
}
