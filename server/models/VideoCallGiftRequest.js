/**
 * ============================================================
 * 📁 File: models/VideoCallGiftRequest.js
 * 🎥🎁 Purpose: Store BuzzCoin requests made during 1-to-1
 *               RomBuzz video calls.
 *
 * Used by:
 *   - services/videoCallGiftRequestService.js
 *   - routes/videoCallGifts.js
 *
 * Flow:
 *   1. Tom requests 100 BC from Kylie during a video call.
 *   2. Request is saved as "pending".
 *   3. Kylie accepts or rejects.
 *   4. If accepted, Kylie balanceBC is debited and Tom earnedBC is credited.
 *   5. If rejected, no wallet balance changes.
 *
 * Notes:
 *   - This does NOT store video/audio media.
 *   - This does NOT process real-money withdrawals.
 *   - This only tracks in-app BuzzCoin request state.
 * ============================================================
 */

const mongoose = require("mongoose");

const videoCallGiftRequestSchema = new mongoose.Schema(
  {
    id: { type: String, required: true, unique: true, index: true },

    callId: { type: String, required: true, index: true },
    roomId: { type: String, default: "", index: true },

    requesterId: { type: String, required: true, index: true },
    receiverId: { type: String, required: true, index: true },

    amountBC: { type: Number, required: true, min: 1 },

    note: { type: String, default: "", maxlength: 100 },

    status: {
      type: String,
      default: "pending",
      enum: ["pending", "accepted", "rejected", "expired", "cancelled"],
      index: true,
    },

    acceptedAt: { type: Date, default: null },
    rejectedAt: { type: Date, default: null },
    expiredAt: { type: Date, default: null },
    cancelledAt: { type: Date, default: null },

    respondedBy: { type: String, default: "" },

    transactionId: { type: String, default: "", index: true },

    failureReason: { type: String, default: "" },

    metadata: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
  },
  { timestamps: true }
);

videoCallGiftRequestSchema.index({ callId: 1, status: 1, createdAt: -1 });
videoCallGiftRequestSchema.index({ requesterId: 1, createdAt: -1 });
videoCallGiftRequestSchema.index({ receiverId: 1, createdAt: -1 });

module.exports =
  mongoose.models.VideoCallGiftRequest ||
  mongoose.model("VideoCallGiftRequest", videoCallGiftRequestSchema);