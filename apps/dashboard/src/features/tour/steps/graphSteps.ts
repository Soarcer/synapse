// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Bernhard

import type { TourChapter } from '../constants';

export const graphChapter: TourChapter = {
  id: 'graph',
  titleKey: 'tour.chapter.graph',
  steps: [
    {
      target: '[data-id^="session-"]',
      titleKey: 'tour.graph.sessionNode.title',
      bodyKey: 'tour.graph.sessionNode.body',
      placement: 'right',
    },
    {
      target: '[data-id^="prompt-"]',
      titleKey: 'tour.graph.promptNode.title',
      bodyKey: 'tour.graph.promptNode.body',
      placement: 'right',
    },
    {
      target: '[data-id^="agent-"]',
      titleKey: 'tour.graph.agentNode.title',
      bodyKey: 'tour.graph.agentNode.body',
      placement: 'right',
    },
    {
      target: '[data-id^="toolgroup-"]',
      titleKey: 'tour.graph.toolGroup.title',
      bodyKey: 'tour.graph.toolGroup.body',
      placement: 'bottom',
    },
    {
      target: '#graph-search-input',
      titleKey: 'tour.graph.search.title',
      bodyKey: 'tour.graph.search.body',
      placement: 'bottom',
    },
  ],
};
