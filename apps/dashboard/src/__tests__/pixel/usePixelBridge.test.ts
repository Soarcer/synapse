import { describe, it, expect } from 'vitest';
import { mapEventToCommands } from '../../components/pixel/bridge/eventMapper';
import type { AgentEvent } from '@synapse-ai/core';

function makeEvent(overrides: Partial<AgentEvent>): AgentEvent {
  return {
    id: 'test-id',
    type: 'result',
    sessionId: 'sess-1',
    timestamp: Date.now(),
    ...overrides,
  } as AgentEvent;
}

describe('mapEventToCommands', () => {
  it('maps agent_start to spawnAgent', () => {
    const event = makeEvent({ type: 'agent_start', agentId: 'a1', model: 'claude-opus-4-6', agentType: 'Explore' });
    const cmds = mapEventToCommands(event);
    expect(cmds).toEqual([{
      type: 'spawnAgent', agentId: 'a1', model: 'claude-opus-4-6', agentType: 'Explore', parentAgentId: undefined,
    }]);
  });

  it('maps agent_stop success to despawnAgent', () => {
    const event = makeEvent({ type: 'agent_stop', agentId: 'a1', status: 'success' });
    const cmds = mapEventToCommands(event);
    expect(cmds).toEqual([{ type: 'despawnAgent', agentId: 'a1', success: true }]);
  });

  it('maps agent_stop error to despawnAgent success=false', () => {
    const event = makeEvent({ type: 'agent_stop', agentId: 'a1', status: 'error' });
    const cmds = mapEventToCommands(event);
    expect(cmds[0]).toEqual({ type: 'despawnAgent', agentId: 'a1', success: false });
  });

  it('maps tool_start to dispatchToStation', () => {
    const event = makeEvent({ type: 'tool_start', agentId: 'a1', toolName: 'Read' });
    const cmds = mapEventToCommands(event);
    expect(cmds).toEqual([{ type: 'dispatchToStation', agentId: 'a1', stationName: 'Read' }]);
  });

  it('maps tool_end to stationComplete', () => {
    const event = makeEvent({ type: 'tool_end', agentId: 'a1', toolName: 'Bash' });
    const cmds = mapEventToCommands(event);
    expect(cmds).toEqual([{ type: 'stationComplete', agentId: 'a1', stationName: 'Bash', success: true }]);
  });

  it('maps tool_error to stationComplete success=false', () => {
    const event = makeEvent({ type: 'tool_error', agentId: 'a1', toolName: 'Bash' });
    const cmds = mapEventToCommands(event);
    expect(cmds[0]).toEqual({ type: 'stationComplete', agentId: 'a1', stationName: 'Bash', success: false });
  });

  it('maps user_prompt to promptArrived', () => {
    const event = makeEvent({ type: 'user_prompt', agentId: 'root', text: 'Fix the bug' });
    const cmds = mapEventToCommands(event);
    expect(cmds).toEqual([{ type: 'promptArrived', text: 'Fix the bug', agentId: 'root' }]);
  });

  it('maps result with tokenUsage to tokenStream', () => {
    const event = makeEvent({ type: 'result', agentId: 'a1', tokenUsage: { input: 500, output: 200 } });
    const cmds = mapEventToCommands(event);
    expect(cmds[0].type).toBe('tokenStream');
  });

  it('maps result with costUsd to updateCost', () => {
    const event = makeEvent({ type: 'result', agentId: 'a1', costUsd: 0.15, tokenUsage: { input: 100, output: 50 } });
    const cmds = mapEventToCommands(event);
    const costCmd = cmds.find(c => c.type === 'updateCost');
    expect(costCmd).toBeDefined();
  });

  it('maps unknown tool names to Task station', () => {
    const event = makeEvent({ type: 'tool_start', agentId: 'a1', toolName: 'NotebookEdit' });
    const cmds = mapEventToCommands(event);
    expect(cmds[0]).toHaveProperty('stationName', 'Edit');
  });

  it('maps completely unknown tools to Task', () => {
    const event = makeEvent({ type: 'tool_start', agentId: 'a1', toolName: 'SuperCustomTool' });
    const cmds = mapEventToCommands(event);
    expect(cmds[0]).toHaveProperty('stationName', 'Task');
  });

  it('maps session_start to sessionStart', () => {
    const event = makeEvent({ type: 'session_start', sessionId: 'sess-1' });
    const cmds = mapEventToCommands(event);
    expect(cmds).toEqual([{ type: 'sessionStart', sessionId: 'sess-1' }]);
  });

  it('maps session_end to sessionEnd', () => {
    const event = makeEvent({ type: 'session_end', sessionId: 'sess-1' });
    const cmds = mapEventToCommands(event);
    expect(cmds).toEqual([{ type: 'sessionEnd', sessionId: 'sess-1' }]);
  });

  it('returns empty array for irrelevant events', () => {
    const event = makeEvent({ type: 'text_delta' as any });
    const cmds = mapEventToCommands(event);
    expect(cmds).toEqual([]);
  });
});
