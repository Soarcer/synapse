#!/usr/bin/env node

/**
 * Synapse CLI — Claude Agent Monitor
 *
 * Usage:
 *   synapse start [--port <port>]   Start the dashboard server
 *   synapse hook [<path>]           Configure Claude Code hooks for a project
 *   synapse unhook [<path>]         Remove hooks from a project
 *   synapse help                    Show this help
 */

import { spawn, execSync } from 'child_process';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PKG_ROOT = path.resolve(__dirname, '..');

const command = process.argv[2] || 'help';

switch (command) {
  case 'start':
    startServer();
    break;
  case 'hook':
    setupHooks(process.argv[3]);
    break;
  case 'unhook':
    removeHooks(process.argv[3]);
    break;
  case 'help':
  case '--help':
  case '-h':
    showHelp();
    break;
  default:
    console.error(`Unknown command: ${command}`);
    showHelp();
    process.exit(1);
}

function startServer() {
  // Load .env if present
  const envPath = path.join(PKG_ROOT, '.env');
  if (fs.existsSync(envPath)) {
    const lines = fs.readFileSync(envPath, 'utf-8').split('\n');
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const idx = trimmed.indexOf('=');
      if (idx > 0) {
        const key = trimmed.slice(0, idx).trim();
        const val = trimmed.slice(idx + 1).trim();
        if (!process.env[key]) process.env[key] = val;
      }
    }
  }

  // Parse --port flag
  const portIdx = process.argv.indexOf('--port');
  if (portIdx !== -1 && process.argv[portIdx + 1]) {
    process.env.SYNAPSE_PORT = process.argv[portIdx + 1];
  }

  const port = process.env.SYNAPSE_PORT || '27246';
  console.log(`\n  Synapse starting on http://localhost:${port}\n`);

  const child = spawn('npx', ['tsx', path.join(PKG_ROOT, 'server', 'index.ts')], {
    cwd: PKG_ROOT,
    stdio: 'inherit',
    env: { ...process.env },
    shell: true,
  });

  child.on('error', (err) => {
    console.error('Failed to start Synapse server:', err.message);
    process.exit(1);
  });

  child.on('exit', (code) => {
    process.exit(code ?? 0);
  });

  // Forward signals for graceful shutdown
  for (const sig of ['SIGINT', 'SIGTERM']) {
    process.on(sig, () => child.kill(sig));
  }
}

function setupHooks(targetPath) {
  const target = path.resolve(targetPath || process.cwd());
  const hookScript = path.join(PKG_ROOT, 'hooks', 'send_event.cjs');

  if (!fs.existsSync(hookScript)) {
    console.error(`Hook script not found: ${hookScript}`);
    process.exit(1);
  }

  const hookCmd = `node "${hookScript.replace(/\\/g, '/')}"`;
  const claudeDir = path.join(target, '.claude');
  const settingsFile = path.join(claudeDir, 'settings.local.json');

  // All Claude Code hook events
  const syncEvents = [
    'SessionStart', 'UserPromptSubmit',
    'SubagentStart', 'SubagentStop',
    'Stop', 'SessionEnd',
  ];
  const asyncEvents = [
    'PreToolUse', 'PostToolUse', 'PostToolUseFailure',
    'PermissionRequest', 'Notification', 'PreCompact',
  ];

  const hooks = {};
  for (const event of syncEvents) {
    hooks[event] = [{ hooks: [{ type: 'command', command: hookCmd }] }];
  }
  for (const event of asyncEvents) {
    hooks[event] = [{ hooks: [{ type: 'command', command: hookCmd, async: true }] }];
  }

  // Read existing or create new
  let settings = {};
  if (fs.existsSync(settingsFile)) {
    try {
      settings = JSON.parse(fs.readFileSync(settingsFile, 'utf-8'));
    } catch { /* start fresh */ }
  }

  settings.hooks = { ...(settings.hooks || {}), ...hooks };

  fs.mkdirSync(claudeDir, { recursive: true });
  fs.writeFileSync(settingsFile, JSON.stringify(settings, null, 2));

  console.log(`Synapse hooks configured in: ${settingsFile}`);
  console.log(`Hook script: ${hookScript}`);
  console.log('\nStart Synapse with: synapse start');
}

function removeHooks(targetPath) {
  const target = path.resolve(targetPath || process.cwd());
  const settingsFile = path.join(target, '.claude', 'settings.local.json');

  if (fs.existsSync(settingsFile)) {
    fs.unlinkSync(settingsFile);
    console.log(`Removed Synapse hooks from: ${settingsFile}`);
  } else {
    console.log(`No .claude/settings.local.json found in: ${target}`);
  }
}

function showHelp() {
  console.log(`
  Synapse - Claude Agent Monitor

  Usage: synapse <command> [options]

  Commands:
    start [--port <port>]  Start the dashboard server (default: 27246)
    hook [path]            Configure hooks for a project (default: cwd)
    unhook [path]          Remove hooks from a project (default: cwd)
    help                   Show this help

  Examples:
    synapse start                        Start on default port
    synapse start --port 27247            Start on custom port
    synapse hook                         Configure hooks in current project
    synapse hook /path/to/project        Configure hooks in specific project

  Environment:
    SYNAPSE_URL      Hook target URL (default: http://localhost:27246/api/events)
    SYNAPSE_DB_PATH  SQLite database path (default: server/synapse.db)
    SYNAPSE_PORT     Server port (default: 27246)
`);
}
