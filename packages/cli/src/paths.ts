// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Bernhard

import path from 'path';
import os from 'os';
import { fileURLToPath } from 'url';

// ── Global Synapse directory (~/.synapse/) ───────────────────
export const SYNAPSE_HOME = path.join(os.homedir(), '.synapse');
export const GLOBAL_PID_FILE = path.join(SYNAPSE_HOME, 'pid');
export const GLOBAL_DB_PATH = path.join(SYNAPSE_HOME, 'synapse.db');

// ── Distribution paths (relative to built CLI) ──────────────
const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const DIST_DIR = __dirname;
export const SERVER_ENTRY = path.join(DIST_DIR, 'server.mjs');
export const DASHBOARD_DIR = path.join(DIST_DIR, 'dashboard');
export const HOOKS_DIR = path.join(DIST_DIR, 'hooks');

// ── Project-local paths ─────────────────────────────────────
export function projectClaudeDir(cwd: string): string {
  return path.join(cwd, '.claude');
}

export function projectSettingsFile(cwd: string): string {
  return path.join(projectClaudeDir(cwd), 'settings.local.json');
}
