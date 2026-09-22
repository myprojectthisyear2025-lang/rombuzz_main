/**
 * ============================================================
 * 📁 File: models/StoryModel.js
 * 💾 Purpose: Mongoose schema for 24-hour user stories (text + image + video)
 *
 * ✅ Supports:
 *  - text-only status stories (type="text", mediaUrl="")
 *  - image stories (type="image")
 *  - video stories (type="video")
 *  - auto expiry after expiresAt (TTL index)
 * ============================================================
 */

const mongoose = require("mongoose");

const storySchema = new mongoose.Schema(
  {
    id: { type: String, required: true, unique: true, index: true },
    userId: { type: String, required: true, index: true },

    // ✅ allow text-only stories
    mediaUrl: { type: String, default: "" },

    text: { type: String, default: "" },

    // ✅ add "text"
    type: { type: String, enum: ["text", "image", "video"], default: "text" },

    createdAt: { type: Date, default: Date.now },
    expiresAt: { type: Date, required: true },

    isActive: { type: Boolean, default: true },

    // store userIds of viewers
    views: { type: [String], default: [] },
  },
  { timestamps: true }
);

// Auto-remove after expiry
storySchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
storySchema.index({ userId: 1, isActive: 1, createdAt: 1 });

module.exports =
  mongoose.models.StoryModel || mongoose.model("StoryModel", storySchema);
