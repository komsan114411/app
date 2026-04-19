// install-share.jsx — Admin card for generating / rotating / revoking
// the install-link token. Replaces the fixed /install URL with a
// per-admin-generated URL that can be invalidated at any time.
//
// Rationale: the admin wants to share a download dashboard link with
// specific people, then kill the link if it leaks or a new version
// should be distributed. Generating a new token immediately invalidates
// every previously shared link.

function InstallLinkShareCard({ dl }) {
  const origin = typeof location !== 'undefined' ? location.origin : 'https://your-domain';
  const [token, setToken] = React.useState('');
  const [rotatedAt, setRotatedAt] = React.useState(null);
  const [rotationCount, setRotationCount] = React.useState(0);
  const [loading, setLoading] = React.useState(true);
  const [busy, setBusy] = React.useState(false);
  const [showQr, setShowQr] = React.useState(false);
  const [armedRotate, setArmedRotate] = React.useState(false);
  const [armedRevoke, setArmedRevoke] = React.useState(false);
  const rotateTimer = React.useRef(null);
  const revokeTimer = React.useRef(null);
  React.useEffect(() => () => { clearTimeout(rotateTimer.current); clearTimeout(revokeTimer.current); }, []);

  const ready = !!(dl?.android || dl?.ios);
  const hasToken = !!token;
  const installUrl = hasToken ? `${origin}/install/${token}` : '';

  const load = React.useCallback(async () => {
    setLoading(true);
    try {
      const r = await api.getInstallToken();
      setToken(r.current || '');
      setRotatedAt(r.rotatedAt);
      setRotationCount(r.rotationCount || 0);
    } catch (e) {
      if (typeof toast !== 'undefined') toast.error('โหลดสถานะลิงก์ไม่สำเร็จ: ' + (e.message || 'unknown'));
    } finally { setLoading(false); }
  }, []);
  React.useEffect(() => { load(); }, [load]);

  const rotate = async () => {
    if (!armedRotate) {
      setArmedRotate(true);
      clearTimeout(rotateTimer.current);
      rotateTimer.current = setTimeout(() => setArmedRotate(false), 3000);
      return;
    }
    setArmedRotate(false);
    clearTimeout(rotateTimer.current);
    setBusy(true);
    try {
      const r = await api.rotateInstallToken();
      setToken(r.token);
      setRotatedAt(r.rotatedAt);
      setRotationCount(r.rotationCount || 0);
      if (typeof toast !== 'undefined') toast.success('สร้างลิงก์ใหม่แล้ว — ลิงก์เก่าใช้ไม่ได้แล้ว');
    } catch (e) {
      if (typeof toast !== 'undefined') toast.error('สร้างไม่สำเร็จ: ' + (e.message || 'unknown'));
    } finally { setBusy(false); }
  };

  const revoke = async () => {
    if (!armedRevoke) {
      setArmedRevoke(true);
      clearTimeout(revokeTimer.current);
      revokeTimer.current = setTimeout(() => setArmedRevoke(false), 3000);
      return;
    }
    setArmedRevoke(false);
    clearTimeout(revokeTimer.current);
    setBusy(true);
    try {
      await api.revokeInstallToken();
      setToken(''); setRotatedAt(new Date());
      if (typeof toast !== 'undefined') toast.success('ยกเลิกลิงก์แล้ว — ไม่มีลิงก์ที่ใช้งานได้');
    } catch (e) {
      if (typeof toast !== 'undefined') toast.error('ยกเลิกไม่สำเร็จ: ' + (e.message || 'unknown'));
    } finally { setBusy(false); }
  };

  const copy = async (url, what = 'ลิงก์') => {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(url);
        if (typeof toast !== 'undefined') toast.success('คัดลอก' + what + 'แล้ว');
        return;
      }
      const ta = document.createElement('textarea');
      ta.value = url; ta.style.position = 'fixed'; ta.style.top = '-9999px';
      document.body.appendChild(ta); ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
      if (typeof toast !== 'undefined') toast.success('คัดลอก' + what + 'แล้ว');
    } catch {
      if (typeof toast !== 'undefined') toast.error('คัดลอกไม่สำเร็จ');
    }
  };

  if (loading) {
    return (
      <Card style={{ marginTop: 14 }}>
        <div style={{ fontSize: 12, color: '#8F877C' }}>กำลังโหลดสถานะลิงก์…</div>
      </Card>
    );
  }

  return (
    <Card style={{
      marginTop: 14,
      background: 'linear-gradient(135deg, #FBFAF7, #F3EFE7)',
      border: `2px solid ${hasToken ? 'rgba(6,199,85,0.25)' : 'rgba(210,150,40,0.3)'}`,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10, flexWrap: 'wrap' }}>
        <div style={{ fontSize: 18 }}>🔐</div>
        <div style={{ flex: 1, minWidth: 180 }}>
          <div style={{ fontSize: 14, fontWeight: 700 }}>ลิงก์ติดตั้งส่วนตัว (หมุนเวียนได้)</div>
          <div style={{ fontSize: 11, color: '#6B6458', marginTop: 2, lineHeight: 1.5 }}>
            สร้างลิงก์โทเคนที่หมุนได้ทุกเมื่อ · ลิงก์เก่าใช้ไม่ได้ทันทีเมื่อสร้างใหม่ · ไม่มี URL ตายตัว
          </div>
        </div>
        {hasToken && (
          <span style={{
            padding: '3px 10px', borderRadius: 999, fontSize: 10, fontWeight: 600,
            background: 'rgba(6,199,85,0.15)', color: '#058850',
          }}>● ใช้งานอยู่</span>
        )}
        {!hasToken && (
          <span style={{
            padding: '3px 10px', borderRadius: 999, fontSize: 10, fontWeight: 600,
            background: 'rgba(210,150,40,0.2)', color: '#7A5A10',
          }}>ยังไม่ได้สร้าง</span>
        )}
      </div>

      {!ready && (
        <div style={{ padding: '10px 12px', borderRadius: 9, background: 'rgba(210,150,40,0.15)', color: '#7A5A10', fontSize: 12, marginBottom: 12 }}>
          ⚠ ตั้ง URL Android / iOS ด้านบนก่อน ลิงก์ติดตั้งถึงจะมีประโยชน์
        </div>
      )}

      {hasToken ? (
        <>
          <div style={{
            display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap',
            padding: '10px 12px', borderRadius: 10, background: '#fff',
            border: '1px solid rgba(0,0,0,0.06)', marginBottom: 10,
          }}>
            <code style={{
              flex: 1, minWidth: 200, fontSize: 12, fontWeight: 500,
              fontFamily: 'ui-monospace, monospace',
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              color: '#058850',
            }}>{installUrl}</code>
          </div>
          <div style={{ fontSize: 10, color: '#8F877C', marginBottom: 12 }}>
            สร้างล่าสุด: {rotatedAt ? new Date(rotatedAt).toLocaleString('th-TH') : '—'}
            {' · '}สร้างมาแล้ว {rotationCount} ครั้ง
          </div>
        </>
      ) : (
        <div style={{
          padding: '14px 16px', borderRadius: 10, background: 'rgba(0,0,0,0.04)',
          fontSize: 12, color: '#6B6458', marginBottom: 12, lineHeight: 1.6, textAlign: 'center',
        }}>
          ยังไม่มีลิงก์ติดตั้งที่ใช้งานได้ · กดปุ่ม "🔄 สร้างลิงก์ใหม่" ด้านล่างเพื่อเริ่มต้น
        </div>
      )}

      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        <button onClick={rotate} disabled={busy} style={{
          padding: '9px 16px', borderRadius: 9, border: 'none',
          background: armedRotate ? '#B4463A' : (hasToken ? '#7A5A10' : '#058850'),
          color: '#fff', fontFamily: 'inherit', fontSize: 13, fontWeight: 600,
          cursor: busy ? 'wait' : 'pointer', display: 'flex', alignItems: 'center', gap: 6,
        }}>
          {busy ? '...' : armedRotate
            ? (hasToken ? '✓ ยืนยัน — ลิงก์เก่าจะหมดอายุ?' : '✓ ยืนยันสร้างลิงก์?')
            : (hasToken ? '🔄 สร้างลิงก์ใหม่ (ลิงก์เก่าหมดอายุ)' : '✨ สร้างลิงก์ครั้งแรก')}
        </button>

        {hasToken && (
          <>
            <button onClick={() => copy(installUrl, 'ลิงก์ติดตั้ง')} disabled={busy} style={{
              padding: '9px 14px', borderRadius: 9, border: '1px solid rgba(0,0,0,0.12)',
              background: '#fff', fontFamily: 'inherit', fontSize: 13, cursor: 'pointer',
            }}>📋 คัดลอก</button>
            <button onClick={() => window.open(installUrl, '_blank')} disabled={busy} style={{
              padding: '9px 14px', borderRadius: 9, border: '1px solid rgba(0,0,0,0.12)',
              background: '#fff', fontFamily: 'inherit', fontSize: 13, cursor: 'pointer',
            }}>👁 ดู preview</button>
            <button onClick={() => setShowQr(s => !s)} disabled={busy} style={{
              padding: '9px 14px', borderRadius: 9, border: '1px solid rgba(0,0,0,0.12)',
              background: '#fff', fontFamily: 'inherit', fontSize: 13, cursor: 'pointer',
            }}>{showQr ? 'ซ่อน QR' : '📱 QR'}</button>
            {typeof navigator !== 'undefined' && navigator.share && (
              <button onClick={() => {
                navigator.share({
                  title: 'ดาวน์โหลดแอป', text: 'ติดตั้งแอปได้ที่: ' + installUrl, url: installUrl,
                }).catch(() => {});
              }} disabled={busy} style={{
                padding: '9px 14px', borderRadius: 9, border: '1px solid rgba(0,0,0,0.12)',
                background: '#fff', fontFamily: 'inherit', fontSize: 13, cursor: 'pointer',
              }}>↗ แชร์</button>
            )}
            <a
              href={`https://line.me/R/msg/text/?${encodeURIComponent('ติดตั้งแอป: ' + installUrl)}`}
              target="_blank" rel="noopener" style={{
              padding: '9px 14px', borderRadius: 9, border: '1px solid rgba(6,199,85,0.3)',
              background: 'rgba(6,199,85,0.08)', color: '#058850',
              fontFamily: 'inherit', fontSize: 13, cursor: 'pointer',
              textDecoration: 'none', display: 'flex', alignItems: 'center', gap: 6,
            }}>🟢 LINE</a>
            <button onClick={revoke} disabled={busy} style={{
              padding: '9px 14px', borderRadius: 9,
              border: `1px solid ${armedRevoke ? '#B4463A' : 'rgba(180,70,58,0.3)'}`,
              background: armedRevoke ? '#B4463A' : '#fff',
              color: armedRevoke ? '#fff' : '#B4463A',
              fontFamily: 'inherit', fontSize: 13, cursor: 'pointer',
              marginLeft: 'auto',
            }}>{armedRevoke ? '✓ ยืนยันยกเลิก?' : '🚫 ยกเลิกลิงก์'}</button>
          </>
        )}
      </div>

      {showQr && hasToken && typeof QrSvg === 'function' && (
        <div style={{
          marginTop: 14, padding: 20, borderRadius: 12,
          background: '#fff', border: '1px solid rgba(0,0,0,0.06)',
          display: 'flex', gap: 16, alignItems: 'center', flexWrap: 'wrap',
        }}>
          <QrSvg text={installUrl} size={180}/>
          <div style={{ flex: 1, minWidth: 160 }}>
            <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 6 }}>วางใน event / โพสต์ / หน้าร้าน</div>
            <div style={{ fontSize: 11, color: '#6B6458', lineHeight: 1.55 }}>
              ผู้ใช้สแกนด้วยกล้องมือถือ → เปิดหน้าแดชบอร์ด → กดดาวน์โหลดติดตั้งได้ทันที
              <br/><strong>QR นี้จะใช้ไม่ได้ทันทีเมื่อคุณกด "สร้างลิงก์ใหม่"</strong>
            </div>
          </div>
        </div>
      )}

      <div style={{
        marginTop: 12, padding: '10px 12px', borderRadius: 9,
        background: 'rgba(0,0,0,0.04)', fontSize: 11, color: '#6B6458', lineHeight: 1.6,
      }}>
        <strong>🎯 วิธีใช้:</strong><br/>
        1. กด "สร้างลิงก์ใหม่" → ได้ URL ใหม่ที่ทำงานเฉพาะโทเคนนี้<br/>
        2. คัดลอก / แชร์ / QR ส่งให้ผู้ใช้ที่ต้องการ<br/>
        3. ถ้าลิงก์รั่วไหล / ต้องการเปลี่ยน — กด "สร้างลิงก์ใหม่" อีกครั้ง → ลิงก์เก่าหยุดทำงานทันที<br/>
        4. ผู้ใช้ที่ยังใช้ลิงก์เก่าจะเห็นหน้า "ลิงก์หมดอายุ" พร้อมขอลิงก์ใหม่
      </div>
    </Card>
  );
}

window.InstallLinkShareCard = InstallLinkShareCard;
