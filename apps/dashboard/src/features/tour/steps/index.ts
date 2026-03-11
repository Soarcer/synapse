// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Bernhard

import { graphChapter } from './graphSteps';
import { lensChapter } from './lensSteps';
import { panelChapter } from './panelSteps';
import { headerChapter } from './headerSteps';
import { settingsChapter } from './settingsSteps';
import { analyticsChapter } from './analyticsSteps';
import type { TourChapter } from '../constants';

export const ALL_CHAPTERS: TourChapter[] = [
  graphChapter,
  lensChapter,
  panelChapter,
  headerChapter,
  settingsChapter,
  analyticsChapter,
].filter((ch) => ch.steps.length > 0);
