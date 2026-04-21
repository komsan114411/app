// install-page.jsx — Dedicated /install landing page.
//
// Standalone dashboard the admin shares with end-users when they need to
// install the Android app. Auto-detects the visitor's platform, shows a
// large download CTA, renders a QR code on desktop so the user can scan
// with their phone, and walks through the "install from unknown sources"
// steps Android requires for sideloaded APKs. Fully responsive from
// 320px mobile up to desktop.

function InstallPage() {
  const [cfg, setCfg] = React.useState(null);
  const [error, setError] = React.useState(null);
  const [status, setStatus] = React.useState('loading');  // loading | ok | expired | no_token

  // Extract token from URL: /install/<token> or ?t=<token>
  const token = React.useMemo(() => {
    try {
      const path = location.pathname.replace(/\/+$/, '');
      const m = path.match(/^\/(install|download)\/([A-Za-z0-9_-]{8,64})$/);
      if (m) return m[2];
      const qs = new URLSearchParams(location.search);
      return qs.get('t') || qs.get('token') || '';
    } catch { return ''; }
  }, []);

  const load = React.useCallback(async () => {
    if (!token) { setStatus('no_token'); return; }
    try {
      const c = await api.getInstallConfig(token);
      setCfg(c); setError(null); setStatus('ok');
    } catch (e) {
      const code = e.message;
      if (code === 'expired' || code === 'not_issued' || code === 'invalid_token' || e.status === 410) {
        setStatus('expired');
      } else {
        setError(e.message || 'โหลดไม่สำเร็จ');
        setStatus('error');
      }
    }
  }, [token]);

  React.useEffect(() => {
    load();
    // Growth funnel: record this page view exactly once per mount. The
    // tracking client de-dupes attribution so this also pins the source
    // token even if the user later visits / with no token.
    try { if (typeof tracking !== 'undefined') tracking.emit('install_page_view', { target: token }); } catch {}
    // Real-time sync: if admin changes downloadLinks while page is open,
    // refresh within ~5s without requiring the visitor to reload.
    const id = setInterval(() => { if (!document.hidden) load(); }, 5000);
    return () => clearInterval(id);
  }, [load, token]);

  const platform = React.useMemo(() => detectPlatform(), []);
  const theme = React.useMemo(() => getTheme(cfg), [cfg]);
  const pageUrl = typeof location !== 'undefined' ? location.origin + location.pathname : '';

  if (status === 'loading') return <InstallSkeleton theme={theme}/>;
  if (status === 'no_token') return <TokenRequired theme={theme}/>;
  if (status === 'expired')  return <LinkExpired theme={theme}/>;
  if (status === 'error')    return <InstallError theme={theme} message={error}/>;

  const dl = (cfg && cfg.downloadLinks) || {};
  const hasAndroid = !!dl.android;
  const hasIos = !!dl.ios;
  const appName = cfg?.appName || 'แอป';
  const tagline = cfg?.tagline || 'ติดตั้งเพื่อเข้าถึงเนื้อหาได้เร็วขึ้น';

  const primary = platform === 'android' ? 'android'
               : platform === 'ios' ? (hasIos ? 'ios' : 'android')
               : (hasAndroid ? 'android' : 'ios');

  return (
    <div style={{
      minHeight: '100vh',
      background: `linear-gradient(180deg, ${theme.bg} 0%, ${theme.surface} 100%)`,
      color: theme.ink,
      fontFamily: '"IBM Plex Sans Thai", -apple-system, system-ui, sans-serif',
      padding: '32px 16px 48px',
      boxSizing: 'border-box',
    }}>
      <div style={{ maxWidth: 760, margin: '0 auto' }}>
        {/* ── Hero card ─────────────────────────────────────────── */}
        <div style={{
          borderRadius: 28, padding: 'clamp(24px, 5vw, 44px)',
          background: `linear-gradient(135deg, ${theme.accent}, ${shade(theme.accent, -0.15)})`,
          color: theme.accentInk,
          boxShadow: '0 30px 60px -20px rgba(0,0,0,0.25)',
          position: 'relative', overflow: 'hidden',
          animation: 'uaIn 620ms cubic-bezier(0.2, 0.8, 0.3, 1) both',
        }}>
          {/* Decorative shapes */}
          <div style={{ position: 'absolute', right: -60, top: -60, width: 240, height: 240, borderRadius: '50%', background: 'rgba(255,255,255,0.08)' }}/>
          <div style={{ position: 'absolute', right: 60, bottom: -100, width: 200, height: 200, borderRadius: '50%', background: 'rgba(255,255,255,0.05)' }}/>

          <div style={{ position: 'relative' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 18 }}>
              <div style={{
                width: 56, height: 56, borderRadius: 16,
                background: cfg?.appIcon ? '#fff' : 'rgba(255,255,255,0.2)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 28, fontWeight: 700, flexShrink: 0, overflow: 'hidden',
              }}>
                {cfg?.appIcon
                  ? <img src={typeof absolutizeMedia === 'function' ? absolutizeMedia(cfg.appIcon) : cfg.appIcon} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }}/>
                  : appName.slice(0, 1).toUpperCase()}
              </div>
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{ fontSize: 11, letterSpacing: 1.4, opacity: 0.85, textTransform: 'uppercase', fontWeight: 600 }}>
                  {primary === 'android' ? 'ANDROID APP' : 'iOS APP'}
                </div>
                <div style={{ fontSize: 'clamp(22px, 5vw, 30px)', fontWeight: 700, lineHeight: 1.2, marginTop: 2 }}>
                  ติดตั้ง {appName}
                </div>
              </div>
            </div>

            <div style={{ fontSize: 'clamp(14px, 2.5vw, 16px)', opacity: 0.95, lineHeight: 1.55, marginBottom: 24, maxWidth: 520 }}>
              {tagline}
            </div>

            {/* ── Primary download button ───────────────────────── */}
            {!hasAndroid && !hasIos && (
              <div style={{
                padding: '16px 20px', borderRadius: 14,
                background: 'rgba(255,255,255,0.12)', fontSize: 14,
              }}>
                แอดมินยังไม่ได้ตั้งลิงก์ดาวน์โหลด · กรุณาติดต่อแอดมิน
              </div>
            )}

            {(hasAndroid || hasIos) && (
              <DownloadButtons dl={dl} platform={primary}/>
            )}

            {/* Alternative platform hint */}
            {hasAndroid && hasIos && (
              <div style={{ marginTop: 12, fontSize: 12, opacity: 0.85 }}>
                {primary === 'android' ? 'ใช้ iPhone?' : 'ใช้ Android?'}
                {' '}
                <a href="#secondary" style={{ color: '#fff', textDecoration: 'underline' }}>
                  {primary === 'android' ? 'ดาวน์โหลดสำหรับ iOS' : 'ดาวน์โหลดสำหรับ Android'}
                </a>
              </div>
            )}

            {dl.note && (
              <div style={{ marginTop: 18, padding: '10px 14px', borderRadius: 10,
                background: 'rgba(255,255,255,0.15)', fontSize: 13, lineHeight: 1.55 }}>
                {dl.note}
              </div>
            )}
          </div>
        </div>

        {/* ── Desktop? Show QR so user can scan with phone ──────── */}
        {platform === 'other' && (hasAndroid || hasIos) && (
          <Card theme={theme}>
            <div style={{ display: 'flex', gap: 20, alignItems: 'center', flexWrap: 'wrap' }}>
              <div style={{ background: '#fff', padding: 12, borderRadius: 12, border: `1px solid ${theme.border}` }}>
                {typeof QrSvg === 'function'
                  ? <QrSvg text={pageUrl} size={160}/>
                  : <div style={{ width: 160, height: 160, display: 'flex', alignItems: 'center', justifyContent: 'center', color: theme.muted }}>QR N/A</div>}
              </div>
              <div style={{ flex: 1, minWidth: 200 }}>
                <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 8 }}>สแกนจากมือถือ</div>
                <div style={{ fontSize: 13, color: theme.muted, lineHeight: 1.6, marginBottom: 10 }}>
                  เปิดกล้องมือถือ → ชี้ไปที่ QR → แตะลิงก์ที่ขึ้น → หน้านี้จะเปิดบนมือถือของคุณเอง
                </div>
                <button onClick={async () => {
                  try { await navigator.clipboard.writeText(pageUrl);
                    if (typeof toast !== 'undefined') toast.success('คัดลอกลิงก์แล้ว'); }
                  catch {}
                }} style={{
                  padding: '8px 14px', borderRadius: 8, border: `1px solid ${theme.border}`,
                  background: theme.surface, color: theme.ink, fontFamily: 'inherit',
                  fontSize: 12, cursor: 'pointer',
                }}>📋 คัดลอกลิงก์</button>
              </div>
            </div>
          </Card>
        )}

        {/* ── Install instructions — Android ────────────────────── */}
        {(platform === 'android' || platform === 'other') && hasAndroid && (
          <Card theme={theme}>
            <SectionTitle>📱 วิธีติดตั้งบน Android</SectionTitle>
            <Steps theme={theme} items={[
              { n: 1, text: 'กดปุ่ม "ดาวน์โหลด APK" ด้านบน — ไฟล์ .apk จะถูกดาวน์โหลด' },
              { n: 2, text: 'เปิดไฟล์ที่ดาวน์โหลด (notification บนมือถือ หรือ Files → Downloads)' },
              { n: 3, text: 'ถ้า Android ถาม "ไม่อนุญาตให้ติดตั้งจากแหล่งไม่ทราบ" → Settings → อนุญาตสำหรับ Chrome/File Manager' },
              { n: 4, text: 'กด "ติดตั้ง" → รอสักครู่ → เปิดแอปได้เลย 🎉' },
            ]}/>
            <div style={{ marginTop: 14, padding: '10px 14px', borderRadius: 10,
              background: `${theme.accent}15`, fontSize: 12, color: theme.ink, lineHeight: 1.5 }}>
              <strong style={{ color: theme.accent }}>💡 เคล็ดลับ:</strong> ถ้าเป็นรหัสที่ยังไม่เคยเซ็นจาก Play Store ระบบจะเตือนว่า "อาจเป็นอันตราย" — กด "ติดตั้งต่อไป" ได้ (เป็นเวอร์ชัน debug)
            </div>
          </Card>
        )}

        {/* ── Install instructions — iOS ────────────────────────── */}
        {(platform === 'ios' || platform === 'other') && hasIos && (
          <Card theme={theme}>
            <SectionTitle>🍎 วิธีติดตั้งบน iOS</SectionTitle>
            <Steps theme={theme} items={[
              { n: 1, text: 'กดปุ่ม "เปิดใน App Store" ด้านบน' },
              { n: 2, text: 'Apple จะเปิด App Store — กด "ติดตั้ง" หรือ "รับ"' },
              { n: 3, text: 'ยืนยันด้วย Face ID / Touch ID / รหัส Apple ID' },
              { n: 4, text: 'เปิดแอปจากหน้าจอหลัก 🎉' },
            ]}/>
          </Card>
        )}

        {/* ── Secondary platform ─────────────────────────────────── */}
        <div id="secondary"/>
        {hasAndroid && hasIos && (
          <Card theme={theme}>
            <SectionTitle>อีกระบบ</SectionTitle>
            <DownloadButtons dl={dl} platform={primary === 'android' ? 'ios' : 'android'} small/>
          </Card>
        )}

        {/* ── FAQ ───────────────────────────────────────────────── */}
        <Card theme={theme}>
          <SectionTitle>❓ คำถามที่พบบ่อย</SectionTitle>
          <Faq theme={theme} items={faqItems(!!hasAndroid, !!hasIos, appName)}/>
        </Card>

        {/* ── Back to main app ──────────────────────────────────── */}
        <div style={{ textAlign: 'center', marginTop: 24 }}>
          <a href="/" style={{
            display: 'inline-flex', alignItems: 'center', gap: 6,
            padding: '10px 18px', borderRadius: 999,
            background: theme.surface, color: theme.ink,
            border: `1px solid ${theme.border}`,
            textDecoration: 'none', fontSize: 13, fontWeight: 500,
          }}>← กลับหน้าหลัก</a>
        </div>

        {error && (
          <div style={{
            marginTop: 14, padding: '10px 14px', borderRadius: 10,
            background: 'rgba(180,70,58,0.08)', color: '#B4463A', fontSize: 12,
          }}>โหลดคอนฟิกไม่สำเร็จ — {error}</div>
        )}

        <div style={{
          marginTop: 28, textAlign: 'center', fontSize: 11, color: theme.muted,
        }}>
          {appName} · {new Date().toLocaleDateString('th-TH')}
        </div>
      </div>
    </div>
  );
}

// ── Helper components ──────────────────────────────────────────

function DownloadButtons({ dl, platform, small = false }) {
  const track = (which, href) => {
    try { api.trackClick?.('install_page_' + which, which, ''); } catch {}
    try {
      if (typeof tracking !== 'undefined') {
        tracking.emit('install_click', { target: href || '', label: which });
        // Flush immediately — the user is about to navigate away and
        // we don't want to lose the conversion event to the debounce.
        tracking.flush && tracking.flush();
      }
    } catch {}
  };
  const open = (href) => {
    const safe = (typeof safeUrl === 'function') ? safeUrl(href) : href;
    if (!safe) return;
    if (typeof openExternal === 'function') openExternal(safe);
    else window.open(safe, '_blank', 'noopener,noreferrer');
  };
  const btn = (href, label, mark) => (
    <button
      onClick={() => { track(mark, href); open(href); }}
      style={{
        width: '100%', padding: small ? '12px 16px' : '16px 22px',
        borderRadius: small ? 12 : 16, border: 'none',
        background: '#fff', color: '#1F1B17',
        display: 'flex', alignItems: 'center', gap: 14, cursor: 'pointer',
        fontFamily: 'inherit',
        boxShadow: small ? 'none' : '0 10px 30px -10px rgba(0,0,0,0.35)',
        transition: 'transform 160ms ease',
      }}
      onMouseDown={e => e.currentTarget.style.transform = 'scale(0.98)'}
      onMouseUp={e => e.currentTarget.style.transform = 'scale(1)'}
      onMouseLeave={e => e.currentTarget.style.transform = 'scale(1)'}
    >
      <div style={{
        width: small ? 36 : 48, height: small ? 36 : 48,
        borderRadius: small ? 10 : 14,
        background: mark === 'android' ? '#3AAF5D' : '#007AFF',
        color: '#fff',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontWeight: 700, fontSize: small ? 18 : 24, flexShrink: 0,
      }}>{mark === 'android' ? '▶' : '⌘'}</div>
      <div style={{ flex: 1, textAlign: 'left', minWidth: 0 }}>
        <div style={{ fontSize: 10, letterSpacing: 0.8, color: '#6B6458', textTransform: 'uppercase', fontWeight: 600 }}>
          {mark === 'android' ? 'ANDROID' : 'iOS'}
        </div>
        <div style={{ fontSize: small ? 14 : 18, fontWeight: 700, marginTop: 2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {label}
        </div>
      </div>
      <div style={{ fontSize: small ? 14 : 18, color: '#6B6458' }}>↗</div>
    </button>
  );
  if (platform === 'android') return btn(dl.android, dl.androidLabel || 'ดาวน์โหลด APK', 'android');
  return btn(dl.ios, dl.iosLabel || 'เปิดใน App Store', 'ios');
}

function Card({ theme, children, style }) {
  return (
    <div style={{
      marginTop: 16, padding: 'clamp(18px, 4vw, 28px)',
      borderRadius: 20,
      background: theme.surface,
      border: `1px solid ${theme.border}`,
      boxShadow: '0 12px 30px -16px rgba(0,0,0,0.1)',
      ...style,
    }}>{children}</div>
  );
}

function SectionTitle({ children }) {
  return <div style={{ fontSize: 'clamp(15px, 2.4vw, 17px)', fontWeight: 700, marginBottom: 14 }}>{children}</div>;
}

function Steps({ items, theme }) {
  return (
    <ol style={{ margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 10 }}>
      {items.map(it => (
        <li key={it.n} style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
          <div style={{
            width: 28, height: 28, borderRadius: '50%',
            background: theme.accent, color: theme.accentInk,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontWeight: 700, fontSize: 13, flexShrink: 0,
          }}>{it.n}</div>
          <div style={{ flex: 1, fontSize: 14, color: theme.ink, lineHeight: 1.55, paddingTop: 3 }}>{it.text}</div>
        </li>
      ))}
    </ol>
  );
}

function Faq({ items, theme }) {
  const [open, setOpen] = React.useState(-1);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {items.map((it, i) => {
        const isOpen = open === i;
        return (
          <div key={i} style={{ border: `1px solid ${theme.border}`, borderRadius: 10, overflow: 'hidden' }}>
            <button onClick={() => setOpen(isOpen ? -1 : i)} style={{
              width: '100%', padding: '12px 14px', background: isOpen ? `${theme.accent}12` : 'transparent',
              border: 'none', cursor: 'pointer', textAlign: 'left',
              display: 'flex', alignItems: 'center', gap: 10,
              fontFamily: 'inherit', fontSize: 13, fontWeight: 600, color: theme.ink,
            }}>
              <span style={{ flex: 1 }}>{it.q}</span>
              <span style={{ fontSize: 12, color: theme.muted, transform: isOpen ? 'rotate(90deg)' : 'none', transition: 'transform 200ms' }}>▸</span>
            </button>
            {isOpen && (
              <div style={{ padding: '0 14px 14px', fontSize: 13, color: theme.muted, lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>
                {it.a}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// Friendly expired-link page — shown when token is stale or revoked.
function LinkExpired({ theme }) {
  return (
    <GateShell theme={theme} icon="⌛" title="ลิงก์หมดอายุแล้ว"
      body={'ลิงก์ติดตั้งที่คุณเปิดถูกยกเลิกโดยผู้ดูแลระบบ\n\nติดต่อผู้ที่ส่งลิงก์ให้คุณเพื่อขอลิงก์ใหม่'}
      tone="warn"/>
  );
}

function TokenRequired({ theme }) {
  return (
    <GateShell theme={theme} icon="🔒" title="ต้องมีลิงก์ติดตั้งที่ถูกต้อง"
      body={'หน้าดาวน์โหลดนี้เข้าถึงได้ผ่านลิงก์ส่วนตัวเท่านั้น\n\nติดต่อผู้ดูแลเพื่อขอลิงก์ล่าสุด'}
      tone="warn"/>
  );
}

function InstallError({ theme, message }) {
  return (
    <GateShell theme={theme} icon="⚠" title="เกิดข้อผิดพลาด"
      body={'โหลดข้อมูลไม่สำเร็จ: ' + (message || 'unknown') + '\n\nลองรีโหลดอีกครั้ง'}
      tone="error" onRetry={() => location.reload()}/>
  );
}

function GateShell({ theme, icon, title, body, tone, onRetry }) {
  const bg = tone === 'error' ? 'rgba(180,70,58,0.08)' : 'rgba(210,150,40,0.1)';
  const color = tone === 'error' ? '#B4463A' : '#7A5A10';
  return (
    <div style={{
      minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
      padding: 20, background: `linear-gradient(180deg, ${theme.bg} 0%, ${theme.surface} 100%)`,
      color: theme.ink, fontFamily: '"IBM Plex Sans Thai", system-ui',
    }}>
      <div style={{
        maxWidth: 420, width: '100%', background: theme.surface,
        padding: 'clamp(24px, 5vw, 40px)', borderRadius: 20,
        border: `1px solid ${theme.border}`, textAlign: 'center',
        boxShadow: '0 20px 60px -20px rgba(0,0,0,0.2)',
      }}>
        <div style={{
          width: 72, height: 72, borderRadius: '50%',
          background: bg, color,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 34, margin: '0 auto 18px',
        }}>{icon}</div>
        <div style={{ fontSize: 'clamp(18px, 3.5vw, 22px)', fontWeight: 700, marginBottom: 10 }}>{title}</div>
        <div style={{ fontSize: 14, color: theme.muted, lineHeight: 1.7, whiteSpace: 'pre-wrap', marginBottom: 20 }}>
          {body}
        </div>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'center', flexWrap: 'wrap' }}>
          {onRetry && (
            <button onClick={onRetry} style={{
              padding: '9px 18px', borderRadius: 9, border: 'none',
              background: theme.accent, color: theme.accentInk,
              fontFamily: 'inherit', fontSize: 13, fontWeight: 600, cursor: 'pointer',
            }}>ลองใหม่</button>
          )}
          <a href="/" style={{
            padding: '9px 18px', borderRadius: 9,
            border: `1px solid ${theme.border}`, background: theme.surface,
            color: theme.ink, textDecoration: 'none',
            fontFamily: 'inherit', fontSize: 13, display: 'inline-flex', alignItems: 'center',
          }}>← หน้าหลัก</a>
        </div>
      </div>
    </div>
  );
}

function InstallSkeleton({ theme }) {
  return (
    <div style={{
      minHeight: '100vh',
      background: `linear-gradient(180deg, ${theme.bg} 0%, ${theme.surface} 100%)`,
      padding: '32px 16px',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      position: 'relative', overflow: 'hidden',
    }}>
      {/* Soft accent glow behind the card for depth */}
      <div style={{
        position: 'absolute', top: '30%', left: '50%',
        width: 520, height: 520,
        transform: 'translate(-50%, -50%)',
        background: `radial-gradient(circle, ${theme.accent}25 0%, transparent 65%)`,
        filter: 'blur(60px)', pointerEvents: 'none',
      }}/>
      <div style={{
        position: 'relative', zIndex: 1,
        maxWidth: 420, width: '100%',
        borderRadius: 24, padding: 'clamp(28px, 5vw, 40px)',
        background: theme.surface,
        border: `1px solid ${theme.border}`,
        boxShadow: '0 40px 90px -30px rgba(0,0,0,0.25)',
        display: 'flex', flexDirection: 'column',
        alignItems: 'center', gap: 20, textAlign: 'center',
      }}>
        {/* Rotating gradient ring + counter-rotating inner tile */}
        <div style={{
          width: 80, height: 80, borderRadius: 22, padding: 2,
          background: `conic-gradient(from 0deg, ${theme.accent}, ${theme.accent}80, ${theme.accent})`,
          animation: 'insSpin 3.6s linear infinite',
          boxShadow: `0 20px 50px -16px ${theme.accent}50`,
        }}>
          <div style={{
            width: '100%', height: '100%', borderRadius: 20,
            background: `linear-gradient(135deg, ${theme.surface}, ${theme.bg})`,
            animation: 'insCounter 3.6s linear infinite',
          }}/>
        </div>
        <div style={{ width: '100%' }}>
          <div style={{
            height: 14, width: '60%', margin: '0 auto 10px',
            borderRadius: 7, background: theme.bg,
            animation: 'insShimmer 1.6s ease-in-out infinite',
          }}/>
          <div style={{
            height: 10, width: '85%', margin: '0 auto',
            borderRadius: 5, background: theme.bg, opacity: 0.6,
            animation: 'insShimmer 1.6s ease-in-out 200ms infinite',
          }}/>
        </div>
        {/* Indeterminate progress sweep */}
        <div style={{
          width: '100%', height: 2, borderRadius: 2,
          background: theme.bg, overflow: 'hidden', position: 'relative',
        }}>
          <div style={{
            position: 'absolute', inset: 0, width: '40%',
            background: `linear-gradient(90deg, transparent, ${theme.accent}, transparent)`,
            animation: 'insSweep 1.4s cubic-bezier(0.45, 0.05, 0.55, 0.95) infinite',
          }}/>
        </div>
        <div style={{
          fontSize: 10.5, letterSpacing: 1.8, textTransform: 'uppercase',
          fontWeight: 600, color: theme.muted,
          animation: 'insPulse 2.4s ease-in-out infinite',
        }}>กำลังเตรียมหน้าติดตั้ง</div>
      </div>
      {/* Keyframes declared inline so the skeleton has zero external deps */}
      <style>{`
        @keyframes insSpin    { to { transform: rotate(360deg); } }
        @keyframes insCounter { to { transform: rotate(-360deg); } }
        @keyframes insShimmer { 0%,100% { opacity: 0.55; } 50% { opacity: 1; } }
        @keyframes insSweep   { from { transform: translateX(-110%); } to { transform: translateX(260%); } }
        @keyframes insPulse   { 0%,100% { opacity: 0.45; } 50% { opacity: 0.9; } }
        @media (prefers-reduced-motion: reduce) {
          [class*="ins"] { animation: none !important; }
        }
      `}</style>
    </div>
  );
}

function detectPlatform() {
  try {
    const ua = (navigator.userAgent || '').toLowerCase();
    if (/android/.test(ua)) return 'android';
    if (/iphone|ipad|ipod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)) return 'ios';
    return 'other';
  } catch { return 'other'; }
}

function getTheme(cfg) {
  const key = cfg?.theme || 'cream';
  const themes = (typeof THEMES !== 'undefined') ? THEMES : {};
  return themes[key] || themes.cream || {
    bg: '#F6F1E8', surface: '#FFFCF5', ink: '#1F1B17', muted: '#6B6458',
    accent: '#C48B3E', accentInk: '#fff', border: 'rgba(0,0,0,0.06)',
  };
}

// Slight color shift for gradient — works on hex or oklch.
function shade(color, amount) {
  if (typeof color !== 'string') return color;
  if (color.startsWith('oklch')) {
    return color.replace(/oklch\((\d*\.?\d+)\s/, (_, l) => `oklch(${Math.max(0.15, Math.min(0.95, Number(l) + amount))} `);
  }
  return color;
}

function faqItems(hasAndroid, hasIos, appName) {
  const items = [];
  if (hasAndroid) {
    items.push({
      q: 'ทำไม Android ถึงเตือน "อาจเป็นอันตราย"?',
      a: 'เพราะ APK นี้ไม่ได้เซ็นผ่าน Google Play Store (เป็นการติดตั้งแบบ sideload).\nระบบ Android จะเตือนทุก APK จากภายนอก — เป็นเรื่องปกติสำหรับแอปที่ distribute เองก่อนขึ้น Play Store\nกดปุ่ม "ติดตั้งต่อไป" ได้เลย',
    });
    items.push({
      q: 'ตั้ง "อนุญาตติดตั้งจากแหล่งไม่ทราบ" ยังไง?',
      a: 'Android 10+:\n  Settings → Apps → Special Access → Install unknown apps → เลือก Chrome/Files → เปิด\n\nAndroid 9 หรือต่ำกว่า:\n  Settings → Security → Unknown sources → เปิด',
    });
  }
  if (hasIos) {
    items.push({
      q: 'ต้องจ่ายเงินไหม?',
      a: 'ไม่ต้อง · ฟรี · ดาวน์โหลดและติดตั้งผ่าน App Store ได้เลย',
    });
  }
  items.push({
    q: 'อัปเดตแอปยังไง?',
    a: 'Android: กลับมาที่หน้านี้แล้วดาวน์โหลดใหม่ · แอปจะถามว่า "อัปเดต" — กดยืนยัน\n\niOS: App Store จะแจ้งเตือนอัปเดตอัตโนมัติ',
  });
  items.push({
    q: 'ใช้ข้อมูลมากไหม?',
    a: 'ตัวแอปขนาดเล็ก · ใช้ข้อมูลน้อยมาก เฉพาะตอนโหลดเนื้อหาใหม่ · ถ้ากังวลใช้ Wi-Fi ตอนดาวน์โหลดครั้งแรก',
  });
  items.push({
    q: 'ข้อมูลของฉันปลอดภัยไหม?',
    a: appName + ' ใช้ HTTPS เข้ารหัสทุก request · รหัสผ่านเข้ารหัสด้วย argon2id · ไม่เก็บข้อมูลส่วนตัวที่ระบุตัวคุณได้',
  });
  return items;
}

window.InstallPage = InstallPage;
