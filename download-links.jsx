// download-links.jsx — Install-app card shown on the user page when the
// admin has configured Android APK / iOS App Store links. Detects the
// visitor's platform so the primary action is the relevant store, and
// falls back to showing both when the platform is unknown.

function detectPlatform() {
  try {
    const ua = (navigator.userAgent || '').toLowerCase();
    if (/android/.test(ua)) return 'android';
    if (/iphone|ipad|ipod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)) return 'ios';
    return 'other';
  } catch { return 'other'; }
}

function DownloadLinksSection({ downloadLinks, theme }) {
  const dl = downloadLinks || {};
  const hasAndroid = !!(dl.android && typeof dl.android === 'string');
  const hasIos = !!(dl.ios && typeof dl.ios === 'string');
  if (!hasAndroid && !hasIos) return null;

  const platform = React.useMemo(() => detectPlatform(), []);
  const ink = theme?.ink || '#1F1B17';
  const surface = theme?.surface || '#fff';
  const muted = theme?.muted || '#6B6458';
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

  const Primary = ({ href, label, sub, color, mark }) => (
    <button onClick={() => onTap(href, mark)} style={{
      flex: 1, minWidth: 160, display: 'flex', alignItems: 'center', gap: 10,
      padding: '12px 14px', borderRadius: 14, cursor: 'pointer',
      border: `1px solid ${border}`, background: surface, color: ink,
      fontFamily: 'inherit', textAlign: 'left',
      transition: 'transform 160ms ease',
    }}>
      <div style={{
        width: 38, height: 38, borderRadius: 10, color: '#fff', background: color,
        display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: 16, flexShrink: 0,
      }}>{mark === 'android' ? '▶' : '⌘'}</div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 11, opacity: 0.7, letterSpacing: 0.6, textTransform: 'uppercase' }}>
          {mark === 'android' ? 'Android' : 'iOS'}
        </div>
        <div style={{ fontSize: 14, fontWeight: 600, marginTop: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {label}
        </div>
        {sub && <div style={{ fontSize: 11, color: muted, marginTop: 1 }}>{sub}</div>}
      </div>
      <Icon name="external" size={14} stroke={2}/>
    </button>
  );

  // Order: device platform first if we can detect it.
  const items = [];
  const androidCard = hasAndroid ? {
    key: 'android', href: dl.android, label: dl.androidLabel || 'ดาวน์โหลด APK',
    color: '#3AAF5D', mark: 'android',
  } : null;
  const iosCard = hasIos ? {
    key: 'ios', href: dl.ios, label: dl.iosLabel || 'เปิดใน App Store',
    color: '#007AFF', mark: 'ios',
  } : null;
  if (platform === 'android') { if (androidCard) items.push(androidCard); if (iosCard) items.push(iosCard); }
  else if (platform === 'ios') { if (iosCard) items.push(iosCard); if (androidCard) items.push(androidCard); }
  else { if (androidCard) items.push(androidCard); if (iosCard) items.push(iosCard); }

  return (
    <div className="ua-enter" style={{ padding: '14px 16px 6px', animationDelay: '480ms' }}>
      <div style={{ display: 'flex', alignItems: 'baseline', marginBottom: 8, padding: '0 4px' }}>
        <div style={{ fontSize: 14, fontWeight: 600, color: ink }}>ติดตั้งแอปบนมือถือ</div>
        <div style={{ marginLeft: 'auto', fontSize: 11, color: muted }}>
          {platform === 'android' ? 'แนะนำ Android' : platform === 'ios' ? 'แนะนำ iOS' : ''}
        </div>
      </div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {items.map(it => (
          <Primary key={it.key} href={it.href} label={it.label} color={it.color} mark={it.mark}/>
        ))}
      </div>
      {dl.note && (
        <div style={{ marginTop: 8, padding: '6px 10px', fontSize: 11, color: muted, textAlign: 'center' }}>
          {dl.note}
        </div>
      )}
    </div>
  );
}

window.DownloadLinksSection = DownloadLinksSection;
