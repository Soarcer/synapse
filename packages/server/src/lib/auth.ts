import { timingSafeEqual } from 'crypto';
import type { Request, Response, NextFunction } from 'express';

// Fail-open by design for local dev. Set SYNAPSE_API_KEY env var for production.
export function apiKeyAuth(req: Request, res: Response, next: NextFunction) {
  const key = process.env.SYNAPSE_API_KEY;
  if (!key) return next(); // No auth configured = allow all
  const provided = req.headers.authorization?.replace('Bearer ', '') ?? '';
  const a = Buffer.from(provided);
  const b = Buffer.from(key);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }
  next();
}
