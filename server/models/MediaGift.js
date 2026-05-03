/**
 * ============================================================
 * 📁 File: models/MediaGift.js
 * 🎁 Purpose: Store gifts sent to a specific gallery media item
 *
 * Upgrade:
 *  - Keeps old stickerId + amount fields for backward compatibility
 *  - Adds giftId + priceBC + placement + transaction fields for
 *    the new RomBuzz BuzzCoin-safe gift system
 *
 * Cleanup:
 *  - Removed duplicate schema.index({ transactionId: 1 }) because
 *    transactionId already declares index: true.
 * ============================================================
 */

const mongoose = require("mongoose");

const mediaGiftSchema = new mongoose.Schema(
  {
    id: { type: String, required: true, unique: true, index: true },

    mediaId: { type: String, required: true, index: true },
    ownerId: { type: String, required: true, index: true },
    fromId: { type: String, required: true, index: true },

    giftId: { type: String, required: true, index: true },
    priceBC: { type: Number, required: true, min: 0 },

    placement: {
      type: String,
      default: "profile_media",
      enum: [
        "reels",
        "posts",
        "profile_media",
        "chat",
        "buzzpoke",
        "microbuzz",
        "match_celebration",
        "streak",
        "universal",
      ],
      index: true,
    },

    targetType: { type: String, default: "profile_media", index: true },
    targetId: { type: String, index: true },
    transactionId: { type: String, index: true },

    status: {
      type: String,
      default: "completed",
      enum: ["pending", "completed", "failed", "refunded"],
      index: true,
    },

    stickerId: { type: String, default: "sticker_basic" },
    amount: { type: Number, default: 1 },

    createdAt: { type: Number, default: () => Date.now() },
  },
  { timestamps: true }
);

mediaGiftSchema.index({ mediaId: 1, ownerId: 1, fromId: 1, giftId: 1 });

module.exports =
  mongoose.models.MediaGift || mongoose.model("MediaGift", mediaGiftSchema);
