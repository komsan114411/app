// models/ClickEvent.js — analytics with TTL 90d and hashed IPs (no raw PII).

import mongoose from 'mongoose';

const ClickEventSchema = new mongoose.Schema({
  buttonId:  { type: String, required: true, maxlength: 64, index: true },
  label:     { type: String, default: '', maxlength: 120 },
  variant:   { type: String, default: '', maxlength: 8 },
  ipHash:    { type: String, default: '', maxlength: 24, index: true },
  userAgent: { type: String, default: '', maxlength: 160 },
  referer:   { type: String, default: '', maxlength: 256 },
  createdAt: { type: Date, default: Date.now, expires: 60 * 60 * 24 * 90 },
});

ClickEventSchema.index({ createdAt: -1 });

export const ClickEvent = mongoose.model('ClickEvent', ClickEventSchema);
