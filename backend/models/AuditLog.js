// models/AuditLog.js — tamper-evident log of admin actions.

import mongoose from 'mongoose';

const AuditLogSchema = new mongoose.Schema({
  actorId:   { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  actorEmail:{ type: String, default: '', maxlength: 254 },
  action:    { type: String, required: true, maxlength: 64, index: true },
  target:    { type: String, default: '', maxlength: 128 },
  ipHash:    { type: String, default: '', maxlength: 24 },
  userAgent: { type: String, default: '', maxlength: 200 },
  diff:      { type: Object, default: null },
  outcome:   { type: String, enum: ['success', 'failure'], default: 'success' },
  createdAt: { type: Date, default: Date.now, expires: 60 * 60 * 24 * 365 }, // 1y
});

AuditLogSchema.index({ createdAt: -1 });

export const AuditLog = mongoose.model('AuditLog', AuditLogSchema);
