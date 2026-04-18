// models/AppConfig.js — singleton doc holding the public-facing app state.
// Uses optimistic concurrency (__v) so two admins saving simultaneously
// don't silently clobber each other's edits.

import mongoose from 'mongoose';

const ButtonSchema = new mongoose.Schema({
  id:    { type: String, required: true, maxlength: 64 },
  label: { type: String, required: true, maxlength: 120 },
  sub:   { type: String, default: '', maxlength: 200 },
  icon:  { type: String, default: 'sparkle', maxlength: 32 },
  url:   { type: String, default: '', maxlength: 2048 },
}, { _id: false });

const BannerSchema = new mongoose.Schema({
  id:       { type: String, required: true, maxlength: 64 },
  title:    { type: String, default: '', maxlength: 120 },
  subtitle: { type: String, default: '', maxlength: 200 },
  tone:     { type: String, default: 'leaf', maxlength: 32 },
}, { _id: false });

const ContactSchema = new mongoose.Schema({
  label:   { type: String, default: 'ติดต่อแอดมิน', maxlength: 120 },
  channel: { type: String, default: 'line', maxlength: 32 },
  value:   { type: String, default: '', maxlength: 200 },
}, { _id: false });

const AppConfigSchema = new mongoose.Schema({
  // Fixed _id so there's always exactly one document.
  _id:     { type: String, default: 'singleton' },
  appName: { type: String, default: 'แอปของฉัน', maxlength: 120 },
  tagline: { type: String, default: '', maxlength: 200 },
  theme:   { type: String, default: 'cream', maxlength: 32 },
  banners: { type: [BannerSchema], default: [] },
  buttons: { type: [ButtonSchema], default: [] },
  contact: { type: ContactSchema, default: () => ({}) },

  updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
}, { timestamps: true, optimisticConcurrency: true });

export const AppConfig = mongoose.model('AppConfig', AppConfigSchema);

// Helper: get-or-create singleton.
export async function getAppConfig() {
  let doc = await AppConfig.findById('singleton');
  if (!doc) doc = await AppConfig.create({ _id: 'singleton' });
  return doc;
}
