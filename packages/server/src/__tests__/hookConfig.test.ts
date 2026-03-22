// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Bernhard

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import os from 'os';
import path from 'path';
import fs from 'fs';
import { validateCwd, readHookStatus } from '../services/hookConfigService.js';

describe('validateCwd', () => {
  it('rejects relative paths', () => {
    expect(() => validateCwd('relative/path')).toThrow(/absolute/i);
  });

  it('rejects paths with .. segments', () => {
    expect(() => validateCwd('/foo/bar/../../../etc')).toThrow();
  });

  it('rejects home directory', () => {
    expect(() => validateCwd(os.homedir())).toThrow(/global/i);
  });

  it('rejects ~/.claude directory', () => {
    expect(() => validateCwd(path.join(os.homedir(), '.claude'))).toThrow(/global/i);
  });

  it('rejects paths where .claude/ does not exist', () => {
    const fakePath = path.join(os.tmpdir(), 'nonexistent-project-' + Date.now());
    expect(() => validateCwd(fakePath)).toThrow(/\.claude/);
  });

  it('accepts valid project with .claude/ directory', () => {
    const tmp = path.join(os.tmpdir(), 'hookconfig-test-' + Date.now());
    fs.mkdirSync(path.join(tmp, '.claude'), { recursive: true });
    try {
      expect(() => validateCwd(tmp)).not.toThrow();
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});

describe('readHookStatus', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = path.join(os.tmpdir(), 'hookconfig-read-' + Date.now());
    fs.mkdirSync(path.join(tmpDir, '.claude'), { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('returns both false when no settings file exists', () => {
    const status = readHookStatus(tmpDir);
    expect(status).toEqual({ observation: false, remoteApproval: false });
  });

  it('detects observation hooks via send_event.cjs reference', () => {
    const settingsPath = path.join(tmpDir, '.claude', 'settings.local.json');
    fs.writeFileSync(
      settingsPath,
      JSON.stringify({
        hooks: {
          SessionStart: [
            {
              hooks: [{ type: 'command', command: 'node "/path/to/send_event.cjs"', async: true }],
            },
          ],
        },
      }),
    );
    const status = readHookStatus(tmpDir);
    expect(status.observation).toBe(true);
    expect(status.remoteApproval).toBe(false);
  });

  it('detects remote approval via HTTP hook on PermissionRequest', () => {
    const settingsPath = path.join(tmpDir, '.claude', 'settings.local.json');
    fs.writeFileSync(
      settingsPath,
      JSON.stringify({
        hooks: {
          PermissionRequest: [
            {
              hooks: [
                { type: 'command', command: 'node "/path/to/send_event.cjs"', async: true },
                { type: 'http', url: 'http://localhost:27247/api/hooks/permission', timeout: 1800 },
              ],
            },
          ],
        },
      }),
    );
    const status = readHookStatus(tmpDir);
    expect(status.observation).toBe(true);
    expect(status.remoteApproval).toBe(true);
  });

  it('handles malformed JSON gracefully', () => {
    const settingsPath = path.join(tmpDir, '.claude', 'settings.local.json');
    fs.writeFileSync(settingsPath, '{ broken json !!!');
    const status = readHookStatus(tmpDir);
    expect(status).toEqual({ observation: false, remoteApproval: false });
  });
});
