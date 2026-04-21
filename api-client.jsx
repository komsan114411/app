// api-client.jsx — Frontend ↔ Backend bridge.

const API_BASE = (typeof window !== 'undefined' && window.API_BASE) || '';
const LIVE_POSSIBLE = typeof location !== 'undefined' && location.protocol !== 'file:';

// Rewrites a relative /media/* or /uploads/* URL to an absolute URL on the
// API origin. In the web deploy API_BASE is empty and the browser resolves
// /media/xxx.png against the current origin — works fine. Inside the
// Capacitor APK, the WebView origin is https://localhost and /media/xxx.png
// would 404 locally; we need <API_BASE>/media/xxx.png instead. This helper
// is safe to call on absolute URLs (returned unchanged) and on empty
// values (returned empty).
function absolutizeMedia(u) {
  if (!u || typeof u !== 'string') return '';
  if (/^(https?:|data:|blob:)/i.test(u)) return u;
  if (u.startsWith('/') && API_BASE) return API_BASE + u;
  return u;
}

let accessToken = null;

function readCsrf() {
  return readCookie('__Secure-XSRF-TOKEN') || readCookie('XSRF-TOKEN');
}
function readCookie(name) {
  const m = document.cookie.match(new RegExp('(?:^|; )' + name.replace(/[-.$?*|{}()\[\]\\\/\+^]/g, '\\$&') + '=([^;]*)'));
  return m ? decodeURIComponent(m[1]) : null;
}

let refreshInflight = null;

// Gate noisy diagnostics behind an explicit opt-in so ordinary users
// don't leak capability / boot state to anyone with DevTools access.
// Developers can enable with `window.__DEBUG = true` in the console.
const DEBUG = () => (typeof window !== 'undefined' && window.__DEBUG === true);

async function request(path, { method = 'GET', body, auth = false, retry = true, headers: extraHeaders } = {}) {
  const headers = { 'Accept': 'application/json', ...(extraHeaders || {}) };
  if (body !== undefined && !(body instanceof FormData)) headers['Content-Type'] = 'application/json';
  if (auth && accessToken) headers.Authorization = 'Bearer ' + accessToken;
  if (method !== 'GET' && method !== 'HEAD') {
    const csrf = readCsrf();
    if (csrf) headers['X-CSRF-Token'] = csrf;
  }
  try {
    const consent = localStorage.getItem('analytics_consent');
    if (consent === 'denied') headers['X-Consent'] = '0';
  } catch {}

  let res;
  try {
    res = await fetch(API_BASE + path, {
      method, headers,
      body: body === undefined
        ? undefined
        : (body instanceof FormData ? body : JSON.stringify(body)),
      credentials: 'include', cache: 'no-store',
    });
  } catch (e) {
    if (DEBUG()) console.error('[api]', method, path, 'network_error:', e?.message || e);
    throw new Error('request_failed');
  }

  if (res.status === 401 && auth && retry) {
    const ok = await tryRefresh();
    if (ok) return request(path, { method, body, auth, retry: false, headers: extraHeaders });
  }
  if (res.status === 429) throw new Error('rate_limited');
  if (res.status === 423) throw new Error('account_locked');
  if (res.status === 403) throw new Error('forbidden');
  if (res.status === 413) throw new Error('file_too_large');
  if (res.status === 415) throw new Error('unsupported_media_type');
  if (!res.ok) {
    let code = 'request_failed';
    let body = null;
    try {
      body = await res.json();
      if (body && typeof body.error === 'string') code = body.error.slice(0, 60);
    } catch {}
    const err = new Error(code);
    err.responseBody = body;         // callers can surface suggestions / details
    err.status = res.status;
    throw err;
  }
  if (res.status === 204) return null;
  const ct = res.headers.get('content-type') || '';
  if (ct.includes('application/json')) return res.json();
  return res.text();
}

async function tryRefresh() {
  if (refreshInflight) return refreshInflight;
  refreshInflight = (async () => {
    // Hard 10s timeout — without this, a stalled TCP connection (flaky
    // Capacitor network layer, upstream proxy drop) leaves refreshInflight
    // pinned to a never-resolving promise, and every subsequent 401 retry
    // awaits forever. AbortSignal.timeout is supported on Node 18+ and
    // modern browsers incl. Android WebView 88+.
    const ctl = (typeof AbortSignal !== 'undefined' && AbortSignal.timeout)
      ? AbortSignal.timeout(10_000)
      : undefined;
    try {
      const r = await fetch(API_BASE + '/api/auth/refresh', {
        method: 'POST', credentials: 'include', cache: 'no-store',
        headers: { 'X-CSRF-Token': readCsrf() || '' },
        signal: ctl,
      });
      if (!r.ok) return false;
      const data = await r.json();
      accessToken = data.accessToken;
      return true;
    } catch { return false; }
    finally { refreshInflight = null; }
  })();
  return refreshInflight;
}

const api = {
  async getConfig()              { return request('/api/config'); },
  async trackClick(buttonId, label, variant) {
    try { await request('/api/track', { method: 'POST', body: { buttonId, label, variant } }); } catch {}
  },
  async login(payload) {
    const body = typeof payload === 'string' ? arguments.length === 2 ? { loginId: payload, password: arguments[1] } : { loginId: payload } : payload;
    const data = await request('/api/auth/login', { method: 'POST', body });
    accessToken = data.accessToken;
    return data.user;
  },
  async logout() { try { await request('/api/auth/logout', { method: 'POST' }); } catch {} accessToken = null; },
  isAuthed() { return !!accessToken; },

  async me()                     { return request('/api/admin/me', { auth: true }); },
  async updateProfile(body)      { return request('/api/admin/me', { method: 'PATCH', body, auth: true }); },
  async getStats()               { return request('/api/admin/stats', { auth: true }); },
  async getTimeseries(days = 7)  { return request(`/api/admin/stats/timeseries?days=${days}`, { auth: true }); },
  async getAdminConfig()         { return request('/api/admin/config', { auth: true }); },
  async patchConfig(patch) {
    return request('/api/admin/config', { method: 'PATCH', body: patch, auth: true });
  },
  async uploadBanner(file) {
    const fd = new FormData(); fd.append('file', file);
    return request('/api/admin/upload/banner', { method: 'POST', body: fd, auth: true });
  },
  async uploadApk(file) {
    const fd = new FormData(); fd.append('file', file);
    return request('/api/admin/upload/apk', { method: 'POST', body: fd, auth: true });
  },
  async setDownloadLinks(patch) {
    // Bypasses the main PATCH /config flow and its client-side sanitize —
    // use this when the URL must reach the server verbatim (e.g. after an
    // APK upload on a browser that may have a stale security.jsx cached).
    return request('/api/admin/config/download-links', { method: 'POST', body: patch, auth: true });
  },
  async listApks()            { return request('/api/admin/uploads/apks', { auth: true }); },
  async buildApkStatus()      { return request('/api/admin/build-apk/status', { auth: true }); },
  async triggerApkBuild()     { return request('/api/admin/build-apk', { method: 'POST', auth: true }); },
  async deleteApk(id)         { return request(`/api/admin/uploads/apks/${encodeURIComponent(id)}`, { method: 'DELETE', auth: true }); },
  async getInstallToken()     { return request('/api/admin/install-token', { auth: true }); },
  async rotateInstallToken()  { return request('/api/admin/install-token/rotate', { method: 'POST', auth: true }); },
  async revokeInstallToken()  { return request('/api/admin/install-token/revoke', { method: 'POST', auth: true }); },
  async getInstallConfig(token) { return request(`/api/install/${encodeURIComponent(token)}/config`); },
  async verifyAdminGate(token)  { return request(`/api/admin-gate/${encodeURIComponent(token)}`); },
  async getAdminToken()         { return request('/api/admin/admin-token', { auth: true }); },
  async rotateAdminToken()      { return request('/api/admin/admin-token/rotate', { method: 'POST', auth: true }); },
  async getAnalytics()             { return request('/api/admin/analytics', { auth: true }); },
  async getButtonAnalytics(id)     { return request(`/api/admin/analytics/button/${encodeURIComponent(id)}`, { auth: true }); },
  // Growth / retention (Phase 1 of the analytics plan)
  async getDevicesSummary(days = 30)    { return request(`/api/admin/devices/summary?days=${days}`, { auth: true }); },
  async getDevicesBreakdown(days = 30)  { return request(`/api/admin/devices/breakdown?days=${days}`, { auth: true }); },
  async getFunnel(params = {}) {
    const q = new URLSearchParams({ days: String(params.days || 7) });
    if (params.sourceToken) q.set('sourceToken', params.sourceToken);
    return request(`/api/admin/funnel?${q.toString()}`, { auth: true });
  },
  async getAttribution(days = 30)       { return request(`/api/admin/attribution?days=${days}`, { auth: true }); },
  async getRecentErrors(days = 7)       { return request(`/api/admin/errors/recent?days=${days}`, { auth: true }); },
  async getCohorts(weeks = 8)           { return request(`/api/admin/retention/cohorts?weeks=${weeks}`, { auth: true }); },
  async getSessions(days = 7)           { return request(`/api/admin/sessions/summary?days=${days}`, { auth: true }); },
  async getTimeToFirst(days = 7)        { return request(`/api/admin/time-to-first?days=${days}`, { auth: true }); },
  async getExits(days = 30)             { return request(`/api/admin/exits?days=${days}`, { auth: true }); },
  // Phase 3: re-engagement
  async previewSegment(segment)         { return request('/api/admin/push/segment/preview', { method: 'POST', body: { segment }, auth: true }); },
  async broadcastSegmented(body)        { return request('/api/admin/push/broadcast-segmented', { method: 'POST', body, auth: true }); },
  async listCampaigns()                 { return request('/api/admin/push/campaigns', { auth: true }); },
  async createCampaign(body)            { return request('/api/admin/push/campaigns', { method: 'POST', body, auth: true }); },
  async deleteCampaign(id)              { return request(`/api/admin/push/campaigns/${encodeURIComponent(id)}`, { method: 'DELETE', auth: true }); },
  async getInactive(days = 14)          { return request(`/api/admin/engagement/inactive?days=${days}`, { auth: true }); },
  // Phase 5: advanced
  async getSignificance(id, days = 30)  { return request(`/api/admin/analytics/button/${encodeURIComponent(id)}/significance?days=${days}`, { auth: true }); },
  async getSankey(days = 30)            { return request(`/api/admin/sankey?days=${days}`, { auth: true }); },
  async getAnomaly()                    { return request('/api/admin/anomaly', { auth: true }); },
  async getGeoLocale(days = 30)         { return request(`/api/admin/geo/locale?days=${days}`, { auth: true }); },
  async getAudit(opts = {}) {
    const q = new URLSearchParams({ limit: String(opts.limit || 50) });
    if (opts.cursor) q.set('cursor', opts.cursor);
    if (opts.action) q.set('action', opts.action);
    return request('/api/admin/audit?' + q.toString(), { auth: true });
  },
  auditExportUrl(days = 30)      { return API_BASE + `/api/admin/audit/export?days=${days}`; },
  async listUsers(opts = {}) {
    const q = new URLSearchParams();
    if (opts.q) q.set('q', opts.q);
    if (opts.role) q.set('role', opts.role);
    if (opts.page) q.set('page', String(opts.page));
    if (opts.limit) q.set('limit', String(opts.limit));
    const path = q.toString() ? '/api/admin/users?' + q : '/api/admin/users';
    return request(path, { auth: true });
  },
  async createUser(body)         { return request('/api/admin/users', { method: 'POST', body, auth: true }); },
  async userAction(id, action)   { return request(`/api/admin/users/${id}/${action}`, { method: 'POST', auth: true }); },
  async changeRole(id, role)     { return request(`/api/admin/users/${id}/role`, { method: 'PATCH', body: { role }, auth: true }); },
  async resetUserPassword(id)    { return request(`/api/admin/users/${id}/reset-password`, { method: 'POST', auth: true }); },
  async changePassword(currentPassword, newPassword) {
    // currentPassword is optional when the server sees mustChangePassword=true.
    // Pass an empty string / undefined and the server will accept it.
    const body = currentPassword ? { currentPassword, newPassword } : { newPassword };
    return request('/api/admin/me/password', { method: 'POST', body, auth: true });
  },
  async forgetMe() {
    // Include the client's anonymous device ID if the tracking client
    // has one — the backend then erases Device + EventLog rows keyed to
    // it, not only events keyed to the caller's IP hash.
    let deviceId = '';
    try { deviceId = (window.tracking && window.tracking.getDeviceId && window.tracking.getDeviceId()) || ''; } catch {}
    return request('/api/privacy/forget', { method: 'POST', body: { deviceId } });
  },

  // Push notifications
  async vapidKey()               { return request('/api/push/vapid-key'); },
  async subscribePush(sub) {
    // Attach the anonymous deviceId (if tracking is enabled) so the
    // admin push segmenter can resolve a Device query directly to
    // subscription endpoints instead of the lossy ipHash join.
    let deviceId = '';
    try { deviceId = (window.tracking && window.tracking.getDeviceId && window.tracking.getDeviceId()) || ''; } catch {}
    return request('/api/push/subscribe', { method: 'POST', body: { ...sub, deviceId } });
  },
  async broadcastPush(body)      { return request('/api/admin/push/broadcast', { method: 'POST', body, auth: true }); },

  // Escape hatch
  call: (path, opts) => request(path, opts),
};

async function loadInitialState() {
  if (!API_BASE && !LIVE_POSSIBLE) return { state: DEFAULT_STATE, live: false, authed: false };
  try {
    const cfg = await api.getConfig();
    if (DEBUG()) console.info('[boot] /api/config OK', { appName: cfg && cfg.appName, capabilities: cfg && cfg.capabilities });
    const merged = SafeState.sanitize({ ...DEFAULT_STATE, ...cfg }) || DEFAULT_STATE;
    const authed = await tryRefresh();
    // Growth analytics: signal that the app successfully reached the
    // backend. Fires once per page load. Safe if tracking.jsx didn't
    // load (user blocked it) — we just skip.
    try { if (typeof tracking !== 'undefined') tracking.emit('app_boot'); } catch {}
    return { state: merged, live: true, authed };
  } catch (e) {
    const msg = (e && e.message) || String(e);
    // Don't write error onto window — even innocuous strings help an
    // attacker with XSS read boot context. Surface it to the caller
    // via the return value, which the UI already uses.
    if (DEBUG()) console.error('[boot] live mode failed — falling back to demo:', msg);
    return { state: DEFAULT_STATE, live: false, authed: false, error: msg };
  }
}

Object.assign(window, { api, loadInitialState, readCookie, absolutizeMedia });
