import { Broadcaster } from '../services/broadcaster';
import type { AgentEvent, ActiveAgentInfo } from '../../src/types/agent';

// ─── Mock WebSocket ──────────────────────────────────────────────────

// WebSocket.OPEN = 1, WebSocket.CLOSED = 3
function createMockWs(readyState = 1) {
  return {
    readyState,
    send: vi.fn(),
    on: vi.fn(),
    close: vi.fn(),
    ping: vi.fn(),
    terminate: vi.fn(),
    bufferedAmount: 0,
  } as unknown as import('ws').WebSocket;
}

function makeEvent(overrides: Partial<AgentEvent> = {}): AgentEvent {
  return {
    id: 'evt-1',
    type: 'tool_start',
    sessionId: 'sess-1',
    timestamp: Date.now(),
    ...overrides,
  };
}

function makeActiveAgent(overrides: Partial<ActiveAgentInfo> = {}): ActiveAgentInfo {
  return {
    agentId: 'agent-1',
    agentType: 'Explore',
    sessionId: 'sess-1',
    status: 'running',
    startTime: Date.now(),
    ...overrides,
  };
}

// ─── Tests ───────────────────────────────────────────────────────────

describe('Broadcaster', () => {
  let broadcaster: Broadcaster;

  beforeEach(() => {
    vi.useFakeTimers();
    broadcaster = new Broadcaster();
  });

  afterEach(() => {
    broadcaster.destroy();
    vi.useRealTimers();
  });

  // ── addClient ──

  it('sends initial connected message with active agents on addClient', () => {
    const ws = createMockWs(1);
    const agents = [makeActiveAgent({ agentId: 'a1' }), makeActiveAgent({ agentId: 'a2' })];

    broadcaster.addClient(ws, agents);

    expect(ws.send).toHaveBeenCalledTimes(1);
    const sent = JSON.parse((ws.send as ReturnType<typeof vi.fn>).mock.calls[0][0]);
    expect(sent.type).toBe('connected');
    expect(sent.data.activeAgents).toHaveLength(2);
    expect(sent.data.activeAgents[0].agentId).toBe('a1');
  });

  it('does not send initial message if ws is not OPEN', () => {
    const ws = createMockWs(3); // CLOSED

    broadcaster.addClient(ws, []);

    expect(ws.send).not.toHaveBeenCalled();
  });

  it('returns false and closes ws when max clients reached', () => {
    // Add 50 clients (the default max)
    for (let i = 0; i < 50; i++) {
      const ws = createMockWs(1);
      expect(broadcaster.addClient(ws, [])).toBe(true);
    }

    // 51st should be rejected
    const rejected = createMockWs(1);
    expect(broadcaster.addClient(rejected, [])).toBe(false);
    expect(rejected.close).toHaveBeenCalledWith(1013, 'Max clients reached');
  });

  // ── removeClient ──

  it('removed client does not receive broadcasts', () => {
    const ws = createMockWs(1);
    broadcaster.addClient(ws, []);
    (ws.send as ReturnType<typeof vi.fn>).mockClear();

    broadcaster.removeClient(ws);
    broadcaster.broadcast(makeEvent());

    expect(ws.send).not.toHaveBeenCalled();
  });

  // ── broadcast ──

  it('sends event to all OPEN clients', () => {
    const ws1 = createMockWs(1);
    const ws2 = createMockWs(1);

    broadcaster.addClient(ws1, []);
    broadcaster.addClient(ws2, []);

    (ws1.send as ReturnType<typeof vi.fn>).mockClear();
    (ws2.send as ReturnType<typeof vi.fn>).mockClear();

    const event = makeEvent({ id: 'broadcast-1', type: 'tool_end' });
    broadcaster.broadcast(event);

    expect(ws1.send).toHaveBeenCalledTimes(1);
    expect(ws2.send).toHaveBeenCalledTimes(1);

    const parsed1 = JSON.parse((ws1.send as ReturnType<typeof vi.fn>).mock.calls[0][0]);
    expect(parsed1.type).toBe('event');
    expect(parsed1.data.id).toBe('broadcast-1');
  });

  it('skips clients that are not OPEN', () => {
    const wsOpen = createMockWs(1);
    const wsClosed = createMockWs(3);

    broadcaster.addClient(wsOpen, []);
    broadcaster.addClient(wsClosed, []);

    (wsOpen.send as ReturnType<typeof vi.fn>).mockClear();
    (wsClosed.send as ReturnType<typeof vi.fn>).mockClear();

    broadcaster.broadcast(makeEvent());

    expect(wsOpen.send).toHaveBeenCalledTimes(1);
    expect(wsClosed.send).not.toHaveBeenCalled();
  });

  it('skips clients with high bufferedAmount (backpressure)', () => {
    const ws = createMockWs(1);
    // Set bufferedAmount above threshold
    Object.defineProperty(ws, 'bufferedAmount', { value: 2_000_000 });

    broadcaster.addClient(ws, []);
    (ws.send as ReturnType<typeof vi.fn>).mockClear();

    broadcaster.broadcast(makeEvent());

    expect(ws.send).not.toHaveBeenCalled();
  });

  // ── broadcastText ──

  it('sends agent_text message to all OPEN clients', () => {
    const ws = createMockWs(1);
    broadcaster.addClient(ws, []);
    (ws.send as ReturnType<typeof vi.fn>).mockClear();

    broadcaster.broadcastText('agent-7', 'Hello world', false);

    expect(ws.send).toHaveBeenCalledTimes(1);
    const sent = JSON.parse((ws.send as ReturnType<typeof vi.fn>).mock.calls[0][0]);
    expect(sent.type).toBe('agent_text');
    expect(sent.data.agentId).toBe('agent-7');
    expect(sent.data.text).toBe('Hello world');
    expect(sent.data.isPartial).toBe(false);
  });

  // ── clientCount ──

  it('returns 0 when no clients are connected', () => {
    expect(broadcaster.clientCount).toBe(0);
  });

  it('returns the correct count after adding and removing clients', () => {
    const ws1 = createMockWs(1);
    const ws2 = createMockWs(1);
    const ws3 = createMockWs(1);

    broadcaster.addClient(ws1, []);
    broadcaster.addClient(ws2, []);
    broadcaster.addClient(ws3, []);
    expect(broadcaster.clientCount).toBe(3);

    broadcaster.removeClient(ws2);
    expect(broadcaster.clientCount).toBe(2);
  });
});
