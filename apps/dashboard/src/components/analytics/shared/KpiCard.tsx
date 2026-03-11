// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Bernhard

import { AreaChart, Area, ResponsiveContainer } from 'recharts';

interface KpiCardProps {
  label: string;
  value: string;
  subtitle?: string;
  delta?: number; // percentage change, e.g. +12.5 or -3.2
  sparkData?: number[];
  color?: string;
  icon?: string;
  onClick?: () => void;
  selected?: boolean;
}

export function KpiCard({
  label,
  value,
  subtitle,
  delta,
  sparkData,
  color = '#3b82f6',
  icon,
  onClick,
  selected,
}: KpiCardProps) {
  const deltaColor = delta === undefined ? '' : delta >= 0 ? 'text-emerald-400' : 'text-red-400';
  const deltaArrow = delta === undefined ? '' : delta >= 0 ? '\u2191' : '\u2193';

  // Convert sparkData to recharts format
  const chartData = sparkData?.map((v, i) => ({ idx: i, val: v }));

  return (
    <button
      onClick={onClick}
      className={`
        group relative flex flex-col gap-1 p-4 rounded-xl border transition-all text-left w-full
        ${
          selected
            ? 'border-blue-500/60 bg-blue-500/10'
            : 'border-gray-800 bg-[#161b22] hover:border-gray-700 hover:bg-[#1c2128]'
        }
      `}
    >
      {/* Label row */}
      <div className="flex items-center gap-1.5 text-[11px] text-gray-500 uppercase tracking-wider font-medium">
        {icon && <span className="text-sm">{icon}</span>}
        {label}
      </div>

      {/* Value row */}
      <div className="flex items-baseline gap-2">
        <span className="text-2xl font-semibold text-gray-100 tracking-tight">{value}</span>
        {delta !== undefined && (
          <span className={`text-xs font-medium ${deltaColor}`}>
            {deltaArrow} {Math.abs(delta).toFixed(1)}%
          </span>
        )}
      </div>

      {/* Subtitle */}
      {subtitle && <div className="text-[11px] text-gray-500">{subtitle}</div>}

      {/* Sparkline */}
      {chartData && chartData.length > 1 && (
        <div className="h-8 mt-1 -mx-1">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={chartData} margin={{ top: 0, right: 0, bottom: 0, left: 0 }}>
              <defs>
                <linearGradient
                  id={`spark-${label.replace(/\s/g, '')}`}
                  x1="0"
                  y1="0"
                  x2="0"
                  y2="1"
                >
                  <stop offset="0%" stopColor={color} stopOpacity={0.3} />
                  <stop offset="100%" stopColor={color} stopOpacity={0} />
                </linearGradient>
              </defs>
              <Area
                type="monotone"
                dataKey="val"
                stroke={color}
                strokeWidth={1.5}
                fill={`url(#spark-${label.replace(/\s/g, '')})`}
                isAnimationActive={false}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}
    </button>
  );
}
