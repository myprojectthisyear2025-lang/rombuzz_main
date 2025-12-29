/**
 * ============================================================
 * 📁 File: models/MediaThread.js
 * 💬 Purpose: Match-private comment thread per media item
 *
 * Each (ownerId, peerId, mediaId) is a private thread:
 *   - ownerId = media owner (Tom)
 *   - peerId  = matched user (Maya)
 * ============================================================
 */

const mongoose = require("mongoose");

const msgSchema = new mongoose.Schema(
  {
    id: { type: String, required: true },
    userId: { type: String, required: true },
    text: { type: String, required: true },
    createdAt: { type: Number, default: () => Date.now() },
  },
  { _id: false }
);

const mediaThreadSchema = new mongoose.Schema(
  {
    id: { type: String, required: true, unique: true, index: true },

    ownerId: { type: String, required: true, index: true },
    peerId: { type: String, required: true, index: true },
    mediaId: { type: String, required: true, index: true },

    messages: { type: [msgSchema], default: [] },

    createdAt: { type: Number, default: () => Date.now() },
    updatedAt: { type: Number, default: () => Date.now() },
  },
  { timestamps: true }
);

// speed + uniqueness
mediaThreadSchema.index({ ownerId: 1, peerId: 1, mediaId: 1 }, { unique: true });

module.exports =
  mongoose.models.MediaThread || mongoose.model("MediaThread", mediaThreadSchema);
