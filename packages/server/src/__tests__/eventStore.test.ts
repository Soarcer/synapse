import { normalizeHookPayload, rowToAgentEvent } from '../services/eventStore';
import type { EventRow } from '../db';

// ─── normalizeHookPayload ────────────────────────────────────────────

describe('normalizeHookPayload', () => {
  // ── Hook event type mapping ──

  it('maps SessionStart to session_start', () => {
    const event = normalizeHookPayload({ hook_event_name: 'SessionStart', session_id: 's1' });
    expect(event.type).toBe('session_start');
  });

  it('maps SessionEnd to session_end', () => {
    const event = normalizeHookPayload({ hook_event_name: 'SessionEnd', session_id: 's1' });
    expect(event.type).toBe('session_end');
  });

  it('maps SubagentStart to agent_start', () => {
    const event = normalizeHookPayload({ hook_event_name: 'SubagentStart', session_id: 's1' });
    expect(event.type).toBe('agent_start');
  });

  it('maps SubagentStop to agent_stop', () => {
    const event = normalizeHookPayload({ hook_event_name: 'SubagentStop', session_id: 's1' });
    expect(event.type).toBe('agent_stop');
  });

  it('maps PreToolUse to tool_start', () => {
    const event = normalizeHookPayload({ hook_event_name: 'PreToolUse', session_id: 's1' });
    expect(event.type).toBe('tool_start');
  });

  it('maps PostToolUse to tool_end', () => {
    const event = normalizeHookPayload({ hook_event_name: 'PostToolUse', session_id: 's1' });
    expect(event.type).toBe('tool_end');
  });

  it('maps PostToolUseFailure to tool_error', () => {
    const event = normalizeHookPayload({ hook_event_name: 'PostToolUseFailure', session_id: 's1' });
    expect(event.type).toBe('tool_error');
  });

  it('maps Stop to stop', () => {
    const event = normalizeHookPayload({ hook_event_name: 'Stop', session_id: 's1' });
    expect(event.type).toBe('stop');
  });

  it('maps UserPromptSubmit to user_prompt', () => {
    const event = normalizeHookPayload({ hook_event_name: 'UserPromptSubmit', session_id: 's1' });
    expect(event.type).toBe('user_prompt');
  });

  it('maps Notification to notification', () => {
    const event = normalizeHookPayload({ hook_event_name: 'Notification', session_id: 's1' });
    expect(event.type).toBe('notification');
  });

  it('maps PreCompact to compact', () => {
    const event = normalizeHookPayload({ hook_event_name: 'PreCompact', session_id: 's1' });
    expect(event.type).toBe('compact');
  });

  it('maps PermissionRequest to permission_request', () => {
    const event = normalizeHookPayload({ hook_event_name: 'PermissionRequest', session_id: 's1' });
    expect(event.type).toBe('permission_request');
  });

  // ── Unknown event type ──

  it('defaults unknown event types to result', () => {
    const event = normalizeHookPayload({ hook_event_name: 'SomethingNew', session_id: 's1' });
    expect(event.type).toBe('result');
  });

  it('defaults missing hook_event_name to result', () => {
    const event = normalizeHookPayload({ session_id: 's1' });
    expect(event.type).toBe('result');
  });

  // ── Core fields ──

  it('sets sessionId from session_id', () => {
    const event = normalizeHookPayload({ hook_event_name: 'SessionStart', session_id: 'abc-123' });
    expect(event.sessionId).toBe('abc-123');
  });

  it('defaults sessionId to unknown when missing', () => {
    const event = normalizeHookPayload({ hook_event_name: 'SessionStart' });
    expect(event.sessionId).toBe('unknown');
  });

  it('sets eventSource to hook and vendor to anthropic', () => {
    const event = normalizeHookPayload({ hook_event_name: 'SessionStart', session_id: 's1' });
    expect(event.eventSource).toBe('hook');
    expect(event.vendor).toBe('anthropic');
  });

  it('generates an id and timestamp', () => {
    const before = Date.now();
    const event = normalizeHookPayload({ hook_event_name: 'Stop', session_id: 's1' });
    const after = Date.now();
    expect(event.id).toBeTruthy();
    expect(event.id.length).toBeGreaterThan(0);
    expect(event.timestamp).toBeGreaterThanOrEqual(before);
    expect(event.timestamp).toBeLessThanOrEqual(after);
  });

  // ── Agent fields ──

  it('extracts agent fields from raw payload', () => {
    const event = normalizeHookPayload({
      hook_event_name: 'SubagentStart',
      session_id: 's1',
      agent_id: 'agent-42',
      agent_type: 'Explore',
      agent_transcript_path: '/tmp/transcript.json',
    });
    expect(event.agentId).toBe('agent-42');
    expect(event.agentType).toBe('Explore');
    expect(event.agentTranscriptPath).toBe('/tmp/transcript.json');
  });

  it('omits agent fields when not present in raw', () => {
    const event = normalizeHookPayload({ hook_event_name: 'Stop', session_id: 's1' });
    expect(event.agentId).toBeUndefined();
    expect(event.agentType).toBeUndefined();
  });

  // ── Tool fields ──

  it('extracts tool fields from raw payload', () => {
    const event = normalizeHookPayload({
      hook_event_name: 'PreToolUse',
      session_id: 's1',
      tool_name: 'Read',
      tool_use_id: 'tu-1',
      tool_input: { file_path: '/foo/bar.ts' },
    });
    expect(event.toolName).toBe('Read');
    expect(event.toolUseId).toBe('tu-1');
    expect(event.toolInput).toEqual({ file_path: '/foo/bar.ts' });
  });

  it('extracts tool_response when present', () => {
    const event = normalizeHookPayload({
      hook_event_name: 'PostToolUse',
      session_id: 's1',
      tool_name: 'Bash',
      tool_response: { output: 'hello' },
    });
    expect(event.toolResponse).toEqual({ output: 'hello' });
  });

  it('ignores non-object tool_input', () => {
    const event = normalizeHookPayload({
      hook_event_name: 'PreToolUse',
      session_id: 's1',
      tool_input: 'not-an-object',
    });
    expect(event.toolInput).toBeUndefined();
  });

  it('ignores non-object tool_response', () => {
    const event = normalizeHookPayload({
      hook_event_name: 'PostToolUse',
      session_id: 's1',
      tool_response: 'string-response',
    });
    expect(event.toolResponse).toBeUndefined();
  });

  // ── Status mapping ──

  it('sets status to running for SubagentStart', () => {
    const event = normalizeHookPayload({ hook_event_name: 'SubagentStart', session_id: 's1' });
    expect(event.status).toBe('running');
  });

  it('sets status to running for PreToolUse', () => {
    const event = normalizeHookPayload({ hook_event_name: 'PreToolUse', session_id: 's1' });
    expect(event.status).toBe('running');
  });

  it('sets status to success for PostToolUse', () => {
    const event = normalizeHookPayload({ hook_event_name: 'PostToolUse', session_id: 's1' });
    expect(event.status).toBe('success');
  });

  it('sets status to success for SubagentStop', () => {
    const event = normalizeHookPayload({ hook_event_name: 'SubagentStop', session_id: 's1' });
    expect(event.status).toBe('success');
  });

  it('sets status to error for PostToolUseFailure', () => {
    const event = normalizeHookPayload({ hook_event_name: 'PostToolUseFailure', session_id: 's1' });
    expect(event.status).toBe('error');
  });

  it('does not set status for events without a status mapping', () => {
    const event = normalizeHookPayload({ hook_event_name: 'SessionStart', session_id: 's1' });
    expect(event.status).toBeUndefined();
  });

  // ── Event-specific fields ──

  it('extracts model and source for SessionStart', () => {
    const event = normalizeHookPayload({
      hook_event_name: 'SessionStart',
      session_id: 's1',
      model: 'claude-opus-4-6',
      source: 'startup',
    });
    expect(event.model).toBe('claude-opus-4-6');
    expect(event.source).toBe('startup');
  });

  it('extracts reason for SessionEnd', () => {
    const event = normalizeHookPayload({
      hook_event_name: 'SessionEnd',
      session_id: 's1',
      reason: 'user_exit',
    });
    expect(event.reason).toBe('user_exit');
  });

  it('maps prompt to text for UserPromptSubmit', () => {
    const event = normalizeHookPayload({
      hook_event_name: 'UserPromptSubmit',
      session_id: 's1',
      prompt: 'Hello, Claude!',
    });
    expect(event.text).toBe('Hello, Claude!');
  });

  it('extracts message and notification_type for Notification', () => {
    const event = normalizeHookPayload({
      hook_event_name: 'Notification',
      session_id: 's1',
      message: 'Permission needed',
      notification_type: 'permission_prompt',
    });
    expect(event.text).toBe('Permission needed');
    expect(event.notificationType).toBe('permission_prompt');
  });

  it('extracts trigger for PreCompact', () => {
    const event = normalizeHookPayload({
      hook_event_name: 'PreCompact',
      session_id: 's1',
      trigger: 'auto',
    });
    expect(event.compactTrigger).toBe('auto');
  });

  it('extracts error for PostToolUseFailure', () => {
    const event = normalizeHookPayload({
      hook_event_name: 'PostToolUseFailure',
      session_id: 's1',
      error: 'File not found',
    });
    expect(event.error).toBe('File not found');
  });

  // ── Common metadata ──

  it('extracts common metadata fields', () => {
    const event = normalizeHookPayload({
      hook_event_name: 'SessionStart',
      session_id: 's1',
      cwd: '/home/user/project',
      permission_mode: 'bypassPermissions',
      transcript_path: '/tmp/transcript.json',
    });
    expect(event.cwd).toBe('/home/user/project');
    expect(event.permissionMode).toBe('bypassPermissions');
    expect(event.transcriptPath).toBe('/tmp/transcript.json');
  });

  // ── Graceful handling of missing fields ──

  it('handles a completely empty payload gracefully', () => {
    const event = normalizeHookPayload({});
    expect(event.type).toBe('result');
    expect(event.sessionId).toBe('unknown');
    expect(event.eventSource).toBe('hook');
    expect(event.vendor).toBe('anthropic');
    expect(event.id).toBeTruthy();
    expect(event.timestamp).toBeGreaterThan(0);
  });
});

// ─── rowToAgentEvent ─────────────────────────────────────────────────

describe('rowToAgentEvent', () => {
  function makeRow(overrides: Partial<EventRow> = {}): EventRow {
    return {
      id: 1,
      event_id: 'evt-1',
      session_id: 'sess-1',
      hook_event_name: 'PreToolUse',
      event_type: 'tool_start',
      agent_id: null,
      agent_type: null,
      parent_agent_id: null,
      tool_name: null,
      tool_use_id: null,
      tool_input: null,
      tool_response: null,
      status: null,
      error: null,
      token_input: null,
      token_output: null,
      duration_ms: null,
      vendor: null,
      raw_payload: '{}',
      created_at: 1700000000000,
      ...overrides,
    };
  }

  it('converts basic row to AgentEvent with core fields', () => {
    const event = rowToAgentEvent(makeRow());
    expect(event.id).toBe('evt-1');
    expect(event.type).toBe('tool_start');
    expect(event.sessionId).toBe('sess-1');
    expect(event.timestamp).toBe(1700000000000);
  });

  it('sets eventSource to hook for known hook event names', () => {
    const event = rowToAgentEvent(makeRow({ hook_event_name: 'SessionStart' }));
    expect(event.eventSource).toBe('hook');
  });

  it('sets eventSource to sdk for unknown hook event names', () => {
    const event = rowToAgentEvent(makeRow({ hook_event_name: 'custom_sdk_event' }));
    expect(event.eventSource).toBe('sdk');
  });

  it('sets eventSource to openclaw for openclaw hook event name', () => {
    const event = rowToAgentEvent(makeRow({ hook_event_name: 'openclaw' }));
    expect(event.eventSource).toBe('openclaw');
  });

  it('maps agent fields from the row', () => {
    const event = rowToAgentEvent(makeRow({
      agent_id: 'agent-7',
      agent_type: 'Plan',
      parent_agent_id: 'agent-0',
    }));
    expect(event.agentId).toBe('agent-7');
    expect(event.agentType).toBe('Plan');
    expect(event.parentAgentId).toBe('agent-0');
  });

  it('maps tool fields from the row', () => {
    const event = rowToAgentEvent(makeRow({
      tool_name: 'Edit',
      tool_use_id: 'tu-99',
      tool_input: '{"file":"a.ts"}',
      tool_response: '{"ok":true}',
    }));
    expect(event.toolName).toBe('Edit');
    expect(event.toolUseId).toBe('tu-99');
    expect(event.toolInput).toEqual({ file: 'a.ts' });
    expect(event.toolResponse).toEqual({ ok: true });
  });

  it('handles corrupted JSON in tool_input gracefully', () => {
    const event = rowToAgentEvent(makeRow({ tool_input: '{bad json' }));
    expect(event.toolInput).toBeUndefined();
  });

  it('handles corrupted JSON in tool_response gracefully', () => {
    const event = rowToAgentEvent(makeRow({ tool_response: 'not-json' }));
    expect(event.toolResponse).toBeUndefined();
  });

  it('maps status and error from the row', () => {
    const event = rowToAgentEvent(makeRow({ status: 'error', error: 'timeout' }));
    expect(event.status).toBe('error');
    expect(event.error).toBe('timeout');
  });

  it('maps token usage when both input and output are present', () => {
    const event = rowToAgentEvent(makeRow({ token_input: 100, token_output: 50 }));
    expect(event.tokenUsage).toEqual({ input: 100, output: 50 });
  });

  it('omits token usage when only one field is present', () => {
    const event = rowToAgentEvent(makeRow({ token_input: 100, token_output: null }));
    expect(event.tokenUsage).toBeUndefined();
  });

  it('maps duration from duration_ms', () => {
    const event = rowToAgentEvent(makeRow({ duration_ms: 350 }));
    expect(event.duration).toBe(350);
  });

  it('maps vendor from the row', () => {
    const event = rowToAgentEvent(makeRow({ vendor: 'openai' }));
    expect(event.vendor).toBe('openai');
  });

  it('restores rich metadata from raw_payload', () => {
    const raw = {
      model: 'claude-opus-4-6',
      source: 'resume',
      cwd: '/project',
      permission_mode: 'default',
      prompt: 'Fix the bug',
      agent_transcript_path: '/tmp/agent.json',
    };
    const event = rowToAgentEvent(makeRow({ raw_payload: JSON.stringify(raw) }));
    expect(event.model).toBe('claude-opus-4-6');
    expect(event.source).toBe('resume');
    expect(event.cwd).toBe('/project');
    expect(event.permissionMode).toBe('default');
    expect(event.text).toBe('Fix the bug');
    expect(event.agentTranscriptPath).toBe('/tmp/agent.json');
  });

  it('restores notification text from raw_payload for notification events', () => {
    const raw = { message: 'Idle timeout', notification_type: 'idle_prompt' };
    const event = rowToAgentEvent(makeRow({
      event_type: 'notification',
      raw_payload: JSON.stringify(raw),
    }));
    expect(event.text).toBe('Idle timeout');
    expect(event.notificationType).toBe('idle_prompt');
  });

  it('restores compact trigger from raw_payload', () => {
    const raw = { trigger: 'manual' };
    const event = rowToAgentEvent(makeRow({ raw_payload: JSON.stringify(raw) }));
    expect(event.compactTrigger).toBe('manual');
  });

  it('handles corrupted raw_payload gracefully', () => {
    const event = rowToAgentEvent(makeRow({ raw_payload: '{broken' }));
    // Should not throw, just skip metadata restoration
    expect(event.id).toBe('evt-1');
    expect(event.model).toBeUndefined();
  });

  it('omits optional fields when row values are null', () => {
    const event = rowToAgentEvent(makeRow());
    expect(event.agentId).toBeUndefined();
    expect(event.agentType).toBeUndefined();
    expect(event.parentAgentId).toBeUndefined();
    expect(event.toolName).toBeUndefined();
    expect(event.toolUseId).toBeUndefined();
    expect(event.toolInput).toBeUndefined();
    expect(event.toolResponse).toBeUndefined();
    expect(event.status).toBeUndefined();
    expect(event.error).toBeUndefined();
    expect(event.tokenUsage).toBeUndefined();
    expect(event.duration).toBeUndefined();
    expect(event.vendor).toBeUndefined();
  });
});
