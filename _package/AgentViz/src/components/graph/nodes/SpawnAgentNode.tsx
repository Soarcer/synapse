import { memo } from 'react';
import { type NodeProps } from '@xyflow/react';
import { useAgentStore } from '../../../store/agentStore';

function SpawnAgentNodeComponent(_props: NodeProps) {
  const setShowSpawnDialog = useAgentStore((s) => s.setShowSpawnDialog);

  return (
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
      title="Spawn a new agent"
    >
      +
    </button>
  );
}

export const SpawnAgentNode = memo(SpawnAgentNodeComponent);
