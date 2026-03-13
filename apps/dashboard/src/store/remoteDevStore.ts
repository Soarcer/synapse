// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Bernhard

import { create } from 'zustand';
import type { PendingSummary } from './permissionStore'; // Type-only — do NOT change to value import (circular dependency with permissionStore)
import { apiUrl } from '../utils/api';

// ── Types ─────────────────────────────────────────────────────

export interface ChatMessage {
  id: string;
  role: 'user' | 'claude';
  text: string;
  timestamp: number;
  isError?: boolean;
}

export type RemoteDevStatus = 'idle' | 'waiting' | 'working';

interface RemoteDevState {
  messages: ChatMessage[];
  pendingQuestion: PendingSummary | null;
  quickActions: string[];
  status: RemoteDevStatus;

  receiveQuestion: (data: PendingSummary) => void;
  sendAnswer: (text: string) => Promise<void>;
  resolveQuestion: () => void;
  clear: () => void;
}

// ── Helpers ───────────────────────────────────────────────────

function nextMsgId(): string {
  return `rdm-${crypto.randomUUID().slice(0, 8)}`;
}

/**
 * Extract the first question from the questions[] array wrapper.
 * Returns null if no valid question found.
 */
function extractFirstQuestion(
  raw: unknown,
): { question: string; options: Array<{ label: string; description?: string }> } | null {
  if (!raw || typeof raw !== 'object') return null;
  const obj = raw as Record<string, unknown>;
  const questions = obj.questions;
  if (!Array.isArray(questions) || questions.length === 0) return null;
  const first = questions[0] as Record<string, unknown>;
  if (!first || typeof first.question !== 'string') return null;
  return {
    question: first.question,
    options: Array.isArray(first.options)
      ? (first.options as Array<{ label: string; description?: string }>).filter(
          (o) => o && typeof o === 'object' && typeof o.label === 'string',
        )
      : [],
  };
}

// ── Store ─────────────────────────────────────────────────────

export const useRemoteDevStore = create<RemoteDevState>((set, get) => ({
  messages: [],
  pendingQuestion: null,
  quickActions: [],
  status: 'idle' as RemoteDevStatus,

  receiveQuestion: (data) => {
    const q = extractFirstQuestion(data.tool_input_raw);
    const questionText = q?.question ?? '';
    const sepIdx = questionText.indexOf('\n===NEXT===\n');

    const statusText = sepIdx >= 0 ? questionText.slice(0, sepIdx).trim() : '';
    const quickActions = q?.options.map((o) => o.label) ?? [];

    set((s) => {
      const newMessages = [...s.messages];
      if (statusText) {
        newMessages.push({
          id: nextMsgId(),
          role: 'claude',
          text: statusText,
          timestamp: Date.now(),
          isError: /error|failed/i.test(statusText),
        });
      }
      return {
        messages: newMessages,
        pendingQuestion: data,
        quickActions,
        status: 'waiting' as RemoteDevStatus,
      };
    });
  },

  sendAnswer: async (text) => {
    const pq = get().pendingQuestion;
    if (!pq) return;

    const msgId = nextMsgId();
    set((s) => ({
      messages: [...s.messages, { id: msgId, role: 'user' as const, text, timestamp: Date.now() }],
      status: 'working' as RemoteDevStatus,
    }));

    try {
      // Answer key format: use question text as key (verified from PermissionCard.buildAnswers)
      const q = extractFirstQuestion(pq.tool_input_raw);
      const questionText = q?.question ?? '';
      const res = await fetch(apiUrl(`/api/permissions/${pq.id}/decision`), {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ behavior: 'allow', answers: { [questionText]: text } }),
      });
      if (!res.ok && res.status !== 404) {
        throw new Error(`HTTP ${res.status}`);
      }
    } catch {
      // Error recovery: revert to waiting, mark message as failed
      set((s) => ({
        status: 'waiting' as RemoteDevStatus,
        messages: s.messages.map((m) =>
          m.id === msgId ? { ...m, isError: true, text: `${m.text} (failed to send)` } : m,
        ),
      }));
    }
  },

  resolveQuestion: () => {
    set({ pendingQuestion: null });
  },

  clear: () => {
    set({
      messages: [],
      pendingQuestion: null,
      quickActions: [],
      status: 'idle' as RemoteDevStatus,
    });
  },
}));
