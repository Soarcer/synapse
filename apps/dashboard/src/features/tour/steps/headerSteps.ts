// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Bernhard

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
      target: '[aria-label="More actions"]',
      titleKey: 'tour.header.exportImport.title',
      bodyKey: 'tour.header.exportImport.body',
      placement: 'bottom',
    },
  ],
};
