/**
 * ============================================================
 * 📁 File: routes/videoCallGifts.js
 * 🎥🎁 Purpose: Video-call BuzzCoin send/request route layer.
 *
 * Mounted as:
 *   app.use("/api/video-call-gifts", require("./routes/videoCallGifts"));
 *
 * Endpoints:
 *   POST /api/video-call-gifts/send
 *   POST /api/video-call-gifts/request
 *   POST /api/video-call-gifts/requests/:requestId/accept
 *   POST /api/video-call-gifts/requests/:requestId/reject
 *
 * Notes:
 *   - This does NOT control Agora media.
 *   - This does NOT close or interrupt the video call.
 *   - This only handles BuzzCoin direct send + request flow.
 * ============================================================
 */

const express = require("express");

const router = express.Router();

const authMiddleware = require("./auth-middleware");

const {
  sendVideoCallBuzzCoinGift,
} = require("../services/videoCallGiftSendService");

const {
  createVideoCallBuzzCoinRequest,
  acceptVideoCallBuzzCoinRequest,
  rejectVideoCallBuzzCoinRequest,
} = require("../services/videoCallGiftRequestService");

function getMe(req) {
  return String(req.user?.id || "");
}

function sendRouteError(res, err) {
  const status = err?.statusCode || 500;

  return res.status(status).json({
    ok: false,
    error: err?.code || "INTERNAL_ERROR",
    message: err?.message || "Something went wrong",
    balanceBC: err?.balanceBC,
    requiredBC: err?.requiredBC,
  });
}

function getClientMetadata(req) {
  return {
    appPlatform: String(req.headers["x-app-platform"] || req.body?.appPlatform || ""),
    appVersion: String(req.headers["x-app-version"] || req.body?.appVersion || ""),
    userAgent: String(req.headers["user-agent"] || ""),
  };
}

// ============================================================
// 🎁 Direct send BuzzCoin during accepted video call
// POST /api/video-call-gifts/send
// Body: { callId, amountBC }
// ============================================================
router.post("/send", authMiddleware, async (req, res) => {
  try {
    const payload = await sendVideoCallBuzzCoinGift({
      senderId: getMe(req),
      callId: req.body?.callId,
      amountBC: req.body?.amountBC,
      metadata: {
        route: "/api/video-call-gifts/send",
        ...getClientMetadata(req),
      },
    });

    return res.json(payload);
  } catch (err) {
    return sendRouteError(res, err);
  }
});

// ============================================================
// 🙏 Request BuzzCoin during accepted video call
// POST /api/video-call-gifts/request
// Body: { callId, amountBC, note }
// ============================================================
router.post("/request", authMiddleware, async (req, res) => {
  try {
    const payload = await createVideoCallBuzzCoinRequest({
      requesterId: getMe(req),
      callId: req.body?.callId,
      amountBC: req.body?.amountBC,
      note: req.body?.note,
      metadata: {
        route: "/api/video-call-gifts/request",
        ...getClientMetadata(req),
      },
    });

    return res.json(payload);
  } catch (err) {
    return sendRouteError(res, err);
  }
});

// ============================================================
// ✅ Accept BuzzCoin request
// POST /api/video-call-gifts/requests/:requestId/accept
// ============================================================
router.post("/requests/:requestId/accept", authMiddleware, async (req, res) => {
  try {
    const payload = await acceptVideoCallBuzzCoinRequest({
      receiverId: getMe(req),
      requestId: req.params.requestId,
      metadata: {
        route: "/api/video-call-gifts/requests/:requestId/accept",
        ...getClientMetadata(req),
      },
    });

    return res.json(payload);
  } catch (err) {
    return sendRouteError(res, err);
  }
});

// ============================================================
// ❌ Reject BuzzCoin request
// POST /api/video-call-gifts/requests/:requestId/reject
// ============================================================
router.post("/requests/:requestId/reject", authMiddleware, async (req, res) => {
  try {
    const payload = await rejectVideoCallBuzzCoinRequest({
      receiverId: getMe(req),
      requestId: req.params.requestId,
      metadata: {
        route: "/api/video-call-gifts/requests/:requestId/reject",
        ...getClientMetadata(req),
      },
    });

    return res.json(payload);
  } catch (err) {
    return sendRouteError(res, err);
  }
});

module.exports = router;