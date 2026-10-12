// A shared transaction write target serializes claims for one token across server processes.
const mongoose = require("mongoose");
const schema = new mongoose.Schema({
  _id: { type: String, required: true }, // SHA-256 of token; never a raw token or account credential.
  revision: { type: Number, default: 0 },
}, { versionKey: false });
module.exports = mongoose.models.PushTokenGuard || mongoose.model("PushTokenGuard", schema);
