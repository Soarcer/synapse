// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Bernhard

/**
 * Feature flags for Synapse v0.1.0 launch.
 *
 * `as const` gives literal true/false types so Vite/Rollup can prove branches
 * are unreachable and tree-shake disabled features out of the bundle entirely.
 * A plain `boolean` variable would not get this treatment.
 */
export const Features = {
  // ── v0.1.0 — ships ─────────────────────────────────────────────────────────
  nodeGraph: true,
  lensTree: true,
  lensTreemap: true,
  lensCompaction: true,
  lensCostWaterfall: false,
  lensSankey: true,
  toolGrouping: true,
  guidedTour: true,
  snapshotExport: true,
  permissionCards: true,
  mobileView: true,
  cli: true,

  // ── roadmap — code exists, does not ship in v0.1.0 ─────────────────────────
  lensHeatmap: false,
  coaching: false,
  promptLab: false,
  analyticsDeep: false,
  costDisplayMode: false,
  remoteDevChat: false,
  pushNotifications: false,
  spawnAgent: false,
  multiVendor: false,
} as const;

export type FeatureName = keyof typeof Features;
