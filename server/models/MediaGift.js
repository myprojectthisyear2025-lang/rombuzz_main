/**
 * ============================================================
 * 📁 File: models/MediaGift.js
 * 🎁 Purpose: Store gifts sent to a specific gallery/media item.
 *
 * Used by:
 *  - Profile/gallery media gifts
 *  - LetsBuzz media gifts
 *  - Chat gifted-media unlock records
 *
 * Important wallet meaning:
 *  - Normal gifts can be reusable in-app BuzzCoin value.
 *  - Paid chat media unlocks are creator earnings records.
 *
 * Upgrade:
 *  - Keeps old stickerId + amount fields for backward compatibility.
 *  - Adds giftId + priceBC + placement + transaction fields for
 *    the new RomBuzz BuzzCoin-safe gift system.
 *  - Adds chat gifted-media history fields:
 *      roomId, msgId, mediaType, buyerId, sellerId
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

    // Generic media ownership / giver fields
    mediaId: { type: String, required: true, index: true },
    ownerId: { type: String, required: true, index: true },
    fromId: { type: String, required: true, index: true },

    // Gift / payment fields
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

    // ✅ Chat gifted-media unlock fields
    roomId: { type: String, default: "", index: true },
    msgId: { type: String, default: "", index: true },
    mediaType: {
      type: String,
      default: "",
      enum: ["", "image", "video", "audio"],
      index: true,
    },

    // buyerId = user who paid to unlock
    // sellerId = media owner who earned creator BC
    buyerId: { type: String, default: "", index: true },
    sellerId: { type: String, default: "", index: true },

    // Legacy fields
    stickerId: { type: String, default: "sticker_basic" },
    amount: { type: Number, default: 1 },

    createdAt: { type: Number, default: () => Date.now() },
  },
  { timestamps: true }
);

mediaGiftSchema.index({ mediaId: 1, ownerId: 1, fromId: 1, giftId: 1 });
mediaGiftSchema.index({ placement: 1, targetType: 1, targetId: 1 });
mediaGiftSchema.index({ roomId: 1, buyerId: 1 });
mediaGiftSchema.index({ roomId: 1, sellerId: 1 });
mediaGiftSchema.index({ sellerId: 1, createdAt: -1 });
mediaGiftSchema.index({ buyerId: 1, createdAt: -1 });

module.exports =
  mongoose.models.MediaGift || mongoose.model("MediaGift", mediaGiftSchema);