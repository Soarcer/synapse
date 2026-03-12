import { describe, it, expect } from 'vitest';
import { sendToAll } from '../services/pushService.js';

describe('pushService (stub)', () => {
  it('sendToAll resolves without error', async () => {
    await expect(
      sendToAll({
        title: 'Test',
        body: 'test body',
        requestId: 'req-1',
        url: '/',
      }),
    ).resolves.toBeUndefined();
  });

  it('sendToAll can be called multiple times', async () => {
    await sendToAll({ title: 'A', body: '', requestId: '1', url: '/' });
    await sendToAll({ title: 'B', body: '', requestId: '2', url: '/' });
    // No throw = pass
  });
});
