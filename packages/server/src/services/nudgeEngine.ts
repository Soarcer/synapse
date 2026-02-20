import { nanoid } from 'nanoid';
import { logger } from '../lib/logger.js';
import { hasNudgeFired, insertNudge } from '../db.js';
import type { Broadcaster } from './broadcaster.js';
import type {
  AgentEvent,
  AgentEventType,
  CoachingNudge,
  NudgeCandidate,
  NudgeRuleMeta,
  NudgeSeverity,
  SessionAccumulator,
  DeliveryConfig,
} from '@synapse-ai/core';
import { incrementToolCallCount, shouldRunPeriodicCheck, tryEscalateNudge } from './aiNudgeEscalator.js';

// ─── Bash File-Op Detection ──────────────────────────────────────────

const BASH_FILE_OPS_RE = /\b(cat|head|tail|sed|awk|grep|rg|find)\b/;
const TEST_CMD_RE = /\b(test|jest|vitest|pytest|cargo test|go test|npm test|pnpm test|bun test|make test)\b/i;
const GIT_COMMIT_RE = /\bgit\s+commit\b/;
const GIT_DIFF_RE = /\bgit\s+diff\b/;
const GIT_ADD_ALL_RE = /\bgit\s+add\s+(-A|\.)\b/;
const GIT_FORCE_RE = /\bgit\s+push\s+.*(-f|--force)\b/;
const PROCESS_KILL_ALL_RE = /\btaskkill\b.*\/\/IM\b/i;
const SECRET_PATTERN_RE = /\b(API_KEY|SECRET|PASSWORD|PRIVATE_KEY|ACCESS_TOKEN)\s*[:=]\s*["']?[A-Za-z0-9+/=_-]{8,}/;
const BEARER_RE = /Bearer\s+[A-Za-z0-9._~+/=-]{20,}/;
const SENSITIVE_FILES_RE = /\.(env|pem|key|pfx|p12)$|credentials\.json|\.secret/i;
const MAIN_BRANCH_RE = /\b(main|master)\b/;

// ─── NudgeRule Interface ─────────────────────────────────────────────

export interface NudgeRule {
  meta: NudgeRuleMeta;
  subscribes(): AgentEventType[];
  evaluate(ctx: RuleContext): NudgeCandidate | null;
}

export interface RuleContext {
  event: AgentEvent;
  accumulator: Readonly<SessionAccumulator>;
  countWindow: ReadonlyArray<AgentEvent>;
  timeWindow: ReadonlyArray<AgentEvent>;
  getPatternState(key: string): unknown;
  setPatternState(key: string, value: unknown): void;
}

// ─── Session Accumulator ─────────────────────────────────────────────

function createAccumulator(sessionId: string, timestamp: number): SessionAccumulator {
  return {
    sessionId,
    startTime: timestamp,
    lastEventTime: timestamp,
    eventCount: 0,
    toolCounts: new Map(),
    toolErrors: new Map(),
    consecutiveBashFileOps: 0,
    consecutiveErrors: 0,
    lastToolName: null,
    filesRead: new Set(),
    filesEdited: new Set(),
    readBeforeEdit: new Set(),
    editWithoutRead: new Set(),
    fileReadCounts: new Map(),
    promptCount: 0,
    promptTimestamps: [],
    lastPromptTime: 0,
    lastPromptText: '',
    recentPromptTexts: [],
    sessionGoalSummary: '',
    conversationMode: false,
    totalPromptTokens: 0,
    totalInputTokens: 0,
    totalOutputTokens: 0,
    totalCostUsd: 0,
    turnCosts: [],
    subagentCount: 0,
    activeSubagents: new Set(),
    subagentFiles: new Map(),
    usedPlanMode: false,
    usedTodoWrite: false,
    usedSubagents: false,
    distinctFilesModified: 0,
    testRunCount: 0,
    editsSinceLastTest: 0,
    lastTestTime: 0,
    commitCount: 0,
    editsSinceLastCommit: 0,
    usedGitAddAll: false,
    usedForceOps: false,
    currentBranch: null,
    lastGitDiffTime: 0,
    compactionCount: 0,
    permissionMode: null,
  };
}

function extractFilePath(event: AgentEvent): string | null {
  const input = event.toolInput as Record<string, unknown> | undefined;
  return (input?.file_path as string) ?? (input?.path as string) ?? null;
}

function extractBashCommand(event: AgentEvent): string {
  const input = event.toolInput as Record<string, unknown> | undefined;
  return (input?.command as string) ?? '';
}

function updateAccumulator(acc: SessionAccumulator, event: AgentEvent): void {
  acc.eventCount++;
  acc.lastEventTime = event.timestamp;

  // Token tracking
  if (event.tokenUsage) {
    acc.totalInputTokens += event.tokenUsage.input;
    acc.totalOutputTokens += event.tokenUsage.output;
  }
  if (event.costUsd) {
    acc.totalCostUsd += event.costUsd;
    acc.turnCosts.push(event.costUsd);
  }

  // Permission mode
  if (event.permissionMode) {
    acc.permissionMode = event.permissionMode;
    if (event.permissionMode === 'plan') acc.usedPlanMode = true;
  }

  // Compaction
  if (event.type === 'compact') {
    acc.compactionCount++;
  }

  // User prompt
  if (event.type === 'user_prompt') {
    acc.promptCount++;
    acc.lastPromptTime = event.timestamp;
    acc.promptTimestamps.push(event.timestamp);
    // Keep last 20 prompt timestamps
    if (acc.promptTimestamps.length > 20) acc.promptTimestamps.shift();
    if (event.tokenUsage) acc.totalPromptTokens += event.tokenUsage.input;

    const promptText = event.text ?? '';
    const capped = promptText.slice(0, 500);
    acc.lastPromptText = capped;

    // Sliding window of last 3 prompts for conversation context
    acc.recentPromptTexts.push(capped);
    if (acc.recentPromptTexts.length > 3) acc.recentPromptTexts.shift();

    // Session goal: extract from first prompt (first sentence or first 100 chars)
    if (acc.promptCount === 1 && capped.length > 0) {
      const sentenceEnd = capped.search(/[.!?]/);
      acc.sessionGoalSummary = sentenceEnd > 0 && sentenceEnd < 100
        ? capped.slice(0, sentenceEnd + 1)
        : capped.slice(0, 100);
    }

    // Conversation mode: 2+ prompts in last 2min AND avg word count of recent prompts < 15
    const twoMinAgo = event.timestamp - 120_000;
    const recentCount = acc.promptTimestamps.filter((t) => t >= twoMinAgo).length;
    if (recentCount >= 2) {
      const avgWords = acc.recentPromptTexts
        .map((p) => p.split(/\s+/).filter(Boolean).length)
        .reduce((a, b) => a + b, 0) / acc.recentPromptTexts.length;
      acc.conversationMode = avgWords < 15;
    } else {
      acc.conversationMode = false;
    }
  }

  // Agent tracking
  if (event.type === 'agent_start') {
    acc.subagentCount++;
    acc.usedSubagents = true;
    if (event.agentId) acc.activeSubagents.add(event.agentId);
  }
  if (event.type === 'agent_stop' && event.agentId) {
    acc.activeSubagents.delete(event.agentId);
  }

  // Tool tracking
  if (event.toolName && (event.type === 'tool_start' || event.type === 'tool_end' || event.type === 'tool_error')) {
    const toolName = event.toolName;

    if (event.type === 'tool_end' || event.type === 'tool_start') {
      acc.toolCounts.set(toolName, (acc.toolCounts.get(toolName) ?? 0) + 1);
    }

    if (event.type === 'tool_error') {
      acc.toolErrors.set(toolName, (acc.toolErrors.get(toolName) ?? 0) + 1);
      acc.consecutiveErrors++;
    } else {
      acc.consecutiveErrors = 0;
    }

    // Track subagent file access
    if (event.agentId && (toolName === 'Read' || toolName === 'Edit' || toolName === 'Write' || toolName === 'Grep' || toolName === 'Glob')) {
      const filePath = extractFilePath(event);
      if (filePath) {
        let files = acc.subagentFiles.get(event.agentId);
        if (!files) { files = new Set(); acc.subagentFiles.set(event.agentId, files); }
        files.add(filePath);
      }
    }

    // Bash file ops tracking
    if (toolName === 'Bash') {
      const cmd = extractBashCommand(event);
      if (BASH_FILE_OPS_RE.test(cmd)) {
        acc.consecutiveBashFileOps++;
      } else {
        acc.consecutiveBashFileOps = 0;
      }

      // Test detection
      if (TEST_CMD_RE.test(cmd)) {
        acc.testRunCount++;
        acc.editsSinceLastTest = 0;
        acc.lastTestTime = event.timestamp;
      }

      // Git commit detection
      if (GIT_COMMIT_RE.test(cmd)) {
        acc.commitCount++;
        acc.editsSinceLastCommit = 0;
      }

      // Git diff
      if (GIT_DIFF_RE.test(cmd)) {
        acc.lastGitDiffTime = event.timestamp;
      }

      // Git add -A / git add .
      if (GIT_ADD_ALL_RE.test(cmd)) {
        acc.usedGitAddAll = true;
      }

      // Force push
      if (GIT_FORCE_RE.test(cmd)) {
        acc.usedForceOps = true;
      }
    } else {
      // Non-bash tool resets bash streak
      if (event.type === 'tool_start' || event.type === 'tool_end') {
        acc.consecutiveBashFileOps = 0;
      }
    }

    // TodoWrite detection
    if (toolName === 'TodoWrite') {
      acc.usedTodoWrite = true;
    }

    // File read tracking
    if (toolName === 'Read' && (event.type === 'tool_start' || event.type === 'tool_end')) {
      const filePath = extractFilePath(event);
      if (filePath) {
        acc.filesRead.add(filePath);
        acc.fileReadCounts.set(filePath, (acc.fileReadCounts.get(filePath) ?? 0) + 1);
      }
    }

    // File edit tracking
    if ((toolName === 'Edit' || toolName === 'Write') && event.type === 'tool_start') {
      const filePath = extractFilePath(event);
      if (filePath) {
        acc.filesEdited.add(filePath);
        acc.distinctFilesModified = acc.filesEdited.size;
        acc.editsSinceLastTest++;
        acc.editsSinceLastCommit++;

        if (acc.filesRead.has(filePath)) {
          acc.readBeforeEdit.add(filePath);
        } else {
          acc.editWithoutRead.add(filePath);
        }
      }
    }

    acc.lastToolName = toolName;
  }
}

// ─── Dual Windows ────────────────────────────────────────────────────

interface SessionWindows {
  countWindow: AgentEvent[];      // Last N events
  timeWindow: AgentEvent[];       // Events within last T ms
  lastActivity: number;
}

const COUNT_WINDOW_SIZE = 50;
const TIME_WINDOW_MS = 5 * 60 * 1000; // 5 minutes

function updateWindows(windows: SessionWindows, event: AgentEvent): void {
  const now = event.timestamp;

  // Count window: push and trim
  windows.countWindow.push(event);
  if (windows.countWindow.length > COUNT_WINDOW_SIZE) {
    windows.countWindow = windows.countWindow.slice(-COUNT_WINDOW_SIZE);
  }

  // Time window: push and lazy-evict expired
  windows.timeWindow.push(event);
  const cutoff = now - TIME_WINDOW_MS;
  while (windows.timeWindow.length > 0 && windows.timeWindow[0].timestamp < cutoff) {
    windows.timeWindow.shift();
  }

  windows.lastActivity = now;
}

// ─── Delivery Manager ────────────────────────────────────────────────

const DEFAULT_DELIVERY_CONFIG: DeliveryConfig = {
  maxNudgesPerSession: 15,
  cooldownBackoffMultiplier: 2.0,
  maxConsecutiveFiresBeforeSuppress: 3,
  dismissalsBeforeAutoSuppress: 3,
  warningBypassesRateLimit: true,
};

interface CooldownEntry {
  expiresAt: number;
  consecutiveFires: number;
  baseCooldownMs: number;
}

interface DeliveryState {
  nudgesFired: number;
  cooldowns: Map<string, CooldownEntry>;  // ruleId → cooldown
  suppressedRules: Set<string>;           // rules auto-suppressed this session
}

function createDeliveryState(): DeliveryState {
  return { nudgesFired: 0, cooldowns: new Map(), suppressedRules: new Set() };
}

function canDeliver(
  state: DeliveryState,
  rule: NudgeRule,
  acc: SessionAccumulator,
  config: DeliveryConfig,
): boolean {
  // Check minEvents threshold
  if (rule.meta.minEvents && acc.eventCount < rule.meta.minEvents) return false;

  // Check session-level suppression
  if (state.suppressedRules.has(rule.meta.id)) return false;

  // Check global rate limit
  if (state.nudgesFired >= config.maxNudgesPerSession) {
    if (!config.warningBypassesRateLimit || rule.meta.defaultSeverity !== 'warning') {
      return false;
    }
  }

  // Check per-rule cooldown (in-memory first, then DB fallback)
  const cd = state.cooldowns.get(rule.meta.id);
  if (cd && Date.now() < cd.expiresAt) return false;

  // DB cooldown check (for cross-restart persistence)
  if (hasNudgeFired(acc.sessionId, rule.meta.id, rule.meta.defaultCooldownMs)) return false;

  return true;
}

function recordDelivery(state: DeliveryState, rule: NudgeRule, config: DeliveryConfig): void {
  state.nudgesFired++;

  const existing = state.cooldowns.get(rule.meta.id);
  const fires = (existing?.consecutiveFires ?? 0) + 1;
  const backoff = Math.pow(config.cooldownBackoffMultiplier, fires - 1);
  const cooldownMs = rule.meta.defaultCooldownMs * backoff;

  state.cooldowns.set(rule.meta.id, {
    expiresAt: Date.now() + cooldownMs,
    consecutiveFires: fires,
    baseCooldownMs: rule.meta.defaultCooldownMs,
  });

  // Auto-suppress after too many consecutive fires
  if (fires >= config.maxConsecutiveFiresBeforeSuppress) {
    state.suppressedRules.add(rule.meta.id);
    logger.info({ ruleId: rule.meta.id, fires }, 'Rule auto-suppressed after consecutive fires');
  }
}

// ─── Main Nudge Engine ───────────────────────────────────────────────

// Per-session state
const accumulators = new Map<string, SessionAccumulator>();
const windows = new Map<string, SessionWindows>();
const deliveryStates = new Map<string, DeliveryState>();
const patternStates = new Map<string, Map<string, unknown>>();

// Rule registry indexed by event type (visitor pattern)
const allRules: NudgeRule[] = [];
const ruleIndex = new Map<AgentEventType, NudgeRule[]>();

const SESSION_EXPIRY_MS = 60 * 60 * 1000; // 1 hour
const MAX_SESSIONS = 100;

export function registerRule(rule: NudgeRule): void {
  allRules.push(rule);
  for (const type of rule.subscribes()) {
    const list = ruleIndex.get(type) ?? [];
    list.push(rule);
    ruleIndex.set(type, list);
  }
}

export function getRegisteredRules(): NudgeRule[] {
  return [...allRules];
}

// Backward-compat: updateEventBuffer is still called from eventStore.ts
export function updateEventBuffer(event: AgentEvent): void {
  const sid = event.sessionId;

  // Get or create accumulator
  let acc = accumulators.get(sid);
  if (!acc) {
    acc = createAccumulator(sid, event.timestamp);
    accumulators.set(sid, acc);
  }
  updateAccumulator(acc, event);

  // Get or create windows
  let win = windows.get(sid);
  if (!win) {
    win = { countWindow: [], timeWindow: [], lastActivity: 0 };
    windows.set(sid, win);
  }
  updateWindows(win, event);

  // Evict stale sessions
  if (accumulators.size > MAX_SESSIONS) {
    const cutoff = Date.now() - SESSION_EXPIRY_MS;
    for (const [s, a] of accumulators) {
      if (a.lastEventTime < cutoff) {
        accumulators.delete(s);
        windows.delete(s);
        deliveryStates.delete(s);
        patternStates.delete(s);
      }
    }
  }
}

// Event types that the engine examines
const NUDGE_RELEVANT_TYPES = new Set<AgentEventType>([
  'tool_start', 'tool_end', 'tool_error', 'agent_start', 'agent_stop', 'user_prompt',
]);

export function checkNudges(event: AgentEvent, broadcaster: Broadcaster): void {
  if (!NUDGE_RELEVANT_TYPES.has(event.type)) return;

  // Track tool calls for periodic AI checks
  if (event.type === 'tool_start' || event.type === 'tool_end') {
    incrementToolCallCount(event.sessionId);
  }

  const acc = accumulators.get(event.sessionId);
  if (!acc || acc.eventCount < 3) return;

  const win = windows.get(event.sessionId);
  if (!win) return;

  // Get or create delivery state
  let delivery = deliveryStates.get(event.sessionId);
  if (!delivery) {
    delivery = createDeliveryState();
    deliveryStates.set(event.sessionId, delivery);
  }

  // Get or create pattern state
  let patState = patternStates.get(event.sessionId);
  if (!patState) {
    patState = new Map();
    patternStates.set(event.sessionId, patState);
  }

  // Visitor pattern: only get rules that subscribe to this event type
  const rules = ruleIndex.get(event.type);
  if (!rules || rules.length === 0) return;

  // Collect candidates, then prioritize
  const candidates: Array<{ rule: NudgeRule; candidate: NudgeCandidate }> = [];

  for (const rule of rules) {
    if (!canDeliver(delivery, rule, acc, DEFAULT_DELIVERY_CONFIG)) continue;

    const ctx: RuleContext = {
      event,
      accumulator: acc,
      countWindow: win.countWindow,
      timeWindow: win.timeWindow,
      getPatternState: (key) => patState!.get(`${rule.meta.id}:${key}`),
      setPatternState: (key, value) => patState!.set(`${rule.meta.id}:${key}`, value),
    };

    const candidate = rule.evaluate(ctx);
    if (candidate) {
      candidates.push({ rule, candidate });
    }
  }

  if (candidates.length === 0) return;

  // Severity prioritization: deliver highest severity first
  const severityOrder: Record<NudgeSeverity, number> = { warning: 3, suggestion: 2, info: 1 };
  candidates.sort((a, b) => severityOrder[b.candidate.severity] - severityOrder[a.candidate.severity]);

  // Deliver top candidate (or all warnings if multiple)
  const delivered: CoachingNudge[] = [];
  for (const { rule, candidate } of candidates) {
    // After the first non-warning, stop (deliver at most 1 non-warning per event)
    if (delivered.length > 0 && candidate.severity !== 'warning') break;

    const nudge: CoachingNudge = {
      id: nanoid(),
      sessionId: event.sessionId,
      detectorId: rule.meta.id,
      severity: candidate.severity,
      title: candidate.title,
      message: candidate.message,
      recommendation: candidate.recommendation,
      firedAt: Date.now(),
      dismissed: false,
      triggerPrompt: acc.lastPromptText || undefined,
    };

    // Persist
    insertNudge({
      session_id: nudge.sessionId,
      nudge_id: nudge.id,
      detector_id: nudge.detectorId,
      title: nudge.title,
      message: nudge.message,
      recommendation: nudge.recommendation,
      severity: nudge.severity,
      fired_at: nudge.firedAt,
    });

    // Broadcast via WebSocket
    broadcaster.broadcastNudge(nudge);
    delivered.push(nudge);

    recordDelivery(delivery, rule, DEFAULT_DELIVERY_CONFIG);
    logger.info({ sessionId: event.sessionId, ruleId: rule.meta.id, severity: nudge.severity }, 'Nudge fired');

    // AI escalation for warnings (fire-and-forget)
    if (nudge.severity === 'warning') {
      const recentStrings = win.countWindow.slice(-5).map((e) => {
        const detail = e.toolName ?? e.text?.slice(0, 80) ?? e.error ?? '';
        return `[${e.type}] ${detail}`;
      });
      tryEscalateNudge(nudge, recentStrings)
        .then((enriched) => {
          if (enriched) {
            broadcaster.broadcastNudge({
              ...nudge,
              recommendation: `${nudge.recommendation}\n\nAI Analysis: ${enriched.aiAnalysis}\n\nAction Items:\n${enriched.actionItems.map((a) => `• ${a}`).join('\n')}`,
            });
          }
        })
        .catch(() => {}); // Non-blocking
    }
  }

  // Periodic AI coaching check
  if (shouldRunPeriodicCheck(event.sessionId)) {
    logger.debug({ sessionId: event.sessionId }, 'Periodic AI coaching check triggered');
  }
}

// ─── Utility Exports ─────────────────────────────────────────────────

export function getSessionAccumulator(sessionId: string): SessionAccumulator | undefined {
  return accumulators.get(sessionId);
}

/**
 * Check if the user's recent prompt explicitly requested a specific action.
 *
 * IMPORTANT: Only use this for actions users describe in natural language
 * (e.g., "force push", "stage everything", "commit all"). NEVER use it
 * for tool-level choices like cat/grep/sed — users don't type those words.
 * Tool selection is always an agent decision.
 */
export function userExplicitlyRequested(acc: Readonly<SessionAccumulator>, patterns: RegExp): boolean {
  if (!acc.lastPromptText) return false;
  return patterns.test(acc.lastPromptText);
}

// Patterns for user-level git actions (things users actually say)
export const USER_ASKED_GIT_ADD_ALL = /\b(add|stage|commit)\b.*\b(all|everything)\b/i;
export const USER_ASKED_FORCE_PUSH = /\bforce push\b/i;

export {
  BASH_FILE_OPS_RE,
  TEST_CMD_RE,
  GIT_COMMIT_RE,
  GIT_DIFF_RE,
  GIT_ADD_ALL_RE,
  GIT_FORCE_RE,
  PROCESS_KILL_ALL_RE,
  SECRET_PATTERN_RE,
  BEARER_RE,
  SENSITIVE_FILES_RE,
  MAIN_BRANCH_RE,
  extractFilePath,
  extractBashCommand,
};
