// utils/sanitize.js — Server-side twin of frontend security.jsx.
// NEVER trust client-sent fields. Everything that lands in Mongo passes here.

import crypto from 'node:crypto';
import { env } from '../config/env.js';

export const LIMITS = Object.freeze({
  MAX_BUTTONS: 12,
  MAX_BANNERS: 20,
  MAX_LABEL: 40,
  MAX_SUB: 80,
  MAX_URL: 2048,
  MAX_VALUE: 160,
  MAX_APPNAME: 60,
  MAX_TAGLINE: 140,
  MAX_TAG: 32,
  MAX_TAGS_PER_BTN: 6,
});

export const ALLOWED = Object.freeze({
  ICONS: ['leaf','star','tag','book','truck','pin','heart','gift','calendar','chat','camera','music','sparkle','line','messenger','whatsapp','phone','email'],
  CHANNELS: ['line','messenger','whatsapp','phone','email'],
  TONES: ['leaf','sun','clay','sky','plum'],
  THEMES: ['cream','sage','midnight','sunset'],
  VARIANTS: ['', 'a', 'b'],
  DARK_MODES: ['auto', 'light', 'dark'],
  LANGS: ['th', 'en'],
});

const SAFE_URL_RE = /^(https?:\/\/|tel:|mailto:|line:\/\/|fb-messenger:\/\/|whatsapp:\/\/)[^\s<>"'`]*$/i;
const RELATIVE_UPLOAD_RE = /^\/uploads\/[a-f0-9]{24}\.(jpe?g|png|webp|gif)$/i;

export function safeUrl(u) {
  if (typeof u !== 'string') return '';
  const trimmed = u.trim().slice(0, LIMITS.MAX_URL);
  if (!trimmed) return '';
  if (/[\x00-\x1F\x7F]/.test(trimmed)) return '';
  // Allow self-hosted upload paths too
  if (RELATIVE_UPLOAD_RE.test(trimmed)) return trimmed;
  if (!SAFE_URL_RE.test(trimmed)) return '';
  if (/^https?:\/\//i.test(trimmed)) {
    try {
      const parsed = new URL(trimmed);
      if (!/^https?:$/.test(parsed.protocol)) return '';
      return parsed.toString();
    } catch { return ''; }
  }
  return trimmed;
}

export function safeText(s, max = 200) {
  if (typeof s !== 'string') return '';
  return s
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}

function pick(v, allowed, fallback) {
  return allowed.includes(v) ? v : fallback;
}

function safeDate(v) {
  if (!v) return null;
  const d = new Date(v);
  return isNaN(d.getTime()) ? null : d;
}

function safeTags(arr) {
  if (!Array.isArray(arr)) return [];
  const seen = new Set();
  const out = [];
  for (const raw of arr) {
    const t = safeText(raw, LIMITS.MAX_TAG).toLowerCase();
    if (!t || seen.has(t)) continue;
    seen.add(t); out.push(t);
    if (out.length >= LIMITS.MAX_TAGS_PER_BTN) break;
  }
  return out;
}

export function sanitizeConfig(raw) {
  if (!raw || typeof raw !== 'object') throw new Error('invalid_config');

  const buttons = Array.isArray(raw.buttons) ? raw.buttons.slice(0, LIMITS.MAX_BUTTONS).map(b => ({
    id:    safeText(b && b.id, 32) || crypto.randomUUID(),
    label: safeText(b && b.label, LIMITS.MAX_LABEL) || 'ปุ่ม',
    sub:   safeText(b && b.sub, LIMITS.MAX_SUB),
    icon:  pick(b && b.icon, ALLOWED.ICONS, 'sparkle'),
    url:   safeUrl(b && b.url),
    tags:  safeTags(b && b.tags),
    publishAt:   safeDate(b && b.publishAt),
    unpublishAt: safeDate(b && b.unpublishAt),
    variant:     pick((b && b.variant) || '', ALLOWED.VARIANTS, ''),
  })) : [];

  const banners = Array.isArray(raw.banners) ? raw.banners.slice(0, LIMITS.MAX_BANNERS).map(b => ({
    id:       safeText(b && b.id, 32) || crypto.randomUUID(),
    title:    safeText(b && b.title, LIMITS.MAX_LABEL),
    subtitle: safeText(b && b.subtitle, LIMITS.MAX_SUB),
    tone:     pick(b && b.tone, ALLOWED.TONES, 'leaf'),
    imageUrl: safeUrl(b && b.imageUrl),
    linkUrl:  safeUrl(b && b.linkUrl),
  })) : [];

  const contactRaw = (raw.contact && typeof raw.contact === 'object') ? raw.contact : {};
  const contact = {
    label:   safeText(contactRaw.label, LIMITS.MAX_LABEL) || 'ติดต่อแอดมิน',
    channel: pick(contactRaw.channel, ALLOWED.CHANNELS, 'line'),
    value:   safeText(contactRaw.value, LIMITS.MAX_VALUE),
  };

  // Feature flags: object of scalars only
  let featureFlags = {};
  if (raw.featureFlags && typeof raw.featureFlags === 'object') {
    for (const [k, v] of Object.entries(raw.featureFlags)) {
      const key = safeText(k, 48);
      if (!key) continue;
      if (['boolean', 'string', 'number'].includes(typeof v)) featureFlags[key] = v;
    }
  }

  return {
    appName: safeText(raw.appName, LIMITS.MAX_APPNAME) || 'แอปของฉัน',
    tagline: safeText(raw.tagline, LIMITS.MAX_TAGLINE),
    theme:   pick(raw.theme, ALLOWED.THEMES, 'cream'),
    language: pick(raw.language, ALLOWED.LANGS, 'th'),
    darkMode: pick(raw.darkMode, ALLOWED.DARK_MODES, 'auto'),
    featureFlags,
    banners,
    buttons: buttons.length ? buttons : [{
      id: crypto.randomUUID(), label: 'ปุ่มแรก', sub: '', icon: 'sparkle', url: '', tags: [],
      publishAt: null, unpublishAt: null, variant: '',
    }],
    contact,
  };
}

export function hashIp(ip) {
  if (!ip) return '';
  return crypto
    .createHmac('sha256', env.IP_SALT)
    .update(String(ip))
    .digest('hex')
    .slice(0, 24);
}
