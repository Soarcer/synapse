// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Synapse Contributors

import type { TourChapter } from '../constants';

/** Select an agent node so the detail panel opens. */
function selectDemoAgent(): void {
  import('../../../store/agentStore').then(({ useAgentStore }) => {
    useAgentStore.getState().selectNode('agent-tour-agent-explore', 'graph');
  });
}

/** Expand the timeline panel if it's collapsed. */
function expandTimeline(): void {
  const panel = document.querySelector('[aria-label="Timeline panel"]');
  if (!panel) return;
  // Check if there's no expanded content — the button is the toggle
  const btn = panel.querySelector('button');
  const content = panel.querySelector('.overflow-auto');
  if (btn && !content) btn.click();
}

export const panelChapter: TourChapter = {
  id: 'panels',
  titleKey: 'tour.chapter.panels',
  steps: [
    {
      target: '[aria-label="Agent detail panel"]',
      titleKey: 'tour.panels.agentDetail.title',
      bodyKey: 'tour.panels.agentDetail.body',
      placement: 'left',
      onEnter: selectDemoAgent,
    },
    {
      target: '[aria-label="Agent detail panel"]',
      titleKey: 'tour.panels.reasoning.title',
      bodyKey: 'tour.panels.reasoning.body',
      placement: 'left',
      onEnter: selectDemoAgent,
    },
    {
      target: '[aria-label="Timeline panel"]',
      titleKey: 'tour.panels.timeline.title',
      bodyKey: 'tour.panels.timeline.body',
      placement: 'top',
      onEnter: expandTimeline,
    },
  ],
};
