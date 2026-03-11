// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Bernhard

// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { useTourStore } from '../tourStore';

describe('tourStore', () => {
  beforeEach(() => {
    useTourStore.setState(useTourStore.getInitialState());
    localStorage.clear();
  });

  it('starts inactive', () => {
    expect(useTourStore.getState().active).toBe(false);
    expect(useTourStore.getState().phase).toBe('idle');
  });

  it('startTour transitions to autoPlay phase', () => {
    useTourStore.getState().startTour();
    expect(useTourStore.getState().active).toBe(true);
    expect(useTourStore.getState().phase).toBe('autoPlay');
    expect(useTourStore.getState().chapterIndex).toBe(0);
    expect(useTourStore.getState().stepIndex).toBe(0);
  });

  it('nextStep advances within a chapter', () => {
    useTourStore.getState().startTour();
    useTourStore.getState().transitionToManual(); // skip auto-play
    useTourStore.getState().nextStep();
    expect(useTourStore.getState().stepIndex).toBe(1);
  });

  it('prevStep does not go below 0', () => {
    useTourStore.getState().startTour();
    useTourStore.getState().transitionToManual();
    useTourStore.getState().prevStep();
    expect(useTourStore.getState().stepIndex).toBe(0);
  });

  it('endTour resets state and marks completed in localStorage', () => {
    useTourStore.getState().startTour();
    useTourStore.getState().endTour();
    expect(useTourStore.getState().active).toBe(false);
    expect(useTourStore.getState().phase).toBe('idle');
    expect(localStorage.getItem('synapse-tour-completed')).toBe('1');
  });

  it('nextStep advances to next chapter when at end of current', () => {
    useTourStore.getState().startTour();
    useTourStore.getState().transitionToManual();
    const chapterLen = useTourStore.getState().currentChapterLength();
    for (let i = 0; i < chapterLen; i++) {
      useTourStore.getState().nextStep();
    }
    expect(useTourStore.getState().chapterIndex).toBe(1);
    expect(useTourStore.getState().stepIndex).toBe(0);
  });

  it('hasCompleted reads localStorage', () => {
    expect(useTourStore.getState().hasCompleted()).toBe(false);
    localStorage.setItem('synapse-tour-completed', '1');
    expect(useTourStore.getState().hasCompleted()).toBe(true);
  });

  it('tour restart after completion works correctly', () => {
    useTourStore.getState().startTour();
    useTourStore.getState().transitionToManual();
    useTourStore.getState().nextStep();
    useTourStore.getState().endTour();
    expect(useTourStore.getState().active).toBe(false);
    expect(useTourStore.getState().phase).toBe('idle');

    // Restart should reinitialize cleanly
    useTourStore.getState().startTour();
    expect(useTourStore.getState().active).toBe(true);
    expect(useTourStore.getState().phase).toBe('autoPlay');
    expect(useTourStore.getState().chapterIndex).toBe(0);
    expect(useTourStore.getState().stepIndex).toBe(0);
    expect(useTourStore.getState().autoPlayIndex).toBe(0);
  });

  it('chapter boundary transition: last step of ch0 → first step of ch1', () => {
    useTourStore.getState().startTour();
    useTourStore.getState().transitionToManual();

    // Chapter 0 (graph) has 5 steps — advance to last
    const ch0Len = useTourStore.getState().currentChapterLength();
    expect(ch0Len).toBe(5);
    for (let i = 0; i < ch0Len - 1; i++) {
      useTourStore.getState().nextStep();
    }
    expect(useTourStore.getState().chapterIndex).toBe(0);
    expect(useTourStore.getState().stepIndex).toBe(ch0Len - 1);

    // One more nextStep crosses into chapter 1
    useTourStore.getState().nextStep();
    expect(useTourStore.getState().chapterIndex).toBe(1);
    expect(useTourStore.getState().stepIndex).toBe(0);
  });

  it('prevStep at chapter boundary goes to last step of previous chapter', () => {
    useTourStore.getState().startTour();
    useTourStore.getState().transitionToManual();

    // Move to chapter 1, step 0
    const ch0Len = useTourStore.getState().currentChapterLength();
    for (let i = 0; i < ch0Len; i++) {
      useTourStore.getState().nextStep();
    }
    expect(useTourStore.getState().chapterIndex).toBe(1);
    expect(useTourStore.getState().stepIndex).toBe(0);

    // prevStep should go back to chapter 0, last step
    useTourStore.getState().prevStep();
    expect(useTourStore.getState().chapterIndex).toBe(0);
    expect(useTourStore.getState().stepIndex).toBe(ch0Len - 1);
  });

  it('nextStep at final step of final chapter ends the tour', () => {
    useTourStore.getState().startTour();
    useTourStore.getState().transitionToManual();

    // Navigate to the very last step of the last chapter
    const totalSteps = useTourStore.getState().totalSteps();
    for (let i = 0; i < totalSteps - 1; i++) {
      useTourStore.getState().nextStep();
    }
    // Verify we're on the last chapter, last step
    expect(useTourStore.getState().chapterIndex).toBe(5); // analyticsChapter (index 5)
    expect(useTourStore.getState().stepIndex).toBe(1); // last step (2 steps, index 1)
    expect(useTourStore.getState().active).toBe(true);

    // One more nextStep should end the tour
    useTourStore.getState().nextStep();
    expect(useTourStore.getState().active).toBe(false);
    expect(useTourStore.getState().phase).toBe('idle');
    expect(localStorage.getItem('synapse-tour-completed')).toBe('1');
  });

  it('goToChapter sets correct state', () => {
    useTourStore.getState().startTour();
    useTourStore.getState().transitionToManual();

    useTourStore.getState().goToChapter(2);
    expect(useTourStore.getState().chapterIndex).toBe(2);
    expect(useTourStore.getState().stepIndex).toBe(0);

    useTourStore.getState().goToChapter(5);
    expect(useTourStore.getState().chapterIndex).toBe(5);
    expect(useTourStore.getState().stepIndex).toBe(0);
  });

  it('advanceAutoPlay increments autoPlayIndex', () => {
    useTourStore.getState().startTour();
    expect(useTourStore.getState().autoPlayIndex).toBe(0);

    useTourStore.getState().advanceAutoPlay();
    expect(useTourStore.getState().autoPlayIndex).toBe(1);

    useTourStore.getState().advanceAutoPlay();
    expect(useTourStore.getState().autoPlayIndex).toBe(2);

    useTourStore.getState().advanceAutoPlay();
    expect(useTourStore.getState().autoPlayIndex).toBe(3);
  });

  it('globalStepIndex sums previous chapter lengths + current stepIndex', () => {
    useTourStore.getState().startTour();
    useTourStore.getState().transitionToManual();

    // At ch0, step 0 → globalStepIndex should be 0
    expect(useTourStore.getState().globalStepIndex()).toBe(0);

    // Advance a few steps within chapter 0
    useTourStore.getState().nextStep();
    useTourStore.getState().nextStep();
    expect(useTourStore.getState().globalStepIndex()).toBe(2);

    // Move to chapter 1, step 0 → globalStepIndex = ch0.length (5)
    useTourStore.getState().goToChapter(1);
    expect(useTourStore.getState().globalStepIndex()).toBe(5);

    // Move to chapter 2, step 0 → globalStepIndex = ch0 (5) + ch1 (3) = 8
    useTourStore.getState().goToChapter(2);
    expect(useTourStore.getState().globalStepIndex()).toBe(8);

    // Advance 2 steps into chapter 2 → 8 + 2 = 10
    useTourStore.getState().nextStep();
    useTourStore.getState().nextStep();
    expect(useTourStore.getState().globalStepIndex()).toBe(10);
  });

  it('totalSteps sums all chapter step counts', () => {
    // 5 + 3 + 3 + 3 + 2 + 2 = 18
    expect(useTourStore.getState().totalSteps()).toBe(18);
  });
});
