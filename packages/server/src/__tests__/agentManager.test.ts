import type { SpawnAgentRequest } from '@synapse-ai/core';
import type { Broadcaster } from '../services/broadcaster';

// ─── Mocks ──────────────────────────────────────────────────────────

// Mock the Claude Agent SDK — must be declared before importing AgentManager
vi.mock('@anthropic-ai/claude-agent-sdk', () => ({
  query: vi.fn(),
}));

// Mock the database layer so no real SQLite is touched
vi.mock('../db', () => ({
  insertEvent: vi.fn(),
}));

// Mock nanoid to produce deterministic IDs
let nanoidCounter = 0;
vi.mock('nanoid', () => ({
  nanoid: (size?: number) => `id-${++nanoidCounter}`,
}));

// Silence logger output during tests
vi.mock('../lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

// Import after mocks are set up
import { AgentManager } from '../services/agentManager';
import { query } from '@anthropic-ai/claude-agent-sdk';
import { insertEvent } from '../db';

// ─── Helpers ────────────────────────────────────────────────────────

function createMockBroadcaster(): Broadcaster {
  return {
    broadcast: vi.fn(),
    broadcastText: vi.fn(),
    addClient: vi.fn(),
    removeClient: vi.fn(),
    destroy: vi.fn(),
    clientCount: 0,
  } as unknown as Broadcaster;
}

function makeSpawnRequest(overrides: Partial<SpawnAgentRequest> = {}): SpawnAgentRequest {
  return {
    prompt: 'Write hello world',
    ...overrides,
  };
}

/**
 * Creates an async iterable that yields the given messages, simulating
 * the stream returned by the SDK's query() function.
 */
async function* fakeStream(messages: Array<Record<string, unknown>>) {
  for (const msg of messages) {
    yield msg;
  }
}

// ─── Tests ──────────────────────────────────────────────────────────

describe('AgentManager', () => {
  let manager: AgentManager;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    nanoidCounter = 0;
    manager = new AgentManager();
  });

  afterEach(() => {
    manager.stopAll();
    vi.useRealTimers();
  });

  // ── 1. Constructor ──

  it('creates an instance with no agents', () => {
    expect(manager.getActive()).toEqual([]);
    expect(manager.getAll()).toEqual([]);
  });

  // ── 2. getActive() initially empty ──

  it('getActive() returns empty array initially', () => {
    const active = manager.getActive();
    expect(active).toBeInstanceOf(Array);
    expect(active).toHaveLength(0);
  });

  // ── 3. Expected methods ──

  it('has expected public methods: spawn, stopAll, getActive, sendMessage', () => {
    expect(typeof manager.spawn).toBe('function');
    expect(typeof manager.stopAll).toBe('function');
    expect(typeof manager.getActive).toBe('function');
    expect(typeof manager.sendMessage).toBe('function');
    expect(typeof manager.stop).toBe('function');
    expect(typeof manager.getAll).toBe('function');
  });

  // ── 4. spawn() returns an agent ID and registers the agent ──

  it('spawn() returns an agent ID and registers the agent as running', async () => {
    const broadcaster = createMockBroadcaster();
    // query returns an async iterable that never yields (hangs like a real stream)
    (query as ReturnType<typeof vi.fn>).mockReturnValue(fakeStream([]));

    const agentId = await manager.spawn(makeSpawnRequest(), broadcaster);

    expect(agentId).toMatch(/^agent-/);

    const active = manager.getActive();
    expect(active).toHaveLength(1);
    expect(active[0].agentId).toBe(agentId);
    expect(active[0].status).toBe('running');
    expect(active[0].agentType).toBe('custom');
  });

  // ── 5. spawn() broadcasts an agent_start event ──

  it('spawn() persists and broadcasts an agent_start event', async () => {
    const broadcaster = createMockBroadcaster();
    (query as ReturnType<typeof vi.fn>).mockReturnValue(fakeStream([]));

    await manager.spawn(makeSpawnRequest(), broadcaster);

    // insertEvent should have been called for the agent_start event
    expect(insertEvent).toHaveBeenCalledTimes(1);
    const insertCall = (insertEvent as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(insertCall.event_type).toBe('agent_start');
    expect(insertCall.hook_event_name).toBe('SpawnAgent');

    // broadcaster.broadcast should have been called with the agent_start event
    expect(broadcaster.broadcast).toHaveBeenCalledTimes(1);
    const broadcastedEvent = (broadcaster.broadcast as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(broadcastedEvent.type).toBe('agent_start');
    expect(broadcastedEvent.eventSource).toBe('sdk');
    expect(broadcastedEvent.status).toBe('running');
  });

  // ── 6. spawn() rejects when max concurrent agents reached ──

  it('spawn() throws when max concurrent agents (10) is reached', async () => {
    const broadcaster = createMockBroadcaster();
    (query as ReturnType<typeof vi.fn>).mockReturnValue(fakeStream([]));

    // Spawn 10 agents (the maximum)
    for (let i = 0; i < 10; i++) {
      await manager.spawn(makeSpawnRequest(), broadcaster);
    }

    expect(manager.getActive()).toHaveLength(10);

    // 11th spawn should throw
    await expect(manager.spawn(makeSpawnRequest(), broadcaster)).rejects.toThrow(
      'Max concurrent agents reached',
    );
  });

  // ── 7. stop() aborts a running agent ──

  it('stop() aborts a running agent and returns true', async () => {
    const broadcaster = createMockBroadcaster();
    (query as ReturnType<typeof vi.fn>).mockReturnValue(fakeStream([]));

    const agentId = await manager.spawn(makeSpawnRequest(), broadcaster);
    expect(manager.getActive()).toHaveLength(1);

    const result = manager.stop(agentId);
    expect(result).toBe(true);

    // Agent should no longer be in getActive() (which filters for status === 'running')
    expect(manager.getActive()).toHaveLength(0);

    // But it should still be in getAll() with 'stopped' status
    const all = manager.getAll();
    expect(all).toHaveLength(1);
    expect(all[0].status).toBe('stopped');
  });

  // ── 8. stop() returns false for unknown agent ID ──

  it('stop() returns false for an unknown agent ID', () => {
    const result = manager.stop('nonexistent-agent');
    expect(result).toBe(false);
  });

  // ── 9. stopAll() stops all running agents ──

  it('stopAll() stops all running agents', async () => {
    const broadcaster = createMockBroadcaster();
    (query as ReturnType<typeof vi.fn>).mockReturnValue(fakeStream([]));

    await manager.spawn(makeSpawnRequest(), broadcaster);
    await manager.spawn(makeSpawnRequest(), broadcaster);
    expect(manager.getActive()).toHaveLength(2);

    manager.stopAll();

    // stopAll() clears the agents Map entirely
    expect(manager.getActive()).toHaveLength(0);
    expect(manager.getAll()).toHaveLength(0);
  });

  // ── 10. sendMessage() returns false for unknown agent ──

  it('sendMessage() returns false for an unknown agent', async () => {
    const broadcaster = createMockBroadcaster();
    const result = await manager.sendMessage('nonexistent', 'hello', broadcaster);
    expect(result).toBe(false);
  });
});
