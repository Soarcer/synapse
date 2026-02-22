// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Synapse Contributors

import type { TourChapter } from '../constants';

export const headerChapter: TourChapter = {
  id: 'header',
  titleKey: 'tour.chapter.header',
  steps: [
    {
      target: '.connection-status',
      titleKey: 'tour.header.connectionStatus.title',
      bodyKey: 'tour.header.connectionStatus.body',
      placement: 'bottom',
    },
    {
      target: '[aria-label="Session selector"]',
      titleKey: 'tour.header.sessionSelector.title',
      bodyKey: 'tour.header.sessionSelector.body',
      placement: 'bottom',
    },
    {
      target: '[aria-label="Time range filter"]',
      titleKey: 'tour.header.timeFilter.title',
      bodyKey: 'tour.header.timeFilter.body',
      placement: 'bottom',
    },
    {
      target: '[aria-label="Pause live updates"]',
      titleKey: 'tour.header.pauseResume.title',
      bodyKey: 'tour.header.pauseResume.body',
      placement: 'bottom',
    },
    {
      target: '.graph-stats',
      titleKey: 'tour.header.graphStats.title',
      bodyKey: 'tour.header.graphStats.body',
      placement: 'bottom',
    },
    {
      target: '[aria-label="More actions"]',
      titleKey: 'tour.header.exportImport.title',
      bodyKey: 'tour.header.exportImport.body',
      placement: 'bottom',
    },
    {
      target: '[aria-label="Keyboard shortcuts"]',
      titleKey: 'tour.header.shortcuts.title',
      bodyKey: 'tour.header.shortcuts.body',
      placement: 'bottom',
    },
  ],
};
