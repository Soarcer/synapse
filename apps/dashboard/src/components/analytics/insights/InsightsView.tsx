import { useState, useEffect, useMemo, useCallback } from 'react';
import { useCoachingData } from '../coaching/useCoachingData';
import { ReportCardPanel } from '../coaching/ReportCardPanel';
import { PlaybookPanel } from '../coaching/PlaybookPanel';
import type { MockData, MockSession } from '../mockData';

interface InsightsViewProps {
  data: MockData;
  sessions: MockSession[];
}

// ─── Types ──────────────────────────────────────────────────────────

type Severity = 'critical' | 'warning' | 'success' | 'info';
type Category = 'cost' | 'efficiency' | 'prompts' | 'models' | 'tools' | 'patterns';

interface Insight {
  id: string;
  category: Category;
  severity: Severity;
  title: string;
  description: string;
  coaching: string;
  metric?: string;
  impact?: string;
}

// ─── Severity styling ───────────────────────────────────────────────

const SEVERITY_STYLES: Record<Severity, { bg: string; border: string; icon: string; text: string }> = {
  critical: { bg: 'bg-red-500/10', border: 'border-red-500/30', icon: '\uD83D\uDEA8', text: 'text-red-400' },
  warning: { bg: 'bg-amber-500/10', border: 'border-amber-500/30', icon: '\u26A0\uFE0F', text: 'text-amber-400' },
  success: { bg: 'bg-emerald-500/10', border: 'border-emerald-500/30', icon: '\u2705', text: 'text-emerald-400' },
  info: { bg: 'bg-blue-500/10', border: 'border-blue-500/30', icon: '\u2139\uFE0F', text: 'text-blue-400' },
};

const CATEGORY_LABELS: Record<Category, string> = {
  cost: 'Cost Optimization',
  efficiency: 'Efficiency',
  prompts: 'Prompt Engineering',
  models: 'Model Selection',
  tools: 'Tool Usage',
  patterns: 'Usage Patterns',
};

const CATEGORY_ICONS: Record<Category, string> = {
  cost: '\uD83D\uDCB0',
  efficiency: '\u26A1',
  prompts: '\uD83D\uDCDD',
  models: '\uD83E\uDDEA',
  tools: '\uD83D\uDD27',
  patterns: '\uD83D\uDCC8',
};

const MODEL_LABELS: Record<string, string> = {
  'claude-opus-4-6': 'Opus 4.6',
  'claude-sonnet-4-5': 'Sonnet 4.5',
  'claude-haiku-4-5': 'Haiku 4.5',
};

// ─── Model Pricing (from WhatIfCalculator) ──────────────────────────

const MODEL_PRICING = [
  { id: 'claude-opus-4-6', name: 'Opus 4.6', inputPer1M: 15, cachedPer1M: 1.5, outputPer1M: 75 },
  { id: 'claude-sonnet-4-5', name: 'Sonnet 4.5', inputPer1M: 3, cachedPer1M: 0.3, outputPer1M: 15 },
  { id: 'claude-haiku-4-5', name: 'Haiku 4.5', inputPer1M: 0.8, cachedPer1M: 0.08, outputPer1M: 4 },
];

// ─── Insight Generator ──────────────────────────────────────────────

function generateInsights(data: MockData): Insight[] {
  const insights: Insight[] = [];
  if (data.sessions.length === 0) return insights;

  const totalCost = data.sessions.reduce((s, sess) => s + sess.totalCost, 0);
  const totalSessions = data.sessions.length;
  const totalTurns = data.turns.length;
  const totalInputTokens = data.sessions.reduce((s, sess) => s + sess.totalInputTokens, 0);
  const totalCacheRead = data.sessions.reduce((s, sess) => s + sess.totalCacheReadTokens, 0);
  const cacheHitRate = totalInputTokens > 0 ? totalCacheRead / totalInputTokens : 0;
  const avgCostPerTurn = totalTurns > 0 ? totalCost / totalTurns : 0;

  // ── Model usage analysis ──
  const modelUsage = new Map<string, { sessions: number; cost: number; turns: number; tokens: number }>();
  for (const s of data.sessions) {
    const entry = modelUsage.get(s.model) ?? { sessions: 0, cost: 0, turns: 0, tokens: 0 };
    entry.sessions++;
    entry.cost += s.totalCost;
    entry.turns += s.promptCount;
    entry.tokens += s.totalInputTokens + s.totalOutputTokens;
    modelUsage.set(s.model, entry);
  }

  const opusUsage = modelUsage.get('claude-opus-4-6');
  const haikuUsage = modelUsage.get('claude-haiku-4-5');

  if (opusUsage && opusUsage.cost > totalCost * 0.5) {
    const opusPct = Math.round((opusUsage.cost / totalCost) * 100);
    const potentialSavings = opusUsage.cost * 0.8;
    insights.push({
      id: 'model-opus-heavy',
      category: 'models',
      severity: 'warning',
      title: `Opus accounts for ${opusPct}% of your spend`,
      description: `${opusUsage.sessions} sessions used Opus 4.6, costing $${opusUsage.cost.toFixed(2)}. Opus is 5x more expensive than Sonnet per token.`,
      coaching: `Review your Opus sessions. Many coding tasks (refactoring, tests, simple features) perform equally well on Sonnet 4.5 at 1/5th the cost. Reserve Opus for complex multi-step reasoning, architectural decisions, and tasks where accuracy is critical. Potential savings: ~$${potentialSavings.toFixed(2)}.`,
      metric: `$${opusUsage.cost.toFixed(2)} on Opus`,
      impact: `Save ~$${potentialSavings.toFixed(2)}`,
    });
  }

  if (!haikuUsage || haikuUsage.sessions === 0) {
    insights.push({
      id: 'model-no-haiku',
      category: 'models',
      severity: 'info',
      title: 'Not using Haiku for lightweight tasks',
      description: 'Haiku 4.5 is unused. It costs $0.80/M input vs $3/M for Sonnet - nearly 4x cheaper.',
      coaching: 'Use Haiku for simple tasks: code formatting, generating boilerplate, writing tests for existing functions, documentation updates, and simple search/replace operations. In Claude Code, you can toggle fast mode with /fast to use Haiku.',
      metric: '0 Haiku sessions',
    });
  }

  if (modelUsage.size === 1) {
    const [onlyModel] = [...modelUsage.keys()];
    insights.push({
      id: 'model-single',
      category: 'models',
      severity: 'warning',
      title: `Only using ${MODEL_LABELS[onlyModel] ?? onlyModel}`,
      description: 'Using a single model for all tasks leaves money on the table.',
      coaching: 'Match model to task complexity: Use Opus for complex architecture and multi-file reasoning. Use Sonnet for feature development and debugging. Use Haiku for boilerplate, formatting, and simple edits. A typical optimal split: 10% Opus, 60% Sonnet, 30% Haiku.',
    });
  }

  // ── Cache efficiency analysis ──
  if (cacheHitRate < 0.3 && totalTurns > 5) {
    insights.push({
      id: 'cache-low',
      category: 'efficiency',
      severity: 'warning',
      title: `Low cache hit rate: ${Math.round(cacheHitRate * 100)}%`,
      description: `Only ${Math.round(cacheHitRate * 100)}% of input tokens came from cache. This means you're paying full price for most input tokens.`,
      coaching: 'Improve caching by: (1) Using consistent system prompts - Claude caches prompt prefixes that don\'t change between turns. (2) Avoiding unnecessary context resets - long sessions with stable context build up cache. (3) Structuring prompts so the stable part (instructions, constraints) comes first, and the variable part (user question) comes last.',
      metric: `${Math.round(cacheHitRate * 100)}% hit rate`,
      impact: `Could save ~$${((totalInputTokens * 0.5 - totalCacheRead) / 1_000_000 * 2.7).toFixed(2)} with 50% hit rate`,
    });
  } else if (cacheHitRate > 0.7) {
    insights.push({
      id: 'cache-great',
      category: 'efficiency',
      severity: 'success',
      title: `Excellent cache efficiency: ${Math.round(cacheHitRate * 100)}%`,
      description: `${Math.round(cacheHitRate * 100)}% cache hit rate is outstanding. You're saving significantly on input token costs.`,
      coaching: 'Keep up the consistent prompting patterns. Your system prompts and conversation structure are cache-friendly.',
      metric: `${Math.round(cacheHitRate * 100)}% hit rate`,
      impact: `Saving ~$${(totalCacheRead / 1_000_000 * 2.7).toFixed(2)} vs uncached`,
    });
  }

  // ── Cost analysis ──
  if (avgCostPerTurn > 0.50) {
    insights.push({
      id: 'cost-per-turn-high',
      category: 'cost',
      severity: 'warning',
      title: `High cost per turn: $${avgCostPerTurn.toFixed(3)}`,
      description: `Average $${avgCostPerTurn.toFixed(3)} per prompt/response cycle across ${totalTurns} turns.`,
      coaching: 'Reduce cost per turn by: (1) Breaking complex prompts into simpler sub-tasks that can use cheaper models. (2) Being specific in prompts to reduce unnecessary output. (3) Using "think step by step" only when truly needed - thinking tokens add to output cost. (4) Avoiding repeated file reads by asking Claude to remember content from earlier in the session.',
      metric: `$${avgCostPerTurn.toFixed(3)}/turn`,
    });
  }

  // Find expensive sessions (outliers)
  const avgSessionCost = totalSessions > 0 ? totalCost / totalSessions : 0;
  const expensiveSessions = data.sessions.filter((s) => s.totalCost > avgSessionCost * 2.5);
  if (expensiveSessions.length > 0 && totalSessions > 3) {
    const topSession = expensiveSessions.sort((a, b) => b.totalCost - a.totalCost)[0];
    insights.push({
      id: 'cost-outlier-sessions',
      category: 'cost',
      severity: 'warning',
      title: `${expensiveSessions.length} session${expensiveSessions.length > 1 ? 's' : ''} cost 2.5x+ average`,
      description: `Most expensive: "${topSession.name}" at $${topSession.totalCost.toFixed(2)} (avg: $${avgSessionCost.toFixed(2)}).`,
      coaching: 'Expensive sessions often result from: (1) Context growing too large - use /compact or start fresh sessions for unrelated tasks. (2) Letting Claude explore without clear constraints. (3) Iterating on the wrong approach - if something isn\'t working after 3-4 turns, step back and re-think the approach.',
      metric: `$${topSession.totalCost.toFixed(2)} top session`,
    });
  }

  // ── Prompt engineering analysis ──
  const turnsWithPrompt = data.turns.filter((t) => t.promptText && t.promptText.length > 0);
  const shortPrompts = turnsWithPrompt.filter((t) => t.promptText.split(/\s+/).length < 5);
  const longPrompts = turnsWithPrompt.filter((t) => t.promptText.split(/\s+/).length > 100);

  if (shortPrompts.length > turnsWithPrompt.length * 0.3 && turnsWithPrompt.length > 5) {
    insights.push({
      id: 'prompt-too-short',
      category: 'prompts',
      severity: 'warning',
      title: `${Math.round((shortPrompts.length / turnsWithPrompt.length) * 100)}% of prompts are very short (<5 words)`,
      description: 'Short prompts like "fix it", "continue", "looks good" lead to ambiguous responses and wasted tokens.',
      coaching: 'Be specific and explicit: Instead of "fix the bug", try "fix the TypeError in auth.ts:42 where user.email is undefined when the session expires". Include: (1) What file/function, (2) What the expected behavior is, (3) What constraint to follow. Specific prompts -> fewer back-and-forth turns -> lower total cost.',
      metric: `${shortPrompts.length}/${turnsWithPrompt.length} short prompts`,
    });
  }

  if (longPrompts.length > turnsWithPrompt.length * 0.2 && turnsWithPrompt.length > 5) {
    insights.push({
      id: 'prompt-too-long',
      category: 'prompts',
      severity: 'info',
      title: `${longPrompts.length} prompts exceed 100 words`,
      description: 'Very long prompts add to input token cost and may contain redundant context.',
      coaching: 'Long prompts often duplicate what\'s already in context. Instead of repeating file contents, reference them: "In the auth.ts file you read earlier, modify the login function to..." Claude already has the file in context from previous turns.',
      metric: `${longPrompts.length} long prompts`,
    });
  }

  // Prompt categories analysis
  const categories = new Map<string, number>();
  for (const t of turnsWithPrompt) {
    const cat = classifyPromptBasic(t.promptText);
    categories.set(cat, (categories.get(cat) ?? 0) + 1);
  }
  const debugCount = categories.get('debug') ?? 0;
  const fixCount = categories.get('bugfix') ?? 0;
  const featureCount = categories.get('feature') ?? 0;

  if ((debugCount + fixCount) > featureCount * 2 && (debugCount + fixCount) > 3) {
    insights.push({
      id: 'prompt-debug-heavy',
      category: 'prompts',
      severity: 'info',
      title: 'More debugging than building',
      description: `${debugCount + fixCount} debug/fix prompts vs ${featureCount} feature prompts. Spending more time fixing than building.`,
      coaching: 'High debug-to-feature ratio suggests: (1) Ask Claude to write tests BEFORE implementing features - test-first development catches bugs earlier and cheaper. (2) Include error messages and stack traces in prompts for faster resolution. (3) Consider having Claude review code at the end of each feature, not just when bugs appear.',
    });
  }

  // ── Tool usage analysis ──
  const toolCounts = new Map<string, number>();
  const toolErrors = new Map<string, number>();
  for (const tc of data.toolCalls) {
    toolCounts.set(tc.toolName, (toolCounts.get(tc.toolName) ?? 0) + 1);
    if (tc.status === 'error') {
      toolErrors.set(tc.toolName, (toolErrors.get(tc.toolName) ?? 0) + 1);
    }
  }

  for (const [tool, errors] of toolErrors) {
    const total = toolCounts.get(tool) ?? 0;
    const errorRate = total > 0 ? errors / total : 0;
    if (errorRate > 0.15 && errors > 3) {
      insights.push({
        id: `tool-errors-${tool}`,
        category: 'tools',
        severity: 'warning',
        title: `${tool}: ${Math.round(errorRate * 100)}% error rate`,
        description: `${errors}/${total} ${tool} calls failed. Retries waste tokens and time.`,
        coaching: tool === 'Bash'
          ? 'Bash errors often come from missing dependencies, wrong paths, or permission issues. Include environment context in your initial prompt: OS, working directory, installed tools.'
          : tool === 'Write' || tool === 'Edit'
            ? 'Write/Edit errors usually mean the file path is wrong or the content being replaced doesn\'t exist. Ask Claude to Read the file first before editing.'
            : `Reduce ${tool} errors by giving Claude more context about your project structure and constraints upfront.`,
        metric: `${errors}/${total} failed`,
      });
    }
  }

  // Read without Edit pattern
  const readCount = toolCounts.get('Read') ?? 0;
  const editCount = (toolCounts.get('Edit') ?? 0) + (toolCounts.get('Write') ?? 0);
  if (readCount > 50 && editCount < readCount * 0.1) {
    insights.push({
      id: 'tool-read-heavy',
      category: 'tools',
      severity: 'info',
      title: 'High Read-to-Edit ratio',
      description: `${readCount} file reads but only ${editCount} edits. Claude may be exploring excessively.`,
      coaching: 'If Claude is reading many files without editing, your prompt may be too vague. Be specific about which files need changes and what the expected outcome is. Use project CLAUDE.md to pre-document your architecture so Claude doesn\'t need to discover it from scratch each session.',
    });
  }

  // ── Session patterns ──
  const sessionsWithCompactions = data.sessions.filter((s) => s.compactions > 0);
  if (sessionsWithCompactions.length > totalSessions * 0.4 && totalSessions > 3) {
    const avgCompactions = sessionsWithCompactions.reduce((s, sess) => s + sess.compactions, 0) / sessionsWithCompactions.length;
    insights.push({
      id: 'pattern-compactions',
      category: 'patterns',
      severity: 'warning',
      title: `${sessionsWithCompactions.length}/${totalSessions} sessions hit context compaction`,
      description: `On average ${avgCompactions.toFixed(1)} compactions per session. Compaction loses context and increases cost.`,
      coaching: 'Reduce compactions by: (1) Starting new sessions for distinct tasks instead of one mega-session. (2) Using CLAUDE.md to capture decisions so they survive compaction. (3) Asking Claude to summarize progress before context gets too large. (4) Avoiding unnecessary file reads - once Claude has read a file, reference it by name.',
      metric: `${avgCompactions.toFixed(1)} avg compactions`,
    });
  }

  const shortSessions = data.sessions.filter((s) => s.promptCount < 3);
  if (shortSessions.length > totalSessions * 0.3 && totalSessions > 5) {
    insights.push({
      id: 'pattern-short-sessions',
      category: 'patterns',
      severity: 'info',
      title: `${shortSessions.length} sessions with <3 turns`,
      description: 'Many sessions end quickly, possibly indicating false starts or unclear goals.',
      coaching: 'Before starting a session, formulate your goal clearly. Instead of exploring in short bursts, plan your task: "I need to implement X in files Y and Z, following the pattern in file W." This reduces session churn and context setup cost.',
    });
  }

  // Sort: critical > warning > info > success
  const severityOrder: Record<Severity, number> = { critical: 0, warning: 1, info: 2, success: 3 };
  insights.sort((a, b) => severityOrder[a.severity] - severityOrder[b.severity]);

  return insights;
}

/** Split coaching text into individual points. Handles "(1) ... (2) ..." and "sentence. Sentence" patterns. */
function splitCoaching(text: string): string[] {
  // Try numbered format: (1) ... (2) ...
  const numbered = text.split(/\(\d+\)\s*/).filter(Boolean).map(s => s.trim());
  if (numbered.length > 1) return numbered;
  // Fall back to sentence splitting — split on ". " followed by a capital letter
  const sentences = text.split(/\.\s+(?=[A-Z])/).map(s => s.trim().replace(/\.$/, '')).filter(Boolean);
  return sentences.length > 1 ? sentences : [text];
}

function classifyPromptBasic(text: string): string {
  if (/\b(fix|bug|broken|error|crash|failing|not working)\b/i.test(text)) return 'bugfix';
  if (/\b(debug|log|trace|inspect|investigate|why)\b/i.test(text)) return 'debug';
  if (/\b(add|create|implement|build|new|introduce)\b/i.test(text)) return 'feature';
  if (/\b(refactor|rename|restructure|clean up|simplify)\b/i.test(text)) return 'refactor';
  if (/\b(test|spec|coverage|assert|mock)\b/i.test(text)) return 'test';
  return 'other';
}

// ─── Budget Status (API-backed with local fallback) ────────────

interface PlanInfo {
  plan: string;
  monthlyLimit: number | null;
  detected: boolean;
  source: 'auto' | 'manual';
}

interface BudgetStatus {
  daily: { spent: number; limit: number; pct: number };
  weekly: { spent: number; limit: number; pct: number };
  monthly: { spent: number; limit: number; pct: number };
  trend: 'rising' | 'stable' | 'falling';
  dailyAvg: number;
  projectedMonthly: number;
  plan?: PlanInfo;
}

const PLAN_LABELS: Record<string, string> = {
  free: 'Free',
  pro: 'Pro',
  max_5x: 'Max 5x',
  max_20x: 'Max 20x',
  team: 'Team',
  api: 'API',
};

function computeBudgetFallback(data: MockData): BudgetStatus {
  const now = Date.now();
  const DAY = 86_400_000;

  const last24h = data.sessions.filter((s) => s.startTime > now - DAY);
  const dailySpent = last24h.reduce((s, sess) => s + sess.totalCost, 0);

  const last7d = data.sessions.filter((s) => s.startTime > now - 7 * DAY);
  const weeklySpent = last7d.reduce((s, sess) => s + sess.totalCost, 0);

  const totalSpent = data.sessions.reduce((s, sess) => s + sess.totalCost, 0);

  const rollups = data.dailyRollups;
  let trend: 'rising' | 'stable' | 'falling' = 'stable';
  if (rollups.length >= 3) {
    const recentAvg = rollups.slice(-3).reduce((s, d) => s + d.totalCost, 0) / 3;
    const olderAvg = rollups.slice(0, Math.max(1, rollups.length - 3)).reduce((s, d) => s + d.totalCost, 0) / Math.max(1, rollups.length - 3);
    if (recentAvg > olderAvg * 1.3) trend = 'rising';
    else if (recentAvg < olderAvg * 0.7) trend = 'falling';
  }

  const activeDays = rollups.filter((d) => d.totalCost > 0).length || 1;
  const dailyAvg = totalSpent / activeDays;
  const projectedMonthly = dailyAvg * 22;

  return {
    daily: { spent: dailySpent, limit: 50, pct: dailySpent / 50 },
    weekly: { spent: weeklySpent, limit: 250, pct: weeklySpent / 250 },
    monthly: { spent: totalSpent, limit: 1000, pct: totalSpent / 1000 },
    trend,
    dailyAvg,
    projectedMonthly,
  };
}

function useBudgetData(fallbackData: MockData): { budget: BudgetStatus; setPlanOverride: (plan: string) => void } {
  const fallback = useMemo(() => computeBudgetFallback(fallbackData), [fallbackData]);
  const [budget, setBudget] = useState<BudgetStatus>(fallback);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/analytics/budget')
      .then((r) => r.json())
      .then((d) => {
        if (cancelled || !d.data) return;
        const api = d.data;
        // Normalize API response to our BudgetStatus shape
        setBudget({
          daily: {
            spent: api.daily?.spent ?? 0,
            limit: api.daily?.limit ?? 50,
            pct: api.daily?.percentUsed ?? 0,
          },
          weekly: {
            spent: api.weekly?.spent ?? 0,
            limit: api.weekly?.limit ?? 250,
            pct: api.weekly?.percentUsed ?? 0,
          },
          monthly: {
            spent: api.monthly?.spent ?? 0,
            limit: api.monthly?.limit ?? 1000,
            pct: api.monthly?.percentUsed ?? 0,
          },
          trend: api.forecast?.trend ?? 'stable',
          dailyAvg: api.forecast?.predictedDailyCost ?? 0,
          projectedMonthly: api.forecast?.predictedMonthlyCost ?? 0,
          plan: api.plan,
        });
      })
      .catch(() => {
        // Silently fall back to local computation
        setBudget(fallback);
      });
    return () => { cancelled = true; };
  }, [fallback]);

  const setPlanOverride = useCallback((plan: string) => {
    fetch('/api/analytics/budget/plan', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ plan }),
    })
      .then((r) => r.json())
      .then((d) => {
        if (d.data) {
          setBudget((prev) => ({ ...prev, plan: d.data }));
        }
      })
      .catch(() => {});
  }, []);

  return { budget, setPlanOverride };
}

// ─── Model Optimization Card ──────────────────────────────────

function computeModelOptimization(sessions: MockSession[]) {
  if (sessions.length === 0) return null;

  const currentCost = sessions.reduce((sum, s) => sum + s.totalCost, 0);
  const totalInput = sessions.reduce((sum, s) => sum + s.totalInputTokens, 0);
  const totalOutput = sessions.reduce((sum, s) => sum + s.totalOutputTokens, 0);
  const totalCacheRead = sessions.reduce((sum, s) => sum + s.totalCacheReadTokens, 0);

  // Compute hypothetical cost with each model
  const freshInput = Math.max(0, totalInput - totalCacheRead);
  const alternatives = MODEL_PRICING.map((m) => {
    const cost =
      (freshInput / 1_000_000) * m.inputPer1M +
      (totalCacheRead / 1_000_000) * m.cachedPer1M +
      (totalOutput / 1_000_000) * m.outputPer1M;
    return { ...m, cost, savings: currentCost - cost, savingsPct: currentCost > 0 ? ((currentCost - cost) / currentCost) * 100 : 0 };
  });

  const bestSaving = alternatives.filter((a) => a.savings > 0).sort((a, b) => b.savings - a.savings)[0];

  return { currentCost, alternatives, bestSaving };
}

// ─── Collapsible Section ──────────────────────────────────────

function CollapsibleSection({
  title,
  defaultOpen = true,
  children,
}: {
  title: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="border border-gray-800 rounded-xl overflow-hidden">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center gap-2 px-4 py-3 bg-[#161b22] hover:bg-gray-800/40 transition-colors text-left"
      >
        <span className={`text-[10px] text-gray-500 transition-transform ${open ? 'rotate-90' : ''}`}>&#9654;</span>
        <span className="text-xs font-semibold text-gray-300 uppercase tracking-wider">{title}</span>
      </button>
      {open && <div className="p-4 bg-[#0d1117]">{children}</div>}
    </div>
  );
}

// ─── Budget Gauge ───────────────────────────────────────────────

function BudgetGauge({ label, spent, limit, pct }: { label: string; spent: number; limit: number; pct: number }) {
  const color = pct > 1 ? '#ef4444' : pct > 0.75 ? '#f97316' : pct > 0.5 ? '#eab308' : '#22c55e';
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between">
        <span className="text-[10px] text-gray-500 uppercase tracking-wider">{label}</span>
        <span className="text-xs text-gray-400">${spent.toFixed(2)} / ${limit}</span>
      </div>
      <div className="h-2 bg-gray-800 rounded-full overflow-hidden">
        <div
          className="h-full rounded-full transition-all duration-500"
          style={{ width: `${Math.min(100, pct * 100)}%`, backgroundColor: color }}
        />
      </div>
    </div>
  );
}

// ─── Empty IDs constant (Zustand safe) ──────────────────────────

const EMPTY_IDS: string[] = [];

// ─── Component ──────────────────────────────────────────────────────

export function InsightsView({ data, sessions }: InsightsViewProps) {
  const [expandedInsight, setExpandedInsight] = useState<string | null>(null);
  const [categoryFilter, setCategoryFilter] = useState<Category | null>(null);

  const insights = useMemo(() => generateInsights(data), [data]);
  const { budget, setPlanOverride } = useBudgetData(data);
  const modelOpt = useMemo(() => computeModelOptimization(data.sessions), [data.sessions]);

  // Report card: use all session IDs for an aggregate view
  const sessionIds = useMemo(() => {
    const ids = sessions.map((s) => s.id);
    return ids.length > 0 ? ids.slice(0, 20) : EMPTY_IDS; // API caps at 20
  }, [sessions]);

  const { reportCard, playbooks, isLoading: coachingLoading, refetchPlaybooks } = useCoachingData(sessionIds);

  const filteredInsights = useMemo(() => {
    if (!categoryFilter) return insights;
    return insights.filter((i) => i.category === categoryFilter);
  }, [insights, categoryFilter]);

  const categoryCounts = useMemo(() => {
    const counts = new Map<Category, number>();
    for (const i of insights) {
      counts.set(i.category, (counts.get(i.category) ?? 0) + 1);
    }
    return counts;
  }, [insights]);

  const severityCounts = useMemo(() => {
    const counts = { critical: 0, warning: 0, info: 0, success: 0 };
    for (const i of insights) counts[i.severity]++;
    return counts;
  }, [insights]);

  const summary = useMemo(() => {
    const totalCost = data.sessions.reduce((s, sess) => s + sess.totalCost, 0);
    const totalSessions = data.sessions.length;
    const totalTurns = data.turns.length;

    const warningCount = severityCounts.warning + severityCounts.critical;
    const successCount = severityCounts.success;

    const lines: string[] = [];
    lines.push(`${totalSessions} sessions, ${totalTurns} turns, $${totalCost.toFixed(2)} total cost.`);

    if (warningCount > 0) {
      lines.push(`${warningCount} area${warningCount > 1 ? 's' : ''} need${warningCount === 1 ? 's' : ''} attention - review the coaching below.`);
    }
    if (successCount > 0) {
      lines.push(`${successCount} thing${successCount > 1 ? 's' : ''} you're doing well.`);
    }
    if (budget.projectedMonthly > 0) {
      lines.push(`Projected monthly: ~$${budget.projectedMonthly.toFixed(0)} (${budget.trend}).`);
    }

    return lines.join(' ');
  }, [data.sessions, data.turns, severityCounts, budget]);

  const handlePlaybookRefresh = useCallback(() => {
    refetchPlaybooks();
  }, [refetchPlaybooks]);

  return (
    <div className="max-w-[1400px] mx-auto p-4 space-y-4">
      {/* Executive Summary Banner */}
      <div className="bg-gradient-to-r from-blue-500/10 to-purple-500/10 border border-blue-500/20 rounded-xl p-4">
        <div className="flex items-center gap-2 mb-2">
          <span className="text-sm font-medium text-gray-200">AI Coach Summary</span>
          <div className="flex items-center gap-1.5 ml-auto">
            {severityCounts.critical > 0 && (
              <span className="px-2 py-0.5 text-[10px] font-medium rounded-full bg-red-500/20 text-red-400">
                {severityCounts.critical} critical
              </span>
            )}
            {severityCounts.warning > 0 && (
              <span className="px-2 py-0.5 text-[10px] font-medium rounded-full bg-amber-500/20 text-amber-400">
                {severityCounts.warning} warnings
              </span>
            )}
            {severityCounts.success > 0 && (
              <span className="px-2 py-0.5 text-[10px] font-medium rounded-full bg-emerald-500/20 text-emerald-400">
                {severityCounts.success} good
              </span>
            )}
          </div>
        </div>
        <p className="text-xs text-gray-400 leading-relaxed">{summary}</p>
      </div>

      {/* ── Section 1: Insight Cards ────────────────────────────── */}
      <CollapsibleSection title="Insight Cards">
        {/* Category filter pills */}
        <div className="flex items-center gap-2 flex-wrap mb-3">
          <button
            onClick={() => setCategoryFilter(null)}
            className={`px-3 py-1 text-[11px] rounded-lg transition-all ${
              !categoryFilter ? 'bg-blue-500/20 text-blue-400 font-medium' : 'text-gray-500 hover:text-gray-300 hover:bg-gray-800'
            }`}
          >
            All ({insights.length})
          </button>
          {(['cost', 'models', 'prompts', 'efficiency', 'tools', 'patterns'] as Category[]).map((cat) => {
            const count = categoryCounts.get(cat) ?? 0;
            if (count === 0) return null;
            return (
              <button
                key={cat}
                onClick={() => setCategoryFilter(categoryFilter === cat ? null : cat)}
                className={`px-3 py-1 text-[11px] rounded-lg transition-all ${
                  categoryFilter === cat ? 'bg-blue-500/20 text-blue-400 font-medium' : 'text-gray-500 hover:text-gray-300 hover:bg-gray-800'
                }`}
              >
                {CATEGORY_ICONS[cat]} {CATEGORY_LABELS[cat]} ({count})
              </button>
            );
          })}
        </div>

        <div className="space-y-3">
          {filteredInsights.length === 0 && (
            <div className="text-center text-gray-500 py-8 text-sm">
              No insights to show. Need more session data for analysis.
            </div>
          )}
          {filteredInsights.map((insight) => {
            const style = SEVERITY_STYLES[insight.severity];
            const isExpanded = expandedInsight === insight.id;
            return (
              <button
                key={insight.id}
                onClick={() => setExpandedInsight(isExpanded ? null : insight.id)}
                className={`${style.bg} border ${style.border} rounded-xl p-4 w-full text-left transition-all hover:brightness-110`}
              >
                <div className="flex items-start gap-3">
                  <span className="text-sm flex-shrink-0 mt-0.5">{style.icon}</span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-2">
                      <h4 className={`text-xs font-semibold ${style.text}`}>{insight.title}</h4>
                      <div className="flex items-center gap-2 flex-shrink-0">
                        {insight.metric && (
                          <span className="text-[10px] text-gray-500 bg-gray-800/50 px-2 py-0.5 rounded">{insight.metric}</span>
                        )}
                        <span className="text-[10px] text-gray-600 bg-gray-800/30 px-1.5 py-0.5 rounded">
                          {CATEGORY_ICONS[insight.category]} {CATEGORY_LABELS[insight.category]}
                        </span>
                      </div>
                    </div>
                    <p className="text-[11px] text-gray-400 mt-1 leading-relaxed">{insight.description}</p>

                    {isExpanded && (
                      <div className="mt-3 pt-3 border-t border-gray-700/50">
                        <div className="flex items-center gap-1.5 mb-2">
                          <span className="text-[10px] font-semibold text-blue-400 uppercase tracking-wider">Recommendation</span>
                        </div>
                        <ul className="space-y-1.5">
                          {splitCoaching(insight.coaching).map((point, pi) => {
                            const accentColor = insight.severity === 'critical' ? '#ef4444'
                              : insight.severity === 'warning' ? '#f59e0b'
                              : insight.severity === 'success' ? '#10b981' : '#3b82f6';
                            return (
                              <li key={pi} className="text-[11px] text-gray-300 leading-relaxed pl-3 border-l-2" style={{ borderColor: `${accentColor}40` }}>
                                {point}
                              </li>
                            );
                          })}
                        </ul>
                        {insight.impact && (
                          <div className="mt-2 flex items-center gap-1.5">
                            <span className="text-[10px] text-emerald-400 font-medium">Potential impact:</span>
                            <span className="text-[10px] text-emerald-400/80">{insight.impact}</span>
                          </div>
                        )}
                      </div>
                    )}

                    <div className="mt-2 text-[10px] text-gray-600">
                      {isExpanded ? 'Click to collapse' : 'Click for recommendation'}
                    </div>
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      </CollapsibleSection>

      {/* ── Section 2: Report Card ──────────────────────────────── */}
      <CollapsibleSection title="Report Card" defaultOpen={false}>
        {sessions.length === 0 ? (
          <div className="text-center py-8">
            <div className="text-gray-600 text-2xl mb-2">&#x1f4ca;</div>
            <p className="text-sm text-gray-400">Transcript unavailable</p>
            <p className="text-xs text-gray-600 mt-1">Session data needed to generate report card</p>
          </div>
        ) : (
          <ReportCardPanel reportCard={reportCard} isLoading={coachingLoading} />
        )}
      </CollapsibleSection>

      {/* ── Section 3: Session Templates ──────────────────────── */}
      <CollapsibleSection title="Session Templates" defaultOpen={false}>
        <PlaybookPanel
          playbooks={playbooks}
          sessionId={sessionIds.length > 0 ? sessionIds[0] : null}
          onRefresh={handlePlaybookRefresh}
        />
      </CollapsibleSection>

      {/* ── Section 4: Model Optimization + Budget ─────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Model Optimization Card */}
        <CollapsibleSection title="Model Optimization">
          {modelOpt && modelOpt.bestSaving ? (
            <div className="space-y-3">
              <div className={`p-3 rounded-lg border ${modelOpt.bestSaving.savings >= 0 ? 'bg-emerald-500/10 border-emerald-500/20' : 'bg-red-500/10 border-red-500/20'}`}>
                <div className={`text-lg font-bold ${modelOpt.bestSaving.savings >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                  Save ~${modelOpt.bestSaving.savings.toFixed(2)} ({modelOpt.bestSaving.savingsPct.toFixed(0)}%)
                </div>
                <p className="text-xs text-gray-400 mt-1">
                  By switching to <span className="text-gray-200 font-medium">{modelOpt.bestSaving.name}</span> for
                  tasks currently using more expensive models
                </p>
              </div>
              <div className="space-y-2">
                {modelOpt.alternatives.map((alt) => (
                  <div key={alt.id} className="flex items-center justify-between px-3 py-2 bg-[#161b22] border border-gray-800 rounded-lg">
                    <span className="text-xs text-gray-300">{alt.name}</span>
                    <div className="flex items-center gap-3">
                      <span className="text-xs text-gray-400">${alt.cost.toFixed(2)}</span>
                      <span className={`text-[10px] font-medium ${alt.savings > 0 ? 'text-emerald-400' : alt.savings < 0 ? 'text-red-400' : 'text-gray-500'}`}>
                        {alt.savings > 0 ? '-' : alt.savings < 0 ? '+' : ''}${Math.abs(alt.savings).toFixed(2)}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
              <p className="text-[10px] text-gray-600">
                Current total spend: ${modelOpt.currentCost.toFixed(2)}. Estimates assume same token volume.
              </p>
            </div>
          ) : (
            <p className="text-xs text-gray-500 text-center py-4">
              Not enough session data for model optimization analysis
            </p>
          )}
        </CollapsibleSection>

        {/* Budget Tracker */}
        <CollapsibleSection title="Budget Tracker">
          <div className="space-y-4">
            {/* Plan Badge + Selector */}
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="text-[10px] text-gray-500 uppercase tracking-wider">Plan</span>
                {budget.plan ? (
                  <span className={`px-2 py-0.5 text-[10px] font-medium rounded-full ${
                    budget.plan.source === 'auto'
                      ? 'bg-blue-500/15 text-blue-400 border border-blue-500/20'
                      : 'bg-purple-500/15 text-purple-400 border border-purple-500/20'
                  }`}>
                    {PLAN_LABELS[budget.plan.plan] ?? budget.plan.plan}
                    {budget.plan.source === 'auto' && !budget.plan.detected && ' (assumed)'}
                  </span>
                ) : (
                  <span className="px-2 py-0.5 text-[10px] text-gray-500 bg-gray-800 rounded-full">Unknown</span>
                )}
                {budget.plan?.monthlyLimit != null && (
                  <span className="text-[10px] text-gray-600">${budget.plan.monthlyLimit}/mo</span>
                )}
              </div>
              <select
                className="bg-[#0d1117] border border-gray-700 rounded px-2 py-0.5 text-[10px] text-gray-400 focus:border-blue-500 focus:outline-none"
                value={budget.plan?.plan ?? 'pro'}
                onChange={(e) => setPlanOverride(e.target.value)}
              >
                {Object.entries(PLAN_LABELS).map(([key, label]) => (
                  <option key={key} value={key}>{label}</option>
                ))}
              </select>
            </div>

            {/* Budget Gauges */}
            <BudgetGauge label="Daily" spent={budget.daily.spent} limit={budget.daily.limit} pct={budget.daily.pct} />
            <BudgetGauge label="Weekly" spent={budget.weekly.spent} limit={budget.weekly.limit} pct={budget.weekly.pct} />
            <BudgetGauge label="Monthly" spent={budget.monthly.spent} limit={budget.monthly.limit} pct={budget.monthly.pct} />

            {/* API-equivalent cost note for subscription users */}
            {budget.plan && budget.plan.plan !== 'api' && budget.plan.plan !== 'free' && (
              <div className="px-3 py-2 bg-blue-500/5 border border-blue-500/10 rounded-lg">
                <span className="text-[10px] text-blue-400">
                  Subscription users: costs shown are API-equivalent estimates based on token usage. Your actual bill is your plan price.
                </span>
              </div>
            )}

            {/* Forecast */}
            <div className="pt-2 border-t border-gray-800">
              <div className="flex items-center justify-between">
                <span className="text-[10px] text-gray-500">Daily Average</span>
                <span className="text-xs text-gray-300">${budget.dailyAvg.toFixed(2)}</span>
              </div>
              <div className="flex items-center justify-between mt-1">
                <span className="text-[10px] text-gray-500">Projected Monthly</span>
                <span className="text-xs text-gray-300">${budget.projectedMonthly.toFixed(0)}</span>
              </div>
              {budget.plan?.monthlyLimit != null && budget.plan.monthlyLimit > 0 && budget.projectedMonthly > 0 && (
                <div className="flex items-center justify-between mt-1">
                  <span className="text-[10px] text-gray-500">% of Plan Limit</span>
                  <span className={`text-xs ${
                    budget.projectedMonthly / budget.plan.monthlyLimit > 0.9 ? 'text-red-400'
                    : budget.projectedMonthly / budget.plan.monthlyLimit > 0.5 ? 'text-yellow-400'
                    : 'text-emerald-400'
                  }`}>
                    {Math.round((budget.projectedMonthly / budget.plan.monthlyLimit) * 100)}%
                  </span>
                </div>
              )}
              <div className="flex items-center justify-between mt-1">
                <span className="text-[10px] text-gray-500">Trend</span>
                <span className={`text-xs ${budget.trend === 'rising' ? 'text-red-400' : budget.trend === 'falling' ? 'text-emerald-400' : 'text-gray-400'}`}>
                  {budget.trend === 'rising' ? '\u2197 Rising' : budget.trend === 'falling' ? '\u2198 Falling' : '\u2192 Stable'}
                </span>
              </div>
            </div>
          </div>
        </CollapsibleSection>
      </div>

      {/* Quick tips */}
      <div className="bg-[#161b22] border border-gray-800 rounded-xl p-4">
        <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">Quick Tips</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
          <div className="text-[11px] text-gray-400 leading-relaxed">
            <span className="text-blue-400 font-medium">CLAUDE.md</span> - Document your project architecture, conventions, and common patterns. Claude reads this first, reducing exploration time and token cost.
          </div>
          <div className="text-[11px] text-gray-400 leading-relaxed">
            <span className="text-blue-400 font-medium">/compact</span> - Manually trigger context compaction before it happens automatically. This preserves the most important context.
          </div>
          <div className="text-[11px] text-gray-400 leading-relaxed">
            <span className="text-blue-400 font-medium">/fast</span> - Toggle fast mode (Haiku) for simple tasks. 4x cheaper than Sonnet for formatting, boilerplate, and basic edits.
          </div>
          <div className="text-[11px] text-gray-400 leading-relaxed">
            <span className="text-blue-400 font-medium">New sessions</span> - Start a fresh session for each distinct task. Mixing unrelated work in one session wastes context and increases compaction risk.
          </div>
        </div>
      </div>
    </div>
  );
}
