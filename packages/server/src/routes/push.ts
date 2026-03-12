// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Bernhard

import { Router, type Request, type Response } from 'express';
import crypto from 'crypto';
import { z } from 'zod';
import { analyticsExecute, analyticsQueryAll } from '../db.js';
import { getVapidPublicKey, isEnabled, sendToAll } from '../services/pushService.js';
import { logger } from '../lib/logger.js';

const PushSubscriptionSchema = z.object({
  endpoint: z.string().url(),
  keys: z.object({
    p256dh: z.string().min(1),
    auth: z.string().min(1),
  }),
  userAgent: z.string().optional(),
});

const DeleteSubscriptionSchema = z.object({
  endpoint: z.string().url(),
});

export function createPushRouter(): Router {
  const router = Router();

  // GET /api/push/vapid-key
  router.get('/vapid-key', (_req: Request, res: Response) => {
    res.json({
      publicKey: getVapidPublicKey() ?? null,
      enabled: isEnabled(),
    });
  });

  // GET /api/push/subscriptions — list all (for settings UI device list)
  router.get('/subscriptions', (_req: Request, res: Response) => {
    const rows = analyticsQueryAll(
      'SELECT id, endpoint, user_agent, created_at FROM push_subscriptions ORDER BY created_at DESC',
    );
    res.json(
      rows.map((r) => ({
        id: r.id as string,
        endpoint: r.endpoint as string,
        userAgent: (r.user_agent as string) ?? null,
        createdAt: r.created_at as number,
      })),
    );
  });

  // POST /api/push/subscriptions — save/upsert subscription
  router.post('/subscriptions', (req: Request, res: Response) => {
    const parsed = PushSubscriptionSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid subscription', details: parsed.error.issues });
      return;
    }

    const { endpoint, keys, userAgent } = parsed.data;
    const id = crypto.randomUUID();

    analyticsExecute(
      `INSERT INTO push_subscriptions (id, endpoint, keys_p256dh, keys_auth, user_agent, created_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(endpoint) DO UPDATE SET
         keys_p256dh = excluded.keys_p256dh,
         keys_auth = excluded.keys_auth,
         user_agent = excluded.user_agent,
         created_at = excluded.created_at`,
      [id, endpoint, keys.p256dh, keys.auth, userAgent ?? null, Date.now()],
    );

    logger.info({ endpoint: endpoint.slice(0, 60) }, 'Push subscription saved');
    res.status(201).json({ ok: true });
  });

  // DELETE /api/push/subscriptions — remove by endpoint (in body, not URL path)
  router.delete('/subscriptions', (req: Request, res: Response) => {
    const parsed = DeleteSubscriptionSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Missing endpoint' });
      return;
    }

    analyticsExecute('DELETE FROM push_subscriptions WHERE endpoint = ?', [parsed.data.endpoint]);
    logger.info({ endpoint: parsed.data.endpoint.slice(0, 60) }, 'Push subscription removed');
    res.sendStatus(204);
  });

  // POST /api/push/test — send test notification to all subscriptions
  router.post('/test', async (_req: Request, res: Response) => {
    await sendToAll({
      title: '🔔 Synapse — Test notification',
      body: 'Push notifications are working!',
      requestId: 'test',
      decisionUrl: '',
      url: '/',
    }).catch((err) => logger.error({ err }, 'Test push failed'));
    res.json({ ok: true });
  });

  return router;
}
