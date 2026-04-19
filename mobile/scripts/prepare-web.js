// scripts/prepare-web.js — Copy the frontend files into ./www for Capacitor.
// Run automatically by `npm install`, or manually with `node scripts/prepare-web.js`.

const fs = require('node:fs');
const path = require('node:path');

const here = __dirname;
const root = path.join(here, '..', '..');       // /app
const www  = path.join(here, '..', 'www');       // /app/mobile/www

fs.mkdirSync(www, { recursive: true });

// Keep this list in sync with the <script type="text/babel"> tags in
// index.html — anything the SPA loads at runtime must be copied into
// mobile/www or the APK will 404 and fall back to demo mode.
const FILES = [
  'index.html',
  'security.jsx', 'icons.jsx', 'app-state.jsx', 'api-client.jsx',
  'toast.jsx', 'online-indicator.jsx', 'saved-indicator.jsx',
  'chart.jsx', 'qr-share.jsx', 'drag-list.jsx',
  'ios-frame.jsx', 'browser-window.jsx',
  'user-app.jsx', 'auth-gate.jsx',
  'twofa-setup.jsx', 'session-list.jsx',
  'admin-tabs.jsx', 'admin-app.jsx',
  'system-status.jsx', 'push-setup.jsx', 'download-links.jsx',
  'dashboard-tab.jsx', 'consent-banner.jsx',
  'manifest.webmanifest', 'sw.js', 'icon.svg',
];
for (const f of FILES) {
  const src = path.join(root, f);
  if (!fs.existsSync(src)) { console.warn('skip missing', f); continue; }
  fs.cpSync(src, path.join(www, f));
}
for (const p of ['icon-192.png', 'icon-512.png', 'icon-maskable-512.png']) {
  const src = path.join(root, p);
  if (fs.existsSync(src)) fs.cpSync(src, path.join(www, p));
}

// Inject window.API_BASE so the APK knows where the backend is.
// Override via: API_BASE=https://api.example.com node scripts/prepare-web.js
// Empty → relative URLs → the APK's WebView loads from whatever host it's
// pointed at. Useful when the admin wants one APK that follows the main
// deployment.
const API_BASE = (process.env.API_BASE || '').trim();
const indexPath = path.join(www, 'index.html');
let html = fs.readFileSync(indexPath, 'utf8');
if (API_BASE) {
  const inject = `<script>window.API_BASE=${JSON.stringify(API_BASE)};</script>`;
  if (!html.includes('window.API_BASE=')) {
    html = html.replace('</head>', `${inject}\n</head>`);
    fs.writeFileSync(indexPath, html);
  }
}

console.log('www ready at', www, '· files:', FILES.length, '· API_BASE =', API_BASE || '(same-origin)');
