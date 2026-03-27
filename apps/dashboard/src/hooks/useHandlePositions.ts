// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Bernhard

import { Position } from '@xyflow/react';

interface HandleConfig {
  source: Position;
  target: Position;
  /** CSS style to offset the source handle (e.g. push to bottom-left) */
  sourceStyle?: React.CSSProperties;
}

export function useHandlePositions(): HandleConfig {
  // TB layout: spine edges flow top→bottom
  return { source: Position.Bottom, target: Position.Top };
}
