#!/usr/bin/env node
// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Bernhard

// Synapse CLI — monitor AI coding agents from the terminal.
//
// Usage:
//   synapse start [--port N] [--background] [--no-open] [--no-hook]
//   synapse stop
//   synapse status
//   synapse hook           — configure hooks for current project
//   synapse unhook         — remove hooks from current project

import { start, stop, status, readPort } from './daemon.js';
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

      // Open browser (unless --no-open or --background)
      if (!noOpen && !background) {
        await openBrowser(`http://localhost:${actualPort}`);
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
        console.log(`Synapse is running (PID ${info.pid}, port ${info.port})`);
        console.log(`  Dashboard: http://localhost:${info.port}`);
        console.log(`  Hooks configured: ${isHooked(process.cwd()) ? 'yes' : 'no'}`);
      } else {
        console.log('Synapse is not running');
      }
      break;
    }

    case 'hook': {
      const port = readPort();
      if (!port) {
        console.error('Synapse is not running. Start it first: synapse start');
        process.exit(1);
      }
      configureHooks(process.cwd(), port);
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
  synapse status              Check if the server is running
  synapse hook                Configure hooks for current project
  synapse unhook              Remove hooks from current project

Start options:
  --port N         Preferred port (default: 4000, auto-increments if busy)
  --background     Run as background daemon (alias: --bg, -d)
  --no-open        Don't open browser
  --no-hook        Don't configure hooks for current project

Examples:
  synapse start               Start server, hook current project, open browser
  synapse start -d            Start as daemon, hook current project
  synapse start --no-hook     Start server without configuring hooks
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
