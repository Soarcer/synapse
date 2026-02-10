import { memo } from 'react';
import { getBezierPath, type EdgeProps } from '@xyflow/react';

function AnimatedEdgeComponent({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  data,
  style = {},
}: EdgeProps) {
  const [edgePath] = getBezierPath({
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
  });

  const isActive = (data as { status?: string })?.status === 'running';

  return (
    <path
      id={id}
      className="react-flow__edge-path"
      d={edgePath}
      style={{
        stroke: isActive ? '#60a5fa' : '#4b5563',
        strokeWidth: isActive ? 2 : 1.5,
        strokeDasharray: isActive ? '6 3' : 'none',
        animation: isActive ? 'dashFlow 0.5s linear infinite' : 'none',
        fill: 'none',
        ...style,
      }}
    />
  );
}

export const AnimatedEdge = memo(AnimatedEdgeComponent);
