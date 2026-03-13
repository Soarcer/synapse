// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Bernhard

/** Format a dollar amount with plan-appropriate prefix */
export function formatCostDisplay(costUsd: number, isApiPlan: boolean): string {
  const formatted = `$${costUsd.toFixed(2)}`;
  return isApiPlan ? formatted : `≈${formatted}`;
}

/** Returns a summary string based on display mode */
export function formatStatLine(
  mode: 'consumption' | 'cost',
  tokens: number,
  costUsd: number,
  isApiPlan: boolean,
): string {
  if (mode === 'cost') return formatCostDisplay(costUsd, isApiPlan);
  return `${(tokens / 1000).toFixed(1)}k tokens`;
}
