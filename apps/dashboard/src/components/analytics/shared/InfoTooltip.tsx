// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Bernhard

import { Tooltip } from '../../ui/Tooltip';

interface InfoTooltipProps {
  text: string;
}

export function InfoTooltip({ text }: InfoTooltipProps) {
  return (
    <Tooltip content={text}>
      <span className="inline-flex items-center ml-1 cursor-help">
        <span className="text-[10px] text-gray-600 hover:text-gray-400 transition-colors">(i)</span>
      </span>
    </Tooltip>
  );
}
