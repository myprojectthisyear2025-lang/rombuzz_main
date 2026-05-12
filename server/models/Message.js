/**
 * ============================================================
 * 📁 File: models/Message.js
 * 💾 Purpose: MongoDB schema for RomBuzz user messages
 * ============================================================
 */

const mongoose = require("mongoose");

const messageSchema = new mongoose.Schema({
  id: { type: String, required: true, unique: true, index: true },
  from: { type: String, required: true },
  to: { type: String, required: true },
  text: { type: String, default: "" },
  type: {
    type: String,
    enum: ["text", "photo", "video", "call"],
    default: "text",
  },
  url: { type: String, default: null },
  ephemeral: { type: String, enum: ["keep", "once"], default: "keep" },

  // 📹 Instagram-style chat call history metadata
  callId: { type: String, default: "", index: true },
  callType: { type: String, enum: ["", "video"], default: "" },
  callStatus: {
    type: String,
    enum: ["", "ended", "missed", "declined", "canceled"],
    default: "",
  },
  callDurationSeconds: { type: Number, default: 0 },
  callStartedAt: { type: Date, default: null },
  callEndedAt: { type: Date, default: null },
  callEndedBy: { type: String, default: "" },

  createdAt: { type: Date, default: Date.now },
});

module.exports =
  mongoose.models.Message || mongoose.model("Message", messageSchema);
