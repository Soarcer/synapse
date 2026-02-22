// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Synapse Contributors

import { graphChapter } from './graphSteps';
import { lensChapter } from './lensSteps';
import { panelChapter } from './panelSteps';
import { headerChapter } from './headerSteps';
import { settingsChapter } from './settingsSteps';
import { analyticsChapter } from './analyticsSteps';
import { pixelChapter } from './pixelSteps';
import type { TourChapter } from '../constants';

export const ALL_CHAPTERS: TourChapter[] = [
  graphChapter,
  lensChapter,
  panelChapter,
  headerChapter,
  settingsChapter,
  analyticsChapter,
  pixelChapter,
];
