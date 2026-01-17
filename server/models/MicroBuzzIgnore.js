/**
 * ============================================================
 * 📁 File: models/MicroBuzzIgnore.js
 * 🎯 Purpose: Stores permanent MicroBuzz ignores
 * ============================================================
 */

const mongoose = require("mongoose");

const MicroBuzzIgnoreSchema = new mongoose.Schema({
  byId: {
    type: String,
    required: true,
    index: true,
  },
  fromId: {
    type: String,
    required: true,
    index: true,
  },
  createdAt: {
    type: Date,
    default: Date.now,
  },
});

// prevent duplicates
MicroBuzzIgnoreSchema.index({ byId: 1, fromId: 1 }, { unique: true });

module.exports = mongoose.model("MicroBuzzIgnore", MicroBuzzIgnoreSchema);
