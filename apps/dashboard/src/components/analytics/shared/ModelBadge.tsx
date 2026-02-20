import { MODEL_COLORS, MODEL_LABELS } from './constants';

interface ModelBadgeProps {
  model: string;
}

export function ModelBadge({ model }: ModelBadgeProps) {
  return (
    <span
      className="px-2 py-0.5 rounded text-[10px] font-medium"
      style={{
        backgroundColor: `${MODEL_COLORS[model] ?? '#6b7280'}20`,
        color: MODEL_COLORS[model] ?? '#6b7280',
      }}
    >
      {MODEL_LABELS[model] ?? model}
    </span>
  );
}
