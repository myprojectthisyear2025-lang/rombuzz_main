// Durable Expo receipt tracking contains delivery metadata only, never message bodies.
const mongoose = require("mongoose");
const schema = new mongoose.Schema({
  ticketId: { type: String, required: true, unique: true },
  token: { type: String, required: true },
  nextCheckAt: { type: Date, required: true, index: true },
  expiresAt: { type: Date, required: true, index: { expires: 0 } },
}, { timestamps: true });
module.exports = mongoose.models.ExpoPushReceipt || mongoose.model("ExpoPushReceipt", schema);
