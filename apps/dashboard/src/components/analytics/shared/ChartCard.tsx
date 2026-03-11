// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Bernhard

import { type ReactNode } from 'react';

interface ChartCardProps {
  title: string;
  subtitle?: string;
  children: ReactNode;
  height?: number;
  className?: string;
  action?: ReactNode;
}

export function ChartCard({
  title,
  subtitle,
  children,
  height = 240,
  className = '',
  action,
}: ChartCardProps) {
  return (
    <div className={`rounded-xl border border-gray-800 bg-[#161b22] overflow-hidden ${className}`}>
      <div className="flex items-center justify-between px-4 pt-3 pb-1">
        <div>
          <h3 className="text-xs font-medium text-gray-400 uppercase tracking-wider">{title}</h3>
          {subtitle && <p className="text-[10px] text-gray-600 mt-0.5">{subtitle}</p>}
        </div>
        {action}
      </div>
      <div style={{ height }} className="px-2 pb-2">
        {children}
      </div>
    </div>
  );
}
