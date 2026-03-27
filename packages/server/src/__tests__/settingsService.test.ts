// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Bernhard

import os from 'os';
import path from 'path';

const tmpDbPath = path.join(os.tmpdir(), `synapse-test-settings-${process.pid}-${Date.now()}.db`);
process.env.SYNAPSE_DB_PATH = tmpDbPath;

import { describe, it, expect, beforeAll, beforeEach, afterAll, afterEach } from 'vitest';
import { initDb, getSetting, setSetting, getAllSettings, deleteSetting } from '../db.js';
import {
  SETTINGS_KEYS,
  resolveApiKey,
  maskApiKey,
  getSettingValue,
  setSettingValue,
  removeSettingValue,
  getPublicSettings,
  getAiCoachModel,
  isAiCoachEnabled,
} from '../services/settingsService.js';

// ─── Setup ─────────────────────────────────────────────────────────

beforeAll(async () => {
  await initDb();
});

beforeEach(() => {
  // Clear all settings between tests
  const all = getAllSettings();
  for (const key of Object.keys(all)) {
    deleteSetting(key);
  }
});

afterEach(() => {
  // Restore env
  delete process.env.ANTHROPIC_API_KEY;
});

// ═══════════════════════════════════════════════════════════════════════
// SETTINGS_KEYS
// ═══════════════════════════════════════════════════════════════════════

describe('SETTINGS_KEYS', () => {
  it('exposes all expected key constants', () => {
    expect(SETTINGS_KEYS.ANTHROPIC_API_KEY).toBe('anthropic_api_key');
    expect(SETTINGS_KEYS.AI_COACH_MODEL).toBe('ai_coach_model');
    expect(SETTINGS_KEYS.AI_COACH_ENABLED).toBe('ai_coach_enabled');
    expect(SETTINGS_KEYS.AI_TOKEN_BUDGET).toBe('ai_token_budget_usd');
    expect(SETTINGS_KEYS.CLAUDE_PLAN).toBe('claude_plan');
    expect(SETTINGS_KEYS.MONTHLY_BUDGET).toBe('monthly_budget_usd');
    expect(SETTINGS_KEYS.PERMISSION_APPROVAL_ENABLED).toBe('permission_approval_enabled');
    expect(SETTINGS_KEYS.PERMISSION_TIMEOUT_MINUTES).toBe('permission_timeout_minutes');
    expect(SETTINGS_KEYS.PROMPT_INTERCEPTOR_ENABLED).toBe('prompt_interceptor_enabled');
  });
});

// ═══════════════════════════════════════════════════════════════════════
// maskApiKey
// ═══════════════════════════════════════════════════════════════════════

describe('maskApiKey', () => {
  it('masks a long key showing first 4 and last 4 chars', () => {
    expect(maskApiKey('sk-ant-abc123456789xyz')).toBe('sk-a...9xyz');
  });

  it('returns **** for a very short key', () => {
    expect(maskApiKey('short')).toBe('****');
  });

  it('returns **** for an 8-char key', () => {
    expect(maskApiKey('12345678')).toBe('****');
  });

  it('masks a 9-char key', () => {
    expect(maskApiKey('123456789')).toBe('1234...6789');
  });
});

// ═══════════════════════════════════════════════════════════════════════
// resolveApiKey
// ═══════════════════════════════════════════════════════════════════════

describe('resolveApiKey', () => {
  it('returns source "none" when no key is set anywhere', () => {
    const result = resolveApiKey();
    expect(result.key).toBeUndefined();
    expect(result.source).toBe('none');
  });

  it('resolves from env var when ANTHROPIC_API_KEY is set', () => {
    process.env.ANTHROPIC_API_KEY = 'sk-ant-env-key-123';
    const result = resolveApiKey();
    expect(result.key).toBe('sk-ant-env-key-123');
    expect(result.source).toBe('env');
  });

  it('resolves from settings DB when env is not set', () => {
    setSetting(SETTINGS_KEYS.ANTHROPIC_API_KEY, 'sk-ant-db-key-456');
    const result = resolveApiKey();
    expect(result.key).toBe('sk-ant-db-key-456');
    expect(result.source).toBe('settings');
  });

  it('prefers env over settings DB', () => {
    process.env.ANTHROPIC_API_KEY = 'sk-ant-env-key-123';
    setSetting(SETTINGS_KEYS.ANTHROPIC_API_KEY, 'sk-ant-db-key-456');
    const result = resolveApiKey();
    expect(result.key).toBe('sk-ant-env-key-123');
    expect(result.source).toBe('env');
  });

  it('extracts sk-ant-* from a multiline env value', () => {
    process.env.ANTHROPIC_API_KEY = 'Some Label\nsk-ant-actual-key-789';
    const result = resolveApiKey();
    expect(result.key).toBe('sk-ant-actual-key-789');
    expect(result.source).toBe('env');
  });

  it('trims a non-sk-ant value', () => {
    process.env.ANTHROPIC_API_KEY = '  my-custom-key  ';
    const result = resolveApiKey();
    expect(result.key).toBe('my-custom-key');
    expect(result.source).toBe('env');
  });
});

// ═══════════════════════════════════════════════════════════════════════
// getSettingValue / setSettingValue / removeSettingValue
// ═══════════════════════════════════════════════════════════════════════

describe('getSettingValue', () => {
  it('returns undefined for an unset key', () => {
    expect(getSettingValue('nonexistent_key')).toBeUndefined();
  });

  it('returns a value set via setSettingValue', () => {
    setSettingValue(SETTINGS_KEYS.AI_COACH_MODEL, 'claude-opus-4-6');
    expect(getSettingValue(SETTINGS_KEYS.AI_COACH_MODEL)).toBe('claude-opus-4-6');
  });

  it('returns undefined after removeSettingValue', () => {
    setSettingValue(SETTINGS_KEYS.CLAUDE_PLAN, 'pro');
    removeSettingValue(SETTINGS_KEYS.CLAUDE_PLAN);
    expect(getSettingValue(SETTINGS_KEYS.CLAUDE_PLAN)).toBeUndefined();
  });

  it('for API key, resolves from env first', () => {
    process.env.ANTHROPIC_API_KEY = 'sk-ant-env-key-from-get';
    setSetting(SETTINGS_KEYS.ANTHROPIC_API_KEY, 'sk-ant-db-key-from-get');
    expect(getSettingValue(SETTINGS_KEYS.ANTHROPIC_API_KEY)).toBe('sk-ant-env-key-from-get');
  });

  it('for API key, falls back to DB when env is not set', () => {
    setSetting(SETTINGS_KEYS.ANTHROPIC_API_KEY, 'sk-ant-db-key-fallback');
    expect(getSettingValue(SETTINGS_KEYS.ANTHROPIC_API_KEY)).toBe('sk-ant-db-key-fallback');
  });
});

describe('setSettingValue', () => {
  it('stores a value that can be retrieved from DB', () => {
    setSettingValue(SETTINGS_KEYS.MONTHLY_BUDGET, '50.00');
    expect(getSetting(SETTINGS_KEYS.MONTHLY_BUDGET)).toBe('50.00');
  });

  it('overwrites a previously set value', () => {
    setSettingValue(SETTINGS_KEYS.MONTHLY_BUDGET, '50.00');
    setSettingValue(SETTINGS_KEYS.MONTHLY_BUDGET, '100.00');
    expect(getSetting(SETTINGS_KEYS.MONTHLY_BUDGET)).toBe('100.00');
  });
});

describe('removeSettingValue', () => {
  it('removes a key from the database', () => {
    setSettingValue(SETTINGS_KEYS.CLAUDE_PLAN, 'enterprise');
    removeSettingValue(SETTINGS_KEYS.CLAUDE_PLAN);
    expect(getSetting(SETTINGS_KEYS.CLAUDE_PLAN)).toBeUndefined();
  });

  it('does not throw when removing a nonexistent key', () => {
    expect(() => removeSettingValue('totally_fake_key')).not.toThrow();
  });
});

// ═══════════════════════════════════════════════════════════════════════
// getPublicSettings
// ═══════════════════════════════════════════════════════════════════════

describe('getPublicSettings', () => {
  it('returns defaults for unset coach settings', () => {
    const settings = getPublicSettings();
    expect(settings[SETTINGS_KEYS.AI_COACH_MODEL]).toBe('claude-haiku-4-5-20251001');
    expect(settings[SETTINGS_KEYS.AI_COACH_ENABLED]).toBe('true');
    expect(settings[SETTINGS_KEYS.AI_TOKEN_BUDGET]).toBe('0.10');
  });

  it('reports _api_key_source as "none" when no key is configured', () => {
    const settings = getPublicSettings();
    expect(settings._api_key_source).toBe('none');
  });

  it('masks the API key from DB', () => {
    setSetting(SETTINGS_KEYS.ANTHROPIC_API_KEY, 'sk-ant-secret-database-key-99');
    const settings = getPublicSettings();
    expect(settings[SETTINGS_KEYS.ANTHROPIC_API_KEY]).not.toBe('sk-ant-secret-database-key-99');
    expect(settings[SETTINGS_KEYS.ANTHROPIC_API_KEY]).toMatch(/\.\.\./);
    expect(settings._api_key_source).toBe('settings');
  });

  it('masks the API key from env and reports source "env"', () => {
    process.env.ANTHROPIC_API_KEY = 'sk-ant-env-secret-key-88';
    const settings = getPublicSettings();
    expect(settings[SETTINGS_KEYS.ANTHROPIC_API_KEY]).not.toBe('sk-ant-env-secret-key-88');
    expect(settings[SETTINGS_KEYS.ANTHROPIC_API_KEY]).toMatch(/\.\.\./);
    expect(settings._api_key_source).toBe('env');
  });

  it('preserves explicitly set coach settings', () => {
    setSettingValue(SETTINGS_KEYS.AI_COACH_MODEL, 'claude-opus-4-6');
    setSettingValue(SETTINGS_KEYS.AI_COACH_ENABLED, 'false');
    setSettingValue(SETTINGS_KEYS.AI_TOKEN_BUDGET, '1.00');

    const settings = getPublicSettings();
    expect(settings[SETTINGS_KEYS.AI_COACH_MODEL]).toBe('claude-opus-4-6');
    expect(settings[SETTINGS_KEYS.AI_COACH_ENABLED]).toBe('false');
    expect(settings[SETTINGS_KEYS.AI_TOKEN_BUDGET]).toBe('1.00');
  });

  it('includes non-sensitive settings unmasked', () => {
    setSettingValue(SETTINGS_KEYS.CLAUDE_PLAN, 'pro');
    setSettingValue(SETTINGS_KEYS.MONTHLY_BUDGET, '200.00');
    const settings = getPublicSettings();
    expect(settings[SETTINGS_KEYS.CLAUDE_PLAN]).toBe('pro');
    expect(settings[SETTINGS_KEYS.MONTHLY_BUDGET]).toBe('200.00');
  });
});

// ═══════════════════════════════════════════════════════════════════════
// getAiCoachModel
// ═══════════════════════════════════════════════════════════════════════

describe('getAiCoachModel', () => {
  it('returns default model when not configured', () => {
    expect(getAiCoachModel()).toBe('claude-haiku-4-5-20251001');
  });

  it('returns the configured model', () => {
    setSetting(SETTINGS_KEYS.AI_COACH_MODEL, 'claude-sonnet-4-20250514');
    expect(getAiCoachModel()).toBe('claude-sonnet-4-20250514');
  });
});

// ═══════════════════════════════════════════════════════════════════════
// isAiCoachEnabled
// ═══════════════════════════════════════════════════════════════════════

describe('isAiCoachEnabled', () => {
  it('returns true by default (not explicitly set)', () => {
    expect(isAiCoachEnabled()).toBe(true);
  });

  it('returns true when explicitly set to "true"', () => {
    setSetting(SETTINGS_KEYS.AI_COACH_ENABLED, 'true');
    expect(isAiCoachEnabled()).toBe(true);
  });

  it('returns false when set to "false"', () => {
    setSetting(SETTINGS_KEYS.AI_COACH_ENABLED, 'false');
    expect(isAiCoachEnabled()).toBe(false);
  });

  it('returns true for any value other than "false"', () => {
    setSetting(SETTINGS_KEYS.AI_COACH_ENABLED, 'yes');
    expect(isAiCoachEnabled()).toBe(true);
  });
});
