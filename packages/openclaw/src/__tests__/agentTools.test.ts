// SPDX-License-Identifier: MIT
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { registerSynapseTools, resetServerCheck } from '../layers/agentTools.js';

// ─── Mock API ───────────────────────────────────────────────────────

interface RegisteredTool {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  execute: (
    runId: string,
    params: Record<string, unknown>,
  ) => Promise<{ content: Array<{ type: string; text: string }> }>;
}

function createMockApi() {
  const tools: RegisteredTool[] = [];
  const optionalFlags: boolean[] = [];
  return {
    registerTool: vi.fn((config: RegisteredTool, opts?: { optional: boolean }) => {
      tools.push(config);
      optionalFlags.push(opts?.optional ?? false);
    }),
    _tools: tools,
    _optionalFlags: optionalFlags,
  };
}

// ─── Tests ──────────────────────────────────────────────────────────

describe('registerSynapseTools', () => {
  beforeEach(() => {
    resetServerCheck();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('registers 3 tools', () => {
    const api = createMockApi();
    registerSynapseTools(api, 27246);
    expect(api.registerTool).toHaveBeenCalledTimes(3);

    const names = api._tools.map((t) => t.name);
    expect(names).toEqual(['synapse_query', 'synapse_metrics', 'synapse_dashboard']);
  });

  it('marks all tools as optional', () => {
    const api = createMockApi();
    registerSynapseTools(api, 27246);
    expect(api._optionalFlags).toEqual([true, true, true]);
  });

  it('synapse_dashboard returns content array format', async () => {
    const api = createMockApi();
    registerSynapseTools(api, 27246);

    // Mock fetch — first call = ensureServerReady, second = dashboard health
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ ok: true, clients: 0, mode: 'openclaw' }),
      }),
    );

    const dashboard = api._tools.find((t) => t.name === 'synapse_dashboard')!;
    const result = await dashboard.execute('test-run', {});

    expect(result).toHaveProperty('content');
    expect(Array.isArray(result.content)).toBe(true);
    expect(result.content[0]).toHaveProperty('type', 'text');

    const data = JSON.parse(result.content[0].text);
    expect(data.status).toBe('running');
    expect(data.url).toBe('http://localhost:27246');
  });

  it('synapse_query returns filtered events', async () => {
    const api = createMockApi();
    registerSynapseTools(api, 27246);

    const mockEvents = [
      {
        type: 'tool_start',
        sessionId: 'sess-1234567890ab',
        vendor: 'anthropic',
        timestamp: Date.now(),
      },
      {
        type: 'user_prompt',
        sessionId: 'sess-1234567890ab',
        vendor: 'openai',
        timestamp: Date.now(),
      },
    ];

    let callCount = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(() => {
        callCount++;
        // First call = ensureServerReady health check
        if (callCount === 1) {
          return Promise.resolve({ ok: true, json: () => Promise.resolve({ ok: true }) });
        }
        // Second call = actual query
        return Promise.resolve({ ok: true, json: () => Promise.resolve(mockEvents) });
      }),
    );

    const query = api._tools.find((t) => t.name === 'synapse_query')!;
    const result = await query.execute('test-run', { vendor: 'anthropic' });

    const data = JSON.parse(result.content[0].text);
    expect(data.count).toBe(1);
    expect(data.events[0].vendor).toBe('anthropic');
  });
});
