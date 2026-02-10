import { Position } from '@xyflow/react';
import { useAgentStore } from '../store/agentStore';

interface HandleConfig {
  source: Position;
  target: Position;
  /** CSS style to offset the source handle (e.g. push to bottom-left) */
  sourceStyle?: React.CSSProperties;
}

export function useHandlePositions(): HandleConfig {
  const layoutMode = useAgentStore((s) => s.layoutMode);
  if (layoutMode === 'list') {
    return {
      source: Position.Bottom,
      target: Position.Left,
      // Offset source handle to the left edge of the node
      sourceStyle: { left: 12 },
    };
  }
  return { source: Position.Right, target: Position.Left };
}
