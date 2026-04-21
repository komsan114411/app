// models/PushCampaign.js — Reusable push notification campaigns.
//
// Two execution models:
//   • one-shot        — admin clicks "send now" with a segment picked
//                        from the UI, we dispatch immediately and
//                        record `sentAt`.
//   • scheduled       — admin sets sendAt; the broadcaster worker polls
//                        every minute and sends when due.
//
// A campaign carries a SEGMENT spec that's resolved at send time
// (not at create time) so "inactive 14+ days" stays dynamic.

import mongoose from 'mongoose';

const SegmentSchema = new mongoose.Schema({
  // All fields optional; server ANDs whichever are set.
  inactiveDays:   { type: Number, default: 0 },   // lastSeen < now - inactiveDays
  activeDays:     { type: Number, default: 0 },   // lastSeen >= now - activeDays
  newWithinDays:  { type: Number, default: 0 },   // firstSeen within N days
  clickedButton:  { type: String, default: '', maxlength: 64 },
  sourceToken:    { type: String, default: '', maxlength: 40 },
  utmSource:      { type: String, default: '', maxlength: 40 },
  platform:       { type: String, default: '', maxlength: 16 },  // prefix-matched
  locale:         { type: String, default: '', maxlength: 16 },  // prefix-matched
}, { _id: false });

const CampaignSchema = new mongoose.Schema({
  name:          { type: String, required: true, maxlength: 120 },
  title:         { type: String, required: true, maxlength: 120 },
  body:          { type: String, default: '', maxlength: 300 },
  url:           { type: String, default: '/',  maxlength: 512 },   // tagged with ?c=<id> at send time
  segment:       { type: SegmentSchema, default: () => ({}) },
  status:        { type: String, enum: ['draft', 'scheduled', 'sending', 'sent', 'failed', 'cancelled'], default: 'draft', index: true },
  sendAt:        { type: Date, default: null, index: true },
  sentAt:        { type: Date, default: null },
  createdBy:     { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  // Outcome counters — filled in after a send round.
  stats:         {
    targeted:  { type: Number, default: 0 },
    sent:      { type: Number, default: 0 },
    failed:    { type: Number, default: 0 },
    pruned:    { type: Number, default: 0 },
    clicks:    { type: Number, default: 0 },  // push_click events tagged with c=<id>
  },
}, { timestamps: true });

CampaignSchema.index({ status: 1, sendAt: 1 });

export const PushCampaign = mongoose.model('PushCampaign', CampaignSchema);
