// twofa-setup.jsx — Card that walks admin through TOTP setup / disable.

function TwoFactorSetup({ me, onChanged }) {
  const [stage, setStage] = React.useState(me?.totpEnabled ? 'enabled' : 'idle');
  const [qr, setQr] = React.useState(null);
  const [secret, setSecret] = React.useState('');
  const [code, setCode] = React.useState('');
  const [backupCodes, setBackupCodes] = React.useState(null);
  const [disablePw, setDisablePw] = React.useState('');
  const [busy, setBusy] = React.useState(false);

  const begin = async () => {
    setBusy(true);
    try {
      const data = await api.call('/api/admin/me/totp/setup', { method: 'POST', auth: true });
      setQr(data.qr); setSecret(data.secret);
      setStage('scan');
    } catch (e) { toast.error('ไม่สามารถเริ่มตั้งค่าได้'); }
    finally { setBusy(false); }
  };

  const verify = async () => {
    if (!/^\d{6}$/.test(code)) { toast.error('ใส่โค้ด 6 หลัก'); return; }
    setBusy(true);
    try {
      const r = await api.call('/api/admin/me/totp/enable', { method: 'POST', body: { code }, auth: true });
      setBackupCodes(r.backupCodes || []);
      setStage('backup');
      onChanged?.();
      toast.success('เปิดใช้งาน 2FA สำเร็จ');
    } catch (e) {
      toast.error(friendly2faError(e.message));
      if (e.message === 'setup_expired') { setStage('idle'); setQr(null); setSecret(''); }
    }
    finally { setBusy(false); setCode(''); }
  };

  const [disableArmed, setDisableArmed] = React.useState(false);
  const disableTimer = React.useRef(null);
  React.useEffect(() => () => clearTimeout(disableTimer.current), []);

  const disable = async () => {
    if (!disablePw) { toast.error('ใส่รหัสผ่านปัจจุบัน'); return; }
    if (!disableArmed) {
      setDisableArmed(true);
      clearTimeout(disableTimer.current);
      disableTimer.current = setTimeout(() => setDisableArmed(false), 3000);
      return;
    }
    setDisableArmed(false);
    clearTimeout(disableTimer.current);
    setBusy(true);
    try {
      await api.call('/api/admin/me/totp/disable', { method: 'POST', body: { password: disablePw }, auth: true });
      toast.success('ปิด 2FA แล้ว');
      onChanged?.();
      setStage('idle');
    } catch (e) { toast.error(friendly2faError(e.message)); }
    finally { setBusy(false); setDisablePw(''); }
  };

  const copyCodes = () => {
    const text = (backupCodes || []).join('\n');
    const done = () => toast.success('คัดลอก backup codes แล้ว');
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(done).catch(() => fallbackCopy(text, done));
    } else { fallbackCopy(text, done); }
  };

  const downloadCodes = () => {
    try {
      const header = [
        '# 2FA Backup Codes',
        '# Account: ' + (me?.loginId || ''),
        '# Created: ' + new Date().toISOString(),
        '# Each code works ONCE. Store in a safe place (password manager / printed).',
        '',
      ].join('\n');
      const body = (backupCodes || []).join('\n');
      const blob = new Blob([header + body + '\n'], { type: 'text/plain;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `backup-codes-${me?.loginId || 'user'}-${new Date().toISOString().slice(0,10)}.txt`;
      document.body.appendChild(a);
      a.click();
      setTimeout(() => { try { document.body.removeChild(a); URL.revokeObjectURL(url); } catch {} }, 100);
      toast.success('ดาวน์โหลดแล้ว — เก็บไฟล์ในที่ปลอดภัย');
    } catch { toast.error('ดาวน์โหลดไม่สำเร็จ'); }
  };

  const printCodes = () => {
    try {
      const w = window.open('', '_blank', 'width=560,height=720');
      if (!w) { toast.error('เบราว์เซอร์บล็อกหน้าต่างใหม่'); return; }
      const escHtml = (s) => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
      const rows = (backupCodes || []).map(c => `<li><code>${escHtml(c)}</code></li>`).join('');
      w.document.write(`<!doctype html><html><head><title>2FA Backup Codes</title>
<style>body{font-family:system-ui;padding:30px;max-width:460px}
h1{font-size:18px}code{font-family:ui-monospace,monospace;font-size:14px;padding:2px 6px;background:#f0ead8;border-radius:4px}
ol{columns:2;gap:20px}li{margin-bottom:8px}
.warn{background:#fff6d6;border:1px solid #e5c97b;border-radius:8px;padding:10px;font-size:12px;margin-bottom:16px}
</style></head><body>
<h1>2FA Backup Codes</h1>
<div class="warn">Account: <strong>${escHtml(me?.loginId || '')}</strong><br/>
Created: ${new Date().toLocaleString()}<br/>
<strong>⚠ Each code works ONCE.</strong> Store securely. Do not share.</div>
<ol>${rows}</ol>
<script>window.onload=()=>setTimeout(()=>window.print(),300);</script>
</body></html>`);
      w.document.close();
    } catch { toast.error('เปิดหน้าต่างพิมพ์ไม่สำเร็จ'); }
  };

  return (
    <Card style={{ padding: 18 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
        <div style={{ fontSize: 14, fontWeight: 700 }}>ยืนยันตัวตน 2 ขั้น (TOTP)</div>
        {me?.totpEnabled
          ? <span style={{ padding: '2px 8px', borderRadius: 999, background: 'rgba(6,199,85,0.12)', color: '#058850', fontSize: 10, fontWeight: 600 }}>เปิดอยู่</span>
          : <span style={{ padding: '2px 8px', borderRadius: 999, background: '#F3EFE7', color: '#6B6458', fontSize: 10, fontWeight: 600 }}>ยังไม่ได้เปิด</span>}
      </div>
      <div style={{ fontSize: 12, color: '#6B6458', lineHeight: 1.55, marginBottom: 14 }}>
        ใช้แอป Google Authenticator, Authy หรือ 1Password สแกน QR ตอนเปิด 2FA · ถ้ารหัสรั่ว บัญชีก็ยังปลอดภัย
      </div>

      {stage === 'idle' && !me?.totpEnabled && (
        <button onClick={begin} disabled={busy} style={primaryBtn}>{busy ? 'กำลังโหลด…' : 'เปิดใช้งาน 2FA'}</button>
      )}

      {stage === 'scan' && qr && (
        <div>
          <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginBottom: 12 }}>
            <img src={qr} alt="qr" style={{ width: 160, height: 160, borderRadius: 10, border: '1px solid rgba(0,0,0,0.08)' }}/>
            <div style={{ flex: 1, minWidth: 200 }}>
              <div style={{ fontSize: 11, color: '#6B6458', marginBottom: 4 }}>หรือใส่ secret ด้วยตนเอง:</div>
              <div style={{ fontFamily: 'ui-monospace, monospace', fontSize: 12, background: '#F3EFE7', padding: '8px 10px', borderRadius: 8, wordBreak: 'break-all' }}>{secret}</div>
            </div>
          </div>
          <div style={{ fontSize: 12, marginBottom: 6 }}>ใส่โค้ด 6 หลักจากแอปเพื่อยืนยัน:</div>
          <div style={{ display: 'flex', gap: 8 }}>
            <input type="text" inputMode="numeric" pattern="\d*" maxLength={6}
              value={code} onChange={e => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
              placeholder="000000" style={{ ...pwInput, flex: 1, letterSpacing: 2, fontFamily: 'ui-monospace, monospace' }}/>
            <button onClick={verify} disabled={busy || code.length !== 6} style={primaryBtn}>
              {busy ? 'ยืนยัน…' : 'ยืนยัน'}
            </button>
          </div>
        </div>
      )}

      {stage === 'backup' && backupCodes && (
        <div>
          <div style={{ padding: '10px 12px', borderRadius: 9, background: 'rgba(210,150,40,0.1)', color: '#7A5A10', fontSize: 12, marginBottom: 10 }}>
            <strong>Backup codes</strong> — เก็บไว้ในที่ปลอดภัย. ใช้แทน TOTP เมื่อมือถือหาย. <b>ไม่แสดงซ้ำ</b>
          </div>
          <div style={{
            display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6,
            fontFamily: 'ui-monospace, monospace', fontSize: 13,
            padding: 12, background: '#F3EFE7', borderRadius: 10, marginBottom: 10,
          }}>
            {backupCodes.map((c, i) => <div key={i}>{c}</div>)}
          </div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            <button onClick={copyCodes} style={pillBtn}>📋 คัดลอก</button>
            <button onClick={downloadCodes} style={pillBtn}>⬇ ดาวน์โหลด (.txt)</button>
            <button onClick={printCodes} style={pillBtn}>🖨 พิมพ์</button>
            <button onClick={() => { setBackupCodes(null); setStage('enabled'); }} style={primaryBtn}>เสร็จสิ้น</button>
          </div>
        </div>
      )}

      {(stage === 'enabled' || me?.totpEnabled) && stage !== 'backup' && stage !== 'scan' && (
        <div>
          <div style={{ fontSize: 12, color: '#6B6458', marginBottom: 10 }}>ต้องการปิด 2FA? ใส่รหัสผ่านปัจจุบัน</div>
          <div style={{ display: 'flex', gap: 8 }}>
            <input type="password" value={disablePw} onChange={e => setDisablePw(e.target.value.slice(0, 200))}
              autoComplete="current-password" placeholder="รหัสผ่านปัจจุบัน"
              style={{ ...pwInput, flex: 1 }}/>
            <button onClick={disable} disabled={busy} style={{
              ...pillBtn,
              background: disableArmed ? '#B4463A' : '#fff',
              color: disableArmed ? '#fff' : '#B4463A',
              borderColor: disableArmed ? '#B4463A' : 'rgba(0,0,0,0.12)',
            }}>
              {busy ? '...' : disableArmed ? '✓ ยืนยันปิด 2FA?' : 'ปิด 2FA'}
            </button>
          </div>
        </div>
      )}
    </Card>
  );
}

const primaryBtn = {
  padding: '10px 18px', borderRadius: 9, border: 'none',
  background: '#1F1B17', color: '#fff',
  fontFamily: 'inherit', fontSize: 13, fontWeight: 600, cursor: 'pointer',
};
const pillBtn = {
  padding: '9px 14px', borderRadius: 9, border: '1px solid rgba(0,0,0,0.12)',
  background: '#fff',
  fontFamily: 'inherit', fontSize: 12, cursor: 'pointer',
};
const pwInput = {
  width: '100%', padding: '9px 12px', borderRadius: 9,
  border: '1px solid rgba(0,0,0,0.12)', background: '#fff',
  fontFamily: 'inherit', fontSize: 13, color: '#1F1B17',
  boxSizing: 'border-box', outline: 'none',
};

function fallbackCopy(text, onOk) {
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed'; ta.style.top = '-9999px';
    document.body.appendChild(ta); ta.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(ta);
    if (ok) onOk?.(); else toast.error('คัดลอกไม่สำเร็จ — กรุณากดดาวน์โหลดแทน');
  } catch { toast.error('คัดลอกไม่สำเร็จ — กรุณากดดาวน์โหลดแทน'); }
}

function friendly2faError(code) {
  switch (code) {
    case 'invalid_totp':       return 'โค้ดไม่ถูกต้อง';
    case 'no_pending_setup':   return 'ไม่พบการตั้งค่าค้างอยู่';
    case 'setup_expired':      return 'การตั้งค่า 2FA หมดอายุ (15 นาที) — เริ่มใหม่';
    case 'already_enabled':    return '2FA เปิดใช้อยู่แล้ว';
    case 'invalid_credentials':return 'รหัสผ่านไม่ถูกต้อง';
    default:                   return 'ดำเนินการไม่สำเร็จ';
  }
}

window.TwoFactorSetup = TwoFactorSetup;
