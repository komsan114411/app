# Android APK — Security Hardening

This document lists every hardening the APK build applies, and what
attacks each one prevents.

## Applied automatically (every build)

| Mitigation | What it stops |
|---|---|
| `android:usesCleartextTraffic="false"` | A hostile Wi-Fi that tries to strip TLS — app refuses plain HTTP |
| `network_security_config.xml` trust-anchors = `system` only | Corporate / custom CAs installed on the phone CANNOT read your traffic |
| `android:allowBackup="false"` + `backup_rules.xml` excludes all | `adb backup` cannot extract the WebView cookie jar or local storage |
| `android:extractNativeLibs="false"` | Native libs stay inside the APK (smaller attack surface on disk) |
| `android:requestLegacyExternalStorage="false"` | Scoped storage — app can't roam the /sdcard tree |
| `webContentsDebuggingEnabled: false` | Chrome DevTools cannot attach remotely even if the phone is USB-connected |
| `server.cleartext: false` in capacitor config | Capacitor's bridge refuses plain HTTP |
| `allowMixedContent: false` | HTTPS pages cannot load HTTP sub-resources |
| `captureInput: true` | Android physical-key events are routed into the WebView, not other apps |

## Applied to release builds only (when signing secrets are set)

| Mitigation | What it stops |
|---|---|
| R8 code shrinking + obfuscation | Symbol names removed; reverse-engineering the classes is much slower |
| Resource shrinking | Unused resources stripped from APK |
| Debug log stripping (`Log.v/d/i` → no-ops) | Accidentally-logged sensitive data never reaches runtime |
| APK v2 + v3 signing | Tampered APKs fail to install (Android verifies signature) |
| `android:debuggable="false"` (automatic in release) | No `adb shell run-as <your.package.id>` |

## Setting up release signing (one-time)

### 1. Generate a release keystore
```bash
keytool -genkey -v -keystore release.keystore \
  -alias myapp -keyalg RSA -keysize 2048 -validity 10000
```
**Store this file safely.** If you lose it, you cannot publish updates
that Android will accept as the "same app".

### 2. Base64-encode it
```bash
# Linux / macOS
base64 -w0 release.keystore > release.keystore.b64

# Windows PowerShell
[Convert]::ToBase64String([IO.File]::ReadAllBytes("release.keystore")) > release.keystore.b64
```

### 3. Add GitHub Actions secrets
Repo → Settings → Secrets and variables → Actions → New repository secret

| Name | Value |
|---|---|
| `SIGNING_KEYSTORE_B64` | contents of `release.keystore.b64` |
| `SIGNING_KEY_ALIAS` | `myapp` (or whatever you used in `-alias`) |
| `SIGNING_KEY_PASSWORD` | key password |
| `SIGNING_STORE_PASSWORD` | keystore password |

### 4. Re-run the workflow
Next build produces `app-release.apk` in the GitHub Release, alongside
the existing `app-debug.apk`.

## Certificate pinning (extra paranoid)

The `network_security_config.xml` has a commented-out `<pin-set>` block.
To enable:

```bash
# Get the SHA-256 pin of your current cert:
openssl s_client -connect your-domain.example.com:443 -servername your-domain.example.com </dev/null 2>/dev/null \
  | openssl x509 -pubkey -noout \
  | openssl pkey -pubin -outform der \
  | openssl dgst -sha256 -binary \
  | base64
```

Paste the result into the `<pin digest="SHA-256">...` element, plus at
least one backup pin (for when your cert rotates). Trade-off: if Railway
rotates their cert and you didn't pre-pin the new one, the app will
refuse all connections until you ship an APK update.

For most deployments pinning is overkill — the trust-anchors=system
setting already rules out rogue user CAs, which is where 99% of mobile
MITM attacks come from.

## What's NOT protected

- **Rooted devices**: any Android app running on a rooted phone can be
  bypassed. Root detection ("SafetyNet") provides a weak deterrent but
  isn't foolproof. Don't ship secrets inside the APK.
- **Reverse engineering of WebView assets**: the JSX/HTML/JS bundle is
  inside the APK. R8 does not obfuscate it. Treat it as public.
- **App-level persistent storage encryption**: WebView's IndexedDB /
  localStorage / cookies are stored in the app's private directory,
  which is sandboxed but not encrypted at rest on unencrypted devices.
  Android 10+ encrypts the whole FS by default — fine for most users.
- **Play Protect warnings**: installing a debug-signed APK triggers
  "harmful app blocked" on some devices. Only release-signed APKs
  uploaded to Play Store get full trust.

## Recommended production setup

1. Enable release signing (see above)
2. Set up a CI-generated version bump (`versionCode` in build.gradle)
   so Android can detect upgrades
3. Publish through Play Store (full Google signing + Play Protect trust)
   — the debug/release APK is fine for private beta via the install
   dashboard but Play Store is the trusted channel for general public
