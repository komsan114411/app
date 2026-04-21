// models/PushSubscription.js — Web Push endpoint + keys per browser.

import mongoose from 'mongoose';

const PushSubscriptionSchema = new mongoose.Schema({
  endpoint: { type: String, required: true, unique: true, maxlength: 1024 },
  keys: {
    p256dh: { type: String, required: true, maxlength: 256 },
    auth:   { type: String, required: true, maxlength: 256 },
  },
  userId:   { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  // Phase 3: anonymous device link. Lets the push broadcaster resolve
  // an analytics-segment (Device aggregate query) directly to the
  // matching subscription endpoints, without a lossy ipHash join.
  deviceId: { type: String, default: '', maxlength: 40, index: true },
  ipHash:   { type: String, default: '', maxlength: 24, index: true },
  userAgent:{ type: String, default: '', maxlength: 200 },
  lastSentAt:{ type: Date, default: null },
  failCount:{ type: Number, default: 0 },
}, { timestamps: true });

export const PushSubscription = mongoose.model('PushSubscription', PushSubscriptionSchema);
