// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Bernhard

// Set DB path BEFORE any server imports to use an in-memory test database
import path from 'path';
import os from 'os';

process.env.SYNAPSE_DB_PATH = path.join(
  os.tmpdir(),
  'synapse-test-plandetector-' + Date.now() + '.db',
);

import { describe, it, expect, beforeAll } from 'vitest';
import { initDb } from '../db.js';
import { detectPlan, setPlan, getPlanLabels, getPlanLimits } from '../services/planDetector.js';

beforeAll(async () => {
  await initDb();
});

// Clear the manual override between tests by calling setPlan then resetting,
// or use the DB path trick to get a fresh DB per test file.

describe('planDetector', () => {
  describe('detectPlan', () => {
    it('returns a valid plan object with required fields', () => {
      const plan = detectPlan();
      expect(plan).toHaveProperty('plan');
      expect(plan).toHaveProperty('monthlyLimit');
      expect(plan).toHaveProperty('detected');
      expect(plan).toHaveProperty('source');
    });

    it('plan field is a known plan name', () => {
      const plan = detectPlan();
      const validPlans = ['free', 'pro', 'max_5x', 'max_20x', 'team', 'api'];
      expect(validPlans).toContain(plan.plan);
    });

    it('source is either auto or manual', () => {
      const plan = detectPlan();
      expect(['auto', 'manual']).toContain(plan.source);
    });

    it('monthlyLimit is a number or null', () => {
      const plan = detectPlan();
      expect(plan.monthlyLimit === null || typeof plan.monthlyLimit === 'number').toBe(true);
    });
  });

  describe('setPlan', () => {
    it('throws on unknown plan name', () => {
      expect(() => setPlan('invalid_plan')).toThrow('Unknown plan');
    });

    it('throws for empty string', () => {
      expect(() => setPlan('')).toThrow('Unknown plan');
    });

    it('sets pro plan with correct monthly limit', () => {
      const plan = setPlan('pro');
      expect(plan.plan).toBe('pro');
      expect(plan.monthlyLimit).toBe(20);
      expect(plan.source).toBe('manual');
      expect(plan.detected).toBe(true);
    });

    it('sets api plan with null monthly limit', () => {
      const plan = setPlan('api');
      expect(plan.plan).toBe('api');
      expect(plan.monthlyLimit).toBeNull();
      expect(plan.source).toBe('manual');
    });

    it('sets max_5x plan with correct monthly limit', () => {
      const plan = setPlan('max_5x');
      expect(plan.monthlyLimit).toBe(100);
    });

    it('sets max_20x plan with correct monthly limit', () => {
      const plan = setPlan('max_20x');
      expect(plan.monthlyLimit).toBe(200);
    });

    it('sets free plan with zero monthly limit', () => {
      const plan = setPlan('free');
      expect(plan.monthlyLimit).toBe(0);
    });

    it('sets team plan with correct monthly limit', () => {
      const plan = setPlan('team');
      expect(plan.monthlyLimit).toBe(30);
    });

    it('returns ClaudePlan shape after setting', () => {
      const plan = setPlan('pro');
      expect(plan).toMatchObject({
        plan: 'pro',
        monthlyLimit: 20,
        detected: true,
        source: 'manual',
      });
    });

    it('detectPlan reflects the manual override after setPlan', () => {
      setPlan('api');
      const detected = detectPlan();
      expect(detected.plan).toBe('api');
      expect(detected.monthlyLimit).toBeNull();
      expect(detected.source).toBe('manual');
    });
  });

  describe('getPlanLabels', () => {
    it('returns labels for all known plans', () => {
      const labels = getPlanLabels();
      expect(labels).toHaveProperty('pro');
      expect(labels).toHaveProperty('api');
      expect(labels).toHaveProperty('max_5x');
      expect(labels).toHaveProperty('max_20x');
      expect(labels).toHaveProperty('free');
      expect(labels).toHaveProperty('team');
    });

    it('returns a copy (mutation does not affect subsequent calls)', () => {
      const labels1 = getPlanLabels();
      labels1['pro'] = 'mutated';
      const labels2 = getPlanLabels();
      expect(labels2['pro']).not.toBe('mutated');
    });

    it('all label values are non-empty strings', () => {
      const labels = getPlanLabels();
      for (const [, label] of Object.entries(labels)) {
        expect(typeof label).toBe('string');
        expect(label.length).toBeGreaterThan(0);
      }
    });
  });

  describe('getPlanLimits', () => {
    it('returns correct limit for pro ($20/mo)', () => {
      const limits = getPlanLimits();
      expect(limits.pro).toBe(20);
    });

    it('returns null for API plan (pay-as-you-go)', () => {
      const limits = getPlanLimits();
      expect(limits.api).toBeNull();
    });

    it('returns correct limit for max_20x ($200/mo)', () => {
      const limits = getPlanLimits();
      expect(limits.max_20x).toBe(200);
    });

    it('returns correct limit for max_5x ($100/mo)', () => {
      const limits = getPlanLimits();
      expect(limits.max_5x).toBe(100);
    });

    it('returns zero for free plan', () => {
      const limits = getPlanLimits();
      expect(limits.free).toBe(0);
    });

    it('returns a copy (mutation does not affect subsequent calls)', () => {
      const limits1 = getPlanLimits();
      (limits1 as Record<string, number | null>)['pro'] = 999;
      const limits2 = getPlanLimits();
      expect(limits2.pro).toBe(20);
    });
  });
});
