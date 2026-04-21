// analytics-tab.jsx — dedicated "📊 การติดตาม" tab for the admin console.
// Collects every Phase 2+ growth/retention surface in one place so the
// main Dashboard stays tight. All panels pull read-only aggregates
// from /api/admin/* — no per-device identifiers ever leave the server.

function AnalyticsTab() {
  const [tab, setTab] = React.useState('overview');
  const panels = [
    { id: 'overview',   label: 'ภาพรวม',    },
    { id: 'cohort',     label: 'Retention' },
    { id: 'sessions',   label: 'Sessions'  },
    { id: 'devices',    label: 'Devices'   },
    { id: 'exits',      label: 'Exit Links'},
    { id: 'sankey',     label: 'Funnel'    },
    { id: 'campaigns',  label: 'Campaigns' },
    { id: 'live',       label: 'Live'      },
    { id: 'errors',     label: 'Errors'    },
  ];
  return (
    <div>
      <SectionHead title="📊 การติดตามผู้ใช้"
        sub="ข้อมูลรวมแบบนิรนาม · ไม่เก็บ PII · Event TTL 90d · Device TTL 180d"/>
      <div style={{ display: 'flex', gap: 6, marginBottom: 14, flexWrap: 'wrap' }}>
        {panels.map(p => (
          <button key={p.id} onClick={() => setTab(p.id)} style={{
            padding: '7px 14px', borderRadius: 999,
            border: `1px solid ${tab === p.id ? '#1F1B17' : 'rgba(0,0,0,0.1)'}`,
            background: tab === p.id ? '#1F1B17' : '#fff',
            color: tab === p.id ? '#fff' : '#6B6458',
            fontFamily: 'inherit', fontSize: 12,
            cursor: 'pointer', transition: 'all 160ms ease',
          }}>{p.label}</button>
        ))}
      </div>
      {tab === 'overview' && <OverviewPanel/>}
      {tab === 'cohort'   && <CohortPanel/>}
      {tab === 'sessions' && <SessionsPanel/>}
      {tab === 'devices'  && <DevicesPanel/>}
      {tab === 'exits'    && <ExitsPanel/>}
      {tab === 'sankey'    && <SankeyPanel/>}
      {tab === 'campaigns' && <CampaignsPanel/>}
      {tab === 'live'      && <LivePanel/>}
      {tab === 'errors'    && <ErrorsPanel/>}
    </div>
  );
}

// ─── Sankey funnel diagram ────────────────────────────────────
function SankeyPanel() {
  const [data, setData] = React.useState(null);
  const [anomaly, setAnomaly] = React.useState(null);
  React.useEffect(() => {
    (async () => {
      try { setData(await api.getSankey(30)); } catch {}
      try { setAnomaly(await api.getAnomaly()); } catch {}
    })();
  }, []);
  if (!data) return <Card><span className="ad-spin ad-spin-sm"/> กำลังคำนวณ funnel…</Card>;
  const max = Math.max(1, ...data.nodes.map(n => n.value));
  return (
    <div>
      {anomaly?.alerts?.length ? (
        <Card style={{ marginBottom: 12, background: 'rgba(180,70,58,0.06)', borderColor: 'rgba(180,70,58,0.3)' }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: '#B4463A', marginBottom: 6 }}>⚠ พบความผิดปกติ</div>
          {anomaly.alerts.map((a, i) => (
            <div key={i} style={{ fontSize: 12, color: '#1F1B17', marginBottom: 3 }}>
              <strong>{a.type}</strong> · วันนี้ {a.todayCount} (baseline ~{a.baselineMean}, z={a.zScore})
              · {a.direction === 'spike' ? '📈 สูงผิดปกติ' : '📉 ต่ำผิดปกติ'}
            </div>
          ))}
        </Card>
      ) : null}
      <Card>
        <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 16 }}>🔀 Conversion funnel (30 วัน)</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          {data.nodes.map((n, i) => {
            const link = data.links[i];
            const pct = link ? ((link.value / Math.max(1, n.value)) * 100).toFixed(1) : null;
            return (
              <React.Fragment key={n.id}>
                <div style={{
                  minWidth: 110, padding: '12px 14px', borderRadius: 12,
                  background: `linear-gradient(135deg, #C48B3E, ${shadeHex('#C48B3E', -0.2)})`,
                  color: '#fff', textAlign: 'center',
                  opacity: 0.35 + 0.65 * (n.value / max),
                }}>
                  <div style={{ fontSize: 11, letterSpacing: 0.5, textTransform: 'uppercase', opacity: 0.85 }}>{n.label}</div>
                  <div style={{ fontSize: 24, fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{n.value}</div>
                </div>
                {link && (
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2, minWidth: 60 }}>
                    <div style={{ fontSize: 10, color: '#6B6458' }}>→</div>
                    <div style={{ fontSize: 11, fontWeight: 700, color: '#1F1B17' }}>{pct}%</div>
                    <div style={{ fontSize: 10, color: '#B4463A' }}>- {link.drop}</div>
                  </div>
                )}
              </React.Fragment>
            );
          })}
        </div>
      </Card>
    </div>
  );
}
function shadeHex(hex, amt) {
  const n = parseInt(hex.slice(1), 16);
  let r = (n >> 16) + Math.round(255 * amt);
  let g = ((n >> 8) & 0xff) + Math.round(255 * amt);
  let b = (n & 0xff) + Math.round(255 * amt);
  r = Math.max(0, Math.min(255, r)); g = Math.max(0, Math.min(255, g)); b = Math.max(0, Math.min(255, b));
  return '#' + ((r << 16) | (g << 8) | b).toString(16).padStart(6, '0');
}

// ─── Push campaigns ───────────────────────────────────────────
function CampaignsPanel() {
  const [rows, setRows] = React.useState(null);
  const [inactive, setInactive] = React.useState(null);
  const [form, setForm] = React.useState({ name: '', title: '', body: '', url: '/', inactiveDays: 14 });
  const [preview, setPreview] = React.useState(null);
  const [busy, setBusy] = React.useState(false);

  const load = React.useCallback(async () => {
    try { const r = await api.listCampaigns(); setRows(r.rows || []); } catch {}
    try { const r = await api.getInactive(14); setInactive(r.count); } catch {}
  }, []);
  React.useEffect(() => { load(); }, [load]);

  const doPreview = async () => {
    setBusy(true);
    try {
      const r = await api.previewSegment({ inactiveDays: Number(form.inactiveDays) || 0 });
      setPreview(r.count);
    } catch {} finally { setBusy(false); }
  };
  const sendNow = async () => {
    if (!form.title.trim()) return;
    setBusy(true);
    try {
      const r = await api.broadcastSegmented({
        title: form.title, body: form.body, url: form.url,
        segment: { inactiveDays: Number(form.inactiveDays) || 0 },
      });
      if (!r?.targeted) {
        toast.warn('ยังไม่มีผู้ใช้ที่เข้าเกณฑ์ · ตรวจว่ามีคน subscribe push แล้วหรือยัง');
      } else if (!r?.sent) {
        const reasons = r?.failReasons ? Object.entries(r.failReasons).map(([k,v]) => `${k}:${v}`).join(' ') : '';
        toast.warn(`ถึง ${r.targeted} ราย ส่งไม่ผ่านเลย ${reasons ? '· ' + reasons : ''}`);
      } else if (r.failed) {
        const reasons = r?.failReasons ? Object.entries(r.failReasons).map(([k,v]) => `${k}:${v}`).join(' ') : '';
        toast.warn(`สำเร็จ ${r.sent}/${r.targeted} · fail ${r.failed} (${reasons})`);
      } else {
        toast.success(`ส่งสำเร็จ ${r.sent}/${r.targeted} ราย`);
      }
      setPreview(null);
      load();
    } catch (e) {
      const detail = e?.responseBody?.detail;
      if (e.message === 'push_disabled') toast.error('Push ยังไม่พร้อม — ' + (detail || 'ให้ admin รีสตาร์ท backend เพื่อให้ auto-generate VAPID'));
      else if (e.message === 'invalid_input') toast.error('กรอกหัวข้อให้ครบก่อน');
      else toast.error('ส่งไม่สำเร็จ: ' + (e.message || 'unknown'));
    }
    finally { setBusy(false); }
  };
  const saveCampaign = async () => {
    if (!form.name.trim() || !form.title.trim()) return;
    setBusy(true);
    try {
      await api.createCampaign({
        name: form.name, title: form.title, body: form.body, url: form.url,
        segment: { inactiveDays: Number(form.inactiveDays) || 0 },
      });
      toast.success('บันทึก campaign แล้ว');
      setForm({ name: '', title: '', body: '', url: '/', inactiveDays: 14 });
      load();
    } catch (e) { toast.error('บันทึกไม่สำเร็จ: ' + (e.message || 'unknown')); }
    finally { setBusy(false); }
  };
  const remove = async (id) => {
    if (!confirm('ลบ campaign นี้?')) return;
    try { await api.deleteCampaign(id); toast.success('ลบแล้ว'); load(); } catch {}
  };

  const inp = { width: '100%', padding: '8px 10px', borderRadius: 8, border: '1px solid rgba(0,0,0,0.12)', fontFamily: 'inherit', fontSize: 12, marginBottom: 8 };
  return (
    <div>
      <Card style={{ marginBottom: 12 }}>
        <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 8 }}>🔔 สร้าง / ส่ง Push</div>
        <div style={{ fontSize: 11, color: '#6B6458', marginBottom: 10 }}>
          Inactive 14+ วัน: <strong>{inactive ?? '—'}</strong> devices
          {preview != null && <span> · Preview ตรงกับเงื่อนไข: <strong>{preview}</strong></span>}
        </div>
        <input placeholder="ชื่อ campaign (internal)" value={form.name} onChange={e => setForm({...form, name: e.target.value})} style={inp}/>
        <input placeholder="หัวข้อ notification" value={form.title} onChange={e => setForm({...form, title: e.target.value})} style={inp}/>
        <input placeholder="ข้อความ (body)" value={form.body} onChange={e => setForm({...form, body: e.target.value})} style={inp}/>
        <input placeholder="URL เมื่อคลิก (/)" value={form.url} onChange={e => setForm({...form, url: e.target.value})} style={inp}/>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 10 }}>
          <label style={{ fontSize: 11, color: '#6B6458' }}>Inactive days ≥</label>
          <input type="number" value={form.inactiveDays} onChange={e => setForm({...form, inactiveDays: e.target.value})} style={{ ...inp, marginBottom: 0, width: 80 }}/>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={doPreview} disabled={busy} style={btnSecondary}>Preview count</button>
          <button onClick={sendNow} disabled={busy || !form.title} style={btnPrimary}>{busy ? <span className="ad-spin ad-spin-sm"/> : null} ส่งเลย</button>
          <button onClick={saveCampaign} disabled={busy || !form.name || !form.title} style={btnSecondary}>บันทึกเก็บ</button>
        </div>
      </Card>
      <Card>
        <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 8 }}>📜 Campaigns</div>
        {!rows && <div><span className="ad-spin ad-spin-sm"/></div>}
        {rows && !rows.length && <div style={{ fontSize: 12, color: '#8F877C' }}>ยังไม่มี campaign</div>}
        {rows && rows.map(r => {
          const s = r.stats || {};
          const ctr = s.sent > 0 ? ((s.clicks || 0) / s.sent * 100).toFixed(1) + '%' : '—';
          return (
            <div key={r._id} style={{ padding: '10px 0', borderBottom: '1px solid rgba(0,0,0,0.06)', display: 'flex', alignItems: 'center', gap: 10 }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 12, fontWeight: 600 }}>{r.name}</div>
                <div style={{ fontSize: 11, color: '#6B6458' }}>
                  {r.title} · status: <strong>{r.status}</strong>
                  {r.status === 'sent' && (
                    <> · targeted <strong>{s.targeted ?? 0}</strong>
                       · sent <strong>{s.sent ?? 0}</strong>
                       {s.failed ? <> · failed {s.failed}</> : null}
                       {s.clicks ? <> · clicks {s.clicks} (CTR {ctr})</> : null}</>
                  )}
                </div>
              </div>
              <button onClick={() => remove(r._id)} style={btnGhost}>ลบ</button>
            </div>
          );
        })}
      </Card>
    </div>
  );
}
const btnPrimary   = { padding: '8px 14px', borderRadius: 8, border: 'none', background: '#1F1B17', color: '#fff', fontFamily: 'inherit', fontSize: 12, fontWeight: 600, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 6 };
const btnSecondary = { padding: '8px 14px', borderRadius: 8, border: '1px solid rgba(0,0,0,0.12)', background: '#fff', fontFamily: 'inherit', fontSize: 12, cursor: 'pointer' };
const btnGhost     = { padding: '5px 10px', borderRadius: 6, border: '1px solid rgba(180,70,58,0.3)', background: '#fff', color: '#B4463A', fontFamily: 'inherit', fontSize: 11, cursor: 'pointer' };

// ─── Live SSE feed ────────────────────────────────────────────
// EventSource can't attach an Authorization header, so we mint a
// short-lived nonce via /events/mint-token (which DOES authenticate
// via Bearer) and pass it as ?t=<nonce>. The token has a 2-minute
// TTL and is single-use on the server side.
//
// Because the token expires at 2 min, we proactively re-mint every
// 90 s and swap the EventSource so the panel never drops. On a
// network glitch the browser also fires onerror — we re-mint +
// reconnect there too, with a small exponential backoff so we don't
// hammer the mint endpoint when the real problem is the network.
function LivePanel() {
  const [events, setEvents] = React.useState([]);
  const [connected, setConnected] = React.useState(false);
  const [err, setErr] = React.useState('');
  React.useEffect(() => {
    let es = null;
    let cancelled = false;
    let refreshTimer = null;
    let backoffMs = 1000;

    const open = async () => {
      if (cancelled) return;
      try {
        const { token } = await api.mintSseToken();
        if (cancelled || !token) return;
        if (es) { try { es.close(); } catch {} }
        const base = (typeof window !== 'undefined' && window.API_BASE) || '';
        es = new EventSource(base + '/api/admin/events/stream?t=' + encodeURIComponent(token));
        es.onopen = () => {
          setConnected(true); setErr('');
          backoffMs = 1000;
        };
        es.onerror = () => {
          setConnected(false);
          if (cancelled) return;
          // Re-mint + reconnect. Exponential backoff caps at 30 s so
          // we don't wedge the admin's network if the server is down.
          setTimeout(() => { if (!cancelled) open(); }, backoffMs);
          backoffMs = Math.min(30_000, backoffMs * 2);
        };
        es.addEventListener('ev', (e) => {
          try {
            const ev = JSON.parse(e.data);
            setEvents(prev => [ev, ...prev].slice(0, 40));
          } catch {}
        });
      } catch (e) {
        setErr(e?.message || 'mint_token_failed');
        if (!cancelled) setTimeout(open, backoffMs);
        backoffMs = Math.min(30_000, backoffMs * 2);
      }
    };

    // Start the stream + the re-mint interval only while the admin
    // tab is visible. A backgrounded tab shouldn't hold an SSE
    // connection or hit /events/mint-token every 90 s for hours.
    const start = () => {
      if (refreshTimer) return;
      open();
      refreshTimer = setInterval(() => { if (!cancelled) open(); }, 90_000);
    };
    const stop = () => {
      if (refreshTimer) { clearInterval(refreshTimer); refreshTimer = null; }
      if (es) { try { es.close(); } catch {} es = null; }
      setConnected(false);
    };
    if (typeof document !== 'undefined' && !document.hidden) start();
    const onVis = () => { if (document.hidden) stop(); else start(); };
    if (typeof document !== 'undefined') document.addEventListener('visibilitychange', onVis);

    return () => {
      cancelled = true;
      if (refreshTimer) clearInterval(refreshTimer);
      if (es) { try { es.close(); } catch {} }
      if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', onVis);
    };
  }, []);
  return (
    <Card>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
        <span style={{ width: 10, height: 10, borderRadius: '50%', background: connected ? '#06C755' : '#B4463A', boxShadow: connected ? '0 0 8px #06C755' : 'none' }}/>
        <span style={{ fontSize: 13, fontWeight: 700 }}>Live activity</span>
        <span style={{ fontSize: 11, color: '#8F877C' }}>{connected ? 'connected' : (err || 'disconnected')}</span>
      </div>
      {events.length === 0 && <div style={{ fontSize: 12, color: '#8F877C' }}>รอ events…</div>}
      {events.map((e, i) => (
        <div key={i} style={{ padding: '6px 8px', borderBottom: '1px solid rgba(0,0,0,0.04)', fontSize: 11, display: 'flex', gap: 8 }}>
          <span style={{ width: 80, color: '#6B6458', fontFamily: 'ui-monospace, monospace' }}>{new Date(e.at).toLocaleTimeString('th-TH')}</span>
          <span style={{ padding: '1px 7px', borderRadius: 6, background: typeColor(e.type), color: '#fff', fontSize: 10, fontWeight: 600, whiteSpace: 'nowrap' }}>{e.type}</span>
          <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{e.target || e.label || ''}</span>
          <span style={{ color: '#8F877C', fontSize: 10 }}>{e.platform || ''}</span>
        </div>
      ))}
    </Card>
  );
}
function typeColor(t) {
  if (t === 'button_click') return '#1F1B17';
  if (t === 'app_boot' || t === 'session_start') return '#06C755';
  if (t === 'install_click' || t === 'install_page_view') return '#C48B3E';
  if (t === 'error') return '#B4463A';
  if (t === 'push_click') return '#8E6B3D';
  return '#6B6458';
}

// ─── Overview ─────────────────────────────────────────────────
function OverviewPanel() {
  const [summary, setSummary] = React.useState(null);
  const [tt, setTt] = React.useState(null);
  const [sess, setSess] = React.useState(null);
  React.useEffect(() => {
    (async () => {
      try { setSummary(await api.getDevicesSummary(30)); } catch {}
      try { setTt(await api.getTimeToFirst(7)); } catch {}
      try { setSess(await api.getSessions(7)); } catch {}
    })();
  }, []);
  return (
    <div>
      <div className="ad-stagger" style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 16 }}>
        <MiniStat loading={!summary} label="DAU"  main={summary?.dau}  sub={`WAU ${summary?.wau ?? 0}`}/>
        <MiniStat loading={!summary} label="MAU"  main={summary?.mau}  sub={`รวม ${summary?.total ?? 0} devices`}/>
        <MiniStat loading={!sess}    label="Avg Session" main={sess ? fmtDuration(sess.avgDuration) : ''}
                  sub={sess ? `${sess.sessions} sessions` : ''}/>
        <MiniStat loading={!tt}      label="Time-to-first-click"
                  main={tt?.percentiles?.p50 ? fmtDuration(tt.percentiles.p50[0]) : (tt?.summary?.avg ? fmtDuration(tt.summary.avg) : '—')}
                  sub={tt?.percentiles?.p90 ? `p90 ${fmtDuration(tt.percentiles.p90[0])}` : 'ยังไม่มีข้อมูล'}/>
      </div>
      {typeof AttributionPanel === 'function' && <AttributionPanel/>}
    </div>
  );
}

// ─── Retention cohort heatmap ─────────────────────────────────
function CohortPanel() {
  const [rows, setRows] = React.useState(null);
  const [err, setErr] = React.useState('');
  React.useEffect(() => {
    (async () => {
      try { const r = await api.getCohorts(8); setRows(r.cohorts || []); }
      catch (e) { setErr(e.message || 'load_failed'); }
    })();
  }, []);
  if (err) return <Card style={{ color: '#B4463A', fontSize: 12 }}>{err}</Card>;
  if (!rows) return <Card><span className="ad-spin ad-spin-sm"/> กำลังโหลด cohort…</Card>;
  if (!rows.length) return <Card><div style={{ fontSize: 12, color: '#8F877C' }}>ยังไม่มีข้อมูล retention · ต้องรอให้ user ในสัปดาห์แรกกลับมาเปิดแอปอีกครั้ง</div></Card>;

  const days = ['d1', 'd7', 'd14', 'd30'];
  return (
    <Card>
      <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 10 }}>🔁 Retention cohorts (8 สัปดาห์ล่าสุด)</div>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: 11 }}>
          <thead>
            <tr style={{ color: '#6B6458' }}>
              <th style={cellHead}>Cohort</th>
              <th style={cellHead}>ขนาด</th>
              {days.map(d => <th key={d} style={cellHead}>{d.toUpperCase()}</th>)}
            </tr>
          </thead>
          <tbody>
            {rows.map(r => (
              <tr key={r.cohort}>
                <td style={cell}>{r.cohort}</td>
                <td style={cell}>{r.size}</td>
                {days.map(d => {
                  const v = r.retained?.[d] ?? 0;
                  const pct = r.size ? (v / r.size) : 0;
                  return <td key={d} style={{ ...cell, background: pct > 0 ? `rgba(196,139,62,${0.15 + pct * 0.6})` : '#fafafa', textAlign: 'center' }}>
                    {v ? `${v} (${(pct*100).toFixed(0)}%)` : '—'}
                  </td>;
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div style={{ marginTop: 10, fontSize: 10, color: '#8F877C' }}>
        DN = สัดส่วน user ที่ install ในสัปดาห์นั้น + กลับมาเปิดแอปอีกใน N วันถัดมา
      </div>
    </Card>
  );
}

// ─── Session summary ──────────────────────────────────────────
function SessionsPanel() {
  const [data, setData] = React.useState(null);
  React.useEffect(() => {
    (async () => { try { setData(await api.getSessions(7)); } catch {} })();
  }, []);
  if (!data) return <Card><span className="ad-spin ad-spin-sm"/> กำลังโหลด…</Card>;
  return (
    <div>
      <div className="ad-stagger" style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 16 }}>
        <MiniStat label="Sessions (7d)" main={data.sessions ?? 0}/>
        <MiniStat label="Unique devices" main={data.uniqueDevices ?? 0}/>
        <MiniStat label="Sessions/device" main={(data.sessionsPerDevice || 0).toFixed(2)}/>
        <MiniStat label="Avg duration" main={fmtDuration(data.avgDuration)} sub={`max ${fmtDuration(data.maxDuration)}`}/>
      </div>
      <Card>
        <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 10 }}>📊 Session duration distribution</div>
        {(data.buckets || []).length === 0 && <div style={{ fontSize: 12, color: '#8F877C' }}>ยังไม่มีข้อมูล session</div>}
        {(data.buckets || []).map((b, i) => {
          const max = Math.max(1, ...(data.buckets || []).map(x => x.count));
          return (
            <div key={i} style={{ marginBottom: 6 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, marginBottom: 2 }}>
                <span>{bucketLabel(b._id)}</span>
                <span style={{ color: '#6B6458' }}>{b.count}</span>
              </div>
              <div style={{ height: 4, background: 'rgba(0,0,0,0.05)', borderRadius: 2, overflow: 'hidden' }}>
                <div style={{ width: `${(b.count / max) * 100}%`, height: '100%', background: 'linear-gradient(90deg, #C48B3E, #B4463A)' }}/>
              </div>
            </div>
          );
        })}
      </Card>
    </div>
  );
}

// ─── Device / OS breakdown ────────────────────────────────────
function DevicesPanel() {
  const [data, setData] = React.useState(null);
  React.useEffect(() => {
    (async () => { try { setData(await api.getDevicesBreakdown(30)); } catch {} })();
  }, []);
  if (!data) return <Card><span className="ad-spin ad-spin-sm"/> กำลังโหลด…</Card>;
  const cols = [
    { title: 'Platform',  rows: data.platform },
    { title: 'OS Version', rows: data.osVersion },
    { title: 'Locale',     rows: data.locale },
    { title: 'Medium',     rows: data.firstSeenMedium },
    { title: 'App version', rows: data.appVersion },
  ];
  return (
    <Card>
      <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 10 }}>📱 Device breakdown (30 วัน)</div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 14 }}>
        {cols.map(c => <AttrColumn key={c.title} title={c.title} rows={(c.rows || []).map(r => ({ name: r._id || '—', count: r.count }))}/>)}
      </div>
    </Card>
  );
}

// ─── Exit link CTR ────────────────────────────────────────────
function ExitsPanel() {
  const [rows, setRows] = React.useState(null);
  React.useEffect(() => {
    (async () => { try { const r = await api.getExits(30); setRows(r.rows || []); } catch {} })();
  }, []);
  if (!rows) return <Card><span className="ad-spin ad-spin-sm"/> กำลังโหลด…</Card>;
  if (!rows.length) return <Card><div style={{ fontSize: 12, color: '#8F877C' }}>ยังไม่มี exit_click events</div></Card>;
  return (
    <Card>
      <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 10 }}>🔗 Outgoing link clicks (30 วัน)</div>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
        <thead><tr style={{ color: '#6B6458' }}>
          <th style={cellHead}>Label</th><th style={cellHead}>Target</th>
          <th style={cellHead}>Clicks</th><th style={cellHead}>Uniques</th>
        </tr></thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i}>
              <td style={cell}>{r.label || '—'}</td>
              <td style={{ ...cell, maxWidth: 300, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: '#6B6458' }}>{r.target}</td>
              <td style={{ ...cell, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{r.clicks}</td>
              <td style={{ ...cell, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{r.uniques}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  );
}

// ─── Recent errors ────────────────────────────────────────────
function ErrorsPanel() {
  const [rows, setRows] = React.useState(null);
  React.useEffect(() => {
    (async () => { try { const r = await api.getRecentErrors(7); setRows(r.rows || []); } catch {} })();
  }, []);
  if (!rows) return <Card><span className="ad-spin ad-spin-sm"/> กำลังโหลด…</Card>;
  if (!rows.length) return <Card><div style={{ fontSize: 12, color: '#8F877C' }}>😀 ไม่มี error ใน 7 วันที่ผ่านมา</div></Card>;
  return (
    <Card>
      <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 10 }}>⚠ Client errors (7 วัน)</div>
      {rows.map((r, i) => (
        <div key={i} style={{ padding: '10px 0', borderBottom: '1px solid rgba(0,0,0,0.06)' }}>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 3 }}>
            <span style={{ padding: '2px 8px', borderRadius: 999, background: 'rgba(180,70,58,0.1)', color: '#B4463A', fontSize: 10, fontWeight: 600 }}>×{r.count}</span>
            <span style={{ fontSize: 12, fontWeight: 600, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.message}</span>
            <span style={{ fontSize: 10, color: '#8F877C' }}>{new Date(r.lastAt).toLocaleString('th-TH')}</span>
          </div>
          <div style={{ fontSize: 10, color: '#6B6458', fontFamily: 'ui-monospace, monospace' }}>{r.url}</div>
          <div style={{ fontSize: 10, color: '#8F877C', marginTop: 3 }}>
            {(r.platforms || []).filter(Boolean).join(', ')}
            {r.appVersions?.length ? ' · ' + r.appVersions.filter(Boolean).map(v => v.slice(0, 7)).join(', ') : ''}
          </div>
        </div>
      ))}
    </Card>
  );
}

// ─── Helpers ──────────────────────────────────────────────────
function MiniStat({ loading, label, main, sub }) {
  return (
    <Card className="ad-card-hover" style={{ padding: 14 }}>
      <div style={{ fontSize: 10, color: '#6B6458', textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: 6 }}>{label}</div>
      {loading
        ? <span className="ad-skel" style={{ width: 70, height: 24, display: 'inline-block' }}>0</span>
        : <div className="ad-count" style={{ fontSize: 22, fontWeight: 700 }}>{main ?? '—'}</div>}
      {sub && <div style={{ fontSize: 10, color: '#8F877C', marginTop: 3 }}>{sub}</div>}
    </Card>
  );
}
function fmtDuration(ms) {
  const n = Number(ms) || 0;
  if (!n) return '—';
  if (n < 1000) return n + 'ms';
  if (n < 60_000) return (n / 1000).toFixed(1) + 's';
  if (n < 3_600_000) return (n / 60_000).toFixed(1) + 'm';
  return (n / 3_600_000).toFixed(1) + 'h';
}
function bucketLabel(id) {
  if (id === 'other') return '> 24h';
  const map = {
    0: '0 – 10s', 10000: '10 – 30s', 30000: '30s – 1m',
    60000: '1m – 5m', 300000: '5m – 15m', 900000: '15m – 1h',
    3600000: '1h – 24h',
  };
  return map[id] || `> ${Math.round(id / 1000)}s`;
}
const cell = { padding: '6px 8px', borderBottom: '1px solid rgba(0,0,0,0.06)', textAlign: 'left' };
const cellHead = { ...cell, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.4, fontSize: 10, color: '#6B6458' };

window.AnalyticsTab = AnalyticsTab;
