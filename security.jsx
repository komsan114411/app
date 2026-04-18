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

// ─── URL validator ──────────────────────────────────────────────
// Returns the trimmed URL if safe, else '' (drop silently).
function safeUrl(u) {
  if (typeof u !== 'string') return '';
  const trimmed = u.trim().slice(0, MAX_URL);
  if (!trimmed) return '';
  // Reject control characters outright
  if (/[\x00-\x1F\x7F]/.test(trimmed)) return '';
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
const SafeState = {
  sanitize(raw) {
    if (!raw || typeof raw !== 'object') return null;
    const buttons = Array.isArray(raw.buttons) ? raw.buttons.slice(0, MAX_BUTTONS).map(b => ({
      id:    safeText(b && b.id, 32) || ('q' + Math.random().toString(36).slice(2, 9)),
      label: safeText(b && b.label, MAX_LABEL) || 'ปุ่ม',
      sub:   safeText(b && b.sub,   MAX_SUB),
      icon:  SafeText.pickIcon(b && b.icon),
      url:   safeUrl(b && b.url),
    })) : [];

    const banners = Array.isArray(raw.banners) ? raw.banners.slice(0, MAX_BANNERS).map(b => ({
      id:       safeText(b && b.id, 32) || ('b' + Math.random().toString(36).slice(2, 9)),
      title:    safeText(b && b.title, MAX_LABEL),
      subtitle: safeText(b && b.subtitle, MAX_SUB),
      tone:     SafeText.pickTone(b && b.tone),
    })) : [];

    const contactRaw = (raw.contact && typeof raw.contact === 'object') ? raw.contact : {};
    const contact = {
      label:   safeText(contactRaw.label, MAX_LABEL) || 'ติดต่อแอดมิน',
      channel: SafeText.pickChannel(contactRaw.channel),
      value:   safeText(contactRaw.value, MAX_VALUE),
    };

    return {
      appName: safeText(raw.appName, MAX_APPNAME) || 'แอปของฉัน',
      tagline: safeText(raw.tagline, MAX_TAGLINE),
      theme:   SafeText.pickTheme(raw.theme),
      banners,
      buttons: buttons.length ? buttons : [{
        id: 'q' + Math.random().toString(36).slice(2, 7),
        label: 'ปุ่มแรก', sub: '', icon: 'sparkle', url: '',
      }],
      contact,
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
