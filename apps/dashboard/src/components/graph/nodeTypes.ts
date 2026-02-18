import type { NodeTypes, EdgeTypes } from '@xyflow/react';
import { SessionNode } from './nodes/SessionNode';
import { AgentNode } from './nodes/AgentNode';
import { ToolCallNode } from './nodes/ToolCallNode';
import { ToolGroupNode } from './nodes/ToolGroupNode';
import { SpawnAgentNode } from './nodes/SpawnAgentNode';
import { UserPromptNode } from './nodes/UserPromptNode';
import { AnimatedEdge } from './edges/AnimatedEdge';

export const nodeTypes: NodeTypes = {
  session: SessionNode,
  agent: AgentNode,
  toolCall: ToolCallNode,
  toolGroup: ToolGroupNode,
  spawnAgent: SpawnAgentNode,
  userPrompt: UserPromptNode,
};

export const edgeTypes: EdgeTypes = {
  animated: AnimatedEdge,
};
