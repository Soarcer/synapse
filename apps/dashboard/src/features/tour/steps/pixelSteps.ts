// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Synapse Contributors

import type { TourChapter } from '../constants';

export const pixelChapter: TourChapter = {
  id: 'pixel',
  titleKey: 'tour.chapter.pixel',
  steps: [
    {
      target: '.react-flow__renderer',
      titleKey: 'tour.pixel.overview.title',
      bodyKey: 'tour.pixel.overview.body',
      placement: 'bottom',
    },
    {
      target: '[aria-label="View settings"]',
      titleKey: 'tour.pixel.howToActivate.title',
      bodyKey: 'tour.pixel.howToActivate.body',
      placement: 'bottom',
    },
  ],
};
