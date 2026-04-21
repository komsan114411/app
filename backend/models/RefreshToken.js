// models/RefreshToken.js — rotation tokens (hashed, with reuse detection).

import mongoose from 'mongoose';

const RefreshTokenSchema = new mongoose.Schema({
  _id:       { type: String, required: true },   // jti (UUID)
  userId:    { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  tokenHash: { type: String, required: true },   // sha256 of the raw token
  ip:        { type: String, default: '', maxlength: 64 },
  userAgent: { type: String, default: '', maxlength: 200 },
  expiresAt: { type: Date, required: true, expires: 0 }, // TTL on value (Mongo removes post-expiry)
  revokedAt: { type: Date, default: null },
  revokeReason: { type: String, default: '', maxlength: 32 },
  // Captured at rotation time so the grace-window reuse-detection
  // check in utils/tokens.js can verify the follow-up request came
  // from the same IP. Without this field declared in the schema,
  // Mongoose silently dropped the write and every grace check saw
  // `undefined`, which allowed replayed cookies from a different
  // network to pass the time-bounded grace window.
  rotatedIp: { type: String, default: '', maxlength: 64 },
}, { timestamps: true });

RefreshTokenSchema.index({ userId: 1, revokedAt: 1 });

export const RefreshToken = mongoose.model('RefreshToken', RefreshTokenSchema);
