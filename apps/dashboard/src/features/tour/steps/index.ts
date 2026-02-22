// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Synapse Contributors
//
// Placeholder step definitions — will be replaced in Task 3 with real tour content.

import type { TourChapter } from '../constants';

export const ALL_CHAPTERS: TourChapter[] = [
  {
    id: 'welcome',
    titleKey: 'tour.chapter.welcome.title',
    steps: [
      {
        target: 'header',
        titleKey: 'tour.welcome.step1.title',
        bodyKey: 'tour.welcome.step1.body',
        placement: 'bottom',
      },
      {
        target: 'graph-canvas',
        titleKey: 'tour.welcome.step2.title',
        bodyKey: 'tour.welcome.step2.body',
        placement: 'bottom',
      },
    ],
  },
  {
    id: 'navigation',
    titleKey: 'tour.chapter.navigation.title',
    steps: [
      {
        target: 'session-selector',
        titleKey: 'tour.navigation.step1.title',
        bodyKey: 'tour.navigation.step1.body',
        placement: 'right',
      },
      {
        target: 'lens-tabs',
        titleKey: 'tour.navigation.step2.title',
        bodyKey: 'tour.navigation.step2.body',
        placement: 'top',
      },
    ],
  },
];
