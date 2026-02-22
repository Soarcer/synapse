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
    {
      target: 'nav[aria-label="Lens panels"]',
      titleKey: 'tour.lens.treemap.title',
      bodyKey: 'tour.lens.treemap.body',
      placement: 'top',
      onEnter: () => {
        import('../../../store/agentStore').then(({ useAgentStore }) => {
          useAgentStore.getState().setActiveLensTab('treemap');
        });
      },
    },
    {
      target: 'nav[aria-label="Lens panels"]',
      titleKey: 'tour.lens.sankey.title',
      bodyKey: 'tour.lens.sankey.body',
      placement: 'top',
      onEnter: () => {
        import('../../../store/agentStore').then(({ useAgentStore }) => {
          useAgentStore.getState().setActiveLensTab('sankey');
        });
      },
    },
    {
      target: 'nav[aria-label="Lens panels"]',
      titleKey: 'tour.lens.compaction.title',
      bodyKey: 'tour.lens.compaction.body',
      placement: 'top',
      onEnter: () => {
        import('../../../store/agentStore').then(({ useAgentStore }) => {
          useAgentStore.getState().setActiveLensTab('compaction');
        });
      },
    },
    {
      target: 'nav[aria-label="Lens panels"]',
      titleKey: 'tour.lens.costWaterfall.title',
      bodyKey: 'tour.lens.costWaterfall.body',
      placement: 'top',
      onEnter: () => {
        import('../../../store/agentStore').then(({ useAgentStore }) => {
          useAgentStore.getState().setActiveLensTab('cost');
        });
      },
    },
    {
      target: 'nav[aria-label="Lens panels"]',
      titleKey: 'tour.lens.alerts.title',
      bodyKey: 'tour.lens.alerts.body',
      placement: 'top',
      onEnter: () => {
        import('../../../store/agentStore').then(({ useAgentStore }) => {
          useAgentStore.getState().setActiveLensTab('alerts');
        });
      },
    },
  ],
};
