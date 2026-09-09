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
const multer = require("multer");
const upload = multer({ dest: "uploads/" });
const authMiddleware = require("../routes/auth-middleware");
const {
  ensureFeatureAllowed,
  sendFeatureRestrictionError,
} = require("../utils/moderation");
const {
  buildR2Key,
  cleanupTempFile,
  deleteR2Object,
  getSignedMediaUrl,
  isR2Key,
  uploadFileToR2,
  validateMediaFile,
} = require("../utils/r2Media");

// ✅ Shared Socket.IO access
const { getIO } = require("../socket");

// Mongo + models
const User = require("../models/User");
const MicroBuzzPresence = require("../models/MicroBuzzPresence");
const MicroBuzzBuzz = require("../models/MicroBuzzBuzz");
const Match = require("../models/Match");
const Relationship = require("../models/Relationship");

const {
  getIncomingBuzzQueue,
} = require("../services/microbuzzQueueService");

const {
  clearSessionIgnores,
  getIgnoredIdsForCurrentSession,
  ignoreForCurrentSession,
  isIgnoredForCurrentSession,
  resolveSessionId,
} = require("../services/microbuzzSessionService");

// 🔔 Notifications helper
const { sendNotification } = require("../utils/helpers");

async function enforceMicroBuzzAllowed(req, res) {
  try {
    await ensureFeatureAllowed(req.user.id, "microbuzz");
    return true;
  } catch (err) {
    sendFeatureRestrictionError(res, err);
    return false;
  }
}

function normalizeMediaString(value = "") {
  return String(value || "").trim();
}

const MICROBUZZ_SELFIE_TTL_MS = 5 * 60 * 1000;
const MICROBUZZ_SELFIE_SIGN_SECONDS = 5 * 60;
const MICROBUZZ_CLEANUP_INTERVAL_MS = 60 * 1000;
let lastMicroBuzzCleanupAt = 0;

function isMicroBuzzR2SelfieKey(value = "") {
  return normalizeMediaString(value).startsWith("microbuzz-selfies/");
}

async function deleteMicroBuzzSelfieBestEffort(key, context = "") {
  const cleanKey = normalizeMediaString(key);

  if (!isMicroBuzzR2SelfieKey(cleanKey)) {
    return false;
  }

  try {
    await deleteR2Object(cleanKey);
    return true;
  } catch (err) {
    console.warn(
      `⚠️ MicroBuzz selfie R2 delete failed${context ? ` (${context})` : ""}:`,
      err?.message || err
    );
    return false;
  }
}

function scheduleMicroBuzzSelfieDelete(key) {
  const cleanKey = normalizeMediaString(key);

  if (!isMicroBuzzR2SelfieKey(cleanKey)) {
    return;
  }

  const timer = setTimeout(() => {
    deleteMicroBuzzSelfieBestEffort(cleanKey, "ttl_timer");
  }, MICROBUZZ_SELFIE_TTL_MS);

  if (typeof timer.unref === "function") {
    timer.unref();
  }
}

async function cleanupExpiredMicroBuzzPresences() {
  const now = Date.now();

  if (
    now - lastMicroBuzzCleanupAt <
    MICROBUZZ_CLEANUP_INTERVAL_MS
  ) {
    return;
  }

  lastMicroBuzzCleanupAt = now;

  const expiredBefore = new Date(
    now - MICROBUZZ_SELFIE_TTL_MS
  );

  const expired = await MicroBuzzPresence.find({
    updatedAt: { $lt: expiredBefore },
    selfieUrl: /^microbuzz-selfies\//,
  })
    .select("userId selfieUrl")
    .lean();

  if (expired.length) {
    await Promise.all(
      expired.map((presence) =>
        deleteMicroBuzzSelfieBestEffort(
          presence.selfieUrl,
          `expired_presence:${presence.userId}`
        )
      )
    );
  }

  await MicroBuzzPresence.deleteMany({
    updatedAt: { $lt: expiredBefore },
  });
}

async function signMicroBuzzSelfieValue(value, expiresInSeconds = MICROBUZZ_SELFIE_SIGN_SECONDS) {
  const raw = normalizeMediaString(value);
  if (!raw) return "";

  // Keep old Cloudinary / public URLs working.
  if (!isR2Key(raw)) return raw;

  return getSignedMediaUrl(raw, expiresInSeconds);
}

async function signMicroBuzzPresence(presence = {}, expiresInSeconds = 21600) {
  if (!presence) return presence;

  return {
    ...presence,
    selfieUrl: await signMicroBuzzSelfieValue(
      presence.selfieUrl,
      expiresInSeconds
    ),
  };
}

async function buildIncomingBuzzPayload(fromId) {
  const cutoff = new Date(
    Date.now() - MICROBUZZ_SELFIE_TTL_MS
  );

  const [profile, presence] = await Promise.all([
    User.findOne({
      id: fromId,
      visibility: { $ne: "pending_delete" },
      deleteStatus: { $ne: "pending_delete" },
    })
      .select("id firstName lastName dob")
      .lean(),

    MicroBuzzPresence.findOne({
      userId: fromId,
      updatedAt: { $gte: cutoff },
    }).lean(),
  ]);

  if (!profile || !presence) return null;

  const firstName =
    profile.firstName || "Someone";

  const lastName =
    profile.lastName || "";

  const name =
    [firstName, lastName]
      .filter(Boolean)
      .join(" ")
      .trim();

  return {
    fromId: String(fromId),
    firstName,
    lastName,
    name,
    dob: profile.dob || "",

    selfieUrl:
      await signMicroBuzzSelfieValue(
        presence.selfieUrl,
        MICROBUZZ_SELFIE_SIGN_SECONDS
      ),

    message:
      `${firstName} wants to match with you!`,

    type: "microbuzz",
  };
}

/* ============================================================
   📸 SELFIE UPLOAD
============================================================ */
router.post("/selfie", authMiddleware, upload.single("selfie"), async (req, res) => {
  try {
    if (!(await enforceMicroBuzzAllowed(req, res))) return;

    if (!req.file) {
      return res.status(400).json({ error: "No selfie provided" });
    }

    validateMediaFile(req.file, { kind: "avatar" });

    const key = buildR2Key({
      folder: "microbuzz-selfies",
      userId: req.user.id,
      file: req.file,
    });

    const uploaded = await uploadFileToR2({
      file: req.file,
      key,
      contentType: req.file.mimetype || "image/jpeg",
    });

     const signedUrl = await getSignedMediaUrl(
      uploaded.key,
      MICROBUZZ_SELFIE_SIGN_SECONDS
    );

    scheduleMicroBuzzSelfieDelete(uploaded.key);

    res.json({
      success: true,
      url: signedUrl,
      signedUrl,
      key: uploaded.key,
      r2Key: uploaded.key,
      storage: "r2",
      provider: "r2",
      expiresAt: new Date(Date.now() + MICROBUZZ_SELFIE_TTL_MS).toISOString(),
      ttlSeconds: MICROBUZZ_SELFIE_SIGN_SECONDS,
      contentType: uploaded.contentType,
      size: uploaded.size,
    });
  } catch (err) {
    console.error("❌ MicroBuzz selfie upload failed:", err);
    res.status(500).json({ error: err?.message || "Upload failed" });
  } finally {
    cleanupTempFile(req.file?.path);
  }
});

/* ============================================================
   ⚡ ACTIVATE PRESENCE
============================================================ */
router.post("/activate", authMiddleware, async (req, res) => {
  try {
    if (!(await enforceMicroBuzzAllowed(req, res))) return;

    const { lat, lng, selfieUrl } = req.body || {};
    const latNum = parseFloat(lat);
    const lngNum = parseFloat(lng);
    const userId = req.user.id;

    if (isNaN(latNum) || isNaN(lngNum) || !selfieUrl) {
      return res.status(400).json({ error: "Invalid or missing lat/lng/selfieUrl" });
    }

    const storedSelfieValue =
      normalizeMediaString(selfieUrl);

    const existingPresence =
      await MicroBuzzPresence.findOne({
        userId,
      })
        .select("sessionId updatedAt")
        .lean();

    const sessionId =
      resolveSessionId(
        existingPresence
      );

    const storedLat =
      latNum;

    const storedLng =
      lngNum;

    await MicroBuzzPresence.findOneAndUpdate(
      { userId },
      {
        userId,
        sessionId,
        selfieUrl: storedSelfieValue,
        lat: storedLat,
        lng: storedLng,

        location: {
          type: "Point",
          coordinates: [
            storedLng,
            storedLat,
          ],
        },

        updatedAt: new Date(),
      },
      { upsert: true }
    );

    res.json({
      success: true,
      sessionId,
      selfieUrl: await signMicroBuzzSelfieValue(storedSelfieValue, 21600),
      r2Key: isR2Key(storedSelfieValue) ? storedSelfieValue : "",
      storage: isR2Key(storedSelfieValue) ? "r2" : "legacy",
    });
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
    if (!(await enforceMicroBuzzAllowed(req, res))) return;

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

      const prefs =
      self.preferences || {};

    const requestedGender =
      String(
        req.query.gender || ""
      ).toLowerCase();

    const prefGender =
      [
        "male",
        "female",
        "everyone",
      ].includes(
        requestedGender
      )
        ? requestedGender
        : String(
            prefs.gender || ""
          ).toLowerCase();

    const prefAgeMin =
      Number(prefs.ageMin) ||
      null;

    const prefAgeMax =
      Number(prefs.ageMax) ||
      null;

    // MicroBuzz is always capped at a true 100m.
    const requestedRadiusKm =
      parseFloat(
        req.query.radius ||
          "0.1"
      );

    const radiusKm =
      Math.min(
        Number.isFinite(
          requestedRadiusKm
        )
          ? Math.max(
              requestedRadiusKm,
              0
            )
          : 0.1,
        0.1
      );

    const [
      blockDocs,
      ignoredIds,
    ] =
      await Promise.all([
        Relationship.find({
          type: "block",

          $or: [
            {
              from:
                userId,
            },
            {
              to:
                userId,
            },
          ],
        })
          .select("from to")
          .lean(),

        getIgnoredIdsForCurrentSession(
          userId
        ),
      ]);

    const blockedIds =
      blockDocs.map(
        (row) =>
          String(
            row.from
          ) ===
          String(userId)
            ? String(
                row.to
              )
            : String(
                row.from
              )
      );

    const excludedIds = [
      ...new Set([
        userId,
        ...blockedIds,
        ...ignoredIds,
      ]),
    ];

    await cleanupExpiredMicroBuzzPresences();

    const fiveMinutesAgo =
      new Date(
        Date.now() -
          MICROBUZZ_SELFIE_TTL_MS
      );

    const radiusMeters =
      radiusKm * 1000;

    // MongoDB performs the actual distance search.
    // This uses the full real radius instead of loading
    // every active MicroBuzz user into Node.
    const allActive =
      await MicroBuzzPresence.aggregate([
        {
          $geoNear: {
            near: {
              type: "Point",
              coordinates: [
                lng,
                lat,
              ],
            },

            key: "location",
            distanceField:
              "distanceMeters",

            maxDistance:
              radiusMeters,

            spherical: true,

            query: {
              updatedAt: {
                $gte:
                  fiveMinutesAgo,
              },

              userId: {
                $nin:
                  excludedIds,
              },
            },
          },
        },

        {
          $project: {
            _id: 0,
            userId: 1,
            selfieUrl: 1,
            distanceMeters: 1,
          },
        },
      ]);

    if (!allActive.length) {
      return res.json({
        users: [],
      });
    }

    // 🔎 Load only profiles that are still visible/active in the product.
    const candidateIds = [...new Set(allActive.map((u) => u.userId))];
    const candidateUsers = await User.find({
      id: { $in: candidateIds },
      visibility: { $ne: "pending_delete" },
      deleteStatus: { $ne: "pending_delete" },
    })
      .select("id gender dob")
      .lean();

    const usersById =
      new Map(
        candidateUsers.map(
          (u) => [u.id, u]
        )
      );

    const rawUsers = allActive
      .map((presence) => ({
        id:
          presence.userId,

        selfieUrl:
          presence.selfieUrl,

        distanceMeters:
          Number(
            presence.distanceMeters
          ) || 0,

        _user:
          usersById.get(
            presence.userId
          ) || null,
      }))

      // Drop orphaned / pending-delete presences.
      .filter(
        (item) =>
          Boolean(item._user)
      )

      // Gender preference filter
      .filter((item) => {
        const u = item._user;
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

    const users = await Promise.all(
      rawUsers.map(async (item) => ({
        ...item,
        selfieUrl: await signMicroBuzzSelfieValue(item.selfieUrl, 21600),
        r2Key: isR2Key(item.selfieUrl) ? item.selfieUrl : "",
        storage: isR2Key(item.selfieUrl) ? "r2" : "legacy",
      }))
    );

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
    const presence = await MicroBuzzPresence.findOne({
      userId: req.user.id,
    }).lean();

    await Promise.all([
      MicroBuzzPresence.deleteOne({
        userId: req.user.id,
      }),

      clearSessionIgnores(
        req.user.id,
        presence?.sessionId
      ),
    ]);

    if (presence?.selfieUrl) {
      await deleteMicroBuzzSelfieBestEffort(
        presence.selfieUrl,
        `deactivate:${req.user.id}`
      );
    }

    res.json({ success: true });
  } catch (err) {
    console.error("❌ /api/microbuzz/deactivate error:", err);
    res.status(500).json({ error: "Deactivate failed" });
  }
});

/* ============================================================
   💌 RECOVER INCOMING BUZZ QUEUE
============================================================ */
router.get(
  "/incoming",
  authMiddleware,
  async (req, res) => {
    try {
      if (
        !(
          await enforceMicroBuzzAllowed(
            req,
            res
          )
        )
      ) {
        return;
      }

      const requests =
        await getIncomingBuzzQueue({
          userId:
            req.user.id,

          signSelfie:
            (value) =>
              signMicroBuzzSelfieValue(
                value,
                MICROBUZZ_SELFIE_SIGN_SECONDS
              ),
        });

      return res.json({
        request:
          requests[0] ||
          null,

        requests,

        pendingCount:
          requests.length,
      });
    } catch (err) {
      console.error(
        "❌ /api/microbuzz/incoming error:",
        err
      );

      return res
        .status(500)
        .json({
          error:
            "Incoming Buzz fetch failed",
        });
    }
  }
);

/* ============================================================
   💞 BUZZ REQUEST + ACCEPT / REJECT / IGNORE
============================================================ */
router.post("/buzz", authMiddleware, async (req, res) => {
  try {
    if (!(await enforceMicroBuzzAllowed(req, res))) return;

    const io = getIO();

    const {
      toId,
      confirm,
    } = req.body || {};

    const fromId =
      req.user.id;

    if (!toId) {
      return res.status(400).json({
        error: "toId required",
      });
    }

    if (
      String(toId) ===
      String(fromId)
    ) {
      return res.status(400).json({
        error:
          "Cannot Buzz yourself",
      });
    }

    const targetUser =
      await User.findOne({
        id: toId,

        visibility: {
          $ne: "pending_delete",
        },

        deleteStatus: {
          $ne: "pending_delete",
        },
      })
        .select(
          "id firstName"
        )
        .lean();

    if (!targetUser) {
      return res.status(404).json({
        error: "User not found",
      });
    }

    const [
      blocked,
      suppressedForSession,
    ] =
      await Promise.all([
        Relationship.exists({
          type: "block",

          $or: [
            {
              from:
                fromId,
              to:
                toId,
            },
            {
              from:
                toId,
              to:
                fromId,
            },
          ],
        }),

        isIgnoredForCurrentSession(
          toId,
          fromId
        ),
      ]);

    if (blocked) {
      return res.status(404).json({
        error:
          "User unavailable",
      });
    }

    // Do not reveal to Jake that Katy ignored him.
    if (
      suppressedForSession &&
      confirm === undefined
    ) {
      return res.json({
        success: true,
        pending: true,
      });
    }

    const alreadyMatched =
      await Match.findOne({
        users: {
          $all: [
            fromId,
            toId,
          ],
        },
      }).lean();

    if (alreadyMatched) {
      const otherPresence =
        await MicroBuzzPresence
          .findOne({
            userId: toId,
          })
          .lean();

      return res.json({
        matched: true,
        alreadyMatched: true,

        otherUserId:
          String(toId),

        otherName:
          targetUser.firstName ||
          "Someone",

        selfieUrl:
          await signMicroBuzzSelfieValue(
            otherPresence?.selfieUrl,
            MICROBUZZ_SELFIE_SIGN_SECONDS
          ),

        roomId:
          [fromId, toId]
            .sort()
            .join("_"),

        via: "microbuzz",
      });
    }

    const reverseBuzz =
      await MicroBuzzBuzz.findOne({
        fromId: toId,
        toId: fromId,
      }).lean();

    if (reverseBuzz) {
      if (confirm === "ignore") {
        await ignoreForCurrentSession(
          fromId,
          toId
        );

        await MicroBuzzBuzz.deleteMany({
          $or: [
            {
              fromId,
              toId,
            },
            {
              fromId: toId,
              toId: fromId,
            },
          ],
        });

        return res.json({
          ignored: true,
        });
      }

      if (confirm === false) {
        await MicroBuzzBuzz.deleteMany({
          $or: [
            {
              fromId,
              toId,
            },
            {
              fromId: toId,
              toId: fromId,
            },
          ],
        });

        return res.json({
          rejected: true,
        });
      }

      if (confirm !== true) {
        const request =
          await buildIncomingBuzzPayload(
            toId
          );

        return res.json({
          pending: true,
          requiresConfirm: true,
          request,
        });
      }

      await MicroBuzzBuzz.deleteMany({
        $or: [
          {
            fromId,
            toId,
          },
          {
            fromId: toId,
            toId: fromId,
          },
        ],
      });

      const exists =
        await Match.findOne({
          users: {
            $all: [
              fromId,
              toId,
            ],
          },
        });

      if (!exists) {
        await Match.create({
          id:
            `${fromId}_${toId}_${Date.now()}`,

          users: [
            fromId,
            toId,
          ],

          status:
            "matched",

          createdAt:
            new Date(),
        });
      }

      const [
        fromProfile,
        toProfile,
        fromPresence,
        toPresence,
      ] = await Promise.all([
        User.findOne({
          id: fromId,
        })
          .select("firstName")
          .lean(),

        User.findOne({
          id: toId,
        })
          .select("firstName")
          .lean(),

        MicroBuzzPresence
          .findOne({
            userId: fromId,
          })
          .lean(),

        MicroBuzzPresence
          .findOne({
            userId: toId,
          })
          .lean(),
      ]);

      const fromName =
        fromProfile?.firstName ||
        "Someone";

      const toName =
        toProfile?.firstName ||
        "Someone";

      const roomId =
        [fromId, toId]
          .sort()
          .join("_");

      const [
        fromSelfie,
        toSelfie,
      ] = await Promise.all([
        signMicroBuzzSelfieValue(
          fromPresence?.selfieUrl,
          MICROBUZZ_SELFIE_SIGN_SECONDS
        ),

        signMicroBuzzSelfieValue(
          toPresence?.selfieUrl,
          MICROBUZZ_SELFIE_SIGN_SECONDS
        ),
      ]);

      const forAccepter = {
        otherUserId:
          String(toId),

        otherName:
          toName,

        selfieUrl:
          toSelfie,

        roomId,
        via: "microbuzz",
      };

      const forSender = {
        otherUserId:
          String(fromId),

        otherName:
          fromName,

        selfieUrl:
          fromSelfie,

        roomId,
        via: "microbuzz",
      };

      // Send through private user rooms.
      io.to(
        String(fromId)
      ).emit(
        "match",
        forAccepter
      );

      io.to(
        String(toId)
      ).emit(
        "match",
        forSender
      );

      try {
        await Promise.all([
          sendNotification(
            fromId,
            {
              type: "match",
              fromId: toId,
              via: "microbuzz",

              message:
                `You and ${toName} matched with each other 💞`,

              href:
                `/viewProfile/${toId}`,

              entity:
                "chat",

              entityId:
                roomId,
            }
          ),

          sendNotification(
            toId,
            {
              type: "match",
              fromId,
              via: "microbuzz",

              message:
                `You and ${fromName} matched with each other 💞`,

              href:
                `/viewProfile/${fromId}`,

              entity:
                "chat",

              entityId:
                roomId,
            }
          ),
        ]);
      } catch (e) {
        console.warn(
          "❌ MicroBuzz match notification failed:",
          e
        );
      }

      return res.json({
        matched: true,
        ...forAccepter,
      });
    }

    if (
      confirm === true ||
      confirm === false ||
      confirm === "ignore"
    ) {
      return res.status(409).json({
        error:
          "Buzz request is no longer pending",
      });
    }

    const existingOutgoing =
      await MicroBuzzBuzz.findOne({
        fromId,
        toId,
      }).lean();

    if (existingOutgoing) {
      return res.json({
        pending: true,
        alreadyLiked: true,
      });
    }

    await MicroBuzzBuzz.create({
      fromId,
      toId,
      time: new Date(),
    });

    const request =
      await buildIncomingBuzzPayload(
        fromId
      );

    if (!request) {
      await MicroBuzzBuzz.deleteOne({
        fromId,
        toId,
      });

      return res.status(409).json({
        error:
          "MicroBuzz presence expired",
      });
    }

    try {
      await sendNotification(
        toId,
        {
          fromId,
          type: "buzz",
          via: "microbuzz",

          message:
            `${request.firstName} wants to buzz you!`,

          href:
            `/viewProfile/${fromId}`,
        }
      );
    } catch (e) {
      console.warn(
        "MicroBuzz one-way notification failed:",
        e
      );
    }

    io.to(
      String(toId)
    ).emit(
      "buzz_request",
      request
    );

    return res.json({
      success: true,
      pending: true,
    });
  } catch (err) {
    console.error(
      "❌ /api/microbuzz/buzz error:",
      err
    );

    return res.status(500).json({
      error: "Buzz failed",
    });
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
