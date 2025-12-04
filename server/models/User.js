/**
 * ============================================================
 * 📁 File: models/User.js
 * 💾 Purpose: Mongoose schema for RomBuzz users
 * ============================================================
 */

const mongoose = require("mongoose");

const userSchema = new mongoose.Schema(
  {
    // ✅ Primary identity
    id: { type: String, required: true, unique: true, index: true }, // mirrors LowDB shortid
    email: { type: String, required: true, unique: true, index: true },
    firstName: { type: String, default: "" },
    lastName: { type: String, default: "" },

    // 🔐 Auth
    passwordHash: { type: String, default: "" },
    googleId: { type: String, default: "" },

        // 💫 Profile fields
    gender: { type: String, default: "" },
    dob: { type: String, default: "" },
    lookingFor: { type: String, default: "" },
    interestedIn: { type: [String], default: [] },

    // generic preferences object (Discover filters etc.)
    preferences: { type: Object, default: {} },

    // visibility controls
    visibilityMode: { type: String, default: "full" },         // full / blurred / ghost etc.
    fieldVisibility: { type: Object, default: {} },            // who can see each item
    visibility: { type: String, default: "active" },           // active / paused / hidden

    // main profile fields
    bio: { type: String, default: "" },
    orientation: { type: String, default: "" },
    interests: { type: [String], default: [] },
    hobbies: { type: [String], default: [] },
    favorites: { type: [String], default: [] },                // also stores voice: / blur: tags

    avatar: { type: String, default: "" },
    photos: { type: [String], default: [] },                   // legacy gallery
    media: { type: [Object], default: [] },                    // structured gallery items

    // location + vibes
    location: { type: Object, default: null },                 // { lat, lng }
    vibe: { type: String, default: "" },
    filterVibe: { type: Object, default: {} },

    // onboarding / matching prefs
    matchPref: { type: Object, default: {} },
    locationRadius: { type: Number, default: 50 },
    ageRange: {
      type: Object,
      default: { min: 18, max: 99 },
    },
    profileComplete: { type: Boolean, default: false },
    hasOnboarded: { type: Boolean, default: false },

    // contact
    phone: { type: String, default: "" },
    voiceUrl: { type: String, default: "" },

    // premium + settings
    premiumTier: { type: String, default: "free" },
    settings: { type: Object, default: {} },

    // 💬 Activity / status
    lastActive: { type: Date, default: Date.now },

    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now },

    // 🔒 System flags
    isPremium: { type: Boolean, default: false },
    isVerified: { type: Boolean, default: false },
    blockedUsers: { type: [String], default: [] },
  },
  {
    timestamps: true, // auto adds createdAt + updatedAt
    minimize: true,
  }

);

// ❌ Remove the redundant manual index; we already have `index: true` on `email`
// userSchema.index({ email: 1 });

module.exports =
  mongoose.models.User || mongoose.model("User", userSchema);
