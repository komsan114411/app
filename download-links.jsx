// download-links.jsx — Install-app HERO card + compact section.
// Admin sets Android APK / iOS App Store URLs in the admin panel;
// user page shows a platform-aware install dashboard at the top with
// an obvious download CTA that triggers an APK download on Android
// or opens the App Store on iOS. Real-time: pulls from /api/config
// which the user page polls every 5s, so updates reflect within seconds.

function detectPlatform() {
  try {
    const ua = (navigator.userAgent || '').toLowerCase();
    if (/android/.test(ua)) return 'android';
    if (/iphone|ipad|ipod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)) return 'ios';
    return 'other';
  } catch { return 'other'; }
}

// Detects when a download link JUST changed so we can flash a "ใหม่!" badge.
function useLinkFlash(url) {
  const firstSeen = React.useRef(url);
  const [flash, setFlash] = React.useState(false);
  React.useEffect(() => {
    if (firstSeen.current === url) return;
    // URL changed after initial mount → real-time admin update
    firstSeen.current = url;
    setFlash(true);
    const t = setTimeout(() => setFlash(false), 6000);
    return () => clearTimeout(t);
  }, [url]);
  return flash;
}

// ───────────────────────────────────────────────────────────────
// HERO: big, obvious install card shown at the top of the user page.
// Primary CTA matches the visitor's platform; secondary is hidden by
// default but available via "อีกระบบ" toggle.
// ───────────────────────────────────────────────────────────────
function DownloadHero({ downloadLinks, theme }) {
  const dl = downloadLinks || {};
  const hasAndroid = !!(dl.android && typeof dl.android === 'string');
  const hasIos     = !!(dl.ios && typeof dl.ios === 'string');
  if (!hasAndroid && !hasIos) return null;

  const platform = React.useMemo(() => detectPlatform(), []);
  const flashAndroid = useLinkFlash(dl.android || '');
  const flashIos = useLinkFlash(dl.ios || '');
  const [showOther, setShowOther] = React.useState(false);

  const ink = theme?.ink || '#1F1B17';
  const accent = theme?.accent || 'oklch(0.62 0.14 45)';
  const accentInk = theme?.accentInk || '#fff';
  const muted = theme?.muted || '#6B6458';
  const surface = theme?.surface || '#fff';
  const border = theme?.border || 'rgba(0,0,0,0.08)';

  const onTap = (href, which) => {
    const safe = (typeof safeUrl === 'function') ? safeUrl(href) : href;
    if (!safe) return;
    try {
      if (typeof api !== 'undefined' && api.trackClick) api.trackClick('install_' + which, which, '');
    } catch {}
    if (typeof openExternal === 'function') openExternal(safe);
    else window.open(safe, '_blank', 'noopener,noreferrer');
  };

  // Primary choice = visitor's platform. Fallback to whatever is configured.
  const primary = (platform === 'ios' && hasIos) ? 'ios'
               : (platform === 'android' && hasAndroid) ? 'android'
               : (hasAndroid ? 'android' : 'ios');
  const secondary = primary === 'android' ? (hasIos ? 'ios' : null)
                                           : (hasAndroid ? 'android' : null);

  const primaryData = primary === 'android'
    ? { href: dl.android, label: dl.androidLabel || 'ดาวน์โหลด APK', mark: 'android',
        flash: flashAndroid, subtitle: isDirectApk(dl.android) ? 'ติดตั้งตรงจากไฟล์ .apk' : 'เปิดใน Play Store' }
    : { href: dl.ios, label: dl.iosLabel || 'เปิดใน App Store', mark: 'ios',
        flash: flashIos, subtitle: 'ติดตั้งผ่าน App Store' };

  return (
    <div className="ua-enter" style={{ padding: '0 16px 12px', animationDelay: '80ms' }}>
      <div style={{
        borderRadius: 22, padding: '18px 18px',
        background: `linear-gradient(135deg, ${accent}, ${accent})`,
        color: accentInk,
        boxShadow: '0 16px 36px -16px rgba(0,0,0,0.28)',
        position: 'relative', overflow: 'hidden',
      }}>
        {/* decorative rings */}
        <div style={{
          position: 'absolute', right: -40, top: -40, width: 160, height: 160,
          borderRadius: '50%', background: 'rgba(255,255,255,0.08)',
        }}/>
        <div style={{
          position: 'absolute', right: 40, bottom: -60, width: 140, height: 140,
          borderRadius: '50%', background: 'rgba(255,255,255,0.05)',
        }}/>

        <div style={{ position: 'relative' }}>
          <div style={{ fontSize: 11, letterSpacing: 1.3, textTransform: 'uppercase', opacity: 0.85, fontWeight: 600, marginBottom: 6 }}>
            {primaryData.mark === 'android' ? 'Android App' : 'iOS App'}
            {primaryData.flash && (
              <span style={{
                marginLeft: 8, padding: '1px 8px', borderRadius: 999,
                background: 'rgba(255,255,255,0.25)', fontSize: 10, fontWeight: 700,
                animation: 'pulse 1.2s ease-in-out infinite',
              }}>🆕 ใหม่!</span>
            )}
          </div>
          <div style={{ fontSize: 22, fontWeight: 700, lineHeight: 1.2, marginBottom: 4 }}>
            ติดตั้งแอปบนมือถือ
          </div>
          <div style={{ fontSize: 12, opacity: 0.88, marginBottom: 14 }}>
            {primaryData.subtitle}
          </div>

          <button
            onClick={() => onTap(primaryData.href, primaryData.mark)}
            style={{
              width: '100%', padding: '14px 18px', borderRadius: 14, border: 'none',
              background: '#fff', color: '#1F1B17',
              display: 'flex', alignItems: 'center', gap: 14, cursor: 'pointer',
              fontFamily: 'inherit',
              boxShadow: '0 8px 20px -8px rgba(0,0,0,0.3)',
              transition: 'transform 160ms ease',
            }}
            onMouseDown={e => e.currentTarget.style.transform = 'scale(0.98)'}
            onMouseUp={e => e.currentTarget.style.transform = 'scale(1)'}
            onMouseLeave={e => e.currentTarget.style.transform = 'scale(1)'}
          >
            <div style={{
              width: 44, height: 44, borderRadius: 12,
              background: primaryData.mark === 'android' ? '#3AAF5D' : '#007AFF',
              color: '#fff',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontWeight: 700, fontSize: 22, flexShrink: 0,
            }}>{primaryData.mark === 'android' ? '▶' : '⌘'}</div>
            <div style={{ flex: 1, textAlign: 'left', minWidth: 0 }}>
              <div style={{ fontSize: 10, letterSpacing: 0.8, color: '#6B6458', textTransform: 'uppercase', fontWeight: 600 }}>
                {primaryData.mark === 'android' ? 'ANDROID' : 'iOS'}
              </div>
              <div style={{ fontSize: 16, fontWeight: 700, marginTop: 2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {primaryData.label}
              </div>
            </div>
            <Icon name="external" size={18} stroke={2}/>
          </button>

          {secondary && (
            <div style={{ marginTop: 10, textAlign: 'center' }}>
              {!showOther ? (
                <button onClick={() => setShowOther(true)} style={{
                  background: 'rgba(255,255,255,0.15)', border: 'none', color: '#fff',
                  padding: '6px 14px', borderRadius: 999, fontSize: 11, cursor: 'pointer',
                  fontFamily: 'inherit',
                }}>อีกระบบ ({secondary === 'android' ? 'Android' : 'iOS'}) →</button>
              ) : (
                <SecondaryRow kind={secondary} href={secondary === 'android' ? dl.android : dl.ios}
                  label={secondary === 'android' ? (dl.androidLabel || 'ดาวน์โหลด APK') : (dl.iosLabel || 'เปิดใน App Store')}
                  onTap={onTap}/>
              )}
            </div>
          )}

          {dl.note && (
            <div style={{ marginTop: 12, padding: '8px 12px', borderRadius: 10,
              background: 'rgba(255,255,255,0.15)', fontSize: 11, opacity: 0.95,
              textAlign: 'center',
            }}>{dl.note}</div>
          )}
        </div>
      </div>
    </div>
  );
}

function SecondaryRow({ kind, href, label, onTap }) {
  return (
    <button onClick={() => onTap(href, kind)} style={{
      width: '100%', padding: '10px 14px', borderRadius: 12,
      border: '1px solid rgba(255,255,255,0.3)',
      background: 'rgba(255,255,255,0.1)', color: '#fff',
      display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer',
      fontFamily: 'inherit', marginTop: 4,
    }}>
      <div style={{
        width: 32, height: 32, borderRadius: 8,
        background: kind === 'android' ? '#3AAF5D' : '#007AFF',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontWeight: 700, fontSize: 14,
      }}>{kind === 'android' ? '▶' : '⌘'}</div>
      <div style={{ flex: 1, textAlign: 'left', minWidth: 0 }}>
        <div style={{ fontSize: 10, opacity: 0.7, textTransform: 'uppercase' }}>{kind === 'android' ? 'Android' : 'iOS'}</div>
        <div style={{ fontSize: 13, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{label}</div>
      </div>
      <Icon name="external" size={14} stroke={2}/>
    </button>
  );
}

function isDirectApk(url) {
  return typeof url === 'string' && /\.apk(\?.*)?$/i.test(url);
}

// ───────────────────────────────────────────────────────────────
// Compact variant — kept for backwards-compat if the hero is disabled.
// Renders two small cards side-by-side near the bottom of the page.
// ───────────────────────────────────────────────────────────────
function DownloadLinksSection({ downloadLinks, theme }) {
  // The hero now carries the primary CTA. This compact variant only renders
  // when the admin has set a `layout` flag — kept as a fallback.
  return null;
}

window.DownloadHero = DownloadHero;
window.DownloadLinksSection = DownloadLinksSection;
