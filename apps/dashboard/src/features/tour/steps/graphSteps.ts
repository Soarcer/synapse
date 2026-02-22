// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Synapse Contributors

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
      titleKey: 'tour.graph.toolGroupCollapsed.title',
      bodyKey: 'tour.graph.toolGroupCollapsed.body',
      placement: 'bottom',
    },
    {
      target: '[data-id^="toolgroup-"]',
      titleKey: 'tour.graph.toolGroupExpanded.title',
      bodyKey: 'tour.graph.toolGroupExpanded.body',
      placement: 'bottom',
      onEnter: () => {
        import('../../../store/agentStore').then(({ useAgentStore }) => {
          useAgentStore.getState().setShowAllTools(true);
        });
      },
    },
    {
      target: '[data-id^="tool-"]',
      titleKey: 'tour.graph.structuralTool.title',
      bodyKey: 'tour.graph.structuralTool.body',
      placement: 'right',
    },
    {
      target: '.react-flow__edge',
      titleKey: 'tour.graph.edges.title',
      bodyKey: 'tour.graph.edges.body',
      placement: 'top',
    },
    {
      target: '.edge-cost-badge',
      titleKey: 'tour.graph.costBadge.title',
      bodyKey: 'tour.graph.costBadge.body',
      placement: 'top',
    },
    {
      target: '[data-id^="spawn-"]',
      titleKey: 'tour.graph.spawnAgent.title',
      bodyKey: 'tour.graph.spawnAgent.body',
      placement: 'left',
    },
    {
      target: '#graph-search-input',
      titleKey: 'tour.graph.search.title',
      bodyKey: 'tour.graph.search.body',
      placement: 'bottom',
    },
  ],
};
