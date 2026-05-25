/**
 * ============================================================
 * 📁 File: routes/meetMiddle.js
 * 🧩 Purpose: Protected HTTP API routes for RomBuzz
 *             Meet in the Middle.
 *
 * Backend flow:
 *   Mobile/Web client
 *     → /api/meet-middle/*
 *     → routes/meetMiddle.js
 *     → services/meetMiddleService.js
 *     → MongoDB + Geoapify service
 *
 * Important:
 *   - MongoDB only.
 *   - No LowDB.
 *   - No old /api/meet route.
 *   - No Geoapify key exposed to frontend.
 *   - No socket listener logic in this file.
 * ============================================================
 */

const express = require("express");
const router = express.Router();

const authMiddleware = require("./auth-middleware");

const {
  createMeetRequest,
  declineMeetRequest,
  shareLocationAndBuildSuggestions,
  selectPlace,
  acceptSelectedPlace,
  rejectSelectedPlace,
  cancelSession,
  completeSession,
} = require("../services/meetMiddleService");

const {
  getGeoapifyHealthStatus,
  searchPlacesAroundPoint,
} = require("../services/geoapifyService");

/**
 * GET /api/meet-middle/health
 *
 * Public route used only to confirm the new Meet in the Middle
 * route is mounted correctly on Render.
 */
router.get("/health", (req, res) => {
  return res.json({
    success: true,
    feature: "meet-middle",
    provider: "geoapify",
    storage: "mongodb",
    status: "ok",
    timestamp: new Date().toISOString(),
  });
});

/**
 * GET /api/meet-middle/provider-health
 *
 * Public Render-safe provider check.
 * Does not expose the real Geoapify API key.
 */
router.get("/provider-health", (req, res) => {
  return res.json({
    success: true,
    feature: "meet-middle",
    storage: "mongodb",
    geoapify: getGeoapifyHealthStatus(),
    timestamp: new Date().toISOString(),
  });
});

/**
 * GET /api/meet-middle/provider-smoke
 *
 * Temporary Render-safe provider smoke test.
 * Calls Geoapify through backend using fixed public test coordinates.
 * Does not expose the API key.
 */
router.get("/provider-smoke", async (req, res) => {
  try {
    const midpoint = {
      lat: 32.8998,
      lng: -97.0403,
    };

    const places = await searchPlacesAroundPoint({
      midpoint,
      radiusMeters: 2000,
      limit: 5,
    });

    return res.json({
      success: true,
      feature: "meet-middle",
      provider: "geoapify",
      midpoint,
      radiusMeters: 2000,
      count: places.length,
      places,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    return sendMeetError(res, err);
  }
});

function sendMeetError(res, err) {
  const statusCode = Number(err?.statusCode || 500);

  if (statusCode >= 500) {
    console.error("❌ MeetMiddle route error:", err);
  }

  return res.status(statusCode).json({
    success: false,
    error: err?.code || "MEET_MIDDLE_ERROR",
    message: err?.message || "Meet in the Middle request failed",
  });
}

/**
 * POST /api/meet-middle/request
 *
 * Body:
 * {
 *   "to": "peerUserId"
 * }
 */
router.post("/request", authMiddleware, async (req, res) => {
  try {
    const fromId = String(req.user.id);
    const toId = String(req.body?.to || "").trim();

    if (!toId) {
      return res.status(400).json({
        success: false,
        error: "TO_REQUIRED",
        message: "Peer user id is required.",
      });
    }

    const result = await createMeetRequest({
      fromId,
      toId,
    });

    return res.json({
      success: true,
      reused: !!result.reused,
      session: result.session,
    });
  } catch (err) {
    return sendMeetError(res, err);
  }
});

/**
 * POST /api/meet-middle/:sessionId/location
 *
 * Body:
 * {
 *   "coords": {
 *     "lat": 33.2148,
 *     "lng": -97.1331
 *   }
 * }
 */
router.post("/:sessionId/location", authMiddleware, async (req, res) => {
  try {
    const sessionId = String(req.params.sessionId || "").trim();

    if (!sessionId) {
      return res.status(400).json({
        success: false,
        error: "SESSION_ID_REQUIRED",
        message: "Session id is required.",
      });
    }

    const result = await shareLocationAndBuildSuggestions({
      sessionId,
      userId: String(req.user.id),
      coords: req.body?.coords,
    });

    return res.json({
      success: true,
      ready: !!result.ready,
      session: result.session,
      midpoint: result.midpoint,
      smartMidpoint: result.smartMidpoint,
      radiusUsedMeters: result.radiusUsedMeters,
      places: result.places,
    });
  } catch (err) {
    return sendMeetError(res, err);
  }
});

/**
 * POST /api/meet-middle/:sessionId/decline
 *
 * Body:
 * {
 *   "reason": "optional"
 * }
 */
router.post("/:sessionId/decline", authMiddleware, async (req, res) => {
  try {
    const session = await declineMeetRequest({
      sessionId: String(req.params.sessionId || "").trim(),
      userId: String(req.user.id),
      reason: req.body?.reason || "",
    });

    return res.json({
      success: true,
      session,
    });
  } catch (err) {
    return sendMeetError(res, err);
  }
});

/**
 * POST /api/meet-middle/:sessionId/place/select
 *
 * Body:
 * {
 *   "place": {
 *     "id": "...",
 *     "name": "Starbucks",
 *     "category": "Cafe",
 *     "address": "...",
 *     "coords": { "lat": 33.2, "lng": -97.1 },
 *     "rating": null,
 *     "image": null,
 *     "distance": 600,
 *     "provider": "geoapify"
 *   }
 * }
 */
router.post("/:sessionId/place/select", authMiddleware, async (req, res) => {
  try {
    const session = await selectPlace({
      sessionId: String(req.params.sessionId || "").trim(),
      userId: String(req.user.id),
      place: req.body?.place,
    });

    return res.json({
      success: true,
      session,
    });
  } catch (err) {
    return sendMeetError(res, err);
  }
});

/**
 * POST /api/meet-middle/:sessionId/place/accept
 */
router.post("/:sessionId/place/accept", authMiddleware, async (req, res) => {
  try {
    const session = await acceptSelectedPlace({
      sessionId: String(req.params.sessionId || "").trim(),
      userId: String(req.user.id),
    });

    return res.json({
      success: true,
      session,
    });
  } catch (err) {
    return sendMeetError(res, err);
  }
});

/**
 * POST /api/meet-middle/:sessionId/place/reject
 */
router.post("/:sessionId/place/reject", authMiddleware, async (req, res) => {
  try {
    const session = await rejectSelectedPlace({
      sessionId: String(req.params.sessionId || "").trim(),
      userId: String(req.user.id),
    });

    return res.json({
      success: true,
      session,
    });
  } catch (err) {
    return sendMeetError(res, err);
  }
});

/**
 * POST /api/meet-middle/:sessionId/cancel
 */
router.post("/:sessionId/cancel", authMiddleware, async (req, res) => {
  try {
    const session = await cancelSession({
      sessionId: String(req.params.sessionId || "").trim(),
      userId: String(req.user.id),
    });

    return res.json({
      success: true,
      session,
    });
  } catch (err) {
    return sendMeetError(res, err);
  }
});

/**
 * POST /api/meet-middle/:sessionId/complete
 */
router.post("/:sessionId/complete", authMiddleware, async (req, res) => {
  try {
    const session = await completeSession({
      sessionId: String(req.params.sessionId || "").trim(),
      userId: String(req.user.id),
    });

    return res.json({
      success: true,
      session,
    });
  } catch (err) {
    return sendMeetError(res, err);
  }
});

module.exports = router;