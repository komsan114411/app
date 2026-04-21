// models/Device.js — Anonymous device identity for growth / retention
// analytics. Key ≠ PII: the client generates a UUIDv4 in localStorage on
// first open, and the server never resolves it back to any person. TTL
// 180 days on lastSeen means an inactive device drops out of the set
// automatically, so "total devices" stays bounded and "DAU/WAU/MAU" work
// on a rolling window without a sweep job.
//
// Attribution fields (sourceToken, utm*, firstSeenMedium) are captured
// ONCE on the first event we see from the device and never overwritten —
// so an install that came via `/install/abc123?utm_source=line` stays
// attributed to LINE forever, even if the same device later opens the
// app from a direct URL.

import mongoose from 'mongoose';

const DeviceSchema = new mongoose.Schema({
  _id:             { type: String, maxlength: 40 },      // client UUIDv4
  firstSeen:       { type: Date, default: Date.now },
  lastSeen:        { type: Date, default: Date.now, index: true },

  // Attribution — captured at first contact, never updated afterwards.
  sourceToken:     { type: String, default: '', maxlength: 40, index: true },
  utmSource:       { type: String, default: '', maxlength: 40, index: true },
  utmCampaign:     { type: String, default: '', maxlength: 60, index: true },
  utmMedium:       { type: String, default: '', maxlength: 40 },
  utmContent:      { type: String, default: '', maxlength: 60 },
  firstSeenMedium: { type: String, default: '', maxlength: 24 },
  // 'line-inapp' | 'facebook-inapp' | 'messenger-inapp' | 'apk' | 'chrome' | 'safari' | 'browser'

  // Platform fingerprint (updated every boot so we track migrations).
  platform:        { type: String, default: '', maxlength: 16 },
  // 'android-apk' | 'android-web' | 'ios-apk' | 'ios-web' | 'web-desktop' | 'web'
  osVersion:       { type: String, default: '', maxlength: 24 },
  deviceModel:     { type: String, default: '', maxlength: 60 },
  locale:          { type: String, default: '', maxlength: 16 },
  appVersion:      { type: String, default: '', maxlength: 40 },
  // commit SHA baked into the APK / web bundle at build time

  // Soft fingerprint for cross-session de-dup debugging. Never used as
  // a primary key — the client UUID is authoritative.
  ipHash:          { type: String, default: '', maxlength: 24 },
  lastUa:          { type: String, default: '', maxlength: 160 },

  // Aggregate counters maintained in-place so we don't need an expensive
  // groupBy over EventLog every dashboard paint.
  totalEvents:     { type: Number, default: 0 },
  totalSessions:   { type: Number, default: 0 },
}, { minimize: false });

// TTL: drop records we haven't seen in 180 days. Tied to lastSeen, not
// createdAt, so an active device never gets purged.
DeviceSchema.index({ lastSeen: 1 }, { expireAfterSeconds: 60 * 60 * 24 * 180 });

// Common dashboard queries:
DeviceSchema.index({ firstSeen: -1 });

export const Device = mongoose.model('Device', DeviceSchema);
