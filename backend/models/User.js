// models/User.js — admin users with argon2id hashing + atomic lockout.
// argon2 over bcrypt: memory-hard (GPU/ASIC-resistant), no event-loop block.

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

// A fixed, well-formed dummy hash. verify() against it takes ~same time as a
// real verify → prevents timing-based user enumeration for "no such user".
// Generated once and embedded; doesn't match any real password.
const DUMMY_HASH =
  '$argon2id$v=19$m=65536,t=3,p=1$' +
  'ZHVtbXlzYWx0ZHVtbXlzYWx0ZHVtbXk$' +
  'ZHVtbXlkdW1teWR1bW15ZHVtbXlkdW1teWR1bW15ZHVtbXlkdW1teWR1bQ';

const UserSchema = new mongoose.Schema({
  // loginId — username-style login (alphanumeric + ._-), not strict email.
  // Legacy installs migrated via `email → loginId` rename.
  loginId:      { type: String, required: true, unique: true, lowercase: true, trim: true, minlength: 3, maxlength: 64, index: true, match: /^[a-z0-9._@-]+$/ },
  passwordHash: { type: String, required: true, select: false },
  role:         { type: String, enum: ['admin', 'editor'], default: 'admin' },
  tokenVersion: { type: Number, default: 0 },

  // When true, the user is forced to change password on next login before
  // any other action is allowed. Seed-created admins start with this = true.
  mustChangePassword: { type: Boolean, default: false },

  failedLoginCount: { type: Number, default: 0, select: false },
  lockUntil:        { type: Date,   default: null, select: false },
  lastLoginAt:      { type: Date,   default: null },
  lastLoginIp:      { type: String, default: '', maxlength: 64 },

  createdBy:    { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  disabledAt:   { type: Date, default: null },
  disabledBy:   { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
}, { timestamps: true });

UserSchema.methods.setPassword = async function (plain, userInputs = []) {
  const check = await validatePasswordStrength(plain, [this.loginId, ...userInputs].filter(Boolean));
  if (!check.ok) {
    const err = new Error('weak_password');
    err.reason = check.reason;
    err.details = check;
    throw err;
  }
  this.passwordHash = await argonHash(plain, argonOpts);
  this.mustChangePassword = false;
};

// Skip policy check — for seed only. NEVER expose via HTTP.
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

// ── Static timing-safe "verify against dummy to burn cycles" ──────
// Used when user lookup returned null, so response time matches a real verify.
UserSchema.statics.verifyDummy = async function (plain) {
  try { await argonVerify(DUMMY_HASH, typeof plain === 'string' ? plain : ''); } catch {}
  return false;
};

// ── Static atomic lockout increment ──────────────────────────────
// One round-trip. If (count+1) reaches MAX_FAILED → lock for LOCK_MS.
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
