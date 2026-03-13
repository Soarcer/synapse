// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Bernhard

import { useState, useEffect, lazy, Suspense } from 'react';
import { createPortal } from 'react-dom';
import { MobileStatusBar } from './MobileStatusBar';
import { MobileTabBar, type MobileTab } from './MobileTabBar';
import { MobileBottomSheet } from './MobileBottomSheet';
import { MobileLensView } from './MobileLensView';
import { MobileSettingsButton } from './MobileSettingsButton';
import { RemoteDevChat } from './RemoteDevChat';
import { useRemoteDevStore } from '../../store/remoteDevStore';
import { PermissionStack } from '../permissions/PermissionStack';
import { wsClient } from '../../store/wsClient';

const MobileGraphView = lazy(() =>
  import('./MobileGraphView').then((m) => ({ default: m.MobileGraphView })),
);
const MobileAnalyticsView = lazy(() =>
  import('./MobileAnalyticsView').then((m) => ({ default: m.MobileAnalyticsView })),
);

function TabFallback() {
  return (
    <div className="flex-1 flex items-center justify-center text-gray-500 text-sm">Loading...</div>
  );
}

/**
 * Portal that renders PermissionStack into document.body.
 * iOS Safari sets position:fixed on html/body (for overscroll lock), which creates
 * a containing block that traps fixed-position children. The outer MobileView div
 * also has overflow-hidden which clips absolutely positioned children.
 * Portal escapes both issues.
 */
function MobilePermissionPortal() {
  return createPortal(<PermissionStack />, document.body);
}

export default function MobileView() {
  const [activeTab, setActiveTab] = useState<MobileTab>('graph');
  const remoteDevStatus = useRemoteDevStore((s) => s.status);

  // Auto-switch to Dev tab when a remote-dev question arrives
  useEffect(() => {
    if (remoteDevStatus === 'waiting') setActiveTab('dev');
  }, [remoteDevStatus]);

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

  // Reconnect WS when phone wakes from sleep (visibility change).
  // Use resetAndReconnect() to clear retry counter — connect() returns early if failed.
  useEffect(() => {
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') {
        wsClient.resetAndReconnect();
      }
    };
    document.addEventListener('visibilitychange', handleVisibility);
    return () => document.removeEventListener('visibilitychange', handleVisibility);
  }, []);

  return (
    <div
      className="flex-1 flex flex-col overflow-hidden relative"
      style={{ overscrollBehavior: 'none' }}
    >
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
        {activeTab === 'dev' && <RemoteDevChat />}
      </div>

      <MobileBottomSheet />
      <MobileTabBar activeTab={activeTab} onTabChange={setActiveTab} />
      {/* PermissionPanel rendered via portal to escape overflow-hidden clipping */}
      <MobilePermissionPortal />
    </div>
  );
}
