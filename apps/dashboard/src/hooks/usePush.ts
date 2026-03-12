// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Bernhard

import { useState, useEffect, useCallback, useRef } from 'react';
import { apiUrl } from '../utils/api';

export type PushState = 'unsupported' | 'default' | 'denied' | 'granted' | 'subscribed';

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  const arr = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i);
  return arr;
}

export function usePush() {
  const [state, setState] = useState<PushState>(() => {
    if (typeof navigator === 'undefined') return 'unsupported';
    if (!('serviceWorker' in navigator) || typeof Notification === 'undefined') {
      // On iOS non-standalone, serviceWorker and Notification are hidden —
      // return 'default' so PushSetup can show the "Add to Home Screen" gate
      // instead of the generic "not supported" message.
      const ua = navigator.userAgent;
      const isIOS =
        /iPad|iPhone|iPod/.test(ua) ||
        (navigator.maxTouchPoints > 0 && /Mac/.test(navigator.platform));
      return isIOS ? 'default' : 'unsupported';
    }
    if (Notification.permission === 'denied') return 'denied';
    return 'default';
  });
  const [error, setError] = useState<string | null>(null);
  const vapidKeyRef = useRef<string | null>(null);
  const stateRef = useRef(state);
  stateRef.current = state;

  // Check existing subscription on mount only
  useEffect(() => {
    if (!('serviceWorker' in navigator) || typeof Notification === 'undefined') return;
    if (Notification.permission === 'denied') return;

    let cancelled = false;
    (async () => {
      try {
        const reg = await navigator.serviceWorker.getRegistration();
        if (!reg) return;
        const sub = await reg.pushManager.getSubscription();
        if (sub && !cancelled) setState('subscribed');
        else if (Notification.permission === 'granted' && !cancelled) setState('granted');
      } catch {
        // Ignore — state stays as initialized
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const enable = useCallback(async () => {
    if (stateRef.current === 'unsupported') return;
    setError(null);

    try {
      // 0. Check secure context
      if (!window.isSecureContext) {
        setError('HTTPS required for push notifications on LAN');
        return;
      }

      // 1. Register SW
      const registration = await navigator.serviceWorker.register('/sw.js');
      await navigator.serviceWorker.ready;

      // 2. Fetch VAPID key (before permission prompt so we fail fast if server not configured)
      if (!vapidKeyRef.current) {
        const res = await fetch(apiUrl('/api/push/vapid-key'));
        const data = await res.json();
        if (!data.enabled || !data.publicKey) {
          setError('Push not configured on server — add VAPID keys to .env');
          return;
        }
        vapidKeyRef.current = data.publicKey;
      }

      // 3. Request permission (browser prompt)
      const permission = await Notification.requestPermission();
      if (permission === 'denied') {
        setState('denied');
        return;
      }
      if (permission !== 'granted') return; // dismissed

      setState('granted');

      // 4. Subscribe
      const subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(vapidKeyRef.current!).buffer as ArrayBuffer,
      });

      const p256dh = subscription.getKey('p256dh');
      const auth = subscription.getKey('auth');
      if (!p256dh || !auth) throw new Error('Missing subscription keys');

      // 5. Save to server
      await fetch(apiUrl('/api/push/subscriptions'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          endpoint: subscription.endpoint,
          keys: {
            p256dh: btoa(String.fromCharCode(...new Uint8Array(p256dh))),
            auth: btoa(String.fromCharCode(...new Uint8Array(auth))),
          },
          userAgent: navigator.userAgent,
        }),
      });

      setState('subscribed');
    } catch {
      setError('Push setup failed — check browser console');
    }
  }, []); // stable ref — uses stateRef.current internally

  const disable = useCallback(async () => {
    try {
      const reg = await navigator.serviceWorker.getRegistration();
      if (!reg) return;
      const sub = await reg.pushManager.getSubscription();
      if (sub) {
        // Remove from server first
        await fetch(apiUrl('/api/push/subscriptions'), {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ endpoint: sub.endpoint }),
        });
        await sub.unsubscribe();
      }
      setState('granted'); // Permission still granted, just unsubscribed
      setError(null);
    } catch {
      // Ignore
    }
  }, []);

  const clearError = useCallback(() => setError(null), []);

  const sendTest = useCallback(async () => {
    await fetch(apiUrl('/api/push/test'), { method: 'POST' }).catch(() => {});
  }, []);

  return { state, error, enable, disable, clearError, sendTest };
}
