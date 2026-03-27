// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Bernhard

import { Router, type Request, type Response } from 'express';
import { logger } from '../lib/logger.js';
import {
  getPublicSettings,
  setSettingValue,
  removeSettingValue,
  SETTINGS_KEYS,
  resolveApiKey,
} from '../services/settingsService.js';
import { getStatus } from '../services/aiCoachService.js';

export function createSettingsRouter(): Router {
  const router = Router();

  // GET /api/settings — return all settings (API key masked)
  router.get('/', (_req: Request, res: Response) => {
    try {
      const settings = getPublicSettings();
      res.json({ data: settings });
    } catch (err: unknown) {
      logger.error({ err }, 'Error fetching settings');
      res.status(500).json({ error: 'Failed to fetch settings' });
    }
  });

  // PUT /api/settings — update settings
  router.put('/', (req: Request, res: Response) => {
    try {
      const body = req.body as Record<string, string>;
      if (!body || typeof body !== 'object') {
        res.status(400).json({ error: 'Request body must be an object' });
        return;
      }

      const allowedKeys: Set<string> = new Set(Object.values(SETTINGS_KEYS));
      const updated: string[] = [];

      for (const [key, value] of Object.entries(body)) {
        if (!allowedKeys.has(key)) continue;
        if (typeof value !== 'string') continue;
        if (value.length > 10_000) continue; // reject oversized values

        if (value === '') {
          removeSettingValue(key);
        } else {
          setSettingValue(key, value);
        }
        updated.push(key);
      }

      res.json({ ok: true, updated });
    } catch (err: unknown) {
      logger.error({ err }, 'Error updating settings');
      res.status(500).json({ error: 'Failed to update settings' });
    }
  });

  // GET /api/settings/ai-status — health check for AI coaching
  router.get('/ai-status', (_req: Request, res: Response) => {
    try {
      const status = getStatus();
      res.json({ data: status });
    } catch (err: unknown) {
      logger.error({ err }, 'Error checking AI status');
      res.status(500).json({ error: 'Failed to check AI status' });
    }
  });

  // POST /api/settings/test-connection — test the API key
  router.post('/test-connection', async (_req: Request, res: Response) => {
    try {
      const status = getStatus();
      if (!status.available) {
        res.json({ ok: false, error: 'No API key configured' });
        return;
      }

      // Try a minimal API call to verify the key works
      const { key: realKey } = resolveApiKey();
      if (!realKey) {
        res.json({ ok: false, error: 'No API key available for test' });
        return;
      }
      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': realKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: status.model,
          max_tokens: 1,
          messages: [{ role: 'user', content: 'Hi' }],
        }),
      });

      if (response.ok || response.status === 200) {
        res.json({ ok: true, model: status.model });
      } else {
        const errorText = await response.text();
        res.json({
          ok: false,
          error: `API returned ${response.status}`,
          details: errorText.slice(0, 200),
        });
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      res.json({ ok: false, error: message });
    }
  });

  return router;
}
