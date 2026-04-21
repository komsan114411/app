// dashboard-tab.jsx — landing page with metrics + 7-day chart.

function DashboardTab({ me, state }) {
  const [stats, setStats] = React.useState(null);
  const [series, setSeries] = React.useState(null);
  const [error, setError] = React.useState(null);
  const [diag, setDiag] = React.useState(null);  // API-ping diagnostic result

  const load = React.useCallback(async () => {
    setError(null);
    try {
      const [s, ts] = await Promise.all([
        api.getStats(),
        api.getTimeseries(7).catch(() => null),
      ]);
      setStats(s); setSeries(ts);
    } catch (e) { setError(e.message || 'load_failed'); }
  }, []);

  React.useEffect(() => {
    load();
    const id = setInterval(load, 30_000);
    return () => clearInterval(id);
  }, [load]);

  // End-to-end ping: exercises every critical path (read, admin auth,
  // CSRF token, cookie round-trip) so the admin can diagnose clicks that
  // "silently do nothing". Reports pass/fail per test.
  const runDiagnostic = async () => {
    setDiag({ running: true });
    const results = [];
    const test = async (name, fn) => {
      const t0 = Date.now();
      try { const r = await fn(); results.push({ name, ok: true, ms: Date.now() - t0, detail: r }); }
      catch (e) { results.push({ name, ok: false, ms: Date.now() - t0, detail: e.message || String(e) }); }
    };
    await test('GET /api/config (public)',        () => api.getConfig());
    await test('GET /api/admin/me (auth)',        () => api.me());
    await test('GET /api/admin/stats',            () => api.getStats());
    await test('GET /api/admin/users',            () => api.listUsers({ limit: 1 }));
    await test('GET /api/admin/me/sessions',      () => api.call('/api/admin/me/sessions', { auth: true }));
    await test('GET /api/admin/health/features',  () => api.call('/api/admin/health/features', { auth: true }));
    setDiag({ running: false, results, at: new Date() });
  };

  const chartData = buildChart(series, 7);

  return (
    <div>
      <SectionHead
        title={`สวัสดี ${me?.displayName || me?.loginId || 'ผู้ดูแล'}`}
        sub={me?.lastLoginAt ? `เข้าสู่ระบบล่าสุด: ${new Date(me.lastLoginAt).toLocaleString('th-TH')}` : 'ยินดีต้อนรับสู่หลังบ้าน'}
        right={<button onClick={load} style={refreshStyle}><Icon name="sparkle" size={13} stroke={1.8}/> รีเฟรช</button>}
      />
      {error && (
        <div style={{ padding: '10px 14px', borderRadius: 9, background: 'rgba(180,70,58,0.08)', color: '#B4463A', fontSize: 12, marginBottom: 14 }}>โหลดสถิติไม่สำเร็จ</div>
      )}

      {typeof SystemStatusBanner === 'function' && <SystemStatusBanner/>}

      <Card style={{ marginBottom: 14 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <div style={{ fontSize: 13, fontWeight: 700, flex: 1, minWidth: 160 }}>🩺 ทดสอบการเชื่อมต่อ</div>
          <button onClick={runDiagnostic} disabled={diag?.running} style={{
            padding: '7px 14px', borderRadius: 8, border: '1px solid rgba(0,0,0,0.12)',
            background: '#fff', fontFamily: 'inherit', fontSize: 12, cursor: diag?.running ? 'wait' : 'pointer',
            display: 'flex', alignItems: 'center', gap: 8,
          }}>
            {diag?.running && <span className="ad-spin ad-spin-sm"/>}
            {diag?.running ? 'กำลังทดสอบ…' : 'รันทดสอบ'}
          </button>
        </div>
        {diag?.results && (
          <div style={{ marginTop: 10, fontSize: 11, fontFamily: 'ui-monospace, monospace' }}>
            {diag.results.map((r, i) => (
              <div key={i} style={{
                display: 'flex', gap: 8, alignItems: 'center',
                padding: '4px 8px', borderRadius: 6,
                background: r.ok ? 'rgba(6,199,85,0.06)' : 'rgba(180,70,58,0.06)',
                color: r.ok ? '#058850' : '#B4463A', marginBottom: 3,
              }}>
                <span>{r.ok ? '✓' : '✗'}</span>
                <span style={{ flex: 1 }}>{r.name}</span>
                <span style={{ opacity: 0.7 }}>{r.ms}ms</span>
                {!r.ok && <span style={{ opacity: 0.85, maxWidth: 260, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>· {r.detail}</span>}
              </div>
            ))}
            <div style={{ marginTop: 4, fontSize: 10, color: '#8F877C' }}>
              ถ้าทุกบรรทัดเป็น ✓ สีเขียว แต่ปุ่มในหน้ายังกดไม่ได้ — อาจเป็น browser ปิด window.confirm. ปุ่มล่าสุดใช้ "✓ ยืนยัน?" pattern ไม่ต้องพึ่ง confirm dialog
            </div>
          </div>
        )}
      </Card>

      <div className="ad-stagger" style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 16 }}>
        <StatCard loading={!stats} icon="heart"    label="ผู้ดูแล (ใช้งาน)"    main={stats?.users?.active}           sub={stats ? `จากทั้งหมด ${stats.users?.total ?? '—'}` : 'จากทั้งหมด …'}/>
        <StatCard loading={!stats} icon="sparkle"  label="คลิกวันนี้"          main={stats?.clicks?.today}           sub={stats ? `สัปดาห์นี้ ${stats.clicks?.week ?? '—'}` : 'สัปดาห์นี้ …'}/>
        <StatCard loading={!stats} icon="settings" label="ปุ่มเมนู"            main={stats?.config?.buttons}         sub={stats ? `แบนเนอร์ ${stats.config?.banners ?? '—'}` : 'แบนเนอร์ …'}/>
        <StatCard loading={!stats} icon="x"        label="ล็อกอินล้มเหลว 24 ชม" main={stats?.security?.failedLogins24h} sub="ถ้าสูงผิดปกติ → ตรวจ Audit" tone={stats?.security?.failedLogins24h > 20 ? 'danger' : 'default'}/>
      </div>

      <Card style={{ marginBottom: 12 }}>
        <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 6 }}>7 วันที่ผ่านมา</div>
        {chartData && typeof LineChart === 'function'
          ? <LineChart series={chartData.series} xLabels={chartData.labels} height={180}/>
          : <div style={{ fontSize: 12, color: '#8F877C', padding: 20 }}>ยังไม่มีข้อมูล</div>}
      </Card>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <Card>
          <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 10 }}>ข้อมูลบัญชี</div>
          <KV k="Login ID" v={me?.loginId}/>
          <KV k="ชื่อเรียก" v={me?.displayName || '—'}/>
          <KV k="อีเมล" v={me?.email || '— (ตั้งในโปรไฟล์เพื่อใช้ตั้งรหัสใหม่)'}/>
          <KV k="สิทธิ์" v={me?.role === 'admin' ? 'Admin' : 'Editor'}/>
          <KV k="2FA" v={me?.totpEnabled ? 'เปิดอยู่' : 'ยังไม่เปิด'}/>
          <KV k="IP ล่าสุด" v={me?.lastLoginIp || '—'}/>
        </Card>
        <Card>
          <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 10 }}>แอป</div>
          <KV k="ชื่อแอป" v={state?.appName || '—'}/>
          <KV k="ธีม" v={state?.theme || '—'}/>
          <KV k="ภาษา" v={state?.language === 'en' ? 'English' : 'ไทย'}/>
          <KV k="อัปเดตล่าสุด" v={stats?.config?.updatedAt ? new Date(stats.config.updatedAt).toLocaleString('th-TH') : '—'}/>
          <div style={{ marginTop: 10, fontSize: 11, color: '#8F877C', lineHeight: 1.5 }}>
            ผู้ใช้ที่เปิดหน้าเว็บจะเห็นการเปลี่ยนแปลงที่คุณบันทึกภายใน 5-8 วินาที
          </div>
        </Card>
      </div>
    </div>
  );
}

function buildChart(ts, days = 7) {
  if (!ts) return null;
  // Build continuous day series (fill missing days with 0)
  const labels = [];
  const today = new Date();
  const map = (ts.clicks || []).reduce((m, r) => (m[r._id] = r.count, m), {});
  const mapLogins = (ts.logins || []).reduce((m, r) => (m[r._id] = r.count, m), {});
  const clickPoints = [], loginPoints = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(today); d.setDate(d.getDate() - i);
    const key = d.toISOString().slice(0, 10);
    labels.push(d.toLocaleDateString('th-TH', { day: 'numeric', month: 'short' }));
    clickPoints.push({ x: days - 1 - i, y: map[key] || 0 });
    loginPoints.push({ x: days - 1 - i, y: mapLogins[key] || 0 });
  }
  return {
    labels,
    series: [
      { label: 'Clicks', color: '#1F1B17', points: clickPoints },
      { label: 'Logins', color: '#D19F40', points: loginPoints },
    ],
  };
}

function StatCard({ icon, label, main, sub, tone = 'default', loading = false }) {
  const toneStyle = tone === 'danger'
    ? { borderColor: 'rgba(180,70,58,0.3)', background: 'rgba(180,70,58,0.04)', color: '#B4463A' }
    : {};
  // When loading (stats request still in flight) render shimmer blocks
  // instead of "—". The blocks hold the same box dimensions as the
  // eventual number / sub-text so the layout doesn't jump on arrival.
  return (
    <Card className="ad-card-hover" style={{ padding: 14, ...toneStyle }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
        <div style={{
          width: 28, height: 28, borderRadius: 8, background: '#F3EFE7',
          display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#6B6458',
        }}>
          <Icon name={icon} size={15} stroke={1.8}/>
        </div>
        <div style={{ fontSize: 11, color: '#6B6458', textTransform: 'uppercase', letterSpacing: 0.5 }}>{label}</div>
      </div>
      {loading ? (
        <span className="ad-skel" style={{ width: 56, height: 26, display: 'inline-block' }}>0</span>
      ) : (
        <div className="ad-count" style={{ fontSize: 24, fontWeight: 700, lineHeight: 1.1, ...(toneStyle.color ? { color: toneStyle.color } : {}) }}>
          {main ?? '—'}
        </div>
      )}
      {sub && (
        loading
          ? <div style={{ marginTop: 6 }}><span className="ad-skel" style={{ width: 100, height: 11, display: 'inline-block' }}>.</span></div>
          : <div style={{ fontSize: 11, color: '#8F877C', marginTop: 3 }}>{sub}</div>
      )}
    </Card>
  );
}

function KV({ k, v }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '6px 0', borderBottom: '1px solid rgba(0,0,0,0.04)' }}>
      <div style={{ fontSize: 11, color: '#6B6458' }}>{k}</div>
      <div style={{ fontSize: 13, fontWeight: 500, maxWidth: '60%', textAlign: 'right', wordBreak: 'break-all' }}>{v}</div>
    </div>
  );
}

const refreshStyle = {
  display: 'flex', alignItems: 'center', gap: 6, padding: '7px 12px',
  borderRadius: 8, border: '1px solid rgba(0,0,0,0.12)', background: '#fff',
  fontFamily: 'inherit', fontSize: 12, cursor: 'pointer',
};

window.DashboardTab = DashboardTab;
