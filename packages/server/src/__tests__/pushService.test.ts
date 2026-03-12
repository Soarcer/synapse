import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock web-push before importing pushService
vi.mock('web-push', () => ({
  default: {
    setVapidDetails: vi.fn(),
    sendNotification: vi.fn().mockResolvedValue({}),
  },
}));

// Mock db helpers
vi.mock('../db.js', () => ({
  analyticsQueryAll: vi.fn().mockReturnValue([]),
  analyticsExecute: vi.fn().mockReturnValue(1),
}));

vi.mock('../lib/logger.js', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

import webpush from 'web-push';
import { analyticsQueryAll, analyticsExecute } from '../db.js';
import { initPush, sendToAll, isEnabled, getVapidPublicKey } from '../services/pushService.js';

describe('pushService (real)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('initPush', () => {
    it('stays disabled when VAPID keys are missing', () => {
      delete process.env.VAPID_PUBLIC_KEY;
      delete process.env.VAPID_PRIVATE_KEY;
      initPush();
      expect(isEnabled()).toBe(false);
      expect(webpush.setVapidDetails).not.toHaveBeenCalled();
    });

    it('enables when VAPID keys are set', () => {
      process.env.VAPID_PUBLIC_KEY = 'test-public-key';
      process.env.VAPID_PRIVATE_KEY = 'test-private-key';
      process.env.VAPID_SUBJECT = 'mailto:test@test.com';
      initPush();
      expect(isEnabled()).toBe(true);
      expect(webpush.setVapidDetails).toHaveBeenCalledWith(
        'mailto:test@test.com',
        'test-public-key',
        'test-private-key',
      );
    });
  });

  describe('getVapidPublicKey', () => {
    it('returns the public key from env', () => {
      process.env.VAPID_PUBLIC_KEY = 'my-public-key';
      expect(getVapidPublicKey()).toBe('my-public-key');
    });
  });

  describe('sendToAll', () => {
    const payload = {
      title: 'Test',
      body: 'test body',
      requestId: 'req-1',
      decisionUrl: 'http://192.168.1.1:27246/api/permissions/req-1/decision',
      url: 'http://192.168.1.1:27246/',
    };

    it('returns immediately when disabled', async () => {
      delete process.env.VAPID_PUBLIC_KEY;
      delete process.env.VAPID_PRIVATE_KEY;
      initPush();
      await sendToAll(payload);
      expect(analyticsQueryAll).not.toHaveBeenCalled();
    });

    it('returns immediately when no subscriptions exist', async () => {
      process.env.VAPID_PUBLIC_KEY = 'pk';
      process.env.VAPID_PRIVATE_KEY = 'sk';
      initPush();
      vi.mocked(analyticsQueryAll).mockReturnValue([]);
      await sendToAll(payload);
      expect(webpush.sendNotification).not.toHaveBeenCalled();
    });

    it('sends notification to each subscription', async () => {
      process.env.VAPID_PUBLIC_KEY = 'pk';
      process.env.VAPID_PRIVATE_KEY = 'sk';
      initPush();
      vi.mocked(analyticsQueryAll).mockReturnValue([
        { id: 's1', endpoint: 'https://fcm.example.com/1', keys_p256dh: 'p1', keys_auth: 'a1' },
        { id: 's2', endpoint: 'https://fcm.example.com/2', keys_p256dh: 'p2', keys_auth: 'a2' },
      ]);
      await sendToAll(payload);
      expect(webpush.sendNotification).toHaveBeenCalledTimes(2);
    });

    it('deletes subscription on 410 Gone', async () => {
      process.env.VAPID_PUBLIC_KEY = 'pk';
      process.env.VAPID_PRIVATE_KEY = 'sk';
      initPush();
      vi.mocked(analyticsQueryAll).mockReturnValue([
        { id: 's1', endpoint: 'https://fcm.example.com/1', keys_p256dh: 'p1', keys_auth: 'a1' },
      ]);
      vi.mocked(webpush.sendNotification).mockRejectedValueOnce({ statusCode: 410 });
      await sendToAll(payload);
      expect(analyticsExecute).toHaveBeenCalledWith('DELETE FROM push_subscriptions WHERE id = ?', [
        's1',
      ]);
    });

    it('deletes subscription on 404', async () => {
      process.env.VAPID_PUBLIC_KEY = 'pk';
      process.env.VAPID_PRIVATE_KEY = 'sk';
      initPush();
      vi.mocked(analyticsQueryAll).mockReturnValue([
        { id: 's1', endpoint: 'https://fcm.example.com/1', keys_p256dh: 'p1', keys_auth: 'a1' },
      ]);
      vi.mocked(webpush.sendNotification).mockRejectedValueOnce({ statusCode: 404 });
      await sendToAll(payload);
      expect(analyticsExecute).toHaveBeenCalledWith('DELETE FROM push_subscriptions WHERE id = ?', [
        's1',
      ]);
    });

    it('logs warning on other errors without throwing', async () => {
      process.env.VAPID_PUBLIC_KEY = 'pk';
      process.env.VAPID_PRIVATE_KEY = 'sk';
      initPush();
      vi.mocked(analyticsQueryAll).mockReturnValue([
        { id: 's1', endpoint: 'https://fcm.example.com/1', keys_p256dh: 'p1', keys_auth: 'a1' },
      ]);
      vi.mocked(webpush.sendNotification).mockRejectedValueOnce({ statusCode: 500 });
      // Should not throw
      await expect(sendToAll(payload)).resolves.toBeUndefined();
    });
  });

  afterEach(() => {
    delete process.env.VAPID_PUBLIC_KEY;
    delete process.env.VAPID_PRIVATE_KEY;
    delete process.env.VAPID_SUBJECT;
    initPush(); // reset enabled=false with no env vars
  });
});
