// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Synapse Contributors

import { LensAdapter } from '../lens/LensAdapter';
import { MobileLensPanel } from './MobileLensPanel';

export function MobileLensView() {
  return (
    <div className="flex-1 overflow-hidden flex flex-col">
      <LensAdapter fillWidth>
        <MobileLensPanel />
      </LensAdapter>
    </div>
  );
}
