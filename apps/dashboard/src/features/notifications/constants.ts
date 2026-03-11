// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Bernhard

export const NOTIFICATIONS_ENABLED = true;

export const MAX_NOTIFICATIONS = 50;

export const NOTIFICATION_TYPES: Record<
  string,
  { label: string; color: string; dot: string; border: string; bg: string }
> = {
  permission_prompt: {
    label: 'Permission',
    color: 'text-red-400',
    dot: 'bg-red-400',
    border: 'border-red-700/40',
    bg: 'bg-red-950/80',
  },
  elicitation_dialog: {
    label: 'Question',
    color: 'text-amber-400',
    dot: 'bg-amber-400',
    border: 'border-amber-700/40',
    bg: 'bg-amber-950/80',
  },
  warning: {
    label: 'Warning',
    color: 'text-amber-400',
    dot: 'bg-amber-400',
    border: 'border-amber-700/40',
    bg: 'bg-amber-950/80',
  },
};

export const FALLBACK_TYPE = {
  label: 'Alert',
  color: 'text-gray-400',
  dot: 'bg-gray-400',
  border: 'border-gray-700/40',
  bg: 'bg-gray-900/80',
};

const SETTINGS_KEY = 'synapse-notification-settings';

export interface NotificationSettings {
  enabled: boolean;
  showToasts: boolean;
  showPulse: boolean;
}

export const DEFAULT_SETTINGS: NotificationSettings = {
  enabled: true,
  showToasts: true,
  showPulse: true,
};

export function loadSettings(): NotificationSettings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    return raw ? { ...DEFAULT_SETTINGS, ...JSON.parse(raw) } : DEFAULT_SETTINGS;
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export function saveSettings(partial: Partial<NotificationSettings>): void {
  try {
    const current = loadSettings();
    localStorage.setItem(SETTINGS_KEY, JSON.stringify({ ...current, ...partial }));
  } catch {
    /* quota exceeded */
  }
}

export function sessionLabel(sessionId: string, sessions: Map<string, { cwd?: string }>): string {
  const session = sessions.get(sessionId);
  if (session?.cwd) {
    const parts = session.cwd.replace(/\\/g, '/').split('/');
    return parts[parts.length - 1] || sessionId.slice(0, 8);
  }
  return sessionId.slice(0, 8);
}

export function formatElapsed(ms: number): string {
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  return `${Math.floor(m / 60)}h ago`;
}

export function formatWait(ms: number): string {
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  return `${Math.floor(s / 60)}m ${s % 60}s`;
}

export function targetNodeId(event: { agentId?: string; sessionId: string }): string {
  return event.agentId ? `agent-${event.agentId}` : `session-${event.sessionId}`;
}
