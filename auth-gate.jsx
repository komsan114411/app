// auth-gate.jsx — Admin login screen (shown when liveMode && !authed)

function AuthGate({ onSuccess }) {
  const [email, setEmail] = React.useState('');
  const [password, setPassword] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState(null);
  const [attempts, setAttempts] = React.useState(0);
  const [lockedUntil, setLockedUntil] = React.useState(0);

  const now = Date.now();
  const locked = lockedUntil > now;
  const lockSeconds = locked ? Math.ceil((lockedUntil - now) / 1000) : 0;

  // Client-side throttle (server enforces real lockout)
  React.useEffect(() => {
    if (!locked) return;
    const t = setInterval(() => setLockedUntil(v => v), 1000);
    return () => clearInterval(t);
  }, [locked]);

  const submit = async (e) => {
    e.preventDefault();
    if (busy || locked) return;
    setError(null);

    const emailClean = (email || '').trim().toLowerCase().slice(0, 254);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailClean)) {
      setError('อีเมลไม่ถูกต้อง'); return;
    }
    if (!password || password.length < 10) {
      setError('รหัสผ่านต้องอย่างน้อย 10 ตัวอักษร'); return;
    }
    if (password.length > 200) {
      setError('รหัสผ่านยาวเกินไป'); return;
    }

    setBusy(true);
    let succeeded = false;
    try {
      const user = await api.login(emailClean, password);
      succeeded = true;
      setAttempts(0);
      onSuccess?.(user);
    } catch (err) {
      const next = attempts + 1;
      setAttempts(next);
      if (next >= 5) setLockedUntil(Date.now() + 60_000);
      setError(friendly(err.message));
    } finally {
      // ALWAYS wipe password from React state — success OR failure.
      setPassword('');
      setBusy(false);
      if (!succeeded) {
        // Also clear the underlying <input> in case React retains a ref
        try {
          const el = document.querySelector('input[type="password"]');
          if (el) el.value = '';
        } catch {}
      }
    }
  };

  return (
    <div style={{
      minHeight: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: 'linear-gradient(180deg, #FBFAF7 0%, #F3EFE7 100%)',
      padding: 40, fontFamily: '"IBM Plex Sans Thai", system-ui',
    }}>
      <form onSubmit={submit} autoComplete="off" style={{
        width: 340, background: '#fff', borderRadius: 18, padding: 28,
        boxShadow: '0 20px 60px -20px rgba(0,0,0,0.15)',
        border: '1px solid rgba(0,0,0,0.06)',
      }}>
        <div style={{
          width: 44, height: 44, borderRadius: 12, background: '#1F1B17',
          color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center',
          margin: '0 auto 18px',
        }}>
          <Icon name="settings" size={22} stroke={1.8}/>
        </div>
        <div style={{ textAlign: 'center', marginBottom: 22 }}>
          <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 4 }}>Admin Console</div>
          <div style={{ fontSize: 12, color: '#6B6458' }}>เข้าสู่ระบบเพื่อจัดการเนื้อหา</div>
        </div>

        <label style={{ display: 'block', fontSize: 11, fontWeight: 600, color: '#3E3A34', marginBottom: 6 }}>อีเมล</label>
        <input
          type="email"
          value={email}
          onChange={e => setEmail(e.target.value.slice(0, 254))}
          required
          autoComplete="username"
          maxLength={254}
          disabled={busy || locked}
          style={inputStyle}
        />

        <label style={{ display: 'block', fontSize: 11, fontWeight: 600, color: '#3E3A34', margin: '14px 0 6px' }}>รหัสผ่าน</label>
        <input
          type="password"
          value={password}
          onChange={e => setPassword(e.target.value.slice(0, 200))}
          required
          autoComplete="current-password"
          minLength={10}
          maxLength={200}
          disabled={busy || locked}
          style={inputStyle}
        />

        {error && (
          <div style={{
            marginTop: 14, padding: '10px 12px', borderRadius: 9,
            background: 'rgba(180,70,58,0.08)', color: '#B4463A', fontSize: 12,
          }}>{error}</div>
        )}
        {locked && (
          <div style={{
            marginTop: 10, fontSize: 11, color: '#6B6458', textAlign: 'center',
          }}>รอ {lockSeconds} วินาที ก่อนลองอีกครั้ง</div>
        )}

        <button type="submit" disabled={busy || locked} style={{
          marginTop: 18, width: '100%', padding: '11px', borderRadius: 10,
          border: 'none', background: (busy || locked) ? '#8F877C' : '#1F1B17',
          color: '#fff', fontFamily: 'inherit', fontSize: 14, fontWeight: 600,
          cursor: (busy || locked) ? 'not-allowed' : 'pointer',
          transition: 'opacity 160ms ease',
        }}>
          {busy ? 'กำลังตรวจสอบ…' : locked ? 'ถูกระงับชั่วคราว' : 'เข้าสู่ระบบ'}
        </button>

        <div style={{ fontSize: 10, color: '#8F877C', textAlign: 'center', marginTop: 16, lineHeight: 1.5 }}>
          ระบบใช้ bcrypt + JWT rotation · ล็อกอัตโนมัติหลังใส่ผิด 10 ครั้ง
        </div>
      </form>
    </div>
  );
}

const inputStyle = {
  width: '100%', padding: '11px 12px', borderRadius: 9,
  border: '1px solid rgba(0,0,0,0.12)', background: '#fff',
  fontFamily: 'inherit', fontSize: 14, color: '#1F1B17',
  boxSizing: 'border-box', outline: 'none',
};

function friendly(code) {
  switch (code) {
    case 'invalid_credentials': return 'อีเมลหรือรหัสผ่านไม่ถูกต้อง';
    case 'account_locked':      return 'บัญชีถูกล็อคชั่วคราว ลองใหม่ภายหลัง';
    case 'rate_limited':        return 'พยายามมากเกินไป รอสักครู่';
    case 'request_failed':      return 'เชื่อมต่อเซิร์ฟเวอร์ไม่ได้';
    default:                    return 'ไม่สามารถเข้าสู่ระบบได้';
  }
}

window.AuthGate = AuthGate;
