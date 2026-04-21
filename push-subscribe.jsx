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
  const [state, setState] = React.useState('idle'); // idle | subscribed | denied | unsupported | unavailable | busy | testing
  const [error, setError] = React.useState(null);
  // Step-by-step diagnostic. Each string describes what just ran.
  const [steps, setSteps] = React.useState([]);
  const [showDiag, setShowDiag] = React.useState(false);
  const pushStep = (s) => setSteps(prev => [...prev, { at: Date.now(), msg: s }]);

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

  // Full subscribe + self-test flow. Every step pushes a visible
  // log entry so if something fails the user sees the exact layer.
  const subscribe = async () => {
    setError(null);
    setSteps([]);
    setState('busy');
    setShowDiag(true);
    pushStep('1. requestPermission() — รอ Android dialog');
    try {
      const perm = await Notification.requestPermission();
      pushStep(`   → perm = "${perm}"`);
      if (perm !== 'granted') {
        if (perm === 'default') {
          setError('permission_dialog_suppressed — APK ขาด POST_NOTIFICATIONS · ต้อง uninstall + ติดตั้งใหม่');
          pushStep('   ✗ dialog ถูก suppress · APK เก่าหรือ permission ไม่ได้ฝัง');
        } else {
          pushStep(`   ✗ user ${perm}`);
        }
        setState(perm === 'denied' ? 'denied' : 'idle');
        return;
      }

      pushStep('2. GET /api/push/vapid-key');
      const { publicKey } = await api.vapidKey();
      if (!publicKey) {
        setError('vapid_key_missing — backend ยังไม่ generate VAPID');
        pushStep('   ✗ publicKey เป็น empty');
        setState('unavailable'); return;
      }
      pushStep(`   ✓ publicKey (${publicKey.length} chars) · prefix ${publicKey.slice(0, 16)}…`);

      pushStep('3. navigator.serviceWorker.ready');
      const reg = await navigator.serviceWorker.ready;
      pushStep(`   ✓ SW scope ${reg.scope}`);

      pushStep('4. pushManager.subscribe() — ติดต่อ push service');
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey),
      });
      const json = sub.toJSON();
      let host = 'unknown';
      try { host = new URL(json.endpoint).host; } catch {}
      pushStep(`   ✓ endpoint host: ${host}`);

      pushStep('5. POST /api/push/subscribe — บันทึก endpoint');
      await api.subscribePush({ endpoint: json.endpoint, keys: json.keys });
      pushStep('   ✓ 204 (stored)');

      pushStep('6. POST /api/push/test — self-test delivery');
      setState('testing');
      const testResult = await api.testPush({ endpoint: json.endpoint, keys: json.keys });
      if (testResult.ok) {
        pushStep(`   ✓ ส่งผ่าน ${testResult.elapsedMs}ms · รอ notification…`);
        pushStep('7. ถ้า notification ไม่เด้งใน 10 วิ = WebView block notification (ดู Android Settings → Apps → HOF88 → Notifications)');
      } else {
        pushStep(`   ✗ reason: ${testResult.reason} (status ${testResult.statusCode ?? 'n/a'})`);
        setError(`test_send_failed: ${testResult.reason}`);
      }
      setState('subscribed');
    } catch (e) {
      const name = (e && e.name) || '';
      const msg  = (e && e.message) || 'subscribe_failed';
      setError(name ? `${name}: ${msg}` : msg);
      pushStep(`   ✗ exception: ${name || 'Error'}: ${msg}`);
      try { console.warn('[push] subscribe failed:', name, msg, e); } catch {}
      setState('idle');
    }
  };

  // Manual self-test for an already-subscribed device. Runs on demand
  // so user can verify delivery after the initial subscribe without
  // having to unsubscribe/resubscribe.
  const runSelfTest = async () => {
    setError(null);
    setSteps([]);
    setShowDiag(true);
    pushStep('Self-test: ตรวจ subscription ที่มีอยู่');
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      if (!sub) {
        pushStep('   ✗ ไม่มี subscription · กด "เปิดแจ้งเตือน" ก่อน');
        setError('no_subscription');
        return;
      }
      const json = sub.toJSON();
      pushStep(`   ✓ endpoint host: ${(()=>{try{return new URL(json.endpoint).host}catch{return 'unknown'}})()}`);
      pushStep('Sending self-test…');
      const r = await api.testPush({ endpoint: json.endpoint, keys: json.keys });
      if (r.ok) {
        pushStep(`   ✓ backend → push service ผ่าน ${r.elapsedMs}ms`);
        pushStep('   รอ notification ที่ OS ตัวเอง ถ้าไม่เด้งใน 10 วิ = ปัญหาในชั้น OS/Android (app permission ถูกปิด)');
      } else {
        pushStep(`   ✗ ${r.reason} (status ${r.statusCode ?? '—'})`);
        setError(`${r.reason}`);
      }
    } catch (e) {
      pushStep(`   ✗ exception: ${e.message || e.name}`);
      setError(e.message || 'selftest_failed');
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
    <div style={{ margin: '8px 16px 14px' }}>
      <div style={{ padding: '14px 16px', borderRadius: 14,
        background: surface, border: `1px solid ${border}`,
        display: 'flex', gap: 10, alignItems: 'center' }}>
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
              : state === 'testing' ? 'กำลังทดสอบ…'
              : 'รับการแจ้งเตือน'}
          </div>
          <div style={{ fontSize: 11, color: muted, marginTop: 2, lineHeight: 1.45 }}>
            {state === 'subscribed' ? 'กด "ทดสอบ" เพื่อเช็คว่าแจ้งเตือนถึงเครื่องจริง'
              : state === 'denied'  ? 'เปิดจาก Android Settings → Apps → HOF88 → Notifications'
              : state === 'testing' ? 'รอผลการส่ง…'
              : 'กดเปิดเพื่อรับข่าวสารจากแอดมิน'}
          </div>
          {error && <div style={{ fontSize: 10, color: '#B4463A', marginTop: 3, wordBreak: 'break-word' }}>Error: {error}</div>}
        </div>
        {state === 'idle' && (
          <button onClick={subscribe} disabled={state === 'busy'} style={{
            padding: '8px 14px', borderRadius: 9, border: 'none',
            background: accent, color: accentInk,
            fontFamily: 'inherit', fontSize: 12, fontWeight: 600,
            cursor: 'pointer', whiteSpace: 'nowrap',
          }}>เปิดแจ้งเตือน</button>
        )}
        {(state === 'busy' || state === 'testing') && (
          <span style={{ fontSize: 11, color: muted }}>กำลังตั้งค่า…</span>
        )}
        {state === 'subscribed' && (
          <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
            <button onClick={runSelfTest} style={{
              padding: '7px 12px', borderRadius: 9, border: 'none',
              background: accent, color: accentInk,
              fontFamily: 'inherit', fontSize: 11, cursor: 'pointer', whiteSpace: 'nowrap',
            }}>ทดสอบ</button>
            <button onClick={unsubscribe} style={{
              padding: '7px 12px', borderRadius: 9,
              border: `1px solid ${border}`, background: surface, color: muted,
              fontFamily: 'inherit', fontSize: 11, cursor: 'pointer', whiteSpace: 'nowrap',
            }}>ปิด</button>
          </div>
        )}
      </div>

      {/* Diagnostic log — appears during subscribe/test flow. User can
          screenshot and send to admin for debugging. */}
      {(steps.length > 0 || error) && (
        <div style={{ marginTop: 8, padding: '10px 12px', borderRadius: 10,
          background: '#1F1B17', color: '#CFC8BC', border: `1px solid ${border}`,
          fontFamily: 'ui-monospace, monospace', fontSize: 10.5, lineHeight: 1.6,
          maxHeight: 260, overflowY: 'auto' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
            <span style={{ fontWeight: 700, color: '#C48B3E' }}>📋 Push diagnostic</span>
            <button onClick={() => setShowDiag(s => !s)} style={{
              marginLeft: 'auto', background: 'none', border: 'none',
              color: '#CFC8BC', fontSize: 10, cursor: 'pointer',
            }}>{showDiag ? 'ซ่อน' : 'แสดง'}</button>
          </div>
          {showDiag && steps.map((s, i) => (
            <div key={i}>{s.msg}</div>
          ))}
        </div>
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
