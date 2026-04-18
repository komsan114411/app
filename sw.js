// sw.js — Service worker: offline shell + stale-while-revalidate.
// Minimal: caches the app shell, serves cached version when offline.

const VERSION = 'v1';
const SHELL = 'shell-' + VERSION;

const SHELL_FILES = [
  './',
  './index.html',
  './security.jsx',
  './icons.jsx',
  './app-state.jsx',
  './api-client.jsx',
  './ios-frame.jsx',
  './browser-window.jsx',
  './user-app.jsx',
  './auth-gate.jsx',
  './admin-tabs.jsx',
  './admin-app.jsx',
  './consent-banner.jsx',
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
  // Never cache API calls — always network, fresh.
  if (url.pathname.startsWith('/api/')) return;
  if (url.origin !== self.location.origin) return;

  // Stale-while-revalidate for app shell
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
