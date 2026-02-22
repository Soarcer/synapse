// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Synapse Contributors

import { useEffect, useState, useRef } from 'react';
import { useTourStore } from './tourStore';
import { useAutoPlay } from './useAutoPlay';
import { ALL_CHAPTERS } from './steps';
import { OPTIONAL_CHAPTERS } from './constants';
import { DEMO_EVENTS } from './demoEvents';
import { t } from '../../i18n';

/** Index of the first optional chapter in ALL_CHAPTERS */
const FIRST_OPTIONAL_IDX = ALL_CHAPTERS.findIndex((ch) =>
  OPTIONAL_CHAPTERS.includes(ch.id),
);

interface Rect {
  top: number;
  left: number;
  width: number;
  height: number;
}

const PAD = 10;

function getTargetRect(selector: string): Rect | null {
  const el = document.querySelector(selector);
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return { top: r.top, left: r.left, width: r.width, height: r.height };
}

function useTargetRect(selector: string): Rect | null {
  const [rect, setRect] = useState<Rect | null>(null);
  useEffect(() => {
    const update = () => setRect(getTargetRect(selector));
    update();
    const interval = setInterval(update, 200);
    const timeout = setTimeout(() => clearInterval(interval), 3000);
    window.addEventListener('resize', update);
    return () => {
      clearInterval(interval);
      clearTimeout(timeout);
      window.removeEventListener('resize', update);
    };
  }, [selector]);
  return rect;
}

export function TourOverlay() {
  useAutoPlay(); // drives auto-play event injection

  const active = useTourStore((s) => s.active);
  const phase = useTourStore((s) => s.phase);

  if (active && phase === 'autoPlay') {
    return <AutoPlayOverlay />;
  }

  if (!active || phase !== 'manual') return null;

  return <ManualOverlay />;
}

function ManualOverlay() {
  const { chapterIndex, stepIndex, nextStep, prevStep, endTour, goToChapter } =
    useTourStore();
  const globalIndex = useTourStore((s) => s.globalStepIndex());
  const totalSteps = useTourStore((s) => s.totalSteps());
  const [showContinuation, setShowContinuation] = useState(false);

  const chapter = ALL_CHAPTERS[chapterIndex];
  const step = chapter?.steps[stepIndex];

  const target = step?.target ?? '';
  const rect = useTargetRect(target);

  // Check if we're at the boundary before optional chapters
  const isAtOptionalBoundary =
    FIRST_OPTIONAL_IDX > 0 &&
    chapterIndex === FIRST_OPTIONAL_IDX - 1 &&
    stepIndex === (chapter?.steps.length ?? 1) - 1;

  const handleNext = () => {
    if (isAtOptionalBoundary && !showContinuation) {
      setShowContinuation(true);
    } else {
      setShowContinuation(false);
      nextStep();
    }
  };

  const handleContinue = () => {
    setShowContinuation(false);
    goToChapter(FIRST_OPTIONAL_IDX);
  };

  const handleFinishHere = () => {
    setShowContinuation(false);
    endTour();
  };

  // Keyboard navigation
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (showContinuation) {
        if (e.key === 'Escape') handleFinishHere();
        return;
      }
      if (e.key === 'ArrowRight' || e.key === ' ') {
        e.preventDefault();
        handleNext();
      }
      if (e.key === 'ArrowLeft') {
        e.preventDefault();
        prevStep();
      }
      if (e.key === 'Escape') {
        endTour();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [nextStep, prevStep, endTour, showContinuation, isAtOptionalBoundary]);

  // Fire onEnter when step changes
  const onEnterRef = useRef(step?.onEnter);
  onEnterRef.current = step?.onEnter;
  useEffect(() => {
    onEnterRef.current?.();
  }, [globalIndex]);

  if (!chapter || !step) return null;

  const isFirst = chapterIndex === 0 && stepIndex === 0;
  const isLast =
    chapterIndex === ALL_CHAPTERS.length - 1 &&
    stepIndex === chapter.steps.length - 1;

  // Spotlight dimensions (padded)
  const sx = rect ? rect.left - PAD : -9999;
  const sy = rect ? rect.top - PAD : -9999;
  const sw = rect ? rect.width + PAD * 2 : 0;
  const sh = rect ? rect.height + PAD * 2 : 0;

  const cardStyle = computeCardPosition(rect, step.placement);

  return (
    <div className="fixed inset-0 z-[9998]" aria-modal="true" role="dialog">
      {/* Dimmer with clip-path cutout */}
      <div
        className="absolute inset-0 bg-black/75 transition-[clip-path] duration-400"
        style={{
          clipPath: rect
            ? `polygon(0% 0%, 100% 0%, 100% 100%, 0% 100%, 0% 0%, ${sx}px ${sy}px, ${sx}px ${sy + sh}px, ${sx + sw}px ${sy + sh}px, ${sx + sw}px ${sy}px, ${sx}px ${sy}px)`
            : undefined,
        }}
      />

      {/* Spotlight ring */}
      {rect && (
        <div
          className="absolute border-2 border-violet-500/50 rounded-xl pointer-events-none transition-all duration-400"
          style={{ top: sy, left: sx, width: sw, height: sh }}
        />
      )}

      {/* Floating card */}
      <div
        className="absolute w-80 bg-gradient-to-br from-[#1a1a2e] to-[#16162a] border border-violet-500/30 rounded-xl p-5 shadow-2xl transition-all duration-400"
        style={cardStyle}
      >
        <div className="text-[10px] font-semibold text-violet-400 uppercase tracking-wider mb-1">
          {t(chapter.titleKey)}
        </div>
        <div className="text-[15px] font-semibold text-gray-100 mb-2">
          {t(step.titleKey)}
        </div>
        <div className="text-[13px] text-gray-400 leading-relaxed mb-4">
          {t(step.bodyKey)}
        </div>

        {/* Progress */}
        <div className="flex items-center justify-between mb-3">
          <div className="flex gap-1">
            {Array.from({ length: totalSteps }, (_, i) => (
              <span
                key={i}
                className={`w-1.5 h-1.5 rounded-full ${i === globalIndex ? 'bg-violet-500' : i < globalIndex ? 'bg-violet-500/50' : 'bg-violet-500/15'}`}
              />
            ))}
          </div>
          <span className="text-[11px] text-gray-500">
            {globalIndex + 1} / {totalSteps}
          </span>
        </div>

        {/* Buttons or continuation prompt */}
        {showContinuation ? (
          <div>
            <div className="text-[13px] text-gray-300 leading-relaxed mb-3">
              {t('tour.continue.body')}
            </div>
            <div className="flex gap-2 justify-end">
              <button
                onClick={handleFinishHere}
                className="px-3 py-1.5 rounded-md border border-gray-700 text-gray-400 text-xs hover:border-gray-500 hover:text-gray-200 transition-colors"
              >
                {t('tour.continue.no')}
              </button>
              <button
                onClick={handleContinue}
                className="px-4 py-1.5 rounded-md bg-violet-600 text-white text-xs font-semibold hover:bg-violet-500 transition-colors"
              >
                {t('tour.continue.yes')}
              </button>
            </div>
          </div>
        ) : (
          <div className="flex items-center justify-between">
            <div className="flex gap-2">
              {!isFirst && (
                <button
                  onClick={prevStep}
                  className="px-3 py-1.5 rounded-md border border-gray-700 text-gray-400 text-xs hover:border-gray-500 hover:text-gray-200 transition-colors"
                >
                  {t('tour.prev')}
                </button>
              )}
              <button
                onClick={endTour}
                className="px-3 py-1.5 text-gray-600 text-xs hover:text-gray-400 transition-colors"
              >
                {t('tour.skip')}
              </button>
            </div>
            <button
              onClick={handleNext}
              className="px-4 py-1.5 rounded-md bg-violet-600 text-white text-xs font-semibold hover:bg-violet-500 transition-colors"
            >
              {isLast ? t('tour.finish') : t('tour.next')}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function AutoPlayOverlay() {
  const endTour = useTourStore((s) => s.endTour);
  const transitionToManual = useTourStore((s) => s.transitionToManual);
  const autoPlayIndex = useTourStore((s) => s.autoPlayIndex);

  // Find the current narration key based on autoPlayIndex
  // autoPlayIndex counts how many narrated events have fired so far
  const narratedEvents = DEMO_EVENTS.filter((e) => e.narrationKey !== null);
  const currentNarration = narratedEvents[autoPlayIndex - 1]?.narrationKey;
  const narrationText = currentNarration ? t(currentNarration) : t('tour.auto.sessionStart');

  // Keyboard: only Escape works during auto-play
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') endTour();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [endTour]);

  return (
    <div className="fixed bottom-8 left-1/2 -translate-x-1/2 z-[9998] w-96 bg-gradient-to-br from-[#1a1a2e] to-[#16162a] border border-violet-500/30 rounded-xl p-5 shadow-2xl">
      <div className="text-[10px] font-semibold text-violet-400 uppercase tracking-wider mb-2">
        Auto-Play Demo
      </div>
      <div className="text-[13px] text-gray-300 leading-relaxed mb-4 transition-opacity duration-300" key={autoPlayIndex}>
        {narrationText}
      </div>
      <div className="flex justify-between">
        <button
          onClick={endTour}
          className="px-3 py-1.5 text-gray-600 text-xs hover:text-gray-400 transition-colors"
        >
          {t('tour.skip')}
        </button>
        <button
          onClick={transitionToManual}
          className="px-4 py-1.5 rounded-md bg-violet-600 text-white text-xs font-semibold hover:bg-violet-500 transition-colors"
        >
          Start exploring →
        </button>
      </div>
    </div>
  );
}

function computeCardPosition(
  rect: Rect | null,
  placement: string,
): React.CSSProperties {
  if (!rect)
    return { top: '50%', left: '50%', transform: 'translate(-50%, -50%)' };
  const PAD_OFFSET = 24;
  switch (placement) {
    case 'right':
      return { top: rect.top, left: rect.left + rect.width + PAD_OFFSET };
    case 'left':
      return { top: rect.top, left: rect.left - 320 - PAD_OFFSET };
    case 'bottom':
      return {
        top: rect.top + rect.height + 16,
        left: rect.left + rect.width / 2 - 160,
      };
    case 'top':
      return {
        top: rect.top - 200,
        left: rect.left + rect.width / 2 - 160,
      };
    default:
      return { top: rect.top, left: rect.left + rect.width + PAD_OFFSET };
  }
}
