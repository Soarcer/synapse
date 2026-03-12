import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { initDb } from '../db.js';

process.env.SYNAPSE_DB_PATH = ':memory:';

let app: Express;

beforeAll(async () => {
  await initDb();
  const { Broadcaster } = await import('../services/broadcaster.js');
  const { AgentManager } = await import('../services/agentManager.js');
  const { createApp } = await import('../app.js');
  app = createApp({
    broadcaster: new Broadcaster(),
    agentManager: new AgentManager(),
    disableRateLimiting: true,
  });
});

describe('GET /api/network/local-url', () => {
  it('returns a url and ip field', async () => {
    const res = await request(app).get('/api/network/local-url');
    expect(res.status).toBe(200);
    expect(res.body.ip).toBeDefined();
    expect(res.body.url).toBeDefined();
    expect(typeof res.body.url).toBe('string');
  });

  it('url contains port', async () => {
    const res = await request(app).get('/api/network/local-url');
    expect(res.body.url).toMatch(/:\d+/);
  });
});
