// api-client.jsx — Frontend ↔ Backend bridge.
// - Access token: in-memory only (never localStorage — XSS-resistant)
// - Refresh token: httpOnly cookie (invisible to JS)
// - CSRF: double-submit cookie pattern. Server sets XSRF-TOKEN cookie;
//         we read it and echo in X-CSRF-Token header on mutations.
// - Falls back to DEFAULT_STATE if API unreachable.

// API_BASE:
//   - Explicit:  <script>window.API_BASE='https://api.example.com'</script>
//   - Implicit:  when we're on http(s) and none is set, use same origin ('').
//                fetch('/api/...') resolves relative to the current page.
//   - Demo:      only when neither is true (file:// direct), skip backend.
const API_BASE = (typeof window !== 'undefined' && window.API_BASE) || '';
const LIVE_POSSIBLE = typeof location !== 'undefined' && location.protocol !== 'file:';

let accessToken = null;

// Server sends __Secure-XSRF-TOKEN over HTTPS (production), XSRF-TOKEN over HTTP (local dev).
function readCsrf() {
  return readCookie('__Secure-XSRF-TOKEN') || readCookie('XSRF-TOKEN');
}

function readCookie(name) {
  const m = document.cookie.match(new RegExp('(?:^|; )' + name.replace(/[-.$?*|{}()\[\]\\\/\+^]/g, '\\$&') + '=([^;]*)'));
  return m ? decodeURIComponent(m[1]) : null;
}

// Single-flight refresh: if two calls get 401 at the same time they share
// one /refresh request instead of triggering reuse detection.
let refreshInflight = null;

async function request(path, { method = 'GET', body, auth = false, retry = true } = {}) {
  const headers = { 'Accept': 'application/json' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (auth && accessToken) headers.Authorization = 'Bearer ' + accessToken;

  if (method !== 'GET' && method !== 'HEAD') {
    const csrf = readCsrf();
    if (csrf) headers['X-CSRF-Token'] = csrf;
  }

  // Forward user's analytics-consent choice so server can honor it
  try {
    const consent = localStorage.getItem('analytics_consent');
    if (consent === 'denied') headers['X-Consent'] = '0';
  } catch {}

  let res;
  try {
    res = await fetch(API_BASE + path, {
      method, headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
      credentials: 'include',
      cache: 'no-store',
      redirect: 'error',
    });
  } catch (e) {
    throw new Error('request_failed');
  }

  if (res.status === 401 && auth && retry) {
    const ok = await tryRefresh();
    if (ok) return request(path, { method, body, auth, retry: false });
  }
  if (res.status === 429) throw new Error('rate_limited');
  if (res.status === 423) throw new Error('account_locked');
  if (res.status === 403) throw new Error('forbidden');
  if (!res.ok) {
    let code = 'request_failed';
    try {
      const err = await res.json();
      if (err && typeof err.error === 'string') code = err.error.slice(0, 60);
    } catch {}
    throw new Error(code);
  }
  if (res.status === 204) return null;
  return res.json();
}

async function tryRefresh() {
  if (refreshInflight) return refreshInflight;   // single-flight
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
  async trackClick(buttonId, label) {
    try { await request('/api/track', { method: 'POST', body: { buttonId, label } }); }
    catch {}
  },
  async login(email, password) {
    const data = await request('/api/auth/login', { method: 'POST', body: { email, password } });
    accessToken = data.accessToken;
    return data.user;
  },
  async logout() {
    try { await request('/api/auth/logout', { method: 'POST' }); } catch {}
    accessToken = null;
  },
  isAuthed() { return !!accessToken; },
  async getAdminConfig()         { return request('/api/admin/config', { auth: true }); },
  async patchConfig(patch) {
    return request('/api/admin/config', { method: 'PATCH', body: patch, auth: true });
  },
  async getAnalytics()           { return request('/api/admin/analytics', { auth: true }); },
  async forgetMe()               { return request('/api/privacy/forget', { method: 'POST' }); },
  async getAudit(opts = {}) {
    const q = new URLSearchParams({ limit: String(opts.limit || 50) });
    if (opts.cursor) q.set('cursor', opts.cursor);
    if (opts.action) q.set('action', opts.action);
    return request('/api/admin/audit?' + q.toString(), { auth: true });
  },
  async listUsers()              { return request('/api/admin/users', { auth: true }); },
  async createUser(body)         { return request('/api/admin/users', { method: 'POST', body, auth: true }); },
  async userAction(id, action)   { return request(`/api/admin/users/${id}/${action}`, { method: 'POST', auth: true }); },
  async changePassword(currentPassword, newPassword) {
    return request('/api/admin/me/password', { method: 'POST', body: { currentPassword, newPassword }, auth: true });
  },
  // raw escape hatch for custom calls
  call: (path, opts) => request(path, opts),
};

async function loadInitialState() {
  if (!API_BASE && !LIVE_POSSIBLE) {
    // file:// — can't reach a backend
    return { state: DEFAULT_STATE, live: false, authed: false };
  }
  try {
    const cfg = await api.getConfig();
    const merged = SafeState.sanitize({ ...DEFAULT_STATE, ...cfg }) || DEFAULT_STATE;
    const authed = await tryRefresh();
    return { state: merged, live: true, authed };
  } catch {
    // Backend unreachable → demo mode
    return { state: DEFAULT_STATE, live: false, authed: false };
  }
}

Object.assign(window, { api, loadInitialState, readCookie });
