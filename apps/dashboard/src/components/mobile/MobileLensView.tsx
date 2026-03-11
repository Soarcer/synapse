// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Bernhard

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
