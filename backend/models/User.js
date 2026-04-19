// models/User.js — admin users with argon2id + atomic lockout + 2FA (TOTP).

import mongoose from 'mongoose';
import { hash as argonHash, verify as argonVerify, Algorithm } from '@node-rs/argon2';
import { env } from '../config/env.js';
import { validatePasswordStrength } from '../utils/passwordPolicy.js';

const MAX_FAILED = 10;
const LOCK_MS = 30 * 60 * 1000;

const argonOpts = {
  algorithm: Algorithm.Argon2id,
  memoryCost: env.ARGON2_MEMORY,
  timeCost: env.ARGON2_TIME,
  parallelism: env.ARGON2_PARALLEL,
};

const DUMMY_HASH =
  '$argon2id$v=19$m=65536,t=3,p=1$' +
  'ZHVtbXlzYWx0ZHVtbXlzYWx0ZHVtbXk$' +
  'ZHVtbXlkdW1teWR1bW15ZHVtbXlkdW1teWR1bW15ZHVtbXlkdW1teWR1bQ';

const UserSchema = new mongoose.Schema({
  loginId:      { type: String, required: true, unique: true, lowercase: true, trim: true, minlength: 3, maxlength: 64, index: true, match: /^[a-z0-9._@-]+$/ },
  displayName:  { type: String, default: '', maxlength: 80, trim: true },
  email:        { type: String, default: '', lowercase: true, trim: true, maxlength: 254 }, // used for password reset (optional)
  passwordHash: { type: String, required: true, select: false },
  role:         { type: String, enum: ['admin', 'editor'], default: 'admin' },
  tokenVersion: { type: Number, default: 0 },
  mustChangePassword: { type: Boolean, default: false },

  // 2FA (TOTP)
  totpSecret:       { type: String, default: '', select: false },
  totpEnabled:      { type: Boolean, default: false },
  totpPendingAt:    { type: Date,   default: null, select: false },   // set by /totp/setup; /totp/enable rejects if older than 15 min
  totpBackupCodes:  { type: [String], default: [], select: false },

  failedLoginCount: { type: Number, default: 0, select: false },
  lockUntil:        { type: Date,   default: null, select: false },
  lastLoginAt:      { type: Date,   default: null },
  lastLoginIp:      { type: String, default: '', maxlength: 64 },

  createdBy:    { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  disabledAt:   { type: Date, default: null },
  disabledBy:   { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
}, { timestamps: true });

UserSchema.methods.setPassword = async function (plain, userInputs = []) {
  const check = await validatePasswordStrength(plain, [this.loginId, this.email, ...userInputs].filter(Boolean));
  if (!check.ok) {
    const err = new Error('weak_password');
    err.reason = check.reason;
    err.details = check;
    throw err;
  }
  this.passwordHash = await argonHash(plain, argonOpts);
  this.mustChangePassword = false;
};

UserSchema.methods.setPasswordUnsafe = async function (plain) {
  this.passwordHash = await argonHash(plain, argonOpts);
};

UserSchema.methods.verifyPassword = async function (plain) {
  if (!this.passwordHash || typeof plain !== 'string') return false;
  try { return await argonVerify(this.passwordHash, plain); }
  catch { return false; }
};

UserSchema.methods.isLocked = function () {
  return this.lockUntil && this.lockUntil > new Date();
};

UserSchema.methods.invalidateAllSessions = async function () {
  return User.findOneAndUpdate({ _id: this._id }, { $inc: { tokenVersion: 1 } });
};

UserSchema.statics.verifyDummy = async function (plain) {
  try { await argonVerify(DUMMY_HASH, typeof plain === 'string' ? plain : ''); } catch {}
  return false;
};

UserSchema.statics.atomicRecordFail = async function (userId) {
  const now = new Date();
  const lockAt = new Date(now.getTime() + LOCK_MS);
  return this.findOneAndUpdate(
    { _id: userId },
    [{
      $set: {
        failedLoginCount: {
          $cond: [
            { $gte: [{ $add: ['$failedLoginCount', 1] }, MAX_FAILED] },
            0,
            { $add: ['$failedLoginCount', 1] },
          ],
        },
        lockUntil: {
          $cond: [
            { $gte: [{ $add: ['$failedLoginCount', 1] }, MAX_FAILED] },
            lockAt,
            '$lockUntil',
          ],
        },
      },
    }],
    { new: true },
  );
};

UserSchema.statics.atomicRecordSuccess = async function (userId, ip, bumpTokenVersion = false) {
  const update = {
    $set: {
      failedLoginCount: 0,
      lockUntil: null,
      lastLoginAt: new Date(),
      lastLoginIp: (ip || '').slice(0, 64),
    },
  };
  if (bumpTokenVersion) update.$inc = { tokenVersion: 1 };
  return this.findOneAndUpdate({ _id: userId }, update, { new: true });
};

export const User = mongoose.model('User', UserSchema);
