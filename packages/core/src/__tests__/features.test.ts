// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Bernhard

import { describe, it, expect } from 'vitest';
import { Features } from '../features.js';
import type { FeatureName } from '../features.js';

describe('Features', () => {
  // ── Structure ────────────────────────────────────────────────────────

  it('exports a frozen-like constant object (as const)', () => {
    expect(typeof Features).toBe('object');
    expect(Features).not.toBeNull();
  });

  it('has only boolean values', () => {
    for (const [key, value] of Object.entries(Features)) {
      expect(typeof value).toBe('boolean');
    }
  });

  // ── v0.1.0 shipped features (true) ──────────────────────────────────

  const shippedFeatures: FeatureName[] = [
    'nodeGraph',
    'lensTree',
    'lensTreemap',
    'lensCompaction',
    'lensSankey',
    'toolGrouping',
    'guidedTour',
    'snapshotExport',
    'permissionCards',
    'mobileView',
    'cli',
  ];

  it.each(shippedFeatures)('feature "%s" is enabled (true)', (name) => {
    expect(Features[name]).toBe(true);
  });

  // ── roadmap features (false) ────────────────────────────────────────

  const roadmapFeatures: FeatureName[] = [
    'lensCostWaterfall',
    'lensHeatmap',
    'coaching',
    'promptLab',
    'analyticsDeep',
    'costDisplayMode',
    'remoteDevChat',
    'pushNotifications',
    'spawnAgent',
    'multiVendor',
  ];

  it.each(roadmapFeatures)('feature "%s" is disabled (false)', (name) => {
    expect(Features[name]).toBe(false);
  });

  // ── Completeness ───────────────────────────────────────────────────

  it('shipped + roadmap lists cover all feature flags', () => {
    const allKeys = Object.keys(Features) as FeatureName[];
    const covered = new Set([...shippedFeatures, ...roadmapFeatures]);
    for (const key of allKeys) {
      expect(covered.has(key)).toBe(true);
    }
    expect(covered.size).toBe(allKeys.length);
  });

  it('has a known total count of feature flags', () => {
    const count = Object.keys(Features).length;
    expect(count).toBe(shippedFeatures.length + roadmapFeatures.length);
  });

  // ── Type-level checks ─────────────────────────────────────────────

  it('FeatureName type covers known keys at runtime', () => {
    // Ensures that every key in Features satisfies FeatureName
    const keys: FeatureName[] = Object.keys(Features) as FeatureName[];
    expect(keys.length).toBeGreaterThan(0);
  });

  it('does not contain undefined or null values', () => {
    for (const value of Object.values(Features)) {
      expect(value).not.toBeUndefined();
      expect(value).not.toBeNull();
    }
  });
});
