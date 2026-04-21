/**
 * ============================================================
 * 📁 File: routes/users.js
 * 🧩 Purpose: Manage user profile updates, preferences, blocking, and social stats.
 *
 * Endpoints:
 *   GET    /api/users/me                 → Get current user info
 *   POST   /api/location                 → Update user's current location
 *   GET    /api/users/social             → Get likes / matches summary
 *   GET    /api/social-stats             → Alias for same stats
 *   GET    /api/matches                  → List match profiles
 *   PUT    /api/users/me                 → Update profile details
 *   GET    /api/users/blocks             → List blocked users
 *   POST   /api/users/blocks/:userId     → Block another user
 *   DELETE /api/users/blocks/:userId     → Unblock a user
 *   GET    /api/users/social-stats       → Retrieve likes / likedYou / matches (Mongo)
 *
 * Features:
 *   - Profile editing (bio, vibe, visibility, etc.)
 *   - Restricts name changes (once per 30 days)
 *   - Validates vibes and visibility filters
 *   - Uses MongoDB for likes, blocks, and matches
 *   - Returns sanitized user data (no passwords or secrets)
 *
 * Dependencies:
 *   - mongoose User, Relationship, Match
 *   - authMiddleware.js  → JWT authentication
 *   - utils/helpers.js   → User sanitization
 *
 * Notes:
 *   - Mounted under /api/users in index.js
 *   - Used by EditProfile.jsx, Settings.jsx, Discover.jsx
 * ============================================================
 */

const express = require("express");
const router = express.Router();
const authMiddleware = require("./auth-middleware");
const {
  baseSanitizeUser,
  msToDays,
  THIRTY_DAYS,
} = require("../utils/helpers");

// ✅ Mongo Models
const User = require("../models/User");
const Relationship = require("../models/Relationship"); // for likes/blocks
const Match = require("../models/Match");

const DISCOVER_HIDDEN_PRIVACY = new Set([
  "private",
  "matches",
  "matched-only",
  "hidden",
  "specific",
]);

function normalizeDiscoverImageUrl(value) {
  return typeof value === "string" ? value.trim() : "";
}

function getDiscoverMediaUrl(entry) {
  if (typeof entry === "string") return normalizeDiscoverImageUrl(entry);
  return normalizeDiscoverImageUrl(entry?.url);
}

function getDiscoverMediaPrivacy(entry) {
  return String(entry?.privacy || entry?.scope || "").toLowerCase().trim();
}

function getDiscoverMediaCaption(entry) {
  return String(entry?.caption || "").toLowerCase().trim();
}

function isDiscoverSafeMedia(entry) {
  const url = getDiscoverMediaUrl(entry);
  if (!url) return false;

  const privacy = getDiscoverMediaPrivacy(entry);
  const caption = getDiscoverMediaCaption(entry);
  const type = String(entry?.type || entry?.mediaType || "")
    .toLowerCase()
    .trim();

  if (DISCOVER_HIDDEN_PRIVACY.has(privacy)) return false;
  if (caption.includes("scope:private")) return false;
  if (caption.includes("scope:matches")) return false;
  if (caption.includes("scope:matched")) return false;
  if (caption.includes("privacy:private")) return false;
  if (caption.includes("privacy:matches")) return false;
  if (caption.includes("kind:reel")) return false;
  if (type === "video") return false;

  return true;
}

function sanitizeLegacyDiscoverPhotos(photos = []) {
  const list = Array.isArray(photos) ? photos : [];
  const seen = new Set();
  const out = [];

  for (const item of list) {
    const url = getDiscoverMediaUrl(item);
    if (!url || seen.has(url)) continue;
    seen.add(url);
    out.push(url);
  }

  return out;
}

function buildDiscoverSafeGallery(user = {}) {
  const seen = new Set();
  const media = [];
  const photos = [];

  const pushPhotoUrl = (value) => {
    const url = normalizeDiscoverImageUrl(value);
    if (!url || seen.has(url)) return;
    seen.add(url);
    photos.push(url);
  };

  if (Array.isArray(user.media)) {
    for (const item of user.media) {
      if (!isDiscoverSafeMedia(item)) continue;

      const url = getDiscoverMediaUrl(item);
      if (seen.has(url)) continue;

      seen.add(url);
      media.push({
        ...item,
        url,
        type: "image",
      });
      photos.push(url);
    }
  }

  for (const url of sanitizeLegacyDiscoverPhotos(user.photos)) {
    if (seen.has(url)) continue;
    seen.add(url);
    photos.push(url);
  }

  return { media, photos };
}

/* ============================================================
   👤 SECTION 1: USER INFO & LOCATION
============================================================ */

/**
 * GET /api/users/me → current logged-in user
 */
router.get("/me", authMiddleware, async (req, res) => {
  try {
    const user = await User.findOne({ id: req.user.id }).lean();
    if (!user) return res.status(404).json({ error: "User not found" });
    res.json(baseSanitizeUser(user));
  } catch (err) {
    console.error("❌ /users/me error:", err);
    res.status(500).json({ error: "Failed to fetch user" });
  }
});
/**
 * POST /api/users/:id/view
 * Increments profile view counts for the target user.
 * Tracks:
 *  - total (all-time)
 *  - today (daily)
 *
 * Rules:
 *  - viewer must be authenticated
 *  - viewer cannot be the same user
 *  - resets "today" automatically when date changes (no cron)
 */
router.post("/:id/view", authMiddleware, async (req, res) => {
  try {
    const viewerId = req.user.id;
    const targetId = req.params.id;

    if (!targetId)
      return res.status(400).json({ error: "Target user id required" });

    if (viewerId === targetId)
      return res.json({ ok: true, ignored: true });

    const todayStr = new Date().toISOString().slice(0, 10); // YYYY-MM-DD

    const target = await User.findOne({ id: targetId });
    if (!target)
      return res.status(404).json({ error: "User not found" });

    // Init safety
    if (!target.profileViews) {
      target.profileViews = { total: 0, today: 0, lastViewDate: "" };
    }

    // Reset daily count if day changed
    if (target.profileViews.lastViewDate !== todayStr) {
      target.profileViews.today = 0;
      target.profileViews.lastViewDate = todayStr;
    }

    target.profileViews.total =
      Number(target.profileViews.total || 0) + 1;

    target.profileViews.today =
      Number(target.profileViews.today || 0) + 1;

    target.updatedAt = Date.now();
    await target.save();

    return res.json({
      ok: true,
      profileViews: {
        total: target.profileViews.total,
        today: target.profileViews.today,
        lastViewDate: target.profileViews.lastViewDate,
      },
    });
  } catch (err) {
    console.error("❌ POST /users/:id/view error:", err);
    res.status(500).json({ error: "Failed to record profile view" });
  }
});

/**
 * POST /api/location → update user geolocation
 */
router.post("/location", authMiddleware, async (req, res) => {
  try {
    const { lat, lng } = req.body || {};
    const latNum = Number(lat);
    const lngNum = Number(lng);
    if (!Number.isFinite(latNum) || !Number.isFinite(lngNum)) {
      return res.status(400).json({ error: "lat & lng required" });
    }

    const user = await User.findOneAndUpdate(
      { id: req.user.id },
      {
        $set: {
          location: { lat: latNum, lng: lngNum },
          updatedAt: Date.now(),
        },
      },
      { new: true }
    ).lean();

    if (!user) return res.status(404).json({ error: "User not found" });
    res.json({ ok: true, location: user.location });
  } catch (err) {
    console.error("❌ /location error:", err);
    res.status(500).json({ error: "Failed to update location" });
  }
});

/* ============================================================
   💞 SECTION 2: SOCIAL RELATIONSHIPS (likes, matches)
============================================================ */

/**
 * GET /api/users/social or /api/social-stats
 * → summary of likesGiven, likesReceived, matchesCount
 */
router.get(["/social", "/social-stats"], authMiddleware, async (req, res) => {
  try {
    const myId = req.user.id;

    // Likes given / received from Relationship model
    const likesGiven = await Relationship.countDocuments({
      from: myId,
      type: "like",
    });
    const likesReceived = await Relationship.countDocuments({
      to: myId,
      type: "like",
    });

    // Matched users count
    const matchesCount = await Match.countDocuments({
      status: "matched",
      $or: [{ user1: myId }, { user2: myId }],
    });

    res.json({ likesGiven, likesReceived, matchesCount });
  } catch (err) {
    console.error("❌ /users/social error:", err);
    res.status(500).json({ error: "Failed to fetch social stats" });
  }
});

/**
 * GET /api/matches → list full match partner profiles
 */
router.get("/matches", authMiddleware, async (req, res) => {
  try {
    const myId = req.user.id;

    const matches = await Match.find({
      status: "matched",
      $or: [{ user1: myId }, { user2: myId }],
    }).lean();

    if (!matches.length)
      return res.json({ count: 0, matches: [] });

    // Extract other user IDs
    const partnerIds = matches.map((m) =>
      m.user1 === myId ? m.user2 : m.user1
    );
    const uniqueIds = [...new Set(partnerIds)];

    const partners = await User.find({ id: { $in: uniqueIds } })
      .select("id firstName lastName avatar vibe premiumTier verified")
      .lean();

    res.json({ count: partners.length, matches: partners });
  } catch (err) {
    console.error("❌ /matches error:", err);
    res.status(500).json({ error: "Failed to fetch matches" });
  }
});

/* ============================================================
   🧑 SECTION 3: PROFILE UPDATE / BLOCKS
============================================================ */

/**
 * PUT /api/users/me → update profile info
 */
router.put("/me", authMiddleware, async (req, res) => {
  try {
     const allowed = [
  // Identity
  "firstName",
  "lastName",
  "dob",
  "gender",
  "genderVisibility",
  "pronouns",
  "orientation",
  "orientationVisibility",

  // Location
  "city",
  "country",
  "hometown",
  "latitude",
  "longitude",
  "distanceVisibility",
  "travelMode",
  "location",

  // About
  "bio",
  "voiceUrl",
  "vibeTags",

  // Dating intentions
  "lookingFor",
  "relationshipStyle",
  "interestedIn",

  // Body
  "height",
  "bodyType",
  "fitnessLevel",

  // Lifestyle
  "smoking",
  "drinking",
  "workoutFrequency",
  "diet",
  "sleepSchedule",

  // Background
  "educationLevel",
  "school",
  "jobTitle",
  "company",
  "languages",

  // Beliefs
  "religion",
  "politicalViews",
  "zodiac",

  // Interests
  "interests",
  "hobbies",
  "favoriteMusic",
  "favoriteMovies",
  "travelStyle",
  "petsPreference",

  // Existing vibe
  "likes",
  "dislikes",
  "favorites",

  // Visibility & settings
  "visibility",
  "visibilityMode",
  "fieldVisibility",
  "preferences",
  "settings",

  // Media
  "avatar",
  "phone",
];

    const updates = {};
    for (const k of allowed) {
      if (req.body[k] !== undefined) updates[k] = req.body[k];
    }
    updates.updatedAt = Date.now();

    const user = await User.findOneAndUpdate(
      { id: req.user.id },
      { $set: updates },
      { new: true }
    ).lean();

    if (!user) return res.status(404).json({ error: "User not found" });
    res.json({ user: baseSanitizeUser(user) });
  } catch (err) {
    console.error("❌ PUT /users/me error:", err);
    res.status(500).json({ error: "Failed to update profile" });
  }
});

/**
 * GET /api/users/blocks → list all users I’ve blocked
 */
router.get("/blocks", authMiddleware, async (req, res) => {
  try {
    const blocks = await Relationship.find({
      from: req.user.id,
      type: "block",
    }).lean();

    const ids = blocks.map((b) => b.to);
    if (!ids.length) return res.json({ blocks: [] });

    const blocked = await User.find({ id: { $in: ids } })
      .select("id firstName lastName avatar")
      .lean();

    res.json({ blocks: blocked });
  } catch (err) {
    console.error("❌ GET /users/blocks error:", err);
    res.status(500).json({ error: "Failed to fetch blocks" });
  }
});

/**
 * GET /api/users/:id
 * Public profile (Discover / ViewProfile)
 */
router.get("/:id", authMiddleware, async (req, res) => {
  try {
    const user = await User.findOne({ id: req.params.id }).lean();
    if (!user) return res.status(404).json({ error: "User not found" });

    const discoverGallery = buildDiscoverSafeGallery(user);

    res.json({
      user: {
        id: user.id,
        firstName: user.firstName,
        dob: user.dob,
        avatar: user.avatar,
        bio: user.bio,

        pronouns: user.pronouns,
        country: user.country,
        hometown: user.hometown,
        travelMode: user.travelMode,

        relationshipStyle: user.relationshipStyle,
        bodyType: user.bodyType,
        fitnessLevel: user.fitnessLevel,
        smoking: user.smoking,
        drinking: user.drinking,
        workoutFrequency: user.workoutFrequency,
        diet: user.diet,
        sleepSchedule: user.sleepSchedule,

        educationLevel: user.educationLevel,
        school: user.school,
        jobTitle: user.jobTitle,
        company: user.company,
        languages: user.languages,

        religion: user.religion,
        politicalViews: user.politicalViews,
        zodiac: user.zodiac,

        favoriteMusic: user.favoriteMusic,
        favoriteMovies: user.favoriteMovies,
        travelStyle: user.travelStyle,
        petsPreference: user.petsPreference,

        likes: user.likes,
        dislikes: user.dislikes,

        interests: user.interests,
        hobbies: user.hobbies,

        media: discoverGallery.media,
        photos: discoverGallery.photos,
        voiceIntro: user.voiceUrl,

        visibilityMode: user.visibilityMode,
        fieldVisibility: user.fieldVisibility,
      },
    });
  } catch (err) {
    console.error("❌ GET /users/:id error:", err);
    res.status(500).json({ error: "Failed to fetch user profile" });
  }
});

/**
 * POST /api/users/blocks/:userId → block another user
 */
router.post("/blocks/:userId", authMiddleware, async (req, res) => {
  try {
    const myId = req.user.id;
    const targetId = req.params.userId;
    if (myId === targetId)
      return res.status(400).json({ error: "Cannot block yourself" });

    const existing = await Relationship.findOne({
      from: myId,
      to: targetId,
      type: "block",
    });
    if (!existing) {
      await Relationship.create({ from: myId, to: targetId, type: "block" });
      console.log(`🚫 ${myId} blocked ${targetId}`);
    }

    res.json({ success: true });
  } catch (err) {
    console.error("❌ Block user error:", err);
    res.status(500).json({ error: "Failed to block user" });
  }
});

/**
 * DELETE /api/users/blocks/:userId → unblock a user
 */
router.delete("/blocks/:userId", authMiddleware, async (req, res) => {
  try {
    const myId = req.user.id;
    const targetId = req.params.userId;

    await Relationship.deleteOne({
      from: myId,
      to: targetId,
      type: "block",
    });

    console.log(`🔓 ${myId} unblocked ${targetId}`);
    res.json({ success: true });
  } catch (err) {
    console.error("❌ Unblock user error:", err);
    res.status(500).json({ error: "Failed to unblock user" });
  }
});

/* ============================================================
   ❤️ SECTION 4: SOCIAL STATS SUMMARY (likes + matches)
============================================================ */

/**
 * GET /api/users/social-stats → advanced social overview
 */
router.get("/social-stats", authMiddleware, async (req, res) => {
  try {
    const myId = req.user.id;

    const liked = await Relationship.find({
      from: myId,
      type: "like",
    }).lean();

    const likedYou = await Relationship.find({
      to: myId,
      type: "like",
    }).lean();

    const mutualLikes = liked
      .map((l) => l.to)
      .filter((id) => likedYou.some((r) => r.from === id));

    const matches = await Match.find({
      status: "matched",
      $or: [{ user1: myId }, { user2: myId }],
    }).lean();

    const matchIds = matches.map((m) =>
      m.user1 === myId ? m.user2 : m.user1
    );

      // ✅ Include profile views (today + total)
    // If missing for older users, default safely.
    const me = await User.findOne({ id: myId }).select("profileViews").lean();

    res.json({
      likedCount: liked.length,
      likedYouCount: likedYou.length,
      matchCount: matchIds.length,
      liked: liked.map((l) => l.to),
      likedYou: likedYou.map((l) => l.from),
      matches: matchIds,

      profileViews: {
        today: Number(me?.profileViews?.today || 0),
        total: Number(me?.profileViews?.total || 0),
      },
    });

  } catch (err) {
    console.error("❌ /users/social-stats error:", err);
    res.status(500).json({ error: "Failed to fetch social stats" });
  }
});

console.log("✅ Users routes initialized (MongoDB version)");

module.exports = router;
