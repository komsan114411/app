// admin-tabs.jsx — Security / Users / Audit tabs.

function fmtTime(d) {
  if (!d) return '—';
  try { return new Date(d).toLocaleString('th-TH', { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }); }
  catch { return String(d); }
}

function Pill({ children, tone = 'default' }) {
  const palette = {
    default: { bg: '#F3EFE7', color: '#3E3A34' },
    success: { bg: 'rgba(6,199,85,0.1)', color: '#058850' },
    danger:  { bg: 'rgba(180,70,58,0.1)', color: '#B4463A' },
    warn:    { bg: 'rgba(210,150,40,0.15)', color: '#7A5A10' },
  }[tone] || { bg: '#F3EFE7', color: '#3E3A34' };
  return <span style={{ display: 'inline-block', padding: '2px 8px', borderRadius: 999, fontSize: 10, fontWeight: 600, ...palette }}>{children}</span>;
}

// ─── Security tab: password + 2FA + sessions ────────────────
function SecurityTab({ onLogout, mustChange = false, onPasswordChanged, me, onMeRefresh }) {
  const [current, setCurrent] = React.useState('');
  const [next, setNext] = React.useState('');
  const [confirm, setConfirm] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [msg, setMsg] = React.useState(null);
  const [strength, setStrength] = React.useState(null);

  React.useEffect(() => {
    if (!next) { setStrength(null); return; }
    let s = 0;
    if (next.length >= 12) s++;
    if (/[a-z]/.test(next) && /[A-Z]/.test(next)) s++;
    if (/\d/.test(next)) s++;
    if (/[^\w]/.test(next)) s++;
    if (next.length >= 16) s++;
    setStrength(Math.min(4, s));
  }, [next]);

  const [pwSuggestions, setPwSuggestions] = React.useState([]);

  const submit = async (e) => {
    e.preventDefault();
    setMsg(null); setPwSuggestions([]);
    if (next !== confirm) { setMsg({ kind: 'error', text: 'รหัสใหม่ไม่ตรงกัน' }); return; }
    if (next.length < 12) { setMsg({ kind: 'error', text: 'ต้องยาวอย่างน้อย 12 ตัว' }); return; }
    setBusy(true);
    try {
      // First-time setup: server accepts blank currentPassword when the
      // account still has mustChangePassword=true. Skip the field entirely
      // so we don't have to force the user to retype their default.
      await api.changePassword(mustChange ? '' : current, next);
      if (mustChange) {
        setMsg({ kind: 'success', text: 'ตั้งรหัสใหม่สำเร็จ — กรุณาเข้าสู่ระบบอีกครั้ง' });
        setTimeout(() => onLogout?.(), 1400);
      } else {
        setMsg({ kind: 'success', text: 'เปลี่ยนรหัสผ่านสำเร็จ — ระบบจะออกจากระบบ' });
        setTimeout(() => onLogout?.(), 1600);
      }
      onPasswordChanged?.();
    } catch (err) {
      setMsg({ kind: 'error', text: friendlyPasswordError(err.message || 'fail') });
      if (err.responseBody && Array.isArray(err.responseBody.suggestions)) {
        setPwSuggestions(err.responseBody.suggestions);
      }
    } finally {
      setNext(''); setConfirm('');
      // Don't clear current — admin may want to retry with the same current pw
      if (msg?.kind !== 'success') { /* keep current */ } else { setCurrent(''); }
      setBusy(false);
    }
  };

  return (
    <div>
      <SectionHead
        title={mustChange ? 'ตั้งรหัสผ่านใหม่ (ครั้งแรก)' : 'ความปลอดภัย'}
        sub={mustChange
          ? 'คุณใช้รหัสตั้งต้น กรุณาเปลี่ยนก่อนเข้าใช้งานส่วนอื่น'
          : 'เปลี่ยนรหัสผ่าน · 2FA · ดูอุปกรณ์ที่เข้าสู่ระบบ'}/>
      {mustChange && (
        <div style={{
          margin: '0 0 16px', padding: '10px 14px', borderRadius: 10,
          background: 'rgba(210,150,40,0.1)', border: '1px solid rgba(210,150,40,0.3)',
          color: '#7A5A10', fontSize: 12, display: 'flex', alignItems: 'center', gap: 8,
        }}>
          <Icon name="settings" size={14} stroke={2}/>
          บัญชีใหม่ต้องตั้งรหัสใหม่ก่อน tab อื่นจะเข้าถึงได้
        </div>
      )}
      <div style={{ display: 'grid', gridTemplateColumns: mustChange ? '1fr' : 'minmax(0,1.1fr) minmax(0,1fr)', gap: 16, marginBottom: 14 }}>
        <Card>
          <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 10 }}>เปลี่ยนรหัสผ่าน</div>
          <form onSubmit={submit} autoComplete="off">
            {!mustChange && (
              <Field label="รหัสผ่านปัจจุบัน">
                <input type="password" value={current} onChange={e => setCurrent(e.target.value.slice(0, 200))}
                  required autoComplete="current-password" maxLength={200} style={pwInput}/>
              </Field>
            )}
            <Field label="รหัสผ่านใหม่ (อย่างน้อย 12 ตัว, ผสมตัวพิมพ์ใหญ่/เล็ก/เลข/สัญลักษณ์)">
              <input type="password" value={next} onChange={e => setNext(e.target.value.slice(0, 200))}
                required autoComplete="new-password" minLength={12} maxLength={200} style={pwInput}/>
              {strength !== null && <StrengthBar level={strength}/>}
            </Field>
            <Field label="ยืนยันรหัสผ่านใหม่">
              <input type="password" value={confirm} onChange={e => setConfirm(e.target.value.slice(0, 200))}
                required autoComplete="new-password" minLength={12} maxLength={200} style={pwInput}/>
            </Field>
            {msg && (
              <div style={{ margin: '6px 0 12px', padding: '10px 12px', borderRadius: 9,
                background: msg.kind === 'success' ? 'rgba(6,199,85,0.08)' : 'rgba(180,70,58,0.08)',
                color: msg.kind === 'success' ? '#058850' : '#B4463A', fontSize: 12 }}>
                {msg.text}
                {pwSuggestions.length > 0 && (
                  <ul style={{ margin: '6px 0 0 16px', padding: 0 }}>
                    {pwSuggestions.map((s, i) => <li key={i} style={{ fontSize: 11, opacity: 0.85 }}>{s}</li>)}
                  </ul>
                )}
              </div>
            )}
            <button type="submit" disabled={busy} style={{
              width: '100%', padding: '10px', borderRadius: 9, border: 'none',
              background: busy ? '#8F877C' : '#1F1B17', color: '#fff',
              fontFamily: 'inherit', fontSize: 13, fontWeight: 600,
              cursor: busy ? 'not-allowed' : 'pointer',
            }}>{busy ? 'กำลังบันทึก…' : 'เปลี่ยนรหัสผ่าน'}</button>
          </form>
        </Card>
        {!mustChange && (
          <Card style={{ background: '#F3EFE7' }}>
            <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 10 }}>นโยบายรหัสผ่าน</div>
            <ul style={{ fontSize: 11, color: '#3E3A34', margin: 0, paddingLeft: 16, lineHeight: 1.8 }}>
              <li>ยาว 12–200 ตัวอักษร · zxcvbn score ≥ 3</li>
              <li>ตรวจกับ HaveIBeenPwned — รหัสเคยรั่วจะถูกปฏิเสธ</li>
              <li>เก็บเป็น argon2id hash เท่านั้น</li>
              <li>เปลี่ยนรหัส = logout ทุกเซสชัน</li>
            </ul>
          </Card>
        )}
      </div>

      {!mustChange && typeof TwoFactorSetup === 'function' && (
        <div style={{ marginBottom: 14 }}>
          <TwoFactorSetup me={me} onChanged={onMeRefresh}/>
        </div>
      )}

      {!mustChange && me?.role === 'admin' && typeof PushBroadcastCard === 'function' && (
        <PushBroadcastCard/>
      )}

      {!mustChange && typeof SessionList === 'function' && (
        <SessionList/>
      )}
    </div>
  );
}

const pwInput = {
  width: '100%', padding: '9px 12px', borderRadius: 9,
  border: '1px solid rgba(0,0,0,0.12)', background: '#fff',
  fontFamily: 'inherit', fontSize: 13, color: '#1F1B17',
  boxSizing: 'border-box', outline: 'none',
};

function StrengthBar({ level }) {
  const colors = ['#B4463A', '#D19F40', '#D19F40', '#058850', '#058850'];
  const labels = ['อ่อนมาก', 'อ่อน', 'พอใช้', 'ดี', 'ดีมาก'];
  return (
    <div style={{ marginTop: 6 }}>
      <div style={{ height: 4, background: 'rgba(0,0,0,0.08)', borderRadius: 2, overflow: 'hidden' }}>
        <div style={{ width: `${(level + 1) * 20}%`, height: '100%', background: colors[level], transition: 'width 220ms ease' }}/>
      </div>
      <div style={{ fontSize: 10, color: colors[level], marginTop: 3 }}>{labels[level]}</div>
    </div>
  );
}

function friendlyPasswordError(code) {
  switch (code) {
    case 'invalid_credentials': return 'รหัสผ่านปัจจุบันไม่ถูกต้อง';
    case 'weak':                return 'รหัสผ่านไม่แข็งแรงพอ — เพิ่มความหลากหลาย';
    case 'too_short':           return 'รหัสผ่านสั้นเกินไป';
    case 'too_long':            return 'รหัสผ่านยาวเกินไป';
    case 'bad_chars':           return 'มีอักขระควบคุมไม่ถูกต้อง';
    case 'breached':            return 'รหัสนี้อยู่ในฐานรั่วไหล — เลือกรหัสอื่น';
    case 'hibp_unavailable':    return 'ตรวจสอบฐานข้อมูลรหัสรั่วไหลไม่ได้ ลองใหม่ภายหลัง';
    case 'rate_limited':        return 'พยายามบ่อยเกินไป รอสักครู่';
    default:                    return 'ไม่สามารถเปลี่ยนรหัสผ่านได้';
  }
}

// ─── Users tab: list + search + actions + add ───────────────
// The Users tab uses NATIVE browser dialogs for all destructive actions.
// Previous iterations routed through toast.confirm, but on some clients
// that modal sat behind other layers / off-screen and the click seemed
// to do nothing. window.confirm and window.alert are guaranteed visible
// by the browser and cannot be hidden by CSS, which is what we want for
// actions that revoke sessions or change roles.
function nativeConfirm(message) {
  try {
    if (typeof window !== 'undefined' && typeof window.confirm === 'function') {
      return !!window.confirm(message);
    }
  } catch {}
  return true;
}
function nativeAlert(message) {
  try {
    if (typeof window !== 'undefined' && typeof window.alert === 'function') {
      window.alert(message);
    }
  } catch {}
}

// Inline two-click confirmation. Some browsers / Capacitor WebViews
// silently suppress window.confirm — so we never depend on it. First
// click arms the button (turns label into "ยืนยันอีกครั้ง?"); second
// click within TTL actually fires. After TTL with no second click,
// button resets. Works everywhere, can't be hidden or blocked.
function useArmedConfirm(ttlMs = 3000) {
  const [armed, setArmed] = React.useState('');   // which key is armed
  const timer = React.useRef(null);
  const arm = (key) => {
    clearTimeout(timer.current);
    setArmed(key);
    timer.current = setTimeout(() => setArmed(''), ttlMs);
  };
  const disarm = () => {
    clearTimeout(timer.current);
    setArmed('');
  };
  // Returns true if caller should PROCEED (this is the second click);
  // false if caller should WAIT (just armed on this first click).
  const confirm = (key) => {
    if (armed === key) { disarm(); return true; }
    arm(key); return false;
  };
  React.useEffect(() => () => clearTimeout(timer.current), []);
  return { armed, confirm, disarm };
}

function UsersTab({ currentUserId }) {
  const [rows, setRows] = React.useState([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState(null);
  const [showAdd, setShowAdd] = React.useState(false);
  const [q, setQ] = React.useState('');
  const [role, setRole] = React.useState('');
  const [page, setPage] = React.useState(1);
  const [totalPages, setTotalPages] = React.useState(1);
  // Which row is currently processing a click — disables the row's
  // buttons and shows a spinner so the admin knows something happened.
  const [busyId, setBusyId] = React.useState('');
  // React-rendered result modal for reveal flows (temp password, etc).
  // Guaranteed visible even on WebView / Capacitor where window.prompt
  // may be blocked by the host.
  const [reveal, setReveal] = React.useState(null);  // { title, body, copyable }
  // Inline two-click arming — replaces window.confirm which some WebViews suppress.
  const armed = useArmedConfirm();
  // Always-visible activity line at the top of the tab. Any click, any
  // success, any failure lands here so the admin has proof the button
  // registered — no need to open DevTools.
  const [activity, setActivity] = React.useState('');
  const logActivity = (kind, msg) => {
    const ts = new Date().toLocaleTimeString('th-TH', { hour12: false });
    setActivity(`[${ts}] ${kind.toUpperCase()} · ${msg}`);
    if (typeof console !== 'undefined') console.info('[users-tab]', kind, msg);
  };

  const load = React.useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const data = await api.listUsers({ q, role, page, limit: 30 });
      setRows(Array.isArray(data.rows) ? data.rows : []);
      setTotalPages(data.pages || 1);
    } catch (e) { setError(e.message || 'load_failed'); }
    finally { setLoading(false); }
  }, [q, role, page]);

  React.useEffect(() => { load(); }, [load]);

  // Core API call — assumes the caller already got confirmation.
  const doAct = async (id, action) => {
    setBusyId(id);
    logActivity('request', `POST /api/admin/users/${id}/${action}`);
    try {
      await api.userAction(id, action);
      const msg = action === 'revoke-sessions' ? 'เตะออกทุกเซสชันแล้ว'
               : action === 'disable'         ? 'ปิดบัญชีแล้ว'
               : action === 'enable'          ? 'เปิดบัญชีแล้ว'
               : 'ดำเนินการสำเร็จ';
      logActivity('ok', msg);
      if (typeof toast !== 'undefined') toast.success(msg);
      await load();
    } catch (e) {
      logActivity('fail', `${action} · ${e.message || '?'}`);
      setReveal({
        title: 'ดำเนินการไม่สำเร็จ',
        body: friendlyUserActionError(e.message) + '\n(' + (e.message || '?') + ')',
        tone: 'error',
      });
    } finally { setBusyId(''); }
  };

  // Click handler — uses inline arm-then-fire pattern (no native confirm).
  const act = (id, action) => {
    logActivity('click', `${action} on ${id}`);
    // Reversible actions fire on first click — no confirm needed
    if (action === 'enable') { doAct(id, action); return; }
    // Destructive actions: first click arms, second click within 3s fires
    const key = `${action}:${id}`;
    if (armed.confirm(key)) { doAct(id, action); }
    else { logActivity('arm', `กดอีกครั้งเพื่อยืนยัน ${action}`); }
  };

  const doChangeRole = async (id, nextRole) => {
    setBusyId(id);
    logActivity('request', `PATCH /api/admin/users/${id}/role → ${nextRole}`);
    try {
      await api.changeRole(id, nextRole);
      logActivity('ok', `role now ${nextRole}`);
      if (typeof toast !== 'undefined') toast.success('เปลี่ยนสิทธิ์เป็น ' + nextRole + ' แล้ว');
      await load();
    } catch (e) {
      logActivity('fail', `changeRole · ${e.message || '?'}`);
      setReveal({
        title: 'เปลี่ยนสิทธิ์ไม่สำเร็จ',
        body: friendlyUserActionError(e.message) + '\n(' + (e.message || '?') + ')',
        tone: 'error',
      });
    } finally { setBusyId(''); }
  };

  const changeRole = (id, nextRole) => {
    logActivity('click', `change role of ${id} → ${nextRole}`);
    const key = `role:${id}:${nextRole}`;
    if (armed.confirm(key)) { doChangeRole(id, nextRole); }
    else { logActivity('arm', `กดอีกครั้งเพื่อยืนยันเปลี่ยนเป็น ${nextRole}`); }
  };

  const doResetPw = async (id, loginId) => {
    setBusyId(id);
    logActivity('request', `POST /api/admin/users/${id}/reset-password`);
    try {
      const r = await api.resetUserPassword(id);
      const tempPw = (r && r.tempPassword) || '';
      let copied = false;
      try {
        if (navigator && navigator.clipboard && navigator.clipboard.writeText) {
          await navigator.clipboard.writeText(tempPw);
          copied = true;
        }
      } catch {}
      logActivity('ok', `reset ${loginId}`);
      setReveal({
        title: `รหัสผ่านชั่วคราวของ ${loginId}`,
        body: tempPw,
        copyable: true,
        note: copied
          ? 'คัดลอกเข้าคลิปบอร์ดให้แล้ว · ไม่แสดงซ้ำอีกหลังปิดหน้านี้'
          : 'กดปุ่ม "คัดลอก" เพื่อนำไปส่งให้ผู้ใช้ · ไม่แสดงซ้ำอีกหลังปิดหน้านี้',
      });
      await load();
    } catch (e) {
      logActivity('fail', `resetPw · ${e.message || '?'}`);
      setReveal({
        title: 'รีเซ็ตรหัสไม่สำเร็จ',
        body: friendlyUserActionError(e.message) + '\n(' + (e.message || '?') + ')',
        tone: 'error',
      });
    } finally { setBusyId(''); }
  };

  const resetPw = (id, loginId) => {
    logActivity('click', `reset password of ${loginId}`);
    const key = `reset:${id}`;
    if (armed.confirm(key)) { doResetPw(id, loginId); }
    else { logActivity('arm', `กดอีกครั้งเพื่อยืนยันรีเซ็ตรหัสของ ${loginId}`); }
  };

  return (
    <div>
      <SectionHead title="ผู้ดูแลระบบ" sub={`${rows.length} บัญชี · เฉพาะ role admin เห็นหน้านี้`}
        right={
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={() => setShowAdd(true)} style={{
              display: 'flex', alignItems: 'center', gap: 6, padding: '7px 14px',
              borderRadius: 8, border: 'none', background: '#1F1B17', color: '#fff',
              fontFamily: 'inherit', fontSize: 12, fontWeight: 600, cursor: 'pointer',
            }}><Icon name="plus" size={13} stroke={2.2}/> เพิ่มแอดมิน</button>
          </div>
        }/>
      {showAdd && <AddAdminDialog onClose={() => setShowAdd(false)} onCreated={() => { setShowAdd(false); load(); }}/>}

      {/* Activity bar: proves the button registered a click without requiring DevTools. */}
      {activity && (
        <div style={{
          marginBottom: 10, padding: '6px 10px', borderRadius: 8,
          background: activity.includes('FAIL') ? 'rgba(180,70,58,0.08)'
                    : activity.includes('OK') ? 'rgba(6,199,85,0.08)'
                    : '#F3EFE7',
          color: activity.includes('FAIL') ? '#B4463A'
                : activity.includes('OK') ? '#058850'
                : '#3E3A34',
          fontSize: 11, fontFamily: 'ui-monospace, monospace',
          display: 'flex', alignItems: 'center', gap: 8,
        }}>
          <span style={{ flex: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{activity}</span>
          <button onClick={async () => {
            logActivity('ping', 'GET /api/admin/me ...');
            try {
              const me = await api.me();
              logActivity('ok', `ping: admin=${me.loginId} role=${me.role}`);
            } catch (e) {
              logActivity('fail', `ping · ${e.message || '?'}`);
            }
          }} style={{
            padding: '3px 10px', borderRadius: 6, border: '1px solid rgba(0,0,0,0.12)',
            background: '#fff', fontFamily: 'inherit', fontSize: 10, cursor: 'pointer',
          }}>🔄 Ping API</button>
          <button onClick={() => setActivity('')} style={{
            padding: '3px 8px', borderRadius: 6, border: 'none',
            background: 'transparent', fontFamily: 'inherit', fontSize: 10, cursor: 'pointer', opacity: 0.6,
          }}>✕</button>
        </div>
      )}

      <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
        <input type="text" value={q} placeholder="ค้นหา login ID / ชื่อ..." onChange={e => { setQ(e.target.value.slice(0, 64)); setPage(1); }}
          style={{ flex: 1, minWidth: 160, padding: '7px 12px', borderRadius: 8, border: '1px solid rgba(0,0,0,0.12)', fontFamily: 'inherit', fontSize: 12 }}/>
        <select value={role} onChange={e => { setRole(e.target.value); setPage(1); }} style={{
          padding: '7px 10px', borderRadius: 8, border: '1px solid rgba(0,0,0,0.12)', background: '#fff', fontFamily: 'inherit', fontSize: 12,
        }}>
          <option value="">ทุกสิทธิ์</option>
          <option value="admin">Admin</option>
          <option value="editor">Editor</option>
        </select>
        <button onClick={load} style={refreshBtn}><Icon name="sparkle" size={13} stroke={1.8}/> รีเฟรช</button>
      </div>

      {loading && <div style={dim}>กำลังโหลด…</div>}
      {error && <div style={errBox}>โหลดไม่สำเร็จ ({error})</div>}
      {!loading && !error && rows.length === 0 && <div style={dim}>ไม่พบบัญชี</div>}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {rows.map(u => {
          const isSelf = String(u._id) === String(currentUserId);
          const disabled = !!u.disabledAt;
          const rowBusy = busyId === String(u._id);
          return (
            <Card key={u._id} style={{ padding: 14, opacity: rowBusy ? 0.6 : 1, transition: 'opacity 160ms' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                <div style={{
                  width: 40, height: 40, borderRadius: 11, background: '#1F1B17', color: '#fff',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: 15,
                }}>{(u.loginId || '?').slice(0,1).toUpperCase()}</div>
                <div style={{ flex: 1, minWidth: 200 }}>
                  <div style={{ fontSize: 14, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                    {u.loginId}
                    {u.displayName && <span style={{ fontWeight: 400, color: '#6B6458' }}>· {u.displayName}</span>}
                    {isSelf && <Pill>คุณ</Pill>}
                    <Pill tone={u.role === 'admin' ? 'default' : 'warn'}>{u.role}</Pill>
                    {disabled ? <Pill tone="danger">ปิดใช้งาน</Pill> : <Pill tone="success">ใช้งาน</Pill>}
                    {u.totpEnabled && <Pill tone="success">2FA</Pill>}
                    {u.mustChangePassword && <Pill tone="warn">ต้องตั้งรหัสใหม่</Pill>}
                    {rowBusy && <Pill tone="warn">กำลังทำงาน…</Pill>}
                  </div>
                  <div style={{ fontSize: 11, color: '#8F877C', marginTop: 3 }}>
                    เข้าสู่ระบบล่าสุด: {fmtTime(u.lastLoginAt)}
                    {u.lastLoginIp && <span> · จาก {u.lastLoginIp}</span>}
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                  {!isSelf && (() => {
                    const nextRole = u.role === 'admin' ? 'editor' : 'admin';
                    const isArmed = armed.armed === `role:${u._id}:${nextRole}`;
                    return (
                      <button onClick={() => changeRole(u._id, nextRole)} disabled={rowBusy}
                        style={{ ...pillBtn,
                          background: isArmed ? '#1F1B17' : '#fff',
                          color: isArmed ? '#fff' : '#1F1B17',
                          borderColor: isArmed ? '#1F1B17' : 'rgba(0,0,0,0.12)',
                          cursor: rowBusy ? 'wait' : 'pointer' }}>
                        {isArmed ? `✓ ยืนยัน → ${nextRole}?` : (u.role === 'admin' ? '→ editor' : '→ admin')}
                      </button>
                    );
                  })()}
                  {(() => {
                    const isArmed = armed.armed === `reset:${u._id}`;
                    return (
                      <button onClick={() => resetPw(u._id, u.loginId)} disabled={rowBusy}
                        title={isSelf ? 'รีเซ็ตรหัสตัวเอง: แนะนำใช้แท็บ "ความปลอดภัย" แทน' : 'สร้างรหัสชั่วคราว'}
                        style={{ ...pillBtn,
                          background: isArmed ? '#7A5A10' : '#fff',
                          color: isArmed ? '#fff' : '#7A5A10',
                          borderColor: isArmed ? '#7A5A10' : 'rgba(0,0,0,0.12)',
                          cursor: rowBusy ? 'wait' : 'pointer' }}>
                        {isArmed ? '✓ ยืนยันรีเซ็ต?' : 'รีเซ็ตรหัส'}
                      </button>
                    );
                  })()}
                  {disabled
                    ? <button onClick={() => act(u._id, 'enable')} disabled={rowBusy}
                        style={{ ...pillBtn, color: '#058850', cursor: rowBusy ? 'wait' : 'pointer' }}>เปิด</button>
                    : (() => {
                        const isArmed = armed.armed === `disable:${u._id}`;
                        return (
                          <button onClick={() => act(u._id, 'disable')} disabled={isSelf || rowBusy}
                            title={isSelf ? 'ปิดบัญชีตัวเองไม่ได้' : 'ปิดบัญชี + เตะออกทุกเซสชัน'}
                            style={{ ...pillBtn,
                              background: isArmed ? '#B4463A' : '#fff',
                              color: isArmed ? '#fff' : '#B4463A',
                              borderColor: isArmed ? '#B4463A' : 'rgba(0,0,0,0.12)',
                              opacity: (isSelf || rowBusy) ? 0.3 : 1,
                              cursor: (isSelf || rowBusy) ? 'not-allowed' : 'pointer' }}>
                            {isArmed ? '✓ ยืนยันปิด?' : 'ปิด'}
                          </button>
                        );
                      })()}
                  {(() => {
                    const isArmed = armed.armed === `revoke-sessions:${u._id}`;
                    return (
                      <button onClick={() => act(u._id, 'revoke-sessions')} disabled={rowBusy}
                        title="บังคับ logout อุปกรณ์ทั้งหมดของผู้ใช้รายนี้"
                        style={{ ...pillBtn,
                          background: isArmed ? '#7A5A10' : '#fff',
                          color: isArmed ? '#fff' : '#7A5A10',
                          borderColor: isArmed ? '#7A5A10' : 'rgba(0,0,0,0.12)',
                          cursor: rowBusy ? 'wait' : 'pointer' }}>
                        {isArmed ? '✓ ยืนยันเตะออก?' : 'เตะออก'}
                      </button>
                    );
                  })()}
                </div>
              </div>
            </Card>
          );
        })}
      </div>
      {totalPages > 1 && (
        <div style={{ display: 'flex', justifyContent: 'center', gap: 8, marginTop: 12 }}>
          <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1} style={pillBtn}>ก่อนหน้า</button>
          <div style={{ padding: '6px 12px', fontSize: 12, color: '#6B6458' }}>{page} / {totalPages}</div>
          <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page === totalPages} style={pillBtn}>ถัดไป</button>
        </div>
      )}

      {reveal && <RevealModal {...reveal} onClose={() => setReveal(null)}/>}
    </div>
  );
}

// Always-visible modal for revealing secrets / showing an action result.
// Works in Capacitor WebView where window.prompt is blocked.
function RevealModal({ title, body, tone = 'default', note, copyable = false, onClose }) {
  const copy = async () => {
    try {
      if (navigator?.clipboard?.writeText) { await navigator.clipboard.writeText(body); toast.success('คัดลอกแล้ว'); return; }
    } catch {}
    // Fallback
    try {
      const ta = document.createElement('textarea');
      ta.value = body; ta.style.position = 'fixed'; ta.style.top = '-9999px';
      document.body.appendChild(ta); ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
      toast.success('คัดลอกแล้ว');
    } catch { toast.error('คัดลอกไม่สำเร็จ — เลือกข้อความแล้ว Ctrl+C เอา'); }
  };
  return (
    <div onClick={e => e.target === e.currentTarget && onClose?.()} style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 1800,
      display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20,
      fontFamily: '"IBM Plex Sans Thai", system-ui',
    }}>
      <div style={{
        width: 420, maxWidth: '100%', background: '#fff', borderRadius: 14, padding: 22,
        boxShadow: '0 40px 80px -20px rgba(0,0,0,0.5)',
        animation: 'toastIn 220ms cubic-bezier(0.2,0.8,0.3,1) both',
      }}>
        <div style={{
          fontSize: 15, fontWeight: 700, marginBottom: 10,
          color: tone === 'error' ? '#B4463A' : '#1F1B17',
        }}>{title}</div>
        <div style={{
          background: tone === 'error' ? 'rgba(180,70,58,0.06)' : '#F3EFE7',
          border: '1px solid rgba(0,0,0,0.06)', borderRadius: 10,
          padding: '12px 14px', marginBottom: 12,
          fontFamily: copyable ? 'ui-monospace, monospace' : 'inherit',
          fontSize: copyable ? 16 : 13, fontWeight: copyable ? 600 : 400,
          letterSpacing: copyable ? 1 : 0,
          wordBreak: 'break-all', userSelect: 'all',
          whiteSpace: 'pre-wrap',
        }}>{body}</div>
        {note && <div style={{ fontSize: 11, color: '#6B6458', lineHeight: 1.5, marginBottom: 14 }}>{note}</div>}
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          {copyable && (
            <button onClick={copy} style={{
              padding: '9px 16px', borderRadius: 8, border: '1px solid rgba(0,0,0,0.12)',
              background: '#fff', fontFamily: 'inherit', fontSize: 13, cursor: 'pointer',
            }}>📋 คัดลอก</button>
          )}
          <button onClick={onClose} style={{
            padding: '9px 20px', borderRadius: 8, border: 'none',
            background: '#1F1B17', color: '#fff',
            fontFamily: 'inherit', fontSize: 13, fontWeight: 600, cursor: 'pointer',
          }}>ปิด</button>
        </div>
      </div>
    </div>
  );
}

function confirmText(action) {
  return action === 'disable' ? 'ปิดบัญชีนี้? (เตะออกทุกเซสชัน)' :
         action === 'enable'  ? 'เปิดบัญชีนี้?' :
         action === 'revoke-sessions' ? 'บังคับ logout ทุกเซสชันของบัญชีนี้?' : 'ยืนยัน?';
}

function AddAdminDialog({ onClose, onCreated }) {
  const [loginId, setLoginId] = React.useState('');
  const [displayName, setDisplayName] = React.useState('');
  const [email, setEmail] = React.useState('');
  const [password, setPassword] = React.useState('');
  const [role, setRole] = React.useState('editor');
  const [busy, setBusy] = React.useState(false);
  const [err, setErr] = React.useState(null);
  const [suggestions, setSuggestions] = React.useState([]);
  const [showPassword, setShowPassword] = React.useState(false);
  // When admin generates a random pw, we offer a copy/reveal surface.
  const [generated, setGenerated] = React.useState('');

  const generatePassword = () => {
    // 20 chars from a 72-char alphabet — ~123 bits of entropy, definitely
    // passes zxcvbn ≥ 3 and is unlikely to be in HIBP.
    const alph = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789!@#$%^&*?';
    const bytes = new Uint8Array(20);
    (crypto || window.crypto).getRandomValues(bytes);
    let out = '';
    for (const b of bytes) out += alph[b % alph.length];
    setPassword(out);
    setGenerated(out);
    setShowPassword(true);
    setErr(null); setSuggestions([]);
  };

  const submit = async (e) => {
    e.preventDefault();
    setErr(null); setSuggestions([]);
    if (!/^[a-zA-Z0-9._@-]{3,64}$/.test(loginId)) { setErr('Login ID 3-64 ตัว a-z 0-9 . _ - @'); return; }
    if (password.length < 12) { setErr('รหัสอย่างน้อย 12 ตัว · ลองกด "สร้างรหัสแข็งแรง"'); return; }
    setBusy(true);
    try {
      await api.createUser({ loginId: loginId.toLowerCase(), password, role, email: email || '', displayName: displayName || '' });
      toast.success('สร้างบัญชี ' + loginId + ' แล้ว');
      onCreated?.();
    } catch (e) {
      // The backend returns { error, suggestions[] } for weak_password —
      // surface those to the admin so they know what to change.
      setErr(friendlyCreateError(e.message));
      if (e.responseBody && Array.isArray(e.responseBody.suggestions)) {
        setSuggestions(e.responseBody.suggestions);
      }
    }
    finally { setBusy(false); }
  };

  return (
    <div onClick={e => e.target === e.currentTarget && onClose?.()} style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 900,
      display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20,
    }}>
      <form onSubmit={submit} autoComplete="off" style={{
        width: 420, maxWidth: '100%', background: '#fff', borderRadius: 14, padding: 22,
        boxShadow: '0 40px 80px -20px rgba(0,0,0,0.4)',
      }}>
        <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 6 }}>เพิ่มผู้ดูแลใหม่</div>
        <div style={{ fontSize: 11, color: '#6B6458', marginBottom: 18 }}>
          ผู้ใช้ใหม่ล็อกอินด้วย Login ID + รหัสที่ตั้งได้ทันที
        </div>
        <Field label="Login ID (a-z 0-9 . _ - @)">
          <input type="text" value={loginId} onChange={e => setLoginId(e.target.value.slice(0, 64))}
            required autoCapitalize="off" spellCheck={false} placeholder="editor1" style={pwInput}/>
        </Field>
        <Field label="ชื่อเรียก (ไม่บังคับ)">
          <input type="text" value={displayName} onChange={e => setDisplayName(e.target.value.slice(0, 80))}
            placeholder="สมชาย" style={pwInput}/>
        </Field>
        <Field label="อีเมล (ไม่บังคับ — ใช้สำหรับรีเซ็ตรหัสทางอีเมล)">
          <input type="email" value={email} onChange={e => setEmail(e.target.value.slice(0, 254))}
            placeholder="editor1@example.com" style={pwInput}/>
        </Field>
        <Field label="รหัสผ่าน (อย่างน้อย 12 ตัว · ต้องผ่าน zxcvbn + HIBP)">
          <div style={{ display: 'flex', gap: 6 }}>
            <input type={showPassword ? 'text' : 'password'}
              value={password}
              onChange={e => setPassword(e.target.value.slice(0, 200))}
              required minLength={12} maxLength={200}
              style={{ ...pwInput, flex: 1, fontFamily: showPassword ? 'ui-monospace, monospace' : 'inherit' }}/>
            <button type="button" onClick={() => setShowPassword(s => !s)}
              title={showPassword ? 'ซ่อน' : 'แสดง'} style={{
              padding: '0 12px', borderRadius: 9, border: '1px solid rgba(0,0,0,0.12)',
              background: '#fff', cursor: 'pointer', fontSize: 16,
            }}>{showPassword ? '🙈' : '👁'}</button>
            <button type="button" onClick={generatePassword}
              title="สร้างรหัสสุ่ม 20 ตัวที่ผ่านนโยบายแน่นอน" style={{
              padding: '0 12px', borderRadius: 9, border: '1px solid rgba(0,0,0,0.12)',
              background: '#F3EFE7', cursor: 'pointer', fontSize: 13, whiteSpace: 'nowrap',
            }}>🎲 สร้าง</button>
          </div>
          {generated && (
            <div style={{
              marginTop: 6, padding: '8px 10px', borderRadius: 7,
              background: 'rgba(6,199,85,0.08)', color: '#058850', fontSize: 11,
            }}>
              ✓ สร้างรหัสสุ่ม 20 ตัว · จดหรือคัดลอกก่อนกด "สร้างบัญชี" · ผู้ใช้จะถูกบังคับเปลี่ยนตอน login ครั้งแรก (ถ้าต้องการ)
            </div>
          )}
        </Field>
        <Field label="สิทธิ์">
          <select value={role} onChange={e => setRole(e.target.value)} style={pwInput}>
            <option value="editor">Editor — แก้คอนเทนต์</option>
            <option value="admin">Admin — แก้คอนเทนต์ + จัดการผู้ใช้ + ดู audit</option>
          </select>
        </Field>
        {err && (
          <div style={{ padding: '8px 12px', borderRadius: 8, background: 'rgba(180,70,58,0.08)', color: '#B4463A', fontSize: 12, marginBottom: 8 }}>
            {err}
            {suggestions.length > 0 && (
              <ul style={{ margin: '6px 0 0 16px', padding: 0 }}>
                {suggestions.map((s, i) => <li key={i} style={{ fontSize: 11, opacity: 0.85 }}>{s}</li>)}
              </ul>
            )}
          </div>
        )}
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 8 }}>
          <button type="button" onClick={onClose} disabled={busy} style={{
            padding: '9px 16px', borderRadius: 8, border: '1px solid rgba(0,0,0,0.12)',
            background: '#fff', fontFamily: 'inherit', fontSize: 13, cursor: 'pointer',
          }}>ยกเลิก</button>
          <button type="submit" disabled={busy} style={{
            padding: '9px 20px', borderRadius: 8, border: 'none',
            background: busy ? '#8F877C' : '#1F1B17', color: '#fff',
            fontFamily: 'inherit', fontSize: 13, fontWeight: 600,
            cursor: busy ? 'not-allowed' : 'pointer',
          }}>{busy ? 'กำลังสร้าง…' : 'สร้างบัญชี'}</button>
        </div>
      </form>
    </div>
  );
}

function friendlyUserActionError(code) {
  switch (code) {
    case 'self_disable_forbidden':    return 'ปิดบัญชีตนเองไม่ได้';
    case 'self_demote_forbidden':     return 'ลดสิทธิ์ตนเองไม่ได้';
    case 'last_admin':                return 'ต้องมี admin อย่างน้อย 1 คน';
    case 'user_disabled':             return 'บัญชีถูกปิดใช้งาน — เปิดก่อน';
    case 'already_disabled':          return 'บัญชีถูกปิดอยู่แล้ว';
    case 'concurrent_modification':   return 'มีคนแก้พร้อมกัน — ลองรีเฟรช';
    case 'forbidden':                 return 'ไม่มีสิทธิ์ (ต้องเป็น role admin)';
    case 'not_found':                 return 'ไม่พบบัญชี';
    case 'invalid_id':                return 'ID ไม่ถูกต้อง';
    case 'invalid_input':             return 'ข้อมูลไม่ถูกต้อง';
    case 'unauthorized':              return 'ต้อง login ใหม่';
    case 'rate_limited':              return 'ดำเนินการเร็วเกินไป รอสักครู่';
    case 'csrf_missing':
    case 'csrf_mismatch':             return 'CSRF token หมดอายุ — รีโหลดหน้า';
    case 'request_failed':            return 'เชื่อมต่อเซิร์ฟเวอร์ไม่ได้';
    default:                          return 'ดำเนินการไม่สำเร็จ';
  }
}

// ─── Download Links tab: APK / App Store URLs ─────────────────
// Lets the admin configure where the "Install on mobile" buttons on the
// user page should send visitors. The Android slot can be auto-filled
// with the project's rolling GitHub Release URL — the android.yml CI
// workflow publishes `app-debug.apk` to a "latest-apk" release on every
// push to main, so this URL stays fresh automatically.
function DownloadLinksEditor({ state, setState }) {
  const dl = state.downloadLinks || {};
  const patch = (p) => setState(s => ({
    ...s,
    downloadLinks: { ...(s.downloadLinks || {}), ...p },
  }));

  const [repo, setRepo] = React.useState(() => {
    try { return localStorage.getItem('githubRepo') || ''; } catch { return ''; }
  });
  const rememberRepo = (r) => { try { localStorage.setItem('githubRepo', r); } catch {} };

  const autofillAndroid = () => {
    const trimmed = (repo || '').trim().replace(/^https?:\/\/(www\.)?github\.com\//i, '').replace(/\/+$/, '');
    const m = trimmed.match(/^([a-z0-9-]+)\/([a-z0-9._-]+)$/i);
    if (!m) { toast.error('ใส่รูปแบบ owner/repo เช่น komsan114411/app'); return; }
    const [, owner, name] = m;
    rememberRepo(trimmed);
    const url = `https://github.com/${owner}/${name}/releases/download/latest-apk/app-debug.apk`;
    patch({ android: url, androidLabel: dl.androidLabel || 'ดาวน์โหลด APK' });
    toast.success('ใส่ลิงก์ล่าสุดของ GitHub Release แล้ว');
  };

  return (
    <div>
      <SectionHead
        title="ลิงก์ดาวน์โหลดแอป (มือถือ)"
        sub="วาง URL ไปยัง APK / Play Store / App Store · หน้าผู้ใช้จะเห็นปุ่มดาวน์โหลดอัตโนมัติ"
      />

      <Card style={{ marginBottom: 14, background: '#F3EFE7' }}>
        <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 6 }}>⚡ Auto-fill จาก GitHub</div>
        <div style={{ fontSize: 11, color: '#6B6458', marginBottom: 10, lineHeight: 1.5 }}>
          CI workflow <code>.github/workflows/android.yml</code> build APK อัตโนมัติทุก push ไป main แล้วเผยแพร่เป็น <code>latest-apk</code> release.
          ใส่ <code>owner/repo</code> แล้วกด Auto-fill เพื่อให้ลิงก์ Android ชี้ไปที่ APK ล่าสุด
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <input type="text" value={repo} onChange={e => setRepo(e.target.value.slice(0, 100))}
            placeholder="komsan114411/app"
            style={{ flex: 1, minWidth: 200, padding: '8px 12px', borderRadius: 9, border: '1px solid rgba(0,0,0,0.12)', background: '#fff', fontFamily: 'inherit', fontSize: 13 }}/>
          <button onClick={autofillAndroid} style={{
            padding: '8px 16px', borderRadius: 9, border: 'none',
            background: '#1F1B17', color: '#fff', fontFamily: 'inherit',
            fontSize: 12, fontWeight: 600, cursor: 'pointer',
          }}>Auto-fill Android</button>
        </div>
      </Card>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 16 }}>
        <Card>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
            <div style={{ width: 30, height: 30, borderRadius: 8, background: 'rgba(58,175,93,0.12)', color: '#058850', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: 16 }}>▶</div>
            <div style={{ fontSize: 13, fontWeight: 700 }}>Android</div>
          </div>
          <Field label="URL (APK / Google Play)" hint="รองรับ https:// · รับไฟล์ .apk ตรงๆ หรือลิงก์ Play Store">
            <UrlInput value={dl.android || ''} onChange={v => patch({ android: v })}
              placeholder="https://play.google.com/store/apps/details?id=..."/>
          </Field>
          <Field label="ข้อความบนปุ่ม (ไม่บังคับ)" hint="default: ดาวน์โหลด APK">
            <TextInput maxLength={40} value={dl.androidLabel || ''}
              onChange={e => patch({ androidLabel: e.target.value })} placeholder="ดาวน์โหลด APK"/>
          </Field>
        </Card>
        <Card>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
            <div style={{ width: 30, height: 30, borderRadius: 8, background: 'rgba(0,122,255,0.12)', color: '#007AFF', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: 16 }}>⌘</div>
            <div style={{ fontSize: 13, fontWeight: 700 }}>iOS</div>
          </div>
          <Field label="URL (App Store / TestFlight)" hint="iOS ต้องผ่าน App Store หรือ TestFlight · ติดตั้งตรงไม่ได้">
            <UrlInput value={dl.ios || ''} onChange={v => patch({ ios: v })}
              placeholder="https://apps.apple.com/..."/>
          </Field>
          <Field label="ข้อความบนปุ่ม (ไม่บังคับ)" hint="default: เปิดใน App Store">
            <TextInput maxLength={40} value={dl.iosLabel || ''}
              onChange={e => patch({ iosLabel: e.target.value })} placeholder="เปิดใน App Store"/>
          </Field>
        </Card>
      </div>
      <Card style={{ marginTop: 14 }}>
        <Field label="หมายเหตุถึงผู้ใช้ (ไม่บังคับ · แสดงใต้ปุ่มดาวน์โหลด)">
          <TextInput maxLength={140} value={dl.note || ''}
            onChange={e => patch({ note: e.target.value })}
            placeholder="เช่น เวอร์ชัน 1.0 · อัปเดต 25 ก.ค. 2568"/>
        </Field>
      </Card>

      <Card style={{ marginTop: 14 }}>
        <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 8 }}>📤 แชร์ลิงก์ให้ผู้ใช้</div>
        <div style={{ fontSize: 11, color: '#6B6458', marginBottom: 10, lineHeight: 1.5 }}>
          วาง URL นี้ในโพสต์ / Line / Facebook · ผู้ใช้กดแล้วเห็นหน้าแอปพร้อมปุ่ม install อัตโนมัติ
        </div>
        {(dl.android || dl.ios) ? (
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
            <code style={{ flex: 1, minWidth: 200, padding: '8px 12px', borderRadius: 8, background: '#F3EFE7', fontSize: 12, fontFamily: 'ui-monospace, monospace', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {typeof location !== 'undefined' ? location.origin : 'https://your-domain'}/
            </code>
            <button onClick={() => {
              const url = (typeof location !== 'undefined' ? location.origin : '') + '/';
              try { navigator.clipboard.writeText(url); toast.success('คัดลอกลิงก์แล้ว'); }
              catch { toast.error('คัดลอกไม่สำเร็จ'); }
            }} style={{
              padding: '8px 14px', borderRadius: 8, border: '1px solid rgba(0,0,0,0.12)',
              background: '#fff', fontFamily: 'inherit', fontSize: 12, cursor: 'pointer',
            }}>📋 คัดลอก</button>
            {dl.android && (
              <button onClick={() => {
                try { navigator.clipboard.writeText(dl.android); toast.success('คัดลอกลิงก์ APK แล้ว'); }
                catch { toast.error('คัดลอกไม่สำเร็จ'); }
              }} style={{
                padding: '8px 14px', borderRadius: 8, border: '1px solid rgba(0,0,0,0.12)',
                background: '#fff', fontFamily: 'inherit', fontSize: 12, cursor: 'pointer',
              }}>คัดลอก APK โดยตรง</button>
            )}
          </div>
        ) : (
          <div style={{ fontSize: 12, color: '#8F877C', fontStyle: 'italic' }}>
            ตั้งลิงก์ Android / iOS ก่อน
          </div>
        )}
      </Card>
      <div style={{ marginTop: 12, padding: '12px 14px', borderRadius: 10, background: '#F3EFE7', fontSize: 11, color: '#6B6458', lineHeight: 1.6 }}>
        <strong>วิธีสร้าง APK:</strong> CI workflow บน GitHub Actions สร้าง APK ให้อัตโนมัติเมื่อ push code
        (ดู <code>.github/workflows/</code>). หลัง build เสร็จ ดาวน์โหลด artifact หรือปักเป็น GitHub Release
        แล้ว paste URL ตรงนี้. ไม่มี CI ก็ paste URL Google Drive / Dropbox ได้
      </div>
    </div>
  );
}

window.DownloadLinksEditor = DownloadLinksEditor;

function friendlyCreateError(code) {
  switch (code) {
    case 'login_id_taken': return 'Login ID นี้มีอยู่แล้ว';
    case 'weak':           return 'รหัสผ่านไม่แข็งแรงพอ';
    case 'breached':       return 'รหัสนี้เคยรั่วไหล — เลือกรหัสอื่น';
    case 'too_short':      return 'รหัสผ่านสั้นเกินไป';
    case 'forbidden':      return 'ต้องเป็น admin เท่านั้น';
    case 'invalid_input':  return 'ข้อมูลไม่ถูกต้อง';
    default:               return 'สร้างบัญชีไม่สำเร็จ';
  }
}

// ─── Audit tab: paginated viewer + CSV export ───────────────
function AuditTab() {
  const [rows, setRows] = React.useState([]);
  const [cursor, setCursor] = React.useState(null);
  const [hasMore, setHasMore] = React.useState(false);
  const [filter, setFilter] = React.useState('');
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState(null);
  const [exporting, setExporting] = React.useState(false);

  const load = async (resetCursor = true) => {
    setLoading(true); setError(null);
    try {
      const data = await api.getAudit({
        limit: 50, cursor: resetCursor ? undefined : cursor, action: filter || undefined,
      });
      setRows(prev => resetCursor ? data.rows : [...prev, ...data.rows]);
      setCursor(data.nextCursor);
      setHasMore(!!data.nextCursor);
    } catch (e) { setError(e.message || 'load_failed'); }
    finally { setLoading(false); }
  };

  const exportCsv = async () => {
    if (exporting) return;
    setExporting(true);
    try {
      // Plain <a href> cannot attach the Bearer token so it hits 401.
      // Fetch as blob then trigger a synthetic download.
      const res = await api.call('/api/admin/audit/export?days=30', { auth: true });
      const text = typeof res === 'string' ? res : (res && res.text) ? await res.text() : '';
      const blob = new Blob([text || ''], { type: 'text/csv;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `audit-${new Date().toISOString().slice(0,10)}.csv`;
      document.body.appendChild(a); a.click();
      setTimeout(() => { try { document.body.removeChild(a); URL.revokeObjectURL(url); } catch {} }, 100);
      toast.success('ส่งออก CSV เรียบร้อย');
    } catch (e) {
      toast.error(e.message === 'forbidden' ? 'สิทธิ์ไม่พอ' : 'ส่งออกไม่สำเร็จ');
    } finally { setExporting(false); }
  };

  React.useEffect(() => { load(true); /* eslint-disable-next-line */ }, [filter]);

  const ACTION_TYPES = [
    '',
    'login_success', 'login_fail', 'login_locked', 'login_unknown', 'login_disabled', 'login_totp_fail',
    'config_update', 'banner_upload',
    'password_change', 'password_change_fail', 'password_reset', 'password_reset_request', 'password_reset_complete',
    'user_create', 'user_disable', 'user_enable', 'user_role_change',
    'sessions_revoke', 'self_session_revoke', 'self_sessions_revoke_all',
    'totp_enable', 'totp_disable',
    'push_broadcast',
  ];

  return (
    <div>
      <SectionHead title="บันทึกการใช้งาน · Audit Log"
        sub="เก็บ 1 ปี · IP ถูก hash ด้วย HMAC-SHA256"
        right={
          <div style={{ display: 'flex', gap: 8 }}>
            <select value={filter} onChange={e => setFilter(e.target.value)} style={{
              padding: '6px 10px', borderRadius: 8, border: '1px solid rgba(0,0,0,0.12)',
              background: '#fff', fontFamily: 'inherit', fontSize: 12,
            }}>
              <option value="">ทุกกิจกรรม</option>
              {ACTION_TYPES.filter(Boolean).map(a => <option key={a} value={a}>{a}</option>)}
            </select>
            <button onClick={exportCsv} disabled={exporting} style={{
              ...refreshBtn, color: '#1F1B17',
              opacity: exporting ? 0.6 : 1, cursor: exporting ? 'wait' : 'pointer',
            }}>{exporting ? 'กำลังส่งออก…' : 'ส่งออก 30 วัน (CSV)'}</button>
          </div>
        }/>
      {error && <div style={errBox}>โหลดไม่สำเร็จ</div>}
      <Card style={{ padding: 0, overflow: 'hidden' }}>
        <div style={{ display: 'grid', gridTemplateColumns: '180px 180px 1fr 120px', gap: 0 }}>
          <div style={headCell}>เวลา</div>
          <div style={headCell}>กิจกรรม</div>
          <div style={headCell}>ผู้ดำเนินการ</div>
          <div style={headCell}>ผลลัพธ์</div>
          {rows.map((r, i) => (
            <React.Fragment key={r._id || i}>
              <div style={rowCell}>{fmtTime(r.createdAt)}</div>
              <div style={{ ...rowCell, fontFamily: 'ui-monospace, monospace', fontSize: 11 }}>{r.action}</div>
              <div style={rowCell}>{r.actorEmail || '—'}</div>
              <div style={rowCell}>
                {r.outcome === 'failure'
                  ? <Pill tone="danger">ล้มเหลว</Pill>
                  : <Pill tone="success">สำเร็จ</Pill>}
              </div>
            </React.Fragment>
          ))}
        </div>
        {rows.length === 0 && !loading && <div style={{ padding: 24, ...dim, textAlign: 'center' }}>ไม่มีบันทึก</div>}
      </Card>
      {hasMore && (
        <button onClick={() => load(false)} disabled={loading} style={{
          marginTop: 10, padding: '8px 14px', borderRadius: 8,
          border: '1px solid rgba(0,0,0,0.12)', background: '#fff',
          fontFamily: 'inherit', fontSize: 12, cursor: 'pointer',
        }}>{loading ? 'กำลังโหลด…' : 'โหลดเพิ่ม'}</button>
      )}
    </div>
  );
}

const refreshBtn = {
  display: 'flex', alignItems: 'center', gap: 6, padding: '7px 12px',
  borderRadius: 8, border: '1px solid rgba(0,0,0,0.12)', background: '#fff',
  fontFamily: 'inherit', fontSize: 12, cursor: 'pointer',
};
const pillBtn = {
  padding: '6px 12px', borderRadius: 8, border: '1px solid rgba(0,0,0,0.12)',
  background: '#fff', fontFamily: 'inherit', fontSize: 12, cursor: 'pointer',
};
const dim = { padding: '20px 0', fontSize: 13, color: '#8F877C' };
const errBox = { marginBottom: 10, padding: '10px 12px', borderRadius: 9, background: 'rgba(180,70,58,0.08)', color: '#B4463A', fontSize: 12 };
const headCell = { padding: '10px 14px', fontSize: 11, fontWeight: 600, color: '#6B6458', background: '#F3EFE7', borderBottom: '1px solid rgba(0,0,0,0.06)', textTransform: 'uppercase', letterSpacing: 0.6 };
const rowCell = { padding: '10px 14px', fontSize: 12, color: '#1F1B17', borderBottom: '1px solid rgba(0,0,0,0.04)' };

Object.assign(window, { SecurityTab, UsersTab, AuditTab });
