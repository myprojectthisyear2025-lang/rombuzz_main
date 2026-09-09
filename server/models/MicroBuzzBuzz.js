/**
 * ============================================================
 * 📁 File: models/MicroBuzzBuzz.js
 * 💾 Purpose: Temporary storage for pending MicroBuzz requests.
 *    Requests expire automatically so stale radar taps cannot linger.
 * ============================================================
 */
const mongoose = require("mongoose");

const microBuzzBuzzSchema = new mongoose.Schema({
  fromId: { type: String, required: true, index: true },
  toId: { type: String, required: true, index: true },
  time: {
    type: Date,
    default: Date.now,
    expires: 5 * 60,
  },
});

microBuzzBuzzSchema.index({ toId: 1, time: -1 });
microBuzzBuzzSchema.index({ fromId: 1, toId: 1, time: -1 });

module.exports =
  mongoose.models.MicroBuzzBuzz ||
  mongoose.model("MicroBuzzBuzz", microBuzzBuzzSchema);