/**
 * ============================================================
 * 📁 File: models/MeetMiddleSession.js
 * 💾 Purpose: Temporary MongoDB session model for RomBuzz
 *             Meet in the Middle flow.
 *
 * Used by:
 *   - services/meetMiddleService.js
 *   - routes/meetMiddle.js
 *   - sockets/meetMiddleSocket.js
 *
 * What this stores:
 *   - matched user pair
 *   - both users' latest shared coordinates
 *   - calculated midpoint
 *   - Geoapify returned places
 *   - selected/confirmed place
 *   - session status
 *   - expiration timestamp for automatic cleanup
 *
 * Why this file exists:
 *   - Keeps Meet in the Middle state out of User documents.
 *   - Avoids saving live GPS directly into permanent profile data.
 *   - Makes debugging meetup sessions easier.
 * ============================================================
 */

const mongoose = require("mongoose");

const coordSchema = new mongoose.Schema(
  {
    lat: { type: Number, required: true },
    lng: { type: Number, required: true },
    sharedAt: { type: Date, default: Date.now },
  },
  { _id: false }
);

const placeSchema = new mongoose.Schema(
  {
    id: { type: String, default: "" },
    name: { type: String, default: "" },
    category: { type: String, default: "" },
    address: { type: String, default: null },
    coords: {
      lat: { type: Number, required: true },
      lng: { type: Number, required: true },
    },
    rating: { type: Number, default: null },
    image: { type: String, default: null },
    distance: { type: Number, default: null },
    provider: { type: String, default: "geoapify" },
  },
  { _id: false }
);

const meetMiddleSessionSchema = new mongoose.Schema(
  {
    sessionId: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },

    pairKey: {
      type: String,
      required: true,
      index: true,
    },

    users: {
      type: [String],
      required: true,
      validate: {
        validator(value) {
          return Array.isArray(value) && value.length === 2;
        },
        message: "MeetMiddleSession users must contain exactly 2 user ids.",
      },
    },

    requestedBy: {
      type: String,
      required: true,
      index: true,
    },

    peerId: {
      type: String,
      required: true,
      index: true,
    },

    status: {
      type: String,
      enum: [
        "requested",
        "accepted",
        "declined",
        "locating",
        "suggested",
        "place_pending",
        "place_rejected",
        "confirmed",
        "cancelled",
        "completed",
        "expired",
      ],
      default: "requested",
      index: true,
    },

    coordsByUser: {
      type: Map,
      of: coordSchema,
      default: {},
    },

    midpoint: {
      lat: { type: Number, default: null },
      lng: { type: Number, default: null },
    },

    smartMidpoint: {
      lat: { type: Number, default: null },
      lng: { type: Number, default: null },
    },

    radiusUsedMeters: {
      type: Number,
      default: null,
    },

    places: {
      type: [placeSchema],
      default: [],
    },

    selectedPlace: {
      type: placeSchema,
      default: null,
    },

    selectedBy: {
      type: String,
      default: null,
    },

    selectedAt: {
      type: Date,
      default: null,
    },

    confirmedBy: {
      type: String,
      default: null,
    },

    confirmedAt: {
      type: Date,
      default: null,
    },

    cancelledBy: {
      type: String,
      default: null,
    },

    cancelledAt: {
      type: Date,
      default: null,
    },

    completedBy: {
      type: String,
      default: null,
    },

    completedAt: {
      type: Date,
      default: null,
    },

    declineReason: {
      type: String,
      default: "",
    },

    lastActivityAt: {
      type: Date,
      default: Date.now,
      index: true,
    },

    expiresAt: {
      type: Date,
      required: true,
      index: true,
    },
  },
  { timestamps: true }
);

// Fast lookup for active pair sessions.
meetMiddleSessionSchema.index({ pairKey: 1, status: 1, lastActivityAt: -1 });

// Auto-delete expired sessions from MongoDB.
// MongoDB TTL monitor runs roughly once per minute, so deletion is not instant.
meetMiddleSessionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

meetMiddleSessionSchema.pre("validate", function normalizeUsers(next) {
  if (Array.isArray(this.users)) {
    this.users = this.users.map((id) => String(id)).filter(Boolean);
  }

  if (this.requestedBy) this.requestedBy = String(this.requestedBy);
  if (this.peerId) this.peerId = String(this.peerId);

  if (!this.pairKey && this.users.length === 2) {
    this.pairKey = [...this.users].sort().join("_");
  }

  next();
});

module.exports =
  mongoose.models.MeetMiddleSession ||
  mongoose.model("MeetMiddleSession", meetMiddleSessionSchema);