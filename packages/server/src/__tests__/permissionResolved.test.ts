import { describe, it, expect } from 'vitest';
import { buildPermissionResolved } from '../state/permissionResolved.js';

describe('buildPermissionResolved', () => {
  it('includes session_id and tool_use_id from hook event', () => {
    const event = {
      session_id: 'sess-1',
      tool_use_id: 'tu-abc',
      tool_name: 'AskUserQuestion',
      hook_event_name: 'PermissionRequest',
    };
    const result = buildPermissionResolved('perm-1', 'allow', event);
    expect(result).toEqual({
      type: 'permissionResolved',
      data: {
        id: 'perm-1',
        behavior: 'allow',
        session_id: 'sess-1',
        tool_use_id: 'tu-abc',
        tool_name: 'AskUserQuestion',
      },
    });
  });

  it('omits missing fields gracefully', () => {
    const event = { hook_event_name: 'PermissionRequest' };
    const result = buildPermissionResolved('perm-2', 'deny', event);
    expect(result).toEqual({
      type: 'permissionResolved',
      data: { id: 'perm-2', behavior: 'deny' },
    });
  });

  it('handles auto-dismissed behavior', () => {
    const event = {
      session_id: 'sess-3',
      tool_use_id: 'tu-xyz',
      tool_name: 'Bash',
      hook_event_name: 'PermissionRequest',
    };
    const result = buildPermissionResolved('perm-3', 'auto-dismissed', event);
    expect(result.data.behavior).toBe('auto-dismissed');
    expect(result.data.session_id).toBe('sess-3');
    expect(result.data.tool_use_id).toBe('tu-xyz');
  });
});
