// session-list.jsx — list user's own active sessions with revoke controls.

function SessionList() {
  const [rows, setRows] = React.useState([]);
  const [loading, setLoading] = React.useState(true);

  const load = React.useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.call('/api/admin/me/sessions', { auth: true });
      setRows(Array.isArray(data.rows) ? data.rows : []);
    } catch { setRows([]); }
    finally { setLoading(false); }
  }, []);

  React.useEffect(() => { load(); }, [load]);

  const revoke = async (jti) => {
    const ok = await toast.confirm('เพิกถอนเซสชันนี้?', 'เพิกถอน', 'ยกเลิก', { tone: 'danger' });
    if (!ok) return;
    try {
      await api.call(`/api/admin/me/sessions/${encodeURIComponent(jti)}`, { method: 'DELETE', auth: true });
      toast.success('เพิกถอนแล้ว');
      load();
    } catch { toast.error('เพิกถอนไม่สำเร็จ'); }
  };

  const revokeAll = async () => {
    const ok = await toast.confirm('ออกจากระบบทุกอุปกรณ์? จะต้อง login ใหม่', 'ออกทั้งหมด', 'ยกเลิก', { tone: 'danger' });
    if (!ok) return;
    try {
      await api.call('/api/admin/me/sessions/revoke-all', { method: 'POST', auth: true });
      toast.success('ออกจากทุกอุปกรณ์แล้ว');
      setTimeout(() => location.reload(), 800);
    } catch { toast.error('ดำเนินการไม่สำเร็จ'); }
  };

  return (
    <Card style={{ padding: 18 }}>
      <div style={{ display: 'flex', alignItems: 'center', marginBottom: 10 }}>
        <div style={{ fontSize: 14, fontWeight: 700, flex: 1 }}>อุปกรณ์ที่เข้าสู่ระบบ</div>
        {rows.length > 0 && (
          <button onClick={revokeAll} style={{
            padding: '6px 12px', borderRadius: 8, border: '1px solid rgba(180,70,58,0.3)',
            background: '#fff', color: '#B4463A',
            fontFamily: 'inherit', fontSize: 11, fontWeight: 600, cursor: 'pointer',
          }}>ออกทุกอุปกรณ์</button>
        )}
      </div>
      {loading && <div style={{ fontSize: 12, color: '#8F877C' }}>กำลังโหลด…</div>}
      {!loading && rows.length === 0 && <div style={{ fontSize: 12, color: '#8F877C' }}>ไม่มีเซสชันที่ใช้งานอยู่</div>}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {rows.map(r => (
          <div key={r.jti} style={{
            padding: '10px 12px', borderRadius: 9,
            border: '1px solid rgba(0,0,0,0.06)',
            display: 'flex', alignItems: 'center', gap: 10,
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
            <button onClick={() => revoke(r.jti)} style={{
              padding: '6px 10px', borderRadius: 8, border: '1px solid rgba(0,0,0,0.12)',
              background: '#fff', fontFamily: 'inherit', fontSize: 11, cursor: 'pointer', color: '#B4463A',
            }}>เพิกถอน</button>
          </div>
        ))}
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
