// system-status.jsx — System health banner shown on the admin dashboard.
// Calls /api/admin/health/features and surfaces any features that are
// disabled, broken, or need attention. Gives operators immediate visibility
// into what's not wired up without having to read server logs.

function SystemStatusBanner({ compact = false }) {
  const [data, setData] = React.useState(null);
  const [error, setError] = React.useState(null);
  const [expanded, setExpanded] = React.useState(!compact);
  const [dismissed, setDismissed] = React.useState(() => {
    try { return localStorage.getItem('sysStatusDismissedAt') || ''; } catch { return ''; }
  });

  const load = React.useCallback(async () => {
    try {
      const r = await api.call('/api/admin/health/features', { auth: true });
      setData(r); setError(null);
    } catch (e) { setError(e.message || 'load_failed'); }
  }, []);

  React.useEffect(() => {
    load();
    const id = setInterval(load, 60_000);
    return () => clearInterval(id);
  }, [load]);

  if (error) {
    return (
      <div style={errBanner}>
        <Icon name="x" size={14} stroke={2}/>
        โหลดสถานะระบบไม่สำเร็จ — กรุณาดูใน server log
      </div>
    );
  }
  if (!data) return null;

  const problems = data.features.filter(f => f.severity === 'warn' || f.severity === 'error');
  const disabled = data.features.filter(f => f.status === 'disabled' && f.severity === 'info');

  if (problems.length === 0 && disabled.length === 0) {
    return compact ? null : (
      <div style={okBanner}>
        <Icon name="check" size={14} stroke={2.2}/>
        ระบบทำงานครบถ้วน — {data.summary.ok}/{data.summary.total} ฟีเจอร์พร้อมใช้งาน
      </div>
    );
  }

  // Compact mode: hide if user dismissed within last 24h
  if (compact && dismissed) {
    const age = Date.now() - Number(dismissed);
    if (age < 24 * 60 * 60 * 1000) return null;
  }

  const hasError = problems.some(p => p.severity === 'error');
  const tone = hasError ? 'error' : 'warn';
  const palette = tone === 'error'
    ? { bg: 'rgba(180,70,58,0.08)', border: 'rgba(180,70,58,0.3)', ink: '#B4463A' }
    : { bg: 'rgba(210,150,40,0.1)', border: 'rgba(210,150,40,0.4)', ink: '#7A5A10' };

  const dismiss = () => {
    const t = String(Date.now());
    try { localStorage.setItem('sysStatusDismissedAt', t); } catch {}
    setDismissed(t);
  };

  return (
    <div style={{
      marginBottom: 14, borderRadius: 11, padding: '12px 14px',
      background: palette.bg, border: `1px solid ${palette.border}`, color: palette.ink,
      fontSize: 12,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <Icon name={hasError ? 'x' : 'settings'} size={15} stroke={2}/>
        <strong style={{ flex: 1, minWidth: 200 }}>
          {hasError
            ? 'ระบบมีปัญหา ' + problems.filter(p => p.severity === 'error').length + ' รายการ'
            : 'ฟีเจอร์ที่ยังไม่ครบ ' + (problems.length + disabled.length) + ' รายการ'}
        </strong>
        <button onClick={() => setExpanded(v => !v)} style={toggleBtn(palette)}>
          {expanded ? 'ซ่อน' : 'ดูรายละเอียด'}
        </button>
        {compact && (
          <button onClick={dismiss} title="ปิดไว้ 24 ชม" style={{ ...toggleBtn(palette), padding: '4px 8px' }}>
            <Icon name="x" size={11} stroke={2}/>
          </button>
        )}
      </div>
      {expanded && (
        <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 8 }}>
          {[...problems, ...disabled].map(f => <FeatureRow key={f.id} feature={f}/>)}
          <div style={{ fontSize: 10, opacity: 0.7, marginTop: 4 }}>
            อัปเดตอัตโนมัติทุก 60 วินาที · ตรวจ env vars บน Railway/Render → restart service
          </div>
        </div>
      )}
    </div>
  );
}

function FeatureRow({ feature }) {
  const statusColor = feature.severity === 'error' ? '#B4463A'
    : feature.severity === 'warn' ? '#7A5A10'
    : feature.status === 'ok' ? '#058850'
    : '#6B6458';
  const statusLabel = feature.status === 'ok' ? 'พร้อม'
    : feature.status === 'disabled' ? 'ปิด (ไม่ได้ตั้ง env)'
    : feature.status === 'broken' ? 'ตั้งค่าผิด'
    : feature.status === 'partial' ? 'ยังไม่สมบูรณ์'
    : feature.status;

  return (
    <div style={{
      padding: '10px 12px', borderRadius: 9, background: 'rgba(255,255,255,0.6)',
      border: '1px solid rgba(0,0,0,0.05)', color: '#3E3A34',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <div style={{ fontSize: 13, fontWeight: 600 }}>{feature.label}</div>
        <span style={{
          padding: '1px 7px', borderRadius: 999, fontSize: 10, fontWeight: 600,
          background: statusColor, color: '#fff',
        }}>{statusLabel}</span>
      </div>
      <div style={{ fontSize: 11, color: '#6B6458', marginTop: 4, lineHeight: 1.5 }}>{feature.detail}</div>
      {feature.impact && (
        <div style={{ fontSize: 11, color: statusColor, marginTop: 3, fontWeight: 500 }}>
          ⚠ ผลกระทบ: {feature.impact}
        </div>
      )}
      {feature.envVars && feature.envVars.length > 0 && (
        <div style={{ fontSize: 10, color: '#8F877C', marginTop: 4 }}>
          ตัวแปรที่เกี่ยวข้อง:{' '}
          {feature.envVars.map(v => (
            <code key={v} style={{
              padding: '1px 5px', marginRight: 4, borderRadius: 3,
              background: '#F3EFE7', color: '#3E3A34', fontSize: 10,
            }}>{v}</code>
          ))}
        </div>
      )}
    </div>
  );
}

const errBanner = {
  marginBottom: 14, padding: '10px 14px', borderRadius: 9,
  background: 'rgba(180,70,58,0.08)', color: '#B4463A', fontSize: 12,
  display: 'flex', alignItems: 'center', gap: 8,
};
const okBanner = {
  marginBottom: 14, padding: '10px 14px', borderRadius: 9,
  background: 'rgba(6,199,85,0.08)', color: '#058850', fontSize: 12,
  display: 'flex', alignItems: 'center', gap: 8,
};
const toggleBtn = (palette) => ({
  padding: '4px 10px', borderRadius: 7,
  background: 'rgba(255,255,255,0.6)', border: `1px solid ${palette.border}`,
  color: palette.ink, fontSize: 11, cursor: 'pointer', fontFamily: 'inherit',
});

window.SystemStatusBanner = SystemStatusBanner;
