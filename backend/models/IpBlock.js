// models/IpBlock.js — DB-backed per-IP brute-force throttle.
//
// In-memory rate limiting (express-rate-limit MemoryStore) falls apart
// when the app runs on multiple Railway instances — each worker keeps
// its own counter, so an attacker gets N × max attempts before any
// single instance trips. This model tracks failures in MongoDB where
// all instances see the same state, so the limit is global.
//
// Shape: one doc per (hashed) IP. `failures` is a sliding counter that
// gets reset every WINDOW_MS of inactivity. When it crosses THRESHOLD
// the `blockedUntil` field is set for BLOCK_MS. The guard middleware
// rejects requests while blockedUntil > now.

import mongoose from 'mongoose';

const IpBlockSchema = new mongoose.Schema({
  _id:          { type: String, required: true, maxlength: 64 },   // sha256(ip).slice(0,24)
  failures:     { type: Number, default: 0 },
  firstFailAt:  { type: Date, default: null },
  lastFailAt:   { type: Date, default: null },
  blockedUntil: { type: Date, default: null, index: true },
  reason:       { type: String, default: '', maxlength: 32 },
}, { timestamps: true });

export const IpBlock = mongoose.model('IpBlock', IpBlockSchema);
