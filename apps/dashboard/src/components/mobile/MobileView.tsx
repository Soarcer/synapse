// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Synapse Contributors

import { useState, useEffect, lazy, Suspense } from 'react';
import { MobileStatusBar } from './MobileStatusBar';
import { MobileTabBar, type MobileTab } from './MobileTabBar';
import { MobileBottomSheet } from './MobileBottomSheet';
import { MobileLensView } from './MobileLensView';
import { MobileSettingsButton } from './MobileSettingsButton';
import { wsClient } from '../../store/wsClient';

const MobileGraphView = lazy(() =>
  import('./MobileGraphView').then((m) => ({ default: m.MobileGraphView })),
);
const MobileAnalyticsView = lazy(() =>
  import('./MobileAnalyticsView').then((m) => ({ default: m.MobileAnalyticsView })),
);

function TabFallback() {
  return (
    <div className="flex-1 flex items-center justify-center text-gray-500 text-sm">
      Loading...
    </div>
  );
}

export default function MobileView() {
  const [activeTab, setActiveTab] = useState<MobileTab>('graph');

  // Lock body scrolling so the page feels like an app, not a website.
  // Prevents overscroll bounce, pull-to-refresh, and elastic scrolling.
  useEffect(() => {
    const html = document.documentElement;
    const body = document.body;

    html.style.position = 'fixed';
    html.style.overflow = 'hidden';
    html.style.width = '100%';
    html.style.height = '100%';

    body.style.position = 'fixed';
    body.style.overflow = 'hidden';
    body.style.width = '100%';
    body.style.height = '100%';
    body.style.overscrollBehavior = 'none';

    return () => {
      html.style.position = '';
      html.style.overflow = '';
      html.style.width = '';
      html.style.height = '';

      body.style.position = '';
      body.style.overflow = '';
      body.style.width = '';
      body.style.height = '';
      body.style.overscrollBehavior = '';
    };
  }, []);

  // Reconnect WS when phone wakes from sleep (visibility change)
  useEffect(() => {
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') {
        wsClient.connect();
      }
    };
    document.addEventListener('visibilitychange', handleVisibility);
    return () => document.removeEventListener('visibilitychange', handleVisibility);
  }, []);

  return (
    <div className="flex-1 flex flex-col overflow-hidden relative" style={{ overscrollBehavior: 'none' }}>
      <MobileStatusBar />
      <MobileSettingsButton />

      <div className="flex-1 overflow-hidden flex flex-col">
        {activeTab === 'graph' && (
          <Suspense fallback={<TabFallback />}>
            <MobileGraphView />
          </Suspense>
        )}
        {activeTab === 'lenses' && <MobileLensView />}
        {activeTab === 'analytics' && (
          <Suspense fallback={<TabFallback />}>
            <MobileAnalyticsView />
          </Suspense>
        )}
      </div>

      <MobileBottomSheet />
      <MobileTabBar activeTab={activeTab} onTabChange={setActiveTab} />
    </div>
  );
}
