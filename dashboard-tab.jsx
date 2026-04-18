// dashboard-tab.jsx — landing page inside admin shell with key metrics.

function DashboardTab({ me, state }) {
  const [stats, setStats] = React.useState(null);
  const [error, setError] = React.useState(null);

  const load = React.useCallback(async () => {
    setError(null);
    try {
      const data = await api.getStats();
      setStats(data);
    } catch (e) { setError(e.message || 'load_failed'); }
  }, []);

  React.useEffect(() => {
    load();
    const id = setInterval(load, 30_000);
    return () => clearInterval(id);
  }, [load]);

  return (
    <div>
      <SectionHead
        title={`สวัสดี ${me?.loginId || 'ผู้ดูแล'}`}
        sub={me?.lastLoginAt ? `เข้าสู่ระบบล่าสุด: ${new Date(me.lastLoginAt).toLocaleString('th-TH')}` : 'ยินดีต้อนรับสู่หลังบ้าน'}
        right={<button onClick={load} style={refreshStyle}><Icon name="sparkle" size={13} stroke={1.8}/> รีเฟรช</button>}
      />
      {error && (
        <div style={{
          padding: '10px 14px', borderRadius: 9,
          background: 'rgba(180,70,58,0.08)', color: '#B4463A', fontSize: 12,
          marginBottom: 14,
        }}>โหลดสถิติไม่สำเร็จ</div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 16 }}>
        <StatCard icon="heart" label="ผู้ดูแล (ใช้งาน)" main={stats?.users?.active ?? '—'} sub={`จากทั้งหมด ${stats?.users?.total ?? '—'}`}/>
        <StatCard icon="sparkle" label="คลิกวันนี้" main={stats?.clicks?.today ?? '—'} sub={`สัปดาห์นี้ ${stats?.clicks?.week ?? '—'}`}/>
        <StatCard icon="settings" label="ปุ่มเมนู" main={stats?.config?.buttons ?? '—'} sub={`แบนเนอร์ ${stats?.config?.banners ?? '—'}`}/>
        <StatCard icon="x" label="ล็อกอินล้มเหลว 24 ชม" main={stats?.security?.failedLogins24h ?? '—'} sub="ถ้าสูงผิดปกติ → ตรวจ Audit" tone={stats?.security?.failedLogins24h > 20 ? 'danger' : 'default'}/>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <Card>
          <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 10 }}>ข้อมูลบัญชี</div>
          <KV k="Login ID" v={me?.loginId}/>
          <KV k="สิทธิ์" v={me?.role === 'admin' ? 'Admin' : 'Editor'}/>
          <KV k="สร้างบัญชีเมื่อ" v={me?.createdAt ? new Date(me.createdAt).toLocaleDateString('th-TH') : '—'}/>
          <KV k="IP ล่าสุด" v={me?.lastLoginIp || '—'}/>
        </Card>
        <Card>
          <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 10 }}>แอป</div>
          <KV k="ชื่อแอป" v={state?.appName || '—'}/>
          <KV k="ธีม" v={state?.theme || '—'}/>
          <KV k="อัปเดตล่าสุด" v={stats?.config?.updatedAt ? new Date(stats.config.updatedAt).toLocaleString('th-TH') : '—'}/>
          <div style={{ marginTop: 10, fontSize: 11, color: '#8F877C', lineHeight: 1.5 }}>
            ผู้ใช้ที่เปิดหน้าเว็บจะเห็นการเปลี่ยนแปลงที่คุณบันทึกภายใน 5-8 วินาที
          </div>
        </Card>
      </div>
    </div>
  );
}

function StatCard({ icon, label, main, sub, tone = 'default' }) {
  const toneStyle = tone === 'danger'
    ? { borderColor: 'rgba(180,70,58,0.3)', background: 'rgba(180,70,58,0.04)', color: '#B4463A' }
    : {};
  return (
    <Card style={{ padding: 14, ...toneStyle }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
        <div style={{
          width: 28, height: 28, borderRadius: 8, background: '#F3EFE7',
          display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#6B6458',
        }}>
          <Icon name={icon} size={15} stroke={1.8}/>
        </div>
        <div style={{ fontSize: 11, color: '#6B6458', textTransform: 'uppercase', letterSpacing: 0.5 }}>{label}</div>
      </div>
      <div style={{ fontSize: 24, fontWeight: 700, lineHeight: 1.1, ...(toneStyle.color ? { color: toneStyle.color } : {}) }}>{main}</div>
      {sub && <div style={{ fontSize: 11, color: '#8F877C', marginTop: 3 }}>{sub}</div>}
    </Card>
  );
}

function KV({ k, v }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '6px 0', borderBottom: '1px solid rgba(0,0,0,0.04)' }}>
      <div style={{ fontSize: 11, color: '#6B6458' }}>{k}</div>
      <div style={{ fontSize: 13, fontWeight: 500 }}>{v}</div>
    </div>
  );
}

const refreshStyle = {
  display: 'flex', alignItems: 'center', gap: 6, padding: '7px 12px',
  borderRadius: 8, border: '1px solid rgba(0,0,0,0.12)', background: '#fff',
  fontFamily: 'inherit', fontSize: 12, cursor: 'pointer',
};

window.DashboardTab = DashboardTab;
