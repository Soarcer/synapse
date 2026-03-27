// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Bernhard

// Must be set before importing @synapse-ai/core/config (which hookConfigService imports)
process.env.SYNAPSE_PORT = '27246';

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import os from 'os';
import path from 'path';
import fs from 'fs';
import request from 'supertest';
import express from 'express';
import type { Express } from 'express';
import {
  validateCwd,
  readHookStatus,
  writeHookConfig,
  configure,
  getHookScriptPath,
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

  it('returns remoteApproval=false when PermissionRequest has no matchers array', () => {
    const settingsPath = path.join(tmpDir, '.claude', 'settings.local.json');
    fs.writeFileSync(
      settingsPath,
      JSON.stringify({
        hooks: {
          SessionStart: [
            { hooks: [{ type: 'command', command: 'node "send_event.cjs"', async: true }] },
          ],
          PermissionRequest: 'not-an-array',
        },
      }),
    );
    const status = readHookStatus(tmpDir);
    expect(status.observation).toBe(true);
    expect(status.remoteApproval).toBe(false);
  });

  it('returns remoteApproval=false when PermissionRequest matchers have no hooks array', () => {
    const settingsPath = path.join(tmpDir, '.claude', 'settings.local.json');
    fs.writeFileSync(
      settingsPath,
      JSON.stringify({
        hooks: {
          PermissionRequest: [
            { hooks: [{ type: 'command', command: 'node "send_event.cjs"', async: true }] },
            { matcher: 'something' }, // no hooks array
          ],
        },
      }),
    );
    const status = readHookStatus(tmpDir);
    expect(status.observation).toBe(true);
    expect(status.remoteApproval).toBe(false);
  });

  it('returns remoteApproval=false when HTTP hook URL does not match /api/hooks/permission', () => {
    const settingsPath = path.join(tmpDir, '.claude', 'settings.local.json');
    fs.writeFileSync(
      settingsPath,
      JSON.stringify({
        hooks: {
          PermissionRequest: [
            {
              hooks: [
                { type: 'command', command: 'node "send_event.cjs"', async: true },
                { type: 'http', url: 'http://localhost:9999/api/other-endpoint', timeout: 30 },
              ],
            },
          ],
        },
      }),
    );
    const status = readHookStatus(tmpDir);
    expect(status.observation).toBe(true);
    expect(status.remoteApproval).toBe(false);
  });

  it('returns remoteApproval=false when observation is false (no send_event.cjs)', () => {
    const settingsPath = path.join(tmpDir, '.claude', 'settings.local.json');
    fs.writeFileSync(
      settingsPath,
      JSON.stringify({
        hooks: {
          PermissionRequest: [
            {
              hooks: [
                { type: 'http', url: 'http://localhost:27247/api/hooks/permission', timeout: 1800 },
              ],
            },
          ],
        },
      }),
    );
    const status = readHookStatus(tmpDir);
    expect(status.observation).toBe(false);
    // remoteApproval check is skipped when observation is false
    expect(status.remoteApproval).toBe(false);
  });

  it('returns both false for empty JSON object', () => {
    const settingsPath = path.join(tmpDir, '.claude', 'settings.local.json');
    fs.writeFileSync(settingsPath, JSON.stringify({}));
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

  it('throws when hookScriptPath is null and observation is true', () => {
    configure(null as unknown as string);
    expect(() => writeHookConfig(tmpDir, { observation: true, remoteApproval: false })).toThrow(
      /not configured/i,
    );
  });

  it('creates hooks for all 12 event types', () => {
    writeHookConfig(tmpDir, { observation: true, remoteApproval: false });
    const settingsPath = path.join(tmpDir, '.claude', 'settings.local.json');
    const written = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
    const expectedEvents = [
      'SessionStart',
      'UserPromptSubmit',
      'SubagentStart',
      'SubagentStop',
      'Stop',
      'SessionEnd',
      'PreToolUse',
      'PostToolUse',
      'PostToolUseFailure',
      'PermissionRequest',
      'Notification',
      'PreCompact',
    ];
    for (const event of expectedEvents) {
      expect(written.hooks[event]).toBeDefined();
      expect(Array.isArray(written.hooks[event])).toBe(true);
      expect(written.hooks[event]).toHaveLength(1);
      expect(written.hooks[event][0].hooks[0].type).toBe('command');
      expect(written.hooks[event][0].hooks[0].command).toContain('send_event.cjs');
      expect(written.hooks[event][0].hooks[0].async).toBe(true);
    }
  });

  it('adds HTTP hook only on PermissionRequest when remoteApproval is true', () => {
    writeHookConfig(tmpDir, { observation: true, remoteApproval: true });
    const settingsPath = path.join(tmpDir, '.claude', 'settings.local.json');
    const written = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));

    // PermissionRequest should have both command and http hooks
    const permHooks = written.hooks.PermissionRequest[0].hooks;
    expect(permHooks).toHaveLength(2);
    expect(permHooks[1].type).toBe('http');
    expect(permHooks[1].url).toContain('/api/hooks/permission');
    expect(permHooks[1].timeout).toBe(1800);

    // Other events should NOT have HTTP hooks
    const otherEvents = ['SessionStart', 'Stop', 'PreToolUse', 'PostToolUse'];
    for (const event of otherEvents) {
      const hooks = written.hooks[event][0].hooks;
      expect(hooks).toHaveLength(1);
      expect(hooks[0].type).toBe('command');
    }
  });

  it('is idempotent — writing same config twice produces same result', () => {
    writeHookConfig(tmpDir, { observation: true, remoteApproval: true });
    const settingsPath = path.join(tmpDir, '.claude', 'settings.local.json');
    const first = fs.readFileSync(settingsPath, 'utf-8');

    writeHookConfig(tmpDir, { observation: true, remoteApproval: true });
    const second = fs.readFileSync(settingsPath, 'utf-8');

    expect(JSON.parse(first)).toEqual(JSON.parse(second));
  });

  it('removes HTTP hook when switching from remoteApproval=true to false', () => {
    writeHookConfig(tmpDir, { observation: true, remoteApproval: true });
    writeHookConfig(tmpDir, { observation: true, remoteApproval: false });

    const settingsPath = path.join(tmpDir, '.claude', 'settings.local.json');
    const written = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
    const permHooks = written.hooks.PermissionRequest[0].hooks;
    expect(permHooks).toHaveLength(1);
    expect(permHooks[0].type).toBe('command');
  });

  it('uses forward slashes in hook command path', () => {
    writeHookConfig(tmpDir, { observation: true, remoteApproval: false });
    const settingsPath = path.join(tmpDir, '.claude', 'settings.local.json');
    const written = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
    const cmd = written.hooks.SessionStart[0].hooks[0].command;
    expect(cmd).not.toContain('\\');
    expect(cmd).toMatch(/^node "/);
  });

  it('handles malformed JSON in existing settings on cleanup path', () => {
    const settingsPath = path.join(tmpDir, '.claude', 'settings.local.json');
    fs.writeFileSync(settingsPath, '{ broken json');
    // Should not throw — just returns silently
    expect(() =>
      writeHookConfig(tmpDir, { observation: false, remoteApproval: false }),
    ).not.toThrow();
    // File should still exist (couldn't parse, so can't clean up)
    expect(fs.existsSync(settingsPath)).toBe(true);
  });

  it('handles malformed JSON in existing settings on enable path', () => {
    const settingsPath = path.join(tmpDir, '.claude', 'settings.local.json');
    fs.writeFileSync(settingsPath, '{ broken json');
    // Should start fresh and write valid config
    writeHookConfig(tmpDir, { observation: true, remoteApproval: false });
    const written = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
    expect(written.hooks.SessionStart).toBeDefined();
  });

  it('removes only Synapse events during cleanup, preserves custom events', () => {
    const settingsPath = path.join(tmpDir, '.claude', 'settings.local.json');
    fs.writeFileSync(
      settingsPath,
      JSON.stringify({
        hooks: {
          SessionStart: [
            { hooks: [{ type: 'command', command: 'node "send_event.cjs"', async: true }] },
          ],
          CustomHook: [{ hooks: [{ type: 'command', command: 'echo custom' }] }],
        },
      }),
    );
    writeHookConfig(tmpDir, { observation: false, remoteApproval: false });
    const written = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
    expect(written.hooks.SessionStart).toBeUndefined();
    expect(written.hooks.CustomHook).toBeDefined();
  });

  it('removes hooks key entirely when all Synapse events cleaned and no custom events', () => {
    writeHookConfig(tmpDir, { observation: true, remoteApproval: false });
    const settingsPath = path.join(tmpDir, '.claude', 'settings.local.json');
    // Add a non-hooks setting to prevent file deletion
    const existing = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
    existing.other = 'value';
    fs.writeFileSync(settingsPath, JSON.stringify(existing));

    writeHookConfig(tmpDir, { observation: false, remoteApproval: false });
    const written = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
    expect(written.hooks).toBeUndefined();
    expect(written.other).toBe('value');
  });

  it('observation=false removes hooks even when remoteApproval=true was previously set', () => {
    writeHookConfig(tmpDir, { observation: true, remoteApproval: true });
    writeHookConfig(tmpDir, { observation: false, remoteApproval: false });
    const settingsPath = path.join(tmpDir, '.claude', 'settings.local.json');
    expect(fs.existsSync(settingsPath)).toBe(false);
  });
});

describe('configure / getHookScriptPath', () => {
  it('stores and returns the configured path', () => {
    configure('/some/path/send_event.cjs');
    expect(getHookScriptPath()).toBe('/some/path/send_event.cjs');
  });

  it('returns null before configure is called with a valid path', () => {
    configure(null as unknown as string);
    expect(getHookScriptPath()).toBeNull();
  });

  it('overwrites previous value on re-configure', () => {
    configure('/first/path.cjs');
    configure('/second/path.cjs');
    expect(getHookScriptPath()).toBe('/second/path.cjs');
  });
});

describe('hook-config routes', () => {
  let app: Express;
  let tmpDir: string;
  const fakeScript = path.join(os.tmpdir(), 'fake-send_event.cjs');

  beforeEach(async () => {
    tmpDir = path.join(os.tmpdir(), 'hookconfig-route-' + Date.now());
    fs.mkdirSync(path.join(tmpDir, '.claude'), { recursive: true });
    fs.writeFileSync(fakeScript, '// fake');
    configure(fakeScript);

    const { createHookConfigRouter } = await import('../routes/hookConfig.js');
    app = express();
    app.use(express.json());
    app.use('/api/hook-config', createHookConfigRouter());
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    try {
      fs.unlinkSync(fakeScript);
    } catch {
      /* ok */
    }
  });

  it('GET returns 400 without cwd', async () => {
    const res = await request(app).get('/api/hook-config');
    expect(res.status).toBe(400);
  });

  it('GET returns status for valid cwd', async () => {
    const res = await request(app).get('/api/hook-config').query({ cwd: tmpDir });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ observation: false, remoteApproval: false, cwd: tmpDir });
  });

  it('POST enables observation hooks', async () => {
    const res = await request(app)
      .post('/api/hook-config')
      .send({ cwd: tmpDir, observation: true, remoteApproval: false });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.observation).toBe(true);
  });

  it('POST returns 400 for invalid body', async () => {
    const res = await request(app)
      .post('/api/hook-config')
      .send({ cwd: tmpDir, observation: 'yes' });
    expect(res.status).toBe(400);
  });

  it('POST returns 400 for invalid cwd', async () => {
    const res = await request(app)
      .post('/api/hook-config')
      .send({ cwd: 'relative/path', observation: true, remoteApproval: false });
    expect(res.status).toBe(400);
  });

  it('GET returns 400 for cwd without .claude directory', async () => {
    const noClaudeDir = path.join(os.tmpdir(), 'hookconfig-noclaudedir-' + Date.now());
    fs.mkdirSync(noClaudeDir, { recursive: true });
    try {
      const res = await request(app).get('/api/hook-config').query({ cwd: noClaudeDir });
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/\.claude/);
    } finally {
      fs.rmSync(noClaudeDir, { recursive: true, force: true });
    }
  });

  it('POST enables and then disables hooks roundtrip', async () => {
    // Enable
    const enableRes = await request(app)
      .post('/api/hook-config')
      .send({ cwd: tmpDir, observation: true, remoteApproval: true });
    expect(enableRes.status).toBe(200);
    expect(enableRes.body.observation).toBe(true);
    expect(enableRes.body.remoteApproval).toBe(true);

    // Disable
    const disableRes = await request(app)
      .post('/api/hook-config')
      .send({ cwd: tmpDir, observation: false, remoteApproval: false });
    expect(disableRes.status).toBe(200);
    expect(disableRes.body.observation).toBe(false);
    expect(disableRes.body.remoteApproval).toBe(false);
  });

  it('POST returns 400 when missing required fields', async () => {
    const res = await request(app).post('/api/hook-config').send({ cwd: tmpDir });
    expect(res.status).toBe(400);
  });

  it('POST returns 400 for empty cwd string', async () => {
    const res = await request(app)
      .post('/api/hook-config')
      .send({ cwd: '', observation: true, remoteApproval: false });
    expect(res.status).toBe(400);
  });

  it('GET returns correct status after POST enables hooks', async () => {
    await request(app)
      .post('/api/hook-config')
      .send({ cwd: tmpDir, observation: true, remoteApproval: false });

    const res = await request(app).get('/api/hook-config').query({ cwd: tmpDir });
    expect(res.status).toBe(200);
    expect(res.body.observation).toBe(true);
    expect(res.body.remoteApproval).toBe(false);
    expect(res.body.cwd).toBe(tmpDir);
  });
});
