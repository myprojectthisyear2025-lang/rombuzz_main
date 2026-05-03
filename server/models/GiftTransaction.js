/**
 * ============================================================
 * 📁 File: models/GiftTransaction.js
 * 🎁 Purpose: Central gift transaction record for the modular RomBuzz
 * gift system.
 *
 * Used by:
 *  - services/giftService.js
 *  - routes/gifts.js
 *
 * Notes:
 *  - Stores server-side priceBC snapshot.
 *  - Does not trust frontend price.
 *  - Supports future refund / failed payment / payout workflows.
 * ============================================================
 */

const mongoose = require("mongoose");

const giftTransactionSchema = new mongoose.Schema(
  {
    id: { type: String, required: true, unique: true, index: true },
    transactionId: { type: String, required: true, unique: true, index: true },

    senderId: { type: String, required: true, index: true },
    receiverId: { type: String, required: true, index: true },

    giftId: { type: String, required: true, index: true },
    priceBC: { type: Number, required: true, min: 0 },

    placement: {
      type: String,
      required: true,
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

    targetType: { type: String, required: true, index: true },
    targetId: { type: String, required: true, index: true },

    status: {
      type: String,
      default: "completed",
      enum: ["pending", "completed", "failed", "refunded"],
      index: true,
    },

    failureReason: { type: String, default: "" },
    refundedAt: { type: Date, default: null },

    appPlatform: { type: String, default: "" },
    appVersion: { type: String, default: "" },

    metadata: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
  },
  { timestamps: true }
);

giftTransactionSchema.index({ receiverId: 1, targetType: 1, targetId: 1, giftId: 1 });
giftTransactionSchema.index({ senderId: 1, createdAt: -1 });
giftTransactionSchema.index({ receiverId: 1, createdAt: -1 });

module.exports =
  mongoose.models.GiftTransaction ||
  mongoose.model("GiftTransaction", giftTransactionSchema);
