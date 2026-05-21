/**
 * ============================================================
 * 📁 File: routes/microbuzzRoutes.js
 * 📍 Purpose: Handles all MicroBuzz live-presence features
 *   using MongoDB for persistence instead of in-memory maps.
 *
 * Endpoints:
 *   POST   /api/microbuzz/selfie        → Upload selfie to Cloudinary
 *   DELETE /api/microbuzz/selfie        → Delete stored selfie reference
 *   POST   /api/microbuzz/activate      → Activate live MicroBuzz presence
 *   POST   /api/microbuzz/deactivate    → Remove active presence
 *   GET    /api/microbuzz/nearby        → Fetch nearby active users
 *   GET    /api/microbuzz/selfies       → Debug: list all stored selfies
 *
 * Features:
 *   - 📸 Cloudinary-based selfie uploads
 *   - 🗺️  Persistent presence via MongoDB (MicroBuzzPresence)
 *   - ⚡ Real-time updates via Socket.IO
 *   - 📍  Distance-based nearby discovery
 *   - 🔐  Authenticated endpoints (JWT)
 *
 * Dependencies:
 *   - models/MicroBuzzPresence.js → MongoDB model
 *   - config/cloudinary.js        → Cloudinary client
 *   - socket.js                   → io + onlineUsers
 *   - jsonwebtoken, multer, express
 *
 * Notes:
 *   - Fully replaces old in-memory MicroBuzz system
 *   - Presence expires automatically (2 minutes inactivity)
 * ============================================================
 */

const express = require("express");
const fs = require("fs");
const multer = require("multer");
const cloudinary = require("cloudinary").v2;
const authMiddleware = require("../routes/auth-middleware");
const {
  ensureFeatureAllowed,
  sendFeatureRestrictionError,
} = require("../utils/moderation");
const MicroBuzzPresence = require("../models/MicroBuzzPresence");

async function enforceMicroBuzzAllowed(req, res) {
  try {
    await ensureFeatureAllowed(req.user.id, "microbuzz");
    return true;
  } catch (err) {
    sendFeatureRestrictionError(res, err);
    return false;
  }
}

// =======================
// 📂 MULTER SETUP
// =======================
const upload = multer({ dest: "uploads/" });

// =======================
// ⚙️ ROUTE FACTORY (io + onlineUsers)
// =======================
function initMicroBuzzRoutes(io, onlineUsers) {
  const router = express.Router();

    /* ======================
     📸 UPLOAD SELFIE
  ====================== */
  router.post("/selfie", authMiddleware, upload.single("selfie"), async (req, res) => {
    try {
      if (!(await enforceMicroBuzzAllowed(req, res))) return;

      if (!req.file) return res.status(400).json({ error: "No selfie uploaded" });

      const result = await cloudinary.uploader.upload(req.file.path, {
        folder: "microbuzz_selfies",
        resource_type: "image",
        transformation: [{ width: 320, height: 320, crop: "fill", gravity: "face" }],
      });

      fs.unlink(req.file.path, () => {});
      res.json({ url: result.secure_url });
    } catch (err) {
      console.error("❌ MicroBuzz selfie upload failed:", err);
      res.status(500).json({ error: "Upload failed" });
    }
  });

  /* ======================
     ❌ DELETE SELFIE
  ====================== */
  router.delete("/selfie", authMiddleware, async (req, res) => {
    try {
      // optional cleanup logic if needed in future
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ error: "Delete failed" });
    }
  });

   /* ======================
     ⚡ ACTIVATE PRESENCE
  ====================== */
  router.post("/activate", authMiddleware, express.json(), async (req, res) => {
    try {
      if (!(await enforceMicroBuzzAllowed(req, res))) return;

      const { lat, lng, selfieUrl } = req.body;
      if (!lat || !lng || !selfieUrl)
        return res.status(400).json({ error: "Missing location or selfie" });

      const userId = req.user.id;
      const name = req.user.firstName || "Anonymous";

      await MicroBuzzPresence.findOneAndUpdate(
        { userId },
        {
          userId,
          name,
          selfieUrl,
          lat: parseFloat(lat),
          lng: parseFloat(lng),
          lastActive: new Date(),
        },
        { upsert: true }
      );

      // 🔔 Broadcast presence update
      for (const [otherId, socketId] of Object.entries(onlineUsers)) {
        if (otherId !== userId) {
          io.to(socketId).emit("microbuzz_update", {
            userId,
            name,
            selfieUrl,
            lat,
            lng,
          });
        }
      }

      res.json({ ok: true });
    } catch (err) {
      console.error("❌ MicroBuzz activate error:", err);
      res.status(500).json({ error: "Internal error" });
    }
  });

  /* ======================
     📴 DEACTIVATE PRESENCE
  ====================== */
  router.post("/deactivate", authMiddleware, async (req, res) => {
    try {
      await MicroBuzzPresence.deleteOne({ userId: req.user.id });
      res.json({ ok: true });
    } catch (err) {
      console.error("❌ MicroBuzz deactivate error:", err);
      res.status(500).json({ error: "Failed to deactivate" });
    }
  });

  /* ======================
     📍 FETCH NEARBY USERS
  ====================== */
  router.get("/nearby", authMiddleware, async (req, res) => {
    try {
      if (!(await enforceMicroBuzzAllowed(req, res))) return;

      const { lat, lng, radius = 0.2 } = req.query;
      const selfId = req.user.id;

      if (!lat || !lng) return res.status(400).json({ error: "Missing lat/lng" });

      const radiusKm = parseFloat(radius);
      const cutoff = new Date(Date.now() - 2 * 60 * 1000); // 2 minutes

      const nearby = await MicroBuzzPresence.find({
        userId: { $ne: selfId },
        lastActive: { $gte: cutoff },
      }).lean();

      const R = 6371000;
      function distanceMeters(lat1, lon1, lat2, lon2) {
        const dLat = ((lat2 - lat1) * Math.PI) / 180;
        const dLon = ((lon2 - lon1) * Math.PI) / 180;
        const a =
          Math.sin(dLat / 2) ** 2 +
          Math.cos((lat1 * Math.PI) / 180) *
            Math.cos((lat2 * Math.PI) / 180) *
            Math.sin(dLon / 2) ** 2;
        return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
      }

      const users = nearby
        .map((u) => ({
          id: u.userId,
          name: u.name,
          selfieUrl: u.selfieUrl,
          distanceMeters: distanceMeters(lat, lng, u.lat, u.lng),
        }))
        .filter((u) => u.distanceMeters <= radiusKm * 1000)
        .sort((a, b) => a.distanceMeters - b.distanceMeters);

      res.json({ users });
    } catch (err) {
      console.error("❌ MicroBuzz nearby error:", err);
      res.status(500).json({ error: "Internal server error" });
    }
  });

   /* ======================
     🧪 DEBUG ENDPOINT
  ====================== */
  router.get("/selfies", authMiddleware, async (req, res) => {
    if (!(await enforceMicroBuzzAllowed(req, res))) return;

    const all = await MicroBuzzPresence.find({}, "userId selfieUrl -_id").lean();
    res.json(all);
  });

  return router;
}

module.exports = initMicroBuzzRoutes;
