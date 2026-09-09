/**
 * ============================================================
 * 📁 File: models/MicroBuzzPresence.js
 * 💾 Purpose: Tracks active MicroBuzz users with selfie + coords
 *    and provides an indexed GeoJSON point for radius searches.
 * ============================================================
 */
const mongoose = require("mongoose");

const microBuzzPresenceSchema = new mongoose.Schema({
  userId: { type: String, required: true, index: true, unique: true },
  sessionId: { type: String, required: true, index: true },
  selfieUrl: { type: String, required: true },
  lat: { type: Number, required: true },
  lng: { type: Number, required: true },
  location: {
    type: { type: String, enum: ["Point"] },
    coordinates: { type: [Number] },
  },
  updatedAt: { type: Date, default: Date.now, index: true },
});

microBuzzPresenceSchema.index({ location: "2dsphere" });

module.exports =
  mongoose.models.MicroBuzzPresence ||
  mongoose.model("MicroBuzzPresence", microBuzzPresenceSchema);