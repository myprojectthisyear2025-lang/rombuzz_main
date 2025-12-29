/**
 * ============================================================
 * 📁 File: models/MediaGift.js
 * 🎁 Purpose: Store gifts sent to a specific gallery media item
 * ============================================================
 */

const mongoose = require("mongoose");

const mediaGiftSchema = new mongoose.Schema(
  {
    id: { type: String, required: true, unique: true, index: true },

    mediaId: { type: String, required: true, index: true },

    // owner (receiver)
    ownerId: { type: String, required: true, index: true },

    // sender
    fromId: { type: String, required: true, index: true },

    stickerId: { type: String, default: "sticker_basic" },
    amount: { type: Number, default: 0 },

    createdAt: { type: Number, default: () => Date.now() },
  },
  { timestamps: true }
);

module.exports =
  mongoose.models.MediaGift || mongoose.model("MediaGift", mediaGiftSchema);
