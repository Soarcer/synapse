// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Bernhard

import { useState, useEffect } from 'react';
import { usePush } from '../../hooks/usePush';
import { apiUrl } from '../../utils/api';

interface SubscriptionInfo {
  id: string;
  endpoint: string;
  userAgent: string | null;
  createdAt: number;
}

export function PushSetup() {
  const { state, error, enable, disable, clearError, sendTest } = usePush();
  const [subs, setSubs] = useState<SubscriptionInfo[]>([]);
  const [testSent, setTestSent] = useState(false);
  const [enabling, setEnabling] = useState(false);

  // Load subscription list when in subscribed state
  useEffect(() => {
    if (state !== 'subscribed') return;
    let cancelled = false;
    fetch(apiUrl('/api/push/subscriptions'))
      .then((r) => r.json())
      .then((data: SubscriptionInfo[]) => {
        if (!cancelled) setSubs(data);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [state]);

  const handleRemove = async (endpoint: string) => {
    await fetch(apiUrl('/api/push/subscriptions'), {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ endpoint }),
    }).catch(() => {});
    setSubs((prev) => prev.filter((s) => s.endpoint !== endpoint));
  };

  const handleTest = async () => {
    await sendTest();
    setTestSent(true);
    setTimeout(() => setTestSent(false), 3000);
  };

  // iOS detection with iPad desktop mode fallback
  const isIOS =
    typeof navigator !== 'undefined' &&
    (/iPad|iPhone|iPod/.test(navigator.userAgent) ||
      (navigator.maxTouchPoints > 0 && /Mac/.test(navigator.platform)));

  // iOS standalone check: push only works from Add to Home Screen PWA
  const isStandalone =
    typeof window !== 'undefined' &&
    (window.matchMedia?.('(display-mode: standalone)').matches ||
      ('standalone' in navigator && (navigator as unknown as { standalone: boolean }).standalone));
  const showIOSGate = isIOS && !isStandalone;

  return (
    <section>
      <h3 className="text-xs text-gray-500 uppercase tracking-wider mb-2">Push Notifications</h3>
      <p className="text-xs text-gray-400 mb-3">Get notified on your phone when Claude blocks</p>

      {state === 'unsupported' && (
        <p className="text-xs text-amber-400">
          {typeof window !== 'undefined' && !window.isSecureContext
            ? 'HTTPS required — push notifications need a secure connection (https:// or localhost)'
            : 'Your browser doesn\u2019t support push notifications'}
        </p>
      )}

      {error && (
        <div className="flex items-center gap-2 text-xs text-amber-400 mb-2">
          <span>&#9888; {error}</span>
          <button onClick={clearError} className="text-gray-500 hover:text-gray-400 text-[10px]">
            Dismiss
          </button>
        </div>
      )}

      {state === 'default' && showIOSGate && (
        <div className="text-xs text-amber-400 space-y-1">
          <p>iOS requires &ldquo;Add to Home Screen&rdquo; for push notifications</p>
          <ol className="list-decimal list-inside text-gray-400 space-y-0.5">
            <li>In Safari, tap the Share button</li>
            <li>Tap &ldquo;Add to Home Screen&rdquo;</li>
            <li>Open Synapse from your home screen</li>
            <li>Return here to enable push</li>
          </ol>
        </div>
      )}

      {state === 'default' && !showIOSGate && (
        <button
          onClick={async () => {
            setEnabling(true);
            await enable();
            setEnabling(false);
          }}
          disabled={enabling}
          className="px-3 py-1.5 text-xs rounded bg-blue-600 text-white hover:bg-blue-500 transition-colors disabled:opacity-50"
        >
          {enabling ? 'Enabling...' : 'Enable Push Notifications'}
        </button>
      )}

      {state === 'denied' && (
        <div className="text-xs text-red-400 space-y-1">
          <p>Push notifications blocked — reset in browser settings</p>
          <p className="text-gray-500">
            Chrome: Settings &rarr; Site Settings &rarr; Notifications &rarr; find this site &rarr;
            Allow
          </p>
        </div>
      )}

      {state === 'granted' && (
        <div className="text-xs text-amber-400">
          <p>Permission granted but not subscribed</p>
          <button
            onClick={enable}
            className="mt-1 px-3 py-1.5 rounded bg-blue-600 text-white hover:bg-blue-500 transition-colors"
          >
            Subscribe
          </button>
        </div>
      )}

      {state === 'subscribed' && (
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-green-400" />
            <span className="text-xs text-green-400">Enabled</span>
          </div>

          {subs.length > 0 && (
            <div className="space-y-1">
              <p className="text-[10px] text-gray-500 uppercase tracking-wider">Devices</p>
              {subs.map((sub) => (
                <div
                  key={sub.id}
                  className="flex items-center justify-between text-xs text-gray-400"
                >
                  <span className="truncate max-w-[200px]">
                    {sub.userAgent?.split(' ').slice(-1)[0] ?? 'Unknown device'}
                    {' · '}
                    {formatAge(sub.createdAt)}
                  </span>
                  <button
                    onClick={() => handleRemove(sub.endpoint)}
                    className="text-red-400 hover:text-red-300 text-[10px]"
                  >
                    Remove
                  </button>
                </div>
              ))}
            </div>
          )}

          <div className="flex items-center gap-2">
            <button
              onClick={handleTest}
              className="px-3 py-1.5 text-xs rounded bg-gray-800 text-gray-300 hover:bg-gray-700 transition-colors border border-gray-700/50"
            >
              {testSent ? 'Sent!' : 'Send test notification'}
            </button>
            <button
              onClick={disable}
              className="px-3 py-1.5 text-xs rounded bg-gray-800 text-gray-300 hover:bg-gray-700 transition-colors border border-gray-700/50"
            >
              Disable
            </button>
          </div>
        </div>
      )}

      {isIOS && !showIOSGate && (
        <div className="mt-3 bg-blue-950/20 border border-blue-800/30 rounded-lg p-2">
          <p className="text-[11px] text-blue-300/80">
            Tip: keep the PWA on your home screen for reliable notifications
          </p>
        </div>
      )}
    </section>
  );
}

function formatAge(timestamp: number): string {
  const seconds = Math.floor((Date.now() - timestamp) / 1000);
  if (seconds < 60) return 'just now';
  if (seconds < 3600) return `${Math.floor(seconds / 60)} min ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)} hours ago`;
  return `${Math.floor(seconds / 86400)} days ago`;
}
