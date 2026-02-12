interface MetricDeltaProps {
  value: number; // percentage change
  size?: 'sm' | 'md';
}

export function MetricDelta({ value, size = 'sm' }: MetricDeltaProps) {
  const isPositive = value >= 0;
  const color = isPositive ? 'text-emerald-400' : 'text-red-400';
  const bg = isPositive ? 'bg-emerald-400/10' : 'bg-red-400/10';
  const arrow = isPositive ? '\u2191' : '\u2193';
  const textSize = size === 'sm' ? 'text-[10px]' : 'text-xs';

  return (
    <span className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full ${bg} ${color} ${textSize} font-medium`}>
      {arrow} {Math.abs(value).toFixed(1)}%
    </span>
  );
}
