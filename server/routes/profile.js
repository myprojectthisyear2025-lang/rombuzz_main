/**
 * ============================================================
 * 📁 File: routes/profile.js
 * 🧩 Purpose: Handles profile completion, onboarding, and full profile retrieval.
 *
 * Endpoints:
 *   GET  /api/profile/full              → Get full profile (with media & posts)
 *   POST /api/profile/complete          → Complete profile for logged-in user
 *   PUT  /api/users/complete-profile    → Complete profile for Google users
 *
 * Features:
 *   - Updates avatar, hobbies, match preferences, and photos
 *   - Auto-creates posts for uploaded photos
 *   - Sends notifications to matched users
 *   - Marks user as `profileComplete` and `hasOnboarded`
 *   - Returns full sanitized profile with media and posts
 *
 * Dependencies:
 *   - models/User.js              → Core user document
 *   - models/PostModel.js         → LetsBuzz posts
 *   - models/Notification.js      → In-app notifications
 *   - models/Match.js        → Match relationships
 *   - auth-middleware.js          → JWT protection
 *   - utils/helpers.js            → baseSanitizeUser()
 *   - sockets/connection.js       → Socket.IO (io) for real-time notifications
 * ============================================================
 */

const express = require("express");
const router = express.Router();
const shortid = require("shortid");
const { io } = require("../sockets/connection"); // optional socket export
const { baseSanitizeUser } = require("../utils/helpers");
const authMiddleware = require("./auth-middleware");

// ✅ Mongo models only (no LowDB)
const User = require("../models/User");
const PostModel = require("../models/PostModel");
const Notification = require("../models/Notification");
const Match = require("../models/Match");
const PrivateNote = require("../models/PrivateNote");

/* ============================================================
   👤 SECTION 1: FULL PROFILE (with media & posts)
============================================================ */

/**
 * GET /api/profile/full
 * Returns the full profile of the authenticated user including media, posts, and recent notifications.
 */
router.get("/profile/full", authMiddleware, async (req, res) => {
  try {
    // 1️⃣ Fetch user from MongoDB
    const user = await User.findOne({ id: req.user.id }).lean();
    if (!user) return res.status(404).json({ error: "User not found" });

    // 2️⃣ Fetch this user's posts (LetsBuzz)
    const posts = await PostModel.find({ userId: user.id })
      .sort({ createdAt: -1 })
      .lean();

    // 3️⃣ Fetch latest notifications (optional enrichment)
    const notifications = await Notification.find({ toId: user.id })
      .sort({ createdAt: -1 })
      .limit(20)
      .lean();

     // 4️⃣ Build response payload
    const sanitized = baseSanitizeUser(user);

    res.json({
      user: {
        ...sanitized,

        // ✅ FORCE INCLUDE: editable profile fields (so mobile can persist after refresh/restart)
        firstName: user.firstName ?? sanitized.firstName ?? "",
        lastName: user.lastName ?? sanitized.lastName ?? "",
        bio: user.bio ?? sanitized.bio ?? "",
        gender: user.gender ?? sanitized.gender ?? "",
        dob: user.dob ?? sanitized.dob ?? "",
        city: user.city ?? sanitized.city ?? "",
        height: user.height ?? sanitized.height ?? "",
        orientation: user.orientation ?? sanitized.orientation ?? "",
        lookingFor: user.lookingFor ?? sanitized.lookingFor ?? "",
        likes: user.likes ?? sanitized.likes ?? [],
        dislikes: user.dislikes ?? sanitized.dislikes ?? [],
        interests: user.interests ?? sanitized.interests ?? [],
        hobbies: user.hobbies ?? sanitized.hobbies ?? [],

        // ✅ keep your media logic (web/mobile compatibility)
        media:
          Array.isArray(user.media) && user.media.length > 0
            ? user.media
            : user.photos || [],

        posts,
        notifications,
      },
    });


  } catch (err) {
    console.error("❌ /profile/full (Mongo) error:", err);
    res.status(500).json({ error: "Failed to fetch full profile" });
  }
});

/* ============================================================
   🌟 SECTION 2: COMPLETE PROFILE ROUTE (onboarding)
============================================================ */

/**
 * POST /api/profile/complete
 * Completes profile setup for a logged-in user.
 * Used during onboarding after signup (email / Google).
 *
 * Body can include:
 *   - avatar: string (URL)
 *   - photos: string[] (photo URLs)
 *   - hobbies: string[]
 *   - matchPref: any match preference object
 *   - locationRadius: number
 *   - ageRange: { min, max }
 */
router.post("/profile/complete", authMiddleware, async (req, res) => {
  try {
    const userId = req.user.id;
    const {
      avatar,
      photos = [],
      hobbies,
      matchPref,
      locationRadius,
      ageRange,
    } = req.body || {};

    // 1️⃣ Update user document in MongoDB
    const user = await User.findOneAndUpdate(
      { id: userId },
      {
        $set: {
          avatar,
          photos,
          hobbies,
          matchPref,
          locationRadius,
          ageRange,
          profileComplete: true,
          hasOnboarded: true,
          updatedAt: Date.now(),
        },
      },
      { new: true }
    ).lean();

    if (!user) return res.status(404).json({ error: "User not found" });

    // 2️⃣ Auto-create posts for uploaded photos (LetsBuzz)
    //    Each photo becomes a public photo post announcing the user joined.
    for (const photoUrl of photos) {
      await PostModel.create({
        id: shortid.generate(),
        userId: user.id,
        type: "photo",
        mediaUrl: photoUrl,
        text: `${user.firstName || "Someone"} just joined RomBuzz ✨ Let's Buzz!`,
        privacy: "public",
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
    }

    // 3️⃣ Notify matched users about new photos / completed profile
    //    Find matches where this user is user1 or user2 and status is "matched".
    const matches = await Match.find({
      status: "matched",
      $or: [{ user1: user.id }, { user2: user.id }],
    }).lean();

    const matchedUsers = matches.map((m) =>
      m.user1 === user.id ? m.user2 : m.user1
    );

    for (const matchId of matchedUsers) {
      const notif = {
        id: shortid.generate(),
        toId: matchId,
        fromId: user.id,
        type: "new_post",
        message: `${user.firstName || "Someone"} just shared new photos! 💫`,
        href: "/letsbuzz",
        postOwnerId: user.id,
        createdAt: Date.now(),
        read: false,
      };

      await Notification.create(notif);

      // 🔔 Real-time push if receiver is online
      if (io) {
        io.to(String(matchId)).emit("notification:new_post", notif);
      }
    }

    // 4️⃣ Return sanitized updated user
    res.json(baseSanitizeUser(user));
  } catch (err) {
    console.error("❌ /profile/complete error:", err);
    res.status(500).json({ error: "Failed to complete profile" });
  }
});

/* ============================================================
   🧩 SECTION 3: COMPLETE PROFILE FOR GOOGLE USERS
============================================================ */

/**
 * PUT /api/users/complete-profile
 * Completes profile for Google-authenticated users.
 *
 * Merges arbitrary fields from body with standard completion flags.
 */
router.put("/users/complete-profile", authMiddleware, async (req, res) => {
  try {
    const updates = {
      ...req.body,
      profileComplete: true,
      hasOnboarded: true,
      updatedAt: Date.now(),
    };

    const user = await User.findOneAndUpdate(
      { id: req.user.id },
      { $set: updates },
      { new: true }
    ).lean();

    if (!user) return res.status(404).json({ error: "User not found" });

    res.json({ success: true, user: baseSanitizeUser(user) });
  } catch (err) {
    console.error("❌ PUT /users/complete-profile error:", err);
    res.status(500).json({ error: "Failed to complete profile" });
  }
});
/* ============================================================
   📝 SECTION 4: PRIVATE NOTES (Diary-style, user-only)
============================================================ */

/**
 * GET /api/profile/notes
 * Returns all private notes for the authenticated user.
 */
router.get("/profile/notes", authMiddleware, async (req, res) => {
  try {
    const notes = await PrivateNote.find({ userId: req.user.id })
      .sort({ createdAt: -1 })
      .lean();

    res.json({ notes });
  } catch (err) {
    console.error("❌ GET /profile/notes error:", err);
    res.status(500).json({ error: "Failed to fetch private notes" });
  }
});

/**
 * POST /api/profile/notes
 * Creates a new private note.
 */
router.post("/profile/notes", authMiddleware, async (req, res) => {
  try {
    const { text } = req.body || {};
    if (!text || !text.trim()) {
      return res.status(400).json({ error: "Note text is required" });
    }

    const note = await PrivateNote.create({
      userId: req.user.id,
      text,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });

    res.json({ note });
  } catch (err) {
    console.error("❌ POST /profile/notes error:", err);
    res.status(500).json({ error: "Failed to create note" });
  }
});

/**
 * PUT /api/profile/notes/:id
 * Updates an existing private note (owner only).
 */
router.put("/profile/notes/:id", authMiddleware, async (req, res) => {
  try {
    const { text } = req.body || {};
    if (!text || !text.trim()) {
      return res.status(400).json({ error: "Note text is required" });
    }

    const note = await PrivateNote.findOneAndUpdate(
      { _id: req.params.id, userId: req.user.id },
      { $set: { text, updatedAt: Date.now() } },
      { new: true }
    ).lean();

    if (!note) {
      return res.status(404).json({ error: "Note not found" });
    }

    res.json({ note });
  } catch (err) {
    console.error("❌ PUT /profile/notes error:", err);
    res.status(500).json({ error: "Failed to update note" });
  }
});

/**
 * DELETE /api/profile/notes/:id
 * Deletes a private note (owner only).
 */
router.delete("/profile/notes/:id", authMiddleware, async (req, res) => {
  try {
    const result = await PrivateNote.deleteOne({
      _id: req.params.id,
      userId: req.user.id,
    });

    if (!result.deletedCount) {
      return res.status(404).json({ error: "Note not found" });
    }

    res.json({ success: true });
  } catch (err) {
    console.error("❌ DELETE /profile/notes error:", err);
    res.status(500).json({ error: "Failed to delete note" });
  }
});


console.log("✅ Profile routes initialized (full + complete + google)");

module.exports = router;
