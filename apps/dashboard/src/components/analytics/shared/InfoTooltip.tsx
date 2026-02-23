// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Synapse Contributors

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
