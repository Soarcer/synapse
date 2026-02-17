import { getSetting, setSetting, getAllSettings, deleteSetting } from '../db.js';
import { logger } from '../lib/logger.js';

// ─── Constants ────────────────────────────────────────────────────────

export const SETTINGS_KEYS = {
  ANTHROPIC_API_KEY: 'anthropic_api_key',
  AI_COACH_MODEL: 'ai_coach_model',
  AI_COACH_ENABLED: 'ai_coach_enabled',
  AI_TOKEN_BUDGET: 'ai_token_budget_usd',
  CLAUDE_PLAN: 'claude_plan',
  MONTHLY_BUDGET: 'monthly_budget_usd',
} as const;

const DEFAULT_MODEL = 'claude-haiku-4-5-20251001';
const DEFAULT_TOKEN_BUDGET = '0.10'; // $0.10 per session

// ─── API Key Resolution ──────────────────────────────────────────────

/**
 * Resolve the Anthropic API key.
 * Priority: env var > settings DB
 */
export function resolveApiKey(): { key: string | undefined; source: 'env' | 'settings' | 'none' } {
  const envKey = process.env.ANTHROPIC_API_KEY;
  if (envKey) return { key: envKey, source: 'env' };

  const dbKey = getSetting(SETTINGS_KEYS.ANTHROPIC_API_KEY);
  if (dbKey) return { key: dbKey, source: 'settings' };

  return { key: undefined, source: 'none' };
}

export function maskApiKey(key: string): string {
  if (key.length <= 8) return '****';
  return `${key.slice(0, 4)}...${key.slice(-4)}`;
}

// ─── Settings CRUD ───────────────────────────────────────────────────

export function getSettingValue(key: string): string | undefined {
  // For API key, check env first
  if (key === SETTINGS_KEYS.ANTHROPIC_API_KEY) {
    const { key: resolved } = resolveApiKey();
    return resolved;
  }
  return getSetting(key);
}

export function setSettingValue(key: string, value: string): void {
  setSetting(key, value);
  logger.info({ key }, 'Setting updated');
}

export function removeSettingValue(key: string): void {
  deleteSetting(key);
  logger.info({ key }, 'Setting removed');
}

export function getPublicSettings(): Record<string, string> {
  const all = getAllSettings();
  const { source } = resolveApiKey();

  // Mask API key in the response
  const result: Record<string, string> = { ...all };
  if (result[SETTINGS_KEYS.ANTHROPIC_API_KEY]) {
    result[SETTINGS_KEYS.ANTHROPIC_API_KEY] = maskApiKey(result[SETTINGS_KEYS.ANTHROPIC_API_KEY]);
  }
  result._api_key_source = source;

  // Inject env-detected key status
  if (source === 'env') {
    result._api_key_source = 'env';
    result[SETTINGS_KEYS.ANTHROPIC_API_KEY] = maskApiKey(process.env.ANTHROPIC_API_KEY!);
  }

  // Defaults for unset values
  result[SETTINGS_KEYS.AI_COACH_MODEL] ??= DEFAULT_MODEL;
  result[SETTINGS_KEYS.AI_COACH_ENABLED] ??= 'true';
  result[SETTINGS_KEYS.AI_TOKEN_BUDGET] ??= DEFAULT_TOKEN_BUDGET;

  return result;
}

// ─── Model Resolution ────────────────────────────────────────────────

export function getAiCoachModel(): string {
  return getSetting(SETTINGS_KEYS.AI_COACH_MODEL) ?? DEFAULT_MODEL;
}

export function isAiCoachEnabled(): boolean {
  const enabled = getSetting(SETTINGS_KEYS.AI_COACH_ENABLED);
  return enabled !== 'false'; // default to true
}
