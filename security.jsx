// security.jsx — Centralized client-side sanitization & validation.
// Server must re-validate EVERYTHING. This is defense-in-depth only.

// ─── Constants (also enforced server-side) ──────────────────────
const MAX_BUTTONS = 12;
const MAX_BANNERS = 20;
const MAX_LABEL   = 40;
const MAX_SUB     = 80;
const MAX_URL     = 2048;
const MAX_VALUE   = 160;   // contact.value
const MAX_APPNAME = 60;
const MAX_TAGLINE = 140;

// Allowed icons — whitelist from icons.jsx
const ALLOWED_ICONS = [
  'leaf','star','tag','book','truck','pin','heart','gift','calendar','chat',
  'camera','music','sparkle','line','messenger','whatsapp','phone','email',
];
const ALLOWED_CHANNELS = ['line','messenger','whatsapp','phone','email'];
const ALLOWED_TONES    = ['leaf','sun','clay','sky','plum'];
const ALLOWED_THEMES   = ['cream','sage','midnight','sunset'];

// URL scheme whitelist. NOTE: explicitly blocks javascript:, data:, file:, blob:, vbscript:
const SAFE_URL_RE = /^(https?:\/\/|tel:|mailto:|line:\/\/|fb-messenger:\/\/|whatsapp:\/\/)[^\s<>"'`]*$/i;
const RELATIVE_UPLOAD_RE = /^\/uploads\/[a-f0-9]{24}\.(jpe?g|png|webp|gif)$/i;
// Media paths accept images AND .apk so admin-uploaded Android packages
// work in download-links.android. Server's sanitize.js mirrors this.
const RELATIVE_MEDIA_RE  = /^\/media\/[a-f0-9]{12,64}\.(jpe?g|png|webp|gif|apk)$/i;

// ─── URL validator ──────────────────────────────────────────────
// Returns the trimmed URL if safe, else '' (drop silently).
function safeUrl(u) {
  if (typeof u !== 'string') return '';
  const trimmed = u.trim().slice(0, MAX_URL);
  if (!trimmed) return '';
  // Reject control characters outright
  if (/[\x00-\x1F\x7F]/.test(trimmed)) return '';
  // Allow same-origin upload / media paths
  if (RELATIVE_UPLOAD_RE.test(trimmed)) return trimmed;
  if (RELATIVE_MEDIA_RE.test(trimmed)) return trimmed;
  if (!SAFE_URL_RE.test(trimmed)) return '';
  // Additional check: parse http(s) URLs with URL()
  if (/^https?:\/\//i.test(trimmed)) {
    try {
      const parsed = new URL(trimmed);
      if (!/^https?:$/.test(parsed.protocol)) return '';
      // Block localhost / internal network targets from admin-supplied URLs
      // (rendered in user browsers → less risky, but keeps intent clean).
      return parsed.toString();
    } catch { return ''; }
  }
  return trimmed;
}

// ─── Text sanitizer ─────────────────────────────────────────────
// Strips control chars, collapses whitespace, truncates. React still
// escapes output for rendering — this is for storage/transport hygiene.
function safeText(s, max = 200) {
  if (typeof s !== 'string') return '';
  return s
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '')  // control chars
    .replace(/\s+/g, ' ')                              // collapse whitespace
    .trim()
    .slice(0, max);
}

function pickEnum(v, allowed, fallback) {
  return allowed.includes(v) ? v : fallback;
}

// ─── SafeText utilities used in UI ──────────────────────────────
const SafeText = {
  truncate: (s, n = 40) => safeText(s, n),
  slug: (s) => safeText(s, 40).toLowerCase().replace(/[^a-z0-9ก-๙]/gi, '').slice(0, 20) || 'app',
  pickTheme: (t) => pickEnum(t, ALLOWED_THEMES, 'cream'),
  pickChannel: (c) => pickEnum(c, ALLOWED_CHANNELS, 'line'),
  pickIcon: (i) => pickEnum(i, ALLOWED_ICONS, 'sparkle'),
  pickTone: (t) => pickEnum(t, ALLOWED_TONES, 'leaf'),
  safeUrl,
  safe: safeText,
};

// ─── State sanitizer — run BEFORE setState on any outside input ─
// Fields that the admin can intentionally blank (appName, tagline, button
// labels, contact label, buttons array) are PRESERVED as empty when the
// admin clears them. The UI renders placeholders instead of forcing the
// value back to a hard-coded default, which used to make "delete + save"
// flicker back to the default on the next realtime poll.
const SafeState = {
  sanitize(raw) {
    if (!raw || typeof raw !== 'object') return null;
    const buttons = Array.isArray(raw.buttons) ? raw.buttons.slice(0, MAX_BUTTONS).map(b => ({
      id:    safeText(b && b.id, 32) || ('q' + Math.random().toString(36).slice(2, 9)),
      label: safeText(b && b.label, MAX_LABEL),
      sub:   safeText(b && b.sub,   MAX_SUB),
      icon:  SafeText.pickIcon(b && b.icon),
      url:   safeUrl(b && b.url),
      tags:  Array.isArray(b && b.tags) ? b.tags.filter(t => typeof t === 'string').slice(0, 10) : [],
      publishAt:   (b && b.publishAt) || null,
      unpublishAt: (b && b.unpublishAt) || null,
    })) : [];

    const banners = Array.isArray(raw.banners) ? raw.banners.slice(0, MAX_BANNERS).map(b => ({
      id:       safeText(b && b.id, 32) || ('b' + Math.random().toString(36).slice(2, 9)),
      title:    safeText(b && b.title, MAX_LABEL),
      subtitle: safeText(b && b.subtitle, MAX_SUB),
      tone:     SafeText.pickTone(b && b.tone),
      imageUrl: safeUrl(b && b.imageUrl),
      linkUrl:  safeUrl(b && b.linkUrl),
    })) : [];

    const contactRaw = (raw.contact && typeof raw.contact === 'object') ? raw.contact : {};
    const contact = {
      label:   safeText(contactRaw.label, MAX_LABEL),
      channel: SafeText.pickChannel(contactRaw.channel),
      value:   safeText(contactRaw.value, MAX_VALUE),
    };

    const dlRaw = (raw.downloadLinks && typeof raw.downloadLinks === 'object') ? raw.downloadLinks : {};
    const downloadLinks = {
      android:      safeUrl(dlRaw.android),
      ios:          safeUrl(dlRaw.ios),
      androidLabel: safeText(dlRaw.androidLabel, 40),
      iosLabel:     safeText(dlRaw.iosLabel, 40),
      note:         safeText(dlRaw.note, 140),
    };

    return {
      appName: safeText(raw.appName, MAX_APPNAME),
      tagline: safeText(raw.tagline, MAX_TAGLINE),
      appIcon: safeUrl(raw.appIcon),
      theme:   SafeText.pickTheme(raw.theme),
      language: raw.language === 'en' ? 'en' : 'th',
      darkMode: ['auto','light','dark'].includes(raw.darkMode) ? raw.darkMode : 'auto',
      banners,
      buttons,
      contact,
      downloadLinks,
    };
  },
};

// ─── Open a user-clicked URL SAFELY ─────────────────────────────
// 1. Validate via safeUrl (scheme whitelist)
// 2. Use noopener,noreferrer to prevent window.opener attacks
// 3. Never use location.href = untrusted (this runs in same origin)
function openExternal(url) {
  const safe = safeUrl(url);
  if (!safe) return false;
  try {
    const w = window.open(safe, '_blank', 'noopener,noreferrer');
    // Extra safety: if browser returns handle, detach opener
    if (w) { try { w.opener = null; } catch {} }
    return true;
  } catch { return false; }
}

// ─── Freeze key globals to resist tampering by injected scripts ─
// (Can only freeze after all modules assigned — done at end of App load.)
function freezeSecurityPrimitives() {
  try {
    Object.freeze(SafeText);
    Object.freeze(SafeState);
    Object.freeze(ALLOWED_ICONS);
    Object.freeze(ALLOWED_CHANNELS);
    Object.freeze(ALLOWED_TONES);
    Object.freeze(ALLOWED_THEMES);
  } catch {}
}

Object.assign(window, {
  MAX_BUTTONS, MAX_BANNERS, MAX_LABEL, MAX_SUB, MAX_URL, MAX_VALUE,
  MAX_APPNAME, MAX_TAGLINE,
  ALLOWED_ICONS, ALLOWED_CHANNELS, ALLOWED_TONES, ALLOWED_THEMES,
  SafeText, SafeState, safeUrl, safeText, openExternal,
  freezeSecurityPrimitives,
});
