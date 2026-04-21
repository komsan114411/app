// sw.js — Service worker: offline shell + stale-while-revalidate + web push.

const VERSION = 'v50';
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
  './tracking.jsx',
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
// Admin-surface JSX (admin-app / admin-tabs / auth-gate / twofa-setup /
// dashboard-tab / session-list / system-status / chart) and any URL
// under /admin are NEVER persisted to cache. Network-first still lets
// legit admins load fresh code; skipping cache.put means an admin who
// logs out, hands off a phone, or has their device seized doesn't leave
// admin code resident in the service-worker cache for offline replay.
const ADMIN_JSX = new Set([
  '/admin-app.jsx',
  '/admin-tabs.jsx',
  '/auth-gate.jsx',
  '/twofa-setup.jsx',
  '/dashboard-tab.jsx',
  '/session-list.jsx',
  '/system-status.jsx',
  '/chart.jsx',
]);
function isAdminUrl(pathname) {
  return pathname.startsWith('/admin/')
      || pathname === '/admin'
      || ADMIN_JSX.has(pathname);
}
// ── Offline analytics queue (Phase 4) ─────────────────────────
// If the client posts to /api/track/event and we're offline (or the
// request otherwise fails), stash the body in IndexedDB and retry on
// the next successful fetch of anything. Avoids losing installs /
// clicks / session ends when network flaps during travel, subway, etc.
const OFFLINE_DB = 'hof-offline-v1';
const OFFLINE_STORE = 'track-queue';
function idbOpen() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(OFFLINE_DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(OFFLINE_STORE, { autoIncrement: true });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
async function queuePush(body, endpointPath) {
  try {
    const db = await idbOpen();
    await new Promise((ok, ng) => {
      const tx = db.transaction(OFFLINE_STORE, 'readwrite');
      tx.objectStore(OFFLINE_STORE).add({ body, endpointPath, at: Date.now() });
      tx.oncomplete = ok; tx.onerror = () => ng(tx.error);
    });
  } catch {}
}
const OFFLINE_MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000;  // drop rows older than 14d

async function drainQueue() {
  try {
    const db = await idbOpen();
    const rows = await new Promise((ok, ng) => {
      const tx = db.transaction(OFFLINE_STORE, 'readonly');
      const req = tx.objectStore(OFFLINE_STORE).openCursor();
      const out = [];
      req.onsuccess = e => {
        const cur = e.target.result;
        if (cur) { out.push({ key: cur.key, value: cur.value }); cur.continue(); }
        else ok(out);
      };
      req.onerror = () => ng(req.error);
    });
    const now = Date.now();
    const deleteKey = (key) => new Promise((ok, ng) => {
      const tx = db.transaction(OFFLINE_STORE, 'readwrite');
      tx.objectStore(OFFLINE_STORE).delete(key);
      tx.oncomplete = ok; tx.onerror = () => ng(tx.error);
    });
    for (const r of rows) {
      // Stale cleanup — server-side TTL is 90d but queued events from
      // 14d+ ago represent a long offline stretch where the deviceId
      // and sourceToken context are almost certainly obsolete. Drop
      // them instead of replaying.
      if (r.value.at && (now - r.value.at) > OFFLINE_MAX_AGE_MS) {
        await deleteKey(r.key).catch(() => {});
        continue;
      }
      try {
        const res = await fetch(r.value.endpointPath || '/api/track/event', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: r.value.body,
        });
        // Delete on success OR on permanent 4xx (won't succeed by retry).
        if (res.ok || (res.status >= 400 && res.status < 500 && res.status !== 429)) {
          await deleteKey(r.key).catch(() => {});
        }
      } catch {
        // Still offline — bail and try on the next online event.
        return;
      }
    }
  } catch {}
}
self.addEventListener('online', () => { drainQueue().catch(() => {}); });

self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);

  // Phase 4: queue failed /api/track/event POSTs instead of losing them.
  // Admin writes (PATCH /api/admin/config etc.) still pass through
  // normally — only the public tracking endpoint is queued.
  if (req.method === 'POST' && (
    url.pathname === '/api/track/event' ||
    url.pathname === '/api/track/error'
  )) {
    event.respondWith((async () => {
      try {
        const res = await fetch(req.clone());
        // Opportunistic drain on every successful track call — a send
        // that worked means the network is probably back.
        if (res.ok) drainQueue().catch(() => {});
        return res;
      } catch {
        try {
          const body = await req.clone().text();
          await queuePush(body, url.pathname);
        } catch {}
        // 204 so the client treats the beacon as delivered — it is,
        // from the client's perspective; we'll retry transparently.
        return new Response(null, { status: 204 });
      }
    })());
    return;
  }

  if (req.method !== 'GET') return;
  if (url.pathname.startsWith('/api/')) return;
  if (url.pathname.startsWith('/uploads/')) return;
  if (url.pathname.startsWith('/media/')) return;
  if (url.origin !== self.location.origin) return;

  const admin = isAdminUrl(url.pathname);
  const isCritical = /\.(jsx|html)$/.test(url.pathname)
                  || url.pathname === '/'
                  || url.pathname === '/install'
                  || url.pathname.startsWith('/install/')
                  || admin;

  event.respondWith((async () => {
    const cache = await caches.open(SHELL);
    if (isCritical) {
      // Network-first: always fetch latest, fall back to cache only offline.
      // Admin responses bypass cache.put entirely — see ADMIN_JSX comment.
      try {
        const res = await fetch(req);
        if (res.ok && !admin) cache.put(req, res.clone()).catch(() => {});
        return res;
      } catch {
        if (admin) throw new Error('offline_admin_not_cached');
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
  // Phase 3 push CTR: fire a push_click event to /api/track/event.
  // We don't know the deviceId here (SW has no access to localStorage)
  // so rely on a ?c=<campaignId> query param that scheduledPush.js
  // appends on send. The landing page picks it up and re-emits as
  // push_click with its own deviceId (handled in tracking.jsx
  // install() → captureSourceContext). Belt-and-braces: also fire a
  // device-less beacon so we at least count CTR even when the browser
  // tab doesn't open.
  let campaign = '';
  try { campaign = new URL(url, self.location.origin).searchParams.get('c') || ''; } catch {}
  // Strip anything that wouldn't pass the backend's validateDeviceId
  // regex (A-Z a-z 0-9 _ -). Mongo ObjectIDs are 24 hex chars and
  // safe, but users may eventually plug custom slugs in too.
  const safeCampaign = campaign.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 32);
  if (safeCampaign && safeCampaign.length >= 5) {   // padding with 'sw-' gives ≥8
    event.waitUntil((async () => {
      try {
        // The SW can't use window.API_BASE — rely on same-origin fetch
        // when on web, and fall through silently on the APK (Capacitor
        // WebView has a separate tracking path through the landing page).
        await fetch('/api/track/event', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            deviceId: 'sw-' + safeCampaign,            // synthetic, just for count
            events: [{ type: 'push_click', target: safeCampaign }],
            platform: 'web', appVersion: '',
          }),
        }).catch(() => {});
      } catch {}
    })());
  }
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clients => {
      for (const c of clients) {
        if (c.url === url && 'focus' in c) return c.focus();
      }
      if (self.clients.openWindow) return self.clients.openWindow(url);
    })
  );
});
