// scripts/prepare-web.js — Copy the frontend files into ./www for Capacitor.
// Run automatically by `npm install`, or manually with `node scripts/prepare-web.js`.

const fs = require('node:fs');
const path = require('node:path');

const here = __dirname;
const root = path.join(here, '..', '..');       // /app
const www  = path.join(here, '..', 'www');       // /app/mobile/www

fs.mkdirSync(www, { recursive: true });

const FILES = [
  'index.html', 'security.jsx', 'icons.jsx', 'app-state.jsx', 'api-client.jsx',
  'ios-frame.jsx', 'browser-window.jsx', 'user-app.jsx', 'auth-gate.jsx',
  'admin-tabs.jsx', 'admin-app.jsx', 'consent-banner.jsx',
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
// Override via:  API_BASE=https://api.example.com node scripts/prepare-web.js
const API_BASE = process.env.API_BASE || 'https://api.your-domain.example.com';
const indexPath = path.join(www, 'index.html');
let html = fs.readFileSync(indexPath, 'utf8');
const inject = `<script>window.API_BASE=${JSON.stringify(API_BASE)};</script>`;
if (!html.includes('window.API_BASE=')) {
  html = html.replace('</head>', `${inject}\n</head>`);
  fs.writeFileSync(indexPath, html);
}

console.log('www ready at', www, '· API_BASE =', API_BASE);
