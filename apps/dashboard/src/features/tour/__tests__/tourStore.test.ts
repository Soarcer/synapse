// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Synapse Contributors

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
});
