#!/usr/bin/env node
// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Bernhard

// Synapse CLI — monitor AI coding agents from the terminal.
//
// Usage:
//   synapse start [--port N] [--background] [--no-open] [--no-hook]
//   synapse stop
//   synapse status
//   synapse open           — open the dashboard in browser (any terminal, any time)
//   synapse hook           — configure hooks for current project
//   synapse unhook         — remove hooks from current project

import { start, stop, status } from './daemon.js';
import { configureHooks, removeHooks, isHooked } from './hookSetup.js';

const args = process.argv.slice(2);
const command = args[0] ?? 'start';

function flag(name: string): boolean {
  return args.includes(`--${name}`);
}

function flagValue(name: string): string | undefined {
  const idx = args.indexOf(`--${name}`);
  if (idx !== -1 && args[idx + 1] && !args[idx + 1].startsWith('--')) {
    return args[idx + 1];
  }
  return undefined;
}

async function openBrowser(url: string): Promise<void> {
  const { exec } = await import('child_process');
  const cmd =
    process.platform === 'win32'
      ? `start "" "${url}"`
      : process.platform === 'darwin'
        ? `open "${url}"`
        : `xdg-open "${url}"`;
  exec(cmd, () => {
    /* ignore errors */
  });
}

async function main() {
  switch (command) {
    case 'start': {
      const port = flagValue('port') ? parseInt(flagValue('port')!, 10) : undefined;
      const background = flag('background') || flag('bg') || args.includes('-d');
      const noOpen = flag('no-open');
      const noHook = flag('no-hook');
      const cwd = process.cwd();

      const actualPort = await start({ port, background });

      // Configure hooks for current project (unless --no-hook)
      if (!noHook) {
        configureHooks(cwd, actualPort);
      }

      // Always print the project-filtered URL so the user knows where to go
      const cwdParam = encodeURIComponent(cwd);
      const dashboardUrl = `http://localhost:${actualPort}?cwd=${cwdParam}`;
      console.log(`  Dashboard  →  ${dashboardUrl}`);
      console.log(`  Run "synapse open" anytime to reopen.\n`);

      // Open browser (unless --no-open or --background)
      if (!noOpen && !background) {
        await openBrowser(dashboardUrl);
      }

      if (background) {
        // In background mode, exit after daemon is started
        process.exit(0);
      }
      // In foreground mode, the process keeps running (handled in daemon.ts)
      break;
    }

    case 'stop': {
      await stop();
      break;
    }

    case 'status': {
      const info = await status();
      if (info.running) {
        console.log(`\nSynapse is running`);
        console.log(`  Dashboard  →  http://localhost:${info.port}`);
        console.log(`  PID           ${info.pid}`);
        console.log(
          `  Hooked here   ${isHooked(process.cwd()) ? 'yes' : 'no (run "synapse hook")'}\n`,
        );
      } else {
        console.log('Synapse is not running. Start with: synapse start -d');
      }
      break;
    }

    case 'open': {
      const info = await status();
      if (!info.running || !info.port) {
        console.error('Synapse is not running. Start with: synapse start -d');
        process.exit(1);
      }
      const cwdParam = encodeURIComponent(process.cwd());
      const url = `http://localhost:${info.port}?cwd=${cwdParam}`;
      await openBrowser(url);
      console.log(`Opening ${url} (${process.cwd().split(/[/\\]/).pop()})`);
      break;
    }

    case 'hook': {
      const info = await status();
      if (!info.running || !info.port) {
        console.error('Synapse is not running. Start it first: synapse start');
        process.exit(1);
      }
      configureHooks(process.cwd(), info.port);
      break;
    }

    case 'unhook': {
      removeHooks(process.cwd());
      break;
    }

    case 'help':
    case '--help':
    case '-h': {
      console.log(`
Synapse — monitor AI coding agents from the terminal

Usage:
  synapse start [options]     Start the Synapse server
  synapse stop                Stop the running server
  synapse status              Show URL, PID, and hook status
  synapse open                Open the dashboard in your browser
  synapse hook                Hook current project to the running server
  synapse unhook              Remove hooks from current project

Start options:
  --port N         Preferred port (default: 27246, auto-increments if busy)
  --background     Run as background daemon (alias: --bg, -d)
  --no-open        Don't open browser
  --no-hook        Don't configure hooks for current project

Examples:
  synapse start -d            Start daemon, hook current project
  synapse status              See the dashboard URL (even if port shifted)
  synapse open                Reopen dashboard from any terminal
  cd ~/other-project && synapse hook    Hook another project to the running daemon
`);
      break;
    }

    default: {
      console.error(`Unknown command: ${command}`);
      console.error('Run "synapse help" for usage');
      process.exit(1);
    }
  }
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
