// UserApp.jsx — home page the end-user sees (inside iOS frame)

function BannerCard({ banner, theme, idx }) {
  const bg = BANNER_TONES[banner.tone] || BANNER_TONES.leaf;
  const hasImage = !!banner.imageUrl;
  const clickable = !!banner.linkUrl;
  const onClick = () => {
    if (!clickable) return;
    if (typeof openExternal === 'function') openExternal(banner.linkUrl);
    else window.open(banner.linkUrl, '_blank', 'noopener,noreferrer');
  };
  return (
    <div
      onClick={onClick}
      style={{
        width: '100%', height: '100%', borderRadius: 24, overflow: 'hidden',
        position: 'relative', background: hasImage ? '#000' : bg,
        boxShadow: '0 10px 30px -12px rgba(0,0,0,0.25)',
        cursor: clickable ? 'pointer' : 'default',
    }}>
      {hasImage && (
        <img src={banner.imageUrl} alt="" style={{
          position: 'absolute', inset: 0, width: '100%', height: '100%',
          objectFit: 'cover', opacity: 0.88,
        }}/>
      )}
      {!hasImage && (
        <svg width="100%" height="100%" style={{ position: 'absolute', inset: 0, opacity: 0.14 }}>
          <defs>
            <pattern id={`dots-${banner.id}`} x="0" y="0" width="18" height="18" patternUnits="userSpaceOnUse">
              <circle cx="2" cy="2" r="1" fill="#fff"/>
            </pattern>
          </defs>
          <rect width="100%" height="100%" fill={`url(#dots-${banner.id})`}/>
        </svg>
      )}
      {!hasImage && <>
        <div style={{ position: 'absolute', right: -30, top: -30, width: 160, height: 160, borderRadius: '50%', background: 'rgba(255,255,255,0.18)' }}/>
        <div style={{ position: 'absolute', right: 20, bottom: -50, width: 120, height: 120, borderRadius: '50%', background: 'rgba(255,255,255,0.10)' }}/>
      </>}
      <div style={{
        position: 'relative', padding: '22px 22px', height: '100%',
        display: 'flex', flexDirection: 'column', justifyContent: 'flex-end',
        color: '#fff',
        textShadow: hasImage ? '0 1px 6px rgba(0,0,0,0.5)' : 'none',
        background: hasImage ? 'linear-gradient(180deg, rgba(0,0,0,0.05) 0%, rgba(0,0,0,0.5) 100%)' : 'transparent',
      }}>
        <div style={{
          fontSize: 12, letterSpacing: 1.4, opacity: 0.85, textTransform: 'uppercase',
          fontWeight: 600, marginBottom: 8,
        }}>แบนเนอร์ · {String(idx + 1).padStart(2, '0')}</div>
        <div style={{ fontSize: 24, fontWeight: 700, lineHeight: 1.15, marginBottom: 4 }}>{banner.title}</div>
        <div style={{ fontSize: 14, opacity: 0.92 }}>{banner.subtitle}</div>
      </div>
    </div>
  );
}

function BannerCarousel({ banners }) {
  const [i, setI] = React.useState(0);
  React.useEffect(() => {
    if (banners.length <= 1) return;
    const t = setInterval(() => setI(v => (v + 1) % banners.length), 3800);
    return () => clearInterval(t);
  }, [banners.length]);
  if (banners.length === 0) {
    return (
      <div style={{
        height: 150, borderRadius: 24,
        background: 'repeating-linear-gradient(-45deg, rgba(0,0,0,0.04), rgba(0,0,0,0.04) 8px, rgba(0,0,0,0.02) 8px, rgba(0,0,0,0.02) 16px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        color: 'rgba(0,0,0,0.35)', fontSize: 13, fontFamily: 'ui-monospace, monospace',
      }}>[ banner area · admin ยังไม่ได้อัปโหลด ]</div>
    );
  }
  return (
    <div style={{ position: 'relative', height: 150 }}>
      {banners.map((b, idx) => (
        <div key={b.id} style={{
          position: 'absolute', inset: 0,
          opacity: idx === i ? 1 : 0,
          transform: idx === i ? 'scale(1)' : 'scale(0.96)',
          transition: 'opacity 700ms ease, transform 700ms ease',
          pointerEvents: idx === i ? 'auto' : 'none',
        }}>
          <BannerCard banner={b} idx={idx} />
        </div>
      ))}
      <div style={{ position: 'absolute', bottom: 10, left: 22, display: 'flex', gap: 5, zIndex: 2 }}>
        {banners.map((_, idx) => (
          <div key={idx} style={{
            width: idx === i ? 18 : 5, height: 5, borderRadius: 3,
            background: idx === i ? '#fff' : 'rgba(255,255,255,0.5)',
            transition: 'all 400ms ease',
          }}/>
        ))}
      </div>
    </div>
  );
}

function QuickTile({ btn, theme, onPress, delayMs }) {
  const [pressed, setPressed] = React.useState(false);
  const hasLink = btn.url && btn.url.trim().length > 0;
  return (
    <button
      onMouseDown={() => setPressed(true)}
      onMouseUp={() => setPressed(false)}
      onMouseLeave={() => setPressed(false)}
      onClick={() => onPress?.(btn)}
      className="ua-tile ua-enter"
      style={{
        animationDelay: `${delayMs}ms`,
        background: theme.tileBg, border: `1px solid ${theme.border}`,
        borderRadius: 20, padding: '16px 14px', textAlign: 'left',
        cursor: 'pointer', transition: 'transform 160ms ease, box-shadow 160ms ease',
        transform: pressed ? 'scale(0.96)' : 'scale(1)',
        boxShadow: pressed ? 'none' : '0 1px 2px rgba(0,0,0,0.04), 0 8px 24px -14px rgba(0,0,0,0.15)',
        display: 'flex', flexDirection: 'column', gap: 10, position: 'relative',
        minHeight: 112, fontFamily: 'inherit', color: theme.ink,
      }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', width: '100%' }}>
        <div style={{
          width: 38, height: 38, borderRadius: 12, background: theme.accent,
          color: theme.accentInk, display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <Icon name={btn.icon || 'sparkle'} size={20} stroke={2} />
        </div>
        {hasLink && (
          <div style={{ opacity: 0.35, color: theme.ink, display: 'flex', alignItems: 'center' }}>
            <Icon name="external" size={13} stroke={2}/>
          </div>
        )}
      </div>
      <div>
        <div style={{ fontSize: 15, fontWeight: 600, lineHeight: 1.25 }}>{btn.label}</div>
        {btn.sub && <div style={{ fontSize: 12, color: theme.muted, marginTop: 2, lineHeight: 1.3 }}>{btn.sub}</div>}
      </div>
      {(btn.tags && btn.tags.length > 0) && (
        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
          {btn.tags.slice(0, 3).map(t => (
            <span key={t} style={{ padding: '1px 6px', borderRadius: 4, background: theme.surface, fontSize: 9, color: theme.muted }}>#{t}</span>
          ))}
        </div>
      )}
    </button>
  );
}

function contactUrl(contact) {
  if (!contact || typeof contact !== 'object') return '';
  const v = String(contact.value || '').trim();
  if (!v) return '';
  switch (contact.channel) {
    case 'phone': {
      const digits = v.replace(/[^\d+]/g, '').slice(0, 20);
      return digits ? 'tel:' + digits : '';
    }
    case 'whatsapp': {
      const digits = v.replace(/[^\d]/g, '').slice(0, 20);
      return digits ? 'https://wa.me/' + digits : '';
    }
    case 'email': {
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) return '';
      return 'mailto:' + encodeURIComponent(v).replace(/%40/g, '@');
    }
    case 'messenger': {
      const name = v.replace(/[^A-Za-z0-9._-]/g, '').slice(0, 64);
      return name ? 'https://m.me/' + name : '';
    }
    case 'line':
    default: {
      const id = v.replace(/[^A-Za-z0-9._@-]/g, '').slice(0, 64);
      if (!id) return '';
      if (id.startsWith('@')) return 'https://line.me/R/ti/p/' + encodeURIComponent(id);
      return 'https://line.me/R/ti/p/~' + encodeURIComponent(id);
    }
  }
}

function ContactButton({ contact, theme, onPress }) {
  const ch = CHANNELS[contact.channel] || CHANNELS.line;
  const url = contactUrl(contact);
  const handleClick = () => {
    onPress?.(contact);
    if (!url) return;
    if (typeof openExternal === 'function') openExternal(url);
    else window.open(url, '_blank', 'noopener,noreferrer');
  };
  return (
    <button className="ua-contact ua-enter" onClick={handleClick} disabled={!url}
      style={{
      width: '100%', background: theme.ink, color: theme.surface,
      border: 'none', borderRadius: 22, padding: '18px 20px',
      cursor: url ? 'pointer' : 'not-allowed', opacity: url ? 1 : 0.5,
      display: 'flex', alignItems: 'center', gap: 14,
      fontFamily: 'inherit', textAlign: 'left',
      boxShadow: '0 20px 40px -20px rgba(0,0,0,0.4)',
      animationDelay: '500ms',
    }}>
      <div style={{
        width: 46, height: 46, borderRadius: 14, background: ch.color,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        color: '#fff', flexShrink: 0,
      }}>
        <Icon name={contact.channel} size={24} stroke={1.8} />
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 11, opacity: 0.6, letterSpacing: 0.8, textTransform: 'uppercase' }}>
          ติดต่อแอดมิน · {ch.name}
        </div>
        <div style={{ fontSize: 16, fontWeight: 600, marginTop: 2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {contact.label}
        </div>
      </div>
      <Icon name="chevronRight" size={20} />
    </button>
  );
}

function UserApp({ state, pageKey, onButtonPress }) {
  const baseTheme = THEMES[state.theme] || THEMES.cream;
  const [query, setQuery] = React.useState('');
  const [userPrefersDark, setUserPrefersDark] = React.useState(() => {
    try { return localStorage.getItem('user_dark') === '1'; } catch { return false; }
  });

  // Resolve dark mode: admin config (auto/light/dark) + user override
  const systemDark = typeof matchMedia !== 'undefined' && matchMedia('(prefers-color-scheme: dark)').matches;
  const adminMode = state.darkMode || 'auto';
  const useDark = userPrefersDark || adminMode === 'dark' || (adminMode === 'auto' && systemDark);
  const theme = useDark ? THEMES.midnight : baseTheme;

  const [toastMsg, setToast] = React.useState(null);
  const toastTimer = React.useRef(null);

  const handlePress = (btn) => {
    onButtonPress?.(btn);
    const safe = (typeof safeUrl === 'function') ? safeUrl(btn.url) : (btn.url || '');
    if (safe) {
      setToast({ label: btn.label, url: safe });
      clearTimeout(toastTimer.current);
      toastTimer.current = setTimeout(() => setToast(null), 2400);
      if (typeof openExternal === 'function') openExternal(safe);
      else window.open(safe, '_blank', 'noopener,noreferrer');
    } else {
      setToast({ label: btn.label, url: null });
      clearTimeout(toastTimer.current);
      toastTimer.current = setTimeout(() => setToast(null), 1800);
    }
  };

  const toggleDark = () => {
    const next = !userPrefersDark;
    setUserPrefersDark(next);
    try { localStorage.setItem('user_dark', next ? '1' : '0'); } catch {}
  };

  // Filter buttons by search query + tags
  const filteredButtons = React.useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return state.buttons;
    return state.buttons.filter(b =>
      (b.label || '').toLowerCase().includes(q) ||
      (b.sub || '').toLowerCase().includes(q) ||
      (b.tags || []).some(t => t.toLowerCase().includes(q))
    );
  }, [state.buttons, query]);

  const pageUrl = typeof location !== 'undefined' ? location.origin + location.pathname : '';

  return (
    <div key={pageKey} style={{
      minHeight: '100%', background: theme.bg, paddingBottom: 40, position: 'relative',
      fontFamily: '"IBM Plex Sans Thai", -apple-system, system-ui, sans-serif',
      color: theme.ink,
    }}>
      <div className="ua-enter" style={{ padding: '64px 22px 16px', animationDelay: '60ms' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
          <div style={{
            width: 34, height: 34, borderRadius: 10, background: theme.accent,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            color: theme.accentInk, fontWeight: 700, fontSize: 15,
          }}>{state.appName.slice(0, 1)}</div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 11, letterSpacing: 0.8, color: theme.muted, textTransform: 'uppercase' }}>
              {greetingFor(state.language)}
            </div>
          </div>
          <button onClick={toggleDark} title="เปลี่ยนโหมดมืด/สว่าง" aria-label="toggle dark" style={{
            width: 34, height: 34, borderRadius: '50%', background: theme.surface,
            border: `1px solid ${theme.border}`, cursor: 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'center', color: theme.ink, padding: 0,
          }}>
            <Icon name={useDark ? 'star' : 'sparkle'} size={16} stroke={1.7}/>
          </button>
          {typeof QrShareButton === 'function' && pageUrl && <QrShareButton url={pageUrl} theme={theme}/>}
        </div>
        <div style={{ fontSize: 26, fontWeight: 700, lineHeight: 1.2, letterSpacing: -0.3, color: state.appName ? theme.ink : theme.muted }}>
          {state.appName || 'ยังไม่ได้ตั้งชื่อแอป'}
        </div>
        {state.tagline && <div style={{ fontSize: 13, color: theme.muted, marginTop: 4 }}>{state.tagline}</div>}
      </div>

      <div className="ua-enter" style={{ padding: '6px 16px 20px', animationDelay: '140ms' }}>
        <BannerCarousel banners={state.banners} />
      </div>

      {state.buttons.length >= 4 && (
        <div className="ua-enter" style={{ padding: '0 22px 12px', animationDelay: '180ms' }}>
          <input
            type="search"
            value={query}
            onChange={e => setQuery(e.target.value.slice(0, 80))}
            placeholder="ค้นหาปุ่ม..."
            style={{
              width: '100%', padding: '9px 14px', borderRadius: 12,
              border: `1px solid ${theme.border}`, background: theme.surface,
              color: theme.ink, fontSize: 13, fontFamily: 'inherit',
              outline: 'none',
            }}
          />
        </div>
      )}

      {typeof PushSubscribeButton === 'function' && <PushSubscribeButton theme={theme}/>}

      <div style={{ padding: '0 16px' }}>
        <div style={{
          display: 'flex', justifyContent: 'space-between', alignItems: 'baseline',
          marginBottom: 10, padding: '0 4px',
        }}>
          <div style={{ fontSize: 14, fontWeight: 600 }}>เมนูด่วน</div>
          <div style={{ fontSize: 12, color: theme.muted }}>{filteredButtons.length} รายการ</div>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          {filteredButtons.map((b, i) => (
            <QuickTile key={b.id} btn={b} theme={theme} delayMs={220 + i * 55} onPress={handlePress}/>
          ))}
        </div>
        {filteredButtons.length === 0 && (
          <div style={{
            padding: '24px 16px', textAlign: 'center', fontSize: 12,
            color: theme.muted, border: `1px dashed ${theme.border}`, borderRadius: 14, background: theme.surface,
          }}>
            {state.buttons.length === 0
              ? 'แอดมินยังไม่ได้เพิ่มปุ่มเมนู'
              : 'ไม่พบปุ่มที่ตรงกับคำค้น'}
          </div>
        )}
      </div>

      {typeof DownloadLinksSection === 'function' && (
        <DownloadLinksSection downloadLinks={state.downloadLinks} theme={theme}/>
      )}

      {(state.contact && (state.contact.label || state.contact.value)) && (
        <div style={{ padding: '22px 16px 8px' }}>
          <ContactButton contact={state.contact} theme={theme} />
        </div>
      )}

      <div className="ua-enter" style={{ textAlign: 'center', fontSize: 11, color: theme.muted, padding: '14px 16px', animationDelay: '600ms' }}>
        จัดการโดยแอดมิน · อัปเดตล่าสุด {new Date().toLocaleDateString('th-TH')}
      </div>

      {toastMsg && (
        <div style={{
          position: 'absolute', left: 16, right: 16, bottom: 40, zIndex: 80,
          background: theme.ink, color: theme.surface,
          borderRadius: 16, padding: '12px 14px',
          boxShadow: '0 20px 40px -10px rgba(0,0,0,0.35)',
          display: 'flex', alignItems: 'center', gap: 10,
          animation: 'toastIn 320ms cubic-bezier(0.2, 0.8, 0.3, 1) both',
        }}>
          <div style={{
            width: 28, height: 28, borderRadius: 8, background: theme.accent,
            color: theme.accentInk, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
          }}>
            <Icon name={toastMsg.url ? 'external' : 'x'} size={14} stroke={2.2}/>
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 12, opacity: 0.6 }}>
              {toastMsg.url ? 'กำลังเปิดลิงก์' : 'ปุ่มนี้ยังไม่ได้ตั้งลิงก์'}
            </div>
            <div style={{ fontSize: 13, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {toastMsg.url || toastMsg.label}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function greetingFor(lang) {
  const h = new Date().getHours();
  if (lang === 'en') return h < 12 ? 'GOOD MORNING' : h < 18 ? 'GOOD AFTERNOON' : 'GOOD EVENING';
  return h < 12 ? 'สวัสดีตอนเช้า' : h < 18 ? 'สวัสดีตอนบ่าย' : 'สวัสดีตอนเย็น';
}

Object.assign(window, { UserApp, ContactButton });
