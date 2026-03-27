// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Bernhard

import { useState, useEffect, useCallback, useRef } from 'react';
import { motion, useMotionValue, type PanInfo } from 'framer-motion';
import type { PendingSummary } from '../../store/permissionStore';
import { apiUrl } from '../../utils/api';

// ── Props ─────────────────────────────────────────────────

interface Props {
  permission: PendingSummary;
  onApprove: (id: string, answers?: Record<string, string>) => void;
  onDeny: (id: string) => void;
  onDismiss: (id: string) => void;
  onCycle: (id: string) => void;
  onExpandToModal: (permission: PendingSummary) => void;
}

// ── AskUserQuestion types ─────────────────────────────────

interface AskOption {
  label: string;
  description?: string;
}

interface AskQuestion {
  question: string;
  header?: string;
  options: AskOption[];
  multiSelect?: boolean;
}

// ── Helpers ───────────────────────────────────────────────

const TRUNCATE_LENGTH = 80;

function formatCountdown(ms: number): string {
  if (ms <= 0) return '0:00';
  const totalSec = Math.ceil(ms / 1000);
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  return `${min}:${sec.toString().padStart(2, '0')}`;
}

function parseAskQuestions(raw: unknown): AskQuestion[] | null {
  let parsed = raw;
  if (typeof parsed === 'string') {
    try {
      parsed = JSON.parse(parsed);
    } catch {
      return null;
    }
  }
  if (!parsed || typeof parsed !== 'object') return null;
  const obj = parsed as Record<string, unknown>;
  const questions = obj.questions;
  if (!Array.isArray(questions) || questions.length === 0) return null;
  const first = questions[0];
  if (!first || typeof first !== 'object') return null;
  if (!('question' in first) || !('options' in first)) return null;
  return questions as AskQuestion[];
}

// ── Close X Button ────────────────────────────────────────

function CloseButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      className="absolute top-2 right-2 z-10 w-6 h-6 flex items-center justify-center rounded-full bg-gray-800/80 hover:bg-gray-700 text-gray-400 hover:text-gray-200 transition-colors"
      aria-label="Dismiss"
      title="Hide — Claude waits until timeout"
    >
      <svg
        width="10"
        height="10"
        viewBox="0 0 10 10"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      >
        <line x1="1" y1="1" x2="9" y2="9" />
        <line x1="9" y1="1" x2="1" y2="9" />
      </svg>
    </button>
  );
}

// ── Expand Button ─────────────────────────────────────────

function ExpandButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      className="absolute bottom-2 right-2 z-10 w-6 h-6 flex items-center justify-center rounded-full bg-gray-800/80 hover:bg-gray-700 text-gray-400 hover:text-gray-200 transition-colors"
      aria-label="Expand"
      title="View full content"
    >
      <svg
        width="10"
        height="10"
        viewBox="0 0 10 10"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      >
        <polyline points="1,4 1,1 4,1" />
        <polyline points="9,6 9,9 6,9" />
        <line x1="1" y1="1" x2="4" y2="4" />
        <line x1="9" y1="9" x2="6" y2="6" />
      </svg>
    </button>
  );
}

// ── Countdown Hook ────────────────────────────────────────

function useCountdown(expiresAt: number): number {
  const [remaining, setRemaining] = useState(() => Math.max(0, expiresAt - Date.now()));
  useEffect(() => {
    if (remaining <= 0) return;
    const interval = setInterval(() => {
      const ms = Math.max(0, expiresAt - Date.now());
      setRemaining(ms);
      if (ms <= 0) clearInterval(interval);
    }, 1000);
    return () => clearInterval(interval);
  }, [expiresAt]); // eslint-disable-line react-hooks/exhaustive-deps
  return remaining;
}

// ── Expired Card ──────────────────────────────────────────

function ExpiredCard({ id, onDismiss }: { id: string; onDismiss: (id: string) => void }) {
  return (
    <div className="relative h-[420px] flex flex-col bg-amber-950/40 border border-amber-700/40 rounded-lg p-4 shadow-lg">
      <CloseButton onClick={() => onDismiss(id)} />
      <div className="flex items-center justify-between mb-2 pr-8">
        <span className="text-sm font-medium text-amber-300">Permission Request</span>
        <span className="text-xs text-amber-400 font-mono">0:00</span>
      </div>
      <p className="text-xs text-amber-300/80">
        Timed out — Claude denied and fell back to terminal.
      </p>
    </div>
  );
}

// ── AskUserQuestion Content ───────────────────────────────

function AskUserQuestionContent({
  permission,
  questions,
  remaining,
  onApprove,
  onDeny,
}: {
  permission: PendingSummary;
  questions: AskQuestion[];
  remaining: number;
  onApprove: (id: string, answers?: Record<string, string>) => void;
  onDeny: (id: string) => void;
}) {
  const { id } = permission;
  const [activeTab, setActiveTab] = useState(0);
  const activeQ = questions[activeTab];
  const [selections, setSelections] = useState<Record<number, Set<number>>>({});

  const toggleOption = (qIdx: number, optIdx: number, multiSelect: boolean) => {
    setSelections((prev) => {
      const current = prev[qIdx] ?? new Set<number>();
      const next = new Set(current);
      if (multiSelect) {
        if (next.has(optIdx)) next.delete(optIdx);
        else next.add(optIdx);
      } else {
        next.clear();
        next.add(optIdx);
      }
      return { ...prev, [qIdx]: next };
    });
  };

  const isSelected = (qIdx: number, optIdx: number) => selections[qIdx]?.has(optIdx) ?? false;

  const buildAnswers = (): Record<string, string> => {
    const answers: Record<string, string> = {};
    for (let qi = 0; qi < questions.length; qi++) {
      const q = questions[qi];
      const selected = selections[qi];
      if (selected && selected.size > 0) {
        const labels = [...selected].map((i) => q.options[i]?.label).filter(Boolean);
        answers[q.question] = labels.join(', ');
      }
    }
    return answers;
  };

  const allAnswered = questions.every((_, qi) => (selections[qi]?.size ?? 0) > 0);

  return (
    <>
      {/* Header */}
      <div className="flex items-center justify-between px-4 pt-3 pb-2 pr-10 flex-shrink-0">
        <span className="text-sm font-medium text-blue-300">Claude is asking you</span>
        <span
          className={`text-xs font-mono ${remaining < 60_000 ? 'text-red-400' : 'text-gray-400'}`}
        >
          {formatCountdown(remaining)}
        </span>
      </div>

      {/* Tab bar */}
      {questions.length > 1 && (
        <div className="flex items-center gap-1 px-3 pb-1 border-b border-gray-800 overflow-x-auto flex-shrink-0">
          {questions.map((q, i) => {
            const answered = (selections[i]?.size ?? 0) > 0;
            return (
              <button
                key={i}
                onClick={() => setActiveTab(i)}
                className={`px-2.5 py-1 rounded-md text-[10px] font-semibold uppercase tracking-wider shrink-0 transition-colors ${
                  i === activeTab
                    ? 'bg-blue-600/30 text-blue-300 border border-blue-500/40'
                    : 'text-gray-500 hover:text-gray-300 hover:bg-gray-800 border border-transparent'
                }`}
              >
                {answered ? '\u2713 ' : ''}
                {q.header || `Q${i + 1}`}
              </button>
            );
          })}
        </div>
      )}

      {/* Scrollable options area */}
      <div className="px-4 py-3 flex-1 min-h-0 overflow-y-auto">
        <p className="text-xs text-gray-200 font-medium mb-3">{activeQ.question}</p>
        <div className="space-y-1.5">
          {activeQ.options.map((opt, i) => {
            const selected = isSelected(activeTab, i);
            return (
              <button
                key={i}
                type="button"
                onClick={() => toggleOption(activeTab, i, !!activeQ.multiSelect)}
                className={`w-full text-left flex items-start gap-2.5 rounded-lg px-3 py-2 border transition-colors ${
                  selected
                    ? 'bg-blue-950/60 border-blue-500/60'
                    : 'bg-gray-950/50 border-gray-800 hover:border-gray-600'
                }`}
              >
                <div className="mt-0.5 shrink-0">
                  {activeQ.multiSelect ? (
                    <div
                      className={`w-3.5 h-3.5 rounded-sm border-2 flex items-center justify-center ${
                        selected ? 'border-blue-400 bg-blue-500' : 'border-gray-600'
                      }`}
                    >
                      {selected && (
                        <span className="text-[8px] text-white font-bold">{'\u2713'}</span>
                      )}
                    </div>
                  ) : (
                    <div
                      className={`w-3.5 h-3.5 rounded-full border-2 flex items-center justify-center ${
                        selected ? 'border-blue-400' : 'border-gray-600'
                      }`}
                    >
                      {selected && <div className="w-1.5 h-1.5 rounded-full bg-blue-400" />}
                    </div>
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <p
                    className={`text-xs font-medium ${selected ? 'text-blue-200' : 'text-gray-200'}`}
                  >
                    {opt.label}
                  </p>
                  {opt.description && (
                    <p className="text-[10px] leading-relaxed mt-0.5 text-gray-500">
                      {opt.description}
                    </p>
                  )}
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Pinned action buttons */}
      <div className="flex items-center gap-2 px-4 pb-3 pt-2 border-t border-gray-800/50 flex-shrink-0">
        <button
          onClick={() => onDeny(id)}
          className="px-3 py-1.5 text-xs rounded bg-red-900/40 text-red-300 hover:bg-red-900/60 border border-red-800/40 transition-colors"
        >
          Deny
        </button>
        <button
          onClick={() => onApprove(id, buildAnswers())}
          disabled={!allAnswered}
          className={`ml-auto px-4 py-1.5 text-xs rounded border transition-colors font-medium ${
            allAnswered
              ? 'bg-green-900/40 text-green-300 hover:bg-green-900/60 border-green-800/40'
              : 'bg-gray-800/40 text-gray-600 border-gray-700/30 cursor-not-allowed'
          }`}
        >
          Send Answer
        </button>
      </div>
    </>
  );
}

// ── Generic Permission Content ────────────────────────────

function GenericPermissionContent({
  permission,
  remaining,
  onApprove,
  onDeny,
}: {
  permission: PendingSummary;
  remaining: number;
  onApprove: (id: string) => void;
  onDeny: (id: string) => void;
}) {
  const { id, tool_name } = permission;
  const tool_input_preview =
    typeof permission.tool_input_preview === 'string'
      ? permission.tool_input_preview
      : JSON.stringify(permission.tool_input_preview, null, 2);

  const [expanded, setExpanded] = useState(false);
  const [fullInput, setFullInput] = useState<string | null>(null);

  const needsTruncation = tool_input_preview.length > TRUNCATE_LENGTH;
  const displayInput =
    expanded && fullInput
      ? fullInput
      : needsTruncation
        ? tool_input_preview.slice(0, TRUNCATE_LENGTH)
        : tool_input_preview;

  const handleExpand = useCallback(async () => {
    if (expanded) {
      setExpanded(false);
      return;
    }
    try {
      const res = await fetch(apiUrl(`/api/permissions/${id}`));
      if (res.ok) {
        const data = await res.json();
        setFullInput(
          typeof data.event?.tool_input === 'string'
            ? data.event.tool_input
            : JSON.stringify(data.event?.tool_input, null, 2),
        );
      }
    } catch {
      setFullInput(tool_input_preview);
    }
    setExpanded(true);
  }, [expanded, id, tool_input_preview]);

  return (
    <>
      {/* Header */}
      <div className="flex items-center justify-between px-4 pt-3 pb-2 pr-10 flex-shrink-0">
        <span className="text-sm font-medium text-gray-200">Permission Request</span>
        <span
          className={`text-xs font-mono ${remaining < 60_000 ? 'text-red-400' : 'text-gray-400'}`}
        >
          {formatCountdown(remaining)}
        </span>
      </div>

      {/* Tool info — scrollable */}
      <div className="px-4 pb-2 flex-1 min-h-0 overflow-y-auto">
        <div className="space-y-1.5">
          <div className="flex items-center gap-2">
            <span className="text-[10px] text-gray-500 uppercase w-10">Tool</span>
            <span className="text-xs text-gray-200 font-medium">{tool_name}</span>
          </div>
          <div className="flex items-start gap-2">
            <span className="text-[10px] text-gray-500 uppercase w-10 pt-0.5">Input</span>
            <div className="flex-1 min-w-0">
              <pre
                className={`text-xs text-gray-300 font-mono whitespace-pre-wrap break-all ${expanded ? 'max-h-40 overflow-auto bg-gray-950/50 rounded p-2' : ''}`}
              >
                {displayInput}
              </pre>
              {needsTruncation && (
                <button
                  onClick={handleExpand}
                  className="text-[10px] text-blue-400 hover:text-blue-300 mt-0.5"
                >
                  {expanded ? '[-]' : '[+]'}
                </button>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Pinned action buttons */}
      <div className="flex items-center gap-2 px-4 pb-3 pt-2 border-t border-gray-800/50 flex-shrink-0">
        <button
          onClick={() => onDeny(id)}
          className="px-3 py-1.5 text-xs rounded bg-red-900/40 text-red-300 hover:bg-red-900/60 border border-red-800/40 transition-colors"
        >
          Deny
        </button>
        <button
          onClick={() => onApprove(id)}
          className="ml-auto px-4 py-1.5 text-xs rounded bg-green-900/40 text-green-300 hover:bg-green-900/60 border border-green-800/40 transition-colors font-medium"
        >
          Approve
        </button>
      </div>
    </>
  );
}

// ── Spring config ─────────────────────────────────────────

const SPRING = { type: 'spring' as const, stiffness: 300, damping: 30 };

// ── Main PermissionCard (with motion drag) ────────────────

export function PermissionCard({
  permission,
  onApprove,
  onDeny,
  onDismiss,
  onCycle,
  onExpandToModal,
}: Props) {
  const { expiresAt } = permission;
  const remaining = useCountdown(expiresAt);
  const cardRef = useRef<HTMLDivElement>(null);
  const x = useMotionValue(0);

  const handleDragEnd = (_: unknown, info: PanInfo) => {
    const cardWidth = cardRef.current?.offsetWidth ?? 384;
    const threshold = cardWidth * 0.4;
    const shouldCycle = Math.abs(info.offset.x) > threshold || Math.abs(info.velocity.x) > 500;
    if (shouldCycle) {
      onCycle(permission.id);
    }
    // Always reset position so the card doesn't stay off-screen
    x.set(0);
  };

  // Check if content should offer modal expansion
  const questions =
    permission.tool_name === 'AskUserQuestion'
      ? parseAskQuestions(permission.tool_input_raw)
      : null;
  const shouldShowExpand = questions
    ? questions.some((q) => q.options.length > 5)
    : permission.tool_input_preview.length > TRUNCATE_LENGTH * 2;

  if (remaining <= 0) {
    return (
      <motion.div
        layout
        exit={{ opacity: 0, scale: 0.8 }}
        transition={SPRING}
        onPointerDown={(e: React.PointerEvent) => e.stopPropagation()}
      >
        <ExpiredCard id={permission.id} onDismiss={onDismiss} />
      </motion.div>
    );
  }

  return (
    <motion.div
      ref={cardRef}
      layout
      drag="x"
      dragSnapToOrigin
      dragElastic={0.7}
      onDragEnd={handleDragEnd}
      style={{ x }}
      initial={{ y: 80, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      exit={{ opacity: 0, scale: 0.9 }}
      transition={SPRING}
      onPointerDown={(e: React.PointerEvent) => e.stopPropagation()}
      className="relative h-[420px] flex flex-col bg-gray-900/90 border border-gray-700/60 rounded-lg shadow-lg backdrop-blur-sm overflow-hidden cursor-grab active:cursor-grabbing"
    >
      <CloseButton onClick={() => onDismiss(permission.id)} />
      {shouldShowExpand && <ExpandButton onClick={() => onExpandToModal(permission)} />}

      {questions ? (
        <AskUserQuestionContent
          permission={permission}
          questions={questions}
          remaining={remaining}
          onApprove={onApprove}
          onDeny={onDeny}
        />
      ) : (
        <GenericPermissionContent
          permission={permission}
          remaining={remaining}
          onApprove={onApprove}
          onDeny={onDeny}
        />
      )}
    </motion.div>
  );
}
