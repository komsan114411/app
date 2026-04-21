// consent-banner.jsx — PDPA/GDPR cookie & analytics consent banner.
// Shown on first visit until user makes a choice (accept / deny).
// Preference stored in localStorage; also echoed to server via X-Consent header.

function ConsentBanner() {
  const [choice, setChoice] = React.useState(() => {
    try { return localStorage.getItem('analytics_consent'); } catch { return null; }
  });
  const [expanded, setExpanded] = React.useState(false);

  if (choice === 'accepted' || choice === 'denied') return null;

  const set = (v) => {
    try { localStorage.setItem('analytics_consent', v); } catch {}
    setChoice(v);
  };

  return (
    <div role="dialog" aria-label="ความยินยอมเก็บข้อมูล" style={{
      position: 'fixed', left: 16, right: 16, bottom: 16, zIndex: 1000,
      maxWidth: 560, margin: '0 auto',
      background: '#1F1B17', color: '#fff', borderRadius: 14,
      padding: 16, fontFamily: '"IBM Plex Sans Thai", system-ui',
      boxShadow: '0 20px 60px -20px rgba(0,0,0,0.5)',
      animation: 'uaIn 420ms cubic-bezier(0.2, 0.8, 0.3, 1) both',
    }}>
      <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 6 }}>
        เราเก็บข้อมูลการใช้งานแบบไม่ระบุตัวตน
      </div>
      <div style={{ fontSize: 12, opacity: 0.75, lineHeight: 1.55, marginBottom: expanded ? 10 : 12 }}>
        เพื่อปรับปรุงบริการ เราบันทึกว่าปุ่มไหนถูกกด (IP ถูกแปลงเป็น hash — ไม่ระบุตัวคุณได้)
        คุณสามารถปฏิเสธหรือลบข้อมูลออกในภายหลังได้
        {!expanded && <button onClick={() => setExpanded(true)} style={linkBtn}> · รายละเอียด</button>}
      </div>
      {expanded && (
        <ul style={{ fontSize: 11, opacity: 0.75, margin: '0 0 12px', paddingLeft: 18, lineHeight: 1.8 }}>
          <li>ข้อมูลที่เก็บ: ปุ่มที่กด, เหตุการณ์เปิดแอป/หน้าติดตั้ง, session duration</li>
          <li>Device ID: UUID random ในอุปกรณ์คุณ (ไม่ผูกชื่อ/อีเมล) · ลบเมื่อ uninstall หรือเคลียร์ app data</li>
          <li>IP ถูกเก็บเป็น HMAC-SHA256 hash (ไม่ reversible), User-Agent ถูกย่อ</li>
          <li>ถ้ามาจากลิงก์ติดตั้ง เราบันทึก token ของลิงก์ (ไม่ใช่ข้อมูลคุณ) เพื่อรู้ว่าแคมเปญไหนได้ผล</li>
          <li>ระยะเวลาเก็บ: events 90 วัน, device profile 180 วัน (TTL อัตโนมัติ)</li>
          <li>ลบออกเมื่อไหร่ก็ได้ผ่าน <code>/api/privacy/forget</code> หรือปุ่มด้านล่าง</li>
        </ul>
      )}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <button onClick={() => set('accepted')} style={primaryBtn}>ยอมรับ</button>
        <button onClick={() => set('denied')} style={secondaryBtn}>ปฏิเสธ</button>
        {expanded && (
          <button onClick={async () => {
            try { await api.forgetMe(); } catch {}
            set('denied');
            if (typeof toast !== 'undefined') toast.success('ลบข้อมูลการใช้งานของคุณแล้ว');
          }} style={linkBtnWhite}>
            ลบข้อมูลการใช้งานที่ผ่านมา
          </button>
        )}
      </div>
    </div>
  );
}

const primaryBtn = {
  padding: '8px 16px', borderRadius: 8, border: 'none',
  background: '#fff', color: '#1F1B17',
  fontFamily: 'inherit', fontSize: 12, fontWeight: 600, cursor: 'pointer',
};
const secondaryBtn = {
  padding: '8px 16px', borderRadius: 8,
  border: '1px solid rgba(255,255,255,0.2)', background: 'transparent', color: '#fff',
  fontFamily: 'inherit', fontSize: 12, cursor: 'pointer',
};
const linkBtn = {
  background: 'none', border: 'none', color: '#fff',
  textDecoration: 'underline', cursor: 'pointer',
  fontSize: 12, padding: 0, fontFamily: 'inherit',
};
const linkBtnWhite = {
  background: 'none', border: 'none', color: '#fff',
  textDecoration: 'underline', cursor: 'pointer',
  fontSize: 11, padding: '8px 0', fontFamily: 'inherit', opacity: 0.7,
};

window.ConsentBanner = ConsentBanner;
