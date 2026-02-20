// ─── Rule Registry ───────────────────────────────────────────────────
// Imports all rules and provides a single registration function

import { registerRule } from '../nudgeEngine.js';
import type { NudgeRule } from '../nudgeEngine.js';

import { toolUsageRules } from './toolUsageRules.js';
import { planningRules } from './planningRules.js';
import { verificationRules } from './verificationRules.js';
import { gitRules } from './gitRules.js';
import { securityRules } from './securityRules.js';
import { efficiencyRules } from './efficiencyRules.js';
import { orchestrationRules } from './orchestrationRules.js';

// All rules organized by category
export const ALL_RULES: NudgeRule[] = [
  ...toolUsageRules,     // 7 rules
  ...planningRules,      // 5 rules
  ...verificationRules,  // 5 rules
  ...gitRules,           // 5 rules
  ...securityRules,      // 3 rules
  ...efficiencyRules,    // 3 rules
  ...orchestrationRules, // 2 rules
];                       // Total: 30 rules

/**
 * Register all nudge rules with the engine.
 * Call once at server startup.
 */
export function registerAllRules(): void {
  for (const rule of ALL_RULES) {
    registerRule(rule);
  }
}

export {
  toolUsageRules,
  planningRules,
  verificationRules,
  gitRules,
  securityRules,
  efficiencyRules,
  orchestrationRules,
};
