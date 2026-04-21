// push-setup.jsx — Admin-only broadcast form. The user-facing
// subscribe button lives in push-subscribe.jsx (shipped to the APK
// via mobile/scripts/prepare-web.js). This file is web-only and
// not included in the APK bundle, since admin endpoints are
// unreachable from the Capacitor WebView anyway.

// ─── Admin: broadcast push notification form ─────────────────
function PushBroadcastCard() {
  const [title, setTitle] = React.useState('');
  const [body, setBody] = React.useState('');
  const [url, setUrl] = React.useState('/');
  const [busy, setBusy] = React.useState(false);
  const [result, setResult] = React.useState(null);
  const [available, setAvailable] = React.useState(null); // null=unknown, bool=known

  React.useEffect(() => {
    (async () => {
      try {
        const cfg = await api.getConfig();
        setAvailable(!!cfg?.capabilities?.pushNotifications);
      } catch { setAvailable(false); }
    })();
  }, []);

  const [armed, setArmed] = React.useState(false);
  const armedTimer = React.useRef(null);
  React.useEffect(() => () => clearTimeout(armedTimer.current), []);

  const send = async (e) => {
    e.preventDefault();
    if (!title.trim()) { toast.error('ต้องใส่หัวข้อ'); return; }
    const rawUrl = url.trim();
    // Client-side URL sanity: must be '/', absolute path, or a scheme-allowed URL.
    // Server re-validates with safeUrl() — this is just early UX.
    if (rawUrl && rawUrl !== '/' && !/^\//.test(rawUrl)
        && typeof safeUrl === 'function' && !safeUrl(rawUrl)) {
      toast.error('ลิงก์ไม่ปลอดภัย — รองรับเฉพาะ /path หรือ https://');
      return;
    }
    // Arm-to-confirm: first click arms button, second click within 3s fires.
    if (!armed) {
      setArmed(true);
      clearTimeout(armedTimer.current);
      armedTimer.current = setTimeout(() => setArmed(false), 3000);
      return;
    }
    setArmed(false);
    clearTimeout(armedTimer.current);
    setBusy(true); setResult(null);
    try {
      const r = await api.broadcastPush({ title: title.trim().slice(0, 80), body: body.trim().slice(0, 200), url: rawUrl.slice(0, 2048) || '/' });
      setResult({ sent: r.sent || 0, failed: r.failed || 0, pruned: r.pruned || 0 });
      toast.success(`ส่งสำเร็จ ${r.sent} · ล้มเหลว ${r.failed}`);
      setTitle(''); setBody('');
    } catch (e) {
      if (e.message === 'push_disabled') {
        toast.error('Web Push ยังไม่ได้ตั้งค่า (ขาด VAPID keys)');
        setAvailable(false);
      } else if (e.message === 'invalid_url') {
        toast.error('ลิงก์ไม่ปลอดภัย — server ปฏิเสธ');
      } else if (e.message === 'forbidden') {
        toast.error('ต้องเป็น admin (role) เท่านั้น');
      } else {
        toast.error('ส่งไม่สำเร็จ: ' + (e.message || 'unknown'));
      }
    } finally { setBusy(false); }
  };

  if (available === false) {
    return (
      <Card style={{ padding: 16, marginBottom: 14 }}>
        <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 6 }}>Broadcast Notification</div>
        <div style={{ fontSize: 12, color: '#7A5A10', padding: '10px 12px', borderRadius: 8, background: 'rgba(210,150,40,0.1)' }}>
          ฟีเจอร์นี้ต้องตั้งค่า <code>PUSH_VAPID_PUBLIC</code> และ <code>PUSH_VAPID_PRIVATE</code> บน server ก่อน
          (รันคำสั่ง <code>make vapid</code> เพื่อสร้างคู่กุญแจ)
        </div>
      </Card>
    );
  }

  return (
    <Card style={{ padding: 16, marginBottom: 14 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
        <div style={{ fontSize: 13, fontWeight: 700 }}>ส่งการแจ้งเตือน (Web Push)</div>
        {available === null && <span style={{ fontSize: 10, color: '#8F877C' }}>กำลังตรวจ…</span>}
      </div>
      <form onSubmit={send} autoComplete="off">
        <Field label="หัวข้อ (สูงสุด 80 ตัว)">
          <input type="text" value={title} onChange={e => setTitle(e.target.value.slice(0, 80))}
            required maxLength={80} placeholder="เช่น โปรโมชั่นใหม่" style={pushInput}/>
        </Field>
        <Field label="เนื้อหา (ไม่บังคับ · สูงสุด 200 ตัว)">
          <textarea value={body} onChange={e => setBody(e.target.value.slice(0, 200))}
            rows={2} maxLength={200} placeholder="รายละเอียดสั้นๆ…"
            style={{ ...pushInput, resize: 'vertical' }}/>
        </Field>
        <Field label="ลิงก์เมื่อคลิก (default /)">
          <input type="text" value={url} onChange={e => setUrl(e.target.value.slice(0, 2048))}
            maxLength={2048} placeholder="/" style={pushInput}/>
        </Field>
        <button type="submit" disabled={busy || !title.trim()} style={{
          padding: '9px 18px', borderRadius: 9, border: 'none',
          background: (busy || !title.trim()) ? '#8F877C' : (armed ? '#B4463A' : '#1F1B17'),
          color: '#fff',
          fontFamily: 'inherit', fontSize: 13, fontWeight: 600,
          cursor: (busy || !title.trim()) ? 'not-allowed' : 'pointer',
        }}>{busy ? 'กำลังส่ง…' : armed ? '✓ ยืนยันส่ง broadcast?' : 'ส่งถึง Subscribers ทั้งหมด'}</button>
        {result && (
          <div style={{ marginTop: 10, padding: '8px 12px', borderRadius: 8, background: 'rgba(6,199,85,0.08)', color: '#058850', fontSize: 12 }}>
            ส่งสำเร็จ {result.sent} · ล้มเหลว {result.failed}
            {result.pruned > 0 && <span style={{ marginLeft: 8, opacity: 0.8 }}>· ลบ endpoint ตาย {result.pruned}</span>}
          </div>
        )}
      </form>
    </Card>
  );
}

const pushInput = {
  width: '100%', padding: '9px 12px', borderRadius: 9,
  border: '1px solid rgba(0,0,0,0.12)', background: '#fff',
  fontFamily: 'inherit', fontSize: 13, color: '#1F1B17',
  boxSizing: 'border-box', outline: 'none',
};
const inlineBtn = {
  background: 'none', border: 'none', color: 'inherit',
  textDecoration: 'underline', cursor: 'pointer', fontFamily: 'inherit', fontSize: 12, padding: 0,
};

// PushSubscribeButton now lives in push-subscribe.jsx — it loads
// earlier in index.html so user-app.jsx finds it.
window.PushBroadcastCard = PushBroadcastCard;
