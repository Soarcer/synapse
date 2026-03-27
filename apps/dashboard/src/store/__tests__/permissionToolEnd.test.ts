// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { useAgentStore } from '../agentStore';

beforeEach(() => {
  useAgentStore.getState().clearEvents();
});

describe('permission tool finalization', () => {
  it('finalizes a running tool when permissionResolved has tool_use_id', () => {
    const { addEvent, finalizePermissionTool } = useAgentStore.getState();

    addEvent({
      id: 'e1',
      type: 'session_start',
      sessionId: 'sess-perm',
      timestamp: Date.now(),
      eventSource: 'hook',
      vendor: 'anthropic',
    });
    addEvent({
      id: 'e2',
      type: 'tool_start',
      sessionId: 'sess-perm',
      timestamp: Date.now(),
      eventSource: 'hook',
      vendor: 'anthropic',
      toolName: 'AskUserQuestion',
      toolUseId: 'tu-ask-1',
      status: 'running',
    });

    const before = [...useAgentStore.getState().toolCalls.values()].flat();
    expect(before.find((t) => t.toolUseId === 'tu-ask-1')?.status).toBe('running');

    finalizePermissionTool('tu-ask-1', 'sess-perm', 'allow');

    const after = [...useAgentStore.getState().toolCalls.values()].flat();
    expect(after.find((t) => t.toolUseId === 'tu-ask-1')?.status).toBe('success');
  });

  it('sets status to error when behavior is deny', () => {
    const { addEvent, finalizePermissionTool } = useAgentStore.getState();

    addEvent({
      id: 'e1',
      type: 'session_start',
      sessionId: 'sess-deny',
      timestamp: Date.now(),
      eventSource: 'hook',
      vendor: 'anthropic',
    });
    addEvent({
      id: 'e2',
      type: 'tool_start',
      sessionId: 'sess-deny',
      timestamp: Date.now(),
      eventSource: 'hook',
      vendor: 'anthropic',
      toolName: 'AskUserQuestion',
      toolUseId: 'tu-deny-1',
      status: 'running',
    });

    finalizePermissionTool('tu-deny-1', 'sess-deny', 'deny');

    const after = [...useAgentStore.getState().toolCalls.values()].flat();
    expect(after.find((t) => t.toolUseId === 'tu-deny-1')?.status).toBe('error');
  });

  it('is a no-op when tool_use_id does not match any running tool', () => {
    const { finalizePermissionTool } = useAgentStore.getState();
    expect(() => finalizePermissionTool('nonexistent', 'sess-x', 'allow')).not.toThrow();
  });

  it('is a no-op when tool is already completed', () => {
    const { addEvent, finalizePermissionTool } = useAgentStore.getState();

    addEvent({
      id: 'e1',
      type: 'session_start',
      sessionId: 'sess-done',
      timestamp: Date.now(),
      eventSource: 'hook',
      vendor: 'anthropic',
    });
    addEvent({
      id: 'e2',
      type: 'tool_start',
      sessionId: 'sess-done',
      timestamp: Date.now(),
      eventSource: 'hook',
      vendor: 'anthropic',
      toolName: 'AskUserQuestion',
      toolUseId: 'tu-done-1',
      status: 'running',
    });
    addEvent({
      id: 'e3',
      type: 'tool_end',
      sessionId: 'sess-done',
      timestamp: Date.now(),
      eventSource: 'hook',
      vendor: 'anthropic',
      toolName: 'AskUserQuestion',
      toolUseId: 'tu-done-1',
      status: 'success',
    });

    finalizePermissionTool('tu-done-1', 'sess-done', 'allow');

    const after = [...useAgentStore.getState().toolCalls.values()].flat();
    expect(after.find((t) => t.toolUseId === 'tu-done-1')?.status).toBe('success');
  });
});
