/**
 * ============================================================
 * 📁 File: models/GiftSummary.js
 * 📊 Purpose: Aggregated gift counts and BuzzCoin totals per target.
 *
 * Used by:
 *  - services/giftService.js
 *  - routes/gifts.js
 *
 * Notes:
 *  - This keeps gift insight screens fast.
 *  - Metadata should be looked up from config by giftId.
 * ============================================================
 */

const mongoose = require("mongoose");

const giftSummarySchema = new mongoose.Schema(
  {
    receiverId: { type: String, required: true, index: true },

    targetType: { type: String, required: true, index: true },
    targetId: { type: String, required: true, index: true },

    giftId: { type: String, required: true, index: true },

    count: { type: Number, default: 0, min: 0 },
    totalBC: { type: Number, default: 0, min: 0 },

    latestSenderId: { type: String, default: "", index: true },
    latestTransactionId: { type: String, default: "", index: true },
    latestGiftedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

giftSummarySchema.index(
  { receiverId: 1, targetType: 1, targetId: 1, giftId: 1 },
  { unique: true }
);

module.exports =
  mongoose.models.GiftSummary ||
  mongoose.model("GiftSummary", giftSummarySchema);
