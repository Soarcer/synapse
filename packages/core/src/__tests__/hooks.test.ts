import { describe, it, expect } from 'vitest';
import type { ClaudeHookEvent, WsServerMessage } from '@synapse-ai/core';

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

describe('WsServerMessage permission variants', () => {
  it('accepts pendingPermission message', () => {
    const msg: WsServerMessage = {
      type: 'pendingPermission',
      data: {
        id: 'perm-1',
        tool_name: 'Bash',
        tool_input_preview: 'rm -rf build/',
        createdAt: Date.now(),
        expiresAt: Date.now() + 1800000,
      },
    };
    expect(msg.type).toBe('pendingPermission');
  });

  it('accepts permissionResolved message', () => {
    const msg: WsServerMessage = {
      type: 'permissionResolved',
      data: { id: 'perm-1', behavior: 'allow' },
    };
    expect(msg.type).toBe('permissionResolved');
  });
});
