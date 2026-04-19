// AdminApp.jsx — browser-based admin panel

function AdminShell({ state, setState, onPreview, liveMode, authed, onLogout, me, onPasswordChanged, onMeRefresh }) {
  const mustChange = !!(me && me.mustChangePassword);
  const [tab, setTab] = React.useState(mustChange ? 'security' : (liveMode ? 'dashboard' : 'buttons'));
  const theme = THEMES[state.theme] || THEMES.cream;

  React.useEffect(() => {
    if (mustChange && tab !== 'security') setTab('security');
  }, [mustChange, tab]);

  const isAdmin = !me || me.role === 'admin';
  const dashboardTab = liveMode ? [{ id: 'dashboard', label: 'หน้าหลัก', icon: 'sparkle' }] : [];
  const baseTabs = [
    { id: 'buttons', label: 'ปุ่มเมนู', icon: 'sparkle' },
    { id: 'banner',  label: 'แบนเนอร์', icon: 'image' },
    { id: 'contact', label: 'ติดต่อแอดมิน', icon: 'chat' },
    { id: 'download', label: 'ดาวน์โหลดแอป', icon: 'upload' },
    { id: 'theme',   label: 'ธีม & แบรนด์', icon: 'settings' },
  ];
  const adminOnlyTabs = liveMode ? [
    { id: 'security', label: 'ความปลอดภัย', icon: 'settings' },
    ...(isAdmin ? [
      { id: 'users', label: 'ผู้ดูแล', icon: 'heart' },
      { id: 'audit', label: 'บันทึกใช้งาน', icon: 'book' },
    ] : []),
  ] : [];
  const tabs = mustChange
    ? [{ id: 'security', label: 'เปลี่ยนรหัสผ่าน', icon: 'settings' }]
    : [...dashboardTab, ...baseTabs, ...adminOnlyTabs];

  // Responsive: on narrow viewports (Chrome frame collapsed), stack sidebar
  const vw = useViewportWidth2();
  const narrow = vw < 700;

  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: narrow ? '1fr' : '220px 1fr',
      height: '100%',
      fontFamily: '"IBM Plex Sans Thai", -apple-system, system-ui, sans-serif',
      color: '#1F1B17', background: '#FBFAF7',
    }}>
      <aside style={{
        background: '#F3EFE7', borderRight: narrow ? 'none' : '1px solid rgba(0,0,0,0.06)',
        borderBottom: narrow ? '1px solid rgba(0,0,0,0.06)' : 'none',
        padding: narrow ? '10px' : '20px 14px',
        display: 'flex',
        flexDirection: narrow ? 'row' : 'column',
        flexWrap: narrow ? 'wrap' : 'nowrap',
        gap: narrow ? 6 : 4,
        alignItems: narrow ? 'center' : 'stretch',
        overflowX: narrow ? 'auto' : 'visible',
      }}>
        {!narrow && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '6px 8px 18px' }}>
            <div style={{
              width: 28, height: 28, borderRadius: 8, background: '#1F1B17',
              color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontWeight: 700, fontSize: 13,
            }}>A</div>
            <div>
              <div style={{ fontSize: 13, fontWeight: 600 }}>Admin Console</div>
              <div style={{ fontSize: 11, color: '#6B6458' }}>v2.0 · {state.appName}</div>
            </div>
            {typeof SavedIndicator === 'function' && (
              <div style={{ marginLeft: 'auto' }}><SavedIndicator/></div>
            )}
          </div>
        )}
        {narrow && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginRight: 6 }}>
            <div style={{
              width: 22, height: 22, borderRadius: 6, background: '#1F1B17',
              color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontWeight: 700, fontSize: 11,
            }}>A</div>
            {typeof SavedIndicator === 'function' && <SavedIndicator/>}
          </div>
        )}
        {tabs.map(t => (
          <button key={t.id} onClick={() => setTab(t.id)} style={{
            display: 'flex', alignItems: 'center', gap: narrow ? 5 : 10,
            padding: narrow ? '6px 10px' : '10px 12px',
            borderRadius: narrow ? 999 : 10, border: narrow ? '1px solid rgba(0,0,0,0.08)' : 'none',
            background: tab === t.id ? '#fff' : (narrow ? '#fff' : 'transparent'),
            color: tab === t.id ? '#1F1B17' : '#6B6458',
            fontFamily: 'inherit', fontSize: narrow ? 11 : 13, fontWeight: tab === t.id ? 600 : 500,
            cursor: 'pointer', textAlign: 'left', whiteSpace: 'nowrap',
            boxShadow: tab === t.id ? '0 1px 2px rgba(0,0,0,0.06)' : 'none',
            transition: 'all 180ms ease',
          }}>
            <Icon name={t.icon} size={narrow ? 12 : 16} stroke={1.8}/>
            {t.label}
          </button>
        ))}
        {!narrow && <div style={{ flex: 1 }}/>}
        {!narrow && (
          <button onClick={onPreview} style={{
            display: 'flex', alignItems: 'center', gap: 8, justifyContent: 'center',
            padding: '10px 12px', borderRadius: 10, border: '1px solid rgba(0,0,0,0.1)',
            background: '#fff', fontFamily: 'inherit', fontSize: 12, cursor: 'pointer',
          }}>
            <Icon name="eye" size={15} stroke={1.8}/> ดูหน้าผู้ใช้
          </button>
        )}
        {!narrow && liveMode && authed && (
          <button onClick={onLogout} style={{
            marginTop: 6, display: 'flex', alignItems: 'center', gap: 8, justifyContent: 'center',
            padding: '10px 12px', borderRadius: 10, border: '1px solid rgba(180,70,58,0.25)',
            background: '#fff', color: '#B4463A',
            fontFamily: 'inherit', fontSize: 12, cursor: 'pointer',
          }}>
            <Icon name="x" size={14} stroke={2}/> ออกจากระบบ
          </button>
        )}
      </aside>

      <main key={tab} className="ad-tab" style={{ overflow: 'auto', padding: narrow ? '18px' : '28px 36px' }}>
        {tab === 'dashboard' && typeof DashboardTab === 'function' && <DashboardTab me={me} state={state}/>}
        {tab === 'buttons'  && <ButtonsEditor state={state} setState={setState}/>}
        {tab === 'banner'   && <BannerEditor state={state} setState={setState}/>}
        {tab === 'contact'  && <ContactEditor state={state} setState={setState}/>}
        {tab === 'download' && typeof DownloadLinksEditor === 'function' && <DownloadLinksEditor state={state} setState={setState}/>}
        {tab === 'theme'    && <ThemeEditor state={state} setState={setState}/>}
        {tab === 'security' && typeof SecurityTab === 'function' && <SecurityTab onLogout={onLogout} mustChange={mustChange} onPasswordChanged={onPasswordChanged} me={me} onMeRefresh={onMeRefresh}/>}
        {tab === 'users'    && typeof UsersTab    === 'function' && <UsersTab currentUserId={me && me.id}/>}
        {tab === 'audit'    && typeof AuditTab    === 'function' && <AuditTab/>}
        {narrow && liveMode && authed && (
          <div style={{ marginTop: 20, paddingTop: 16, borderTop: '1px solid rgba(0,0,0,0.06)', display: 'flex', justifyContent: 'center' }}>
            <button onClick={onLogout} style={{
              padding: '10px 20px', borderRadius: 10, border: '1px solid rgba(180,70,58,0.3)',
              background: '#fff', color: '#B4463A',
              fontFamily: 'inherit', fontSize: 13, cursor: 'pointer',
            }}>ออกจากระบบ</button>
          </div>
        )}
      </main>
    </div>
  );
}

function useViewportWidth2() {
  const [w, setW] = React.useState(typeof window !== 'undefined' ? window.innerWidth : 1280);
  React.useEffect(() => {
    const on = () => setW(window.innerWidth);
    window.addEventListener('resize', on);
    return () => window.removeEventListener('resize', on);
  }, []);
  return w;
}

function SectionHead({ title, sub, right }) {
  return (
    <div style={{ display: 'flex', alignItems: 'flex-end', marginBottom: 18, gap: 10, flexWrap: 'wrap' }}>
      <div style={{ flex: 1, minWidth: 180 }}>
        <div style={{ fontSize: 20, fontWeight: 700, letterSpacing: -0.2 }}>{title}</div>
        {sub && <div style={{ fontSize: 13, color: '#6B6458', marginTop: 3 }}>{sub}</div>}
      </div>
      {right}
    </div>
  );
}

function Card({ children, style }) {
  return (
    <div style={{
      background: '#fff', border: '1px solid rgba(0,0,0,0.06)',
      borderRadius: 14, padding: 16, ...style,
    }}>{children}</div>
  );
}

function Field({ label, children, hint }) {
  return (
    <label style={{ display: 'block', marginBottom: 14 }}>
      <div style={{ fontSize: 12, fontWeight: 600, color: '#3E3A34', marginBottom: 6 }}>{label}</div>
      {children}
      {hint && <div style={{ fontSize: 11, color: '#8F877C', marginTop: 4 }}>{hint}</div>}
    </label>
  );
}

function TextInput({ maxLength = 200, onChange, autoComplete = 'off', spellCheck = 'false', ...props }) {
  const handle = (e) => {
    if (!onChange) return;
    const raw = e.target.value;
    const clean = (typeof safeText === 'function') ? safeText(raw, maxLength) : raw.slice(0, maxLength);
    onChange({ ...e, target: { ...e.target, value: clean } });
  };
  return <input
    {...props}
    autoComplete={autoComplete}
    spellCheck={spellCheck}
    maxLength={maxLength}
    onChange={handle}
    style={{
      width: '100%', padding: '9px 12px', borderRadius: 9,
      border: '1px solid rgba(0,0,0,0.12)', background: '#fff',
      fontFamily: 'inherit', fontSize: 13, color: '#1F1B17',
      boxSizing: 'border-box', outline: 'none',
      ...(props.style || {}),
    }}/>;
}

function UrlInput({ value, onChange, placeholder, maxLength = 2048 }) {
  const safe = (typeof safeUrl === 'function') ? safeUrl(value || '') : (value || '');
  const invalid = value && value.trim() && !safe;
  return (
    <div style={{ flex: 1 }}>
      <input
        type="url"
        value={value || ''}
        maxLength={maxLength}
        autoComplete="off"
        spellCheck="false"
        placeholder={placeholder}
        onChange={e => {
          const raw = e.target.value.replace(/[\x00-\x1F\x7F]/g, '').slice(0, maxLength);
          onChange(raw);
        }}
        style={{
          width: '100%', padding: '9px 12px', borderRadius: 9,
          border: invalid ? '1px solid #B4463A' : '1px solid rgba(0,0,0,0.12)',
          background: '#fff', fontFamily: 'inherit', fontSize: 13,
          color: '#1F1B17', boxSizing: 'border-box', outline: 'none',
        }}
      />
      {invalid && <div style={{ fontSize: 11, color: '#B4463A', marginTop: 3 }}>
        ลิงก์ไม่ปลอดภัย — รองรับเฉพาะ https://, tel:, mailto:, line://, whatsapp://
      </div>}
    </div>
  );
}

// ─── Buttons Editor ──────────────────────────────────────────
function ButtonsEditor({ state, setState }) {
  const [editing, setEditing] = React.useState(null);

  const update = (id, patch) => setState(s => ({
    ...s, buttons: s.buttons.map(b => b.id === id ? { ...b, ...patch } : b),
  }));
  const remove = (id) => setState(s => ({ ...s, buttons: s.buttons.filter(b => b.id !== id) }));
  const add = () => {
    if (state.buttons.length >= 12) return;
    const id = 'q' + Math.random().toString(36).slice(2, 7);
    setState(s => ({ ...s, buttons: [...s.buttons, { id, label: 'ปุ่มใหม่', sub: '', icon: 'sparkle', url: '', tags: [] }] }));
    setEditing(id);
  };

  const ICONS = ['leaf','star','tag','book','truck','pin','heart','gift','calendar','chat','camera','music','sparkle'];
  const renderRow = (b, i, { handle }) => (
    <Card key={b.id} style={{ padding: 14, marginBottom: 8 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        {handle}
        <div style={{
          width: 40, height: 40, borderRadius: 11, background: THEMES[state.theme].accent,
          color: THEMES[state.theme].accentInk, display: 'flex',
          alignItems: 'center', justifyContent: 'center', flexShrink: 0,
        }}>
          <Icon name={b.icon} size={20} stroke={2}/>
        </div>
        {editing === b.id ? (
          <div style={{ flex: 1, minWidth: 260, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            <TextInput maxLength={MAX_LABEL} value={b.label} onChange={e => update(b.id, { label: e.target.value })} placeholder="ชื่อปุ่ม"/>
            <TextInput maxLength={MAX_SUB} value={b.sub} onChange={e => update(b.id, { sub: e.target.value })} placeholder="คำอธิบาย"/>
            <div style={{ gridColumn: '1 / -1', display: 'flex', gap: 6, alignItems: 'center' }}>
              <div style={{ width: 28, height: 28, borderRadius: 7, background: '#F3EFE7', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#6B6458', flexShrink: 0 }}>
                <Icon name="external" size={14} stroke={1.8}/>
              </div>
              <UrlInput value={b.url || ''} onChange={v => update(b.id, { url: v })} placeholder="https://example.com หรือ tel:0812345678"/>
            </div>
            <div style={{ gridColumn: '1 / -1', display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {ICONS.map(n => (
                <button key={n} onClick={() => update(b.id, { icon: n })} style={{
                  width: 32, height: 32, borderRadius: 8,
                  border: b.icon === n ? '2px solid #1F1B17' : '1px solid rgba(0,0,0,0.1)',
                  background: b.icon === n ? '#1F1B17' : '#fff',
                  color: b.icon === n ? '#fff' : '#1F1B17', cursor: 'pointer',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0,
                }}><Icon name={n} size={16} stroke={1.8}/></button>
              ))}
            </div>
            <div style={{ gridColumn: '1 / -1', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, marginTop: 4 }}>
              <label style={{ fontSize: 11, color: '#6B6458' }}>
                เผยแพร่ตั้งแต่
                <input type="datetime-local" value={toLocalDt(b.publishAt)}
                  onChange={e => update(b.id, { publishAt: e.target.value ? new Date(e.target.value).toISOString() : null })}
                  style={{ ...smallInput }}/>
              </label>
              <label style={{ fontSize: 11, color: '#6B6458' }}>
                หยุดเผยแพร่
                <input type="datetime-local" value={toLocalDt(b.unpublishAt)}
                  onChange={e => update(b.id, { unpublishAt: e.target.value ? new Date(e.target.value).toISOString() : null })}
                  style={{ ...smallInput }}/>
              </label>
            </div>
            <div style={{ gridColumn: '1 / -1' }}>
              <input type="text" value={(b.tags || []).join(', ')}
                onChange={e => {
                  const tags = e.target.value.split(',').map(t => t.trim().toLowerCase()).filter(Boolean).slice(0, 6);
                  update(b.id, { tags });
                }}
                placeholder="แท็ก เช่น อาหาร, โปรโมชั่น (คั่นด้วย ,)"
                style={{ ...smallInput }}/>
            </div>
          </div>
        ) : (
          <div style={{ flex: 1, minWidth: 200 }}>
            <div style={{ fontSize: 14, fontWeight: 600 }}>{b.label}</div>
            <div style={{ fontSize: 12, color: '#6B6458', marginTop: 1, display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
              {b.url ? <>
                <Icon name="external" size={11} stroke={2} color="#8F877C"/>
                <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 260 }}>{b.url}</span>
              </> : <span style={{ fontStyle: 'italic', color: '#B4463A', opacity: 0.7 }}>— ยังไม่ได้ใส่ลิงก์ —</span>}
              {b.publishAt && <span style={{ padding: '1px 6px', borderRadius: 4, background: 'rgba(210,150,40,0.15)', color: '#7A5A10', fontSize: 10 }}>⏱</span>}
              {(b.tags || []).slice(0, 3).map(t => (
                <span key={t} style={{ padding: '1px 6px', borderRadius: 4, background: '#F3EFE7', fontSize: 10 }}>#{t}</span>
              ))}
            </div>
            {b.sub && <div style={{ fontSize: 11, color: '#8F877C', marginTop: 2 }}>{b.sub}</div>}
          </div>
        )}
        <button onClick={() => setEditing(editing === b.id ? null : b.id)} style={iconBtn}>
          <Icon name={editing === b.id ? 'check' : 'edit'} size={15} stroke={1.8}/>
        </button>
        <button onClick={() => remove(b.id)} style={{ ...iconBtn, color: '#B4463A' }}>
          <Icon name="trash" size={15} stroke={1.8}/>
        </button>
      </div>
    </Card>
  );

  return (
    <div>
      <SectionHead
        title="ปุ่มเมนูบนหน้าผู้ใช้"
        sub={`ตั้งได้ 1–12 ปุ่ม · ลากลำดับได้ · ตั้งเวลาเผยแพร่ได้ · ขณะนี้ ${state.buttons.length} ปุ่ม`}
        right={
          <button onClick={add} disabled={state.buttons.length >= 12} style={{
            display: 'flex', alignItems: 'center', gap: 6,
            padding: '8px 14px', borderRadius: 9, border: 'none',
            background: '#1F1B17', color: '#fff', fontFamily: 'inherit',
            fontSize: 13, fontWeight: 500,
            cursor: state.buttons.length >= 12 ? 'not-allowed' : 'pointer',
            opacity: state.buttons.length >= 12 ? 0.4 : 1,
          }}>
            <Icon name="plus" size={14} stroke={2.2}/> เพิ่มปุ่ม
          </button>
        }
      />
      {typeof DragList === 'function' ? (
        <DragList
          items={state.buttons}
          onReorder={next => setState(s => ({ ...s, buttons: next }))}
          itemKey={it => it.id}
        >
          {renderRow}
        </DragList>
      ) : (
        state.buttons.map((b, i) => renderRow(b, i, { handle: null }))
      )}
    </div>
  );
}

function toLocalDt(v) {
  if (!v) return '';
  try {
    const d = new Date(v);
    const off = d.getTimezoneOffset() * 60000;
    return new Date(d.getTime() - off).toISOString().slice(0, 16);
  } catch { return ''; }
}

const smallInput = {
  width: '100%', padding: '7px 10px', borderRadius: 7,
  border: '1px solid rgba(0,0,0,0.12)', background: '#fff',
  fontFamily: 'inherit', fontSize: 12, color: '#1F1B17',
  boxSizing: 'border-box', outline: 'none', marginTop: 4,
};
const iconBtn = {
  width: 32, height: 32, borderRadius: 8,
  border: '1px solid rgba(0,0,0,0.1)', background: '#fff',
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  cursor: 'pointer', color: '#1F1B17', padding: 0,
};

// ─── Banner Editor ────────────────────────────────────────────
function BannerEditor({ state, setState }) {
  const TONES = ['leaf','sun','clay','sky','plum'];
  const update = (id, patch) => setState(s => ({
    ...s, banners: s.banners.map(b => b.id === id ? { ...b, ...patch } : b),
  }));
  const remove = (id) => setState(s => ({ ...s, banners: s.banners.filter(b => b.id !== id) }));
  const add = () => {
    const id = 'b' + Math.random().toString(36).slice(2, 7);
    setState(s => ({ ...s, banners: [...s.banners, { id, title: 'แบนเนอร์ใหม่', subtitle: '', tone: 'sky', imageUrl: '', linkUrl: '' }] }));
  };

  const uploadFor = async (id, file) => {
    if (!file) return;
    if (!/^image\//.test(file.type)) { toast.error('ต้องเป็นไฟล์รูปภาพ'); return; }
    if (file.size > 2 * 1024 * 1024) { toast.error('ไฟล์ต้องไม่เกิน 2 MB'); return; }
    try {
      toast.info('กำลังอัปโหลด…', 1200);
      const r = await api.uploadBanner(file);
      update(id, { imageUrl: r.url });
      toast.success('อัปโหลดแล้ว');
    } catch (e) {
      toast.error(e.message === 'file_too_large' ? 'ไฟล์ใหญ่เกินไป' :
                  e.message === 'unsupported_media_type' ? 'ชนิดไฟล์ไม่รองรับ' :
                  e.message === 'forbidden' ? 'ต้อง login' :
                  'อัปโหลดไม่สำเร็จ');
    }
  };

  return (
    <div>
      <SectionHead
        title="แบนเนอร์ & ภาพหัวหน้าเพจ"
        sub="เพิ่มได้ไม่จำกัด · อัปโหลดภาพ ≤ 2 MB (JPG/PNG/WEBP) · ธีมสีเป็น fallback ถ้าไม่มีรูป"
        right={
          <button onClick={add} style={{
            display: 'flex', alignItems: 'center', gap: 6, padding: '8px 14px',
            borderRadius: 9, border: 'none', background: '#1F1B17', color: '#fff',
            fontFamily: 'inherit', fontSize: 13, cursor: 'pointer',
          }}>
            <Icon name="plus" size={14} stroke={2.2}/> เพิ่มแบนเนอร์
          </button>
        }
      />
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 12 }}>
        {state.banners.map(b => (
          <Card key={b.id}>
            <div style={{
              height: 120, borderRadius: 10, marginBottom: 12, position: 'relative', overflow: 'hidden',
              background: b.imageUrl ? '#000' : BANNER_TONES[b.tone],
              color: '#fff', padding: 14, display: 'flex', flexDirection: 'column', justifyContent: 'flex-end',
            }}>
              {b.imageUrl && (
                <img src={b.imageUrl} alt="" style={{
                  position: 'absolute', inset: 0, width: '100%', height: '100%',
                  objectFit: 'cover', opacity: 0.85,
                }}/>
              )}
              <div style={{ position: 'relative', zIndex: 1 }}>
                <div style={{ fontSize: 14, fontWeight: 700, textShadow: b.imageUrl ? '0 1px 4px rgba(0,0,0,0.5)' : 'none' }}>{b.title || '—'}</div>
                <div style={{ fontSize: 11, opacity: 0.95, textShadow: b.imageUrl ? '0 1px 4px rgba(0,0,0,0.5)' : 'none' }}>{b.subtitle || '—'}</div>
              </div>
            </div>
            <Field label="หัวเรื่อง">
              <TextInput maxLength={MAX_LABEL} value={b.title} onChange={e => update(b.id, { title: e.target.value })}/>
            </Field>
            <Field label="คำอธิบาย">
              <TextInput maxLength={MAX_SUB} value={b.subtitle} onChange={e => update(b.id, { subtitle: e.target.value })}/>
            </Field>
            <Field label="ลิงก์เมื่อกด (ไม่บังคับ)">
              <UrlInput value={b.linkUrl || ''} onChange={v => update(b.id, { linkUrl: v })} placeholder="https://..."/>
            </Field>
            <Field label="โทนสี (ใช้เมื่อไม่มีภาพ)">
              <div style={{ display: 'flex', gap: 6 }}>
                {TONES.map(t => (
                  <button key={t} onClick={() => update(b.id, { tone: t })} style={{
                    flex: 1, height: 32, borderRadius: 8, cursor: 'pointer',
                    border: b.tone === t ? '2px solid #1F1B17' : '1px solid rgba(0,0,0,0.1)',
                    background: BANNER_TONES[t],
                  }}/>
                ))}
              </div>
            </Field>
            <div style={{ display: 'flex', gap: 6, marginTop: 4 }}>
              <label style={{
                flex: 1, padding: '8px', borderRadius: 8, cursor: 'pointer',
                border: '1px dashed rgba(0,0,0,0.15)', background: '#FBFAF7',
                fontFamily: 'inherit', fontSize: 12, color: '#6B6458',
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
              }}>
                <Icon name="upload" size={13} stroke={1.8}/>
                {b.imageUrl ? 'เปลี่ยนรูป' : 'อัปโหลดรูป'}
                <input type="file" accept="image/*" style={{ display: 'none' }}
                  onChange={e => uploadFor(b.id, e.target.files?.[0])}/>
              </label>
              {b.imageUrl && (
                <button onClick={() => update(b.id, { imageUrl: '' })} style={{
                  ...iconBtn, width: 36, color: '#7A5A10',
                }} title="ลบรูป">
                  <Icon name="x" size={14} stroke={2}/>
                </button>
              )}
              <button onClick={() => remove(b.id)} style={{ ...iconBtn, color: '#B4463A', width: 36 }}>
                <Icon name="trash" size={14} stroke={1.8}/>
              </button>
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}

// ─── Contact Editor ──────────────────────────────────────────
function ContactEditor({ state, setState }) {
  const setContact = (patch) => setState(s => ({ ...s, contact: { ...s.contact, ...patch } }));
  return (
    <div>
      <SectionHead title="ปุ่มติดต่อแอดมิน" sub="จะแสดงใต้ปุ่มเมนูบนหน้าผู้ใช้"/>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 16 }}>
        <Card>
          <Field label="ช่องทางการติดต่อ">
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
              {Object.entries(CHANNELS).map(([k, ch]) => (
                <button key={k} onClick={() => setContact({ channel: k })} style={{
                  padding: '10px 12px', borderRadius: 10, cursor: 'pointer',
                  border: state.contact.channel === k ? '2px solid #1F1B17' : '1px solid rgba(0,0,0,0.1)',
                  background: '#fff', fontFamily: 'inherit', fontSize: 13,
                  display: 'flex', alignItems: 'center', gap: 10, textAlign: 'left',
                }}>
                  <div style={{
                    width: 28, height: 28, borderRadius: 7, background: ch.color, color: '#fff',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                  }}><Icon name={k} size={16} stroke={1.8}/></div>
                  {ch.name}
                </button>
              ))}
            </div>
          </Field>
          <Field label="ข้อความบนปุ่ม">
            <TextInput maxLength={MAX_LABEL} value={state.contact.label} onChange={e => setContact({ label: e.target.value })}/>
          </Field>
          <Field label={CHANNELS[state.contact.channel].hint} hint="ข้อมูลที่จะเปิดเมื่อผู้ใช้กดปุ่ม">
            <TextInput maxLength={MAX_VALUE} value={state.contact.value} onChange={e => setContact({ value: e.target.value })}/>
          </Field>
        </Card>
        <Card style={{ background: '#F3EFE7', display: 'flex', flexDirection: 'column' }}>
          <div style={{ fontSize: 12, color: '#6B6458', marginBottom: 10 }}>พรีวิวปุ่ม</div>
          <div style={{ flex: 1, display: 'flex', alignItems: 'center' }}>
            <ContactButton contact={state.contact} theme={THEMES[state.theme]} />
          </div>
        </Card>
      </div>
    </div>
  );
}

// ─── Theme Editor ────────────────────────────────────────────
function ThemeEditor({ state, setState }) {
  const set = (patch) => setState(s => ({ ...s, ...patch }));
  return (
    <div>
      <SectionHead title="ธีม & แบรนด์" sub="ชื่อแอป · ไอคอน · ธีม · ภาษา · โหมดมืด"/>
      <Card style={{ marginBottom: 16 }}>
        <AppIconUploader
          value={state.appIcon || ''}
          appName={state.appName}
          onChange={(url) => set({ appIcon: url })}
        />
      </Card>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 16 }}>
        <Card>
          <Field label="ชื่อแอป" hint="แสดงบน title เบราว์เซอร์, หน้าติดตั้ง, และ admin topbar">
            <TextInput maxLength={MAX_APPNAME} value={state.appName} onChange={e => set({ appName: e.target.value })}/>
          </Field>
          <Field label="คำโปรย">
            <TextInput maxLength={MAX_TAGLINE} value={state.tagline} onChange={e => set({ tagline: e.target.value })}/>
          </Field>
          <Field label="ภาษาเริ่มต้น">
            <select value={state.language || 'th'} onChange={e => set({ language: e.target.value })} style={smallInput}>
              <option value="th">ไทย</option>
              <option value="en">English</option>
            </select>
          </Field>
          <Field label="โหมดมืดสำหรับหน้าผู้ใช้">
            <select value={state.darkMode || 'auto'} onChange={e => set({ darkMode: e.target.value })} style={smallInput}>
              <option value="auto">ตามระบบ</option>
              <option value="light">สว่างเสมอ</option>
              <option value="dark">มืดเสมอ</option>
            </select>
          </Field>
        </Card>
        <Card>
          <Field label="ธีมสี">
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
              {Object.entries(THEMES).map(([k, t]) => (
                <button key={k} onClick={() => set({ theme: k })} style={{
                  padding: 10, borderRadius: 10, cursor: 'pointer',
                  border: state.theme === k ? '2px solid #1F1B17' : '1px solid rgba(0,0,0,0.1)',
                  background: t.bg, fontFamily: 'inherit', fontSize: 12, fontWeight: 600,
                  color: t.ink, display: 'flex', alignItems: 'center', gap: 10, textAlign: 'left',
                }}>
                  <div style={{ width: 28, height: 28, borderRadius: 7, background: t.accent }}/>
                  {k}
                </button>
              ))}
            </div>
          </Field>
        </Card>
      </div>
    </div>
  );
}

// ─── AppIconUploader ────────────────────────────────────────
// Square image that the admin sets once; wired into favicon / document
// title / install-page hero via runtime DOM updates in index.html.
// Reuses the banner upload endpoint (2 MiB image, same validation).
function AppIconUploader({ value, appName, onChange }) {
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState(null);
  const fileRef = React.useRef(null);
  const pick = () => fileRef.current?.click();

  const upload = async (file) => {
    if (!file) return;
    if (!/^image\//.test(file.type)) { setError('ต้องเป็นไฟล์รูปเท่านั้น'); return; }
    if (file.size > 2 * 1024 * 1024) { setError('ไฟล์ใหญ่เกิน 2 MB'); return; }
    setError(null); setBusy(true);
    try {
      const r = await api.uploadBanner(file);
      onChange(r.url);
      if (typeof toast !== 'undefined') toast.success('อัปโหลดไอคอนแล้ว');
    } catch (e) {
      if (e.message === 'file_too_large') setError('ไฟล์ใหญ่เกิน 2 MB');
      else if (e.message === 'unsupported_media_type') setError('รองรับ JPG/PNG/WebP/GIF เท่านั้น');
      else setError('อัปโหลดไม่สำเร็จ: ' + (e.message || ''));
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const clear = () => onChange('');

  return (
    <div>
      <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 4 }}>ไอคอนแอป</div>
      <div style={{ fontSize: 11, color: '#6B6458', marginBottom: 10, lineHeight: 1.5 }}>
        รูปสี่เหลี่ยมจัตุรัส · ≤2 MB · PNG/WebP แนะนำ · แสดงเป็น favicon, ไอคอนบนหน้าติดตั้ง, และ admin topbar
      </div>
      <div style={{ display: 'flex', gap: 14, alignItems: 'center' }}>
        <div style={{
          width: 72, height: 72, borderRadius: 16, flexShrink: 0,
          background: value ? '#fff' : 'rgba(31,27,23,0.08)',
          border: '1px solid rgba(0,0,0,0.08)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          overflow: 'hidden',
        }}>
          {value
            ? <img src={value} alt="app icon" style={{ width: '100%', height: '100%', objectFit: 'cover' }}/>
            : <div style={{ fontSize: 28, fontWeight: 700, color: '#6B6458' }}>
                {(appName || 'A').slice(0, 1).toUpperCase()}
              </div>}
        </div>
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 6 }}>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            <button onClick={pick} disabled={busy} style={{
              padding: '7px 14px', borderRadius: 8, border: 'none',
              background: '#1F1B17', color: '#fff', fontFamily: 'inherit',
              fontSize: 12, fontWeight: 600, cursor: busy ? 'wait' : 'pointer',
              opacity: busy ? 0.6 : 1,
            }}>{busy ? 'กำลังอัปโหลด…' : (value ? 'เปลี่ยนรูป' : 'อัปโหลดรูป')}</button>
            {value && (
              <button onClick={clear} disabled={busy} style={{
                padding: '7px 14px', borderRadius: 8,
                border: '1px solid rgba(0,0,0,0.12)', background: '#fff',
                color: '#1F1B17', fontFamily: 'inherit', fontSize: 12, cursor: 'pointer',
              }}>ลบ</button>
            )}
          </div>
          <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp,image/gif"
            style={{ display: 'none' }}
            onChange={e => upload(e.target.files?.[0])}/>
          {error && <div style={{ fontSize: 11, color: '#B4463A' }}>{error}</div>}
        </div>
      </div>
    </div>
  );
}

Object.assign(window, { AdminShell, SectionHead, Card, Field, TextInput, UrlInput, AppIconUploader });
