// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Bernhard

import type { TourChapter } from '../constants';

export const analyticsChapter: TourChapter = {
  id: 'analytics',
  titleKey: 'tour.chapter.analytics',
  steps: [
    {
      target: '[href="?view=analytics"]',
      titleKey: 'tour.analytics.overview.title',
      bodyKey: 'tour.analytics.overview.body',
      placement: 'bottom',
    },
    {
      target: '[href="?view=analytics"]',
      titleKey: 'tour.analytics.navigation.title',
      bodyKey: 'tour.analytics.navigation.body',
      placement: 'bottom',
    },
  ],
};
