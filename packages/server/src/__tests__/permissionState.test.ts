import { describe, it, expect, beforeEach } from 'vitest';

import {
  pending,
  decisions,
  MAX_PENDING,
  PERMISSION_TIMEOUT_MS,
  purgeExpiredDecisions,
} from '../state/permissionState.js';

describe('permissionState', () => {
  beforeEach(() => {
    pending.clear();
    decisions.clear();
  });

  it('exports empty Maps and constants', () => {
    expect(pending.size).toBe(0);
    expect(decisions.size).toBe(0);
    expect(MAX_PENDING).toBe(50);
    expect(PERMISSION_TIMEOUT_MS).toBeGreaterThan(0);
  });

  it('PERMISSION_TIMEOUT_MS defaults to 1800000 (30 min)', () => {
    expect(PERMISSION_TIMEOUT_MS).toBe(1800000);
  });

  it('purgeExpiredDecisions removes expired entries', () => {
    decisions.set('old', { behavior: 'allow', expiresAt: Date.now() - 1000 });
    decisions.set('fresh', { behavior: 'deny', expiresAt: Date.now() + 60000 });
    purgeExpiredDecisions();
    expect(decisions.has('old')).toBe(false);
    expect(decisions.has('fresh')).toBe(true);
  });

  it('purgeExpiredDecisions is a no-op on empty map', () => {
    purgeExpiredDecisions();
    expect(decisions.size).toBe(0);
  });
});
