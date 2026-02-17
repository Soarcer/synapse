import { analyticsQueryAll } from '../db.js';
import { getPrice } from './costService.js';
import { logger } from '../lib/logger.js';

// ─── Types ──────────────────────────────────────────────────────────

interface TurnData {
  sessionId: string;
  turnIndex: number;
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  thinkingTokens: number;
  toolCount: number;
  costUsd: number;
}

interface ModelAlternative {
  model: string;
  label: string;
  cost: number;
  savings: number;
  savingsPct: number;
}

interface SwitchingOpportunity {
  sessionId: string;
  turnIndex: number;
  currentModel: string;
  currentCost: number;
  suggestedModel: string;
  suggestedCost: number;
  savings: number;
  complexity: 'simple' | 'moderate' | 'complex';
  reason: string;
}

export interface ModelOptimizationResult {
  currentTotalCost: number;
  turnCount: number;
  alternatives: ModelAlternative[];
  topSwitchingOpportunities: SwitchingOpportunity[];
  summary: {
    simpleTurns: number;
    complexTurns: number;
    potentialSavings: number;
    potentialSavingsPct: number;
  };
}

// ─── Model Definitions ──────────────────────────────────────────────

const MODELS = [
  { id: 'claude-opus-4-6', label: 'Opus 4.6', inputPer1M: 15, outputPer1M: 75, cachedPer1M: 1.50 },
  { id: 'claude-sonnet-4-5', label: 'Sonnet 4.5', inputPer1M: 3, outputPer1M: 15, cachedPer1M: 0.30 },
  { id: 'claude-haiku-4-5', label: 'Haiku 4.5', inputPer1M: 1, outputPer1M: 5, cachedPer1M: 0.08 },
];

// ─── Turn Complexity Classification ─────────────────────────────────

function classifyTurnComplexity(turn: TurnData): 'simple' | 'moderate' | 'complex' {
  // Complex: many tools, thinking tokens, high output
  if (turn.thinkingTokens > 5000 || turn.toolCount > 5 || turn.outputTokens > 10000) return 'complex';
  // Simple: few or no tools, low output
  if (turn.toolCount <= 1 && turn.outputTokens < 2000 && turn.thinkingTokens === 0) return 'simple';
  return 'moderate';
}

function computeTurnCost(turn: TurnData, modelId: string): number {
  const model = MODELS.find((m) => m.id === modelId);
  if (!model) return 0;

  const freshInput = Math.max(0, turn.inputTokens - turn.cacheReadTokens);
  return (
    (freshInput / 1_000_000) * model.inputPer1M +
    (turn.cacheReadTokens / 1_000_000) * model.cachedPer1M +
    (turn.outputTokens / 1_000_000) * model.outputPer1M
  );
}

function suggestModel(complexity: 'simple' | 'moderate' | 'complex'): string {
  switch (complexity) {
    case 'simple': return 'claude-haiku-4-5';
    case 'moderate': return 'claude-sonnet-4-5';
    case 'complex': return 'claude-opus-4-6';
  }
}

function complexityReason(complexity: 'simple' | 'moderate' | 'complex', turn: TurnData): string {
  if (complexity === 'simple') {
    return `Low complexity: ${turn.toolCount} tools, ${turn.outputTokens} output tokens. Haiku would handle this efficiently.`;
  }
  if (complexity === 'complex') {
    const reasons: string[] = [];
    if (turn.thinkingTokens > 5000) reasons.push(`${turn.thinkingTokens} thinking tokens`);
    if (turn.toolCount > 5) reasons.push(`${turn.toolCount} tool calls`);
    if (turn.outputTokens > 10000) reasons.push(`${turn.outputTokens} output tokens`);
    return `High complexity: ${reasons.join(', ')}. Opus recommended for quality.`;
  }
  return `Moderate complexity: ${turn.toolCount} tools, ${turn.outputTokens} output tokens. Sonnet provides a good balance.`;
}

// ─── Main Computation ──────────────────────────────────────────────

export function computeModelOptimization(
  from: number,
  to: number,
  cwd?: string,
): ModelOptimizationResult {
  // Get turn-level data from transcripts
  const conditions = ['t.created_at >= ? AND t.created_at <= ?'];
  const params: unknown[] = [from, to];
  if (cwd) { conditions.push('t.cwd = ?'); params.push(cwd); }

  const rows = analyticsQueryAll(`
    SELECT
      t.session_id as sessionId,
      t.turn_index as turnIndex,
      t.model,
      t.input_tokens as inputTokens,
      t.output_tokens as outputTokens,
      COALESCE(t.cache_read_tokens, 0) as cacheReadTokens,
      COALESCE(t.thinking_tokens, 0) as thinkingTokens,
      COALESCE(t.tool_count, 0) as toolCount,
      COALESCE(t.cost_usd, 0) as costUsd
    FROM transcript_turns t
    WHERE ${conditions.join(' AND ')}
    ORDER BY t.created_at
    LIMIT 1000
  `, params) as unknown as TurnData[];

  if (rows.length === 0) {
    return {
      currentTotalCost: 0,
      turnCount: 0,
      alternatives: MODELS.map((m) => ({ model: m.id, label: m.label, cost: 0, savings: 0, savingsPct: 0 })),
      topSwitchingOpportunities: [],
      summary: { simpleTurns: 0, complexTurns: 0, potentialSavings: 0, potentialSavingsPct: 0 },
    };
  }

  const currentTotalCost = rows.reduce((s, r) => s + r.costUsd, 0);

  // Compute alternative costs
  const alternatives: ModelAlternative[] = MODELS.map((m) => {
    const cost = rows.reduce((s, r) => s + computeTurnCost(r, m.id), 0);
    return {
      model: m.id,
      label: m.label,
      cost,
      savings: currentTotalCost - cost,
      savingsPct: currentTotalCost > 0 ? ((currentTotalCost - cost) / currentTotalCost) * 100 : 0,
    };
  });

  // Classify turns and find switching opportunities
  let simpleTurns = 0;
  let complexTurns = 0;
  let potentialSavings = 0;

  const opportunities: SwitchingOpportunity[] = [];

  for (const turn of rows) {
    const complexity = classifyTurnComplexity(turn);
    if (complexity === 'simple') simpleTurns++;
    else if (complexity === 'complex') complexTurns++;

    const suggested = suggestModel(complexity);
    if (suggested !== turn.model) {
      const suggestedCost = computeTurnCost(turn, suggested);
      const savings = turn.costUsd - suggestedCost;
      if (savings > 0) {
        potentialSavings += savings;
        opportunities.push({
          sessionId: turn.sessionId,
          turnIndex: turn.turnIndex,
          currentModel: turn.model,
          currentCost: turn.costUsd,
          suggestedModel: suggested,
          suggestedCost,
          savings,
          complexity,
          reason: complexityReason(complexity, turn),
        });
      }
    }
  }

  // Sort by highest savings first
  opportunities.sort((a, b) => b.savings - a.savings);

  return {
    currentTotalCost,
    turnCount: rows.length,
    alternatives,
    topSwitchingOpportunities: opportunities.slice(0, 10),
    summary: {
      simpleTurns,
      complexTurns,
      potentialSavings,
      potentialSavingsPct: currentTotalCost > 0 ? (potentialSavings / currentTotalCost) * 100 : 0,
    },
  };
}
