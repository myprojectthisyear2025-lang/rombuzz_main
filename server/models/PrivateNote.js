/**
 * ============================================================
 * 📁 File: models/PrivateNote.js
 * 🧩 Purpose: Stores private diary-style notes for a user.
 *
 * Rules:
 *  - Notes are visible ONLY to the owner
 *  - No sharing
 *  - No reactions
 *  - No relations to posts or matches (yet)
 * ============================================================
 */

const mongoose = require("mongoose");

const PrivateNoteSchema = new mongoose.Schema({
  userId: {
    type: String,
    required: true,
    index: true,
  },

  text: {
    type: String,
    required: true,
    trim: true,
  },

  createdAt: {
    type: Number,
    default: () => Date.now(),
  },

  updatedAt: {
    type: Number,
    default: () => Date.now(),
  },
});

// Index for fast user lookups
PrivateNoteSchema.index({ userId: 1, createdAt: -1 });

module.exports = mongoose.model("PrivateNote", PrivateNoteSchema);
