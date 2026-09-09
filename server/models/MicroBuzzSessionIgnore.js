/**
 * ============================================================
 * 📁 File: models/MicroBuzzSessionIgnore.js
 * 🎯 Purpose: Session-scoped MicroBuzz ignores only.
 * ============================================================
 */
const mongoose = require("mongoose");

const schema = new mongoose.Schema({
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

  sessionId: {
    type: String,
    required: true,
    index: true,
  },

  createdAt: {
    type: Date,
    default: Date.now,
  },

  expiresAt: {
    type: Date,
    default: () =>
      new Date(
        Date.now() +
          24 * 60 * 60 * 1000
      ),
    expires: 0,
  },
});

schema.index(
  {
    byId: 1,
    fromId: 1,
    sessionId: 1,
  },
  {
    unique: true,
  }
);

module.exports =
  mongoose.models
    .MicroBuzzSessionIgnore ||
  mongoose.model(
    "MicroBuzzSessionIgnore",
    schema
  );