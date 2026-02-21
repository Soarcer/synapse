// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Synapse Contributors
//
// Isolated notification handler for VS Code extension.
// Manages: toast notifications, status bar warning, tree view badges.
// To remove: delete this file + remove import/init in extension.ts.

import * as vscode from 'vscode';
import type { SynapseTreeProvider } from './treeView';

interface BlockedSession {
  sessionId: string;
  message: string;
  notificationType: string;
  timestamp: number;
}

const blockedSessions = new Map<string, BlockedSession>();

let statusBarItem: vscode.StatusBarItem | undefined;
let treeProvider: SynapseTreeProvider | undefined;

export function initNotificationHandler(
  statusBar: vscode.StatusBarItem,
  tree: SynapseTreeProvider,
): void {
  statusBarItem = statusBar;
  treeProvider = tree;
}

/**
 * Process an incoming WS event for notification handling.
 * Call this from the wsClient.onEvent handler in extension.ts.
 */
export function handleNotificationEvent(event: Record<string, unknown>): void {
  const type = event.type as string;
  const sessionId = event.sessionId as string;
  if (!sessionId) return;

  // Notification event -> show toast + track blocked session
  if (type === 'notification') {
    const config = vscode.workspace.getConfiguration('synapse');
    if (!config.get<boolean>('notifications.enabled', true)) return;

    const message = (event.text as string) ?? 'Claude needs your attention';
    const notifType = (event.notificationType as string) ?? 'info';

    // Track blocked session
    blockedSessions.set(sessionId, {
      sessionId,
      message,
      notificationType: notifType,
      timestamp: Date.now(),
    });
    updateStatusBar();

    // Show VS Code toast
    const useWarning = config.get<boolean>('notifications.sound', false);
    const showFn = useWarning
      ? vscode.window.showWarningMessage
      : vscode.window.showInformationMessage;

    showFn(`Synapse: ${message}`, 'View in Synapse', 'Dismiss').then((choice) => {
      if (choice === 'View in Synapse') {
        vscode.commands.executeCommand('synapse.openDashboard');
      }
    });
  }

  // Clear blocked state when session resumes activity
  if (type === 'tool_start' || type === 'user_prompt') {
    if (blockedSessions.has(sessionId)) {
      blockedSessions.delete(sessionId);
      updateStatusBar();
    }
  }

  // Clear on session end
  if (type === 'session_end') {
    if (blockedSessions.has(sessionId)) {
      blockedSessions.delete(sessionId);
      updateStatusBar();
    }
  }
}

function updateStatusBar(): void {
  if (!statusBarItem) return;
  const count = blockedSessions.size;
  if (count > 0) {
    const metrics = treeProvider?.getMetrics();
    const agentCount = metrics?.agentCount ?? 0;
    statusBarItem.text = `$(pulse) ${agentCount} agent${agentCount !== 1 ? 's' : ''} | $(warning) ${count} waiting`;
    statusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
  } else {
    // Restore default — let the existing updateStatusBarMetrics handle it
    statusBarItem.backgroundColor = undefined;
  }
}

export function getBlockedCount(): number {
  return blockedSessions.size;
}

export function clearAllBlocked(): void {
  blockedSessions.clear();
  updateStatusBar();
}
