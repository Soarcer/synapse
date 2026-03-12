// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Bernhard

import { Router, type Request, type Response } from 'express';
import os from 'os';

/**
 * LAN IP selection heuristic (Decision 12 from spec):
 * 1. IPv4 only
 * 2. Exclude loopback (127.x) — handled by addr.internal
 * 3. Exclude Docker bridges (172.17–172.31)
 * 4. Exclude Tailscale (100.x)
 * 5. Exclude link-local (169.254.x)
 * 6. Prefer 192.168.x or 10.x
 * 7. First match wins
 * 8. Fallback: localhost with warning
 */
function detectLanIp(): { ip: string; warning?: string } {
  const interfaces = os.networkInterfaces();
  const candidates: string[] = [];

  for (const addrs of Object.values(interfaces)) {
    if (!addrs) continue;
    for (const addr of addrs) {
      if (addr.family !== 'IPv4' && (addr.family as unknown) !== 4) continue;
      if (addr.internal) continue; // loopback

      const ip = addr.address;
      // Exclude Docker bridges (172.16.0.0 – 172.31.255.255)
      if (/^172\.(1[6-9]|2\d|3[01])\./.test(ip)) continue;
      // Exclude Tailscale (100.x.x.x)
      if (ip.startsWith('100.')) continue;
      // Exclude link-local (169.254.x.x)
      if (ip.startsWith('169.254.')) continue;

      candidates.push(ip);
    }
  }

  // Prefer 192.168.x or 10.x
  const preferred = candidates.find((ip) => ip.startsWith('192.168.') || ip.startsWith('10.'));

  if (preferred) return { ip: preferred };
  if (candidates.length > 0) return { ip: candidates[0] };
  return { ip: 'localhost', warning: 'No LAN interface detected' };
}

export function createNetworkRouter(): Router {
  const router = Router();

  router.get('/local-url', (req: Request, res: Response) => {
    const { ip, warning } = detectLanIp();
    const port = req.socket.localPort ?? 27246;
    const url = `http://${ip}:${port}`;
    res.json({ ip, port, url, ...(warning ? { warning } : {}) });
  });

  return router;
}
