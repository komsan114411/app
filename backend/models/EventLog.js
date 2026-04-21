// models/EventLog.js — Unified event stream replacing the single-purpose
// ClickEvent collection for NEW events. ClickEvent stays for backward
// compatibility with admin dashboards until they're migrated off.
//
// Event types written here (extensible — the 'type' field is free-form
// but we constrain it with a validator below):
//
//   install_page_view   user opens /install/<token>
//   install_click       user taps "Download APK" on install page
//   app_boot            app (web or APK) completes first /api/config
//   session_start       new visible session begins (client-side)
//   session_end         session ends (tab hidden >30min, unload, etc.)
//   button_click        user taps a quick-tile in UserApp
//   exit_click          user taps a link that navigates off the app
//   push_click          user opened the app via a push notification
//   screen_view         user entered a named screen / tab
//   error               JS error reported from client
//
// Indexes are tuned for the admin dashboard queries:
//   • by (type, createdAt desc) — timeseries per event type
//   • by (sourceToken, createdAt desc) — funnel per install link
//   • by (deviceId, createdAt desc) — per-user journey replay
//   • TTL 90 days on createdAt — bounded retention, matches privacy docs

import mongoose from 'mongoose';

const ALLOWED_TYPES = new Set([
  'install_page_view', 'install_click',
  'app_boot', 'session_start', 'session_end',
  'button_click', 'exit_click', 'push_click',
  'screen_view', 'error',
]);

const EventSchema = new mongoose.Schema({
  deviceId:    { type: String, maxlength: 40, index: true, default: '' },
  sessionId:   { type: String, maxlength: 40, default: '' },
  type:        {
    type: String, required: true, maxlength: 32, index: true,
    validate: { validator: v => ALLOWED_TYPES.has(v), message: 'unknown_event_type' },
  },

  // Polymorphic payload — meaning depends on type:
  //  button_click / exit_click → target = buttonId, label = button label
  //  screen_view               → target = screen name
  //  error                     → target = URL where error occurred, label = message
  //  install_click             → target = dl.android or dl.ios URL
  //  session_end               → durationMs set
  target:      { type: String, default: '', maxlength: 256 },
  label:       { type: String, default: '', maxlength: 200 },
  variant:     { type: String, default: '', maxlength: 8 },
  durationMs:  { type: Number, default: 0 },

  // Copied off the device for fast filtering without a $lookup
  sourceToken: { type: String, default: '', maxlength: 40, index: true },
  utmSource:   { type: String, default: '', maxlength: 40 },
  utmCampaign: { type: String, default: '', maxlength: 60 },
  appVersion:  { type: String, default: '', maxlength: 40 },
  platform:    { type: String, default: '', maxlength: 16 },

  // Soft fingerprint — never used as identity, only for debugging
  ipHash:      { type: String, default: '', maxlength: 24 },

  createdAt:   { type: Date, default: Date.now, expires: 60 * 60 * 24 * 90 },
}, { minimize: false });

EventSchema.index({ type: 1, createdAt: -1 });
EventSchema.index({ sourceToken: 1, type: 1, createdAt: -1 });
EventSchema.index({ deviceId: 1, createdAt: -1 });

export const EventLog = mongoose.model('EventLog', EventSchema);
export const EVENT_TYPES = ALLOWED_TYPES;
