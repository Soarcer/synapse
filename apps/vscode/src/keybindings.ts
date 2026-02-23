// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Synapse Contributors

import * as vscode from 'vscode';

/**
 * Maps modifier+key combinations to VS Code command IDs.
 * Key format: "ctrl+shift+p", "ctrl+`", "f1", etc.
 * Only Ctrl variants are listed — Cmd (Meta) on macOS is normalized to Ctrl.
 */
const KEYBINDING_MAP: Record<string, string> = {
  // Command palette & quick open
  'ctrl+shift+p': 'workbench.action.showCommands',
  f1: 'workbench.action.showCommands',
  'ctrl+p': 'workbench.action.quickOpen',

  // Panels & views
  'ctrl+shift+e': 'workbench.view.explorer',
  'ctrl+shift+f': 'workbench.action.findInFiles',
  'ctrl+shift+g': 'workbench.view.scm',
  'ctrl+shift+d': 'workbench.view.debug',
  'ctrl+shift+x': 'workbench.view.extensions',
  'ctrl+shift+h': 'workbench.action.replaceInFiles',
  'ctrl+b': 'workbench.action.toggleSidebarVisibility',
  'ctrl+j': 'workbench.action.togglePanel',
  'ctrl+`': 'workbench.action.terminal.toggleTerminal',
  'ctrl+shift+`': 'workbench.action.terminal.new',
  'ctrl+,': 'workbench.action.openSettings',
  'ctrl+shift+,': 'workbench.action.openSettingsJson',

  // Editor management
  'ctrl+w': 'workbench.action.closeActiveEditor',
  'ctrl+shift+w': 'workbench.action.closeWindow',
  'ctrl+n': 'workbench.action.files.newUntitledFile',
  'ctrl+o': 'workbench.action.files.openFile',
  'ctrl+s': 'workbench.action.files.save',
  'ctrl+shift+s': 'workbench.action.files.saveAs',
  'ctrl+\\': 'workbench.action.splitEditor',
  'ctrl+tab': 'workbench.action.openNextRecentlyUsedEditor',
  'ctrl+shift+tab': 'workbench.action.openPreviousRecentlyUsedEditor',
  'ctrl+shift+n': 'workbench.action.newWindow',

  // Search & replace
  'ctrl+f': 'actions.find',
  'ctrl+h': 'editor.action.startFindReplaceAction',

  // Debug
  f5: 'workbench.action.debug.start',
  'shift+f5': 'workbench.action.debug.stop',
  f9: 'editor.debug.action.toggleBreakpoint',
  f10: 'workbench.action.debug.stepOver',
  f11: 'workbench.action.debug.stepInto',
  'shift+f11': 'workbench.action.debug.stepOut',

  // Misc
  'ctrl+shift+m': 'workbench.actions.view.problems',
  'ctrl+shift+u': 'workbench.action.output.toggleOutput',
  'ctrl+shift+y': 'workbench.debug.action.toggleRepl',
  'ctrl+k ctrl+s': 'workbench.action.openGlobalKeybindings',
};

/**
 * Normalize a forwarded keyboard event message into a lookup key.
 * On macOS, metaKey maps to Cmd which VS Code treats as Ctrl for most shortcuts.
 */
function normalizeKey(msg: {
  key: string;
  ctrlKey?: boolean;
  shiftKey?: boolean;
  altKey?: boolean;
  metaKey?: boolean;
}): string {
  const parts: string[] = [];
  if (msg.ctrlKey || msg.metaKey) parts.push('ctrl');
  if (msg.altKey) parts.push('alt');
  if (msg.shiftKey) parts.push('shift');
  parts.push(msg.key.toLowerCase());
  return parts.join('+');
}

/**
 * Execute the VS Code command corresponding to a forwarded keyboard event.
 * Called by both the sidebar and graph panel webview hosts.
 */
export function executeForwardedKeybinding(msg: {
  key: string;
  ctrlKey?: boolean;
  shiftKey?: boolean;
  altKey?: boolean;
  metaKey?: boolean;
}): void {
  const combo = normalizeKey(msg);
  const command = KEYBINDING_MAP[combo];
  if (command) {
    vscode.commands.executeCommand(command);
  }
}
