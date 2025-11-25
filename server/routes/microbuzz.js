/**
 * ============================================================
 * 📁 File: routes/microbuzz.js
 * 📍 Purpose: Handles all MicroBuzz-related endpoints including:
 *   - 📸 Selfie uploads via Cloudinary
 *   - ⚡ Real-time presence activation & nearby discovery
 *   - 💬 Buzz requests and instant match detection
 *   - 🧭 Safe deactivation of MicroBuzz visibility
 *
 * Endpoints:
 *   POST   /api/microbuzz/selfie
 *   POST   /api/microbuzz/activate
 *   GET    /api/microbuzz/nearby
 *   POST   /api/microbuzz/deactivate
 *   POST   /api/microbuzz/buzz
 *
 * Dependencies:
 *   - auth-middleware.js (JWT verification)
 *   - cloudinary.js (media upload)
 *   - models/state.js (onlineUsers map)
 *   - socket.js (getIO → Socket.IO instance)
 *   - MicroBuzzPresence / MicroBuzzBuzz / Match (Mongo models)
 * ============================================================
 */

const express = require("express");
const router = express.Router();
const fs = require("fs");
const multer = require("multer");
const upload = multer({ dest: "uploads/" });
const cloudinary = require("../config/cloudinary");
const authMiddleware = require("../routes/auth-middleware");

// ✅ Correct shared realtime state + socket access
const { onlineUsers } = require("../models/state");
const { getIO } = require("../socket");

// Mongo + models
const User = require("../models/User");
const MicroBuzzPresence = require("../models/MicroBuzzPresence");
const MicroBuzzBuzz = require("../models/MicroBuzzBuzz");
const Match = require("../models/MatchModel");
//const MicroBuzzSelfie = require("../models/MicroBuzzSelfie");

// 🔔 Notifications helper
const { sendNotification } = require("../utils/helpers");



/* ============================================================
   📸 SELFIE UPLOAD
============================================================ */
router.post("/selfie", authMiddleware, upload.single("selfie"), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: "No selfie provided" });

    const uploadResult = await cloudinary.uploader.upload(req.file.path, {
      folder: "rombuzz/selfies",
      resource_type: "image",
      transformation: [{ width: 320, height: 320, crop: "fill", gravity: "face" }],
    });

    fs.unlink(req.file.path, () => {});
    res.json({ url: uploadResult.secure_url });
  } catch (err) {
    console.error("❌ MicroBuzz selfie upload failed:", err);
    res.status(500).json({ error: "Upload failed" });
  }
});

/* ============================================================
   ⚡ ACTIVATE PRESENCE
============================================================ */
router.post("/activate", authMiddleware, async (req, res) => {
  try {
    const { lat, lng, selfieUrl } = req.body || {};
    const latNum = parseFloat(lat);
    const lngNum = parseFloat(lng);
    const userId = req.user.id;

    if (isNaN(latNum) || isNaN(lngNum) || !selfieUrl) {
      return res.status(400).json({ error: "Invalid or missing lat/lng/selfieUrl" });
    }

    let offsetLat = 0;
    let offsetLng = 0;
    if (process.env.NODE_ENV !== "production") {
      offsetLat = (Math.random() - 0.5) * 0.0005;
      offsetLng = (Math.random() - 0.5) * 0.0005;
    }

    await MicroBuzzPresence.findOneAndUpdate(
      { userId },
      {
        userId,
        selfieUrl,
        lat: latNum + offsetLat,
        lng: lngNum + offsetLng,
        updatedAt: new Date(),
      },
      { upsert: true }
    );

    res.json({ success: true });
  } catch (err) {
    console.error("❌ /api/microbuzz/activate error:", err);
    res.status(500).json({ error: "Activate failed" });
  }
});

/* ============================================================
   🧭 FETCH NEARBY ACTIVE USERS (with gender + age preferences)
============================================================ */
router.get("/nearby", authMiddleware, async (req, res) => {
  try {
    const lat = parseFloat(req.query.lat);
    const lng = parseFloat(req.query.lng);
    const userId = req.user.id;

    if (isNaN(lat) || isNaN(lng)) {
      return res.status(400).json({ error: "lat/lng required" });
    }

    // 🧑 Get current user + saved preferences
    const self = await User.findOne({ id: userId }).lean();
    if (!self) {
      return res.status(404).json({ error: "User not found" });
    }

    const prefs = self.preferences || {};
    const prefGender = (prefs.gender || "").toLowerCase();           // "male" | "female" | "everyone" | ""
    const prefAgeMin = Number(prefs.ageMin) || null;                 // e.g. 21
    const prefAgeMax = Number(prefs.ageMax) || null;                 // e.g. 35

    // 🛰 Discover can go far, but MicroBuzz is ultra-local.
    // Clamp max radius to ~100m in production.
    const requestedRadiusKm = parseFloat(req.query.radius || "0.1"); // default 100m
    const maxRadiusKm = process.env.NODE_ENV === "production" ? 0.1 : 1; // dev can scan wider
    const radiusKm = Math.min(
      Number.isFinite(requestedRadiusKm) ? requestedRadiusKm : 0.1,
      maxRadiusKm
    );

    const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);

    // 🌐 Raw active presences near me (except myself)
    const allActive = await MicroBuzzPresence.find({
      updatedAt: { $gte: fiveMinutesAgo },
      userId: { $ne: userId },
    }).lean();

    if (!allActive.length) {
      return res.json({ users: [] });
    }

    // 🔎 Load user profiles for these presences (to get gender + dob)
    const candidateIds = [...new Set(allActive.map((u) => u.userId))];
    const candidateUsers = await User.find({ id: { $in: candidateIds } })
      .select("id gender dob")
      .lean();

    const usersById = new Map(candidateUsers.map((u) => [u.id, u]));

    const users = allActive
      .map((presence) => {
        const u = usersById.get(presence.userId);

        // Distance in meters between me and this presence
        const dKm =
          Math.sqrt((presence.lat - lat) ** 2 + (presence.lng - lng) ** 2) *
          111;
        const distanceMeters = dKm * 1000;

        return {
          id: presence.userId,
          selfieUrl: presence.selfieUrl,
          distanceMeters,
          _user: u || null, // attach for filtering only
        };
      })
      // 1) Distance cap: MicroBuzz hard-locked to ~0–100m in prod
      .filter((item) => {
        if (process.env.NODE_ENV !== "production") return true;
        return item.distanceMeters <= radiusKm * 1000;
      })
      // 2) Gender preference filter
      .filter((item) => {
        const u = item._user;
        if (!u) return true; // no profile -> keep (we just don't know)
        if (!prefGender || prefGender === "everyone") return true;

        const g = (u.gender || "").toLowerCase();
        if (!g) return false; // user wants a specific gender, target has none -> skip

        if (prefGender === "male") return g === "male";
        if (prefGender === "female") return g === "female";
        return true;
      })
      // 3) Age preference filter (mm/dd/yyyy or ISO dob)
      .filter((item) => {
        if (!prefAgeMin && !prefAgeMax) return true;
        const u = item._user;
        if (!u || !u.dob) return true; // unknown age -> keep

        const age = computeAge(u.dob);
        if (!age) return true;

        const minAge = prefAgeMin || 18;
        const maxAge = prefAgeMax || 120;
        return age >= minAge && age <= maxAge;
      })
      // 4) Strip internal fields before sending to client
      .map(({ _user, ...rest }) => rest);

    return res.json({ users });
  } catch (err) {
    console.error("❌ /api/microbuzz/nearby error:", err);
    res.status(500).json({ error: "Nearby fetch failed" });
  }
});


/* ============================================================
   🚫 DEACTIVATE PRESENCE
============================================================ */
router.post("/deactivate", authMiddleware, async (req, res) => {
  try {
    await MicroBuzzPresence.deleteOne({ userId: req.user.id });
    res.json({ success: true });
  } catch (err) {
    console.error("❌ /api/microbuzz/deactivate error:", err);
    res.status(500).json({ error: "Deactivate failed" });
  }
});

/* ============================================================
   💞 BUZZ REQUEST + MATCH CONFIRM
============================================================ */
router.post("/buzz", authMiddleware, async (req, res) => {
  try {
    // ✅ Socket.IO instance
    const io = getIO();

    const { toId, confirm } = req.body || {};
    const fromId = req.user.id;

    if (!toId) return res.status(400).json({ error: "toId required" });

    const fromPresence = await MicroBuzzPresence.findOne({ userId: fromId }).lean();
    const toPresence = await MicroBuzzPresence.findOne({ userId: toId }).lean();

    const calcDistance = () => {
      if (!fromPresence || !toPresence) return null;
      const dx = (fromPresence.lat - toPresence.lat) * 111000;
      const dy = (fromPresence.lng - toPresence.lng) * 111000;
      return Math.sqrt(dx * dx + dy * dy);
    };

 const distanceMeters = calcDistance();
const reverseBuzz = await MicroBuzzBuzz.findOne({ fromId: toId, toId: fromId });
// ✅ PREVENT LOOPING — If already matched, do NOT send any buzz popup again
const alreadyMatched = await Match.findOne({ users: { $all: [fromId, toId] } });

if (alreadyMatched) {
  // 🔁 They were matched before (Discover, old flow, etc.)
  const fromPresence = await MicroBuzzPresence.findOne({ userId: fromId }).lean();
  const toPresence = await MicroBuzzPresence.findOne({ userId: toId }).lean();

  // 🧑 Fetch profiles for names (John / Katy)
  const [fromProfile, toProfile] = await Promise.all([
    User.findOne({ id: fromId }).lean(),
    User.findOne({ id: toId }).lean(),
  ]);

  const fromName = fromProfile?.firstName || "Someone";
  const toName = toProfile?.firstName || "Someone";

  // 🧵 Shared chat room id (sorted for consistency)
  const roomId = [fromId, toId].sort().join("_");

  // 🎉 Live "match" event for BOTH users (with extra data)
  [fromId, toId].forEach((uid) => {
    const other = uid === fromId ? toId : fromId;
    const otherSelfie = uid === fromId ? toPresence?.selfieUrl : fromPresence?.selfieUrl;
    const otherDisplayName = uid === fromId ? toName : fromName;

    if (onlineUsers[uid]) {
      io.to(onlineUsers[uid]).emit("match", {
        otherUserId: other,
        otherName: otherDisplayName,
        selfieUrl: otherSelfie,
        roomId,
        via: "microbuzz",
      });
    }
  });

  // 🔔 Personalized notifications with 2 clear actions:
  //  - View Profile (href)
  //  - Chat (entity: "chat", entityId: roomId)
  try {
  await Promise.all([
  sendNotification(fromId, {
    type: "match",
    fromId: toId,
    via: "microbuzz",
    message: `You and ${toName} matched with each other 💞`,
    href: `/viewProfile/${toId}`,
    entity: "chat",
    entityId: roomId,
  }),

  sendNotification(toId, {
    type: "match",
    fromId: fromId,
    via: "microbuzz",
    message: `You and ${fromName} matched with each other 💞`,
    href: `/viewProfile/${fromId}`,
    entity: "chat",
    entityId: roomId,
  }),
]);

  } catch (e) {
    console.warn("❌ MicroBuzz match notification failed:", e);
  }

  return res.json({ matched: true });
}

/* ============================================================
   MUTUAL BUZZ → MATCH (loop-proof)
============================================================ */
if (reverseBuzz) {
  if (confirm === true) {
    // Clean up pending buzzes
    await MicroBuzzBuzz.deleteMany({
      $or: [
        { fromId, toId },
        { fromId: toId, toId: fromId },
      ],
    });

    // Create match if not exists
    const exists = await Match.findOne({ users: { $all: [fromId, toId] } });
    if (!exists) {
      await Match.create({
        id: `${fromId}_${toId}_${Date.now()}`,
        user1: fromId,
        user2: toId,
        users: [fromId, toId], // still included for array lookups
        type: "microbuzz",
        createdAt: new Date(),
      });
    }

    // Notify both users: MATCHED!
    const fromPresence = await MicroBuzzPresence.findOne({ userId: fromId }).lean();
    const toPresence = await MicroBuzzPresence.findOne({ userId: toId }).lean();

    // 🧑 Fetch profiles for names
    const [fromProfile, toProfile] = await Promise.all([
      User.findOne({ id: fromId }).lean(),
      User.findOne({ id: toId }).lean(),
    ]);

    const fromName = fromProfile?.firstName || "Someone";
    const toName = toProfile?.firstName || "Someone";

    // 🧵 Shared chat room id (same for both sides)
    const roomId = [fromId, toId].sort().join("_");

    // 🎉 Live "match" event for BOTH users (with room + names)
    [fromId, toId].forEach((uid) => {
      const other = uid === fromId ? toId : fromId;
      const otherSelfie = uid === fromId ? toPresence?.selfieUrl : fromPresence?.selfieUrl;
      const otherDisplayName = uid === fromId ? toName : fromName;

      if (onlineUsers[uid]) {
        io.to(onlineUsers[uid]).emit("match", {
          otherUserId: other,
          otherName: otherDisplayName,
          selfieUrl: otherSelfie,
          roomId,
          via: "microbuzz",
        });
      }
    });

    // 🔔 Personalized match notifications for BOTH:
    // John: "You and Katy matched..." → View Katy + Chat
    // Katy: "You and John matched..." → View John + Chat
    try {
     await Promise.all([
  sendNotification(fromId, {
    type: "match",
    fromId: toId,
    via: "microbuzz",
    message: `You and ${toName} matched with each other 💞`,
    href: `/viewProfile/${toId}`,
    entity: "chat",
    entityId: roomId,
  }),

  sendNotification(toId, {
    type: "match",
    fromId: fromId,
    via: "microbuzz",
    message: `You and ${fromName} matched with each other 💞`,
    href: `/viewProfile/${fromId}`,
    entity: "chat",
    entityId: roomId,
  }),
]);

    } catch (e) {
      console.warn("❌ MicroBuzz match notification failed:", e);
    }

    // Final response
    return res.json({ matched: true });
  }

  // ❗ DO NOT SEND buzz_request AGAIN
  // User B already buzzed A; now waiting only for confirm:true

  return res.json({ pending: true, requiresConfirm: true });
}


      /* ============================================================
         ONE-WAY BUZZ
    ============================================================ */
    const exists = await MicroBuzzBuzz.findOne({ fromId, toId });
    if (!exists) {
      await MicroBuzzBuzz.create({ fromId, toId, time: new Date() });
    }

    // Fetch real user profile to get firstName
    const fromProfile = await User.findOne({ id: fromId }).lean();
    const firstName = fromProfile?.firstName || "Someone";

    // 🔔 Create a stored notification + trigger navbar badge
    try {
      await sendNotification(toId, {
        fromId,
        type: "buzz",
        via: "microbuzz",
        message: `${firstName} wants to buzz you!`,
        href: `/viewProfile/${fromId}`,
      });
    } catch (e) {
      console.warn("MicroBuzz one-way notification failed:", e);
    }

    // 📡 Live popup if they are online (existing behavior)
    if (onlineUsers[toId]) {
      io.to(onlineUsers[toId]).emit("buzz_request", {
        fromId,
        selfieUrl: fromPresence?.selfieUrl,
        name: firstName,
        distanceMeters,
        message: `${firstName} wants to buzz you!`,
        type: "microbuzz",
      });
    }

    res.json({ success: true });


  } catch (err) {
    console.error("❌ /api/microbuzz/buzz error:", err);
    res.status(500).json({ error: "Buzz failed" });
  }
});
// Simple DOB → age helper (supports "mm/dd/yyyy" or ISO/Date-parsable)
function computeAge(dobStr) {
  if (!dobStr) return null;

  let d;
  const raw = String(dobStr).trim();

  // mm/dd/yyyy (signup format)
  if (raw.includes("/")) {
    const parts = raw.split(/[\/\-]/).map((n) => parseInt(n, 10));
    if (parts.length !== 3) return null;
    const [month, day, year] = parts;
    if (!month || !day || !year) return null;
    d = new Date(year, month - 1, day);
  } else {
    // fallback: ISO or Date-parsable
    d = new Date(raw);
  }

  if (Number.isNaN(d.getTime())) return null;

  const now = new Date();
  let age = now.getFullYear() - d.getFullYear();
  const m = now.getMonth() - d.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < d.getDate())) {
    age--;
  }
  return age;
}

module.exports = router;
