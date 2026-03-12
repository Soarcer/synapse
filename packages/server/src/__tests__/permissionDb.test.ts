import { describe, it, expect, beforeAll } from 'vitest';
import { initDb, analyticsExecute, analyticsQueryAll } from '../db.js';

process.env.SYNAPSE_DB_PATH = ':memory:';

beforeAll(async () => {
  await initDb();
});

describe('permission_events table', () => {
  it('can insert and query a permission event', () => {
    const id = 'perm-test-1';
    const now = Date.now();
    analyticsExecute(
      `INSERT INTO permission_events (id, session_id, tool_name, tool_input, behavior, latency_ms, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [id, 'sess-1', 'Bash', 'rm -rf build/', 'allow', 1234, now],
    );

    const rows = analyticsQueryAll('SELECT * FROM permission_events WHERE id = ?', [id]);
    expect(rows).toHaveLength(1);
    expect(rows[0].session_id).toBe('sess-1');
    expect(rows[0].tool_name).toBe('Bash');
    expect(rows[0].behavior).toBe('allow');
    expect(rows[0].latency_ms).toBe(1234);
  });
});

describe('push_subscriptions table', () => {
  it('can insert and query a push subscription', () => {
    const id = 'push-test-1';
    const now = Date.now();
    analyticsExecute(
      `INSERT INTO push_subscriptions (id, endpoint, keys_p256dh, keys_auth, user_agent, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [id, 'https://fcm.googleapis.com/fcm/send/abc', 'p256dh-key', 'auth-key', 'Chrome/120', now],
    );

    const rows = analyticsQueryAll('SELECT * FROM push_subscriptions WHERE id = ?', [id]);
    expect(rows).toHaveLength(1);
    expect(rows[0].endpoint).toBe('https://fcm.googleapis.com/fcm/send/abc');
  });
});
