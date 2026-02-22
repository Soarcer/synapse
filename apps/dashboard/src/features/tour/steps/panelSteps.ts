// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Synapse Contributors

import type { TourChapter } from '../constants';

export const panelChapter: TourChapter = {
  id: 'panels',
  titleKey: 'tour.chapter.panels',
  steps: [
    {
      target: '[data-id^="agent-"]',
      titleKey: 'tour.panels.selectNode.title',
      bodyKey: 'tour.panels.selectNode.body',
      placement: 'right',
    },
    {
      target: '[aria-label="Agent detail panel"]',
      titleKey: 'tour.panels.agentDetail.title',
      bodyKey: 'tour.panels.agentDetail.body',
      placement: 'left',
    },
    {
      target: '[aria-label="Reasoning section"]',
      titleKey: 'tour.panels.reasoning.title',
      bodyKey: 'tour.panels.reasoning.body',
      placement: 'left',
    },
    {
      target: '[aria-label="Timeline panel"]',
      titleKey: 'tour.panels.timeline.title',
      bodyKey: 'tour.panels.timeline.body',
      placement: 'top',
    },
    {
      target: '[aria-label="Tool log panel"]',
      titleKey: 'tour.panels.toolLog.title',
      bodyKey: 'tour.panels.toolLog.body',
      placement: 'left',
    },
    {
      target: '.react-flow__renderer',
      titleKey: 'tour.panels.keyboardNav.title',
      bodyKey: 'tour.panels.keyboardNav.body',
      placement: 'bottom',
    },
  ],
};
