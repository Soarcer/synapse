import { describe, it, expect } from 'vitest';
import type { ClaudeHookEvent } from '@synapse-ai/core';

describe('ClaudeHookEvent', () => {
  it('accepts a valid PermissionRequest hook payload', () => {
    const event: ClaudeHookEvent = {
      session_id: 'sess-abc',
      tool_name: 'Bash',
      tool_input: { command: 'rm -rf build/' },
      hook_event_name: 'PermissionRequest',
    };
    expect(event.session_id).toBe('sess-abc');
    expect(event.tool_name).toBe('Bash');
    expect(event.hook_event_name).toBe('PermissionRequest');
  });

  it('accepts extra fields via index signature', () => {
    const event: ClaudeHookEvent = {
      session_id: 'sess-abc',
      hook_event_name: 'PermissionRequest',
      transcript_path: '/some/path',
    };
    expect(event.transcript_path).toBe('/some/path');
  });

  it('requires session_id and hook_event_name', () => {
    const event: ClaudeHookEvent = {
      session_id: 'x',
      hook_event_name: 'PermissionRequest',
    };
    expect(event.session_id).toBeDefined();
    expect(event.hook_event_name).toBeDefined();
  });
});
