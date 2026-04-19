// toast.jsx — in-app toast notification system.
// Replaces window.alert/confirm with themed non-blocking UI.
//
// Usage:
//   toast.success('บันทึกแล้ว');
//   toast.error('เกิดข้อผิดพลาด');
//   toast.info('กำลังซิงก์');
//   const ok = await toast.confirm('ลบผู้ใช้?', 'ยืนยัน', 'ยกเลิก');

const _listeners = new Set();
const _state = { toasts: [], confirm: null };
let _nextId = 1;

function _emit() { for (const fn of _listeners) fn({ ..._state }); }

function _push(kind, text, ttl = 3200) {
  const id = _nextId++;
  _state.toasts = [..._state.toasts, { id, kind, text }];
  _emit();
  if (ttl > 0) setTimeout(() => _remove(id), ttl);
  return id;
}
function _remove(id) {
  _state.toasts = _state.toasts.filter(t => t.id !== id);
  _emit();
}

const toast = {
  success: (t, ttl) => _push('success', t, ttl),
  error:   (t, ttl) => _push('error',   t, ttl || 5000),
  info:    (t, ttl) => _push('info',    t, ttl),
  warn:    (t, ttl) => _push('warn',    t, ttl),
  dismiss: (id) => _remove(id),
  confirm(title, okLabel = 'ตกลง', cancelLabel = 'ยกเลิก', { tone = 'default' } = {}) {
    return new Promise(resolve => {
      // If a previous confirm is still open, resolve it as cancelled so
      // the caller doesn't hang forever waiting on a modal that just got
      // overwritten by a second call.
      if (_state.confirm && typeof _state.confirm.resolve === 'function') {
        try { _state.confirm.resolve(false); } catch {}
      }
      _state.confirm = { title, okLabel, cancelLabel, tone, resolve };
      _emit();
    });
  },
};

function ToastContainer() {
  const [s, setS] = React.useState({ ..._state });
  React.useEffect(() => {
    const fn = (ns) => setS(ns);
    _listeners.add(fn);
    return () => _listeners.delete(fn);
  }, []);

  return (
    <>
      <div style={{
        position: 'fixed', top: 18, right: 18, zIndex: 2000,
        display: 'flex', flexDirection: 'column', gap: 8,
        fontFamily: '"IBM Plex Sans Thai", system-ui',
        pointerEvents: 'none',
      }}>
        {s.toasts.map(t => <ToastCard key={t.id} {...t}/>)}
      </div>
      {s.confirm && (
        <ConfirmModal
          {...s.confirm}
          onClose={(ok) => {
            const c = _state.confirm;
            _state.confirm = null;
            _emit();
            c && c.resolve(ok);
          }}
        />
      )}
    </>
  );
}

function ToastCard({ kind, text }) {
  const palette = {
    success: { bg: '#1C4A2D', icon: '✓' },
    error:   { bg: '#7A1E14', icon: '⚠' },
    warn:    { bg: '#7A5A10', icon: '!' },
    info:    { bg: '#1F1B17', icon: 'ℹ' },
  }[kind] || { bg: '#1F1B17', icon: '·' };
  return (
    <div style={{
      minWidth: 240, maxWidth: 360, padding: '10px 14px',
      background: palette.bg, color: '#fff', borderRadius: 10,
      boxShadow: '0 14px 40px -14px rgba(0,0,0,0.4)',
      fontSize: 13, display: 'flex', alignItems: 'center', gap: 10,
      pointerEvents: 'auto',
      animation: 'toastIn 280ms cubic-bezier(0.2,0.8,0.3,1) both',
    }}>
      <div style={{
        width: 22, height: 22, borderRadius: 6,
        background: 'rgba(255,255,255,0.15)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: 12, fontWeight: 700, flexShrink: 0,
      }}>{palette.icon}</div>
      <div style={{ flex: 1 }}>{text}</div>
    </div>
  );
}

function ConfirmModal({ title, okLabel, cancelLabel, tone, onClose }) {
  const okBg = tone === 'danger' ? '#B4463A' : '#1F1B17';
  return (
    <div onClick={e => e.target === e.currentTarget && onClose(false)} style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 2100,
      display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20,
      fontFamily: '"IBM Plex Sans Thai", system-ui',
    }}>
      <div style={{
        width: 360, background: '#fff', borderRadius: 14, padding: 22,
        boxShadow: '0 40px 80px -20px rgba(0,0,0,0.4)',
        animation: 'toastIn 220ms cubic-bezier(0.2,0.8,0.3,1) both',
      }}>
        <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 18, lineHeight: 1.4 }}>{title}</div>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button onClick={() => onClose(false)} style={{
            padding: '9px 16px', borderRadius: 8, border: '1px solid rgba(0,0,0,0.12)',
            background: '#fff', fontFamily: 'inherit', fontSize: 13, cursor: 'pointer',
          }}>{cancelLabel}</button>
          <button onClick={() => onClose(true)} autoFocus style={{
            padding: '9px 20px', borderRadius: 8, border: 'none',
            background: okBg, color: '#fff',
            fontFamily: 'inherit', fontSize: 13, fontWeight: 600, cursor: 'pointer',
          }}>{okLabel}</button>
        </div>
      </div>
    </div>
  );
}

Object.assign(window, { toast, ToastContainer });
