import { nanoid } from 'nanoid';
import { logger } from '../lib/logger.js';
import { hasNudgeFired, insertNudge } from '../db.js';
import type { Broadcaster } from './broadcaster.js';
import type { AgentEvent, CoachingNudge, NudgeSeverity } from '@synapse-ai/core';
import { incrementToolCallCount, shouldRunPeriodicCheck, tryEscalateNudge } from './aiNudgeEscalator.js';

// ─── In-Memory Event Buffer ─────────────────────────────────────────

interface SessionBuffer {
  events: AgentEvent[];
  lastActivity: number;
}

const sessionBuffers = new Map<string, SessionBuffer>();
const MAX_BUFFER_SIZE = 20;
const BUFFER_EXPIRY_MS = 60 * 60 * 1000; // 1 hour

export function updateEventBuffer(event: AgentEvent): void {
  const buf = sessionBuffers.get(event.sessionId) ?? { events: [], lastActivity: 0 };
  buf.events.push(event);
  if (buf.events.length > MAX_BUFFER_SIZE) {
    buf.events = buf.events.slice(-MAX_BUFFER_SIZE);
  }
  buf.lastActivity = Date.now();
  sessionBuffers.set(event.sessionId, buf);

  // Evict stale buffers periodically
  if (sessionBuffers.size > 100) {
    const cutoff = Date.now() - BUFFER_EXPIRY_MS;
    for (const [sid, b] of sessionBuffers) {
      if (b.lastActivity < cutoff) sessionBuffers.delete(sid);
    }
  }
}

// ─── Nudge Detector Interface ────────────────────────────────────────

interface NudgeDetector {
  id: string;
  cooldownMs: number;
  check: (event: AgentEvent, buffer: AgentEvent[]) => NudgeCandidate | null;
}

interface NudgeCandidate {
  severity: NudgeSeverity;
  title: string;
  message: string;
  recommendation: string;
}

// ─── Nudge Detectors ─────────────────────────────────────────────────

const detectors: NudgeDetector[] = [
  {
    id: 'nudge.bash-streak',
    cooldownMs: 10 * 60 * 1000, // 10 min
    check: (_event, buffer) => {
      // 3+ consecutive Bash calls for file operations
      const recent = buffer.slice(-5);
      const bashFileOps = recent.filter(e => {
        if (e.toolName !== 'Bash') return false;
        try {
          const input = e.toolInput as Record<string, unknown> | undefined;
          const cmd = (input?.command as string) ?? '';
          return /\b(cat|head|tail|sed|awk|grep|find)\b/.test(cmd);
        } catch { return false; }
      });
      if (bashFileOps.length >= 3) {
        return {
          severity: 'suggestion',
          title: 'Use dedicated tools',
          message: `${bashFileOps.length} consecutive Bash calls for file operations. Dedicated tools (Read, Grep, Edit) are faster and more reliable.`,
          recommendation: 'Ask Claude to use Read instead of cat, Grep instead of grep, and Edit instead of sed.',
        };
      }
      return null;
    },
  },

  {
    id: 'nudge.file-reread',
    cooldownMs: 15 * 60 * 1000,
    check: (event, buffer) => {
      if (event.type !== 'tool_end' || event.toolName !== 'Read') return null;
      const filePath = (event.toolInput as Record<string, unknown> | undefined)?.file_path as string | undefined;
      if (!filePath) return null;
      const readCount = buffer.filter(e =>
        e.toolName === 'Read' &&
        (e.toolInput as Record<string, unknown> | undefined)?.file_path === filePath
      ).length;
      if (readCount >= 3) {
        return {
          severity: 'suggestion',
          title: 'File read 3+ times',
          message: `"${filePath.split('/').pop()}" has been read ${readCount} times. This wastes tokens re-loading the same content.`,
          recommendation: 'Front-load all needed file reads in your first prompt to avoid re-reading.',
        };
      }
      return null;
    },
  },

  {
    id: 'nudge.error-spiral',
    cooldownMs: 5 * 60 * 1000,
    check: (_event, buffer) => {
      const recent = buffer.slice(-10);
      const errors = recent.filter(e => e.type === 'tool_error' || e.status === 'error');
      if (errors.length >= 3) {
        return {
          severity: 'warning',
          title: 'Error spiral detected',
          message: `${errors.length} tool errors in the last ${recent.length} calls. The approach may need rethinking.`,
          recommendation: 'Take a step back. Try reading the file again, or rephrase your request with more context.',
        };
      }
      return null;
    },
  },

  {
    id: 'nudge.long-session',
    cooldownMs: 30 * 60 * 1000,
    check: (event, buffer) => {
      if (buffer.length < 5) return null;
      const firstEvent = buffer[0];
      const durationMs = event.timestamp - firstEvent.timestamp;
      if (durationMs > 60 * 60 * 1000) {
        return {
          severity: 'info',
          title: 'Long session',
          message: `This session has been running for ${Math.round(durationMs / 60_000)} minutes. Long sessions may benefit from a context reset.`,
          recommendation: 'Use /clear to start fresh, or start a new session with focused context.',
        };
      }
      return null;
    },
  },

  {
    id: 'nudge.write-without-read',
    cooldownMs: 10 * 60 * 1000,
    check: (event, buffer) => {
      if (event.type !== 'tool_start') return null;
      if (event.toolName !== 'Edit' && event.toolName !== 'Write') return null;
      const filePath = (event.toolInput as Record<string, unknown> | undefined)?.file_path as string | undefined;
      if (!filePath) return null;
      // Check if file was read before this edit in the buffer
      const wasRead = buffer.some(e =>
        e.toolName === 'Read' &&
        (e.toolInput as Record<string, unknown> | undefined)?.file_path === filePath &&
        e.timestamp < event.timestamp
      );
      if (!wasRead) {
        return {
          severity: 'suggestion',
          title: 'Edit without read',
          message: `Editing "${filePath.split('/').pop()}" without reading it first. This may cause failed edits.`,
          recommendation: 'Always read a file before editing to ensure the exact content matches.',
        };
      }
      return null;
    },
  },

  {
    id: 'nudge.no-verification',
    cooldownMs: 15 * 60 * 1000,
    check: (_event, buffer) => {
      const editCount = buffer.filter(e =>
        e.toolName === 'Edit' || e.toolName === 'Write'
      ).length;
      if (editCount < 5) return null;
      const hasTest = buffer.some(e => {
        if (e.toolName !== 'Bash') return false;
        try {
          const input = e.toolInput as Record<string, unknown> | undefined;
          const cmd = (input?.command as string) ?? '';
          return /\b(test|jest|vitest|pytest|cargo test|go test)\b/i.test(cmd);
        } catch { return false; }
      });
      if (!hasTest) {
        return {
          severity: 'warning',
          title: 'No verification',
          message: `${editCount} file modifications without running tests. Changes may have introduced bugs.`,
          recommendation: 'Run your test suite after making changes to catch issues early.',
        };
      }
      return null;
    },
  },

  {
    id: 'nudge.rapid-prompts',
    cooldownMs: 10 * 60 * 1000,
    check: (event, buffer) => {
      if (event.type !== 'user_prompt') return null;
      const recentPrompts = buffer.filter(e =>
        e.type === 'user_prompt' &&
        event.timestamp - e.timestamp < 120_000
      );
      if (recentPrompts.length >= 3) {
        return {
          severity: 'info',
          title: 'Rapid prompts',
          message: `${recentPrompts.length} prompts in 2 minutes. Consider giving Claude more time to complete each request.`,
          recommendation: 'Wait for Claude to finish before sending the next prompt. Combine related requests into one.',
        };
      }
      return null;
    },
  },

  {
    id: 'nudge.large-file-edit',
    cooldownMs: 15 * 60 * 1000,
    check: (event, _buffer) => {
      if (event.type !== 'tool_end' || event.toolName !== 'Edit') return null;
      // Check if the response indicates a large file
      try {
        const response = event.toolResponse as Record<string, unknown> | undefined;
        const content = JSON.stringify(response ?? {});
        if (content.length > 50_000) {
          return {
            severity: 'info',
            title: 'Large file edit',
            message: 'Editing a large file. Consider breaking it into smaller modules for easier maintenance.',
            recommendation: 'Refactor large files (>500 lines) into smaller, focused modules.',
          };
        }
      } catch { /* ignore */ }
      return null;
    },
  },
];

// ─── Check Nudges ────────────────────────────────────────────────────

// Event types that nudge detectors actually examine
const NUDGE_RELEVANT_TYPES = new Set([
  'tool_start', 'tool_end', 'tool_error', 'agent_start', 'agent_stop', 'user_prompt',
]);

export function checkNudges(event: AgentEvent, broadcaster: Broadcaster): void {
  // Skip detector loop for irrelevant event types
  if (!NUDGE_RELEVANT_TYPES.has(event.type)) return;

  // Track tool calls for periodic AI checks
  if (event.type === 'tool_start' || event.type === 'tool_end') {
    incrementToolCallCount(event.sessionId);
  }

  const buf = sessionBuffers.get(event.sessionId);
  if (!buf || buf.events.length < 3) return;

  for (const detector of detectors) {
    // Check cooldown
    if (hasNudgeFired(event.sessionId, detector.id, detector.cooldownMs)) continue;

    const candidate = detector.check(event, buf.events);
    if (!candidate) continue;

    const nudge: CoachingNudge = {
      id: nanoid(),
      sessionId: event.sessionId,
      detectorId: detector.id,
      severity: candidate.severity,
      title: candidate.title,
      message: candidate.message,
      recommendation: candidate.recommendation,
      firedAt: Date.now(),
      dismissed: false,
    };

    // Persist
    insertNudge({
      session_id: nudge.sessionId,
      nudge_id: nudge.id,
      detector_id: nudge.detectorId,
      title: nudge.title,
      message: nudge.message,
      recommendation: nudge.recommendation,
      severity: nudge.severity,
      fired_at: nudge.firedAt,
    });

    // Broadcast via WebSocket
    broadcaster.broadcastNudge(nudge);

    logger.info({ sessionId: event.sessionId, detectorId: detector.id, severity: nudge.severity }, 'Coaching nudge fired');

    // Try AI escalation for warning+ severity (fire-and-forget)
    if (nudge.severity === 'warning') {
      const recentEventStrings = buf.events.slice(-5).map((e) => {
        const detail = e.toolName ?? e.text?.slice(0, 80) ?? e.error ?? '';
        return `[${e.type}] ${detail}`;
      });
      tryEscalateNudge(nudge, recentEventStrings)
        .then((enriched) => {
          if (enriched) {
            // Broadcast the enriched version as an update
            broadcaster.broadcastNudge({
              ...nudge,
              recommendation: `${nudge.recommendation}\n\nAI Analysis: ${enriched.aiAnalysis}\n\nAction Items:\n${enriched.actionItems.map((a) => `• ${a}`).join('\n')}`,
            });
          }
        })
        .catch(() => {}); // Non-blocking
    }
  }

  // Periodic AI coaching check (every N tool calls)
  if (shouldRunPeriodicCheck(event.sessionId)) {
    logger.debug({ sessionId: event.sessionId }, 'Periodic AI coaching check triggered');
    // Periodic checks happen via the existing detector loop — the escalator
    // rate-limits to prevent spam. No extra nudge creation here.
  }
}
