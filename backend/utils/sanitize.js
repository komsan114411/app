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
});

export const ALLOWED = Object.freeze({
  ICONS: ['leaf','star','tag','book','truck','pin','heart','gift','calendar','chat','camera','music','sparkle','line','messenger','whatsapp','phone','email'],
  CHANNELS: ['line','messenger','whatsapp','phone','email'],
  TONES: ['leaf','sun','clay','sky','plum'],
  THEMES: ['cream','sage','midnight','sunset'],
});

const SAFE_URL_RE = /^(https?:\/\/|tel:|mailto:|line:\/\/|fb-messenger:\/\/|whatsapp:\/\/)[^\s<>"'`]*$/i;

export function safeUrl(u) {
  if (typeof u !== 'string') return '';
  const trimmed = u.trim().slice(0, LIMITS.MAX_URL);
  if (!trimmed) return '';
  if (/[\x00-\x1F\x7F]/.test(trimmed)) return '';
  if (!SAFE_URL_RE.test(trimmed)) return '';
  if (/^https?:\/\//i.test(trimmed)) {
    try {
      const parsed = new URL(trimmed);
      if (!/^https?:$/.test(parsed.protocol)) return '';
      // Block SSRF targets if URLs ever get fetched server-side.
      // Since we only echo URLs back to clients, this is advisory.
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

export function sanitizeConfig(raw) {
  if (!raw || typeof raw !== 'object') throw new Error('invalid_config');

  const buttons = Array.isArray(raw.buttons) ? raw.buttons.slice(0, LIMITS.MAX_BUTTONS).map(b => ({
    id:    safeText(b && b.id, 32) || crypto.randomUUID(),
    label: safeText(b && b.label, LIMITS.MAX_LABEL) || 'ปุ่ม',
    sub:   safeText(b && b.sub, LIMITS.MAX_SUB),
    icon:  pick(b && b.icon, ALLOWED.ICONS, 'sparkle'),
    url:   safeUrl(b && b.url),
  })) : [];

  const banners = Array.isArray(raw.banners) ? raw.banners.slice(0, LIMITS.MAX_BANNERS).map(b => ({
    id:       safeText(b && b.id, 32) || crypto.randomUUID(),
    title:    safeText(b && b.title, LIMITS.MAX_LABEL),
    subtitle: safeText(b && b.subtitle, LIMITS.MAX_SUB),
    tone:     pick(b && b.tone, ALLOWED.TONES, 'leaf'),
  })) : [];

  const contactRaw = (raw.contact && typeof raw.contact === 'object') ? raw.contact : {};
  const contact = {
    label:   safeText(contactRaw.label, LIMITS.MAX_LABEL) || 'ติดต่อแอดมิน',
    channel: pick(contactRaw.channel, ALLOWED.CHANNELS, 'line'),
    value:   safeText(contactRaw.value, LIMITS.MAX_VALUE),
  };

  return {
    appName: safeText(raw.appName, LIMITS.MAX_APPNAME) || 'แอปของฉัน',
    tagline: safeText(raw.tagline, LIMITS.MAX_TAGLINE),
    theme:   pick(raw.theme, ALLOWED.THEMES, 'cream'),
    banners,
    buttons: buttons.length ? buttons : [{
      id: crypto.randomUUID(), label: 'ปุ่มแรก', sub: '', icon: 'sparkle', url: '',
    }],
    contact,
  };
}

// Hash an IP for analytics — we want uniqueness buckets without storing PII.
export function hashIp(ip) {
  if (!ip) return '';
  return crypto
    .createHmac('sha256', env.IP_SALT)
    .update(String(ip))
    .digest('hex')
    .slice(0, 24);
}
