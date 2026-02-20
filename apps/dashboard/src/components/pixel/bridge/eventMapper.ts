import type { AgentEvent } from '@synapse-ai/core';
import type { SceneCommand } from '../engine/types';

/** Known tool -> station name mapping. Unknown tools fall back to 'Task'. */
const TOOL_TO_STATION: Record<string, string> = {
  Read: 'Read',
  Write: 'Write',
  Edit: 'Edit',
  Bash: 'Bash',
  Glob: 'Glob',
  Grep: 'Grep',
  WebSearch: 'Web',
  WebFetch: 'Web',
  Task: 'Task',
  TodoWrite: 'Task',
  NotebookEdit: 'Edit',
  NotebookRead: 'Read',
  AskUserQuestion: 'Task',
  EnterPlanMode: 'Task',
  ExitPlanMode: 'Task',
  Skill: 'Task',
};

function resolveStation(toolName: string): string {
  return TOOL_TO_STATION[toolName] ?? 'Task';
}

/** Pure function: map a single AgentEvent to SceneCommand(s). */
export function mapEventToCommands(event: AgentEvent): SceneCommand[] {
  switch (event.type) {
    case 'agent_start':
      return [{
        type: 'spawnAgent',
        agentId: event.agentId ?? '',
        model: event.model ?? 'unknown',
        agentType: event.agentType ?? 'general-purpose',
        parentAgentId: event.parentAgentId,
      }];
    case 'agent_stop':
      return [{
        type: 'despawnAgent',
        agentId: event.agentId ?? '',
        success: event.status === 'success',
      }];
    case 'tool_start':
      return [{
        type: 'dispatchToStation',
        agentId: event.agentId ?? '',
        stationName: resolveStation(event.toolName ?? ''),
      }];
    case 'tool_end':
      return [{
        type: 'stationComplete',
        agentId: event.agentId ?? '',
        stationName: resolveStation(event.toolName ?? ''),
        success: true,
      }];
    case 'tool_error':
      return [{
        type: 'stationComplete',
        agentId: event.agentId ?? '',
        stationName: resolveStation(event.toolName ?? ''),
        success: false,
      }];
    case 'user_prompt':
      return [{
        type: 'promptArrived',
        text: event.text ?? '',
        agentId: event.agentId ?? '',
      }];
    case 'result': {
      const cmds: SceneCommand[] = [];
      const total = (event.tokenUsage?.input ?? 0) + (event.tokenUsage?.output ?? 0);
      if (total > 0) {
        cmds.push({
          type: 'tokenStream',
          agentId: event.agentId ?? '',
          count: Math.min(20, Math.ceil(total / 500)),
        });
      }
      if (event.costUsd) {
        cmds.push({ type: 'updateCost', costUsd: event.costUsd });
      }
      return cmds;
    }
    case 'session_start':
      return [{ type: 'sessionStart', sessionId: event.sessionId }];
    case 'session_end':
      return [{ type: 'sessionEnd', sessionId: event.sessionId }];
    default:
      return [];
  }
}
