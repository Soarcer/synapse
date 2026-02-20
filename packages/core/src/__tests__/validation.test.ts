import {
  AgentEventSchema,
  SpawnAgentRequestSchema,
  SendMessageSchema,
  EventQuerySchema,
  SnapshotImportSchema,
} from '../schemas.js';

// ---------------------------------------------------------------------------
// AgentEventSchema
// ---------------------------------------------------------------------------
describe('AgentEventSchema', () => {
  it('accepts a valid event with all known fields', () => {
    const input = {
      hook_event_name: 'tool_start',
      session_id: 'sess-abc',
      agent_id: 'agent-1',
      agent_type: 'Explore',
      tool_name: 'Read',
      tool_use_id: 'tu-42',
      tool_input: { file_path: '/tmp/foo.ts' },
      tool_response: { content: 'hello' },
    };

    const result = AgentEventSchema.safeParse(input);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.hook_event_name).toBe('tool_start');
      expect(result.data.tool_input).toEqual({ file_path: '/tmp/foo.ts' });
    }
  });

  it('accepts a minimal (empty) object thanks to passthrough', () => {
    const result = AgentEventSchema.safeParse({});
    expect(result.success).toBe(true);
  });

  it('passes through extra fields not defined in the schema', () => {
    const input = {
      hook_event_name: 'session_start',
      custom_field: 'extra-value',
      nested: { deep: true },
    };

    const result = AgentEventSchema.safeParse(input);
    expect(result.success).toBe(true);
    if (result.success) {
      // passthrough preserves unknown keys
      expect((result.data as Record<string, unknown>).custom_field).toBe('extra-value');
    }
  });

  it('rejects tool_input when it is not an object', () => {
    const result = AgentEventSchema.safeParse({ tool_input: 'not-an-object' });
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// SpawnAgentRequestSchema
// ---------------------------------------------------------------------------
describe('SpawnAgentRequestSchema', () => {
  it('accepts a valid spawn request with all optional fields', () => {
    const input = {
      prompt: 'Refactor the auth module',
      model: 'opus',
      tools: ['Read', 'Edit', 'Bash'],
      permissionMode: 'acceptEdits',
      systemPrompt: 'You are a helpful coding assistant.',
      mcpServers: {
        myServer: {
          command: 'node',
          args: ['server.js'],
          env: { PORT: '3000' },
        },
      },
      cwd: 'home/user/project',
      sessionId: 'sess-xyz',
    };

    const result = SpawnAgentRequestSchema.safeParse(input);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.model).toBe('opus');
      expect(result.data.tools).toHaveLength(3);
    }
  });

  it('rejects an empty prompt (min 1 character)', () => {
    const result = SpawnAgentRequestSchema.safeParse({ prompt: '' });
    expect(result.success).toBe(false);
    if (!result.success) {
      const promptIssue = result.error.issues.find((i) => i.path.includes('prompt'));
      expect(promptIssue).toBeDefined();
    }
  });

  it('rejects a prompt exceeding 100 000 characters', () => {
    const longPrompt = 'x'.repeat(100_001);
    const result = SpawnAgentRequestSchema.safeParse({ prompt: longPrompt });
    expect(result.success).toBe(false);
  });

  it('rejects an invalid model value', () => {
    const result = SpawnAgentRequestSchema.safeParse({
      prompt: 'hello',
      model: 'gpt-4',
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const modelIssue = result.error.issues.find((i) => i.path.includes('model'));
      expect(modelIssue).toBeDefined();
    }
  });

  it('rejects cwd containing path traversal (..)', () => {
    const result = SpawnAgentRequestSchema.safeParse({
      prompt: 'do something',
      cwd: '/home/user/../etc/passwd',
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const cwdIssue = result.error.issues.find((i) => i.path.includes('cwd'));
      expect(cwdIssue).toBeDefined();
      expect(cwdIssue!.message).toContain('Path traversal not allowed');
    }
  });
});

// ---------------------------------------------------------------------------
// SendMessageSchema
// ---------------------------------------------------------------------------
describe('SendMessageSchema', () => {
  it('accepts a valid non-empty message', () => {
    const result = SendMessageSchema.safeParse({ message: 'Hello agent!' });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.message).toBe('Hello agent!');
    }
  });

  it('rejects an empty message string', () => {
    const result = SendMessageSchema.safeParse({ message: '' });
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// EventQuerySchema
// ---------------------------------------------------------------------------
describe('EventQuerySchema', () => {
  it('accepts a valid query with limit and offset', () => {
    const result = EventQuerySchema.safeParse({
      sessionId: 'sess-1',
      limit: 50,
      offset: 10,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.limit).toBe(50);
      expect(result.data.offset).toBe(10);
    }
  });

  it('coerces string numbers to integers (query-param style)', () => {
    const result = EventQuerySchema.safeParse({ limit: '100' });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.limit).toBe(100);
    }
  });

  it('rejects limit above 2000', () => {
    const result = EventQuerySchema.safeParse({ limit: 2001 });
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// SnapshotImportSchema
// ---------------------------------------------------------------------------
describe('SnapshotImportSchema', () => {
  it('accepts a valid snapshot with sessions', () => {
    const input = {
      version: 1,
      exportedAt: '2026-02-10T12:00:00Z',
      projectDir: 'C:\\Workspace\\MyProject',
      sessions: [
        {
          sessionId: 'sess-abc',
          events: [
            { type: 'session_start', timestamp: Date.now() },
            { type: 'tool_start', toolName: 'Read', timestamp: Date.now() },
          ],
          transcript: null,
        },
        {
          sessionId: 'sess-def',
          events: [],
          transcript: { messages: ['hello'] },
        },
      ],
    };

    const result = SnapshotImportSchema.safeParse(input);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.sessions).toHaveLength(2);
      expect(result.data.version).toBe(1);
      expect(result.data.projectDir).toBe('C:\\Workspace\\MyProject');
    }
  });

  it('rejects a snapshot with wrong version number', () => {
    const result = SnapshotImportSchema.safeParse({
      version: 2,
      exportedAt: '2026-02-10T12:00:00Z',
      projectDir: '/tmp',
      sessions: [],
    });
    expect(result.success).toBe(false);
  });
});
