// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Bernhard

import webpush from 'web-push';
import { analyticsQueryAll, analyticsExecute } from '../db.js';
import { logger } from '../lib/logger.js';

export interface PushPayload {
  title: string;
  body: string;
  requestId: string;
  /** Full absolute URL to the decision endpoint */
  decisionUrl: string;
  /** Full absolute URL to open the PWA */
  url: string;
}

interface PushSubscriptionRow {
  id: string;
  endpoint: string;
  keys_p256dh: string;
  keys_auth: string;
}

let enabled = false;

/** Call once at startup, after initDb(). Reads VAPID keys from env. */
export function initPush(): void {
  const publicKey = process.env.VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  const subject = process.env.VAPID_SUBJECT ?? 'mailto:dev@localhost';

  if (!publicKey || !privateKey) {
    logger.info('Push notifications disabled — VAPID keys not configured');
    enabled = false;
    return;
  }

  webpush.setVapidDetails(subject, publicKey, privateKey);
  enabled = true;
  logger.info('Push notifications enabled');
}

export function isEnabled(): boolean {
  return enabled;
}

export function getVapidPublicKey(): string | undefined {
  return process.env.VAPID_PUBLIC_KEY;
}

/**
 * Send push notification to all registered subscriptions.
 * Fire-and-forget: all errors are caught internally.
 * Auto-cleans 410/404 (expired) subscriptions from DB.
 */
export async function sendToAll(payload: PushPayload): Promise<void> {
  if (!enabled) return;

  const subs = analyticsQueryAll(
    'SELECT id, endpoint, keys_p256dh, keys_auth FROM push_subscriptions',
  ) as unknown as PushSubscriptionRow[];

  if (subs.length === 0) return;

  const body = JSON.stringify({
    title: payload.title,
    body: payload.body,
    data: {
      requestId: payload.requestId,
      decisionUrl: payload.decisionUrl,
      url: payload.url,
      actions: ['approve', 'deny'],
    },
  });

  const options: webpush.RequestOptions = {
    TTL: 3600,
    urgency: 'high' as const,
  };

  await Promise.allSettled(
    subs.map(async (sub) => {
      try {
        logger.info({ endpoint: sub.endpoint.slice(0, 80) }, 'Sending push notification');
        await webpush.sendNotification(
          {
            endpoint: sub.endpoint,
            keys: { p256dh: sub.keys_p256dh, auth: sub.keys_auth },
          },
          body,
          options,
        );
        logger.info({ endpoint: sub.endpoint.slice(0, 80) }, 'Push sent successfully');
      } catch (err: unknown) {
        const statusCode = (err as { statusCode?: number }).statusCode;
        if (statusCode === 410 || statusCode === 404) {
          analyticsExecute('DELETE FROM push_subscriptions WHERE id = ?', [sub.id]);
          logger.info({ endpoint: sub.endpoint }, 'Removed expired push subscription');
        } else {
          logger.warn({ err, endpoint: sub.endpoint }, 'Push send failed');
        }
      }
    }),
  );
}
