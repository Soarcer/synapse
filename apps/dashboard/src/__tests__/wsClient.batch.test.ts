// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import type { WsServerMessage } from '@synapse-ai/core';
import { createEventBatcher } from '../store/wsClient';

describe('WS event batching', () => {
  it('batches multiple synchronous events into a single callback', async () => {
    const batchHandler = vi.fn();
    const { batchEvent } = createEventBatcher(batchHandler);

    batchEvent({ type: 'event', data: { id: '1' } } as unknown as WsServerMessage);
    batchEvent({ type: 'event', data: { id: '2' } } as unknown as WsServerMessage);
    batchEvent({ type: 'event', data: { id: '3' } } as unknown as WsServerMessage);

    // Not yet called — queued for microtask
    expect(batchHandler).not.toHaveBeenCalled();

    // Wait for microtask to drain
    await Promise.resolve();
    await Promise.resolve();

    expect(batchHandler).toHaveBeenCalledTimes(1);
    expect(batchHandler).toHaveBeenCalledWith([
      expect.objectContaining({ data: expect.objectContaining({ id: '1' }) }),
      expect.objectContaining({ data: expect.objectContaining({ id: '2' }) }),
      expect.objectContaining({ data: expect.objectContaining({ id: '3' }) }),
    ]);
  });

  it('processes separate batches for events in different microtasks', async () => {
    const batchHandler = vi.fn();
    const { batchEvent } = createEventBatcher(batchHandler);

    batchEvent({ type: 'event', data: { id: '1' } } as unknown as WsServerMessage);
    await Promise.resolve();
    await Promise.resolve();

    batchEvent({ type: 'event', data: { id: '2' } } as unknown as WsServerMessage);
    await Promise.resolve();
    await Promise.resolve();

    expect(batchHandler).toHaveBeenCalledTimes(2);
  });

  it('bypasses batching for immediate types (agent_text, permission, connected)', async () => {
    const batchHandler = vi.fn();
    const immediateHandler = vi.fn();
    const { batchEvent } = createEventBatcher(batchHandler, immediateHandler);

    batchEvent({
      type: 'agent_text',
      data: { agentId: 'a', text: 'hi', isPartial: true },
    } as WsServerMessage);
    batchEvent({
      type: 'pendingPermission',
      data: { id: 'p1', tool_name: 'Bash' },
    } as unknown as WsServerMessage);
    batchEvent({
      type: 'permissionResolved',
      data: { id: 'p1', behavior: 'allow' },
    } as WsServerMessage);
    batchEvent({ type: 'connected', data: { activeAgents: [] } } as WsServerMessage);
    batchEvent({ type: 'stale', data: {} } as WsServerMessage);

    // All immediate types fire right away
    expect(immediateHandler).toHaveBeenCalledTimes(5);
    expect(batchHandler).not.toHaveBeenCalled();

    await Promise.resolve();
    await Promise.resolve();

    // Still no batch call — nothing was queued
    expect(batchHandler).not.toHaveBeenCalled();
  });

  it('batches only event type messages', async () => {
    const batchHandler = vi.fn();
    const immediateHandler = vi.fn();
    const { batchEvent } = createEventBatcher(batchHandler, immediateHandler);

    // Mix of batched and immediate
    batchEvent({ type: 'event', data: { id: '1' } } as unknown as WsServerMessage);
    batchEvent({
      type: 'agent_text',
      data: { agentId: 'a', text: 'hi', isPartial: true },
    } as WsServerMessage);
    batchEvent({ type: 'event', data: { id: '2' } } as unknown as WsServerMessage);

    expect(immediateHandler).toHaveBeenCalledTimes(1);

    await Promise.resolve();
    await Promise.resolve();

    expect(batchHandler).toHaveBeenCalledTimes(1);
    expect(batchHandler).toHaveBeenCalledWith([
      expect.objectContaining({ data: expect.objectContaining({ id: '1' }) }),
      expect.objectContaining({ data: expect.objectContaining({ id: '2' }) }),
    ]);
  });
});
