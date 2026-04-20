// Shared state for the app — admin edits propagate to user view via React state
// We keep everything in one parent and pass down.

const DEFAULT_STATE = {
  appName: 'ตัวอย่างแอป',
  tagline: 'ลิงก์อินไบโอ · ตั้งค่าทุกอย่างได้จากหลังบ้าน',
  appIcon: '',   // admin-uploaded square icon; empty = fallback to first letter
  theme: 'cream', // cream | sage | midnight | sunset
  banners: [
    { id: 'b1', title: 'แบนเนอร์ที่ 1', subtitle: 'ข้อความย่อยตัวอย่าง', tone: 'leaf' },
    { id: 'b2', title: 'แบนเนอร์ที่ 2', subtitle: 'ข้อความย่อยตัวอย่าง', tone: 'sun' },
    { id: 'b3', title: 'แบนเนอร์ที่ 3', subtitle: 'ข้อความย่อยตัวอย่าง', tone: 'clay' },
  ],
  buttons: [
    { id: 'q1', label: 'ปุ่มที่ 1', sub: 'คำอธิบาย',   icon: 'leaf',    url: '', linkType: 'external' },
    { id: 'q2', label: 'ปุ่มที่ 2', sub: 'คำอธิบาย',   icon: 'star',    url: '', linkType: 'external' },
    { id: 'q3', label: 'ปุ่มที่ 3', sub: 'คำอธิบาย',   icon: 'tag',     url: '', linkType: 'external' },
    { id: 'q4', label: 'ปุ่มที่ 4', sub: 'คำอธิบาย',   icon: 'book',    url: '', linkType: 'external' },
    { id: 'q5', label: 'ปุ่มที่ 5', sub: '',           icon: 'truck',   url: '', linkType: 'external' },
    { id: 'q6', label: 'ปุ่มที่ 6', sub: 'คำอธิบาย',   icon: 'pin',     url: '', linkType: 'map' },
  ],
  contact: {
    label: 'ติดต่อแอดมิน',
    channel: 'line', // line | messenger | whatsapp | phone | email
    value: '',
  },
};

const THEMES = {
  cream: {
    bg: '#F6F1E8', surface: '#FFFCF5', ink: '#1F1B17', muted: '#6B6458',
    accent: 'oklch(0.62 0.14 45)', accentInk: '#FFFFFF',
    banner: 'linear-gradient(135deg, oklch(0.82 0.08 70), oklch(0.72 0.12 45))',
    tileBg: '#FFFFFF', border: 'rgba(31,27,23,0.06)',
  },
  sage: {
    bg: '#EEF1EA', surface: '#FBFCF8', ink: '#1C221A', muted: '#5F6A5A',
    accent: 'oklch(0.55 0.10 155)', accentInk: '#FFFFFF',
    banner: 'linear-gradient(135deg, oklch(0.80 0.07 155), oklch(0.60 0.11 165))',
    tileBg: '#FFFFFF', border: 'rgba(28,34,26,0.07)',
  },
  midnight: {
    bg: '#131520', surface: '#1C1F2B', ink: '#EEF0F7', muted: '#8A90A8',
    accent: 'oklch(0.72 0.14 260)', accentInk: '#0B0D16',
    banner: 'linear-gradient(135deg, oklch(0.40 0.10 270), oklch(0.55 0.13 240))',
    tileBg: '#232635', border: 'rgba(255,255,255,0.06)',
  },
  sunset: {
    bg: '#FBEEE6', surface: '#FFF8F3', ink: '#2A1A14', muted: '#7A5C4F',
    accent: 'oklch(0.62 0.18 25)', accentInk: '#FFFFFF',
    banner: 'linear-gradient(135deg, oklch(0.78 0.12 35), oklch(0.65 0.17 15))',
    tileBg: '#FFFFFF', border: 'rgba(42,26,20,0.08)',
  },
};

const BANNER_TONES = {
  leaf: 'linear-gradient(135deg, oklch(0.78 0.10 150), oklch(0.58 0.13 160))',
  sun:  'linear-gradient(135deg, oklch(0.85 0.12 80),  oklch(0.70 0.15 55))',
  clay: 'linear-gradient(135deg, oklch(0.78 0.09 40),  oklch(0.58 0.14 25))',
  sky:  'linear-gradient(135deg, oklch(0.80 0.08 230), oklch(0.58 0.14 250))',
  plum: 'linear-gradient(135deg, oklch(0.65 0.12 330), oklch(0.45 0.15 310))',
};

const CHANNELS = {
  line:      { name: 'LINE',      hint: 'LINE ID',        color: '#06C755' },
  messenger: { name: 'Messenger', hint: 'ชื่อเพจ/ยูสเซอร์',  color: '#0084FF' },
  whatsapp:  { name: 'WhatsApp',  hint: 'เบอร์โทร',         color: '#25D366' },
  phone:     { name: 'โทรศัพท์',    hint: 'เบอร์โทร',         color: '#1F1B17' },
  email:     { name: 'อีเมล',       hint: 'อีเมล',            color: '#8E6B3D' },
};

Object.assign(window, { DEFAULT_STATE, THEMES, BANNER_TONES, CHANNELS });
