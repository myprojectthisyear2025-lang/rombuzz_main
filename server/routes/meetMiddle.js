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

const User = require("../models/User");
const { getSignedMediaUrl, isR2Key } = require("../utils/r2Media");

const {
  createMeetRequest,
  declineMeetRequest,
  acceptMeetRequest,
  expireMeetRequest,
  getMeetSessionById,
  shareLocationAndBuildSuggestions,
  selectPlace,
  acceptSelectedPlace,
  rejectSelectedPlace,
  cancelSession,
  completeSession,
} = require("../services/meetMiddleService");

const {
  createMeetRequestChatBubble,
  updateMeetRequestChatBubble,
} = require("../services/meetMiddleRequestChatService");

const {
  MEET_MIDDLE_STATUSES,
  createOrUpdateMeetMiddleMilestoneMessage,
} = require("../services/meetMiddleChatService");

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
 *
 * Protected so random public traffic cannot burn Geoapify quota.
 */
router.get("/provider-smoke", authMiddleware, async (req, res) => {
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
      places,
      count: Array.isArray(places) ? places.length : 0,
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

function getRouteIo(req) {
  return req?.app?.get?.("io") || global.io || null;
}

function getOnlineUsers() {
  if (!global.onlineUsers) {
    global.onlineUsers = {};
  }

  return global.onlineUsers;
}

function getOtherUserId(session, userId) {
  const safeUserId = String(userId || "").trim();
  const users = Array.isArray(session?.users) ? session.users.map(String) : [];

  return users.find((id) => id !== safeUserId) || null;
}

function emitToUser(io, userId, eventName, payload) {
  const safeUserId = String(userId || "").trim();
  if (!safeUserId || !io) return;

  const onlineUsers = getOnlineUsers();
  const socketId = onlineUsers[safeUserId];

  if (socketId) {
    io.to(String(socketId)).emit(eventName, payload);
  }

  io.to(safeUserId).emit(eventName, payload);
}

function emitChatMessageToPair(io, roomId, message, users = []) {
  if (!io || !roomId || !message?.id) return;

  io.to(roomId).emit("chat:message", message);

  users.map(String).filter(Boolean).forEach((id) => {
    emitToUser(io, id, "direct:message", {
      id: message.id,
      roomId,
      from: message.from,
      to: message.to,
      time: message.time,
      preview: String(message.text || "").slice(0, 120),
      type: message.type || "meet_middle_request",
    });
  });
}

function emitMeetRequestBubbleUpdate(io, roomId, message, users = []) {
  if (!io || !roomId || !message?.id) return;

  const payload = {
    roomId,
    message,
    sessionId: message?.meetMiddleRequest?.sessionId || null,
    status: message?.meetMiddleRequest?.status || null,
    updatedAt: new Date().toISOString(),
  };

  io.to(roomId).emit("chat:meetMiddle:update", payload);

  users.map(String).filter(Boolean).forEach((id) => {
    emitToUser(io, id, "chat:meetMiddle:update", payload);
    emitToUser(io, id, "direct:message", {
      id: message.id,
      roomId,
      from: message.from,
      to: message.to,
      time: message.time,
      preview: String(message.text || "").slice(0, 120),
      type: message.type || "meet_middle_request",
    });
  });
}

function emitMeetMiddleMilestoneUpdate(io, roomId, message, users = []) {
  if (!io || !roomId || !message?.id) return;

  const payload = {
    roomId,
    message,
    sessionId: message?.meetMiddle?.sessionId || null,
    status: message?.meetMiddle?.status || null,
    updatedAt: new Date().toISOString(),
  };

  io.to(roomId).emit("chat:message", message);
  io.to(roomId).emit("chat:meetMiddle:update", payload);

  users.map(String).filter(Boolean).forEach((id) => {
    emitToUser(io, id, "chat:meetMiddle:update", payload);
    emitToUser(io, id, "direct:message", {
      id: message.id,
      roomId,
      from: message.from,
      to: message.to,
      time: message.time,
      preview: String(message.text || "").slice(0, 120),
      type: message.type || "meetup",
    });
  });
}

function normalizeMediaString(value = "") {
  return String(value || "").trim();
}

async function signR2Value(value, expiresInSeconds = 3600) {
  const raw = normalizeMediaString(value);
  if (!raw) return "";
  if (!isR2Key(raw)) return raw;

  return getSignedMediaUrl(raw, expiresInSeconds);
}

function getPublicUser(user = {}) {
  return {
    id: String(user.id || ""),
    firstName: user.firstName || "",
    lastName: user.lastName || "",
    name:
      String(user.firstName || user.name || "").trim() ||
      "Someone",
    avatar:
      user.avatar ||
      (Array.isArray(user.photos) && user.photos.length ? user.photos[0] : "") ||
      "",
  };
}

async function signPublicUserAvatar(user = {}) {
  const next = { ...(user || {}) };
  next.avatar = await signR2Value(next.avatar, 21600);
  return next;
}

async function signMeetChatMessageAvatars(message = {}) {
  if (!message || typeof message !== "object") return message;

  const next =
    typeof message.toObject === "function"
      ? message.toObject({ flattenMaps: true })
      : { ...message };

  if (next.meetMiddleRequest) {
    next.meetMiddleRequest = {
      ...next.meetMiddleRequest,
      fromAvatar: await signR2Value(next.meetMiddleRequest.fromAvatar, 21600),
      toAvatar: await signR2Value(next.meetMiddleRequest.toAvatar, 21600),
    };
  }

  return next;
}

async function getPublicUserById(userId) {
  const user = await User.findOne(
    { id: String(userId) },
    {
      id: 1,
      firstName: 1,
      lastName: 1,
      name: 1,
      avatar: 1,
      photos: 1,
    }
  ).lean();

  const publicUser = getPublicUser(user || { id: userId });
  return signPublicUserAvatar(publicUser);
}

function scheduleMeetRequestExpiryFromRoute(req, session) {
  const io = getRouteIo(req);
  const sessionId = String(session?.sessionId || "").trim();
  const expiresAtMs = session?.expiresAt ? new Date(session.expiresAt).getTime() : 0;

  if (!sessionId || !Number.isFinite(expiresAtMs)) return;

  const delayMs = Math.max(0, expiresAtMs - Date.now());

  setTimeout(async () => {
    try {
      const expiredSession = await expireMeetRequest({ sessionId });

      if (!expiredSession || expiredSession.status !== "expired") return;

      const updateResult = await updateMeetRequestChatBubble({
        sessionId,
        status: "expired",
        actorId: "",
      });

        if (updateResult?.message && updateResult?.roomId) {
        const signedMessage = await signMeetChatMessageAvatars(updateResult.message);

        emitMeetRequestBubbleUpdate(
          io,
          updateResult.roomId,
          signedMessage,
          expiredSession.users || []
        );
      }

      (expiredSession.users || []).forEach((id) => {
        emitToUser(io, id, "meetMiddle:expired", {
          success: true,
          session: expiredSession,
          createdAt: new Date().toISOString(),
        });
      });
    } catch (err) {
      console.error("❌ MeetMiddle route request expiry failed:", err);
    }
  }, delayMs + 250);
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

    const io = getRouteIo(req);
    const sender = await getPublicUserById(fromId);
    const receiver = await getPublicUserById(toId);

    let chatBubble = null;

    try {
      const bubbleResult = await createMeetRequestChatBubble({
        fromId,
        toId,
        fromUser: sender,
        toUser: receiver,
        session: result.session,
      });

        chatBubble = await signMeetChatMessageAvatars(bubbleResult.message);

      emitChatMessageToPair(
        io,
        bubbleResult.roomId,
        chatBubble,
        result.session?.users || [fromId, toId]
      );
    } catch (chatErr) {
      console.error("❌ MeetMiddle HTTP request chat bubble create error:", chatErr);
    }

    scheduleMeetRequestExpiryFromRoute(req, result.session);

    emitToUser(io, toId, "meetMiddle:request:received", {
      success: true,
      session: result.session,
      from: sender,
      to: receiver,
      chatMessage: chatBubble,
      message: `${sender.name || "Someone"} wants to meet halfway 💞`,
      createdAt: new Date().toISOString(),
    });

      return res.json({
      success: true,
      ready: !!result.ready,
      session: result.session,
      midpoint: result.midpoint,
      smartMidpoint: result.smartMidpoint,
      midpointPlace: result.midpointPlace || result.session?.midpointPlace || null,
      radiusUsedMeters: result.radiusUsedMeters,
      radiusUsedMiles: result.radiusUsedMiles || result.session?.radiusUsedMiles || null,
      radiusStepsTriedMeters: result.radiusStepsTriedMeters || [],
      canExpandMore: !!result.canExpandMore,
      placesSearchExhausted: !!result.placesSearchExhausted,
      approximateParticipants:
        result.approximateParticipants ||
        result.session?.approximateParticipants ||
        [],
      places: result.places || [],
    });
  } catch (err) {
    return sendMeetError(res, err);
  }
});

/**
 * GET /api/meet-middle/:sessionId
 *
 * Protected resume route.
 * Returns the latest privacy-safe session snapshot for a participant.
 * This route does not expose exact user GPS.
 */
router.get("/:sessionId", authMiddleware, async (req, res) => {
  try {
    const session = await getMeetSessionById({
      sessionId: String(req.params.sessionId || "").trim(),
      userId: String(req.user.id),
    });

    return res.json({
      success: true,
      viewerId: String(req.user.id),
      session,
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

    const io = getRouteIo(req);
    const users = Array.isArray(result?.session?.users)
      ? result.session.users.map(String).filter(Boolean)
      : [];

    const payload = {
      success: true,
      ready: !!result.ready,
      session: result.session,
      midpoint: result.midpoint,
      smartMidpoint: result.smartMidpoint,
      midpointPlace: result.midpointPlace || result.session?.midpointPlace || null,
      radiusUsedMeters: result.radiusUsedMeters,
      radiusUsedMiles: result.radiusUsedMiles || result.session?.radiusUsedMiles || null,
      radiusStepsTriedMeters: result.radiusStepsTriedMeters || [],
      canExpandMore: !!result.canExpandMore,
      placesSearchExhausted: !!result.placesSearchExhausted,
      places: result.places || [],
      approximateParticipants:
        result.approximateParticipants ||
        result.session?.approximateParticipants ||
        [],
      sharedBy: String(req.user.id),
      createdAt: new Date().toISOString(),
    };

    if (result.ready || result.session?.status === "suggested") {
      users.forEach((id) => {
        emitToUser(io, id, "meetMiddle:suggestions:ready", payload);
      });
    } else {
      users.forEach((id) => {
        emitToUser(
          io,
          id,
          id === String(req.user.id)
            ? "meetMiddle:location:waiting"
            : "meetMiddle:location:peer-shared",
          payload
        );
      });
    }

    return res.json(payload);
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

    const io = getRouteIo(req);

    const updateResult = await updateMeetRequestChatBubble({
      sessionId: session.sessionId,
      status: "rejected",
      actorId: String(req.user.id),
    });

      if (updateResult?.message && updateResult?.roomId) {
      const signedMessage = await signMeetChatMessageAvatars(updateResult.message);

      emitMeetRequestBubbleUpdate(
        io,
        updateResult.roomId,
        signedMessage,
        session.users || []
      );
    }
    const payload = {
      success: true,
      session,
      declinedBy: String(req.user.id),
      reason: session.declineReason || "",
         chatMessage: updateResult?.message
        ? await signMeetChatMessageAvatars(updateResult.message)
        : null,
      createdAt: new Date().toISOString(),
    };

    session.users.forEach((id) => {
      emitToUser(io, id, "meetMiddle:declined", payload);
    });

    return res.json(payload);
  } catch (err) {
    return sendMeetError(res, err);
  }
});

/**
 * POST /api/meet-middle/:sessionId/accept
 *
 * Receiver accepts the initial Meet in the Middle request.
 * Location sharing starts after this, not before.
 */
router.post("/:sessionId/accept", authMiddleware, async (req, res) => {
  try {
    const session = await acceptMeetRequest({
      sessionId: String(req.params.sessionId || "").trim(),
      userId: String(req.user.id),
    });

    const io = getRouteIo(req);

    const updateResult = await updateMeetRequestChatBubble({
      sessionId: session.sessionId,
      status: "accepted",
      actorId: String(req.user.id),
    });

    if (updateResult?.message && updateResult?.roomId) {
      emitMeetRequestBubbleUpdate(
        io,
        updateResult.roomId,
        updateResult.message,
        session.users || []
      );
    }

    const payload = {
      success: true,
      session,
      acceptedBy: String(req.user.id),
      chatMessage: updateResult?.message || null,
      createdAt: new Date().toISOString(),
    };

    session.users.forEach((id) => {
      emitToUser(io, id, "meetMiddle:accepted", payload);
    });

    return res.json(payload);
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
    const userId = String(req.user.id);

    const session = await selectPlace({
      sessionId: String(req.params.sessionId || "").trim(),
      userId,
      place: req.body?.place,
    });

    const io = getRouteIo(req);
    const otherUserId = getOtherUserId(session, userId);
    const selector = await getPublicUserById(userId);

    let chatMessage = null;

    if (otherUserId) {
      try {
        const chatResult = await createOrUpdateMeetMiddleMilestoneMessage({
          fromId: userId,
          toId: otherUserId,
          session,
          status: MEET_MIDDLE_STATUSES.PLACE_PROPOSED,
          actorId: userId,
        });

        chatMessage = chatResult?.message || null;

        if (chatResult?.roomId && chatResult?.message) {
          emitMeetMiddleMilestoneUpdate(
            io,
            chatResult.roomId,
            chatResult.message,
            session.users || []
          );
        }
      } catch (chatErr) {
        console.error("❌ MeetMiddle HTTP place proposal chat message error:", chatErr);
      }
    }

    const payload = {
      success: true,
      session,
      selectedBy: selector,
      place: session.selectedPlace,
      chatMessage,
      message: `${selector.name || "Someone"} wants to meet at ${session.selectedPlace?.name || "this place"} 💞`,
      createdAt: new Date().toISOString(),
    };

    emitToUser(io, userId, "meetMiddle:place:selected", payload);

    if (otherUserId) {
      emitToUser(io, otherUserId, "meetMiddle:place:confirmation-needed", payload);
    }

    return res.json(payload);
  } catch (err) {
    return sendMeetError(res, err);
  }
});

/**
 * POST /api/meet-middle/:sessionId/place/accept
 */
router.post("/:sessionId/place/accept", authMiddleware, async (req, res) => {
  try {
    const userId = String(req.user.id);

    const session = await acceptSelectedPlace({
      sessionId: String(req.params.sessionId || "").trim(),
      userId,
    });

    const io = getRouteIo(req);
    const otherUserId = getOtherUserId(session, userId);

    let chatMessage = null;

    if (otherUserId) {
      try {
        const chatResult = await createOrUpdateMeetMiddleMilestoneMessage({
          fromId: userId,
          toId: otherUserId,
          session,
          status: MEET_MIDDLE_STATUSES.CONFIRMED,
          actorId: userId,
        });

        chatMessage = chatResult?.message || null;

        if (chatResult?.roomId && chatResult?.message) {
          emitMeetMiddleMilestoneUpdate(
            io,
            chatResult.roomId,
            chatResult.message,
            session.users || []
          );
        }
      } catch (chatErr) {
        console.error("❌ MeetMiddle HTTP final confirmed chat message error:", chatErr);
      }
    }

    const payload = {
      success: true,
      session,
      place: session.selectedPlace,
      acceptedBy: userId,
      chatMessage,
      createdAt: new Date().toISOString(),
    };

    session.users.forEach((id) => {
      emitToUser(io, id, "meetMiddle:final-confirmed", payload);
    });

    return res.json(payload);
  } catch (err) {
    return sendMeetError(res, err);
  }
});

/**
 * POST /api/meet-middle/:sessionId/place/reject
 */
router.post("/:sessionId/place/reject", authMiddleware, async (req, res) => {
  try {
    const userId = String(req.user.id);

    const session = await rejectSelectedPlace({
      sessionId: String(req.params.sessionId || "").trim(),
      userId,
    });

    const io = getRouteIo(req);
    const otherUserId = getOtherUserId(session, userId);

    let chatMessage = null;

    if (otherUserId) {
      try {
        const chatResult = await createOrUpdateMeetMiddleMilestoneMessage({
          fromId: userId,
          toId: otherUserId,
          session,
          status: MEET_MIDDLE_STATUSES.PLACE_REJECTED,
          actorId: userId,
        });

        chatMessage = chatResult?.message || null;

        if (chatResult?.roomId && chatResult?.message) {
          emitMeetMiddleMilestoneUpdate(
            io,
            chatResult.roomId,
            chatResult.message,
            session.users || []
          );
        }
      } catch (chatErr) {
        console.error("❌ MeetMiddle HTTP place rejected chat message error:", chatErr);
      }
    }

    const payload = {
      success: true,
      session,
      rejectedBy: userId,
      chatMessage,
      createdAt: new Date().toISOString(),
    };

    session.users.forEach((id) => {
      emitToUser(io, id, "meetMiddle:place:rejected", payload);
    });

    return res.json(payload);
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

    const io = getRouteIo(req);

    const updateResult = await updateMeetRequestChatBubble({
      sessionId: session.sessionId,
      status: "cancelled",
      actorId: String(req.user.id),
    });

    if (updateResult?.message && updateResult?.roomId) {
      emitMeetRequestBubbleUpdate(
        io,
        updateResult.roomId,
        updateResult.message,
        session.users || []
      );
    }

    const payload = {
      success: true,
      session,
      cancelledBy: String(req.user.id),
      chatMessage: updateResult?.message || null,
      createdAt: new Date().toISOString(),
    };

    session.users.forEach((id) => {
      emitToUser(io, id, "meetMiddle:cancelled", payload);
    });

    return res.json(payload);
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