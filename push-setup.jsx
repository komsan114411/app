// push-setup.jsx — Web Push subscription UI (user-facing button)
// and admin broadcast form.

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - base64String.length % 4) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  const arr = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i);
  return arr;
}

// ─── User-facing subscribe button ────────────────────────────
function PushSubscribeButton({ theme }) {
  const [state, setState] = React.useState('idle'); // idle | subscribed | denied | unsupported | unavailable | busy
  const [error, setError] = React.useState(null);

  React.useEffect(() => {
    (async () => {
      if (typeof Notification === 'undefined' || !('serviceWorker' in navigator) || !('PushManager' in window)) {
        setState('unsupported'); return;
      }
      try {
        const cfg = await api.getConfig();
        if (!cfg?.capabilities?.pushNotifications) { setState('unavailable'); return; }
      } catch {}
      if (Notification.permission === 'denied') { setState('denied'); return; }
      try {
        const reg = await navigator.serviceWorker.ready;
        const sub = await reg.pushManager.getSubscription();
        if (sub) setState('subscribed');
      } catch {}
    })();
  }, []);

  const subscribe = async () => {
    setError(null);
    setState('busy');
    try {
      const perm = await Notification.requestPermission();
      if (perm !== 'granted') { setState(perm === 'denied' ? 'denied' : 'idle'); return; }
      const { publicKey } = await api.vapidKey();
      if (!publicKey) { setState('unavailable'); return; }
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey),
      });
      const json = sub.toJSON();
      await api.subscribePush({ endpoint: json.endpoint, keys: json.keys });
      setState('subscribed');
    } catch (e) {
      setError(e.message || 'subscribe_failed');
      setState('idle');
    }
  };

  const unsubscribe = async () => {
    setState('busy');
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      if (sub) await sub.unsubscribe();
      setState('idle');
    } catch { setState('idle'); }
  };

  // Hide completely if not supported or feature disabled on server
  if (state === 'unsupported' || state === 'unavailable') return null;

  const surface = theme?.surface || '#fff';
  const ink = theme?.ink || '#1F1B17';
  const border = theme?.border || 'rgba(0,0,0,0.12)';

  return (
    <div style={{
      margin: '0 16px 12px', padding: '10px 14px', borderRadius: 12,
      background: surface, border: `1px solid ${border}`,
      display: 'flex', alignItems: 'center', gap: 10, color: ink, fontSize: 12,
    }}>
      <Icon name="bell" size={16} stroke={1.8}/>
      <div style={{ flex: 1, minWidth: 0 }}>
        {state === 'subscribed' && <span>รับการแจ้งเตือนอยู่ · <button onClick={unsubscribe} style={inlineBtn}>ยกเลิก</button></span>}
        {state === 'denied' && <span style={{ opacity: 0.7 }}>การแจ้งเตือนถูกบล็อก — เปิดใน Setting เบราว์เซอร์</span>}
        {state === 'idle' && <span>รับข่าวสาร/โปรโมชั่นใหม่ผ่านการแจ้งเตือน</span>}
        {state === 'busy' && <span>กำลังดำเนินการ…</span>}
        {error && <div style={{ color: '#B4463A', fontSize: 11, marginTop: 3 }}>เกิดข้อผิดพลาด: {error}</div>}
      </div>
      {state === 'idle' && (
        <button onClick={subscribe} style={{
          padding: '6px 12px', borderRadius: 8, border: 'none',
          background: ink, color: surface, fontSize: 11, fontWeight: 600,
          cursor: 'pointer', fontFamily: 'inherit',
        }}>เปิดการแจ้งเตือน</button>
      )}
    </div>
  );
}

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

  const send = async (e) => {
    e.preventDefault();
    if (!title.trim()) { toast.error('ต้องใส่หัวข้อ'); return; }
    const ok = await toast.confirm(`ส่งแจ้งเตือน "${title}" ถึง subscribers ทั้งหมด?`, 'ส่ง', 'ยกเลิก');
    if (!ok) return;
    setBusy(true); setResult(null);
    try {
      const r = await api.broadcastPush({ title: title.trim().slice(0, 80), body: body.trim().slice(0, 200), url: url.trim().slice(0, 2048) || '/' });
      setResult({ sent: r.sent || 0, failed: r.failed || 0 });
      toast.success(`ส่งสำเร็จ ${r.sent} · ล้มเหลว ${r.failed}`);
      setTitle(''); setBody('');
    } catch (e) {
      if (e.message === 'push_disabled') {
        toast.error('Web Push ยังไม่ได้ตั้งค่า (ขาด VAPID keys)');
        setAvailable(false);
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
          background: (busy || !title.trim()) ? '#8F877C' : '#1F1B17', color: '#fff',
          fontFamily: 'inherit', fontSize: 13, fontWeight: 600,
          cursor: (busy || !title.trim()) ? 'not-allowed' : 'pointer',
        }}>{busy ? 'กำลังส่ง…' : 'ส่งถึง Subscribers ทั้งหมด'}</button>
        {result && (
          <div style={{ marginTop: 10, padding: '8px 12px', borderRadius: 8, background: 'rgba(6,199,85,0.08)', color: '#058850', fontSize: 12 }}>
            ส่งสำเร็จ {result.sent} · ล้มเหลว {result.failed}
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

window.PushSubscribeButton = PushSubscribeButton;
window.PushBroadcastCard = PushBroadcastCard;
