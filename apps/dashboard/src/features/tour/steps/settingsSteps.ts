// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Synapse Contributors

import type { TourChapter } from '../constants';

export const settingsChapter: TourChapter = {
  id: 'settings',
  titleKey: 'tour.chapter.settings',
  steps: [
    {
      target: '[aria-label="View settings"]',
      titleKey: 'tour.settings.overview.title',
      bodyKey: 'tour.settings.overview.body',
      placement: 'bottom',
    },
    {
      target: '[aria-label="View settings"]',
      titleKey: 'tour.settings.lockViewport.title',
      bodyKey: 'tour.settings.lockViewport.body',
      placement: 'bottom',
    },
    {
      target: '[aria-label="View settings"]',
      titleKey: 'tour.settings.expandTools.title',
      bodyKey: 'tour.settings.expandTools.body',
      placement: 'bottom',
    },
    {
      target: '[aria-label="View settings"]',
      titleKey: 'tour.settings.hookEvents.title',
      bodyKey: 'tour.settings.hookEvents.body',
      placement: 'bottom',
    },
    {
      target: '[aria-label="View settings"]',
      titleKey: 'tour.settings.autoClosePrompts.title',
      bodyKey: 'tour.settings.autoClosePrompts.body',
      placement: 'bottom',
    },
    {
      target: '[aria-label="View settings"]',
      titleKey: 'tour.settings.toolViewModes.title',
      bodyKey: 'tour.settings.toolViewModes.body',
      placement: 'bottom',
    },
  ],
};
