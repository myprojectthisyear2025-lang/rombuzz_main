/**
 * ============================================================
 * 📁 File: models/GiftWithdrawalRequest.js
 * 🏦 Purpose: Stores future receiver earning / withdrawal requests.
 *
 * IMPORTANT:
 *  - This does NOT send money.
 *  - This is only a request record for future legal/compliance-reviewed
 *    payout flows.
 *  - Do not enable real payouts until App Store / Play Store / legal /
 *    tax / KYC requirements are reviewed.
 * ============================================================
 */

const mongoose = require("mongoose");

const giftWithdrawalRequestSchema = new mongoose.Schema(
  {
    id: { type: String, required: true, unique: true, index: true },
    userId: { type: String, required: true, index: true },

    amountBC: { type: Number, required: true, min: 1 },

    status: {
      type: String,
      default: "pending_review",
      enum: ["pending_review", "approved", "rejected", "cancelled", "paid"],
      index: true,
    },

    payoutMethod: { type: String, default: "" },
    payoutAccountLast4: { type: String, default: "" },
    legalName: { type: String, default: "" },

    kycStatusAtRequest: { type: String, default: "unknown" },
    rejectionReason: { type: String, default: "" },

    reviewedAt: { type: Date, default: null },
    paidAt: { type: Date, default: null },

    metadata: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
  },
  { timestamps: true }
);

giftWithdrawalRequestSchema.index({ userId: 1, createdAt: -1 });

module.exports =
  mongoose.models.GiftWithdrawalRequest ||
  mongoose.model("GiftWithdrawalRequest", giftWithdrawalRequestSchema);
