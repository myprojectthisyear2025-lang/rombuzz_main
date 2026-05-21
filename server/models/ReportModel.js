/**
 * ============================================================
 * 📁 File: models/ReportModel.js
 * 💾 Purpose: Stores user reports, evidence snapshots, and moderation outcomes.
 *
 * Used by:
 *   - POST /api/report
 *   - POST /api/reports
 *   - GET  /api/reports
 *
 * Notes:
 *   - Backwards-compatible with older frontend payloads:
 *       { targetId, reason }
 *   - Supports newer universal RomBuzz reports:
 *       profile, chat, message, post, reel, comment, microbuzz, video_call, gift, buzzcoin
 * ============================================================
 */

const mongoose = require("mongoose");

const reportSchema = new mongoose.Schema(
  {
    id: { type: String, required: true, unique: true, index: true },

    // Reporter
    from: { type: String, required: true, index: true },
    reporterId: { type: String, default: "", index: true },

    // Reported user / owner of the target
    targetId: { type: String, required: true, index: true },
    reportedUserId: { type: String, default: "", index: true },
    targetOwnerId: { type: String, default: "", index: true },

    // What was reported
    targetType: {
      type: String,
      enum: [
        "profile",
        "chat_conversation",
        "chat_message",
        "post",
        "reel",
        "comment",
        "reply",
        "microbuzz",
        "video_call",
        "gift",
        "buzzcoin",
        "unknown",
      ],
      default: "profile",
      index: true,
    },

    targetKind: { type: String, default: "" },
    source: { type: String, default: "" },

    // User selected reason + optional details
    reason: { type: String, required: true, trim: true },
    details: { type: String, default: "", trim: true },

    // Snapshot of useful context at the time of report.
    // Example:
    // {
    //   screen: "view-profile",
    //   roomId: "a_b",
    //   messageId: "...",
    //   mediaId: "...",
    //   callId: "...",
    //   giftTransactionId: "...",
    //   textPreview: "...",
    //   mediaUrl: "...",
    //   extra: {}
    // }
    evidenceSnapshot: { type: Object, default: {} },

    // Moderation workflow
    priority: {
      type: String,
      enum: ["low", "normal", "high", "urgent"],
      default: "normal",
      index: true,
    },

    status: {
      type: String,
      enum: [
        "open",
        "reviewing",
        "reviewed",
        "dismissed",
        "actioned",
        "resolved",
      ],
      default: "open",
      index: true,
    },

    adminNotes: { type: String, default: "" },
    actionTaken: { type: String, default: "" },
    reviewedBy: { type: String, default: "" },
    reviewedAt: { type: Date, default: null },
    resolvedAt: { type: Date, default: null },

    createdAt: { type: Date, default: Date.now, index: true },
  },
  { timestamps: true }
);

reportSchema.index({ from: 1, createdAt: -1 });
reportSchema.index({ reportedUserId: 1, createdAt: -1 });
reportSchema.index({ targetType: 1, status: 1, priority: 1 });

module.exports =
  mongoose.models.ReportModel ||
  mongoose.model("ReportModel", reportSchema);