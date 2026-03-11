// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Bernhard

import { create } from 'zustand';
import { LS_KEY_COMPLETED, type TourPhase } from './constants';
import { ALL_CHAPTERS } from './steps';

interface TourState {
  active: boolean;
  phase: TourPhase;
  chapterIndex: number;
  stepIndex: number;
  autoPlayIndex: number;

  startTour: () => void;
  endTour: () => void;
  transitionToManual: () => void;
  nextStep: () => void;
  prevStep: () => void;
  goToChapter: (chapterIndex: number) => void;
  advanceAutoPlay: () => void;
  currentChapterLength: () => number;
  totalSteps: () => number;
  globalStepIndex: () => number;
  hasCompleted: () => boolean;
}

export const useTourStore = create<TourState>()((set, get) => ({
  active: false,
  phase: 'idle' as TourPhase,
  chapterIndex: 0,
  stepIndex: 0,
  autoPlayIndex: 0,

  startTour: () =>
    set({ active: true, phase: 'autoPlay', chapterIndex: 0, stepIndex: 0, autoPlayIndex: 0 }),

  endTour: () => {
    localStorage.setItem(LS_KEY_COMPLETED, '1');
    set({ active: false, phase: 'idle', chapterIndex: 0, stepIndex: 0, autoPlayIndex: 0 });
  },

  transitionToManual: () => set({ phase: 'manual', chapterIndex: 0, stepIndex: 0 }),

  nextStep: () => {
    const { chapterIndex, stepIndex } = get();
    const chapterLen = get().currentChapterLength();
    if (stepIndex < chapterLen - 1) {
      set({ stepIndex: stepIndex + 1 });
    } else if (chapterIndex < ALL_CHAPTERS.length - 1) {
      set({ chapterIndex: chapterIndex + 1, stepIndex: 0 });
    } else {
      get().endTour();
    }
  },

  prevStep: () => {
    const { chapterIndex, stepIndex } = get();
    if (stepIndex > 0) {
      set({ stepIndex: stepIndex - 1 });
    } else if (chapterIndex > 0) {
      const prevLen = ALL_CHAPTERS[chapterIndex - 1].steps.length;
      set({ chapterIndex: chapterIndex - 1, stepIndex: prevLen - 1 });
    }
  },

  goToChapter: (idx: number) => set({ chapterIndex: idx, stepIndex: 0 }),

  advanceAutoPlay: () => set((s) => ({ autoPlayIndex: s.autoPlayIndex + 1 })),

  currentChapterLength: () => ALL_CHAPTERS[get().chapterIndex]?.steps.length ?? 0,

  totalSteps: () => ALL_CHAPTERS.reduce((sum, ch) => sum + ch.steps.length, 0),

  globalStepIndex: () => {
    const { chapterIndex, stepIndex } = get();
    let total = 0;
    for (let i = 0; i < chapterIndex; i++) total += ALL_CHAPTERS[i].steps.length;
    return total + stepIndex;
  },

  hasCompleted: () => localStorage.getItem(LS_KEY_COMPLETED) === '1',
}));
