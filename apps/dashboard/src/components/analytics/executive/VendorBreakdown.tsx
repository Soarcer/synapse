// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Bernhard

import { useMemo } from 'react';
import {
  Treemap,
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
} from 'recharts';
import type { MockSession, MockDailyRollup } from '../mockData';

interface VendorBreakdownProps {
  sessions: MockSession[];
  dailyRollups: MockDailyRollup[];
}

const VENDOR_COLORS: Record<string, string> = {
  anthropic: '#d97706',
  openai: '#10b981',
  google: '#3b82f6',
  groq: '#ef4444',
  unknown: '#6b7280',
};

export function VendorBreakdown({ sessions, dailyRollups }: VendorBreakdownProps) {
  const vendorData = useMemo(() => {
    const vendorMap = new Map<
      string,
      { cost: number; sessions: number; tokens: number; models: Map<string, number> }
    >();

    for (const s of sessions) {
      const vendor = s.vendor || 'anthropic';
      const entry = vendorMap.get(vendor) || { cost: 0, sessions: 0, tokens: 0, models: new Map() };
      entry.cost += s.totalCost;
      entry.sessions++;
      entry.tokens += s.totalInputTokens + s.totalOutputTokens;
      entry.models.set(s.model, (entry.models.get(s.model) || 0) + s.totalCost);
      vendorMap.set(vendor, entry);
    }

    return vendorMap;
  }, [sessions]);

  // Treemap data: vendor -> models
  const treemapData = useMemo(() => {
    const children: Array<{ name: string; size: number; fill: string }> = [];
    for (const [vendor, data] of vendorData) {
      for (const [model, cost] of data.models) {
        children.push({
          name: `${model}`,
          size: Math.max(cost, 0.01),
          fill: VENDOR_COLORS[vendor] || VENDOR_COLORS.unknown,
        });
      }
    }
    return children;
  }, [vendorData]);

  // Daily cost by vendor for stacked area chart
  const dailyByVendor = useMemo(() => {
    return dailyRollups.map((d) => {
      const entry: Record<string, unknown> = { date: d.date };
      // In real data we'd have per-vendor breakdown; for now estimate from models
      for (const [model, stats] of Object.entries(d.models)) {
        let vendor = 'anthropic';
        if (model.includes('gpt') || model.includes('o1') || model.includes('o3'))
          vendor = 'openai';
        else if (model.includes('gemini')) vendor = 'google';
        entry[vendor] = ((entry[vendor] as number) || 0) + stats.cost;
      }
      return entry;
    });
  }, [dailyRollups]);

  const vendors = [...vendorData.keys()];

  return (
    <div className="space-y-4">
      {/* Vendor summary badges */}
      <div className="flex flex-wrap gap-2">
        {[...vendorData.entries()].map(([vendor, data]) => (
          <div
            key={vendor}
            className="flex items-center gap-2 px-3 py-1.5 bg-syn-bg-surface border border-gray-800 rounded-full"
          >
            <div
              className="w-2 h-2 rounded-full"
              style={{ backgroundColor: VENDOR_COLORS[vendor] || VENDOR_COLORS.unknown }}
            />
            <span className="text-xs text-gray-300 font-medium capitalize">{vendor}</span>
            <span className="text-xs text-gray-500">${data.cost.toFixed(2)}</span>
            <span className="text-[10px] text-gray-600">{data.sessions} sessions</span>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Treemap: Cost by Model */}
        <div className="bg-syn-bg-surface border border-gray-800 rounded-xl p-4">
          <h4 className="text-xs font-medium text-gray-400 mb-3">Cost by Model (Treemap)</h4>
          <ResponsiveContainer width="100%" height={250}>
            <Treemap
              data={treemapData}
              dataKey="size"
              aspectRatio={4 / 3}
              stroke="#0d1117"
              content={(props: Record<string, unknown>) => {
                const x = props.x as number;
                const y = props.y as number;
                const width = props.width as number;
                const height = props.height as number;
                const name = props.name as string | undefined;
                const fill = props.fill as string | undefined;
                if (width < 40 || height < 25) return <g />;
                return (
                  <g>
                    <rect
                      x={x}
                      y={y}
                      width={width}
                      height={height}
                      fill={fill}
                      rx={4}
                      opacity={0.85}
                    />
                    <text
                      x={x + width / 2}
                      y={y + height / 2}
                      textAnchor="middle"
                      dominantBaseline="middle"
                      fill="#fff"
                      fontSize={10}
                    >
                      {name}
                    </text>
                  </g>
                );
              }}
            />
          </ResponsiveContainer>
        </div>

        {/* Stacked Area: Daily Cost by Vendor */}
        <div className="bg-syn-bg-surface border border-gray-800 rounded-xl p-4">
          <h4 className="text-xs font-medium text-gray-400 mb-3">Daily Cost by Vendor</h4>
          <ResponsiveContainer width="100%" height={250}>
            <AreaChart data={dailyByVendor}>
              <CartesianGrid strokeDasharray="3 3" stroke="#21262d" />
              <XAxis
                dataKey="date"
                tick={{ fill: '#8b949e', fontSize: 10 }}
                tickFormatter={(v: string) => v.slice(5)}
              />
              <YAxis
                tick={{ fill: '#8b949e', fontSize: 10 }}
                tickFormatter={(v: number = 0) => `$${v.toFixed(1)}`}
              />
              <Tooltip
                contentStyle={{
                  backgroundColor: '#161b22',
                  border: '1px solid #30363d',
                  borderRadius: '8px',
                  fontSize: '11px',
                }}
                formatter={(v: number = 0) => [`$${v.toFixed(4)}`, undefined]}
              />
              <Legend wrapperStyle={{ fontSize: '11px' }} />
              {vendors.map((vendor) => (
                <Area
                  key={vendor}
                  type="monotone"
                  dataKey={vendor}
                  stackId="1"
                  fill={VENDOR_COLORS[vendor] || VENDOR_COLORS.unknown}
                  stroke={VENDOR_COLORS[vendor] || VENDOR_COLORS.unknown}
                  fillOpacity={0.6}
                />
              ))}
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
}
