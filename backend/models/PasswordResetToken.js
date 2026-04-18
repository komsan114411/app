// models/PasswordResetToken.js — single-use, short-lived tokens for forgot-password.
// Tokens are hashed at rest; raw value is only ever in the email link.

import mongoose from 'mongoose';

const PasswordResetTokenSchema = new mongoose.Schema({
  _id:        { type: String, required: true },        // random id (exposed in email link)
  userId:     { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  tokenHash:  { type: String, required: true },
  expiresAt:  { type: Date, required: true, expires: 0 },
  usedAt:     { type: Date, default: null },
  ipHash:     { type: String, default: '', maxlength: 24 },
}, { timestamps: true });

export const PasswordResetToken = mongoose.model('PasswordResetToken', PasswordResetTokenSchema);
