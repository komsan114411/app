// auth-gate.jsx — Admin login screen (shown when liveMode && !authed).
// Supports: default-fill, TOTP step, backup code fallback, forgot password,
// Turnstile captcha widget (if TURNSTILE_SITE_KEY is set on window).

function AuthGate({ onSuccess }) {
  const [loginId, setLoginId] = React.useState('');
  const [password, setPassword] = React.useState('');
  const [totpCode, setTotpCode] = React.useState('');
  const [useBackup, setUseBackup] = React.useState(false);
  const [backupCode, setBackupCode] = React.useState('');
  const [needsTotp, setNeedsTotp] = React.useState(false);
  const [captchaToken, setCaptchaToken] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState(null);
  const [attempts, setAttempts] = React.useState(0);
  const [lockedUntil, setLockedUntil] = React.useState(0);
  const [showForgot, setShowForgot] = React.useState(false);

  // Detect pending password-reset token from URL ("?reset=XYZ") and switch views
  const [resetToken, setResetToken] = React.useState(() => {
    try {
      const u = new URL(location.href);
      return u.searchParams.get('reset') || '';
    } catch { return ''; }
  });

  const now = Date.now();
  const locked = lockedUntil > now;
  const lockSeconds = locked ? Math.ceil((lockedUntil - now) / 1000) : 0;

  React.useEffect(() => {
    if (!locked) return;
    const t = setInterval(() => setLockedUntil(v => v), 1000);
    return () => clearInterval(t);
  }, [locked]);

  // Turnstile widget loader (opt-in via window.TURNSTILE_SITE_KEY)
  const tsRef = React.useRef(null);
  React.useEffect(() => {
    const key = window.TURNSTILE_SITE_KEY;
    if (!key) return;
    if (!document.getElementById('turnstile-sdk')) {
      const s = document.createElement('script');
      s.id = 'turnstile-sdk';
      s.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js';
      s.async = true; s.defer = true;
      document.head.appendChild(s);
    }
    window.onTurnstileOk = (token) => setCaptchaToken(token);
  }, []);

  if (resetToken) {
    return <ResetPasswordForm token={resetToken} onDone={() => { setResetToken(''); history.replaceState(null, '', location.pathname); }}/>;
  }

  if (showForgot) {
    return <ForgotPasswordForm onClose={() => setShowForgot(false)}/>;
  }

  const submit = async (e) => {
    e.preventDefault();
    if (busy || locked) return;
    setError(null);

    const id = (loginId || '').trim().toLowerCase().slice(0, 64);
    if (!/^[a-z0-9._@-]{3,64}$/.test(id)) { setError('Login ID ไม่ถูกต้อง'); return; }
    if (!password) { setError('กรอกรหัสผ่าน'); return; }
    if (needsTotp && !totpCode && !backupCode) { setError('ใส่โค้ด 2FA'); return; }

    setBusy(true);
    let succeeded = false;
    try {
      const body = { loginId: id, password };
      if (totpCode) body.totpCode = totpCode;
      if (backupCode) body.backupCode = backupCode;
      if (captchaToken) body.captchaToken = captchaToken;
      const user = await api.login(body);
      succeeded = true;
      setAttempts(0);
      onSuccess?.(user);
    } catch (err) {
      if (err.message === 'totp_required') {
        setNeedsTotp(true);
        setError('บัญชีนี้เปิด 2FA ไว้ — ใส่โค้ด 6 หลัก');
        return;
      }
      const next = attempts + 1;
      setAttempts(next);
      if (next >= 5) setLockedUntil(Date.now() + 60_000);
      setError(friendly(err.message));
    } finally {
      setPassword('');
      if (!succeeded) {
        try { const el = document.querySelector('input[type="password"]'); if (el) el.value = ''; } catch {}
      }
      setBusy(false);
    }
  };

  return (
    <div style={{
      minHeight: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: 'linear-gradient(180deg, #FBFAF7 0%, #F3EFE7 100%)',
      padding: 40, fontFamily: '"IBM Plex Sans Thai", system-ui',
      position: 'relative', overflow: 'hidden',
    }}>
      {/* Ambient accent glow behind the login card — slow breathing pulse */}
      <div className="ad-auth-glow"/>
      <form onSubmit={submit} autoComplete="off" className="ad-auth-wrap" style={{
        position: 'relative', zIndex: 1,
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

        <label style={authLabel}>Login ID</label>
        <input type="text" value={loginId} onChange={e => setLoginId(e.target.value.slice(0, 64))}
          required autoComplete="username" autoCapitalize="off" autoCorrect="off" spellCheck={false}
          maxLength={64} placeholder="" disabled={busy || locked || needsTotp}
          style={inputStyle}/>

        <label style={{ ...authLabel, marginTop: 14 }}>รหัสผ่าน</label>
        <input type="password" value={password} onChange={e => setPassword(e.target.value.slice(0, 200))}
          required autoComplete="current-password" minLength={1} maxLength={200}
          placeholder="" disabled={busy || locked || needsTotp}
          style={inputStyle}/>

        {needsTotp && !useBackup && (
          <>
            <label style={{ ...authLabel, marginTop: 14 }}>รหัส 2FA (6 หลัก)</label>
            <input type="text" inputMode="numeric" pattern="\d*"
              value={totpCode} onChange={e => setTotpCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
              maxLength={6} placeholder="000000" autoFocus
              style={{ ...inputStyle, letterSpacing: 2, fontFamily: 'ui-monospace, monospace' }}/>
            <button type="button" onClick={() => setUseBackup(true)} style={linkBtn}>
              ใช้ backup code แทน
            </button>
          </>
        )}
        {needsTotp && useBackup && (
          <>
            <label style={{ ...authLabel, marginTop: 14 }}>Backup code</label>
            <input type="text" value={backupCode} onChange={e => setBackupCode(e.target.value.slice(0, 24))}
              placeholder="xxxx-xxxx-xxxx-xxxx" autoFocus style={{ ...inputStyle, fontFamily: 'ui-monospace, monospace' }}/>
            <button type="button" onClick={() => setUseBackup(false)} style={linkBtn}>
              ใช้ TOTP แทน
            </button>
          </>
        )}

        {window.TURNSTILE_SITE_KEY && (
          <div style={{ marginTop: 12 }}>
            <div ref={tsRef} className="cf-turnstile" data-sitekey={window.TURNSTILE_SITE_KEY} data-callback="onTurnstileOk"/>
          </div>
        )}

        {error && (
          <div style={{ marginTop: 14, padding: '10px 12px', borderRadius: 9,
            background: 'rgba(180,70,58,0.08)', color: '#B4463A', fontSize: 12 }}>{error}</div>
        )}
        {locked && (
          <div style={{ marginTop: 10, fontSize: 11, color: '#6B6458', textAlign: 'center' }}>
            รอ {lockSeconds} วินาที ก่อนลองอีกครั้ง
          </div>
        )}

        <button type="submit" disabled={busy || locked} style={{
          marginTop: 18, width: '100%', padding: '11px', borderRadius: 10,
          border: 'none', background: (busy || locked) ? '#8F877C' : '#1F1B17',
          color: '#fff', fontFamily: 'inherit', fontSize: 14, fontWeight: 600,
          cursor: (busy || locked) ? 'not-allowed' : 'pointer',
          display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10,
        }}>
          {busy && <span className="ad-spin ad-spin-sm" style={{ background: 'conic-gradient(from 0deg, transparent 0deg, #fff 280deg, transparent 360deg)' }}/>}
          {busy ? 'กำลังตรวจสอบ…' : locked ? 'ถูกระงับชั่วคราว' : needsTotp ? 'ยืนยัน 2FA' : 'เข้าสู่ระบบ'}
        </button>

        {!needsTotp && (
          <div style={{ textAlign: 'center', marginTop: 14 }}>
            <button type="button" onClick={() => setShowForgot(true)} style={linkBtn}>ลืมรหัสผ่าน?</button>
          </div>
        )}

        <div style={{ fontSize: 10, color: '#8F877C', textAlign: 'center', marginTop: 18, lineHeight: 1.5 }}>
          argon2id · JWT rotation · ล็อกอัตโนมัติหลังผิด 10 ครั้ง
        </div>
      </form>
    </div>
  );
}

function ForgotPasswordForm({ onClose }) {
  const [loginId, setLoginId] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [done, setDone] = React.useState(false);
  const [err, setErr] = React.useState(null);
  const [emailAvailable, setEmailAvailable] = React.useState(true);

  // Probe capability before showing form so we can warn up-front
  React.useEffect(() => {
    (async () => {
      try {
        const cfg = await api.getConfig();
        if (cfg && cfg.capabilities && cfg.capabilities.emailReset === false) {
          setEmailAvailable(false);
        }
      } catch {}
    })();
  }, []);

  const submit = async (e) => {
    e.preventDefault();
    setErr(null);
    setBusy(true);
    try {
      // Use raw fetch so we can read response headers
      const res = await fetch('/api/auth/forgot-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': (typeof readCookie === 'function' ? (readCookie('__Secure-XSRF-TOKEN') || readCookie('XSRF-TOKEN') || '') : '') },
        body: JSON.stringify({ loginId }),
        credentials: 'include',
      });
      if (res.status === 429) { setErr('ขอลิงก์บ่อยเกินไป รอสักครู่'); return; }
      if (res.headers.get('X-Email-Available') === '0') setEmailAvailable(false);
      setDone(true);
    } catch {
      setErr('เชื่อมต่อเซิร์ฟเวอร์ไม่ได้');
    }
    finally { setBusy(false); }
  };

  return (
    <div style={{ minHeight: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 40,
      background: 'linear-gradient(180deg, #FBFAF7 0%, #F3EFE7 100%)', fontFamily: '"IBM Plex Sans Thai", system-ui' }}>
      <form onSubmit={submit} style={{ width: 360, background: '#fff', borderRadius: 18, padding: 28,
        boxShadow: '0 20px 60px -20px rgba(0,0,0,0.15)' }}>
        <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 8 }}>ลืมรหัสผ่าน</div>
        {!emailAvailable && (
          <div style={{ padding: '10px 12px', borderRadius: 9, background: 'rgba(210,150,40,0.12)', color: '#7A5A10', fontSize: 12, lineHeight: 1.5, marginBottom: 12 }}>
            <strong>การส่งอีเมลยังไม่ได้ตั้งค่า</strong><br/>
            เซิร์ฟเวอร์นี้ยังไม่ได้ตั้ง SMTP_HOST — การขอรีเซ็ตจะ <u>ไม่ส่งอีเมลจริง</u>.
            ติดต่อ admin เพื่อรีเซ็ตด้วยตนเอง หรือให้ admin ตั้งค่า SMTP ก่อน
          </div>
        )}
        {done ? (
          <>
            <div style={{ fontSize: 12, color: '#6B6458', lineHeight: 1.55, marginBottom: 16 }}>
              {emailAvailable
                ? 'หากมีบัญชีตรงกับอีเมลที่ตั้งไว้ ระบบส่งลิงก์รีเซ็ตให้แล้ว (มีอายุ 30 นาที)'
                : <>ระบบรับคำขอแล้ว แต่ <strong>ไม่ได้ส่งอีเมลจริง</strong> เพราะ SMTP ยังไม่ได้ตั้งค่า · ติดต่อ admin</>}
            </div>
            <button onClick={onClose} style={{ width: '100%', padding: '10px', borderRadius: 9, border: 'none',
              background: '#1F1B17', color: '#fff', fontFamily: 'inherit', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
              กลับสู่หน้าเข้าสู่ระบบ
            </button>
          </>
        ) : (
          <>
            <div style={{ fontSize: 12, color: '#6B6458', marginBottom: 14 }}>
              ใส่ Login ID — ถ้าบัญชีมีอีเมลผูกไว้ ระบบจะส่งลิงก์ไปที่อีเมลนั้น
            </div>
            <label style={authLabel}>Login ID</label>
            <input type="text" value={loginId} onChange={e => setLoginId(e.target.value.slice(0, 64))}
              required style={inputStyle}/>
            {err && <div style={{ marginTop: 10, padding: '8px 10px', borderRadius: 8, background: 'rgba(180,70,58,0.08)', color: '#B4463A', fontSize: 12 }}>{err}</div>}
            <div style={{ display: 'flex', gap: 6, marginTop: 14 }}>
              <button type="button" onClick={onClose} style={{ flex: 1, padding: '10px', borderRadius: 9,
                border: '1px solid rgba(0,0,0,0.12)', background: '#fff', fontFamily: 'inherit', fontSize: 13, cursor: 'pointer' }}>ยกเลิก</button>
              <button type="submit" disabled={busy || !loginId.trim()} style={{ flex: 1, padding: '10px', borderRadius: 9, border: 'none',
                background: (busy || !loginId.trim()) ? '#8F877C' : '#1F1B17', color: '#fff', fontFamily: 'inherit', fontSize: 13, fontWeight: 600, cursor: (busy || !loginId.trim()) ? 'not-allowed' : 'pointer' }}>
                {busy ? 'กำลังส่ง…' : 'ส่งลิงก์'}
              </button>
            </div>
          </>
        )}
      </form>
    </div>
  );
}

function ResetPasswordForm({ token, onDone }) {
  const [pw, setPw] = React.useState('');
  const [pw2, setPw2] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [err, setErr] = React.useState(null);
  const [ok, setOk] = React.useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setErr(null);
    if (pw !== pw2) { setErr('รหัสใหม่ไม่ตรงกัน'); return; }
    if (pw.length < 12) { setErr('รหัสต้องยาวอย่างน้อย 12 ตัว'); return; }
    setBusy(true);
    try {
      await api.call('/api/auth/reset-password', { method: 'POST', body: { token, newPassword: pw } });
      setOk(true);
    } catch (e) {
      setErr(e.message === 'invalid_token' ? 'ลิงก์ไม่ถูกต้องหรือหมดอายุแล้ว' :
             e.message === 'weak' ? 'รหัสผ่านไม่แข็งแรงพอ' :
             e.message === 'breached' ? 'รหัสนี้เคยรั่วไหล' :
             'รีเซ็ตไม่สำเร็จ');
    } finally { setBusy(false); setPw(''); setPw2(''); }
  };

  return (
    <div style={{ minHeight: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 40,
      background: 'linear-gradient(180deg, #FBFAF7 0%, #F3EFE7 100%)', fontFamily: '"IBM Plex Sans Thai", system-ui' }}>
      <form onSubmit={submit} style={{ width: 360, background: '#fff', borderRadius: 18, padding: 28,
        boxShadow: '0 20px 60px -20px rgba(0,0,0,0.15)' }}>
        <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 14 }}>ตั้งรหัสผ่านใหม่</div>
        {ok ? (
          <>
            <div style={{ fontSize: 12, color: '#058850', lineHeight: 1.55, marginBottom: 14 }}>
              ตั้งรหัสใหม่สำเร็จ · ไปเข้าสู่ระบบต่อได้เลย
            </div>
            <button onClick={onDone} style={{ width: '100%', padding: '10px', borderRadius: 9, border: 'none',
              background: '#1F1B17', color: '#fff', fontFamily: 'inherit', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
              เข้าสู่ระบบ
            </button>
          </>
        ) : (
          <>
            <label style={authLabel}>รหัสผ่านใหม่ (อย่างน้อย 12 ตัว)</label>
            <input type="password" value={pw} onChange={e => setPw(e.target.value.slice(0, 200))}
              required autoComplete="new-password" minLength={12} maxLength={200} style={inputStyle}/>
            <label style={{ ...authLabel, marginTop: 14 }}>ยืนยันรหัสผ่านใหม่</label>
            <input type="password" value={pw2} onChange={e => setPw2(e.target.value.slice(0, 200))}
              required autoComplete="new-password" style={inputStyle}/>
            {err && <div style={{ marginTop: 12, padding: '10px 12px', borderRadius: 9,
              background: 'rgba(180,70,58,0.08)', color: '#B4463A', fontSize: 12 }}>{err}</div>}
            <button type="submit" disabled={busy} style={{
              marginTop: 16, width: '100%', padding: '11px', borderRadius: 10,
              border: 'none', background: busy ? '#8F877C' : '#1F1B17', color: '#fff',
              fontFamily: 'inherit', fontSize: 14, fontWeight: 600, cursor: busy ? 'not-allowed' : 'pointer',
            }}>{busy ? 'กำลังบันทึก…' : 'ตั้งรหัสใหม่'}</button>
          </>
        )}
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
const authLabel = { display: 'block', fontSize: 11, fontWeight: 600, color: '#3E3A34', marginBottom: 6 };
const linkBtn = {
  marginTop: 6, background: 'none', border: 'none', color: '#6B6458',
  textDecoration: 'underline', cursor: 'pointer', fontSize: 11, padding: 0, fontFamily: 'inherit',
};

function friendly(code) {
  switch (code) {
    case 'invalid_credentials': return 'Login ID หรือรหัสผ่านไม่ถูกต้อง';
    case 'account_locked':      return 'บัญชีถูกล็อคชั่วคราว ลองใหม่ภายหลัง';
    case 'rate_limited':        return 'พยายามมากเกินไป รอสักครู่';
    case 'invalid_totp':        return 'โค้ด 2FA ไม่ถูกต้อง';
    case 'captcha_required':    return 'ยืนยันว่าเป็นมนุษย์ก่อน';
    case 'captcha_invalid':     return 'CAPTCHA ไม่ผ่าน — ลองอีกครั้ง';
    case 'request_failed':      return 'เชื่อมต่อเซิร์ฟเวอร์ไม่ได้';
    default:                    return 'ไม่สามารถเข้าสู่ระบบได้';
  }
}

window.AuthGate = AuthGate;
