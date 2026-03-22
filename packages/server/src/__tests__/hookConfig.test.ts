// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Bernhard

// Must be set before importing @synapse-ai/core/config (which hookConfigService imports)
process.env.SYNAPSE_PORT = '27246';

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import os from 'os';
import path from 'path';
import fs from 'fs';
import {
  validateCwd,
  readHookStatus,
  writeHookConfig,
  configure,
} from '../services/hookConfigService.js';

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

describe('writeHookConfig', () => {
  let tmpDir: string;
  const fakeScript = path.join(os.tmpdir(), 'send_event.cjs');

  beforeEach(() => {
    tmpDir = path.join(os.tmpdir(), 'hookconfig-write-' + Date.now());
    fs.mkdirSync(path.join(tmpDir, '.claude'), { recursive: true });
    fs.writeFileSync(fakeScript, '// fake');
    configure(fakeScript);
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    try {
      fs.unlinkSync(fakeScript);
    } catch {
      /* ok */
    }
  });

  it('creates settings.local.json with observation hooks', () => {
    writeHookConfig(tmpDir, { observation: true, remoteApproval: false });
    const status = readHookStatus(tmpDir);
    expect(status.observation).toBe(true);
    expect(status.remoteApproval).toBe(false);
  });

  it('creates settings with observation + remote approval', () => {
    writeHookConfig(tmpDir, { observation: true, remoteApproval: true });
    const status = readHookStatus(tmpDir);
    expect(status.observation).toBe(true);
    expect(status.remoteApproval).toBe(true);
  });

  it('removes observation hooks when set to false', () => {
    writeHookConfig(tmpDir, { observation: true, remoteApproval: false });
    writeHookConfig(tmpDir, { observation: false, remoteApproval: false });
    const status = readHookStatus(tmpDir);
    expect(status.observation).toBe(false);
  });

  it('preserves non-Synapse hook entries', () => {
    const settingsPath = path.join(tmpDir, '.claude', 'settings.local.json');
    fs.writeFileSync(
      settingsPath,
      JSON.stringify({
        hooks: { CustomEvent: [{ hooks: [{ type: 'command', command: 'echo hi' }] }] },
        permissions: { allow: ['Bash'] },
      }),
    );
    writeHookConfig(tmpDir, { observation: true, remoteApproval: false });
    const written = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
    expect(written.hooks.CustomEvent).toBeDefined();
    expect(written.permissions).toEqual({ allow: ['Bash'] });
  });

  it('preserves send_response.cjs hooks on Stop event', () => {
    const settingsPath = path.join(tmpDir, '.claude', 'settings.local.json');
    fs.writeFileSync(
      settingsPath,
      JSON.stringify({
        hooks: {
          Stop: [
            {
              hooks: [
                { type: 'command', command: 'node "send_event.cjs"', async: true },
                { type: 'command', command: 'node "send_response.cjs"', async: true },
              ],
            },
          ],
        },
      }),
    );
    writeHookConfig(tmpDir, { observation: true, remoteApproval: false });
    const written = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
    const stopHooks = written.hooks.Stop[0].hooks;
    const hasResponse = stopHooks.some(
      (h: Record<string, unknown>) =>
        typeof h.command === 'string' && (h.command as string).includes('send_response.cjs'),
    );
    expect(hasResponse).toBe(true);
  });

  it('deletes file when both false and no other settings remain', () => {
    writeHookConfig(tmpDir, { observation: true, remoteApproval: false });
    writeHookConfig(tmpDir, { observation: false, remoteApproval: false });
    const settingsPath = path.join(tmpDir, '.claude', 'settings.local.json');
    expect(fs.existsSync(settingsPath)).toBe(false);
  });

  it('keeps file when both false but other settings exist', () => {
    const settingsPath = path.join(tmpDir, '.claude', 'settings.local.json');
    fs.writeFileSync(
      settingsPath,
      JSON.stringify({
        hooks: {
          SessionStart: [
            { hooks: [{ type: 'command', command: 'node "send_event.cjs"', async: true }] },
          ],
        },
        permissions: { allow: ['Bash'] },
      }),
    );
    writeHookConfig(tmpDir, { observation: false, remoteApproval: false });
    expect(fs.existsSync(settingsPath)).toBe(true);
    const written = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
    expect(written.hooks).toBeUndefined();
    expect(written.permissions).toEqual({ allow: ['Bash'] });
  });

  it('handles ENOENT gracefully on cleanup', () => {
    expect(() =>
      writeHookConfig(tmpDir, { observation: false, remoteApproval: false }),
    ).not.toThrow();
  });

  it('throws when hook script not found', () => {
    configure('/nonexistent/path/send_event.cjs');
    expect(() => writeHookConfig(tmpDir, { observation: true, remoteApproval: false })).toThrow(
      /hook script/i,
    );
  });
});
