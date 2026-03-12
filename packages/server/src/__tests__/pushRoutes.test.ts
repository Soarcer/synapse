import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import express from 'express';
import { createPushRouter } from '../routes/push.js';

// Mock pushService
vi.mock('../services/pushService.js', () => ({
  getVapidPublicKey: vi.fn().mockReturnValue('test-vapid-public-key'),
  isEnabled: vi.fn().mockReturnValue(true),
  sendToAll: vi.fn().mockResolvedValue(undefined),
}));

// Mock db helpers
vi.mock('../db.js', () => ({
  analyticsExecute: vi.fn().mockReturnValue(1),
  analyticsQueryAll: vi.fn().mockReturnValue([]),
}));

vi.mock('../lib/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { analyticsExecute, analyticsQueryAll } from '../db.js';
import { getVapidPublicKey, isEnabled } from '../services/pushService.js';

function createTestApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/push', createPushRouter());
  return app;
}

describe('push routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('GET /api/push/vapid-key', () => {
    it('returns the VAPID public key and enabled status', async () => {
      const app = createTestApp();
      const res = await request(app).get('/api/push/vapid-key');
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ publicKey: 'test-vapid-public-key', enabled: true });
    });

    it('returns enabled: false when push is disabled', async () => {
      vi.mocked(isEnabled).mockReturnValue(false);
      vi.mocked(getVapidPublicKey).mockReturnValue(undefined);
      const app = createTestApp();
      const res = await request(app).get('/api/push/vapid-key');
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ publicKey: null, enabled: false });
    });
  });

  describe('POST /api/push/subscriptions', () => {
    const validSub = {
      endpoint: 'https://fcm.googleapis.com/fcm/send/abc123',
      keys: { p256dh: 'BNcRd...', auth: 'tB...' },
    };

    it('saves a valid subscription and returns 201', async () => {
      const app = createTestApp();
      const res = await request(app).post('/api/push/subscriptions').send(validSub);
      expect(res.status).toBe(201);
      expect(res.body).toEqual({ ok: true });
      expect(analyticsExecute).toHaveBeenCalled();
    });

    it('rejects invalid subscription (missing endpoint)', async () => {
      const app = createTestApp();
      const res = await request(app)
        .post('/api/push/subscriptions')
        .send({ keys: { p256dh: 'x', auth: 'y' } });
      expect(res.status).toBe(400);
    });

    it('rejects invalid subscription (missing keys)', async () => {
      const app = createTestApp();
      const res = await request(app)
        .post('/api/push/subscriptions')
        .send({ endpoint: 'https://example.com' });
      expect(res.status).toBe(400);
    });

    it('accepts optional userAgent', async () => {
      const app = createTestApp();
      const res = await request(app)
        .post('/api/push/subscriptions')
        .send({ ...validSub, userAgent: 'Chrome Android' });
      expect(res.status).toBe(201);
    });
  });

  describe('DELETE /api/push/subscriptions', () => {
    it('deletes subscription by endpoint in body', async () => {
      const app = createTestApp();
      const res = await request(app)
        .delete('/api/push/subscriptions')
        .send({ endpoint: 'https://fcm.googleapis.com/fcm/send/abc123' });
      expect(res.status).toBe(204);
      expect(analyticsExecute).toHaveBeenCalledWith(
        'DELETE FROM push_subscriptions WHERE endpoint = ?',
        ['https://fcm.googleapis.com/fcm/send/abc123'],
      );
    });

    it('rejects missing endpoint', async () => {
      const app = createTestApp();
      const res = await request(app).delete('/api/push/subscriptions').send({});
      expect(res.status).toBe(400);
    });
  });

  describe('GET /api/push/subscriptions', () => {
    it('returns list of subscriptions', async () => {
      vi.mocked(analyticsQueryAll).mockReturnValue([
        {
          id: 's1',
          endpoint: 'https://fcm.example.com/1',
          user_agent: 'Chrome Android',
          created_at: 1710000000000,
        },
      ]);
      const app = createTestApp();
      const res = await request(app).get('/api/push/subscriptions');
      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(1);
      expect(res.body[0]).toEqual({
        id: 's1',
        endpoint: 'https://fcm.example.com/1',
        userAgent: 'Chrome Android',
        createdAt: 1710000000000,
      });
    });
  });

  describe('POST /api/push/test', () => {
    it('sends a test notification via sendToAll', async () => {
      const { sendToAll } = await import('../services/pushService.js');
      const app = createTestApp();
      const res = await request(app).post('/api/push/test');
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ ok: true });
      expect(sendToAll).toHaveBeenCalledWith(
        expect.objectContaining({
          title: expect.stringContaining('Test'),
          requestId: 'test',
        }),
      );
    });
  });
});
