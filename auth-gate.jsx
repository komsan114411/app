// auth-gate.jsx — Admin login screen (shown when liveMode && !authed)

function AuthGate({ onSuccess }) {
  const [loginId, setLoginId] = React.useState('');
  const [password, setPassword] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState(null);
  const [attempts, setAttempts] = React.useState(0);
  const [lockedUntil, setLockedUntil] = React.useState(0);

  const now = Date.now();
  const locked = lockedUntil > now;
  const lockSeconds = locked ? Math.ceil((lockedUntil - now) / 1000) : 0;

  React.useEffect(() => {
    if (!locked) return;
    const t = setInterval(() => setLockedUntil(v => v), 1000);
    return () => clearInterval(t);
  }, [locked]);

  const submit = async (e) => {
    e.preventDefault();
    if (busy || locked) return;
    setError(null);

    const id = (loginId || '').trim().toLowerCase().slice(0, 64);
    if (!/^[a-z0-9._@-]{3,64}$/.test(id)) {
      setError('Login ID ใช้ได้แค่ a–z 0–9 . _ - @ (3–64 ตัว)'); return;
    }
    if (!password || password.length < 1) {
      setError('กรอกรหัสผ่าน'); return;
    }
    if (password.length > 200) {
      setError('รหัสผ่านยาวเกินไป'); return;
    }

    setBusy(true);
    let succeeded = false;
    try {
      const user = await api.login(id, password);
      succeeded = true;
      setAttempts(0);
      onSuccess?.(user);
    } catch (err) {
      const next = attempts + 1;
      setAttempts(next);
      if (next >= 5) setLockedUntil(Date.now() + 60_000);
      setError(friendly(err.message));
    } finally {
      setPassword('');
      setBusy(false);
      if (!succeeded) {
        try {
          const el = document.querySelector('input[type="password"]');
          if (el) el.value = '';
        } catch {}
      }
    }
  };

  const fillDefault = () => {
    setLoginId('admin123');
    setPassword('admin123');
  };

  return (
    <div style={{
      minHeight: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: 'linear-gradient(180deg, #FBFAF7 0%, #F3EFE7 100%)',
      padding: 40, fontFamily: '"IBM Plex Sans Thai", system-ui',
    }}>
      <form onSubmit={submit} autoComplete="off" style={{
        width: 360, background: '#fff', borderRadius: 18, padding: 28,
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

        <label style={{ display: 'block', fontSize: 11, fontWeight: 600, color: '#3E3A34', marginBottom: 6 }}>Login ID</label>
        <input
          type="text"
          value={loginId}
          onChange={e => setLoginId(e.target.value.slice(0, 64))}
          required
          autoComplete="username"
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          maxLength={64}
          placeholder="admin123"
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
          minLength={1}
          maxLength={200}
          placeholder="admin123"
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

        <div style={{
          marginTop: 16, padding: '10px 12px', borderRadius: 9,
          background: 'rgba(210,150,40,0.1)', border: '1px dashed rgba(210,150,40,0.4)',
          fontSize: 11, color: '#7A5A10', lineHeight: 1.55,
        }}>
          <strong>เปิดใช้ครั้งแรก:</strong> Login ID <code>admin123</code> รหัส <code>admin123</code>
          <button type="button" onClick={fillDefault} disabled={busy || locked} style={{
            marginLeft: 6, padding: '2px 8px', borderRadius: 5,
            border: '1px solid rgba(210,150,40,0.5)', background: 'rgba(255,255,255,0.7)',
            fontFamily: 'inherit', fontSize: 10, cursor: 'pointer', color: '#7A5A10',
          }}>เติมให้</button>
          <br/>
          <span style={{ opacity: 0.8 }}>ระบบจะบังคับเปลี่ยนรหัสทันทีหลังเข้าระบบ</span>
        </div>

        <div style={{ fontSize: 10, color: '#8F877C', textAlign: 'center', marginTop: 14, lineHeight: 1.5 }}>
          argon2id · JWT rotation · ล็อกอัตโนมัติหลังผิด 10 ครั้ง
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
    case 'invalid_credentials': return 'Login ID หรือรหัสผ่านไม่ถูกต้อง';
    case 'account_locked':      return 'บัญชีถูกล็อคชั่วคราว ลองใหม่ภายหลัง';
    case 'rate_limited':        return 'พยายามมากเกินไป รอสักครู่';
    case 'request_failed':      return 'เชื่อมต่อเซิร์ฟเวอร์ไม่ได้';
    default:                    return 'ไม่สามารถเข้าสู่ระบบได้';
  }
}

window.AuthGate = AuthGate;
