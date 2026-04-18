// admin-tabs.jsx — Security / Users / Audit tabs.
// Gated by role: editor never sees these. Admin-only.

// ─── Utility: format ISO date as short Thai timestamp ───────
function fmtTime(d) {
  if (!d) return '—';
  try {
    const dt = new Date(d);
    return dt.toLocaleString('th-TH', {
      year: 'numeric', month: 'short', day: 'numeric',
      hour: '2-digit', minute: '2-digit',
    });
  } catch { return String(d); }
}

// ─── Shared small primitives (local to this file) ───────────
function Pill({ children, tone = 'default' }) {
  const palette = {
    default: { bg: '#F3EFE7', color: '#3E3A34' },
    success: { bg: 'rgba(6,199,85,0.1)', color: '#058850' },
    danger:  { bg: 'rgba(180,70,58,0.1)', color: '#B4463A' },
    warn:    { bg: 'rgba(210,150,40,0.15)', color: '#7A5A10' },
  }[tone] || { bg: '#F3EFE7', color: '#3E3A34' };
  return <span style={{
    display: 'inline-block', padding: '2px 8px', borderRadius: 999,
    fontSize: 10, fontWeight: 600, ...palette,
  }}>{children}</span>;
}

// ─── Security tab: change own password ──────────────────────
function SecurityTab({ onLogout }) {
  const [current, setCurrent] = React.useState('');
  const [next, setNext] = React.useState('');
  const [confirm, setConfirm] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [msg, setMsg] = React.useState(null);
  const [strength, setStrength] = React.useState(null);

  // Lightweight local strength hint — server does the real check
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

  const submit = async (e) => {
    e.preventDefault();
    setMsg(null);
    if (next !== confirm) { setMsg({ kind: 'error', text: 'รหัสใหม่ไม่ตรงกัน' }); return; }
    if (next.length < 12) { setMsg({ kind: 'error', text: 'ต้องยาวอย่างน้อย 12 ตัว' }); return; }
    setBusy(true);
    try {
      await api.changePassword(current, next);
      setMsg({ kind: 'success', text: 'เปลี่ยนรหัสผ่านสำเร็จ — ระบบจะออกจากระบบเพื่อความปลอดภัย' });
      setTimeout(() => onLogout?.(), 1600);
    } catch (err) {
      const code = err.message || 'fail';
      setMsg({ kind: 'error', text: friendlyPasswordError(code) });
    } finally {
      setCurrent(''); setNext(''); setConfirm('');
      setBusy(false);
    }
  };

  return (
    <div>
      <SectionHead title="ความปลอดภัย" sub="เปลี่ยนรหัสผ่านของตนเอง · ระบบจะออกจากระบบทุกอุปกรณ์หลังเปลี่ยน"/>
      <div style={{ display: 'grid', gridTemplateColumns: '1.3fr 1fr', gap: 16 }}>
        <Card>
          <form onSubmit={submit} autoComplete="off">
            <Field label="รหัสผ่านปัจจุบัน">
              <input type="password" value={current} onChange={e => setCurrent(e.target.value.slice(0, 200))}
                required autoComplete="current-password" maxLength={200} style={pwInput}/>
            </Field>
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
              <div style={{
                margin: '6px 0 12px', padding: '10px 12px', borderRadius: 9,
                background: msg.kind === 'success' ? 'rgba(6,199,85,0.08)' : 'rgba(180,70,58,0.08)',
                color: msg.kind === 'success' ? '#058850' : '#B4463A',
                fontSize: 12,
              }}>{msg.text}</div>
            )}
            <button type="submit" disabled={busy} style={{
              width: '100%', padding: '10px', borderRadius: 9,
              border: 'none', background: busy ? '#8F877C' : '#1F1B17',
              color: '#fff', fontFamily: 'inherit', fontSize: 13, fontWeight: 600,
              cursor: busy ? 'not-allowed' : 'pointer',
            }}>{busy ? 'กำลังบันทึก…' : 'เปลี่ยนรหัสผ่าน'}</button>
          </form>
        </Card>
        <Card style={{ background: '#F3EFE7' }}>
          <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 10 }}>นโยบายรหัสผ่าน</div>
          <ul style={{ fontSize: 11, color: '#3E3A34', margin: 0, paddingLeft: 16, lineHeight: 1.8 }}>
            <li>ยาว 12–200 ตัวอักษร</li>
            <li>ผ่านการตรวจกับฐาน HaveIBeenPwned — รหัสที่เคยรั่วจะโดนปฏิเสธ</li>
            <li>คะแนน zxcvbn ≥ 3 (Very unguessable)</li>
            <li>ไม่เก็บรหัส — เก็บแค่ argon2id hash</li>
            <li>เปลี่ยนรหัส = logout ทุกเซสชันของบัญชีนี้</li>
          </ul>
        </Card>
      </div>
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
        <div style={{
          width: `${(level + 1) * 20}%`, height: '100%', background: colors[level],
          transition: 'width 220ms ease',
        }}/>
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
    case 'breached':            return 'รหัสนี้อยู่ในฐานรั่วไหล — เลือกรหัสอื่น';
    case 'rate_limited':        return 'พยายามบ่อยเกินไป รอสักครู่';
    default:                    return 'ไม่สามารถเปลี่ยนรหัสผ่านได้';
  }
}

// ─── Users tab: list + disable/enable/revoke ────────────────
function UsersTab({ currentUserId }) {
  const [rows, setRows] = React.useState([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState(null);

  const load = React.useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const data = await api.listUsers();
      setRows(Array.isArray(data.rows) ? data.rows : []);
    } catch (e) { setError(e.message || 'load_failed'); }
    finally { setLoading(false); }
  }, []);

  React.useEffect(() => { load(); }, [load]);

  const act = async (id, action) => {
    if (!window.confirm(confirmText(action))) return;
    try {
      await api.userAction(id, action);
      await load();
    } catch (e) { window.alert('ดำเนินการไม่สำเร็จ: ' + (e.message || 'unknown')); }
  };

  return (
    <div>
      <SectionHead title="ผู้ดูแลระบบ" sub={`${rows.length} บัญชี · เฉพาะ role admin เท่านั้นที่เห็นหน้านี้`}
        right={<button onClick={load} style={refreshBtn}><Icon name="sparkle" size={13} stroke={1.8}/> รีเฟรช</button>}/>
      {loading && <div style={dim}>กำลังโหลด…</div>}
      {error && <div style={errBox}>โหลดไม่สำเร็จ ({error})</div>}
      {!loading && !error && rows.length === 0 && <div style={dim}>ยังไม่มีบัญชี</div>}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {rows.map(u => {
          const isSelf = String(u._id) === String(currentUserId);
          const disabled = !!u.disabledAt;
          return (
            <Card key={u._id} style={{ padding: 14 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <div style={{
                  width: 40, height: 40, borderRadius: 11, background: '#1F1B17', color: '#fff',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: 15,
                }}>{(u.email || '?').slice(0,1).toUpperCase()}</div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 14, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 8 }}>
                    {u.email}
                    {isSelf && <Pill>คุณ</Pill>}
                    <Pill tone={u.role === 'admin' ? 'default' : 'warn'}>{u.role}</Pill>
                    {disabled ? <Pill tone="danger">ปิดการใช้งาน</Pill> : <Pill tone="success">ใช้งาน</Pill>}
                  </div>
                  <div style={{ fontSize: 11, color: '#8F877C', marginTop: 3 }}>
                    เข้าสู่ระบบล่าสุด: {fmtTime(u.lastLoginAt)}
                    {u.lastLoginIp && <span> · จาก {u.lastLoginIp}</span>}
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 6 }}>
                  {disabled
                    ? <button onClick={() => act(u._id, 'enable')} style={{ ...pillBtn, color: '#058850' }}>เปิด</button>
                    : <button onClick={() => act(u._id, 'disable')} disabled={isSelf} style={{ ...pillBtn, color: '#B4463A', opacity: isSelf ? 0.3 : 1, cursor: isSelf ? 'not-allowed' : 'pointer' }}>ปิด</button>}
                  <button onClick={() => act(u._id, 'revoke-sessions')} style={{ ...pillBtn, color: '#7A5A10' }}>เตะออก</button>
                </div>
              </div>
            </Card>
          );
        })}
      </div>
    </div>
  );
}

function confirmText(action) {
  return action === 'disable' ? 'ปิดบัญชีนี้? (เตะออกทุกเซสชัน)' :
         action === 'enable'  ? 'เปิดบัญชีนี้?' :
         action === 'revoke-sessions' ? 'บังคับ logout ทุกเซสชันของบัญชีนี้?' :
         'ยืนยัน?';
}

// ─── Audit tab: paginated log viewer ────────────────────────
function AuditTab() {
  const [rows, setRows] = React.useState([]);
  const [cursor, setCursor] = React.useState(null);
  const [hasMore, setHasMore] = React.useState(false);
  const [filter, setFilter] = React.useState('');
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState(null);

  const load = async (resetCursor = true) => {
    setLoading(true); setError(null);
    try {
      const data = await api.getAudit({
        limit: 50,
        cursor: resetCursor ? undefined : cursor,
        action: filter || undefined,
      });
      setRows(prev => resetCursor ? data.rows : [...prev, ...data.rows]);
      setCursor(data.nextCursor);
      setHasMore(!!data.nextCursor);
    } catch (e) { setError(e.message || 'load_failed'); }
    finally { setLoading(false); }
  };

  React.useEffect(() => { load(true); /* eslint-disable-next-line */ }, [filter]);

  const ACTION_TYPES = ['', 'login_success', 'login_fail', 'login_locked', 'login_unknown', 'login_disabled', 'config_update', 'password_change', 'user_disable', 'user_enable', 'sessions_revoke'];

  return (
    <div>
      <SectionHead title="บันทึกการใช้งาน · Audit Log"
        sub="เก็บ 1 ปี · IP ถูก hash ด้วย HMAC-SHA256"
        right={
          <select value={filter} onChange={e => setFilter(e.target.value)} style={{
            padding: '6px 10px', borderRadius: 8, border: '1px solid rgba(0,0,0,0.12)',
            background: '#fff', fontFamily: 'inherit', fontSize: 12,
          }}>
            <option value="">ทุกกิจกรรม</option>
            {ACTION_TYPES.filter(Boolean).map(a => <option key={a} value={a}>{a}</option>)}
          </select>
        }/>
      {error && <div style={errBox}>โหลดไม่สำเร็จ</div>}
      <Card style={{ padding: 0, overflow: 'hidden' }}>
        <div style={{ display: 'grid', gridTemplateColumns: '180px 160px 1fr 120px', gap: 0 }}>
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
const errBox = {
  marginBottom: 10, padding: '10px 12px', borderRadius: 9,
  background: 'rgba(180,70,58,0.08)', color: '#B4463A', fontSize: 12,
};
const headCell = {
  padding: '10px 14px', fontSize: 11, fontWeight: 600, color: '#6B6458',
  background: '#F3EFE7', borderBottom: '1px solid rgba(0,0,0,0.06)',
  textTransform: 'uppercase', letterSpacing: 0.6,
};
const rowCell = {
  padding: '10px 14px', fontSize: 12, color: '#1F1B17',
  borderBottom: '1px solid rgba(0,0,0,0.04)',
};

Object.assign(window, { SecurityTab, UsersTab, AuditTab });
