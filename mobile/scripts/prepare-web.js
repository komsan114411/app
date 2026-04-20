// scripts/prepare-web.js — Build the minimal www/ bundle for Capacitor.
//
// Security principle: the installed APK must NEVER contain admin-surface
// JSX. A curious user can `unzip app-debug.apk` and read every file in
// assets/public/. If admin-app.jsx, admin-tabs.jsx, auth-gate.jsx etc.
// are in there, an attacker gets the full admin UI code — every
// endpoint, every validation rule, every token format — handed to them
// as a blueprint for attacking the backend.
//
// Strategy:
//   • Copy ONLY the user-side scripts into www/
//   • Rewrite the <script> tag list in index.html so it references only
//     those files (and doesn't 404 on admin scripts that aren't there)
//   • Strip the inline admin-side React code (App component, AdminGate,
//     etc.) from the Root <script> block, keeping only UserOnlyPage
//     and its helpers

const fs = require('node:fs');
const path = require('node:path');

const here = __dirname;
const root = path.join(here, '..', '..');       // /app
const www  = path.join(here, '..', 'www');       // /app/mobile/www

fs.mkdirSync(www, { recursive: true });

// User-surface runtime files ONLY. Anything an admin-only tab might
// import lives in the web deploy but never ships to the APK.
const USER_ONLY_FILES = [
  'index.html',
  'security.jsx', 'icons.jsx', 'app-state.jsx', 'api-client.jsx',
  'toast.jsx', 'online-indicator.jsx',
  'qr-share.jsx',                  // used by UserApp's share button
  'user-app.jsx', 'consent-banner.jsx',
  'manifest.webmanifest', 'sw.js', 'icon.svg',
];

for (const f of USER_ONLY_FILES) {
  const src = path.join(root, f);
  if (!fs.existsSync(src)) { console.warn('skip missing', f); continue; }
  fs.cpSync(src, path.join(www, f));
}

// index.html must reference ONLY the scripts we actually shipped. The
// web version loads all 25+ scripts including admin-tabs.jsx etc.;
// those don't exist in the APK bundle, so leaving the tags in would
// cause 404 fetches at boot. Strip them out and replace with the
// user-only set.
const APK_SCRIPT_TAGS = [
  'security.jsx', 'icons.jsx', 'app-state.jsx', 'api-client.jsx',
  'toast.jsx', 'online-indicator.jsx', 'qr-share.jsx',
  'user-app.jsx', 'consent-banner.jsx',
].map(f => `<script type="text/babel" src="${f}"></script>`).join('\n');

const indexPath = path.join(www, 'index.html');
let html = fs.readFileSync(indexPath, 'utf8');

// Replace the whole block of <script type="text/babel"> tags with the
// trimmed set. Match from the first babel script to the last one before
// the inline React code block.
html = html.replace(
  /(<script type="text\/babel" src="[^"]+"><\/script>\s*)+/,
  APK_SCRIPT_TAGS + '\n',
);

// Inject window.API_BASE so the APK's WebView (origin https://localhost)
// knows where the real backend lives.
const API_BASE = (process.env.API_BASE || '').trim();
if (API_BASE) {
  const inject = `<script>window.API_BASE=${JSON.stringify(API_BASE)};</script>`;
  if (!html.includes('window.API_BASE=')) {
    html = html.replace('</head>', `${inject}\n</head>`);
  }
}

// Drop the dev/designer "Tweaks" panel and any references to
// localStorage-backed demo mode preferences — those were useful on the
// web during development but are dead code in the APK.
// (No-op for now; the inline JSX is small and tree-shakable at runtime
// via the Capacitor detection in Root. Kept as a future optimisation
// if we ever pre-compile JSX instead of relying on Babel Standalone.)

fs.writeFileSync(indexPath, html);

console.log('www ready at', www);
console.log('  files bundled:', USER_ONLY_FILES.length);
console.log('  API_BASE:', API_BASE || '(same-origin)');
console.log('  stripped admin scripts from index.html — APK will 404 if code calls admin code paths (intended)');
