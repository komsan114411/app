// models/MediaAsset.js — uploaded images stored directly in MongoDB.
//
// Rationale: Railway / Fly / Render containers have ephemeral filesystems,
// so `./uploads/*.png` disappears on every redeploy. Putting the bytes in
// the database keeps banner images durable without requiring a volume
// subscription or S3-like object storage. Access is public (same as the
// old /uploads static mount) — these are marketing assets the admin chose
// to publish, not private files.

import mongoose from 'mongoose';

const MediaAssetSchema = new mongoose.Schema({
  // _id is `<hex>.<ext>` — stored as string so URLs carry the ext and the
  // browser can infer Content-Type even before it reaches our handler.
  _id:        { type: String, required: true, maxlength: 128 },
  mime:       { type: String, required: true, maxlength: 64 },
  size:       { type: Number, required: true, min: 0, max: 60 * 1024 * 1024 }, // bumped for APKs
  filename:   { type: String, default: '', maxlength: 120 },
  kind:       { type: String, enum: ['image', 'apk', 'other'], default: 'image' },
  data:       { type: Buffer, required: true },
  uploadedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
}, { timestamps: true });

export const MediaAsset = mongoose.model('MediaAsset', MediaAssetSchema);
