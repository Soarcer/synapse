// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Synapse Contributors

import type { TourChapter } from '../constants';

export const lensChapter: TourChapter = {
  id: 'lens',
  titleKey: 'tour.chapter.lens',
  steps: [
    {
      target: 'nav[aria-label="Lens panels"]',
      titleKey: 'tour.lens.overview.title',
      bodyKey: 'tour.lens.overview.body',
      placement: 'top',
    },
    {
      target: 'nav[aria-label="Lens panels"]',
      titleKey: 'tour.lens.treeView.title',
      bodyKey: 'tour.lens.treeView.body',
      placement: 'top',
      onEnter: () => {
        import('../../../store/agentStore').then(({ useAgentStore }) => {
          useAgentStore.getState().setActiveLensTab('tree');
        });
      },
    },
    {
      target: 'nav[aria-label="Lens panels"]',
      titleKey: 'tour.lens.heatmap.title',
      bodyKey: 'tour.lens.heatmap.body',
      placement: 'top',
      onEnter: () => {
        import('../../../store/agentStore').then(({ useAgentStore }) => {
          useAgentStore.getState().setActiveLensTab('heatmap');
        });
      },
    },
  ],
};
