# Mobile APK build (Capacitor)

สร้าง APK file ที่ติดตั้งบน Android ได้ โดย wrap PWA ด้วย Capacitor.

## เตรียมเครื่อง (ครั้งเดียว)

1. **Node.js 20+** — [ดาวน์โหลด](https://nodejs.org/)
2. **Java JDK 17** — [Adoptium](https://adoptium.net/) (ต้องมี JAVA_HOME ใน env)
3. **Android Studio** — [ดาวน์โหลด](https://developer.android.com/studio)
   - ติดตั้งเสร็จ → เปิด → SDK Manager → ติดตั้ง **Android SDK Platform 34** + **Build-Tools 34.0.0**

> ถ้าไม่อยากติดตั้ง Android Studio — ใช้ GitHub Actions แทน (ดูข้อ "Cloud build" ล่างสุด)

## Build APK — ครั้งแรก

```bash
cd mobile
npm install                      # ติดตั้ง Capacitor + copy frontend เข้า ./www
npx cap add android              # สร้างโฟลเดอร์ android/ (Gradle project)
npx cap sync android             # sync web assets เข้า android/

# สร้าง debug APK (ติดตั้งบนมือถือเพื่อทดสอบได้ทันที)
npm run build:debug

# APK จะอยู่ที่: mobile/android/app/build/outputs/apk/debug/app-debug.apk
```

## Build APK — release (signed, เผยแพร่ได้)

```bash
# 1. สร้าง keystore (ครั้งเดียว เก็บไฟล์ไว้ดี ๆ — หายแล้วอัปเดตแอปไม่ได้)
keytool -genkey -v -keystore myapp-release.keystore \
  -alias myapp -keyalg RSA -keysize 2048 -validity 10000

# 2. ตั้งรหัสไว้ใน mobile/android/gradle.properties (ห้าม commit):
# MYAPP_RELEASE_STORE_FILE=../../myapp-release.keystore
# MYAPP_RELEASE_STORE_PASSWORD=xxx
# MYAPP_RELEASE_KEY_ALIAS=myapp
# MYAPP_RELEASE_KEY_PASSWORD=xxx

# 3. build
npm run build:release
# → mobile/android/app/build/outputs/apk/release/app-release.apk
```

## ตั้ง API_BASE ก่อน build

APK ต้องรู้ว่าเรียก API ที่ไหน:

```bash
# วิธีที่ 1 — แก้ default ในไฟล์ scripts/prepare-web.js
# (บรรทัด:  const API_BASE = ... || 'https://api.your-domain.example.com')

# วิธีที่ 2 — ส่งผ่าน env var
API_BASE="https://api.your-domain.com" node scripts/prepare-web.js
npx cap sync android
npm run build:debug
```

## ถัดไป

```bash
npx cap open android      # เปิด Android Studio → กดปุ่ม ▶ run บนอีมูเลเตอร์/มือถือจริง
```

---

## ☁️ Cloud build (ไม่ต้องติดตั้งอะไรที่เครื่อง)

1. Push โค้ดขึ้น GitHub
2. Workflow `.github/workflows/android.yml` จะ build APK อัตโนมัติ
3. ดาวน์โหลด APK จาก Actions → artifacts

ดู `.github/workflows/android.yml` ที่ root

---

## ติดตั้ง APK บนมือถือ

1. เปิด **Settings → Security → Install unknown apps** → อนุญาตเบราว์เซอร์ที่ใช้
2. ส่งไฟล์ `.apk` ไปมือถือ (Google Drive / USB / LINE)
3. กดเปิดไฟล์ → ติดตั้ง

> **iOS**: ใช้ `npx cap add ios` + Xcode (Mac only). iOS ไม่รองรับไฟล์ติดตั้งอิสระ ต้องผ่าน App Store หรือ TestFlight

---

## ⚠️ ข้อควรรู้

1. **SIT `unsafe-inline` + Babel-in-browser** — APK โหลดช้าครั้งแรก ~300ms. Production ควร pre-compile JSX แล้วค่อย wrap
2. **CSP ใน APK** — schema เป็น `https://localhost` (Capacitor trick). ตัว server API ต้องตอบ CORS ให้ scheme นี้ด้วย:
   ```
   CORS_ORIGINS=https://localhost,https://your-app.example.com
   ```
3. **HTTPS required** — `cleartext: false` ใน config → API ต้องเป็น HTTPS เท่านั้น (ถ้าใช้ localhost ทดสอบ → เปลี่ยนชั่วคราว)
4. **Service worker** — ใช้ใน PWA ได้ แต่ใน Capacitor WebView ตัว SW ไม่ทำงาน — ใช้ Capacitor's caching แทน
