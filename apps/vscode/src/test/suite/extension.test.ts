// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Bernhard
import * as assert from 'assert';
import * as vscode from 'vscode';

suite('Synapse Extension', () => {
  test('Extension activates successfully', async () => {
    const ext = vscode.extensions.getExtension('Soarcer.synapse-vscode');
    assert.ok(ext, 'Extension not found');
    await ext!.activate();
    assert.ok(ext!.isActive, 'Extension did not activate');
  });

  test('synapse.startServer command is registered', async () => {
    const commands = await vscode.commands.getCommands(true);
    assert.ok(commands.includes('synapse.startServer'), 'startServer command not registered');
  });

  test('synapse.stopServer command is registered', async () => {
    const commands = await vscode.commands.getCommands(true);
    assert.ok(commands.includes('synapse.stopServer'), 'stopServer command not registered');
  });

  test('synapse.openDashboard command is registered', async () => {
    const commands = await vscode.commands.getCommands(true);
    assert.ok(commands.includes('synapse.openDashboard'), 'openDashboard command not registered');
  });

  test('synapse.configureHooks command is registered', async () => {
    const commands = await vscode.commands.getCommands(true);
    assert.ok(commands.includes('synapse.configureHooks'), 'configureHooks command not registered');
  });

  test('Server starts and responds to health check', async () => {
    await vscode.commands.executeCommand('synapse.startServer');
    await new Promise((r) => setTimeout(r, 3000));

    const http = await import('http');
    const healthy = await new Promise<boolean>((resolve) => {
      const req = http.get('http://localhost:4000/api/health', (res) => {
        resolve(res.statusCode === 200);
      });
      req.on('error', () => resolve(false));
      req.setTimeout(2000, () => {
        req.destroy();
        resolve(false);
      });
    });
    assert.ok(healthy, 'Server health check failed after startServer');

    await vscode.commands.executeCommand('synapse.stopServer');
    await new Promise((r) => setTimeout(r, 1000));
  });

  test('WebSocket connection establishes after server start', async () => {
    await vscode.commands.executeCommand('synapse.startServer');
    await new Promise((r) => setTimeout(r, 3000));

    const { WebSocket } = await import('ws');
    const connected = await new Promise<boolean>((resolve) => {
      const ws = new WebSocket('ws://localhost:4000');
      ws.on('open', () => {
        ws.close();
        resolve(true);
      });
      ws.on('error', () => resolve(false));
      setTimeout(() => {
        ws.terminate();
        resolve(false);
      }, 3000);
    });
    assert.ok(connected, 'WebSocket did not connect');

    await vscode.commands.executeCommand('synapse.stopServer');
    await new Promise((r) => setTimeout(r, 1000));
  });

  test('stopServer leaves no orphaned node processes', async () => {
    await vscode.commands.executeCommand('synapse.startServer');
    await new Promise((r) => setTimeout(r, 2000));
    await vscode.commands.executeCommand('synapse.stopServer');
    await new Promise((r) => setTimeout(r, 2000));

    const http = await import('http');
    const stillUp = await new Promise<boolean>((resolve) => {
      const req = http.get('http://localhost:4000/api/health', (res) => {
        resolve(res.statusCode === 200);
      });
      req.on('error', () => resolve(false));
      req.setTimeout(1000, () => {
        req.destroy();
        resolve(false);
      });
    });
    assert.ok(!stillUp, 'Server still responds after stopServer — possible orphaned process');
  });
});
