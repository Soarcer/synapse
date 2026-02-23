// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Synapse Contributors

import type { TourChapter } from '../constants';

/** Open the settings dropdown if it isn't already open. */
function openSettingsDropdown(): void {
  const btn = document.querySelector<HTMLButtonElement>('[aria-label="View settings"]');
  if (!btn) return;
  // aria-expanded="true" means it's already open
  if (btn.getAttribute('aria-expanded') !== 'true') {
    btn.click();
  }
}

export const settingsChapter: TourChapter = {
  id: 'settings',
  titleKey: 'tour.chapter.settings',
  steps: [
    {
      target: '[data-tour="settings-dropdown"]',
      titleKey: 'tour.settings.overview.title',
      bodyKey: 'tour.settings.overview.body',
      placement: 'left',
      onEnter: openSettingsDropdown,
    },
    {
      target: '[data-tour="settings-dropdown"]',
      titleKey: 'tour.settings.toolViewModes.title',
      bodyKey: 'tour.settings.toolViewModes.body',
      placement: 'left',
      onEnter: openSettingsDropdown,
    },
  ],
};
