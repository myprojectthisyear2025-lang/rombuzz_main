/**
 * ============================================================
 * ðŸ“ File: routes/profile.js
 * ðŸ§© Purpose: Handles profile completion, onboarding, and full profile retrieval.
 *
 * Endpoints:
 *   GET  /api/profile/full              â†’ Get full profile (with media & posts)
 *   POST /api/profile/complete          â†’ Complete profile for logged-in user
 *   PUT  /api/users/complete-profile    â†’ Complete profile for Google users
 *
 * Features:
 *   - Updates avatar, hobbies, match preferences, and photos
 *   - Auto-creates posts for uploaded photos
 *   - Sends notifications to matched users
 *   - Marks user as `profileComplete` and `hasOnboarded`
 *   - Returns full sanitized profile with media and posts
 *
 * Dependencies:
 *   - models/User.js              â†’ Core user document
 *   - models/PostModel.js         â†’ LetsBuzz posts
 *   - models/Notification.js      â†’ In-app notifications
 *   - models/Match.js        â†’ Match relationships
 *   - auth-middleware.js          â†’ JWT protection
 *   - utils/helpers.js            â†’ baseSanitizeUser()
 *   - sockets/connection.js       â†’ Socket.IO (io) for real-time notifications
 * ============================================================
 */

const express = require("express");
const router = express.Router();
const shortid = require("shortid");
const { io } = require("../sockets/connection"); // optional socket export
const { baseSanitizeUser } = require("../utils/helpers");
const authMiddleware = require("./auth-middleware");

// âœ… Mongo models only (no LowDB)
const User = require("../models/User");
const PostModel = require("../models/PostModel");
const Notification = require("../models/Notification");
const Match = require("../models/Match");
const { sendNotification } = require("../utils/helpers");
const PrivateNote = require("../models/PrivateNote");
const {
  deleteStoredR2ObjectBestEffort,
  getSignedMediaUrl,
  getStoredMediaR2Key,
  isR2Key,
} = require("../utils/r2Media");

function normalizeMediaString(value = "") {
  return String(value || "").trim();
}

async function signR2Value(value, expiresInSeconds = 3600) {
  const raw = normalizeMediaString(value);
  if (!raw) return "";
  if (!isR2Key(raw)) return raw;

  return getSignedMediaUrl(raw, expiresInSeconds);
}

async function signR2MediaItem(item = {}, expiresInSeconds = 3600) {
  if (!item) return item;

  if (typeof item === "string") {
    return signR2Value(item, expiresInSeconds);
  }

  const rawUrl = normalizeMediaString(
    item.url ||
      item.mediaUrl ||
      item.fileUrl ||
      item.secure_url ||
      item.src ||
      item.imageUrl ||
      item.videoUrl ||
      ""
  );

  const rawKey = normalizeMediaString(item.r2Key || item.key || "");
  const key = rawKey || (isR2Key(rawUrl) ? rawUrl : "");

  const signedUrl = key
    ? await getSignedMediaUrl(key, expiresInSeconds)
    : rawUrl;

  return {
    ...item,
    url: signedUrl,
    mediaUrl: signedUrl,
    fileUrl: signedUrl,
    r2Key: key || item.r2Key || "",
  };
}

async function signR2UserMedia(user = {}) {
  const next = { ...(user || {}) };

  next.avatar = await signR2Value(next.avatar, 21600);
  next.voiceUrl = await signR2Value(next.voiceUrl, 3600);

  if (Array.isArray(next.media)) {
    next.media = await Promise.all(
      next.media.map((item) => signR2MediaItem(item, 7200))
    );
  }

  if (Array.isArray(next.photos)) {
    next.photos = await Promise.all(
      next.photos.map((item) => signR2MediaItem(item, 7200))
    );
  }

  return next;
}

async function signR2PostMedia(post = {}) {
  const next = { ...(post || {}) };

  if (next.mediaUrl) {
    next.mediaUrl = await signR2Value(next.mediaUrl, 7200);
  }

  return next;
}

function isUserMediaKeyStillReferenced(user = {}, key = "") {
  const cleanKey = normalizeMediaString(key);
  if (!cleanKey) return false;

  if (normalizeMediaString(user.avatar) === cleanKey) return true;

  if (Array.isArray(user.photos)) {
    if (user.photos.some((photo) => normalizeMediaString(photo) === cleanKey)) {
      return true;
    }
  }

  return (user.media || []).some((item) => {
    return getStoredMediaR2Key(item) === cleanKey;
  });
}

/* ============================================================
   ðŸ‘¤ SECTION 1: FULL PROFILE (with media & posts)
============================================================ */

/**
 * GET /api/profile/full
 * Returns the full profile of the authenticated user including media, posts, and recent notifications.
 */
router.get("/profile/full", authMiddleware, async (req, res) => {
  try {
    // 1ï¸âƒ£ Fetch user from MongoDB
    const user = await User.findOne({ id: req.user.id }).lean();
    if (!user) return res.status(404).json({ error: "User not found" });

    // 2ï¸âƒ£ Fetch this user's posts (LetsBuzz)
    const posts = await PostModel.find({ userId: user.id })
      .sort({ createdAt: -1 })
      .lean();

    // 3ï¸âƒ£ Fetch latest notifications (optional enrichment)
    const notifications = await Notification.find({ toId: user.id })
      .sort({ createdAt: -1 })
      .limit(20)
      .lean();

       // 4ï¸âƒ£ Build response payload
    const sanitized = baseSanitizeUser(user);
    const signedUser = await signR2UserMedia(user);
    const signedPosts = await Promise.all(
      posts.map((post) => signR2PostMedia(post))
    );

    res.json({
      user: {
        ...sanitized,
        ...signedUser,

        // âœ… FORCE INCLUDE: editable profile fields (so mobile can persist after refresh/restart)
        firstName: signedUser.firstName ?? sanitized.firstName ?? "",
        lastName: signedUser.lastName ?? sanitized.lastName ?? "",
        bio: signedUser.bio ?? sanitized.bio ?? "",
        gender: signedUser.gender ?? sanitized.gender ?? "",
        dob: signedUser.dob ?? sanitized.dob ?? "",
        city: signedUser.city ?? sanitized.city ?? "",
        height: signedUser.height ?? sanitized.height ?? "",
        orientation: signedUser.orientation ?? sanitized.orientation ?? "",
        lookingFor: signedUser.lookingFor ?? sanitized.lookingFor ?? "",
        likes: signedUser.likes ?? sanitized.likes ?? [],
        dislikes: signedUser.dislikes ?? sanitized.dislikes ?? [],
        interests: signedUser.interests ?? sanitized.interests ?? [],
        hobbies: signedUser.hobbies ?? sanitized.hobbies ?? [],
        favorites: Array.isArray(signedUser.favorites) ? signedUser.favorites : [],
        voiceUrl: signedUser.voiceUrl ?? "",
        voiceDurationSec: Number(signedUser.voiceDurationSec || 0),

        // ✅ keep your media logic (web/mobile compatibility)
        media:
          Array.isArray(signedUser.media) && signedUser.media.length > 0
            ? signedUser.media
            : signedUser.photos || [],

        posts: signedPosts,
        notifications,
      },
    });


  } catch (err) {
    console.error("âŒ /profile/full (Mongo) error:", err);
    res.status(500).json({ error: "Failed to fetch full profile" });
  }
});

/* ============================================================
   ðŸŒŸ SECTION 2: COMPLETE PROFILE ROUTE (onboarding)
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

    // 1ï¸âƒ£ Update user document in MongoDB
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

    // 2ï¸âƒ£ Auto-create posts for uploaded photos (LetsBuzz)
    //    Each photo becomes a public photo post announcing the user joined.
    for (const photoUrl of photos) {
      await PostModel.create({
        id: shortid.generate(),
        userId: user.id,
        type: "photo",
        mediaUrl: photoUrl,
        text: `${user.firstName || "Someone"} just joined RomBuzz âœ¨ Let's Buzz!`,
        privacy: "public",
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
    }

    // 3ï¸âƒ£ Notify matched users about new photos / completed profile
    //    Find matches where this user is user1 or user2 and status is "matched".
    const matches = await Match.find({
      status: "matched",
      $or: [{ user1: user.id }, { user2: user.id }],
    }).lean();

    const matchedUsers = matches.map((m) =>
      m.user1 === user.id ? m.user2 : m.user1
    );

    for (const matchId of matchedUsers) {
      await sendNotification(matchId, {
        fromId: user.id,
        type: "new_post",
        message: `${user.firstName || "Someone"} just shared new photos!`,
        href: "/letsbuzz",
        postOwnerId: user.id,
      });
    }

    // 4ï¸âƒ£ Return sanitized updated user
    res.json(baseSanitizeUser(user));
  } catch (err) {
    console.error("âŒ /profile/complete error:", err);
    res.status(500).json({ error: "Failed to complete profile" });
  }
});

/* ============================================================
   ðŸ§© SECTION 3: COMPLETE PROFILE FOR GOOGLE USERS
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
    console.error("âŒ PUT /users/complete-profile error:", err);
    res.status(500).json({ error: "Failed to complete profile" });
  }
});

/* ============================================================
   🎙️ SECTION 4: VOICE INTRO DELETE
============================================================ */

/**
 * DELETE /api/profile/voice-intro
 * Deletes the authenticated user's voice intro from MongoDB and R2.
 */
router.delete("/profile/voice-intro", authMiddleware, async (req, res) => {
  try {
    const user = await User.findOne({ id: req.user.id });
    if (!user) return res.status(404).json({ error: "User not found" });

    const voiceKey = normalizeMediaString(user.voiceUrl || "");
    const storageCandidate = {
      r2Key: isR2Key(voiceKey) ? voiceKey : "",
      url: voiceKey,
      mediaUrl: voiceKey,
      fileUrl: voiceKey,
    };

    const r2Key = getStoredMediaR2Key(storageCandidate);
    const stillReferenced = r2Key
      ? isUserMediaKeyStillReferenced(user, r2Key)
      : false;

    user.voiceUrl = "";
    user.voiceDurationSec = 0;
    user.markModified("voiceUrl");
    user.markModified("voiceDurationSec");
    await user.save();

    const storageDelete = r2Key && !stillReferenced
      ? await deleteStoredR2ObjectBestEffort(
          storageCandidate,
          `voice-intro:${req.user.id}`
        )
      : {
          deleted: false,
          provider: r2Key ? "r2" : "",
          key: r2Key || "",
          reason: stillReferenced ? "still_referenced" : "no_r2_key",
        };

    return res.json({
      success: true,
      voiceUrl: "",
      voiceDurationSec: 0,
      deletedFromR2: !!storageDelete.deleted,
      storageDelete,
    });
  } catch (err) {
    console.error("❌ DELETE /profile/voice-intro error:", err);
    res.status(500).json({ error: "Failed to delete voice intro" });
  }
});

/* ============================================================
   🎙️ SECTION 5: PRIVATE NOTES (Diary-style, user-only)
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
    console.error("âŒ GET /profile/notes error:", err);
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
    console.error("âŒ POST /profile/notes error:", err);
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
    console.error("âŒ PUT /profile/notes error:", err);
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
    console.error("âŒ DELETE /profile/notes error:", err);
    res.status(500).json({ error: "Failed to delete note" });
  }
});


console.log("âœ… Profile routes initialized (full + complete + google)");

module.exports = router;


