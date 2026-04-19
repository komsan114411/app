// sw.js — Service worker: offline shell + stale-while-revalidate + web push.

const VERSION = 'v11';
const SHELL = 'shell-' + VERSION;

const SHELL_FILES = [
  './',
  './index.html',
  './security.jsx',
  './icons.jsx',
  './app-state.jsx',
  './api-client.jsx',
  './toast.jsx',
  './ios-frame.jsx',
  './browser-window.jsx',
  './install-page.jsx',
  './install-share.jsx',
  './user-app.jsx',
  './auth-gate.jsx',
  './dashboard-tab.jsx',
  './admin-tabs.jsx',
  './admin-app.jsx',
  './system-status.jsx',
  './push-setup.jsx',
  './download-links.jsx',
  './consent-banner.jsx',
  './drag-list.jsx',
  './twofa-setup.jsx',
  './session-list.jsx',
  './chart.jsx',
  './qr-share.jsx',
  './saved-indicator.jsx',
  './online-indicator.jsx',
  './manifest.webmanifest',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(SHELL).then(c => c.addAll(SHELL_FILES).catch(() => {}))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then(keys => Promise.all(
      keys.filter(k => k !== SHELL).map(k => caches.delete(k))
    ))
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.pathname.startsWith('/api/')) return;
  if (url.pathname.startsWith('/uploads/')) return;
  if (url.origin !== self.location.origin) return;
  event.respondWith((async () => {
    const cache = await caches.open(SHELL);
    const cached = await cache.match(req);
    const networkPromise = fetch(req).then(res => {
      if (res.ok) cache.put(req, res.clone()).catch(() => {});
      return res;
    }).catch(() => cached);
    return cached || networkPromise;
  })());
});

// ── Web Push ──────────────────────────────────────────────────
self.addEventListener('push', (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch {}
  const title = data.title || 'แอป';
  const options = {
    body: data.body || '',
    icon: 'icon-192.png',
    badge: 'icon-192.png',
    data: { url: data.url || '/' },
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || '/';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clients => {
      for (const c of clients) {
        if (c.url === url && 'focus' in c) return c.focus();
      }
      if (self.clients.openWindow) return self.clients.openWindow(url);
    })
  );
});
