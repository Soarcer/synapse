// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Synapse Contributors

import { create } from 'zustand';
import type { AgentEvent } from '@synapse-ai/core';
import { MAX_NOTIFICATIONS, loadSettings, saveSettings } from './constants';

interface NotificationState {
  notifications: AgentEvent[];
  enabled: boolean;
  showToasts: boolean;
  showPulse: boolean;

  addNotification: (event: AgentEvent) => void;
  dismiss: (id: string) => void;
  clearAll: () => void;
  setEnabled: (v: boolean) => void;
  setShowToasts: (v: boolean) => void;
  setShowPulse: (v: boolean) => void;
}

const saved = loadSettings();

export const useNotificationStore = create<NotificationState>((set, get) => ({
  notifications: [],
  enabled: saved.enabled,
  showToasts: saved.showToasts,
  showPulse: saved.showPulse,

  addNotification: (event) => {
    if (!get().enabled) return;
    set((s) => {
      if (s.notifications.some((n) => n.id === event.id)) return s; // dedup
      return { notifications: [event, ...s.notifications].slice(0, MAX_NOTIFICATIONS) };
    });
  },

  dismiss: (id) => set((s) => ({
    notifications: s.notifications.filter((n) => n.id !== id),
  })),

  clearAll: () => set({ notifications: [] }),

  setEnabled: (enabled) => { saveSettings({ enabled }); set({ enabled }); },
  setShowToasts: (showToasts) => { saveSettings({ showToasts }); set({ showToasts }); },
  setShowPulse: (showPulse) => { saveSettings({ showPulse }); set({ showPulse }); },
}));
