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
const Match = require("../models/Match");
const authMiddleware = require("../routes/auth-middleware");

const helpers = require("../utils/helpers");

const LOCAL_RESTRICTED_VALUES = new Set([
  "flirty",
  "chill",
  "timepass",
  "ons",
  "threesome",
  "onlyfans",
]);

const isRestricted =
  typeof helpers?.isRestricted === "function"
    ? helpers.isRestricted
    : (value = "") =>
        LOCAL_RESTRICTED_VALUES.has(
          String(value || "").toLowerCase().trim()
        );

const canUseRestricted =
  typeof helpers?.canUseRestricted === "function"
    ? helpers.canUseRestricted
    : (user = {}) => {
        const tier = String(user?.premiumTier || "").toLowerCase().trim();

        return !!(
          user?.isPremium ||
          user?.isVerified ||
          tier === "premium" ||
          tier === "gold" ||
          tier === "platinum"
        );
      };

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

    // 💖 Saved preferences (from Settings → Preferences)
    const prefs = self.preferences || {};
    const prefGender = (prefs.gender || "").toLowerCase();               // "male" | "female" | "everyone" | ""
    const prefAgeMin = Number(prefs.ageMin) || null;                     // e.g. 21
    const prefAgeMax = Number(prefs.ageMax) || null;                     // e.g. 35
    const prefDiscoverKm = Number(prefs.discoverDistanceKm) || null;     // e.g. 25

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

      // ✅ "Looking for" (your Discover intent filter)
      //    - omit or "all" = no filter
      lookingFor,
      phase, // "strict" | "fallback"

      interest,
      blur,
      online,
      verified,
      zodiac,
      love,

      relationshipStyle,
      bodyType,
      fitnessLevel,
      smoking,
      drinking,
      workoutFrequency,
      diet,
      sleepSchedule,
      educationLevel,
      travelStyle,
      petsPreference,
    } = req.query;

        /* ---------------------------
       2) Determine base location
       IMPORTANT:
       Discover distance must use fresh GPS from the phone.
       Do not use saved city/hometown/default coords for live distance.
    --------------------------- */
    const parsedLat = Number.parseFloat(lat);
    const parsedLng = Number.parseFloat(lng);

    const hasFreshViewerLocation =
      Number.isFinite(parsedLat) &&
      Number.isFinite(parsedLng) &&
      parsedLat >= -90 &&
      parsedLat <= 90 &&
      parsedLng >= -180 &&
      parsedLng <= 180;

    const baseLat = hasFreshViewerLocation ? parsedLat : null;
    const baseLng = hasFreshViewerLocation ? parsedLng : null;

    if (!hasFreshViewerLocation) {
      console.warn("⚠️ DISCOVER request missing fresh GPS. Distances will be hidden, not faked.");
    }

    // Always update lastActive.
    // Only overwrite saved location when the request has real fresh GPS.
    const updatePayload = {
      $set: {
        lastActive: Date.now(),
      },
    };

    if (hasFreshViewerLocation) {
      updatePayload.$set.location = { lat: baseLat, lng: baseLng };
    }

    await User.updateOne({ id: self.id }, updatePayload);

    /* ---------------------------
       3) Preload relationships
          - likes from me
          - blocks in either direction
    --------------------------- */
    const [likedDocs, blockDocs, matchDocs] = await Promise.all([
      Relationship.find({ from: self.id, type: "like" }).lean(),
      Relationship.find({
        type: "block",
        $or: [{ from: self.id }, { to: self.id }],
      }).lean(),
      Match.find({
        status: "matched",
        users: self.id,
      }).lean(),
    ]);

    const likedIds = likedDocs.map((d) => d.to);

    const blockedIds = blockDocs.map((d) =>
      d.from === self.id ? d.to : d.from
    );

    const matchedIds = matchDocs
      .map((doc) =>
        Array.isArray(doc?.users)
          ? doc.users.find((id) => String(id) !== String(self.id))
          : null
      )
      .filter(Boolean);

    const excludeIds = [
      ...new Set([...likedIds, ...blockedIds, ...matchedIds, self.id]),
    ];

    /* ---------------------------
       4) Base Mongo query (no distance yet)
    --------------------------- */
      const baseQuery = {
      id: { $nin: excludeIds },
      visibility: { $ne: "invisible" },
    };

    // Simple filters we can push into Mongo query
    if (gender) {
      // explicit URL override
      baseQuery.gender = new RegExp(`^${escapeRegex(gender)}$`, "i");
     } else if (prefGender && prefGender !== "everyone") {
      // 💗 default from saved preference
      baseQuery.gender = new RegExp(`^${escapeRegex(prefGender)}$`, "i");
    }

    // ✅ LookingFor filtering (STRICT) + Premium-only intents gate
    const requestedLookingFor = String(lookingFor || "").toLowerCase().trim();
    const phaseMode = String(phase || "strict").toLowerCase().trim();

    const PREMIUM_INTENTS = new Set(["ons", "threesome", "onlyfans"]);
    const allowPremiumIntents = canUseRestricted(me);

    const allowRequestedLookingFor =
      !requestedLookingFor ||
      requestedLookingFor === "all" ||
      !PREMIUM_INTENTS.has(requestedLookingFor) ||
      allowPremiumIntents;

    // Strict phase enforces the filter.
    // Fallback phase DOES NOT enforce it (it only boosts similarity).
    if (
      requestedLookingFor &&
      requestedLookingFor !== "all" &&
      phaseMode !== "fallback" &&
      allowRequestedLookingFor
    ) {
      baseQuery.lookingFor = new RegExp(
        `^${escapeRegex(requestedLookingFor)}$`,
        "i"
      );
    }

      if (requestedVibe && allowRequestedVibe) {
      baseQuery.vibe = requestedVibe;
    }

    if (verified === "true") {
      baseQuery.isVerified = true;
    }

    if (zodiac) {
      baseQuery.zodiac = new RegExp(`^${escapeRegex(zodiac)}$`, "i");
    }
        if (love) {
      baseQuery.loveLanguage = new RegExp(`^${escapeRegex(love)}$`, "i");
    }

    // Advanced filters apply only in strict mode.
    // Once client switches to fallback, these are relaxed automatically.
    if (phaseMode !== "fallback") {
      if (relationshipStyle) {
        baseQuery.relationshipStyle = new RegExp(
          `^${escapeRegex(relationshipStyle)}$`,
          "i"
        );
      }

      if (bodyType) {
        baseQuery.bodyType = new RegExp(`^${escapeRegex(bodyType)}$`, "i");
      }

      if (fitnessLevel) {
        baseQuery.fitnessLevel = new RegExp(
          `^${escapeRegex(fitnessLevel)}$`,
          "i"
        );
      }

      if (smoking) {
        baseQuery.smoking = new RegExp(`^${escapeRegex(smoking)}$`, "i");
      }

      if (drinking) {
        baseQuery.drinking = new RegExp(`^${escapeRegex(drinking)}$`, "i");
      }

      if (workoutFrequency) {
        baseQuery.workoutFrequency = new RegExp(
          `^${escapeRegex(workoutFrequency)}$`,
          "i"
        );
      }

      if (diet) {
        baseQuery.diet = new RegExp(`^${escapeRegex(diet)}$`, "i");
      }

      if (sleepSchedule) {
        baseQuery.sleepSchedule = new RegExp(
          `^${escapeRegex(sleepSchedule)}$`,
          "i"
        );
      }

      if (educationLevel) {
        baseQuery.educationLevel = new RegExp(
          `^${escapeRegex(educationLevel)}$`,
          "i"
        );
      }

      if (travelStyle) {
        baseQuery.travelStyle = new RegExp(
          `^${escapeRegex(travelStyle)}$`,
          "i"
        );
      }

      if (petsPreference) {
        baseQuery.petsPreference = new RegExp(
          `^${escapeRegex(petsPreference)}$`,
          "i"
        );
      }
    }

    // Reasonable upper bound to keep scoring cheap
    let candidates = await User.find(baseQuery).limit(400).lean();
    /* ---------------------------
       5) Compute distance + derive flags
    --------------------------- */
    const now = Date.now();
    candidates = candidates.map((u) => {
      let distanceMeters = null;

      const targetLocationLat = Number(u?.location?.lat);
      const targetLocationLng = Number(u?.location?.lng);
      const targetLegacyLat = Number(u?.latitude);
      const targetLegacyLng = Number(u?.longitude);

      const targetLat =
        Number.isFinite(targetLocationLat) && targetLocationLat >= -90 && targetLocationLat <= 90
          ? targetLocationLat
          : Number.isFinite(targetLegacyLat) && targetLegacyLat >= -90 && targetLegacyLat <= 90
          ? targetLegacyLat
          : null;

      const targetLng =
        Number.isFinite(targetLocationLng) && targetLocationLng >= -180 && targetLocationLng <= 180
          ? targetLocationLng
          : Number.isFinite(targetLegacyLng) && targetLegacyLng >= -180 && targetLegacyLng <= 180
          ? targetLegacyLng
          : null;

      if (
        hasFreshViewerLocation &&
        targetLat !== null &&
        targetLng !== null
      ) {
        distanceMeters = Math.round(
          getDistanceMeters(baseLat, baseLng, targetLat, targetLng)
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
           age / interest / blur / online
           + hidden visibilityMode
    --------------------------- */

    // 🎂 Age preference (from Settings → Preferences)
    if (prefAgeMin || prefAgeMax) {
      const minAge = prefAgeMin || 18;
      const maxAge = prefAgeMax || 120;

      candidates = candidates.filter((u) => {
        if (!u.dob) return true; // keep if we don't know their DOB
        const age = computeAge(u.dob);
        if (!age) return true;
        return age >= minAge && age <= maxAge;
      });
    }

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
          - start with requested, else saved preference, else 10km
          - 25km → 50km → 100km → global
    --------------------------- */
    let requestedRangeMeters;
    const rangeFromQuery = Number(range);

    if (rangeFromQuery > 0) {
      // Explicit override from client
      requestedRangeMeters = rangeFromQuery;
    } else if (prefDiscoverKm && prefDiscoverKm > 0) {
      // Saved preference (Settings → Preferences)
      requestedRangeMeters = prefDiscoverKm * 1000;
    } else {
      // Safe default
      requestedRangeMeters = 10_000; // 10km
    }

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

    const selfLookingFor = (self.lookingFor || "").toLowerCase();
    const selfVibe = (self.vibe || "").toLowerCase();

    const withScores = pool.map((u) => {

      let distanceScore = 0;
      if (typeof u.distanceMeters === "number") {
        const capped = Math.min(u.distanceMeters, 100_000); // 0..100km
        distanceScore = 1 - capped / 100_000; // closer → closer to 1
      }

        // ✅ LookingFor / Intent score
      // - In STRICT phase: results are already filtered, but keep a small boost anyway
      // - In FALLBACK phase: boost "closest match" (same lookingFor OR requestedLookingFor)
      let lookingForScore = 0;
      const uLookingFor = (u.lookingFor || "").toLowerCase();

      if (selfLookingFor && uLookingFor === selfLookingFor) {
        lookingForScore = 0.25;
      }

      if (
        requestedLookingFor &&
        requestedLookingFor !== "all" &&
        uLookingFor === requestedLookingFor
      ) {
        lookingForScore = Math.max(lookingForScore, 0.25);
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

      const verifiedScore = u.isVerified ? 0.05 : 0;

      // ✅ Extra similarity only when phase=fallback (after user exhausted strict pool)
      let fallbackSimilarity = 0;
      if (phaseMode === "fallback") {
        const eq = (a, b) =>
          String(a || "").toLowerCase() &&
          String(a || "").toLowerCase() === String(b || "").toLowerCase();

        if (eq(self.relationshipStyle, u.relationshipStyle)) fallbackSimilarity += 0.12;
        if (eq(self.fitnessLevel, u.fitnessLevel)) fallbackSimilarity += 0.06;
        if (eq(self.workoutFrequency, u.workoutFrequency)) fallbackSimilarity += 0.06;

        if (eq(self.smoking, u.smoking)) fallbackSimilarity += 0.05;
        if (eq(self.drinking, u.drinking)) fallbackSimilarity += 0.05;
        if (eq(self.sleepSchedule, u.sleepSchedule)) fallbackSimilarity += 0.05;

        if (eq(self.bodyType, u.bodyType)) fallbackSimilarity += 0.04;
        if (eq(self.travelStyle, u.travelStyle)) fallbackSimilarity += 0.04;
        if (eq(self.petsPreference, u.petsPreference)) fallbackSimilarity += 0.03;
      }

      const score =
        distanceScore * 0.5 +
        lookingForScore +
        vibeScore +
        interestsScore +
        hobbiesScore +
        onlineScore +
        verifiedScore +
        fallbackSimilarity;

      return { ...u, _score: score };

    });

    /* ---------------------------
       9) Sanitize + sort
    --------------------------- */
       const viewerUsesMiles = isUnitedStatesCountry(self?.country);

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

        const distanceText = hasLocation
          ? formatDiscoverDistanceText(u.distanceMeters, viewerUsesMiles)
          : "—";

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

          // ✅ keep both for backward-compat (mobile used to read "intent")
          lookingFor: u.lookingFor || "",
          intent: u.lookingFor || "",

          verified: !!u.isVerified,
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
          visibilityMode: u.visibilityMode || "full",
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
   Helper: Distance formatting + calculator
============================================================ */
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

function formatDiscoverDistanceText(distanceMeters, viewerUsesMiles = false) {
  const meters = Number(distanceMeters);

  if (!Number.isFinite(meters) || meters < 0) return "—";

  const rawDistance = viewerUsesMiles ? meters / 1609.34 : meters / 1000;
  const distanceValue = Math.max(1, Math.ceil(rawDistance));

  if (viewerUsesMiles) {
    return `${distanceValue} mile${distanceValue === 1 ? "" : "s"} away`;
  }

  return `${distanceValue} km away`;
}

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

// Simple DOB → age helper (supports "mm/dd/yyyy" or ISO/Date-parsable)
function computeAge(dobStr) {
  if (!dobStr) return null;

  let d;
  const raw = String(dobStr).trim();

  // mm/dd/yyyy (your signup format)
  if (raw.includes("/")) {
    const parts = raw.split(/[\/\-]/).map((n) => parseInt(n, 10));
    if (parts.length !== 3) return null;
    const [month, day, year] = parts;
    if (!month || !day || !year) return null;
    d = new Date(year, month - 1, day);
  } else {
    // fallback for "YYYY-MM-DD" or ISO strings
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
