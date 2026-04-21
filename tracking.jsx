// tracking.jsx — Anonymous growth / retention instrumentation.
//
// Design goals:
//   • No PII. The only persistent identifier is a client-generated
//     UUID stored in localStorage; the backend never resolves it to
//     a person.
//   • Attribution is sticky. Whatever install token / UTM params the
//     device arrived with are captured ONCE on first open and never
//     overwritten, so later organic opens don't steal the credit.
//   • Consent-gated. If the user denies analytics via consent-banner
//     we short-circuit every path — no network, no storage writes
//     except the `analytics_consent='denied'` flag itself.
//   • Batched + best-effort. Events queue for 1.5 s before flushing
//     so a rapid tap storm becomes one request. Flush uses
//     navigator.sendBeacon on unload so nothing is lost to the
//     "browser closed" race.
//   • Never throws. Every write is wrapped — analytics failing must
//     not break the app flow.

const DEVICE_KEY      = 'device_id_v1';
const SOURCE_KEY      = 'source_token_v1';
const UTM_SOURCE_KEY  = 'utm_source_v1';
const UTM_CAMPAIGN_KEY = 'utm_campaign_v1';
const UTM_MEDIUM_KEY  = 'utm_medium_v1';
const UTM_CONTENT_KEY = 'utm_content_v1';
const MEDIUM_KEY      = 'first_seen_medium_v1';
const CONSENT_KEY     = 'analytics_consent';

const SESSION_IDLE_MS = 30 * 60_000;  // session ends after 30 min in background
const FLUSH_DEBOUNCE  = 1500;         // batch events for up to 1.5 s

function _ls(op, k, v) {
  try {
    if (op === 'get') return localStorage.getItem(k);
    if (op === 'set') return localStorage.setItem(k, v);
    if (op === 'del') return localStorage.removeItem(k);
  } catch { return null; }
}

function _consented() {
  // Default to accepted when the user hasn't interacted with the banner
  // yet — consent-banner.jsx flips this to 'denied' the moment they
  // click Deny. This matches our existing /track behaviour.
  return _ls('get', CONSENT_KEY) !== 'denied';
}

function _uuid() {
  try { if (crypto && crypto.randomUUID) return crypto.randomUUID(); } catch {}
  // Fallback: RFC-4122-ish v4 from Math.random (not cryptographic,
  // but good enough for anonymous device IDs).
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = Math.random() * 16 | 0;
    return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
  });
}

// ── Device identity ────────────────────────────────────────────
function getDeviceId() {
  let id = _ls('get', DEVICE_KEY);
  if (!id) { id = _uuid(); _ls('set', DEVICE_KEY, id); }
  return id;
}

// ── Platform fingerprint ───────────────────────────────────────
function detectPlatform() {
  const ua = (typeof navigator !== 'undefined' && navigator.userAgent) || '';
  const isCapacitor = (typeof window !== 'undefined' && !!window.Capacitor) || /Capacitor/i.test(ua);
  let platform = 'web';
  if (/android/i.test(ua))                    platform = isCapacitor ? 'android-apk' : 'android-web';
  else if (/iphone|ipad|ipod/i.test(ua))      platform = isCapacitor ? 'ios-apk' : 'ios-web';
  else if (!isCapacitor)                      platform = 'web-desktop';

  const osMatch = ua.match(/Android (\d+(?:\.\d+)?)/)
               || ua.match(/iPhone OS (\d+[_.]\d+)/)
               || ua.match(/Mac OS X (\d+[_.]\d+)/)
               || ua.match(/Windows NT (\d+\.\d+)/);
  const osVersion = osMatch ? (osMatch[1] || '').replace('_', '.') : '';

  // Coarse device model — Android UAs like "; SM-A536E)" → "SM-A536E".
  const modelMatch = ua.match(/;\s*([A-Z0-9-]{3,40})\s*(?:Build|\))/);
  const deviceModel = modelMatch ? modelMatch[1] : '';

  let medium = 'browser';
  if      (isCapacitor)                                  medium = 'apk';
  else if (/jp\.naver\.line/i.test(ua) || /\bLine\b/.test(ua)) medium = 'line-inapp';
  else if (/FBAN|FBAV/i.test(ua))                        medium = 'facebook-inapp';
  else if (/Instagram/i.test(ua))                        medium = 'instagram-inapp';
  else if (/Messenger/i.test(ua))                        medium = 'messenger-inapp';
  else if (/Twitter/i.test(ua))                          medium = 'twitter-inapp';
  else if (/Chrome\//.test(ua) && !/Edg\//.test(ua))     medium = 'chrome';
  else if (/Safari\//.test(ua) && !/Chrome\//.test(ua))  medium = 'safari';

  return { platform, osVersion, deviceModel, medium };
}

// ── Attribution capture ────────────────────────────────────────
// Runs once on boot. Grabs install token from the URL path, UTM params
// from the query string, and the "first seen medium" from the user
// agent. Persists only if the key isn't already set — attribution
// never gets overwritten by a later organic open.
function captureSourceContext() {
  if (typeof location === 'undefined') return;
  try {
    // Install token → /install/<token> or /download/<token>
    const path = location.pathname || '';
    const m = path.match(/^\/(install|download)\/([A-Za-z0-9_-]{8,64})/);
    if (m && !_ls('get', SOURCE_KEY)) _ls('set', SOURCE_KEY, m[2]);

    // UTM params
    const qs = new URLSearchParams(location.search || '');
    if (qs.get('utm_source')   && !_ls('get', UTM_SOURCE_KEY))   _ls('set', UTM_SOURCE_KEY,   qs.get('utm_source').slice(0, 40));
    if (qs.get('utm_campaign') && !_ls('get', UTM_CAMPAIGN_KEY)) _ls('set', UTM_CAMPAIGN_KEY, qs.get('utm_campaign').slice(0, 60));
    if (qs.get('utm_medium')   && !_ls('get', UTM_MEDIUM_KEY))   _ls('set', UTM_MEDIUM_KEY,   qs.get('utm_medium').slice(0, 40));
    if (qs.get('utm_content')  && !_ls('get', UTM_CONTENT_KEY))  _ls('set', UTM_CONTENT_KEY,  qs.get('utm_content').slice(0, 60));

    // First-seen medium — pinned so later opens from a different
    // browser/app don't relabel the device.
    if (!_ls('get', MEDIUM_KEY)) {
      const { medium } = detectPlatform();
      if (medium) _ls('set', MEDIUM_KEY, medium);
    }

    // Phase 3 push CTR: if we landed here with ?c=<campaignId>, this
    // open is attributable to that push. Fire push_click so the admin
    // can measure campaign performance. Scrub the param so subsequent
    // refreshes don't double-count.
    const c = qs.get('c');
    if (c && /^[A-Za-z0-9_-]{8,40}$/.test(c)) {
      enqueue('push_click', { target: c });
      try {
        qs.delete('c');
        const clean = location.pathname + (qs.toString() ? ('?' + qs.toString()) : '') + (location.hash || '');
        history.replaceState({}, '', clean);
      } catch {}
    }
  } catch {}
}

function getAttribution() {
  return {
    sourceToken:     _ls('get', SOURCE_KEY)       || '',
    utmSource:       _ls('get', UTM_SOURCE_KEY)   || '',
    utmCampaign:     _ls('get', UTM_CAMPAIGN_KEY) || '',
    utmMedium:       _ls('get', UTM_MEDIUM_KEY)   || '',
    utmContent:      _ls('get', UTM_CONTENT_KEY)  || '',
    firstSeenMedium: _ls('get', MEDIUM_KEY)       || '',
  };
}

// ── Session lifecycle ──────────────────────────────────────────
let _sessionId = null;
let _sessionStart = 0;
let _hiddenAt = 0;

function getSessionId() {
  if (!_sessionId) beginSession();
  return _sessionId;
}
function beginSession() {
  if (_sessionId) return _sessionId;
  _sessionId = _uuid();
  _sessionStart = Date.now();
  enqueue('session_start');
  return _sessionId;
}
function endSession(reason = 'unload') {
  if (!_sessionId) return;
  const duration = Date.now() - _sessionStart;
  enqueue('session_end', { durationMs: duration, label: reason }, /* immediate */ true);
  _sessionId = null;
  _sessionStart = 0;
}

// ── Event queue + flush ────────────────────────────────────────
const _queue = [];
let   _flushTimer = null;

function enqueue(type, data = {}, immediate = false) {
  if (!_consented()) return;
  // Start a session on first event of the run so session_id is set
  // before the event is emitted (unless the event IS session_start).
  if (!_sessionId && type !== 'session_start') beginSession();
  _queue.push({
    type,
    target:     String(data.target || '').slice(0, 256),
    label:      String(data.label  || '').slice(0, 200),
    variant:    String(data.variant || '').slice(0, 8),
    durationMs: Number(data.durationMs) || 0,
  });
  if (immediate) { clearTimeout(_flushTimer); flush(); return; }
  clearTimeout(_flushTimer);
  _flushTimer = setTimeout(flush, FLUSH_DEBOUNCE);
}

function _currentContext(events) {
  const p = detectPlatform();
  const a = getAttribution();
  return {
    events,
    deviceId:   getDeviceId(),
    sessionId:  _sessionId || '',
    appVersion: (typeof window !== 'undefined' && window.APP_BUILD_ID) || '',
    platform:   p.platform,
    osVersion:  p.osVersion,
    deviceModel: p.deviceModel,
    locale:     (typeof navigator !== 'undefined' && navigator.language) || '',
    ...a,
  };
}

function _apiBase() {
  return (typeof window !== 'undefined' && window.API_BASE) || '';
}

async function flush() {
  if (!_queue.length || !_consented()) return;
  const batch = _queue.splice(0, _queue.length);
  const payload = _currentContext(batch);
  try {
    await fetch(_apiBase() + '/api/track/event', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Device':  payload.deviceId,
        'X-Session': payload.sessionId,
      },
      credentials: 'include', cache: 'no-store', keepalive: true,
      body: JSON.stringify(payload),
    });
  } catch {
    // Re-queue only small batches — anything bigger is likely a bug.
    if (batch.length <= 20) _queue.unshift(...batch);
  }
}

// beforeunload / pagehide → sendBeacon. keepalive fetch works on most
// modern browsers, but sendBeacon is the spec'd path for "send this
// as I'm leaving" so we use it as a belt-and-braces.
function _beaconFlush() {
  if (!_queue.length || !_consented()) return;
  const batch = _queue.splice(0, _queue.length);
  const payload = _currentContext(batch);
  try {
    const blob = new Blob([JSON.stringify(payload)], { type: 'application/json' });
    navigator.sendBeacon && navigator.sendBeacon(_apiBase() + '/api/track/event', blob);
  } catch {}
}

// ── Error reporting ────────────────────────────────────────────
// Fire a single-event POST for JS errors. Throttled by a Set of
// (message:url) signatures so a loop can't spam the endpoint.
const _errorSeen = new Set();
function reportError(message, url = '') {
  if (!_consented()) return;
  const sig = String(message).slice(0, 80) + '|' + String(url).slice(0, 80);
  if (_errorSeen.has(sig)) return;
  _errorSeen.add(sig);
  if (_errorSeen.size > 50) { _errorSeen.clear(); _errorSeen.add(sig); }
  const p = detectPlatform();
  const a = getAttribution();
  try {
    fetch(_apiBase() + '/api/track/error', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Device': getDeviceId() },
      credentials: 'include', cache: 'no-store', keepalive: true,
      body: JSON.stringify({
        deviceId: getDeviceId(),
        sessionId: _sessionId || '',
        message: String(message || '').slice(0, 200),
        url:     String(url || location.href || '').slice(0, 256),
        appVersion: (window && window.APP_BUILD_ID) || '',
        platform: p.platform,
        sourceToken: a.sourceToken,
      }),
    }).catch(() => {});
  } catch {}
}

// ── Web Vitals (Phase 4) ───────────────────────────────────────
// Minimal Core Web Vitals reporter — LCP, FID-ish, CLS. Avoids the
// web-vitals npm dependency; uses the PerformanceObserver API directly.
// Reports once per session when the page is backgrounded (the only
// moment values are final for LCP / CLS).
let _lcp = 0;
let _cls = 0;
let _fid = 0;
let _vitalsReported = false;

function installVitals() {
  if (typeof PerformanceObserver === 'undefined') return;
  try {
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        _lcp = Math.max(_lcp, entry.renderTime || entry.loadTime || entry.startTime);
      }
    }).observe({ type: 'largest-contentful-paint', buffered: true });
  } catch {}
  try {
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        if (!entry.hadRecentInput) _cls += entry.value;
      }
    }).observe({ type: 'layout-shift', buffered: true });
  } catch {}
  try {
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        if (!_fid) _fid = entry.processingStart - entry.startTime;
      }
    }).observe({ type: 'first-input', buffered: true });
  } catch {}
}

function reportVitalsOnce() {
  if (_vitalsReported) return;
  _vitalsReported = true;
  // Values expressed as durationMs on a screen_view event so it rides
  // the existing EventLog pipeline without a new endpoint. label=Web
  // Vitals, target encodes the metric name + value.
  try {
    if (_lcp > 0) enqueue('screen_view', { target: 'web_vitals:lcp', label: String(Math.round(_lcp)), durationMs: Math.round(_lcp) });
    if (_fid > 0) enqueue('screen_view', { target: 'web_vitals:fid', label: String(Math.round(_fid)), durationMs: Math.round(_fid) });
    if (_cls > 0) enqueue('screen_view', { target: 'web_vitals:cls', label: _cls.toFixed(3),          durationMs: Math.round(_cls * 1000) });
  } catch {}
}

// ── Wire up browser lifecycle once ─────────────────────────────
function install() {
  if (typeof window === 'undefined' || window.__tracking_installed) return;
  window.__tracking_installed = true;

  // Capture attribution FIRST so the first event carries it.
  captureSourceContext();

  // Web Vitals observers spin up now so LCP/CLS/FID have the whole
  // session to collect entries.
  installVitals();

  // Emit the final session_end + Web Vitals + flush anything queued
  // when the user closes / backgrounds the tab.
  window.addEventListener('pagehide',     () => { reportVitalsOnce(); endSession('pagehide'); _beaconFlush(); });
  window.addEventListener('beforeunload', () => { reportVitalsOnce(); _beaconFlush(); });

  // Session idle: if the tab goes hidden for more than SESSION_IDLE_MS
  // we close the current session. Coming back creates a new one.
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) { _hiddenAt = Date.now(); }
    else {
      const idle = _hiddenAt ? Date.now() - _hiddenAt : 0;
      _hiddenAt = 0;
      if (idle > SESSION_IDLE_MS) { endSession('idle_timeout'); beginSession(); }
    }
  });

  // Global error reporter.
  window.addEventListener('error', (e) => {
    reportError(e?.message || 'unknown_error', e?.filename || '');
  });
  window.addEventListener('unhandledrejection', (e) => {
    const msg = (e && e.reason && (e.reason.message || String(e.reason))) || 'unhandled_promise';
    reportError(msg, location.href);
  });
}

// ── Public surface ─────────────────────────────────────────────
const tracking = {
  install,
  captureSourceContext,
  getDeviceId,
  getSessionId,
  getAttribution,
  detectPlatform,
  emit: enqueue,
  flush,
  endSession,
  reportError,
};

if (typeof window !== 'undefined') {
  window.tracking = tracking;
  // Auto-install on module load so callers just call tracking.emit(...)
  install();
}
