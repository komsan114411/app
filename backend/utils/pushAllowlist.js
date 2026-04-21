// utils/pushAllowlist.js — Single source of truth for the Web Push
// service hostnames we trust.
//
// Why this matters: an attacker who POSTs a subscription with an
// attacker-controlled endpoint turns every admin broadcast into a
// blind SSRF (web-push.sendNotification posts whatever URL we stored).
// We enforce the allowlist at BOTH write-time (/push/subscribe) and
// send-time (broadcast) for defense-in-depth.
//
// Previously the list was duplicated in routes/public.js and
// routes/admin.js — they drifted, admin.js was missing the Firefox
// push host, so every Firefox subscription was silently deleted on
// broadcast. One list, imported everywhere.

export const PUSH_HOST_ALLOWLIST = Object.freeze([
  'fcm.googleapis.com',                 // Chrome / Chromium (Android + desktop)
  'updates.push.services.mozilla.com',  // Firefox
  'notify.windows.com',                 // Edge (matches *.notify.windows.com)
  'push.apple.com',                     // Safari 16+ (matches *.push.apple.com)
]);

export function isAllowedPushEndpoint(raw) {
  if (typeof raw !== 'string' || raw.length > 1024) return false;
  let u;
  try { u = new URL(raw); } catch { return false; }
  if (u.protocol !== 'https:') return false;
  const host = u.hostname.toLowerCase();
  for (const base of PUSH_HOST_ALLOWLIST) {
    if (host === base || host.endsWith('.' + base)) return true;
  }
  return false;
}
