// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Bernhard

interface TimeRangeSelectorProps {
  value: string;
  onChange: (range: string) => void;
}

const RANGES = [
  { label: '1h', value: '1h' },
  { label: '6h', value: '6h' },
  { label: '24h', value: '24h' },
  { label: '7d', value: '7d' },
  { label: '30d', value: '30d' },
  { label: 'All', value: 'all' },
];

export function TimeRangeSelector({ value, onChange }: TimeRangeSelectorProps) {
  return (
    <div className="flex items-center gap-0.5 p-0.5 bg-gray-800/50 rounded-lg">
      {RANGES.map((r) => (
        <button
          key={r.value}
          onClick={() => onChange(r.value)}
          className={`
            px-2.5 py-1 text-xs font-medium rounded-md transition-all
            ${
              value === r.value
                ? 'bg-gray-700 text-gray-100 shadow-sm'
                : 'text-gray-500 hover:text-gray-300'
            }
          `}
        >
          {r.label}
        </button>
      ))}
    </div>
  );
}
