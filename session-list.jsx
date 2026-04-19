// session-list.jsx — list user's own active sessions with revoke controls.
// Uses INLINE two-click arm-then-fire pattern (no window.confirm) because
// some Capacitor WebViews / browsers suppress native dialogs silently.

function SessionList() {
  const [rows, setRows] = React.useState([]);
  const [loading, setLoading] = React.useState(true);
  const [busy, setBusy] = React.useState('');
  const [activity, setActivity] = React.useState('');
  const [armed, setArmed] = React.useState('');
  const armTimer = React.useRef(null);

  const arm = (key) => {
    clearTimeout(armTimer.current);
    setArmed(key);
    armTimer.current = setTimeout(() => setArmed(''), 3000);
  };
  // true = already armed, caller should PROCEED
  const confirm = (key) => {
    if (armed === key) { clearTimeout(armTimer.current); setArmed(''); return true; }
    arm(key); return false;
  };

  const logActivity = (kind, msg) => {
    const ts = new Date().toLocaleTimeString('th-TH', { hour12: false });
    setActivity(`[${ts}] ${kind.toUpperCase()} · ${msg}`);
  };

  const load = React.useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.call('/api/admin/me/sessions', { auth: true });
      setRows(Array.isArray(data.rows) ? data.rows : []);
    } catch (e) { setRows([]); logActivity('fail', 'load · ' + (e.message || '?')); }
    finally { setLoading(false); }
  }, []);

  React.useEffect(() => { load(); }, [load]);

  const doRevoke = async (jti) => {
    setBusy(jti);
    try {
      await api.call(`/api/admin/me/sessions/${encodeURIComponent(jti)}`, { method: 'DELETE', auth: true });
      logActivity('ok', 'revoked');
      if (typeof toast !== 'undefined') toast.success('เพิกถอนเซสชันแล้ว');
      load();
    } catch (e) {
      logActivity('fail', 'revoke · ' + (e.message || '?'));
      if (typeof toast !== 'undefined') toast.error('เพิกถอนไม่สำเร็จ: ' + (e.message || 'unknown'));
    } finally { setBusy(''); }
  };
  const revoke = (jti) => {
    logActivity('click', `revoke ${jti.slice(0, 8)}`);
    if (confirm('rev:' + jti)) doRevoke(jti);
    else logActivity('arm', 'กดอีกครั้งเพื่อยืนยันเพิกถอน');
  };

  const doRevokeAll = async () => {
    setBusy('*');
    try {
      await api.call('/api/admin/me/sessions/revoke-all', { method: 'POST', auth: true });
      logActivity('ok', 'all revoked — reloading');
      if (typeof toast !== 'undefined') toast.success('ออกจากทุกอุปกรณ์แล้ว — รีโหลด');
      setTimeout(() => location.reload(), 800);
    } catch (e) {
      logActivity('fail', 'revoke-all · ' + (e.message || '?'));
      if (typeof toast !== 'undefined') toast.error('ดำเนินการไม่สำเร็จ: ' + (e.message || 'unknown'));
    } finally { setBusy(''); }
  };
  const revokeAll = () => {
    logActivity('click', 'revoke all');
    if (confirm('rev-all')) doRevokeAll();
    else logActivity('arm', 'กดอีกครั้งเพื่อยืนยันออกจากทุกอุปกรณ์');
  };

  return (
    <Card style={{ padding: 18 }}>
      <div style={{ display: 'flex', alignItems: 'center', marginBottom: 10, gap: 8, flexWrap: 'wrap' }}>
        <div style={{ fontSize: 14, fontWeight: 700, flex: 1, minWidth: 140 }}>อุปกรณ์ที่เข้าสู่ระบบ</div>
        <button onClick={load} disabled={loading} style={{
          padding: '6px 10px', borderRadius: 8, border: '1px solid rgba(0,0,0,0.12)',
          background: '#fff', fontFamily: 'inherit', fontSize: 11, cursor: 'pointer',
        }}>{loading ? 'กำลังโหลด…' : 'รีเฟรช'}</button>
        {rows.length > 0 && (() => {
          const isArmed = armed === 'rev-all';
          return (
            <button onClick={revokeAll} disabled={busy === '*'} style={{
              padding: '6px 12px', borderRadius: 8,
              border: `1px solid ${isArmed ? '#B4463A' : 'rgba(180,70,58,0.3)'}`,
              background: isArmed ? '#B4463A' : '#fff',
              color: isArmed ? '#fff' : '#B4463A',
              fontFamily: 'inherit', fontSize: 11, fontWeight: 600,
              cursor: busy === '*' ? 'wait' : 'pointer',
            }}>{busy === '*' ? 'กำลังออก…' : isArmed ? '✓ ยืนยันออกทั้งหมด?' : 'ออกทุกอุปกรณ์'}</button>
          );
        })()}
      </div>
      {activity && (
        <div style={{
          marginBottom: 10, padding: '6px 10px', borderRadius: 8,
          background: activity.includes('FAIL') ? 'rgba(180,70,58,0.08)'
                    : activity.includes('OK') ? 'rgba(6,199,85,0.08)'
                    : activity.includes('ARM') ? 'rgba(210,150,40,0.12)'
                    : '#F3EFE7',
          color: activity.includes('FAIL') ? '#B4463A'
                : activity.includes('OK') ? '#058850'
                : activity.includes('ARM') ? '#7A5A10'
                : '#3E3A34',
          fontSize: 11, fontFamily: 'ui-monospace, monospace',
        }}>{activity}</div>
      )}
      {loading && <div style={{ fontSize: 12, color: '#8F877C' }}>กำลังโหลด…</div>}
      {!loading && rows.length === 0 && <div style={{ fontSize: 12, color: '#8F877C' }}>ไม่มีเซสชันที่ใช้งานอยู่</div>}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {rows.map(r => {
          const rowBusy = busy === r.jti;
          const isArmed = armed === 'rev:' + r.jti;
          return (
            <div key={r.jti} style={{
              padding: '10px 12px', borderRadius: 9,
              border: '1px solid rgba(0,0,0,0.06)',
              display: 'flex', alignItems: 'center', gap: 10,
              opacity: rowBusy ? 0.6 : 1,
            }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 12, fontWeight: 600 }}>
                  {parseUa(r.userAgent)} · IP {r.ip || '—'}
                </div>
                <div style={{ fontSize: 11, color: '#8F877C', marginTop: 2 }}>
                  เริ่ม: {new Date(r.createdAt).toLocaleString('th-TH')}
                  {' · '}หมดอายุ: {new Date(r.expiresAt).toLocaleDateString('th-TH')}
                </div>
              </div>
              <button onClick={() => revoke(r.jti)} disabled={rowBusy} style={{
                padding: '6px 10px', borderRadius: 8,
                border: `1px solid ${isArmed ? '#B4463A' : 'rgba(0,0,0,0.12)'}`,
                background: isArmed ? '#B4463A' : '#fff',
                fontFamily: 'inherit', fontSize: 11,
                cursor: rowBusy ? 'wait' : 'pointer',
                color: isArmed ? '#fff' : '#B4463A',
              }}>{rowBusy ? '...' : isArmed ? '✓ ยืนยัน?' : 'เพิกถอน'}</button>
            </div>
          );
        })}
      </div>
    </Card>
  );
}

function parseUa(ua) {
  if (!ua) return 'ไม่ทราบอุปกรณ์';
  if (/iPhone|iPad|iPod/i.test(ua))  return 'iPhone/iPad';
  if (/Android/i.test(ua))            return 'Android';
  if (/Mac OS/i.test(ua))             return 'Mac';
  if (/Windows/i.test(ua))            return 'Windows';
  if (/Linux/i.test(ua))              return 'Linux';
  return ua.slice(0, 30);
}

window.SessionList = SessionList;
