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

const MicroBuzzPresence = require("../models/MicroBuzzPresence");
const MicroBuzzBuzz = require("../models/MicroBuzzBuzz");
const Match = require("../models/Match");

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
   🧭 FETCH NEARBY ACTIVE USERS
============================================================ */
router.get("/nearby", authMiddleware, async (req, res) => {
  try {
    const lat = parseFloat(req.query.lat);
    const lng = parseFloat(req.query.lng);
    const radiusKm = parseFloat(req.query.radius || "1");
    const userId = req.user.id;

    if (isNaN(lat) || isNaN(lng)) {
      return res.status(400).json({ error: "lat/lng required" });
    }

    const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);
    const allActive = await MicroBuzzPresence.find({
      updatedAt: { $gte: fiveMinutesAgo },
      userId: { $ne: userId },
    }).lean();

    const users = allActive
      .map((u) => {
        const d = Math.sqrt((u.lat - lat) ** 2 + (u.lng - lng) ** 2) * 111;
        return {
          id: u.userId,
          selfieUrl: u.selfieUrl,
          distanceMeters: d * 1000,
        };
      })
      .filter((u) => u.distanceMeters <= radiusKm * 1000 || process.env.NODE_ENV !== "production");

    res.json({ users });
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
  // Still behave like a fresh match so both see animation + redirect to chat.
  const fromUser = await MicroBuzzPresence.findOne({ userId: fromId }).lean();
  const toUser = await MicroBuzzPresence.findOne({ userId: toId }).lean();

  [fromId, toId].forEach((uid) => {
    const other = uid === fromId ? toId : fromId;
    const otherSelfie = uid === fromId ? toUser?.selfieUrl : fromUser?.selfieUrl;

    if (onlineUsers[uid]) {
      io.to(onlineUsers[uid]).emit("match", {
        otherUserId: other,
        selfieUrl: otherSelfie,
      });
    }
  });

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
    users: [fromId, toId],    // still included for array lookups
    type: "microbuzz",

        createdAt: new Date(),
      });
    }

    // Notify both users: MATCHED!
    const fromUser = await MicroBuzzPresence.findOne({ userId: fromId }).lean();
    const toUser = await MicroBuzzPresence.findOne({ userId: toId }).lean();

    [fromId, toId].forEach((uid) => {
      const other = uid === fromId ? toId : fromId;
      const otherSelfie = uid === fromId ? toUser?.selfieUrl : fromUser?.selfieUrl;

      if (onlineUsers[uid]) {
        io.to(onlineUsers[uid]).emit("match", {
          otherUserId: other,
          selfieUrl: otherSelfie,
        });
      }
    });

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

    if (onlineUsers[toId]) {
      io.to(onlineUsers[toId]).emit("buzz_request", {
        fromId,
        selfieUrl: fromPresence?.selfieUrl,
        name: fromPresence?.name || "Nearby user",
        distanceMeters,
        message: "Someone nearby buzzed you!",
        type: "microbuzz",
      });
    }

    res.json({ success: true });
  } catch (err) {
    console.error("❌ /api/microbuzz/buzz error:", err);
    res.status(500).json({ error: "Buzz failed" });
  }
});

module.exports = router;
