import { Position } from '@xyflow/react';

interface HandleConfig {
  source: Position;
  target: Position;
  /** CSS style to offset the source handle (e.g. push to bottom-left) */
  sourceStyle?: React.CSSProperties;
}

export function useHandlePositions(): HandleConfig {
  return { source: Position.Right, target: Position.Left };
}
