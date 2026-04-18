// online-indicator.jsx — floating pill showing network status.

function OnlineIndicator() {
  const [online, setOnline] = React.useState(
    typeof navigator !== 'undefined' ? navigator.onLine : true
  );
  const [visible, setVisible] = React.useState(false);

  React.useEffect(() => {
    const on = () => { setOnline(true); setVisible(true); setTimeout(() => setVisible(false), 2200); };
    const off = () => { setOnline(false); setVisible(true); };
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => { window.removeEventListener('online', on); window.removeEventListener('offline', off); };
  }, []);

  if (!visible && online) return null;

  const style = online
    ? { bg: '#1C4A2D', color: '#fff', text: 'กลับมาออนไลน์' }
    : { bg: '#7A5A10', color: '#fff', text: 'ออฟไลน์ — ใช้ข้อมูลที่แคชไว้' };

  return (
    <div style={{
      position: 'fixed', bottom: 22, left: '50%', transform: 'translateX(-50%)',
      zIndex: 1500, padding: '8px 14px', borderRadius: 999,
      background: style.bg, color: style.color,
      fontSize: 12, fontFamily: '"IBM Plex Sans Thai", system-ui',
      boxShadow: '0 10px 30px -10px rgba(0,0,0,0.35)',
      display: 'flex', alignItems: 'center', gap: 8,
      animation: 'uaIn 220ms cubic-bezier(0.2,0.8,0.3,1) both',
    }}>
      <span style={{
        width: 6, height: 6, borderRadius: '50%',
        background: online ? '#26c76f' : '#e8b14a',
      }}/>
      {style.text}
    </div>
  );
}

window.OnlineIndicator = OnlineIndicator;
