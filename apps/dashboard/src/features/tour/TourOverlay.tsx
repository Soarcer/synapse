// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Bernhard

import { useEffect, useState, useRef } from 'react';
import { useTourStore } from './tourStore';
import { useAutoPlay } from './useAutoPlay';
import { ALL_CHAPTERS } from './steps';
import { OPTIONAL_CHAPTERS } from './constants';
import { DEMO_EVENTS } from './demoEvents';
import { useAgentStore } from '../../store/agentStore';
import { t } from '../../i18n';

/** Index of the first optional chapter in ALL_CHAPTERS */
const FIRST_OPTIONAL_IDX = ALL_CHAPTERS.findIndex((ch) => OPTIONAL_CHAPTERS.includes(ch.id));

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
  let top = r.top,
    left = r.left,
    right = r.right,
    bottom = r.bottom;

  // Expand to include direct children that overflow the element
  // (e.g., absolutely-positioned dropdown menus below a button wrapper)
  for (const child of el.children) {
    const cr = child.getBoundingClientRect();
    if (cr.width === 0 || cr.height === 0) continue;
    top = Math.min(top, cr.top);
    left = Math.min(left, cr.left);
    right = Math.max(right, cr.right);
    bottom = Math.max(bottom, cr.bottom);
  }

  return { top, left, width: right - left, height: bottom - top };
}

/** Continuously track a DOM element's position (accounts for zoom/pan animations). */
function useTargetRect(selector: string): Rect | null {
  const [rect, setRect] = useState<Rect | null>(null);
  useEffect(() => {
    const update = () => setRect(getTargetRect(selector));
    update();
    // Poll continuously — React Flow zoom/pan animations move elements over time
    const interval = setInterval(update, 120);
    window.addEventListener('resize', update);
    return () => {
      clearInterval(interval);
      window.removeEventListener('resize', update);
    };
  }, [selector]);
  return rect;
}

/**
 * Extract a React Flow node ID from a data-id CSS selector and select it,
 * triggering the built-in fitView zoom. Retries a few times if the DOM
 * element hasn't rendered yet (e.g. after layout changes from onEnter).
 */
function focusGraphNode(selector: string, retries = 5): void {
  // Only handle data-id selectors (graph nodes)
  const match = selector.match(/\[data-id\^="([^"]+)"\]/);
  if (!match) return;

  const el = document.querySelector(selector);
  if (!el) {
    // Element not rendered yet — retry after a short delay
    if (retries > 0) {
      setTimeout(() => focusGraphNode(selector, retries - 1), 200);
    }
    return;
  }
  const nodeId = el.getAttribute('data-id');
  if (!nodeId) return;

  useAgentStore.getState().selectNode(nodeId, 'lens');
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
  const { chapterIndex, stepIndex, nextStep, prevStep, endTour, goToChapter } = useTourStore();
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
    // eslint-disable-next-line react-hooks/exhaustive-deps -- handleNext/handleFinishHere change every render; refs keep them current
  }, [nextStep, prevStep, endTour, showContinuation, isAtOptionalBoundary]);

  // Fire onEnter + zoom to graph node when step changes
  const onEnterRef = useRef(step?.onEnter);
  const targetRef = useRef(target);
  useEffect(() => {
    onEnterRef.current = step?.onEnter;
    targetRef.current = target;
  });
  useEffect(() => {
    onEnterRef.current?.();
    // Zoom to the target node if it's a graph node — uses selectNode('lens')
    // which triggers AgentGraph's built-in fitView animation.
    // Delay lets onEnter actions (like setShowAllTools) take effect first.
    // Retries handle cases where the DOM element hasn't rendered yet.
    const timer = setTimeout(() => focusGraphNode(targetRef.current), 150);
    return () => clearTimeout(timer);
  }, [globalIndex]);

  if (!chapter || !step) return null;

  const isFirst = chapterIndex === 0 && stepIndex === 0;
  const isLast = chapterIndex === ALL_CHAPTERS.length - 1 && stepIndex === chapter.steps.length - 1;

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
          className="absolute border-2 border-violet-500/50 rounded-xl pointer-events-none transition-all duration-400 tour-spotlight-pulse"
          style={{ top: sy, left: sx, width: sw, height: sh }}
        />
      )}

      {/* Floating card */}
      <div
        className="absolute w-80 bg-gradient-to-br from-[#1a1a2e] to-[#16162a] border border-violet-500/30 rounded-xl p-5 shadow-2xl transition-all duration-400 tour-card-enter"
        style={cardStyle}
      >
        <div className="text-[10px] font-semibold text-violet-400 uppercase tracking-wider mb-1">
          {t(chapter.titleKey)}
        </div>
        <div className="text-[15px] font-semibold text-gray-100 mb-2">{t(step.titleKey)}</div>
        <div className="text-[13px] text-gray-400 leading-relaxed mb-4">{t(step.bodyKey)}</div>

        {/* Progress bar */}
        <div className="flex items-center gap-3 mb-3">
          <div className="flex-1 h-1 rounded-full bg-violet-500/15 overflow-hidden">
            <div
              className="h-full rounded-full bg-violet-500 transition-all duration-300"
              style={{ width: `${((globalIndex + 1) / totalSteps) * 100}%` }}
            />
          </div>
          <span className="text-[11px] text-gray-500 tabular-nums whitespace-nowrap">
            {globalIndex + 1}/{totalSteps}
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
    <>
      {/* Full-screen backdrop so the auto-play card is unmissable */}
      <div className="fixed inset-0 z-[9997] bg-black/50 pointer-events-none" />

      {/* Narration card */}
      <div className="fixed bottom-8 left-1/2 -translate-x-1/2 z-[9998] w-96 bg-gradient-to-br from-[#1a1a2e] to-[#16162a] border border-violet-500/30 rounded-xl p-5 shadow-2xl tour-card-enter">
        <div className="text-[10px] font-semibold text-violet-400 uppercase tracking-wider mb-2">
          {t('tour.auto.title')}
        </div>
        <div
          className="text-[13px] text-gray-300 leading-relaxed mb-4 transition-opacity duration-300"
          key={autoPlayIndex}
        >
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
            {t('tour.auto.exploreBtn')}
          </button>
        </div>
      </div>
    </>
  );
}

/** Card dimensions (w-80 = 320px, estimated height ~240px) */
const CARD_W = 320;
const CARD_H = 240;
const VIEWPORT_MARGIN = 12;

function computeCardPosition(rect: Rect | null, placement: string): React.CSSProperties {
  if (!rect) return { top: '50%', left: '50%', transform: 'translate(-50%, -50%)' };

  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const PAD_OFFSET = 24;

  // Compute ideal position for the requested placement
  let top: number;
  let left: number;

  // Try preferred placement, flip if it would overflow
  const effectivePlacement = pickPlacement(rect, placement, vw, vh, PAD_OFFSET);

  switch (effectivePlacement) {
    case 'right':
      top = rect.top;
      left = rect.left + rect.width + PAD_OFFSET;
      break;
    case 'left':
      top = rect.top;
      left = rect.left - CARD_W - PAD_OFFSET;
      break;
    case 'bottom':
      top = rect.top + rect.height + 16;
      left = rect.left + rect.width / 2 - CARD_W / 2;
      break;
    case 'top':
      top = rect.top - CARD_H - 16;
      left = rect.left + rect.width / 2 - CARD_W / 2;
      break;
    default:
      top = rect.top;
      left = rect.left + rect.width + PAD_OFFSET;
  }

  // Clamp to viewport bounds
  top = Math.max(VIEWPORT_MARGIN, Math.min(top, vh - CARD_H - VIEWPORT_MARGIN));
  left = Math.max(VIEWPORT_MARGIN, Math.min(left, vw - CARD_W - VIEWPORT_MARGIN));

  return { top, left };
}

/** Pick the best placement, flipping if the preferred side overflows. */
function pickPlacement(rect: Rect, preferred: string, vw: number, vh: number, pad: number): string {
  const spaceRight = vw - (rect.left + rect.width + pad);
  const spaceLeft = rect.left - pad;
  const spaceBottom = vh - (rect.top + rect.height + 16);
  const spaceTop = rect.top - 16;

  switch (preferred) {
    case 'right':
      if (spaceRight >= CARD_W) return 'right';
      if (spaceLeft >= CARD_W) return 'left';
      return spaceBottom >= CARD_H ? 'bottom' : 'top';
    case 'left':
      if (spaceLeft >= CARD_W) return 'left';
      if (spaceRight >= CARD_W) return 'right';
      return spaceBottom >= CARD_H ? 'bottom' : 'top';
    case 'bottom':
      if (spaceBottom >= CARD_H) return 'bottom';
      if (spaceTop >= CARD_H) return 'top';
      return spaceRight >= CARD_W ? 'right' : 'left';
    case 'top':
      if (spaceTop >= CARD_H) return 'top';
      if (spaceBottom >= CARD_H) return 'bottom';
      return spaceRight >= CARD_W ? 'right' : 'left';
    default:
      return preferred;
  }
}
