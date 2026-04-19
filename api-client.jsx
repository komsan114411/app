// api-client.jsx — Frontend ↔ Backend bridge.

const API_BASE = (typeof window !== 'undefined' && window.API_BASE) || '';
const LIVE_POSSIBLE = typeof location !== 'undefined' && location.protocol !== 'file:';

let accessToken = null;

function readCsrf() {
  return readCookie('__Secure-XSRF-TOKEN') || readCookie('XSRF-TOKEN');
}
function readCookie(name) {
  const m = document.cookie.match(new RegExp('(?:^|; )' + name.replace(/[-.$?*|{}()\[\]\\\/\+^]/g, '\\$&') + '=([^;]*)'));
  return m ? decodeURIComponent(m[1]) : null;
}

let refreshInflight = null;

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
    if (typeof console !== 'undefined') console.error('[api]', method, path, 'network_error:', e?.message || e);
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
    try {
      const r = await fetch(API_BASE + '/api/auth/refresh', {
        method: 'POST', credentials: 'include', cache: 'no-store',
        headers: { 'X-CSRF-Token': readCsrf() || '' },
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
  async listApks()            { return request('/api/admin/uploads/apks', { auth: true }); },
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
  async forgetMe()               { return request('/api/privacy/forget', { method: 'POST' }); },

  // Push notifications
  async vapidKey()               { return request('/api/push/vapid-key'); },
  async subscribePush(sub)       { return request('/api/push/subscribe', { method: 'POST', body: sub }); },
  async broadcastPush(body)      { return request('/api/admin/push/broadcast', { method: 'POST', body, auth: true }); },

  // Escape hatch
  call: (path, opts) => request(path, opts),
};

async function loadInitialState() {
  if (!API_BASE && !LIVE_POSSIBLE) return { state: DEFAULT_STATE, live: false, authed: false };
  try {
    const cfg = await api.getConfig();
    if (typeof console !== 'undefined') console.info('[boot] /api/config OK', { appName: cfg && cfg.appName, capabilities: cfg && cfg.capabilities });
    const merged = SafeState.sanitize({ ...DEFAULT_STATE, ...cfg }) || DEFAULT_STATE;
    const authed = await tryRefresh();
    return { state: merged, live: true, authed };
  } catch (e) {
    const msg = (e && e.message) || String(e);
    try { window.__bootError = msg; } catch {}
    if (typeof console !== 'undefined') console.error('[boot] live mode failed — falling back to demo:', msg);
    return { state: DEFAULT_STATE, live: false, authed: false, error: msg };
  }
}

Object.assign(window, { api, loadInitialState, readCookie });
