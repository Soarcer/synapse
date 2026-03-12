// SPDX-License-Identifier: MIT
// Synapse Push Notification Service Worker

// ─── Push Event ──────────────────────────────────────────────
self.addEventListener('push', (event) => {
  const payload = event.data?.json() ?? {};
  const { title, body, data } = payload;

  // Only show action buttons for real permission requests (not test notifications)
  const actions = data?.decisionUrl
    ? [
        { action: 'approve', title: 'Approve' },
        { action: 'deny', title: 'Deny' },
      ]
    : [];

  event.waitUntil(
    self.registration.showNotification(title || 'Synapse', {
      body: body || 'Permission request pending',
      icon: '/icons/icon-192.png',
      badge: '/icons/badge-72.png',
      tag: data?.requestId ? `permission-${data.requestId}` : 'synapse',
      renotify: true,
      data: data,
      actions,
    })
  );
});

// ─── Notification Click ─────────────────────────────────────
self.addEventListener('notificationclick', (event) => {
  const { action, notification } = event;
  const { decisionUrl, requestId, url } = notification.data || {};
  notification.close();

  if ((action === 'approve' || action === 'deny') && decisionUrl) {
    // Direct action from notification button (Android)
    const tag = requestId ? `permission-${requestId}` : 'synapse';
    event.waitUntil(
      fetch(decisionUrl, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ behavior: action === 'approve' ? 'allow' : 'deny' }),
      })
        .then(() => {
          // Show confirmation notification (replaces original via same tag)
          const verb = action === 'approve' ? 'Approved' : 'Denied';
          return self.registration.showNotification(`${verb} — Claude is continuing`, {
            icon: '/icons/icon-192.png',
            badge: '/icons/badge-72.png',
            tag,
            data: {},
          });
        })
        .then(() => new Promise((resolve) => setTimeout(resolve, 4000)))
        .then(() => self.registration.getNotifications({ tag }))
        .then((notifications) => notifications.forEach((n) => n.close()))
        .catch(() => {
          // If fetch fails (server unreachable), open PWA as fallback
          return self.clients.openWindow(url || '/');
        })
    );
  } else {
    // Body tap — focus existing PWA window without reloading.
    // On iOS, the OS brings the PWA forward automatically when tapping
    // a notification, so openWindow() would cause an unwanted reload.
    // Only open a new window if we're sure none exist AND we're not on iOS.
    event.waitUntil(
      self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
        for (const client of clients) {
          if ('focus' in client) return client.focus();
        }
        // No visible client — on iOS the OS is already opening the PWA,
        // so only call openWindow on non-iOS platforms.
        const isIOS = /iPad|iPhone|iPod/.test(self.navigator?.userAgent || '');
        if (!isIOS) return self.clients.openWindow(url || '/');
      })
    );
  }
});

// ─── Subscription Change ────────────────────────────────────
self.addEventListener('pushsubscriptionchange', (event) => {
  // Browser rotated keys — delete old subscription, re-subscribe with fresh VAPID key
  const oldEndpoint = event.oldSubscription?.endpoint;

  event.waitUntil(
    Promise.resolve()
      // Step 1: Delete old subscription from server if we have the endpoint
      .then(() => {
        if (oldEndpoint) {
          return fetch('/api/push/subscriptions', {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ endpoint: oldEndpoint }),
          }).catch(() => {}); // best-effort cleanup
        }
      })
      // Step 2: Fetch fresh VAPID key and re-subscribe
      .then(() => fetch('/api/push/vapid-key'))
      .then((r) => r.json())
      .then(({ publicKey }) => {
        const padding = '='.repeat((4 - (publicKey.length % 4)) % 4);
        const raw = atob(publicKey.replace(/-/g, '+').replace(/_/g, '/') + padding);
        const key = new Uint8Array(raw.length);
        for (let i = 0; i < raw.length; i++) key[i] = raw.charCodeAt(i);

        return self.registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: key,
        });
      })
      .then((newSub) => {
        const p256dh = newSub.getKey('p256dh');
        const auth = newSub.getKey('auth');
        if (!p256dh || !auth) throw new Error('Missing subscription keys');
        return fetch('/api/push/subscriptions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            endpoint: newSub.endpoint,
            keys: {
              p256dh: btoa(String.fromCharCode(...new Uint8Array(p256dh))),
              auth: btoa(String.fromCharCode(...new Uint8Array(auth))),
            },
          }),
        });
      })
      .catch(() => {
        // Re-subscribe failed — user can re-enable in settings.
        // usePush.ts onMount check will detect the missing subscription.
      })
  );
});
