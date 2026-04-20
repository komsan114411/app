// sw.js — Service worker: offline shell + stale-while-revalidate + web push.

const VERSION = 'v39';
const SHELL = 'shell-' + VERSION;

// Public-surface JSX only. Admin-only bundles (auth-gate, admin-app,
// admin-tabs, session-list, twofa-setup, dashboard-tab, system-status,
// chart) are deliberately NOT pre-cached: anonymous visitors have no
// reason to download them, and pre-caching left an old copy behind
// after deploys — patched security regexes wouldn't take effect for
// users whose SW was installed pre-patch. Admin paths use network-first
// in the fetch handler below, so authed users still get fresh code.
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
  './push-setup.jsx',
  './download-links.jsx',
  './consent-banner.jsx',
  './drag-list.jsx',
  './qr-share.jsx',
  './saved-indicator.jsx',
  './online-indicator.jsx',
  './manifest.webmanifest',
  './icon.svg',
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

// Fetch strategy:
//   • /api/*, /uploads/*, /media/*  → no SW involvement (pass through)
//   • index.html + *.jsx             → NETWORK FIRST (critical: we were
//       serving stale JSX that had an older safeUrl() regex, which
//       silently stripped /media/*.apk URLs before they reached the
//       server. Cache-first kept the bug frozen across deploys.)
//   • css / png / svg / fonts        → cache-first (safe to be stale)
self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.pathname.startsWith('/api/')) return;
  if (url.pathname.startsWith('/uploads/')) return;
  if (url.pathname.startsWith('/media/')) return;
  if (url.origin !== self.location.origin) return;

  const isCritical = /\.(jsx|html)$/.test(url.pathname)
                  || url.pathname === '/'
                  || url.pathname === '/install'
                  || url.pathname.startsWith('/install/')
                  || url.pathname.startsWith('/admin/');

  event.respondWith((async () => {
    const cache = await caches.open(SHELL);
    if (isCritical) {
      // Network-first: always fetch latest, fall back to cache only offline
      try {
        const res = await fetch(req);
        if (res.ok) cache.put(req, res.clone()).catch(() => {});
        return res;
      } catch {
        const cached = await cache.match(req);
        if (cached) return cached;
        throw new Error('offline');
      }
    }
    // Stale-while-revalidate for static assets
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
    icon: 'icon.svg',
    badge: 'icon.svg',
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
