// AdminApp.jsx — browser-based admin panel

function AdminShell({ state, setState, onPreview, liveMode, authed, onLogout, me }) {
  const [tab, setTab] = React.useState('buttons');
  const theme = THEMES[state.theme] || THEMES.cream;

  const isAdmin = !me || me.role === 'admin';   // demo mode → assume admin
  const baseTabs = [
    { id: 'buttons', label: 'ปุ่มเมนู', icon: 'sparkle' },
    { id: 'banner',  label: 'แบนเนอร์', icon: 'image' },
    { id: 'contact', label: 'ติดต่อแอดมิน', icon: 'chat' },
    { id: 'theme',   label: 'ธีม & แบรนด์', icon: 'settings' },
  ];
  const adminOnlyTabs = liveMode ? [
    { id: 'security', label: 'ความปลอดภัย', icon: 'settings', adminOnly: false },
    ...(isAdmin ? [
      { id: 'users', label: 'ผู้ดูแล', icon: 'heart', adminOnly: true },
      { id: 'audit', label: 'บันทึกใช้งาน', icon: 'book', adminOnly: true },
    ] : []),
  ] : [];
  const tabs = [...baseTabs, ...adminOnlyTabs];

  return (
    <div style={{
      display: 'grid', gridTemplateColumns: '220px 1fr', height: '100%',
      fontFamily: '"IBM Plex Sans Thai", -apple-system, system-ui, sans-serif',
      color: '#1F1B17', background: '#FBFAF7',
    }}>
      {/* sidebar */}
      <aside style={{
        background: '#F3EFE7', borderRight: '1px solid rgba(0,0,0,0.06)',
        padding: '20px 14px', display: 'flex', flexDirection: 'column', gap: 4,
      }}>
        <div style={{
          display: 'flex', alignItems: 'center', gap: 10, padding: '6px 8px 18px',
        }}>
          <div style={{
            width: 28, height: 28, borderRadius: 8, background: '#1F1B17',
            color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontWeight: 700, fontSize: 13,
          }}>A</div>
          <div>
            <div style={{ fontSize: 13, fontWeight: 600 }}>Admin Console</div>
            <div style={{ fontSize: 11, color: '#6B6458' }}>v1.0 · {state.appName}</div>
          </div>
        </div>
        {tabs.map(t => (
          <button key={t.id} onClick={() => setTab(t.id)} style={{
            display: 'flex', alignItems: 'center', gap: 10,
            padding: '10px 12px', borderRadius: 10, border: 'none',
            background: tab === t.id ? '#fff' : 'transparent',
            color: tab === t.id ? '#1F1B17' : '#6B6458',
            fontFamily: 'inherit', fontSize: 13, fontWeight: tab === t.id ? 600 : 500,
            cursor: 'pointer', textAlign: 'left',
            boxShadow: tab === t.id ? '0 1px 2px rgba(0,0,0,0.06)' : 'none',
            transition: 'all 180ms ease',
          }}>
            <Icon name={t.icon} size={16} stroke={1.8}/>
            {t.label}
          </button>
        ))}
        <div style={{ flex: 1 }}/>
        <button onClick={onPreview} style={{
          display: 'flex', alignItems: 'center', gap: 8, justifyContent: 'center',
          padding: '10px 12px', borderRadius: 10, border: '1px solid rgba(0,0,0,0.1)',
          background: '#fff', fontFamily: 'inherit', fontSize: 12, cursor: 'pointer',
        }}>
          <Icon name="eye" size={15} stroke={1.8}/> ดูหน้าผู้ใช้
        </button>
        {liveMode && authed && (
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

      {/* main */}
      <main key={tab} className="ad-tab" style={{ overflow: 'auto', padding: '28px 36px' }}>
        {tab === 'buttons'  && <ButtonsEditor state={state} setState={setState}/>}
        {tab === 'banner'   && <BannerEditor state={state} setState={setState}/>}
        {tab === 'contact'  && <ContactEditor state={state} setState={setState}/>}
        {tab === 'theme'    && <ThemeEditor state={state} setState={setState}/>}
        {tab === 'security' && typeof SecurityTab === 'function' && <SecurityTab onLogout={onLogout}/>}
        {tab === 'users'    && typeof UsersTab    === 'function' && <UsersTab currentUserId={me && me.id}/>}
        {tab === 'audit'    && typeof AuditTab    === 'function' && <AuditTab/>}
      </main>
    </div>
  );
}

function SectionHead({ title, sub, right }) {
  return (
    <div style={{ display: 'flex', alignItems: 'flex-end', marginBottom: 18 }}>
      <div style={{ flex: 1 }}>
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
    setState(s => ({ ...s, buttons: [...s.buttons, { id, label: 'ปุ่มใหม่', sub: '', icon: 'sparkle', url: '' }] }));
    setEditing(id);
  };
  const move = (idx, dir) => {
    const next = idx + dir;
    if (next < 0 || next >= state.buttons.length) return;
    setState(s => {
      const arr = [...s.buttons];
      [arr[idx], arr[next]] = [arr[next], arr[idx]];
      return { ...s, buttons: arr };
    });
  };

  const ICONS = ['leaf','star','tag','book','truck','pin','heart','gift','calendar','chat','camera','music','sparkle'];

  return (
    <div>
      <SectionHead
        title="ปุ่มเมนูบนหน้าผู้ใช้"
        sub={`ตั้งค่าได้ 1–12 ปุ่ม · ขณะนี้ ${state.buttons.length} ปุ่ม`}
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
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {state.buttons.map((b, i) => (
          <Card key={b.id} style={{ padding: 14 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                <button onClick={() => move(i, -1)} style={arrowBtn}>▲</button>
                <button onClick={() => move(i, 1)} style={arrowBtn}>▼</button>
              </div>
              <div style={{
                width: 40, height: 40, borderRadius: 11, background: THEMES[state.theme].accent,
                color: THEMES[state.theme].accentInk, display: 'flex',
                alignItems: 'center', justifyContent: 'center', flexShrink: 0,
              }}>
                <Icon name={b.icon} size={20} stroke={2}/>
              </div>
              {editing === b.id ? (
                <div style={{ flex: 1, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                  <TextInput maxLength={MAX_LABEL} value={b.label} onChange={e => update(b.id, { label: e.target.value })} placeholder="ชื่อปุ่ม"/>
                  <TextInput maxLength={MAX_SUB} value={b.sub} onChange={e => update(b.id, { sub: e.target.value })} placeholder="คำอธิบาย (ไม่บังคับ)"/>
                  <div style={{ gridColumn: '1 / -1', display: 'flex', gap: 6, alignItems: 'center' }}>
                    <div style={{
                      width: 28, height: 28, borderRadius: 7, background: '#F3EFE7',
                      display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
                      color: '#6B6458',
                    }}>
                      <Icon name="external" size={14} stroke={1.8}/>
                    </div>
                    <UrlInput
                      value={b.url || ''}
                      onChange={v => update(b.id, { url: v })}
                      placeholder="https://example.com หรือ tel:0812345678"
                    />
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
                </div>
              ) : (
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 14, fontWeight: 600 }}>{b.label}</div>
                  <div style={{ fontSize: 12, color: '#6B6458', marginTop: 1, display: 'flex', alignItems: 'center', gap: 6 }}>
                    {b.url ? (
                      <>
                        <Icon name="external" size={11} stroke={2} color="#8F877C"/>
                        <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 260 }}>{b.url}</span>
                      </>
                    ) : (
                      <span style={{ fontStyle: 'italic', color: '#B4463A', opacity: 0.7 }}>— ยังไม่ได้ใส่ลิงก์ —</span>
                    )}
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
        ))}
      </div>
    </div>
  );
}

const arrowBtn = {
  width: 22, height: 18, fontSize: 8, border: '1px solid rgba(0,0,0,0.1)',
  background: '#FBFAF7', borderRadius: 4, cursor: 'pointer', color: '#6B6458',
  padding: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
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
    setState(s => ({ ...s, banners: [...s.banners, { id, title: 'แบนเนอร์ใหม่', subtitle: '', tone: 'sky' }] }));
  };

  return (
    <div>
      <SectionHead
        title="แบนเนอร์ & ภาพหัวหน้าเพจ"
        sub="เพิ่มได้ไม่จำกัด · จะหมุนอัตโนมัติทุก 3.8 วิ ในหน้าผู้ใช้"
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
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        {state.banners.map(b => (
          <Card key={b.id}>
            <div style={{
              height: 100, borderRadius: 10, marginBottom: 12,
              background: BANNER_TONES[b.tone], position: 'relative', overflow: 'hidden',
              color: '#fff', padding: 14, display: 'flex', flexDirection: 'column', justifyContent: 'flex-end',
            }}>
              <div style={{ fontSize: 14, fontWeight: 700 }}>{b.title || '—'}</div>
              <div style={{ fontSize: 11, opacity: 0.9 }}>{b.subtitle || '—'}</div>
            </div>
            <Field label="หัวเรื่อง">
              <TextInput maxLength={MAX_LABEL} value={b.title} onChange={e => update(b.id, { title: e.target.value })}/>
            </Field>
            <Field label="คำอธิบาย">
              <TextInput maxLength={MAX_SUB} value={b.subtitle} onChange={e => update(b.id, { subtitle: e.target.value })}/>
            </Field>
            <Field label="โทนสี">
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
              <button style={{
                flex: 1, padding: '8px', borderRadius: 8, cursor: 'pointer',
                border: '1px dashed rgba(0,0,0,0.15)', background: '#FBFAF7',
                fontFamily: 'inherit', fontSize: 12, color: '#6B6458',
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
              }}>
                <Icon name="upload" size={13} stroke={1.8}/> อัปโหลดภาพ
              </button>
              <button onClick={() => remove(b.id)} style={{
                ...iconBtn, color: '#B4463A', width: 36,
              }}><Icon name="trash" size={14} stroke={1.8}/></button>
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
      <div style={{ display: 'grid', gridTemplateColumns: '1.1fr 1fr', gap: 16 }}>
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
          <Field label="ข้อความบนปุ่ม (ตั้งชื่อได้)">
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
      <SectionHead title="ธีม & แบรนด์" sub="เลือกธีมและตั้งชื่อแอป"/>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
        <Card>
          <Field label="ชื่อแอป">
            <TextInput maxLength={MAX_APPNAME} value={state.appName} onChange={e => set({ appName: e.target.value })}/>
          </Field>
          <Field label="คำโปรย">
            <TextInput maxLength={MAX_TAGLINE} value={state.tagline} onChange={e => set({ tagline: e.target.value })}/>
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
                  <div style={{
                    width: 28, height: 28, borderRadius: 7, background: t.accent,
                  }}/>
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

// Expose shared primitives so admin-tabs.jsx (loaded in a separate script)
// can reuse them without duplicating.
Object.assign(window, { AdminShell, SectionHead, Card, Field, TextInput, UrlInput });
