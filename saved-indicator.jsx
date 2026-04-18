// saved-indicator.jsx — tiny UI badge for admin "dirty / saving / saved".
// Drives from a shared store so any mutation call can report state.

const _savedState = { status: 'idle', lastSavedAt: null };
const _subs = new Set();
function _emit() { for (const fn of _subs) fn({ ..._savedState }); }

const SavedStore = {
  setStatus(status) { _savedState.status = status; if (status === 'saved') _savedState.lastSavedAt = new Date(); _emit(); },
  reset() { _savedState.status = 'idle'; _emit(); },
  state: () => ({ ..._savedState }),
};

function SavedIndicator() {
  const [s, setS] = React.useState(SavedStore.state());
  React.useEffect(() => { _subs.add(setS); return () => _subs.delete(setS); }, []);
  React.useEffect(() => {
    if (s.status !== 'saved') return;
    const t = setTimeout(() => SavedStore.setStatus('idle'), 1800);
    return () => clearTimeout(t);
  }, [s.status, s.lastSavedAt]);

  const label =
    s.status === 'saving' ? { text: 'กำลังบันทึก…', color: '#7A5A10', bg: 'rgba(210,150,40,0.1)' } :
    s.status === 'saved'  ? { text: 'บันทึกแล้ว', color: '#058850', bg: 'rgba(6,199,85,0.1)' } :
    s.status === 'error'  ? { text: 'บันทึกไม่สำเร็จ', color: '#B4463A', bg: 'rgba(180,70,58,0.1)' } :
    s.status === 'dirty'  ? { text: 'ยังไม่บันทึก', color: '#6B6458', bg: '#F3EFE7' } :
    null;

  if (!label) return null;

  return (
    <div style={{
      display: 'inline-flex', alignItems: 'center', gap: 6,
      padding: '3px 10px', borderRadius: 999,
      background: label.bg, color: label.color,
      fontSize: 11, fontWeight: 600,
      fontFamily: '"IBM Plex Sans Thai", system-ui',
    }}>
      <span style={{
        width: 6, height: 6, borderRadius: '50%', background: label.color,
        animation: s.status === 'saving' ? 'pulse 1.2s ease-in-out infinite' : 'none',
      }}/>
      {label.text}
    </div>
  );
}

Object.assign(window, { SavedStore, SavedIndicator });
