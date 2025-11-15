/**
 * ============================================================
 * 📁 File: models/Block.js
 * 💾 Purpose: Store user-to-user block relationships
 *
 * Description:
 *   - Tracks which users have blocked which other users.
 *   - One entry per block:
 *        blocker → blocks → blocked
 * ============================================================
 */

const mongoose = require("mongoose");

const blockSchema = new mongoose.Schema(
  {
    id: { type: String, required: true, unique: true },
    blocker: { type: String, required: true, index: true },
    blocked: { type: String, required: true, index: true },
    createdAt: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

module.exports =
  mongoose.models.Block || mongoose.model("Block", blockSchema);
