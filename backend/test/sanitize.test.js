// Pure-function tests — fastest feedback loop, no DB needed.

import { describe, it, expect } from 'vitest';
import { safeUrl, safeText, sanitizeConfig, hashIp } from '../utils/sanitize.js';

process.env.IP_SALT = process.env.IP_SALT || 'z'.repeat(32);

describe('safeUrl', () => {
  it('accepts https', () => {
    expect(safeUrl('https://example.com/path')).toBe('https://example.com/path');
  });
  it('accepts tel:', () => {
    expect(safeUrl('tel:0812345678')).toBe('tel:0812345678');
  });
  it('accepts mailto:', () => {
    expect(safeUrl('mailto:foo@bar.com')).toBe('mailto:foo@bar.com');
  });
  it('rejects javascript:', () => {
    expect(safeUrl('javascript:alert(1)')).toBe('');
  });
  it('rejects data:', () => {
    expect(safeUrl('data:text/html,<script>alert(1)</script>')).toBe('');
  });
  it('rejects file:', () => {
    expect(safeUrl('file:///etc/passwd')).toBe('');
  });
  it('rejects vbscript:', () => {
    expect(safeUrl('vbscript:msgbox')).toBe('');
  });
  it('rejects control characters', () => {
    expect(safeUrl('https://example.com/\x00evil')).toBe('');
    expect(safeUrl('https://example.com/\r\nSet-Cookie')).toBe('');
  });
  it('caps at 2048 chars', () => {
    const long = 'https://example.com/' + 'a'.repeat(3000);
    const out = safeUrl(long);
    expect(out.length).toBeLessThanOrEqual(2048);
  });
  it('returns empty for non-strings', () => {
    expect(safeUrl(null)).toBe('');
    expect(safeUrl(undefined)).toBe('');
    expect(safeUrl(123)).toBe('');
    expect(safeUrl({})).toBe('');
  });
});

describe('safeText', () => {
  it('strips control chars', () => {
    expect(safeText('hello\x00\x07world')).toBe('helloworld');
  });
  it('collapses whitespace', () => {
    expect(safeText('a   b\n\tc')).toBe('a b c');
  });
  it('trims', () => {
    expect(safeText('   hi   ')).toBe('hi');
  });
  it('caps length', () => {
    expect(safeText('a'.repeat(500), 10)).toBe('aaaaaaaaaa');
  });
});

describe('sanitizeConfig', () => {
  it('drops javascript: URLs in buttons', () => {
    const out = sanitizeConfig({
      appName: 'test',
      buttons: [{ id: 'a', label: 'x', url: 'javascript:alert(1)' }],
    });
    expect(out.buttons[0].url).toBe('');
  });
  it('caps button count at 12', () => {
    const buttons = Array.from({ length: 50 }, (_, i) => ({ id: 'b' + i, label: 'x' }));
    const out = sanitizeConfig({ appName: 'x', buttons });
    expect(out.buttons.length).toBe(12);
  });
  it('forces at least one button', () => {
    const out = sanitizeConfig({ appName: 'x', buttons: [] });
    expect(out.buttons.length).toBe(1);
  });
  it('falls back to valid enums', () => {
    const out = sanitizeConfig({ appName: 'x', theme: 'evil', contact: { channel: 'xss' } });
    expect(out.theme).toBe('cream');
    expect(out.contact.channel).toBe('line');
  });
  it('throws on non-object input', () => {
    expect(() => sanitizeConfig(null)).toThrow();
    expect(() => sanitizeConfig('string')).toThrow();
  });
});

describe('hashIp', () => {
  it('is deterministic', () => {
    expect(hashIp('1.2.3.4')).toBe(hashIp('1.2.3.4'));
  });
  it('differs for different IPs', () => {
    expect(hashIp('1.2.3.4')).not.toBe(hashIp('1.2.3.5'));
  });
  it('returns empty for falsy input', () => {
    expect(hashIp('')).toBe('');
    expect(hashIp(null)).toBe('');
  });
  it('truncates to 24 hex chars', () => {
    expect(hashIp('1.2.3.4').length).toBe(24);
    expect(/^[0-9a-f]{24}$/.test(hashIp('1.2.3.4'))).toBe(true);
  });
});
