// models/AppConfig.js — singleton doc holding the public-facing app state.

import mongoose from 'mongoose';

const ButtonSchema = new mongoose.Schema({
  id:    { type: String, required: true, maxlength: 64 },
  label: { type: String, required: true, maxlength: 120 },
  sub:   { type: String, default: '', maxlength: 200 },
  icon:  { type: String, default: 'sparkle', maxlength: 32 },
  url:   { type: String, default: '', maxlength: 2048 },
  // Optional: tags for grouping/search in the user page
  tags:  { type: [String], default: [], validate: v => !v || v.length <= 10 },
  // Scheduled publish window (null = always visible)
  publishAt:   { type: Date, default: null },
  unpublishAt: { type: Date, default: null },
  // Simple A/B variant (only 'a' or 'b' are matched; undefined = no test)
  variant:     { type: String, default: '', maxlength: 8 },
}, { _id: false });

const BannerSchema = new mongoose.Schema({
  id:       { type: String, required: true, maxlength: 64 },
  title:    { type: String, default: '', maxlength: 120 },
  subtitle: { type: String, default: '', maxlength: 200 },
  tone:     { type: String, default: 'leaf', maxlength: 32 },
  imageUrl: { type: String, default: '', maxlength: 512 },   // upload URL (served from /uploads)
  linkUrl:  { type: String, default: '', maxlength: 2048 },  // optional click destination
}, { _id: false });

const ContactSchema = new mongoose.Schema({
  label:   { type: String, default: 'ติดต่อแอดมิน', maxlength: 120 },
  channel: { type: String, default: 'line', maxlength: 32 },
  value:   { type: String, default: '', maxlength: 200 },
}, { _id: false });

const DownloadLinksSchema = new mongoose.Schema({
  android:      { type: String, default: '', maxlength: 2048 },   // URL to APK / Play Store
  ios:          { type: String, default: '', maxlength: 2048 },   // URL to App Store / TestFlight
  androidLabel: { type: String, default: '', maxlength: 40 },
  iosLabel:     { type: String, default: '', maxlength: 40 },
  note:         { type: String, default: '', maxlength: 140 },
}, { _id: false });

// Rotating install-link tokens. Admin generates a random token → only URLs
// carrying that token serve the install dashboard. Regenerating invalidates
// every previously issued link instantly. No permanent /install URL exists.
const InstallTokenSchema = new mongoose.Schema({
  current:    { type: String, default: '', maxlength: 64 },
  rotatedAt:  { type: Date, default: null },
  rotatedBy:  { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  rotationCount: { type: Number, default: 0 },
}, { _id: false });

// Rotating admin-access token. The /admin/<token> URL is the ONLY way to
// reach the admin login form — the main user page has no "เข้าหลังบ้าน"
// button. Admin rotates the token in the console any time the URL leaks
// or after onboarding a new person. Seed.js bootstraps this with a random
// value printed to the boot log so the first operator has an access URL.
const AdminAccessTokenSchema = new mongoose.Schema({
  current:    { type: String, default: '', maxlength: 64 },
  rotatedAt:  { type: Date, default: null },
  rotatedBy:  { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  rotationCount: { type: Number, default: 0 },
}, { _id: false });

const AppConfigSchema = new mongoose.Schema({
  _id:     { type: String, default: 'singleton' },
  appName: { type: String, default: 'แอปของฉัน', maxlength: 120 },
  tagline: { type: String, default: '', maxlength: 200 },
  // Optional square icon shown in browser tab (favicon), hero avatar on
  // install page, and admin topbar. Accepts /media/* paths or absolute
  // https:// URLs (same validation as banner imageUrl).
  appIcon: { type: String, default: '', maxlength: 512 },
  theme:   { type: String, default: 'cream', maxlength: 32 },
  banners: { type: [BannerSchema], default: [] },
  buttons: { type: [ButtonSchema], default: [] },
  contact: { type: ContactSchema, default: () => ({}) },

  // i18n + user-side customisation
  language: { type: String, default: 'th', maxlength: 8 },
  darkMode: { type: String, enum: ['auto', 'light', 'dark'], default: 'auto' },

  // Feature flags — frontend reads these to toggle UI paths
  featureFlags: { type: mongoose.Schema.Types.Mixed, default: {} },

  // Mobile app download links (Android APK / iOS TestFlight etc.)
  downloadLinks: { type: DownloadLinksSchema, default: () => ({}) },

  // Rotating install-link token — see InstallTokenSchema comment
  installToken: { type: InstallTokenSchema, default: () => ({}) },

  // Rotating admin-access URL token — see AdminAccessTokenSchema comment
  adminAccessToken: { type: AdminAccessTokenSchema, default: () => ({}) },

  updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
}, { timestamps: true, optimisticConcurrency: true });

export const AppConfig = mongoose.model('AppConfig', AppConfigSchema);

export async function getAppConfig() {
  let doc = await AppConfig.findById('singleton');
  if (!doc) doc = await AppConfig.create({ _id: 'singleton' });
  return doc;
}

// Return buttons filtered by publish window (date window only; variant handled client-side)
export function publishedButtons(buttons) {
  const now = Date.now();
  return (buttons || []).filter(b => {
    if (b.publishAt && new Date(b.publishAt).getTime() > now) return false;
    if (b.unpublishAt && new Date(b.unpublishAt).getTime() <= now) return false;
    return true;
  });
}
