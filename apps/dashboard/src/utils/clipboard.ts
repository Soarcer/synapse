// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Bernhard

/**
 * Cross-context clipboard write utility.
 *
 * In a VS Code webview iframe, `navigator.clipboard.writeText()` is blocked
 * by the Permissions-Policy (the cross-origin iframe doesn't inherit
 * clipboard-write). This utility tries the modern API first, then falls back
 * to the legacy `document.execCommand('copy')` approach, and finally relays
 * to the VS Code extension host via postMessage.
 *
 * Returns `true` if the copy likely succeeded.
 */
export async function copyToClipboard(text: string): Promise<boolean> {
  // 1. Modern Clipboard API (works in browsers with secure context + focus)
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // Permissions-Policy blocked or not allowed — fall through
    }
  }

  // 2. Legacy execCommand fallback (works in cross-origin iframes)
  try {
    const textarea = document.createElement('textarea');
    textarea.value = text;
    // Prevent scroll jump and keep element invisible
    textarea.style.position = 'fixed';
    textarea.style.left = '-9999px';
    textarea.style.top = '-9999px';
    textarea.style.opacity = '0';
    document.body.appendChild(textarea);
    textarea.focus();
    textarea.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(textarea);
    if (ok) return true;
  } catch {
    // execCommand not supported — fall through
  }

  // 3. VS Code webview relay — post to parent frame which forwards
  //    to the extension host's vscode.env.clipboard.writeText()
  try {
    window.parent.postMessage({ type: 'clipboardWrite', text }, '*');
    // We can't confirm success, but the relay is our last resort
    return true;
  } catch {
    return false;
  }
}
