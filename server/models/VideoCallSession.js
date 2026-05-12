/**
 * ============================================================
 * 📁 File: models/VideoCallSession.js
 * 🎥 Purpose: Store RomBuzz 1-to-1 video call sessions.
 *
 * Used by:
 *   - routes/videoCalls.js
 *
 * Notes:
 *   - This does NOT store Agora tokens.
 *   - Tokens are generated on demand by services/agoraTokenService.js.
 *   - This tracks call state: ringing, accepted, declined, ended, missed.
 * ============================================================
 */

const mongoose = require("mongoose");

const participantSnapshotSchema = new mongoose.Schema(
  {
    id: { type: String, default: "" },
    firstName: { type: String, default: "" },
    lastName: { type: String, default: "" },
    avatar: { type: String, default: "" },
  },
  { _id: false }
);

const videoCallSessionSchema = new mongoose.Schema(
  {
    id: { type: String, required: true, unique: true, index: true },

    provider: {
      type: String,
      enum: ["agora"],
      default: "agora",
      index: true,
    },

    callType: {
      type: String,
      enum: ["video"],
      default: "video",
    },

    status: {
      type: String,
      enum: [
        "ringing",
        "accepted",
        "declined",
        "canceled",
        "ended",
        "missed",
        "failed",
      ],
      default: "ringing",
      index: true,
    },

    callerId: { type: String, required: true, index: true },
    receiverId: { type: String, required: true, index: true },
    participants: { type: [String], default: [], index: true },

    roomId: { type: String, required: true, index: true },
    channelName: { type: String, required: true, unique: true, index: true },

    caller: { type: participantSnapshotSchema, default: null },
    receiver: { type: participantSnapshotSchema, default: null },

    startedAt: { type: Date, default: Date.now, index: true },
    acceptedAt: { type: Date, default: null },
    declinedAt: { type: Date, default: null },
    canceledAt: { type: Date, default: null },
    endedAt: { type: Date, default: null },
    missedAt: { type: Date, default: null },

    expiresAt: { type: Date, default: null, index: true },

    endedBy: { type: String, default: "" },
    lastReason: { type: String, default: "" },

    metadata: {
      type: Map,
      of: mongoose.Schema.Types.Mixed,
      default: {},
    },
  },
  {
    timestamps: true,
  }
);

videoCallSessionSchema.index({ callerId: 1, receiverId: 1, createdAt: -1 });
videoCallSessionSchema.index({ receiverId: 1, status: 1, createdAt: -1 });
videoCallSessionSchema.index({ participants: 1, status: 1, createdAt: -1 });

module.exports =
  mongoose.models.VideoCallSession ||
  mongoose.model("VideoCallSession", videoCallSessionSchema);