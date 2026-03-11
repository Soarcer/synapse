// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Bernhard

import { ClaudeAdapter } from '../adapters/claude';
import { GeminiAdapter } from '../adapters/gemini';
import { CodexAdapter, TokenTracker } from '../adapters/codex';
import { AdapterRegistry } from '../adapters/index';

// ═══════════════════════════════════════════════════════════════════════
// GeminiAdapter
// ═══════════════════════════════════════════════════════════════════════

describe('GeminiAdapter', () => {
  const adapter = new GeminiAdapter();

  describe('detect()', () => {
    it('returns true for Gemini-exclusive hooks', () => {
      expect(adapter.detect({ hook_event_name: 'BeforeModel' })).toBe(true);
      expect(adapter.detect({ hook_event_name: 'BeforeTool' })).toBe(true);
      expect(adapter.detect({ hook_event_name: 'AfterTool' })).toBe(true);
      expect(adapter.detect({ hook_event_name: 'BeforeToolSelection' })).toBe(true);
    });

    it('returns true for SessionStart with .gemini/ transcript path', () => {
      expect(
        adapter.detect({
          hook_event_name: 'SessionStart',
          transcript_path: '/home/user/.gemini/tmp/abc/chats/session.jsonl',
        }),
      ).toBe(true);
    });

    it('returns true for SessionEnd with .gemini/ transcript path (Windows)', () => {
      expect(
        adapter.detect({
          hook_event_name: 'SessionEnd',
          transcript_path: 'C:\\Users\\user\\.gemini\\tmp\\abc\\chats\\session.jsonl',
        }),
      ).toBe(true);
    });

    it('returns false for SessionStart with .claude/ transcript path', () => {
      expect(
        adapter.detect({
          hook_event_name: 'SessionStart',
          transcript_path: '/home/user/.claude/projects/foo/sessions/session.jsonl',
        }),
      ).toBe(false);
    });

    it('returns false for SessionStart with no transcript path', () => {
      expect(adapter.detect({ hook_event_name: 'SessionStart' })).toBe(false);
    });

    it('returns false for Claude-only hooks', () => {
      expect(adapter.detect({ hook_event_name: 'UserPromptSubmit' })).toBe(false);
      expect(adapter.detect({ hook_event_name: 'PreToolUse' })).toBe(false);
      expect(adapter.detect({ hook_event_name: 'SubagentStart' })).toBe(false);
    });

    it('returns false for payload without hook_event_name', () => {
      expect(adapter.detect({ type: 'something' })).toBe(false);
      expect(adapter.detect({})).toBe(false);
    });
  });

  describe('normalize()', () => {
    it('maps BeforeModel to user_prompt with model and text from llm_request', () => {
      const event = adapter.normalize({
        hook_event_name: 'BeforeModel',
        session_id: 'abc123',
        timestamp: '2026-02-10T14:30:00Z',
        cwd: '/project',
        llm_request: {
          model: 'gemini-2.5-pro',
          messages: [
            { role: 'user', content: 'Fix the login bug' },
            { role: 'model', content: 'Looking at auth...' },
          ],
        },
      });
      expect(event.type).toBe('user_prompt');
      expect(event.model).toBe('gemini-2.5-pro');
      expect(event.text).toBe('Fix the login bug');
      expect(event.vendor).toBe('google');
      expect(event.eventSource).toBe('hook');
      expect(event.sessionId).toBe('gemini-abc123');
    });

    it('maps BeforeTool to tool_start with running status', () => {
      const event = adapter.normalize({
        hook_event_name: 'BeforeTool',
        session_id: 'abc123',
        timestamp: '2026-02-10T14:31:00Z',
        tool_name: 'read_file',
        tool_use_id: 'tu-1',
        tool_input: { file_path: 'src/auth.ts' },
      });
      expect(event.type).toBe('tool_start');
      expect(event.toolName).toBe('read_file');
      expect(event.toolUseId).toBe('tu-1');
      expect(event.toolInput).toEqual({ file_path: 'src/auth.ts' });
      expect(event.status).toBe('running');
    });

    it('maps AfterTool (success) to tool_end', () => {
      const event = adapter.normalize({
        hook_event_name: 'AfterTool',
        session_id: 'abc123',
        timestamp: '2026-02-10T14:32:00Z',
        tool_name: 'read_file',
        tool_response: { llmContent: 'file contents', error: null },
      });
      expect(event.type).toBe('tool_end');
      expect(event.status).toBe('success');
      expect(event.error).toBeUndefined();
    });

    it('maps AfterTool (error in tool_response) to tool_error', () => {
      const event = adapter.normalize({
        hook_event_name: 'AfterTool',
        session_id: 'abc123',
        timestamp: '2026-02-10T14:33:00Z',
        tool_name: 'run_shell_command',
        tool_response: { error: 'Exit code 1: tests failed' },
      });
      expect(event.type).toBe('tool_error');
      expect(event.status).toBe('error');
      expect(event.error).toBe('Exit code 1: tests failed');
    });

    it('maps AfterTool (top-level error) to tool_error', () => {
      const event = adapter.normalize({
        hook_event_name: 'AfterTool',
        session_id: 'abc123',
        error: 'Something went wrong',
      });
      expect(event.type).toBe('tool_error');
      expect(event.status).toBe('error');
      expect(event.error).toBe('Something went wrong');
    });

    it('maps SessionStart to session_start', () => {
      const event = adapter.normalize({
        hook_event_name: 'SessionStart',
        session_id: 'xyz',
        timestamp: '2026-02-10T14:30:00Z',
        model: 'gemini-2.5-pro',
        source: 'startup',
        transcript_path: '~/.gemini/tmp/abc/chats/session.jsonl',
      });
      expect(event.type).toBe('session_start');
      expect(event.model).toBe('gemini-2.5-pro');
      expect(event.source).toBe('startup');
    });

    it('maps SessionEnd to session_end with reason', () => {
      const event = adapter.normalize({
        hook_event_name: 'SessionEnd',
        session_id: 'xyz',
        timestamp: '2026-02-10T15:00:00Z',
        reason: 'exit',
      });
      expect(event.type).toBe('session_end');
      expect(event.reason).toBe('exit');
    });

    it('maps BeforeToolSelection to notification', () => {
      const event = adapter.normalize({
        hook_event_name: 'BeforeToolSelection',
        session_id: 'abc123',
        message: 'Available tools: read_file, write_file',
      });
      expect(event.type).toBe('notification');
      expect(event.text).toBe('Available tools: read_file, write_file');
      expect(event.notificationType).toBe('tool_selection');
    });

    it('converts ISO-8601 timestamps to Unix ms', () => {
      const event = adapter.normalize({
        hook_event_name: 'BeforeModel',
        session_id: 'abc123',
        timestamp: '2026-02-10T14:30:00.000Z',
      });
      expect(event.timestamp).toBe(new Date('2026-02-10T14:30:00.000Z').getTime());
    });

    it('falls back to Date.now() for invalid timestamps', () => {
      const before = Date.now();
      const event = adapter.normalize({
        hook_event_name: 'BeforeModel',
        session_id: 'abc123',
        timestamp: 'not-a-date',
      });
      expect(event.timestamp).toBeGreaterThanOrEqual(before);
    });

    it('handles numeric timestamps directly', () => {
      const ts = 1700000000000;
      const event = adapter.normalize({
        hook_event_name: 'BeforeModel',
        session_id: 'abc123',
        timestamp: ts,
      });
      expect(event.timestamp).toBe(ts);
    });

    it('prefixes session ID with gemini-', () => {
      const event = adapter.normalize({
        hook_event_name: 'BeforeModel',
        session_id: 'my-session',
      });
      expect(event.sessionId).toBe('gemini-my-session');
    });

    it('does not double-prefix session ID', () => {
      const event = adapter.normalize({
        hook_event_name: 'BeforeModel',
        session_id: 'gemini-already-prefixed',
      });
      expect(event.sessionId).toBe('gemini-already-prefixed');
    });

    it('extracts last user message from llm_request.messages', () => {
      const event = adapter.normalize({
        hook_event_name: 'BeforeModel',
        session_id: 's1',
        llm_request: {
          model: 'gemini-2.5-pro',
          messages: [
            { role: 'user', content: 'First message' },
            { role: 'model', content: 'Response...' },
            { role: 'user', content: 'Second message' },
          ],
        },
      });
      expect(event.text).toBe('Second message');
    });

    it('falls back to raw.prompt for BeforeModel', () => {
      const event = adapter.normalize({
        hook_event_name: 'BeforeModel',
        session_id: 's1',
        prompt: 'Direct prompt text',
      });
      expect(event.text).toBe('Direct prompt text');
    });

    it('generates id and sets vendor/eventSource', () => {
      const event = adapter.normalize({
        hook_event_name: 'BeforeModel',
        session_id: 'abc',
      });
      expect(event.id).toBeTruthy();
      expect(event.id.length).toBeGreaterThan(0);
      expect(event.vendor).toBe('google');
      expect(event.eventSource).toBe('hook');
    });
  });

  describe('dedupeFingerprint()', () => {
    it('includes session_id, hook_event_name, and tool_name', () => {
      const fp = adapter.dedupeFingerprint({
        session_id: 's1',
        hook_event_name: 'BeforeTool',
        tool_name: 'read_file',
      });
      expect(fp).toBe('s1:BeforeTool:read_file:');
    });

    it('includes prompt text for BeforeModel', () => {
      const fp = adapter.dedupeFingerprint({
        session_id: 's1',
        hook_event_name: 'BeforeModel',
        prompt: 'Fix the bug',
      });
      expect(fp).toBe('s1:BeforeModel::Fix the bug');
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════
// AdapterRegistry
// ═══════════════════════════════════════════════════════════════════════

describe('AdapterRegistry', () => {
  it('returns first matching adapter (Gemini before Claude)', () => {
    const registry = new AdapterRegistry()
      .register(new GeminiAdapter())
      .register(new ClaudeAdapter());

    const adapter = registry.findAdapter({ hook_event_name: 'BeforeModel' });
    expect(adapter?.id).toBe('gemini');
  });

  it('falls through to Claude for non-Gemini hooks', () => {
    const registry = new AdapterRegistry()
      .register(new GeminiAdapter())
      .register(new ClaudeAdapter());

    const adapter = registry.findAdapter({ hook_event_name: 'UserPromptSubmit' });
    expect(adapter?.id).toBe('claude');
  });

  it('falls through to Claude for SessionStart without .gemini/ path', () => {
    const registry = new AdapterRegistry()
      .register(new GeminiAdapter())
      .register(new ClaudeAdapter());

    const adapter = registry.findAdapter({
      hook_event_name: 'SessionStart',
      session_id: 's1',
    });
    expect(adapter?.id).toBe('claude');
  });

  it('matches Gemini for SessionStart with .gemini/ path', () => {
    const registry = new AdapterRegistry()
      .register(new GeminiAdapter())
      .register(new ClaudeAdapter());

    const adapter = registry.findAdapter({
      hook_event_name: 'SessionStart',
      transcript_path: '/home/user/.gemini/tmp/abc/chats/session.jsonl',
    });
    expect(adapter?.id).toBe('gemini');
  });

  it('returns null when no adapter matches', () => {
    const registry = new AdapterRegistry()
      .register(new GeminiAdapter())
      .register(new ClaudeAdapter());

    const adapter = registry.findAdapter({ type: 'some_sdk_event' });
    expect(adapter).toBeNull();
  });

  it('dispatch() returns null when no adapter matches', () => {
    const registry = new AdapterRegistry()
      .register(new GeminiAdapter())
      .register(new ClaudeAdapter());

    const result = registry.dispatch({ no_hook: true });
    expect(result).toBeNull();
  });

  it('dispatch() normalizes and returns event', () => {
    const registry = new AdapterRegistry()
      .register(new GeminiAdapter())
      .register(new ClaudeAdapter());

    const result = registry.dispatch({
      hook_event_name: 'BeforeModel',
      session_id: 'test',
      timestamp: '2026-01-01T00:00:00Z',
    });
    expect(result).not.toBeNull();
    expect(result!.adapter.id).toBe('gemini');
    expect(result!.event.type).toBe('user_prompt');
    expect(result!.event.vendor).toBe('google');
    expect(result!.isDuplicate).toBe(false);
  });

  it('detects duplicates within 2-second window', () => {
    const registry = new AdapterRegistry()
      .register(new GeminiAdapter())
      .register(new ClaudeAdapter());

    const payload = {
      hook_event_name: 'BeforeTool',
      session_id: 'dedup-test',
      tool_name: 'read_file',
    };

    const first = registry.dispatch(payload);
    const second = registry.dispatch(payload);

    expect(first!.isDuplicate).toBe(false);
    expect(second!.isDuplicate).toBe(true);

    registry.clearDedupeCache();
  });

  it('does not cross-deduplicate between adapters', () => {
    const registry = new AdapterRegistry()
      .register(new GeminiAdapter())
      .register(new ClaudeAdapter());

    // Gemini event
    registry.dispatch({
      hook_event_name: 'BeforeTool',
      session_id: 'cross-test',
      tool_name: 'read_file',
    });

    // Claude event with overlapping fingerprint fields
    const claudeResult = registry.dispatch({
      hook_event_name: 'PreToolUse',
      session_id: 'cross-test',
      tool_name: 'read_file',
    });

    // Should not be deduplicated — different adapter
    expect(claudeResult!.isDuplicate).toBe(false);

    registry.clearDedupeCache();
  });

  it('clearDedupeCache resets state', () => {
    const registry = new AdapterRegistry().register(new GeminiAdapter());

    const payload = {
      hook_event_name: 'BeforeModel',
      session_id: 'clear-test',
    };

    registry.dispatch(payload);
    registry.clearDedupeCache();

    const result = registry.dispatch(payload);
    expect(result!.isDuplicate).toBe(false);

    registry.clearDedupeCache();
  });

  it('matches Codex before Gemini and Claude', () => {
    const registry = new AdapterRegistry()
      .register(new CodexAdapter())
      .register(new GeminiAdapter())
      .register(new ClaudeAdapter());

    const adapter = registry.findAdapter({ type: 'agent-turn-complete', 'thread-id': 't1' });
    expect(adapter?.id).toBe('codex');
  });

  it('does not match Codex for Claude hook events', () => {
    const registry = new AdapterRegistry()
      .register(new CodexAdapter())
      .register(new GeminiAdapter())
      .register(new ClaudeAdapter());

    const adapter = registry.findAdapter({ hook_event_name: 'PreToolUse', session_id: 's1' });
    expect(adapter?.id).toBe('claude');
  });
});

// ═══════════════════════════════════════════════════════════════════════
// CodexAdapter
// ═══════════════════════════════════════════════════════════════════════

describe('CodexAdapter', () => {
  const adapter = new CodexAdapter();

  afterEach(() => {
    adapter.resetTokenTracker();
  });

  describe('detect()', () => {
    it('returns true for agent-turn-complete (notify hook)', () => {
      expect(adapter.detect({ type: 'agent-turn-complete', 'thread-id': 't1' })).toBe(true);
    });

    it('returns true for event_msg wrapper', () => {
      expect(adapter.detect({ type: 'event_msg', payload: { type: 'user_message' } })).toBe(true);
    });

    it('returns true for direct role message', () => {
      expect(adapter.detect({ type: 'message', role: 'user', content: 'Fix it' })).toBe(true);
    });

    it('returns true for state record', () => {
      expect(adapter.detect({ record_type: 'state', data: { model: 'o4-mini' } })).toBe(true);
    });

    it('returns true for _codex tagged payload', () => {
      expect(adapter.detect({ _codex: true, foo: 'bar' })).toBe(true);
    });

    it('returns false for Claude hook events', () => {
      expect(adapter.detect({ hook_event_name: 'PreToolUse', session_id: 's1' })).toBe(false);
    });

    it('returns false for Gemini hook events', () => {
      expect(adapter.detect({ hook_event_name: 'BeforeModel', session_id: 's1' })).toBe(false);
    });

    it('returns false for empty payload', () => {
      expect(adapter.detect({})).toBe(false);
    });
  });

  describe('normalize()', () => {
    it('maps agent-turn-complete to result with text', () => {
      const event = adapter.normalize({
        type: 'agent-turn-complete',
        'thread-id': 'abc',
        'last-assistant-message': 'Done fixing the bug.',
      });
      expect(event.type).toBe('result');
      expect(event.text).toBe('Done fixing the bug.');
      expect(event.sessionId).toBe('codex-abc');
      expect(event.vendor).toBe('openai');
      expect(event.eventSource).toBe('hook');
    });

    it('maps event_msg user_message to user_prompt', () => {
      const event = adapter.normalize({
        type: 'event_msg',
        session_id: 'sess1',
        payload: { type: 'user_message', message: 'Fix the login bug' },
      });
      expect(event.type).toBe('user_prompt');
      expect(event.text).toBe('Fix the login bug');
      expect(event.sessionId).toBe('codex-sess1');
    });

    it('maps event_msg turn_context to session_start with model', () => {
      const event = adapter.normalize({
        type: 'event_msg',
        session_id: 'sess1',
        payload: { type: 'turn_context', model: 'o4-mini', approval_policy: 'auto-edit' },
      });
      expect(event.type).toBe('session_start');
      expect(event.model).toBe('o4-mini');
      expect(event.permissionMode).toBe('auto-edit');
    });

    it('maps event_msg token_count to result with delta tokens', () => {
      // Turn 1: cumulative
      const event1 = adapter.normalize({
        type: 'event_msg',
        session_id: 'token-test',
        payload: {
          type: 'token_count',
          input_tokens: 1000,
          cached_input_tokens: 800,
          output_tokens: 50,
        },
      });
      expect(event1.type).toBe('result');
      expect(event1.tokenUsage).toEqual({ input: 1000, output: 50 });

      // Turn 2: cumulative → delta
      const event2 = adapter.normalize({
        type: 'event_msg',
        session_id: 'token-test',
        payload: {
          type: 'token_count',
          input_tokens: 2500,
          cached_input_tokens: 2000,
          output_tokens: 130,
        },
      });
      expect(event2.tokenUsage).toEqual({ input: 1500, output: 80 });
    });

    it('maps direct role=user message to user_prompt', () => {
      const event = adapter.normalize({
        type: 'message',
        session_id: 'sess1',
        role: 'user',
        content: 'What does this function do?',
      });
      expect(event.type).toBe('user_prompt');
      expect(event.text).toBe('What does this function do?');
    });

    it('maps assistant message with tool_use to tool_start', () => {
      const event = adapter.normalize({
        type: 'message',
        session_id: 'sess1',
        role: 'assistant',
        content: [
          { type: 'text', text: 'Let me read the file.' },
          { type: 'tool_use', id: 'tu-1', name: 'read_file', input: { file_path: 'src/auth.ts' } },
        ],
      });
      expect(event.type).toBe('tool_start');
      expect(event.toolName).toBe('read_file');
      expect(event.toolUseId).toBe('tu-1');
      expect(event.status).toBe('running');
      expect(event.toolInput).toEqual({ file_path: 'src/auth.ts' });
    });

    it('maps assistant message with text only to text_delta', () => {
      const event = adapter.normalize({
        type: 'message',
        session_id: 'sess1',
        role: 'assistant',
        content: [{ type: 'text', text: 'Here is my analysis.' }],
      });
      expect(event.type).toBe('text_delta');
      expect(event.text).toBe('Here is my analysis.');
    });

    it('maps assistant string content to text_delta', () => {
      const event = adapter.normalize({
        type: 'message',
        session_id: 'sess1',
        role: 'assistant',
        content: 'Simple text response.',
      });
      expect(event.type).toBe('text_delta');
      expect(event.text).toBe('Simple text response.');
    });

    it('maps role=tool to tool_end', () => {
      const event = adapter.normalize({
        type: 'message',
        session_id: 'sess1',
        role: 'tool',
        tool_use_id: 'tu-1',
        content: 'file contents here...',
      });
      expect(event.type).toBe('tool_end');
      expect(event.toolUseId).toBe('tu-1');
      expect(event.status).toBe('success');
    });

    it('maps state record to session_start with model and cwd', () => {
      const event = adapter.normalize({
        record_type: 'state',
        data: { session_id: 'state-sess', model: 'gpt-4o', cwd: '/project' },
      });
      expect(event.type).toBe('session_start');
      expect(event.model).toBe('gpt-4o');
      expect(event.cwd).toBe('/project');
      expect(event.sessionId).toBe('codex-state-sess');
    });

    it('prefixes session ID with codex-', () => {
      const event = adapter.normalize({
        type: 'agent-turn-complete',
        'thread-id': 'my-thread',
      });
      expect(event.sessionId).toBe('codex-my-thread');
    });

    it('does not double-prefix session ID', () => {
      const event = adapter.normalize({
        type: 'agent-turn-complete',
        'thread-id': 'codex-already-prefixed',
      });
      expect(event.sessionId).toBe('codex-already-prefixed');
    });

    it('sets vendor to openai and eventSource to hook', () => {
      const event = adapter.normalize({
        type: 'agent-turn-complete',
        'thread-id': 'v-test',
      });
      expect(event.vendor).toBe('openai');
      expect(event.eventSource).toBe('hook');
    });
  });

  describe('dedupeFingerprint()', () => {
    it('includes session, type, role, and tool_use_id', () => {
      const fp = adapter.dedupeFingerprint({
        type: 'message',
        session_id: 's1',
        role: 'tool',
        tool_use_id: 'tu-1',
      });
      expect(fp).toBe('s1:message:tool:tu-1');
    });

    it('works for notify hook events', () => {
      const fp = adapter.dedupeFingerprint({
        type: 'agent-turn-complete',
        'thread-id': 't1',
      });
      expect(fp).toBe('t1:agent-turn-complete::');
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════
// TokenTracker
// ═══════════════════════════════════════════════════════════════════════

describe('TokenTracker', () => {
  it('returns full count on first call', () => {
    const tracker = new TokenTracker();
    const delta = tracker.computeDelta('s1', { input: 1000, output: 50 });
    expect(delta).toEqual({ input: 1000, output: 50, cached: 0 });
  });

  it('computes delta on subsequent calls', () => {
    const tracker = new TokenTracker();
    tracker.computeDelta('s1', { input: 1000, output: 50 });
    const delta = tracker.computeDelta('s1', { input: 2500, output: 130 });
    expect(delta).toEqual({ input: 1500, output: 80, cached: 0 });
  });

  it('tracks cached tokens', () => {
    const tracker = new TokenTracker();
    tracker.computeDelta('s1', { input: 1000, output: 50, cached: 800 });
    const delta = tracker.computeDelta('s1', { input: 2500, output: 130, cached: 2000 });
    expect(delta).toEqual({ input: 1500, output: 80, cached: 1200 });
  });

  it('isolates sessions', () => {
    const tracker = new TokenTracker();
    tracker.computeDelta('s1', { input: 1000, output: 50 });
    const delta = tracker.computeDelta('s2', { input: 500, output: 20 });
    expect(delta).toEqual({ input: 500, output: 20, cached: 0 });
  });

  it('clamps negative deltas to zero', () => {
    const tracker = new TokenTracker();
    tracker.computeDelta('s1', { input: 1000, output: 50 });
    // Simulate a reset / re-count from Codex (shouldn't happen but be safe)
    const delta = tracker.computeDelta('s1', { input: 500, output: 30 });
    expect(delta).toEqual({ input: 0, output: 0, cached: 0 });
  });

  it('reset() clears session state', () => {
    const tracker = new TokenTracker();
    tracker.computeDelta('s1', { input: 1000, output: 50 });
    tracker.reset('s1');
    const delta = tracker.computeDelta('s1', { input: 500, output: 20 });
    expect(delta).toEqual({ input: 500, output: 20, cached: 0 });
  });

  it('resetAll() clears all sessions', () => {
    const tracker = new TokenTracker();
    tracker.computeDelta('s1', { input: 1000, output: 50 });
    tracker.computeDelta('s2', { input: 2000, output: 100 });
    tracker.resetAll();
    const d1 = tracker.computeDelta('s1', { input: 300, output: 10 });
    const d2 = tracker.computeDelta('s2', { input: 400, output: 20 });
    expect(d1).toEqual({ input: 300, output: 10, cached: 0 });
    expect(d2).toEqual({ input: 400, output: 20, cached: 0 });
  });
});
