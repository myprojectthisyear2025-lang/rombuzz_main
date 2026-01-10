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
    id: { type: String, required: true, unique: true, index: true },
    email: { type: String, required: true, unique: true, index: true },
    firstName: { type: String, default: "" },
    lastName: { type: String, default: "" },

    // 🔐 Auth
    passwordHash: { type: String, default: "" },
    googleId: { type: String, default: "" },

    /* ============================================================
       🧑 IDENTITY
    ============================================================ */
    gender: { type: String, default: "" },
    genderVisibility: { type: String, default: "public" }, // public | hidden

    pronouns: { type: String, default: "" },

    orientation: { type: String, default: "" },
    orientationVisibility: { type: String, default: "public" },

    dob: { type: String, default: "" }, // DOB (locked after verification)

    /* ============================================================
       📍 LOCATION & DISTANCE
    ============================================================ */
    city: { type: String, default: "" },
    country: { type: String, default: "" },
    hometown: { type: String, default: "" },

    latitude: { type: Number, default: null },
    longitude: { type: Number, default: null },

    location: { type: Object, default: null }, // { lat, lng }
    distanceVisibility: { type: String, default: "public" },
    travelMode: { type: Boolean, default: false },

    /* ============================================================
       💬 ABOUT ME
    ============================================================ */
    bio: { type: String, default: "" },
    voiceUrl: { type: String, default: "" },

    vibeTags: { type: [String], default: [] }, // Chill, Romantic, etc.

    /* ============================================================
       💖 DATING INTENTIONS
    ============================================================ */
    lookingFor: { type: String, default: "" },
    relationshipStyle: { type: String, default: "" },
    interestedIn: { type: [String], default: [] }, // Men / Women / Everyone

    /* ============================================================
       📏 BODY & BASICS
    ============================================================ */
    height: { type: String, default: "" },
    bodyType: { type: String, default: "" },
    fitnessLevel: { type: String, default: "" },

    /* ============================================================
       🧠 LIFESTYLE & HABITS
    ============================================================ */
    smoking: { type: String, default: "" },
    drinking: { type: String, default: "" },
    workoutFrequency: { type: String, default: "" },
    diet: { type: String, default: "" },
    sleepSchedule: { type: String, default: "" },

    /* ============================================================
       🎓 BACKGROUND
    ============================================================ */
    educationLevel: { type: String, default: "" },
    school: { type: String, default: "" },
    jobTitle: { type: String, default: "" },
    company: { type: String, default: "" },
    languages: { type: [String], default: [] },

    /* ============================================================
       🧬 BELIEFS & VALUES
    ============================================================ */
    religion: { type: String, default: "" },
    politicalViews: { type: String, default: "" },
    zodiac: { type: String, default: "" },

    /* ============================================================
       🎯 INTERESTS & PREFERENCES
    ============================================================ */
    interests: { type: [String], default: [] },
    hobbies: { type: [String], default: [] },
    favoriteMusic: { type: [String], default: [] },
    favoriteMovies: { type: [String], default: [] },
    travelStyle: { type: String, default: "" },
    petsPreference: { type: String, default: "" },

    likes: { type: String, default: "" },
    dislikes: { type: String, default: "" },
    favorites: { type: [String], default: [] },

    /* ============================================================
       🖼️ MEDIA
    ============================================================ */
    avatar: { type: String, default: "" },
    photos: { type: [String], default: [] },
    media: { type: [Object], default: [] },

    /* ============================================================
       🔐 VISIBILITY & SETTINGS
    ============================================================ */
    visibilityMode: { type: String, default: "full" },
    fieldVisibility: { type: Object, default: {} },
    visibility: { type: String, default: "active" },
    preferences: { type: Object, default: {} },
    settings: { type: Object, default: {} },

    /* ============================================================
       🔁 MATCHING / ONBOARDING
    ============================================================ */
    matchPref: { type: Object, default: {} },
    locationRadius: { type: Number, default: 50 },
    ageRange: { type: Object, default: { min: 18, max: 99 } },
    profileComplete: { type: Boolean, default: false },
    hasOnboarded: { type: Boolean, default: false },

    /* ============================================================
       📊 ACTIVITY
    ============================================================ */
    lastActive: { type: Date, default: Date.now },
    profileViews: {
      total: { type: Number, default: 0 },
      today: { type: Number, default: 0 },
      lastViewDate: { type: String, default: "" },
    },

    /* ============================================================
       🔒 SYSTEM
    ============================================================ */
    premiumTier: { type: String, default: "free" },
    isPremium: { type: Boolean, default: false },
    isVerified: { type: Boolean, default: false },
    blockedUsers: { type: [String], default: [] },

    verificationCode: { type: String, default: "" },
    codeExpiresAt: { type: Date, default: null },
  },
  {
    timestamps: true,
    minimize: true,
  }
);

module.exports =
  mongoose.models.User || mongoose.model("User", userSchema);
