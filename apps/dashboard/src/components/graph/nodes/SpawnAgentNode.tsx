// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Synapse Contributors

import { memo } from 'react';
import { type NodeProps } from '@xyflow/react';
import { useAgentStore } from '../../../store/agentStore';
import { Tooltip } from '../../ui/Tooltip';

function SpawnAgentNodeComponent(_props: NodeProps) {
  const setShowSpawnDialog = useAgentStore((s) => s.setShowSpawnDialog);

  return (
    <Tooltip content="Spawn a new agent" shortcut="N">
      <button
        onClick={() => setShowSpawnDialog(true)}
        className="
          w-[50px] h-[50px] rounded-full border-2 border-dashed border-gray-600
          bg-gray-800/50 flex items-center justify-center
          text-gray-400 text-2xl font-light
          hover:border-blue-400 hover:text-blue-400 hover:bg-blue-900/20
          transition-all duration-200 cursor-pointer
          shadow-md
        "
      >
        +
      </button>
    </Tooltip>
  );
}

export const SpawnAgentNode = memo(SpawnAgentNodeComponent);
