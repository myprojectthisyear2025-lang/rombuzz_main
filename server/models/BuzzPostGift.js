/**
 * ============================================================
 * 📁 File: models/BuzzPostGift.js
 * 💾 Purpose: Gifts for LetsBuzz posts/reels (matched feed items)
 *
 * Upgrade:
 *  - Keeps old giftKey + amount fields for backward compatibility
 *  - Adds giftId + priceBC + placement + transaction fields for
 *    the new RomBuzz BuzzCoin-safe gift system
 * ============================================================
 */

const mongoose = require("mongoose");

const buzzPostGiftSchema = new mongoose.Schema(
  {
    id: { type: String, required: true, unique: true, index: true },

    postId: { type: String, required: true, index: true },
    ownerId: { type: String, required: true, index: true },
    fromId: { type: String, required: true, index: true },

    giftId: { type: String, required: true, index: true },
    priceBC: { type: Number, required: true, min: 0 },

    placement: {
      type: String,
      default: "posts",
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

    targetType: { type: String, default: "buzz_post", index: true },
    targetId: { type: String, index: true },
    transactionId: { type: String, index: true },

    status: {
      type: String,
      default: "completed",
      enum: ["pending", "completed", "failed", "refunded"],
      index: true,
    },

    giftKey: { type: String, required: true },
    amount: { type: Number, default: 1 },

    createdAt: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

buzzPostGiftSchema.index({ postId: 1, ownerId: 1, fromId: 1, giftId: 1 });
buzzPostGiftSchema.index({ postId: 1, ownerId: 1, fromId: 1, giftKey: 1 });
buzzPostGiftSchema.index({ transactionId: 1 });

module.exports =
  mongoose.models.BuzzPostGift ||
  mongoose.model("BuzzPostGift", buzzPostGiftSchema);
