// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Bernhard

interface SkeletonProps {
  /** Number of skeleton rows to render */
  rows?: number;
  /** Whether to show a wider "header" bar on top */
  showHeader?: boolean;
}

function SkeletonBar({ className }: { className?: string }) {
  return <div className={`h-3 rounded bg-gray-800 animate-pulse ${className ?? ''}`} />;
}

export function SkeletonLoader({ rows = 3, showHeader = false }: SkeletonProps) {
  return (
    <div className="flex flex-col gap-3 p-4">
      {showHeader && <SkeletonBar className="w-2/5 h-4 mb-1" />}
      {Array.from({ length: rows }, (_, i) => (
        <SkeletonBar key={i} className={i % 2 === 0 ? 'w-4/5' : 'w-3/5'} />
      ))}
    </div>
  );
}
