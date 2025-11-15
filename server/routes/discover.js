/**
 * ============================================================
 * 📁 File: routes/discover.js
 * 💫 Purpose: Discover nearby users using hybrid scoring
 *             (distance + compatibility) with smart fallbacks.
 *
 * Endpoint:
 *   GET /api/discover
 *
 * Behavior:
 *   1) Uses MongoDB User + Relationship models (no LowDB).
 *   2) Always uses the best available location:
 *        - query ?lat & ?lng
 *        - else saved user.location
 *        - else DEV_DEFAULT_LAT/LNG fallback
 *   3) Filters out:
 *        - yourself
 *        - invisible users
 *        - users you already liked
 *        - users you or they have blocked
 *   4) Applies filters (gender, intent, vibe, interest, etc).
 *   5) Applies **Option A** fallback distance pools:
 *        requested (or 10km) → 25km → 50km → 100km → global
 *   6) Ranks remaining users with a hybrid score:
 *        distance + shared interests/hobbies + intent + vibe
 *        + online status + verification.
 *
 * Dependencies:
 *   - models/User.js
 *   - models/Relationship.js
 *   - routes/auth-middleware.js
 *   - utils/helpers.js (isRestricted, canUseRestricted)
 * ============================================================
 */

const express = require("express");
const router = express.Router();

const User = require("../models/User");
const Relationship = require("../models/Relationship");
const authMiddleware = require("../routes/auth-middleware");
const { isRestricted, canUseRestricted } = require("../utils/helpers");

/* ============================================================
   GET /api/discover
============================================================ */
router.get("/", authMiddleware, async (req, res) => {
  try {
    /* ---------------------------
       1) Load current user
    --------------------------- */
    const self = await User.findOne({ id: req.user.id }).lean();
    if (!self) return res.status(404).json({ error: "User not found" });

    const me = self;

    const requestedVibe = String(req.query.vibe || "").toLowerCase();
    let allowRequestedVibe = true;

    // Restricted vibes require premium/verified gate
    if (requestedVibe && isRestricted(requestedVibe) && !canUseRestricted(me)) {
      allowRequestedVibe = false;
    }

    const {
      lat,
      lng,
      range, // may be undefined – we’ll apply fallbacks
      gender,
      intent,
      interest,
      blur,
      online,
      verified,
      zodiac,
      love,
    } = req.query;

    /* ---------------------------
       2) Determine base location
    --------------------------- */
    let baseLat = parseFloat(lat);
    let baseLng = parseFloat(lng);

    if (isNaN(baseLat) || isNaN(baseLng)) {
      // use saved location if present
      if (self.location?.lat && self.location?.lng) {
        baseLat = self.location.lat;
        baseLng = self.location.lng;
        console.log("📍 Using last known location:", self.location);
      } else {
        // final fallback
        baseLat = Number(process.env.DEV_DEFAULT_LAT || 41.8781);
        baseLng = Number(process.env.DEV_DEFAULT_LNG || -87.6298);
        console.warn("⚠️ DISCOVER fallback coords used (no GPS)");
      }
    }

    // Always update own location + lastActive
    await User.updateOne(
      { id: self.id },
      {
        $set: {
          location: { lat: baseLat, lng: baseLng },
          lastActive: Date.now(),
        },
      }
    );

    /* ---------------------------
       3) Preload relationships
          - likes from me
          - blocks in either direction
    --------------------------- */
    const [likedDocs, blockDocs] = await Promise.all([
      Relationship.find({ from: self.id, type: "like" }).lean(),
      Relationship.find({
        type: "block",
        $or: [{ from: self.id }, { to: self.id }],
      }).lean(),
    ]);

    const likedIds = likedDocs.map((d) => d.to);

    const blockedIds = blockDocs.map((d) =>
      d.from === self.id ? d.to : d.from
    );

    const excludeIds = [...new Set([...likedIds, ...blockedIds, self.id])];

    /* ---------------------------
       4) Base Mongo query (no distance yet)
    --------------------------- */
    const baseQuery = {
      id: { $nin: excludeIds },
      visibility: { $ne: "invisible" },
    };

    // Simple filters we can push into Mongo query
    if (gender) {
      baseQuery.gender = new RegExp(`^${escapeRegex(gender)}$`, "i");
    }
    if (intent) {
      baseQuery.intent = new RegExp(`^${escapeRegex(intent)}$`, "i");
    }

    if (requestedVibe && allowRequestedVibe) {
      baseQuery.vibe = requestedVibe;
    }

    if (verified === "true") {
      baseQuery.verified = true;
    }

    if (zodiac) {
      baseQuery.zodiac = new RegExp(`^${escapeRegex(zodiac)}$`, "i");
    }
    if (love) {
      baseQuery.loveLanguage = new RegExp(`^${escapeRegex(love)}$`, "i");
    }

    // Reasonable upper bound to keep scoring cheap
    let candidates = await User.find(baseQuery).limit(400).lean();

    /* ---------------------------
       5) Compute distance + derive flags
    --------------------------- */
    const now = Date.now();
    candidates = candidates.map((u) => {
      let distanceMeters = null;
      if (u.location?.lat && u.location?.lng) {
        distanceMeters = Math.round(
          getDistanceMeters(baseLat, baseLng, u.location.lat, u.location.lng)
        );
      }

      const lastActive = u.lastActive || 0;
      const diff = now - lastActive;
      let status = "inactive";
      if (diff < 5 * 60 * 1000) status = "active";
      else if (diff < 60 * 60 * 1000) status = "recent";

      return { ...u, distanceMeters, _lastActive: lastActive, _status: status };
    });

    /* ---------------------------
       6) Apply non-distance filters
           interest / blur / online
           + hidden visibilityMode
    --------------------------- */
    if (interest) {
      const interestLower = String(interest).toLowerCase();
      candidates = candidates.filter((u) =>
        (u.interests || [])
          .map((x) => String(x).toLowerCase())
          .includes(interestLower)
      );
    }

    if (blur) {
      candidates = candidates.filter((u) =>
        (u.favorites || []).includes(`blur:${blur}`)
      );
    }

    if (online) {
      candidates = candidates.filter((u) => {
        if (online === "active") return u._status === "active";
        if (online === "recent")
          return u._status === "active" || u._status === "recent";
        return true;
      });
    }

    // Hide users who explicitly set visibilityMode = "hidden"
    candidates = candidates.filter(
      (u) => (u.visibilityMode || "auto") !== "hidden"
    );

    /* ---------------------------
       7) Apply Option A fallback
          distance pools
          - start with requested or 10km
          - 25km → 50km → 100km → global
    --------------------------- */
    const requestedRangeMeters =
      Number(range) > 0 ? Number(range) : 10_000; // 10km default

    const radiusSteps = [
      requestedRangeMeters,
      25_000,
      50_000,
      100_000,
      null, // null = global, ignore distance
    ];

    let pool = [];
    let chosenRadius = null;

    for (const radius of radiusSteps) {
      let subset = candidates;

      if (radius != null) {
        subset = candidates.filter(
          (u) =>
            typeof u.distanceMeters === "number" &&
            u.distanceMeters <= radius
        );
      }

      if (subset.length > 0) {
        pool = subset;
        chosenRadius = radius;
        break;
      }
    }

    if (chosenRadius) {
      console.log(
        `🔎 Discover using radius ${Math.round(chosenRadius / 1000)}km, users: ${pool.length}`
      );
    } else {
      console.log(
        `🔎 Discover using global pool (no distance limit), users: ${pool.length}`
      );
    }

    /* ---------------------------
       8) Hybrid scoring
          - distance (closer better)
          - same intent / vibe
          - overlap in interests + hobbies
          - online / recent
          - verified
    --------------------------- */
    const selfInterests = new Set(
      (self.interests || []).map((x) => String(x).toLowerCase())
    );
    const selfHobbies = new Set(
      (self.hobbies || []).map((x) => String(x).toLowerCase())
    );
    const selfIntent = (self.intent || "").toLowerCase();
    const selfVibe = (self.vibe || "").toLowerCase();

    const withScores = pool.map((u) => {
      let distanceScore = 0;
      if (typeof u.distanceMeters === "number") {
        const capped = Math.min(u.distanceMeters, 100_000); // 0..100km
        distanceScore = 1 - capped / 100_000; // closer → closer to 1
      }

      let intentScore = 0;
      if (selfIntent && (u.intent || "").toLowerCase() === selfIntent) {
        intentScore = 0.3;
      }

      let vibeScore = 0;
      if (selfVibe && (u.vibe || "").toLowerCase() === selfVibe) {
        vibeScore = 0.2;
      }

      let interestsScore = 0;
      if (selfInterests.size && Array.isArray(u.interests)) {
        let overlap = 0;
        for (const it of u.interests) {
          if (selfInterests.has(String(it).toLowerCase())) overlap++;
        }
        interestsScore = Math.min(0.3, overlap * 0.1);
      }

      let hobbiesScore = 0;
      if (selfHobbies.size && Array.isArray(u.hobbies)) {
        let overlap = 0;
        for (const it of u.hobbies) {
          if (selfHobbies.has(String(it).toLowerCase())) overlap++;
        }
        hobbiesScore = Math.min(0.2, overlap * 0.1);
      }

      let onlineScore = 0;
      if (u._status === "active") onlineScore = 0.2;
      else if (u._status === "recent") onlineScore = 0.1;

      const verifiedScore = u.verified ? 0.05 : 0;

      const score =
        distanceScore * 0.5 +
        intentScore +
        vibeScore +
        interestsScore +
        hobbiesScore +
        onlineScore +
        verifiedScore;

      return { ...u, _score: score };
    });

    /* ---------------------------
       9) Sanitize + sort
    --------------------------- */
    const sorted = withScores
      .sort((a, b) => {
        // higher score first
        if (b._score !== a._score) return b._score - a._score;

        // then closer distance
        if (a.distanceMeters != null && b.distanceMeters != null) {
          return a.distanceMeters - b.distanceMeters;
        }

        // then most recently active
        return (b._lastActive || 0) - (a._lastActive || 0);
      })
      .map((u) => {
        const hasLocation =
          typeof u.distanceMeters === "number" && u.distanceMeters >= 0;

        let distanceText = "—";
        if (hasLocation) {
          const miles = Math.max(
            1,
            Math.round(u.distanceMeters / 1609.34)
          );
          distanceText = `${miles} mile${miles !== 1 ? "s" : ""} away`;
        }

        return {
          id: u.id,
          firstName: u.firstName,
          lastName: u.lastName,
          avatar:
            u.avatar ||
            "https://via.placeholder.com/400x400?text=No+Photo",
          bio: u.bio || "",
          gender: u.gender || "",
          vibe: u.vibe || "",
          intent: u.intent || "",
          verified: !!u.verified,
          zodiac: u.zodiac || "",
          loveLanguage: u.loveLanguage || "",
          distanceMeters: hasLocation ? u.distanceMeters : null,
          distanceText,
          status: u._status || "inactive",

          // extra fields used by Discover → ViewProfile preview
          media: u.media || [],
          dob: u.dob || null,
          height: u.height || null,
          city: u.city || "",
          orientation: u.orientation || "",
          interests: u.interests || [],
          hobbies: u.hobbies || [],
          favorites: u.favorites || [],
          visibilityMode: u.visibilityMode || "auto",
          fieldVisibility: u.fieldVisibility || {},

          // debug / tuning (safe to ignore on frontend)
          _score: u._score,
        };
      });

    return res.json({ users: sorted });
  } catch (err) {
    console.error("❌ DISCOVER ERROR:", err);
    res.status(500).json({ error: "Internal error in /discover" });
  }
});

/* ============================================================
   Helper: Distance calculator (Haversine, meters)
============================================================ */
function getDistanceMeters(lat1, lon1, lat2, lon2) {
  const R = 6371e3; // metres
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

// Escape regex special chars for safe query building
function escapeRegex(str = "") {
  return String(str).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

module.exports = router;
