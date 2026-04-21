// push-subscribe.jsx — User-facing "Enable notifications" button.
//
// Split out of push-setup.jsx (which now only hosts the admin
// PushBroadcastCard) so the APK can ship this button without also
// bundling admin-surface JSX. Previously push-setup.jsx was loaded
// on the web but NOT listed in mobile/scripts/prepare-web.js's
// USER_ONLY_FILES → the APK had `PushSubscribeButton` undefined →
// the conditional `typeof PushSubscribeButton === 'function'` in
// user-app.jsx evaluated false → the "Enable notifications" button
// never appeared on phones, which is why /push/subscribe saw 0
// calls in production.
//
// This file is pure user surface: no admin endpoints, no auth:true
// fetches, no secrets. Safe to unzip-inspect in the APK.

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - base64String.length % 4) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  const arr = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i);
  return arr;
}

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

  const t = theme || {};
  const accent = t.accent || 'oklch(0.62 0.14 45)';
  const accentInk = t.accentInk || '#FFFFFF';
  const muted = t.muted || '#6B6458';
  const ink = t.ink || '#1F1B17';
  const surface = t.surface || '#FFFFFF';
  const border = t.border || 'rgba(0,0,0,0.06)';

  return (
    <div style={{ padding: '14px 16px', borderRadius: 14,
      background: surface, border: `1px solid ${border}`,
      margin: '8px 16px 14px', display: 'flex', gap: 10, alignItems: 'center' }}>
      <div style={{
        width: 36, height: 36, borderRadius: 10,
        background: `${accent}20`, color: accent,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: 18, flexShrink: 0,
      }}>🔔</div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: ink }}>
          {state === 'subscribed' ? 'เปิดการแจ้งเตือนอยู่'
            : state === 'denied'  ? 'การแจ้งเตือนถูกบล็อก'
            : 'รับการแจ้งเตือน'}
        </div>
        <div style={{ fontSize: 11, color: muted, marginTop: 2, lineHeight: 1.45 }}>
          {state === 'subscribed' ? 'จะได้ข้อความจากแอดมินแม้ไม่เปิดแอป'
            : state === 'denied'  ? 'เปิดจาก Settings ของเบราว์เซอร์'
            : 'กดเปิดเพื่อรับข่าวสารจากแอดมิน'}
        </div>
        {error && <div style={{ fontSize: 10, color: '#B4463A', marginTop: 3 }}>Error: {error}</div>}
      </div>
      {state === 'idle' && (
        <button onClick={subscribe} disabled={state === 'busy'} style={{
          padding: '8px 14px', borderRadius: 9, border: 'none',
          background: accent, color: accentInk,
          fontFamily: 'inherit', fontSize: 12, fontWeight: 600,
          cursor: 'pointer', whiteSpace: 'nowrap',
        }}>เปิดแจ้งเตือน</button>
      )}
      {state === 'busy' && (
        <span style={{ fontSize: 11, color: muted }}>กำลังตั้งค่า…</span>
      )}
      {state === 'subscribed' && (
        <button onClick={unsubscribe} style={{
          padding: '7px 12px', borderRadius: 9,
          border: `1px solid ${border}`, background: surface, color: muted,
          fontFamily: 'inherit', fontSize: 11, cursor: 'pointer', whiteSpace: 'nowrap',
        }}>ปิด</button>
      )}
    </div>
  );
}

if (typeof window !== 'undefined') {
  window.PushSubscribeButton = PushSubscribeButton;
  // Also export the helper so push-setup.jsx (admin surface, web-only)
  // can reuse it without duplicating the base64 decoder.
  window.urlBase64ToUint8Array = urlBase64ToUint8Array;
}
