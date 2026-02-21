// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Synapse Contributors

import { describe, it, expect } from 'vitest';

// Mirror the conversational mode detection logic from PromptWorkshop (aligned windows)
function detectConversationalMode(
  turns: Array<{ timestamp: number; promptText: string }>,
): boolean {
  if (turns.length < 2) return false;
  const lastTurn = turns[turns.length - 1];
  const twoMinMs = 2 * 60 * 1000;
  const priorTurns = turns.slice(-3);
  const recentPrior = priorTurns.filter(
    (t) => lastTurn.timestamp - t.timestamp < twoMinMs,
  );
  return recentPrior.length >= 2 &&
    recentPrior.every((t) => t.promptText.split(/\s+/).filter(Boolean).length < 15);
}

function extractSessionGoal(firstPrompt: string): string {
  const end = firstPrompt.search(/[.!?]/);
  return end > 0 && end < 100 ? firstPrompt.slice(0, end + 1) : firstPrompt.slice(0, 100);
}

describe('Workshop context helpers', () => {
  describe('detectConversationalMode', () => {
    it('returns false for a single turn', () => {
      expect(detectConversationalMode([
        { timestamp: 1000, promptText: 'Add dark mode' },
      ])).toBe(false);
    });

    it('returns true for rapid short prompts within 2 minutes', () => {
      const now = Date.now();
      expect(detectConversationalMode([
        { timestamp: now - 60_000, promptText: 'Add dark mode' },
        { timestamp: now - 30_000, promptText: 'Make it darker' },
        { timestamp: now, promptText: 'Now the sidebar' },
      ])).toBe(true);
    });

    it('returns false when prompts are long', () => {
      const now = Date.now();
      const longPrompt = 'I need you to refactor the entire authentication system including the login flow the registration page and all middleware handlers';
      expect(detectConversationalMode([
        { timestamp: now - 60_000, promptText: longPrompt },
        { timestamp: now, promptText: longPrompt },
      ])).toBe(false);
    });

    it('returns false when prompts are far apart', () => {
      const now = Date.now();
      expect(detectConversationalMode([
        { timestamp: now - 300_000, promptText: 'Fix the header' },
        { timestamp: now, promptText: 'Now the footer' },
      ])).toBe(false);
    });

    it('returns false for empty turns array', () => {
      expect(detectConversationalMode([])).toBe(false);
    });

    it('returns false for mixed long-then-short prompts', () => {
      const now = Date.now();
      expect(detectConversationalMode([
        { timestamp: now - 60_000, promptText: 'Refactor the entire authentication system with JWT tokens refresh flow middleware guards and database migrations' },
        { timestamp: now - 30_000, promptText: 'Make it blue' },
        { timestamp: now, promptText: 'Add padding' },
      ])).toBe(false);
    });
  });

  describe('extractSessionGoal', () => {
    it('extracts first sentence when punctuated', () => {
      expect(extractSessionGoal('Add dark mode to the app. Then fix the sidebar.')).toBe('Add dark mode to the app.');
    });

    it('takes first 100 chars when no punctuation', () => {
      const long = 'a'.repeat(200);
      expect(extractSessionGoal(long)).toBe('a'.repeat(100));
    });

    it('handles short prompts without punctuation', () => {
      expect(extractSessionGoal('Fix it')).toBe('Fix it');
    });

    it('returns empty string for empty prompt', () => {
      expect(extractSessionGoal('')).toBe('');
    });

    it('handles question mark as sentence end', () => {
      expect(extractSessionGoal('Why is the header broken? Fix it please.')).toBe('Why is the header broken?');
    });

    it('handles exclamation mark as sentence end', () => {
      expect(extractSessionGoal('Fix this now! The deploy is blocked.')).toBe('Fix this now!');
    });
  });

  describe('notes sanitization', () => {
    it('strips newlines from notes before injection', () => {
      const notes = 'line one\nline two\r\nline three';
      const sanitized = notes.replace(/[\r\n]/g, ' ');
      // \r\n becomes two spaces (each char replaced individually) — acceptable
      expect(sanitized).not.toContain('\n');
      expect(sanitized).not.toContain('\r');
      expect(sanitized).toMatch(/^line one line two\s+line three$/);
    });
  });
});
