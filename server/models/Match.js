/**
 * ============================================================
 * 📁 File: models/Match.js
 * 💾 Purpose: Mongoose schema for user matches / buzz connections
 *
 * Description:
 *   Stores pairwise match relationships between users.
 *   Mirrors LowDB structure and supports array-based queries.
 * ============================================================
 */

const mongoose = require("mongoose");

const matchSchema = new mongoose.Schema(
  {
    id: { type: String, required: true, unique: true, index: true },

    // ⭐ Clean modern style (this is what the entire backend uses)
    users: {
      type: [String],
      required: true,
      validate: {
        validator: (arr) => Array.isArray(arr) && arr.length === 2,
        message: "Match.users must contain exactly 2 user IDs",
      },
      index: true,
    },

    status: {
      type: String,
      enum: ["matched"],
      default: "matched",
    },

    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

module.exports =
  mongoose.models.Match || mongoose.model("Match", matchSchema);