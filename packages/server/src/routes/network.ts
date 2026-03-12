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
 * 8. Fallback: null (caller returns localhost with warning)
 *
 * Exported for unit testing without Express.
 */
export function selectLanIp(interfaces: NodeJS.Dict<os.NetworkInterfaceInfo[]>): string | null {
  const candidates: string[] = [];

  for (const ifaceList of Object.values(interfaces)) {
    if (!ifaceList) continue;
    for (const iface of ifaceList) {
      // IPv4 only
      if (iface.family !== 'IPv4' && (iface.family as unknown) !== 4) continue;
      // Exclude loopback
      if (iface.internal) continue;

      const addr = iface.address;
      // Exclude loopback range (redundant but explicit)
      if (addr.startsWith('127.')) continue;
      // Exclude Docker bridges (172.16.0.0 – 172.31.255.255)
      if (/^172\.(1[6-9]|2\d|3[01])\./.test(addr)) continue;
      // Exclude Tailscale (100.x.x.x)
      if (addr.startsWith('100.')) continue;
      // Exclude link-local (169.254.x.x)
      if (addr.startsWith('169.254.')) continue;

      candidates.push(addr);
    }
  }

  // Prefer 192.168.x or 10.x (typical home/office LAN)
  const preferred = candidates.find((a) => a.startsWith('192.168.') || a.startsWith('10.'));
  return preferred ?? candidates[0] ?? null;
}

export function createNetworkRouter(): Router {
  const router = Router();

  // GET /api/network/local-url
  // P1: accept ?dashboardPort query param for dev mode (Vite on 5173 vs server on 27246)
  router.get('/local-url', (req: Request, res: Response) => {
    const ip = selectLanIp(os.networkInterfaces());
    const serverPort = req.socket.localPort ?? 27246;
    const effectivePort = req.query.dashboardPort
      ? parseInt(req.query.dashboardPort as string, 10)
      : serverPort;

    if (ip) {
      res.json({
        ip,
        port: effectivePort,
        url: `http://${ip}:${effectivePort}`,
      });
    } else {
      res.json({
        ip: 'localhost',
        port: effectivePort,
        url: `http://localhost:${effectivePort}`,
        warning: 'No LAN interface detected',
      });
    }
  });

  return router;
}
