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
});
