/**
 * ============================================================
 * 📁 File: routes/discover.js
 * 💫 Purpose: Discover nearby users based on filters, location, and vibe (MongoDB)
 *
 * Endpoint:
 *   GET /api/discover → Filter and discover nearby users
 *
 * Dependencies:
 *   - models/User.js         → Mongoose user schema
 *   - models/Relationship.js → Unified model for likes/blocks/follows
 *   - auth-middleware.js     → JWT validation
 *   - utils/helpers.js       → canUseRestricted(), isRestricted()
 * ============================================================
 */

const express = require("express");
const router = express.Router();
const User = require("../models/User");
const Relationship = require("../models/Relationship"); // ✅ Correct model for likes/blocks/follows
const authMiddleware = require("../routes/auth-middleware");
const { isRestricted, canUseRestricted } = require("../utils/helpers");

/* ============================================================
   🧠 GET /api/discover (MongoDB version)
============================================================ */
router.get("/", authMiddleware, async (req, res) => {
  try {
    const self = await User.findOne({ id: req.user.id }).lean();
    if (!self) return res.status(404).json({ error: "User not found" });

    const me = self;
    const requestedVibe = String(req.query.vibe || "").toLowerCase();
    let canFilterWithRequestedVibe = true;

    if (requestedVibe && isRestricted(requestedVibe) && !canUseRestricted(me)) {
      canFilterWithRequestedVibe = false;
    }

    const {
      lat,
      lng,
      range = 50000, // 🎯 FIX: default 50km so users show without query params
      gender,
      intent,
      vibe,
      interest,
      blur,
      online,
      verified,
      zodiac,
      love,
    } = req.query;

    /* ============================================================
       🌍 Determine base location (GPS or last known)
    ============================================================ */
    let baseLat = parseFloat(lat) || self.location?.lat;
    let baseLng = parseFloat(lng) || self.location?.lng;

    if (isNaN(baseLat) || isNaN(baseLng)) {
      if (self.location?.lat && self.location?.lng) {
        baseLat = self.location.lat;
        baseLng = self.location.lng;
        console.log("📍 Using last known location:", self.location);
      } else {
        baseLat = Number(process.env.DEV_DEFAULT_LAT || 41.8781);
        baseLng = Number(process.env.DEV_DEFAULT_LNG || -87.6298);
        console.warn("⚠️ DISCOVER fallback coords used (no GPS)");
      }
    }

    /* ============================================================
       📍 Always update user location
    ============================================================ */
    await User.updateOne(
      { id: self.id },
      {
        $set: {
          location: { lat: baseLat, lng: baseLng },
          lastActive: Date.now(),
        },
      }
    );

    /* ============================================================
       💌 Fetch liked users using Relationship model
    ============================================================ */
    const likedDocs = await Relationship.find({
      from: self.id,
      type: "like",
    }).lean();

    const likedIds = likedDocs.map((l) => l.to);

    /* ============================================================
       🧩 Fetch visible candidates
    ============================================================ */
    let candidates = await User.find({
      id: { $ne: self.id },
      visibility: { $ne: "invisible" },
      id: { $nin: likedIds }, // remove already-liked users
    }).lean();

    /* ============================================================
       🩷 Tier 1 — Basic Filters
    ============================================================ */

    if (gender) {
      candidates = candidates.filter(
        (u) => (u.gender || "").toLowerCase() === gender.toLowerCase()
      );
    }

    if (intent) {
      candidates = candidates.filter(
        (u) => (u.intent || "").toLowerCase() === intent.toLowerCase()
      );
    }

    /* ============================================================
       🗺️ Distance filter (Fixed)
    ============================================================ */
    if (baseLat && baseLng && Number(range) > 0) {
      candidates = candidates.filter((u) => {
        if (!u.location?.lat || !u.location?.lng) return false; // ❌ FIX: used to return true
        const d = getDistanceMeters(baseLat, baseLng, u.location.lat, u.location.lng);
        return d <= Number(range);
      });
    }

    /* ============================================================
       🧠 Tier 2 — Lifestyle Filters
    ============================================================ */
    if (vibe && canFilterWithRequestedVibe) {
      candidates = candidates.filter(
        (u) => (u.vibe || "").toLowerCase() === requestedVibe
      );
    }

    if (interest) {
      candidates = candidates.filter((u) =>
        (u.interests || [])
          .map((x) => x.toLowerCase())
          .includes(interest.toLowerCase())
      );
    }

    if (blur) {
      candidates = candidates.filter((u) =>
        (u.favorites || []).includes(`blur:${blur}`)
      );
    }

    if (online) {
      const now = Date.now();
      candidates = candidates.filter((u) => {
        const last = u.lastActive || 0;
        if (online === "active") return now - last < 5 * 60 * 1000;
        if (online === "recent") return now - last < 60 * 60 * 1000;
        return true;
      });
    }

    /* ============================================================
       💎 Tier 3 — Premium Filters
    ============================================================ */
    if (verified === "true") {
      candidates = candidates.filter((u) => u.verified);
    }

    if (zodiac) {
      candidates = candidates.filter(
        (u) => (u.zodiac || "").toLowerCase() === zodiac.toLowerCase()
      );
    }

    if (love) {
      candidates = candidates.filter(
        (u) => (u.loveLanguage || "").toLowerCase() === love.toLowerCase()
      );
    }

    /* ============================================================
       ✨ Response Sanitization
    ============================================================ */
    const sanitize = (u) => {
      const hasLocation = !!(u.location?.lat && u.location?.lng);
      let distanceMeters = null;
      let distanceText = "—";

      if (hasLocation) {
        distanceMeters = Math.round(
          getDistanceMeters(baseLat, baseLng, u.location.lat, u.location.lng)
        );
        const miles = Math.max(1, Math.round(distanceMeters / 1609.34));
        distanceText = `${miles} mile${miles !== 1 ? "s" : ""} away`;
      }

      return {
        id: u.id,
        firstName: u.firstName,
        lastName: u.lastName,
        avatar: u.avatar || "https://via.placeholder.com/400x400?text=No+Photo",
        bio: u.bio || "",
        gender: u.gender || "",
        vibe: u.vibe || "",
        intent: u.intent || "",
        verified: u.verified || false,
        zodiac: u.zodiac || "",
        loveLanguage: u.loveLanguage || "",
        distanceMeters,
        distanceText,
        status: hasLocation ? "active" : "inactive",
      };
    };

    /* ============================================================
       🔢 Sort results (original logic unchanged)
    ============================================================ */
    const sorted = candidates
      .map(sanitize)
      .sort((a, b) => {
        if (a.status === "active" && b.status === "inactive") return -1;
        if (a.status === "inactive" && b.status === "active") return 1;
        if (a.distanceMeters === null && b.distanceMeters !== null) return 1;
        if (b.distanceMeters === null && a.distanceMeters !== null) return -1;
        if (a.distanceMeters !== null && b.distanceMeters !== null) {
          return a.distanceMeters - b.distanceMeters;
        }
        return 0;
      });

    res.json({ users: sorted });
  } catch (err) {
    console.error("❌ DISCOVER ERROR:", err);
    res.status(500).json({ error: "Internal error in /discover" });
  }
});

/* ============================================================
   Helper: Distance calculator
============================================================ */
function getDistanceMeters(lat1, lon1, lat2, lon2) {
  const R = 6371e3;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) *
      Math.cos(lat2 * Math.PI / 180) *
      Math.sin(dLon / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

module.exports = router;
