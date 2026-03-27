// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Bernhard

import { describe, it, expect } from 'vitest';
import {
  AgentEventSchema,
  SpawnAgentRequestSchema,
  SendMessageSchema,
  EventQuerySchema,
  SnapshotImportSchema,
  CoachingQuerySchema,
  CoachingMultiQuerySchema,
  PlaybookCreateSchema,
  NudgeDismissSchema,
  AnalyticsQuerySchema,
  PriceCreateSchema,
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

  it('accepts a minimal empty object thanks to passthrough', () => {
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
      expect((result.data as Record<string, unknown>).custom_field).toBe('extra-value');
    }
  });

  it('rejects tool_input when it is not an object', () => {
    const result = AgentEventSchema.safeParse({ tool_input: 'not-an-object' });
    expect(result.success).toBe(false);
  });

  it('rejects tool_response when it is a number', () => {
    const result = AgentEventSchema.safeParse({ tool_response: 42 });
    expect(result.success).toBe(false);
  });

  it('accepts tool_input as an empty object', () => {
    const result = AgentEventSchema.safeParse({ tool_input: {} });
    expect(result.success).toBe(true);
  });

  it('rejects non-object input (e.g. array)', () => {
    const result = AgentEventSchema.safeParse([1, 2, 3]);
    expect(result.success).toBe(false);
  });

  it('rejects null input', () => {
    const result = AgentEventSchema.safeParse(null);
    expect(result.success).toBe(false);
  });

  it('accepts event with only session_id', () => {
    const result = AgentEventSchema.safeParse({ session_id: 'sess-only' });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.session_id).toBe('sess-only');
      expect(result.data.hook_event_name).toBeUndefined();
    }
  });
});

// ---------------------------------------------------------------------------
// SpawnAgentRequestSchema
// ---------------------------------------------------------------------------
describe('SpawnAgentRequestSchema', () => {
  it('accepts a minimal valid request with only prompt', () => {
    const result = SpawnAgentRequestSchema.safeParse({ prompt: 'Hello' });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.prompt).toBe('Hello');
      expect(result.data.model).toBeUndefined();
      expect(result.data.tools).toBeUndefined();
    }
  });

  it('accepts all valid model values', () => {
    for (const model of ['opus', 'sonnet', 'haiku']) {
      const result = SpawnAgentRequestSchema.safeParse({ prompt: 'test', model });
      expect(result.success).toBe(true);
    }
  });

  it('accepts all valid permissionMode values', () => {
    for (const mode of ['acceptEdits', 'bypassPermissions', 'default']) {
      const result = SpawnAgentRequestSchema.safeParse({ prompt: 'test', permissionMode: mode });
      expect(result.success).toBe(true);
    }
  });

  it('rejects an empty prompt', () => {
    const result = SpawnAgentRequestSchema.safeParse({ prompt: '' });
    expect(result.success).toBe(false);
  });

  it('rejects a prompt exceeding 100 000 characters', () => {
    const result = SpawnAgentRequestSchema.safeParse({ prompt: 'x'.repeat(100_001) });
    expect(result.success).toBe(false);
  });

  it('accepts a prompt of exactly 100 000 characters', () => {
    const result = SpawnAgentRequestSchema.safeParse({ prompt: 'x'.repeat(100_000) });
    expect(result.success).toBe(true);
  });

  it('rejects an invalid model value', () => {
    const result = SpawnAgentRequestSchema.safeParse({ prompt: 'test', model: 'gpt-4' });
    expect(result.success).toBe(false);
  });

  it('rejects cwd containing path traversal (..)', () => {
    const result = SpawnAgentRequestSchema.safeParse({
      prompt: 'test',
      cwd: 'home/user/../etc/passwd',
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const issue = result.error.issues.find((i) => i.path.includes('cwd'));
      expect(issue?.message).toContain('Path traversal not allowed');
    }
  });

  it('rejects cwd with absolute Unix path', () => {
    const result = SpawnAgentRequestSchema.safeParse({ prompt: 'test', cwd: '/usr/local/bin' });
    expect(result.success).toBe(false);
  });

  it('rejects cwd with absolute Windows path', () => {
    const result = SpawnAgentRequestSchema.safeParse({ prompt: 'test', cwd: 'C:\\Users\\test' });
    expect(result.success).toBe(false);
  });

  it('accepts a relative cwd', () => {
    const result = SpawnAgentRequestSchema.safeParse({ prompt: 'test', cwd: 'src/components' });
    expect(result.success).toBe(true);
  });

  it('rejects tools array exceeding 50 items', () => {
    const tools = Array.from({ length: 51 }, (_, i) => `tool-${i}`);
    const result = SpawnAgentRequestSchema.safeParse({ prompt: 'test', tools });
    expect(result.success).toBe(false);
  });

  it('accepts an empty tools array', () => {
    const result = SpawnAgentRequestSchema.safeParse({ prompt: 'test', tools: [] });
    expect(result.success).toBe(true);
  });

  it('accepts mcpServers with valid structure', () => {
    const result = SpawnAgentRequestSchema.safeParse({
      prompt: 'test',
      mcpServers: {
        server1: { command: 'node', args: ['index.js'] },
        server2: { command: 'python', args: ['-m', 'server'], env: { API_KEY: 'abc' } },
      },
    });
    expect(result.success).toBe(true);
  });

  it('rejects mcpServers with missing command', () => {
    const result = SpawnAgentRequestSchema.safeParse({
      prompt: 'test',
      mcpServers: { bad: { args: ['index.js'] } },
    });
    expect(result.success).toBe(false);
  });

  it('rejects missing prompt field entirely', () => {
    const result = SpawnAgentRequestSchema.safeParse({});
    expect(result.success).toBe(false);
  });

  it('rejects prompt as a number', () => {
    const result = SpawnAgentRequestSchema.safeParse({ prompt: 42 });
    expect(result.success).toBe(false);
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

  it('rejects missing message field', () => {
    const result = SendMessageSchema.safeParse({});
    expect(result.success).toBe(false);
  });

  it('rejects message as a number', () => {
    const result = SendMessageSchema.safeParse({ message: 123 });
    expect(result.success).toBe(false);
  });

  it('accepts a single-character message', () => {
    const result = SendMessageSchema.safeParse({ message: 'x' });
    expect(result.success).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// EventQuerySchema
// ---------------------------------------------------------------------------
describe('EventQuerySchema', () => {
  it('accepts an empty query (all optional)', () => {
    const result = EventQuerySchema.safeParse({});
    expect(result.success).toBe(true);
  });

  it('accepts a valid query with all fields', () => {
    const result = EventQuerySchema.safeParse({
      sessionId: 'sess-1',
      agentId: 'agent-1',
      type: 'tool_start',
      cwd: 'src/app',
      from: 1000,
      to: 2000,
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
    const result = EventQuerySchema.safeParse({ limit: '100', offset: '5' });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.limit).toBe(100);
      expect(result.data.offset).toBe(5);
    }
  });

  it('rejects limit above 2000', () => {
    const result = EventQuerySchema.safeParse({ limit: 2001 });
    expect(result.success).toBe(false);
  });

  it('rejects limit of 0 (min 1)', () => {
    const result = EventQuerySchema.safeParse({ limit: 0 });
    expect(result.success).toBe(false);
  });

  it('rejects negative from value', () => {
    const result = EventQuerySchema.safeParse({ from: -1 });
    expect(result.success).toBe(false);
  });

  it('rejects offset above 100000', () => {
    const result = EventQuerySchema.safeParse({ offset: 100_001 });
    expect(result.success).toBe(false);
  });

  it('accepts offset of exactly 100000', () => {
    const result = EventQuerySchema.safeParse({ offset: 100_000 });
    expect(result.success).toBe(true);
  });

  it('rejects cwd exceeding 500 characters', () => {
    const result = EventQuerySchema.safeParse({ cwd: 'x'.repeat(501) });
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// SnapshotImportSchema
// ---------------------------------------------------------------------------
describe('SnapshotImportSchema', () => {
  const validSnapshot = {
    version: 1,
    exportedAt: '2026-02-10T12:00:00Z',
    projectDir: 'C:\\Workspace\\MyProject',
    sessions: [
      {
        sessionId: 'sess-abc',
        events: [{ type: 'session_start', timestamp: Date.now() }],
        transcript: null,
      },
    ],
  };

  it('accepts a valid snapshot', () => {
    const result = SnapshotImportSchema.safeParse(validSnapshot);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.sessions).toHaveLength(1);
      expect(result.data.version).toBe(1);
    }
  });

  it('accepts a snapshot with empty sessions array', () => {
    const result = SnapshotImportSchema.safeParse({
      ...validSnapshot,
      sessions: [],
    });
    expect(result.success).toBe(true);
  });

  it('accepts transcript as a record with unknown values', () => {
    const result = SnapshotImportSchema.safeParse({
      ...validSnapshot,
      sessions: [
        {
          sessionId: 'sess-1',
          events: [],
          transcript: { messages: ['hello'], count: 5 },
        },
      ],
    });
    expect(result.success).toBe(true);
  });

  it('rejects version 2', () => {
    const result = SnapshotImportSchema.safeParse({ ...validSnapshot, version: 2 });
    expect(result.success).toBe(false);
  });

  it('rejects version 0', () => {
    const result = SnapshotImportSchema.safeParse({ ...validSnapshot, version: 0 });
    expect(result.success).toBe(false);
  });

  it('rejects missing exportedAt', () => {
    const { exportedAt: _, ...without } = validSnapshot;
    const result = SnapshotImportSchema.safeParse(without);
    expect(result.success).toBe(false);
  });

  it('rejects missing projectDir', () => {
    const { projectDir: _, ...without } = validSnapshot;
    const result = SnapshotImportSchema.safeParse(without);
    expect(result.success).toBe(false);
  });

  it('rejects session missing sessionId', () => {
    const result = SnapshotImportSchema.safeParse({
      ...validSnapshot,
      sessions: [{ events: [], transcript: null }],
    });
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// CoachingQuerySchema
// ---------------------------------------------------------------------------
describe('CoachingQuerySchema', () => {
  it('accepts a valid sessionId', () => {
    const result = CoachingQuerySchema.safeParse({ sessionId: 'sess-abc-123' });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.sessionId).toBe('sess-abc-123');
    }
  });

  it('rejects empty sessionId', () => {
    const result = CoachingQuerySchema.safeParse({ sessionId: '' });
    expect(result.success).toBe(false);
  });

  it('rejects missing sessionId', () => {
    const result = CoachingQuerySchema.safeParse({});
    expect(result.success).toBe(false);
  });

  it('rejects sessionId as a number', () => {
    const result = CoachingQuerySchema.safeParse({ sessionId: 42 });
    expect(result.success).toBe(false);
  });

  it('accepts a single-character sessionId', () => {
    const result = CoachingQuerySchema.safeParse({ sessionId: 'x' });
    expect(result.success).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// CoachingMultiQuerySchema
// ---------------------------------------------------------------------------
describe('CoachingMultiQuerySchema', () => {
  it('accepts a single sessionId', () => {
    const result = CoachingMultiQuerySchema.safeParse({ sessionIds: 'sess-1' });
    expect(result.success).toBe(true);
  });

  it('accepts comma-separated sessionIds', () => {
    const result = CoachingMultiQuerySchema.safeParse({
      sessionIds: 'sess-1,sess-2,sess-3',
    });
    expect(result.success).toBe(true);
  });

  it('rejects empty string', () => {
    const result = CoachingMultiQuerySchema.safeParse({ sessionIds: '' });
    expect(result.success).toBe(false);
  });

  it('rejects missing sessionIds field', () => {
    const result = CoachingMultiQuerySchema.safeParse({});
    expect(result.success).toBe(false);
  });

  it('rejects trailing comma (empty id after split)', () => {
    const result = CoachingMultiQuerySchema.safeParse({ sessionIds: 'sess-1,' });
    expect(result.success).toBe(false);
  });

  it('rejects leading comma (empty id before split)', () => {
    const result = CoachingMultiQuerySchema.safeParse({ sessionIds: ',sess-1' });
    expect(result.success).toBe(false);
  });

  it('rejects double comma (empty id in middle)', () => {
    const result = CoachingMultiQuerySchema.safeParse({ sessionIds: 'sess-1,,sess-2' });
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// PlaybookCreateSchema
// ---------------------------------------------------------------------------
describe('PlaybookCreateSchema', () => {
  it('accepts a valid playbook with all fields', () => {
    const result = PlaybookCreateSchema.safeParse({
      name: 'Auth Refactor Playbook',
      description: 'Step-by-step guide for refactoring auth modules',
      category: 'refactor',
      sourceSessionId: 'sess-abc',
      tags: ['auth', 'security'],
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.name).toBe('Auth Refactor Playbook');
      expect(result.data.category).toBe('refactor');
      expect(result.data.tags).toHaveLength(2);
    }
  });

  it('accepts a playbook with only required fields', () => {
    const result = PlaybookCreateSchema.safeParse({
      name: 'Minimal',
      description: 'A minimal playbook',
      category: 'custom',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.sourceSessionId).toBeUndefined();
      expect(result.data.tags).toBeUndefined();
    }
  });

  it('accepts all valid category values', () => {
    const categories = ['feature', 'bugfix', 'refactor', 'test', 'review', 'debug', 'custom'];
    for (const category of categories) {
      const result = PlaybookCreateSchema.safeParse({
        name: 'Test',
        description: 'desc',
        category,
      });
      expect(result.success).toBe(true);
    }
  });

  it('rejects an invalid category', () => {
    const result = PlaybookCreateSchema.safeParse({
      name: 'Test',
      description: 'desc',
      category: 'deployment',
    });
    expect(result.success).toBe(false);
  });

  it('rejects empty name', () => {
    const result = PlaybookCreateSchema.safeParse({
      name: '',
      description: 'desc',
      category: 'feature',
    });
    expect(result.success).toBe(false);
  });

  it('rejects name exceeding 200 characters', () => {
    const result = PlaybookCreateSchema.safeParse({
      name: 'x'.repeat(201),
      description: 'desc',
      category: 'feature',
    });
    expect(result.success).toBe(false);
  });

  it('rejects description exceeding 2000 characters', () => {
    const result = PlaybookCreateSchema.safeParse({
      name: 'Test',
      description: 'x'.repeat(2001),
      category: 'feature',
    });
    expect(result.success).toBe(false);
  });

  it('accepts empty description', () => {
    const result = PlaybookCreateSchema.safeParse({
      name: 'Test',
      description: '',
      category: 'feature',
    });
    expect(result.success).toBe(true);
  });

  it('rejects tags array exceeding 20 items', () => {
    const tags = Array.from({ length: 21 }, (_, i) => `tag-${i}`);
    const result = PlaybookCreateSchema.safeParse({
      name: 'Test',
      description: 'desc',
      category: 'feature',
      tags,
    });
    expect(result.success).toBe(false);
  });

  it('rejects a single tag exceeding 50 characters', () => {
    const result = PlaybookCreateSchema.safeParse({
      name: 'Test',
      description: 'desc',
      category: 'feature',
      tags: ['x'.repeat(51)],
    });
    expect(result.success).toBe(false);
  });

  it('rejects missing required fields', () => {
    const result = PlaybookCreateSchema.safeParse({});
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// NudgeDismissSchema
// ---------------------------------------------------------------------------
describe('NudgeDismissSchema', () => {
  it('accepts valid nudgeId and sessionId', () => {
    const result = NudgeDismissSchema.safeParse({
      nudgeId: 'nudge-001',
      sessionId: 'sess-abc',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.nudgeId).toBe('nudge-001');
      expect(result.data.sessionId).toBe('sess-abc');
    }
  });

  it('rejects empty nudgeId', () => {
    const result = NudgeDismissSchema.safeParse({ nudgeId: '', sessionId: 'sess-1' });
    expect(result.success).toBe(false);
  });

  it('rejects empty sessionId', () => {
    const result = NudgeDismissSchema.safeParse({ nudgeId: 'nudge-1', sessionId: '' });
    expect(result.success).toBe(false);
  });

  it('rejects missing nudgeId', () => {
    const result = NudgeDismissSchema.safeParse({ sessionId: 'sess-1' });
    expect(result.success).toBe(false);
  });

  it('rejects missing sessionId', () => {
    const result = NudgeDismissSchema.safeParse({ nudgeId: 'nudge-1' });
    expect(result.success).toBe(false);
  });

  it('rejects empty object', () => {
    const result = NudgeDismissSchema.safeParse({});
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// AnalyticsQuerySchema
// ---------------------------------------------------------------------------
describe('AnalyticsQuerySchema', () => {
  it('accepts an empty query (all optional)', () => {
    const result = AnalyticsQuerySchema.safeParse({});
    expect(result.success).toBe(true);
  });

  it('accepts a fully-specified query', () => {
    const result = AnalyticsQuerySchema.safeParse({
      from: 1000,
      to: 2000,
      cwd: 'src/app',
      granularity: 'day',
      limit: 100,
      offset: 0,
      sessionId: 'sess-1',
      model: 'claude-opus-4-6',
      vendor: 'anthropic',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.granularity).toBe('day');
      expect(result.data.model).toBe('claude-opus-4-6');
    }
  });

  it('accepts all valid granularity values', () => {
    for (const g of ['hour', 'day', 'week']) {
      const result = AnalyticsQuerySchema.safeParse({ granularity: g });
      expect(result.success).toBe(true);
    }
  });

  it('rejects invalid granularity', () => {
    const result = AnalyticsQuerySchema.safeParse({ granularity: 'month' });
    expect(result.success).toBe(false);
  });

  it('coerces string numbers for from/to/limit/offset', () => {
    const result = AnalyticsQuerySchema.safeParse({
      from: '1000',
      to: '2000',
      limit: '50',
      offset: '10',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.from).toBe(1000);
      expect(result.data.to).toBe(2000);
      expect(result.data.limit).toBe(50);
      expect(result.data.offset).toBe(10);
    }
  });

  it('rejects limit above 500', () => {
    const result = AnalyticsQuerySchema.safeParse({ limit: 501 });
    expect(result.success).toBe(false);
  });

  it('rejects limit of 0', () => {
    const result = AnalyticsQuerySchema.safeParse({ limit: 0 });
    expect(result.success).toBe(false);
  });

  it('rejects negative from', () => {
    const result = AnalyticsQuerySchema.safeParse({ from: -1 });
    expect(result.success).toBe(false);
  });

  it('rejects offset above 100000', () => {
    const result = AnalyticsQuerySchema.safeParse({ offset: 100_001 });
    expect(result.success).toBe(false);
  });

  it('rejects cwd exceeding 500 characters', () => {
    const result = AnalyticsQuerySchema.safeParse({ cwd: 'x'.repeat(501) });
    expect(result.success).toBe(false);
  });

  it('accepts limit of exactly 500', () => {
    const result = AnalyticsQuerySchema.safeParse({ limit: 500 });
    expect(result.success).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// PriceCreateSchema
// ---------------------------------------------------------------------------
describe('PriceCreateSchema', () => {
  const validPrice = {
    model: 'claude-opus-4-6',
    vendor: 'anthropic',
    effectiveFrom: 1700000000,
    inputPer1M: 15,
    cachedInputPer1M: 1.5,
    outputPer1M: 75,
  };

  it('accepts a valid price entry', () => {
    const result = PriceCreateSchema.safeParse(validPrice);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.model).toBe('claude-opus-4-6');
      expect(result.data.inputPer1M).toBe(15);
    }
  });

  it('accepts zero values for price fields', () => {
    const result = PriceCreateSchema.safeParse({
      ...validPrice,
      inputPer1M: 0,
      cachedInputPer1M: 0,
      outputPer1M: 0,
      effectiveFrom: 0,
    });
    expect(result.success).toBe(true);
  });

  it('rejects empty model string', () => {
    const result = PriceCreateSchema.safeParse({ ...validPrice, model: '' });
    expect(result.success).toBe(false);
  });

  it('rejects empty vendor string', () => {
    const result = PriceCreateSchema.safeParse({ ...validPrice, vendor: '' });
    expect(result.success).toBe(false);
  });

  it('rejects negative inputPer1M', () => {
    const result = PriceCreateSchema.safeParse({ ...validPrice, inputPer1M: -1 });
    expect(result.success).toBe(false);
  });

  it('rejects negative cachedInputPer1M', () => {
    const result = PriceCreateSchema.safeParse({ ...validPrice, cachedInputPer1M: -0.01 });
    expect(result.success).toBe(false);
  });

  it('rejects negative outputPer1M', () => {
    const result = PriceCreateSchema.safeParse({ ...validPrice, outputPer1M: -5 });
    expect(result.success).toBe(false);
  });

  it('rejects negative effectiveFrom', () => {
    const result = PriceCreateSchema.safeParse({ ...validPrice, effectiveFrom: -1 });
    expect(result.success).toBe(false);
  });

  it('rejects non-integer effectiveFrom', () => {
    const result = PriceCreateSchema.safeParse({ ...validPrice, effectiveFrom: 1.5 });
    expect(result.success).toBe(false);
  });

  it('rejects missing required fields', () => {
    const result = PriceCreateSchema.safeParse({});
    expect(result.success).toBe(false);
  });

  it('rejects missing model field', () => {
    const { model: _, ...without } = validPrice;
    const result = PriceCreateSchema.safeParse(without);
    expect(result.success).toBe(false);
  });

  it('accepts decimal price values', () => {
    const result = PriceCreateSchema.safeParse({
      ...validPrice,
      inputPer1M: 0.25,
      cachedInputPer1M: 0.025,
      outputPer1M: 1.25,
    });
    expect(result.success).toBe(true);
  });
});
