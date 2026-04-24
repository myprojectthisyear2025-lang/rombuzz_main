/**
 * ============================================================
 * ðŸ“ File: routes/users.js
 * ðŸ§© Purpose: Manage user profile updates, preferences, blocking, and social stats.
 *
 * Endpoints:
 *   GET    /api/users/me                 â†’ Get current user info
 *   POST   /api/location                 â†’ Update user's current location
 *   GET    /api/users/social             â†’ Get likes / matches summary
 *   GET    /api/social-stats             â†’ Alias for same stats
 *   GET    /api/matches                  â†’ List match profiles
 *   PUT    /api/users/me                 â†’ Update profile details
 *   GET    /api/users/blocks             â†’ List blocked users
 *   POST   /api/users/blocks/:userId     â†’ Block another user
 *   DELETE /api/users/blocks/:userId     â†’ Unblock a user
 *   GET    /api/users/social-stats       â†’ Retrieve likes / likedYou / matches (Mongo)
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
 *   - authMiddleware.js  â†’ JWT authentication
 *   - utils/helpers.js   â†’ User sanitization
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

// âœ… Mongo Models
const User = require("../models/User");
const Relationship = require("../models/Relationship"); // for likes/blocks
const Match = require("../models/Match");

function isExpoPushToken(token = "") {
  return /^Expo(?:nent)?PushToken\[[^\]]+\]$/.test(String(token || "").trim());
}

function normalizePushTokenEntry(body = {}) {
  return {
    token: String(body.token || "").trim(),
    platform: String(body.platform || "").trim(),
    deviceId: String(body.deviceId || "").trim(),
    appOwnership: String(body.appOwnership || "").trim(),
    createdAt: new Date(),
    updatedAt: new Date(),
    lastSeenAt: new Date(),
  };
}

const DISCOVER_HIDDEN_PRIVACY = new Set([
  "private",
  "matches",
  "matched-only",
  "hidden",
  "specific",
]);

function isUnitedStatesCountry(value = "") {
  const country = String(value || "").trim().toLowerCase();

  return (
    country === "us" ||
    country === "usa" ||
    country === "u.s." ||
    country === "u.s.a." ||
    country === "united states" ||
    country === "united states of america"
  );
}

function getCoordsFromUser(user = {}) {
  const locLat = Number(user?.location?.lat);
  const locLng = Number(user?.location?.lng);

  if (Number.isFinite(locLat) && Number.isFinite(locLng)) {
    return { lat: locLat, lng: locLng };
  }

  const lat = Number(user?.latitude);
  const lng = Number(user?.longitude);

  if (Number.isFinite(lat) && Number.isFinite(lng)) {
    return { lat, lng };
  }

  return null;
}

function getFreshCoordsFromQuery(query = {}) {
  const lat = Number(query?.lat);
  const lng = Number(query?.lng);

  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (lat < -90 || lat > 90) return null;
  if (lng < -180 || lng > 180) return null;

  return { lat, lng };
}

function getDistanceMeters(lat1, lon1, lat2, lon2) {
  const R = 6371e3;
  const phi1 = (lat1 * Math.PI) / 180;
  const phi2 = (lat2 * Math.PI) / 180;
  const dPhi = ((lat2 - lat1) * Math.PI) / 180;
  const dLambda = ((lon2 - lon1) * Math.PI) / 180;

  const a =
    Math.sin(dPhi / 2) * Math.sin(dPhi / 2) +
    Math.cos(phi1) *
      Math.cos(phi2) *
      Math.sin(dLambda / 2) *
      Math.sin(dLambda / 2);

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return R * c;
}

function buildProfileDistancePayload(viewer = {}, target = {}, query = {}) {
  const viewerCoords = getFreshCoordsFromQuery(query);
  const targetCoords = getCoordsFromUser(target);

  // Do not use saved viewer.location here.
  // Saved viewer.location can be stale and caused fake-looking distances like 1277km.
  if (!viewerCoords || !targetCoords) {
    return {
      distanceMeters: null,
      distanceUnit: "",
      distanceValue: null,
      distanceText: "",
      distanceSource: "",
    };
  }

  const distanceMeters = Math.round(
    getDistanceMeters(
      viewerCoords.lat,
      viewerCoords.lng,
      targetCoords.lat,
      targetCoords.lng
    )
  );

  const viewerUsesMiles = isUnitedStatesCountry(viewer?.country);
  const distanceUnit = viewerUsesMiles ? "mi" : "km";
  const rawDistance = viewerUsesMiles
    ? distanceMeters / 1609.34
    : distanceMeters / 1000;

  // Minimum visible distance is 1 mi / 1 km.
  // Everything else rounds UP to the next full integer.
  const distanceValue = Math.max(1, Math.ceil(rawDistance));
  const label =
    distanceUnit === "mi"
      ? `mile${distanceValue === 1 ? "" : "s"}`
      : "km";

  return {
    distanceMeters,
    distanceUnit,
    distanceValue,
    distanceText: `${distanceValue} ${label} away`,
    distanceSource: "fresh_gps",
  };
}

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

function normalizeViewProfileMediaUrl(entry) {
  if (typeof entry === "string") return String(entry || "").trim();
  return String(
    entry?.url ||
      entry?.secure_url ||
      entry?.src ||
      entry?.mediaUrl ||
      entry?.fileUrl ||
      entry?.imageUrl ||
      entry?.videoUrl ||
      ""
  ).trim();
}

function getViewProfileMediaCaption(entry) {
  return String(entry?.caption || entry?.text || entry?.description || "")
    .toLowerCase()
    .trim();
}

function getViewProfileMediaPrivacy(entry) {
  return String(entry?.privacy || entry?.visibility || entry?.scope || "public")
    .toLowerCase()
    .trim();
}

function inferViewProfileMediaType(entry) {
  const type = String(entry?.type || entry?.mediaType || "").toLowerCase().trim();
  const caption = getViewProfileMediaCaption(entry);
  const url = normalizeViewProfileMediaUrl(entry).toLowerCase();

  if (caption.includes("kind:reel") || caption.includes("kind:video")) return "video";
  if (type === "video" || type === "reel" || type.includes("video") || type.includes("reel")) {
    return "video";
  }
  if (
    url.includes("/video/upload/") ||
    /\.(mp4|mov|m4v|webm|avi|wmv|flv|mkv|mpg|mpeg)(\?|#|$)/i.test(url)
  ) {
    return "video";
  }

  return "image";
}

function canShowInViewProfile(entry, canSeeMatchedMedia = false, isSelf = false) {
  if (!entry) return false;
  if (typeof entry === "string") return true;

  const caption = getViewProfileMediaCaption(entry);
  const privacy = getViewProfileMediaPrivacy(entry);

  const isPrivate =
    privacy === "private" ||
    privacy === "hidden" ||
    privacy === "specific" ||
    caption.includes("scope:private") ||
    caption.includes("privacy:private");

  if (isPrivate) return isSelf;

  const isMatchedOnly =
    privacy === "matches" ||
    privacy === "matched" ||
    privacy === "matched-only" ||
    caption.includes("scope:matches") ||
    caption.includes("scope:matched") ||
    caption.includes("privacy:matches");

  if (isMatchedOnly) return canSeeMatchedMedia || isSelf;

  return true;
}

function toCreatedAtMs(value) {
  if (value == null || value === "") return 0;
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  if (value instanceof Date) {
    const ms = value.getTime();
    return Number.isFinite(ms) ? ms : 0;
  }

  const raw = String(value || "").trim();
  if (!raw) return 0;

  const asNumber = Number(raw);
  if (Number.isFinite(asNumber)) return asNumber;

  const parsed = Date.parse(raw);
  return Number.isFinite(parsed) ? parsed : 0;
}

function buildViewProfileGallery(user = {}, options = {}) {
  const canSeeMatchedMedia = !!options.canSeeMatchedMedia;
  const isSelf = !!options.isSelf;
  const seen = new Set();
  const media = [];
  const photos = [];
  const reels = [];

  const ownerId = String(user?.id || user?._id || "");

  const pushMedia = (entry, fallbackIndex = 0, legacyPhoto = false) => {
    const url = normalizeViewProfileMediaUrl(entry);
    if (!url || seen.has(url)) return;
    if (!canShowInViewProfile(entry, canSeeMatchedMedia, isSelf)) return;

    const type = legacyPhoto ? "image" : inferViewProfileMediaType(entry);
    const id =
      typeof entry === "object" && entry
        ? String(entry?.id || entry?._id || entry?.mediaId || `${type}-${fallbackIndex}-${url}`)
        : `legacy-photo-${fallbackIndex}-${url}`;
    const caption =
      typeof entry === "object" && entry
        ? String(entry?.caption || "")
        : "kind:photo scope:public intent:viewprofile";
    const privacy =
      typeof entry === "object" && entry
        ? String(entry?.privacy || entry?.visibility || "public")
        : "public";
    const createdAt = typeof entry === "object" && entry ? entry?.createdAt : 0;

    const normalized = {
      ...(typeof entry === "object" && entry ? entry : {}),
      id,
      mediaId: id,
      ownerId,
      userId: ownerId,
      url,
      mediaUrl: url,
      type,
      caption,
      privacy,
      createdAt,
      fromGallery: true,
      sourceType: "gallery",
    };

    seen.add(url);
    media.push(normalized);

    if (type === "video") {
      reels.push(normalized);
    } else {
      photos.push(url);
    }
  };

  if (Array.isArray(user.media)) {
    user.media.forEach((item, index) => pushMedia(item, index, false));
  }

  if (Array.isArray(user.photos)) {
    user.photos.forEach((item, index) => pushMedia(item, index, true));
  }

  media.sort((a, b) => toCreatedAtMs(b?.createdAt) - toCreatedAtMs(a?.createdAt));
  reels.sort((a, b) => toCreatedAtMs(b?.createdAt) - toCreatedAtMs(a?.createdAt));

  const sortedPhotos = media
    .filter((item) => item.type !== "video")
    .map((item) => item.url);

  return {
    media,
    photos: sortedPhotos.length ? sortedPhotos : photos,
    reels,
  };
}

/* ============================================================
   ðŸ‘¤ SECTION 1: USER INFO & LOCATION
============================================================ */

/**
 * GET /api/users/me â†’ current logged-in user
 */
router.get("/me", authMiddleware, async (req, res) => {
  try {
    const user = await User.findOne({ id: req.user.id }).lean();
    if (!user) return res.status(404).json({ error: "User not found" });
    res.json(baseSanitizeUser(user));
  } catch (err) {
    console.error("âŒ /users/me error:", err);
    res.status(500).json({ error: "Failed to fetch user" });
  }
});
router.post("/me/push-token", authMiddleware, async (req, res) => {
  try {
    const entry = normalizePushTokenEntry(req.body || {});

    if (!isExpoPushToken(entry.token)) {
      return res.status(400).json({ error: "valid Expo push token required" });
    }

    const user = await User.findOne({ id: req.user.id });
    if (!user) return res.status(404).json({ error: "User not found" });

    const list = Array.isArray(user.pushTokens) ? [...user.pushTokens] : [];
    const existingIndex = list.findIndex(
      (item) => String(item?.token || "") === entry.token
    );

    if (existingIndex >= 0) {
      list[existingIndex] = {
        ...list[existingIndex].toObject?.(),
        ...list[existingIndex],
        ...entry,
        createdAt: list[existingIndex]?.createdAt || entry.createdAt,
      };
    } else {
      list.push(entry);
    }

    user.pushTokens = list;
    await user.save();

    res.json({
      success: true,
      pushTokens: (user.pushTokens || []).map((item) => ({
        token: item.token,
        platform: item.platform || "",
        updatedAt: item.updatedAt || item.lastSeenAt || item.createdAt || null,
      })),
    });
  } catch (err) {
    console.error("POST /users/me/push-token error:", err);
    res.status(500).json({ error: "Failed to save push token" });
  }
});

router.delete("/me/push-token", authMiddleware, async (req, res) => {
  try {
    const token = String(req.body?.token || "").trim();
    if (!token) return res.status(400).json({ error: "token required" });

    const user = await User.findOne({ id: req.user.id });
    if (!user) return res.status(404).json({ error: "User not found" });

    user.pushTokens = (Array.isArray(user.pushTokens) ? user.pushTokens : []).filter(
      (item) => String(item?.token || "") !== token
    );
    await user.save();

    res.json({ success: true, remaining: user.pushTokens.length });
  } catch (err) {
    console.error("DELETE /users/me/push-token error:", err);
    res.status(500).json({ error: "Failed to remove push token" });
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
    console.error("âŒ POST /users/:id/view error:", err);
    res.status(500).json({ error: "Failed to record profile view" });
  }
});

/**
 * POST /api/location â†’ update user geolocation
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
    console.error("âŒ /location error:", err);
    res.status(500).json({ error: "Failed to update location" });
  }
});

/* ============================================================
   ðŸ’ž SECTION 2: SOCIAL RELATIONSHIPS (likes, matches)
============================================================ */

/**
 * GET /api/users/social or /api/social-stats
 * â†’ summary of likesGiven, likesReceived, matchesCount
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
    console.error("âŒ /users/social error:", err);
    res.status(500).json({ error: "Failed to fetch social stats" });
  }
});

/**
 * GET /api/matches â†’ list full match partner profiles
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
    console.error("âŒ /matches error:", err);
    res.status(500).json({ error: "Failed to fetch matches" });
  }
});

/* ============================================================
   ðŸ§‘ SECTION 3: PROFILE UPDATE / BLOCKS
============================================================ */

/**
 * PUT /api/users/me â†’ update profile info
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
      "voiceUrl",
      "voiceDurationSec",
    ];

    const toCsvString = (value) => {
      if (Array.isArray(value)) {
        return value
          .map((item) => String(item ?? "").trim())
          .filter(Boolean)
          .join(", ");
      }
      if (typeof value === "string") return value;
      if (value == null) return "";
      return String(value);
    };

    const toStringArray = (value) => {
      if (Array.isArray(value)) {
        return value.map((item) => String(item ?? "").trim()).filter(Boolean);
      }
      if (typeof value === "string") {
        return value
          .split(",")
          .map((item) => item.trim())
          .filter(Boolean);
      }
      return [];
    };

    const updates = {};
    for (const k of allowed) {
      if (req.body[k] !== undefined) updates[k] = req.body[k];
    }

    if (updates.likes !== undefined) {
      updates.likes = toCsvString(updates.likes);
    }

    if (updates.dislikes !== undefined) {
      updates.dislikes = toCsvString(updates.dislikes);
    }

    if (updates.favorites !== undefined) {
      updates.favorites = toStringArray(updates.favorites);
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
 * GET /api/users/blocks â†’ list all users Iâ€™ve blocked
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
    console.error("âŒ GET /users/blocks error:", err);
    res.status(500).json({ error: "Failed to fetch blocks" });
  }
});

/**
 * GET /api/users/:id
 * Public profile (Discover / ViewProfile)
 */
router.get("/:id", authMiddleware, async (req, res) => {
  try {
    const [viewer, user] = await Promise.all([
      User.findOne({ id: req.user.id }).lean(),
      User.findOne({ id: req.params.id }).lean(),
    ]);

      if (!viewer) return res.status(404).json({ error: "Viewer not found" });
    if (!user) return res.status(404).json({ error: "User not found" });

    const isSelf = String(viewer.id) === String(user.id);
    const matchedConnection = isSelf
      ? true
      : await Match.findOne({
          status: "matched",
          $or: [
            { user1: viewer.id, user2: user.id },
            { user1: user.id, user2: viewer.id },
          ],
        }).lean();

    const canSeeMatchedMedia = isSelf || !!matchedConnection;
    const discoverGallery = buildDiscoverSafeGallery(user);
    const viewProfileGallery = buildViewProfileGallery(user, {
      canSeeMatchedMedia,
      isSelf,
    });
    const profileGallery = canSeeMatchedMedia ? viewProfileGallery : discoverGallery;
    const distancePayload = buildProfileDistancePayload(viewer, user, req.query);

    res.json({
      user: {
        id: user.id,
        firstName: user.firstName,
        lastName: user.lastName,
        name: [user.firstName, user.lastName].filter(Boolean).join(" ").trim(),
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

        media: profileGallery.media,
        photos: profileGallery.photos,
        reels: canSeeMatchedMedia ? viewProfileGallery.reels : [],
        matched: canSeeMatchedMedia,
        voiceIntro: user.voiceUrl,
        voiceUrl: user.voiceUrl,
        voiceDurationSec: Number(user.voiceDurationSec || 0),
        distanceMeters: distancePayload.distanceMeters,
        distanceUnit: distancePayload.distanceUnit,
        distanceValue: distancePayload.distanceValue,
        distanceText: distancePayload.distanceText,
        distanceSource: distancePayload.distanceSource,

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
      console.log(`ðŸš« ${myId} blocked ${targetId}`);
    }

    res.json({ success: true });
  } catch (err) {
    console.error("âŒ Block user error:", err);
    res.status(500).json({ error: "Failed to block user" });
  }
});

/**
 * DELETE /api/users/blocks/:userId â†’ unblock a user
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

    console.log(`ðŸ”“ ${myId} unblocked ${targetId}`);
    res.json({ success: true });
  } catch (err) {
    console.error("âŒ Unblock user error:", err);
    res.status(500).json({ error: "Failed to unblock user" });
  }
});

/* ============================================================
   â¤ï¸ SECTION 4: SOCIAL STATS SUMMARY (likes + matches)
============================================================ */

/**
 * GET /api/users/social-stats â†’ advanced social overview
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

      // âœ… Include profile views (today + total)
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
    console.error("âŒ /users/social-stats error:", err);
    res.status(500).json({ error: "Failed to fetch social stats" });
  }
});

console.log("âœ… Users routes initialized (MongoDB version)");

module.exports = router;

