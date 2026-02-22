// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Synapse Contributors

// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { createElement } from 'react';
import { TourOverlay } from '../TourOverlay';
import { useTourStore } from '../tourStore';

describe('TourOverlay', () => {
  beforeEach(() => {
    useTourStore.setState(useTourStore.getInitialState());
    document.body.innerHTML = '';
  });

  it('renders nothing when tour is inactive', () => {
    const { container } = render(createElement(TourOverlay));
    expect(container.firstChild).toBeNull();
  });

  it('renders card when tour is active in manual phase', () => {
    useTourStore.getState().startTour();
    useTourStore.getState().transitionToManual();

    render(createElement(TourOverlay));
    // The card should show Next and Skip buttons using i18n keys
    expect(screen.getByText('Next')).toBeTruthy();
    expect(screen.getByText('Skip tour')).toBeTruthy();
  });

  it('advances step on Next click', () => {
    useTourStore.getState().startTour();
    useTourStore.getState().transitionToManual();

    render(createElement(TourOverlay));
    fireEvent.click(screen.getByText('Next'));
    expect(useTourStore.getState().stepIndex).toBe(1);
  });

  it('ends tour on Skip click', () => {
    useTourStore.getState().startTour();
    useTourStore.getState().transitionToManual();
    render(createElement(TourOverlay));
    fireEvent.click(screen.getByText('Skip tour'));
    expect(useTourStore.getState().active).toBe(false);
  });

  it('supports keyboard navigation (ArrowRight = next, Escape = end)', () => {
    useTourStore.getState().startTour();
    useTourStore.getState().transitionToManual();
    render(createElement(TourOverlay));

    fireEvent.keyDown(window, { key: 'ArrowRight' });
    expect(useTourStore.getState().stepIndex).toBe(1);

    fireEvent.keyDown(window, { key: 'Escape' });
    expect(useTourStore.getState().active).toBe(false);
  });

  it('renders card centered when target element is missing', () => {
    useTourStore.getState().startTour();
    useTourStore.getState().transitionToManual();
    // No DOM elements matching the tour step selectors exist
    const { container } = render(createElement(TourOverlay));
    // The card should still render (fallback centered position)
    const card = container.querySelector('[role="dialog"]');
    expect(card).toBeTruthy();
    // Next and Skip should still be present
    expect(screen.getByText('Next')).toBeTruthy();
    expect(screen.getByText('Skip tour')).toBeTruthy();
  });

  it('renders narration during auto-play phase', () => {
    useTourStore.getState().startTour();
    // phase is autoPlay by default after startTour
    expect(useTourStore.getState().phase).toBe('autoPlay');

    render(createElement(TourOverlay));
    // AutoPlayOverlay should show the "Auto-Play Demo" heading
    expect(screen.getByText('Auto-Play Demo')).toBeTruthy();
    // Should show the initial narration text (tour.auto.sessionStart)
    expect(
      screen.getByText(
        'A Claude Code session just started — every session gets its own root node.',
      ),
    ).toBeTruthy();
    // Should show the skip button
    expect(screen.getByText('Skip tour')).toBeTruthy();
  });

  it('Escape during auto-play ends the tour', () => {
    useTourStore.getState().startTour();
    expect(useTourStore.getState().phase).toBe('autoPlay');

    render(createElement(TourOverlay));
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(useTourStore.getState().active).toBe(false);
    expect(useTourStore.getState().phase).toBe('idle');
  });

  it('ArrowLeft at first step does nothing', () => {
    useTourStore.getState().startTour();
    useTourStore.getState().transitionToManual();
    // Confirm we're at the very first step
    expect(useTourStore.getState().chapterIndex).toBe(0);
    expect(useTourStore.getState().stepIndex).toBe(0);

    render(createElement(TourOverlay));
    fireEvent.keyDown(window, { key: 'ArrowLeft' });

    // Should remain at the same position
    expect(useTourStore.getState().chapterIndex).toBe(0);
    expect(useTourStore.getState().stepIndex).toBe(0);
  });
});
