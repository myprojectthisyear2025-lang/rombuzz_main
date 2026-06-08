/**
 * ============================================================
 * 📁 File: routes/chatStreamUploads.js
 * 🎬 Purpose: Cloudflare Stream upload/playback routes for CHAT videos only.
 *
 * Endpoints:
 *   POST /api/chat-stream/direct-upload
 *   POST /api/chat-stream/complete
 *   GET  /api/chat-stream/:uid/playback
 *
 * Rules:
 *   - ONLY chat videos use this route.
 *   - profile reels stay on /api/stream.
 *   - photos/audio stay on R2.
 *   - old Cloudinary chat videos keep working elsewhere.
 * ============================================================
 */

const express = require("express");
const router = express.Router();

const authMiddleware = require("./auth-middleware");
const {
  ensureFeatureAllowed,
  sendFeatureRestrictionError,
} = require("../utils/moderation");

const ChatRoom = require("../models/ChatRoom");

const {
  CF_STREAM_MAX_REEL_SECONDS,
  buildPlaybackUrls,
  createDirectUpload,
  createSignedPlaybackToken,
  getStreamVideo,
  normalizeStreamUid,
} = require("../services/cloudflareStreamService");

const CHAT_VIDEO_CONTEXT = "chat_video";

function normalizeText(value = "") {
  return String(value || "").trim();
}

function getPeersFromRoomId(roomId) {
  const raw = String(roomId || "");
  const parts = raw.split("_");

  if (parts.length === 2) {
    const [a, b] = parts;
    return { a, b };
  }

  if (parts.length === 3 && parts[1] === "") {
    return { a: parts[0], b: parts[2] };
  }

  const nonEmpty = parts.filter(Boolean);
  return {
    a: nonEmpty[0] || "",
    b: nonEmpty[1] || "",
  };
}

function getPeerForUser(roomId, userId, receiverId = "") {
  const { a, b } = getPeersFromRoomId(roomId);
  const me = String(userId || "");
  const requestedReceiver = String(receiverId || "").trim();

  if (!a || !b) {
    const err = new Error("Invalid chat room");
    err.status = 400;
    throw err;
  }

  if (![a, b].includes(me)) {
    const err = new Error("You are not part of this chat room");
    err.status = 403;
    throw err;
  }

  const peerId = me === a ? b : a;

  if (requestedReceiver && requestedReceiver !== peerId) {
    const err = new Error("receiverId does not match this chat room");
    err.status = 400;
    throw err;
  }

  return peerId;
}

async function enforceChatAllowed(req, res) {
  try {
    await ensureFeatureAllowed(req.user.id, "chat");
    return true;
  } catch (err) {
    sendFeatureRestrictionError(res, err);
    return false;
  }
}

function getVideoRaw(video = {}) {
  return video?.raw && typeof video.raw === "object" ? video.raw : {};
}

function getVideoMeta(video = {}) {
  const raw = getVideoRaw(video);
  return raw?.meta && typeof raw.meta === "object" ? raw.meta : {};
}

function getVideoCreator(video = {}) {
  const raw = getVideoRaw(video);
  return normalizeText(raw?.creator || video?.creator || "");
}

function getVideoContext(video = {}) {
  const meta = getVideoMeta(video);
  return normalizeText(meta?.context || meta?.purpose || meta?.uploadPurpose || "");
}

function buildSignedChatPlaybackPayload({ uid, video, signed }) {
  const playback = signed?.playback || buildPlaybackUrls(signed?.token || uid);

  return {
    ok: true,
    provider: "cloudflare_stream",
    storage: "cloudflare_stream",
    purpose: CHAT_VIDEO_CONTEXT,
    context: CHAT_VIDEO_CONTEXT,
    streamUid: uid,
    uid,
    signed: true,
    status: video?.status || "processing",
    duration: Number(video?.duration || 0),
    token: signed?.token || "",
    expiresInSeconds: signed?.expiresInSeconds || 3600,
    thumbnailUrl: playback?.thumbnailUrl || video?.thumbnailUrl || "",
    playback,
  };
}

/* ============================================================
   POST /api/chat-stream/direct-upload
============================================================ */
router.post("/direct-upload", authMiddleware, async (req, res) => {
  try {
    if (!(await enforceChatAllowed(req, res))) return;

    const roomId = normalizeText(req.body?.roomId || "");
    const receiverId = normalizeText(req.body?.receiverId || "");
    const filename = normalizeText(req.body?.filename || req.body?.name || "chat-video.mp4");

    if (!roomId) {
      return res.status(400).json({ error: "roomId is required" });
    }

    const peerId = getPeerForUser(roomId, req.user.id, receiverId);

    const directUpload = await createDirectUpload({
      userId: req.user.id,
      privacy: "private",
      name: filename,
      context: CHAT_VIDEO_CONTEXT,
      requireSignedURLs: true,
      meta: {
        purpose: CHAT_VIDEO_CONTEXT,
        uploadPurpose: CHAT_VIDEO_CONTEXT,
        context: CHAT_VIDEO_CONTEXT,
        mediaType: "video",
        roomId,
        senderId: String(req.user.id),
        receiverId: peerId,
        maxSeconds: String(CF_STREAM_MAX_REEL_SECONDS),
      },
    });

    return res.json({
      ok: true,
      provider: "cloudflare_stream",
      storage: "cloudflare_stream",
      purpose: CHAT_VIDEO_CONTEXT,
      context: CHAT_VIDEO_CONTEXT,
      roomId,
      senderId: String(req.user.id),
      receiverId: peerId,
      ...directUpload,
    });
  } catch (err) {
    console.error("❌ /chat-stream/direct-upload error:", err);
    return res.status(err.status || 500).json({
      error: err?.message || "Failed to create chat video upload URL",
    });
  }
});

/* ============================================================
   POST /api/chat-stream/complete
   Verifies the upload and returns chat-video metadata.
   Message persistence still goes through /api/chat/rooms/:roomId.
============================================================ */
router.post("/complete", authMiddleware, async (req, res) => {
  try {
    if (!(await enforceChatAllowed(req, res))) return;

    const roomId = normalizeText(req.body?.roomId || "");
    const receiverId = normalizeText(req.body?.receiverId || "");
    const uid = normalizeStreamUid(req.body?.uid || req.body?.streamUid || "");

    if (!roomId) {
      return res.status(400).json({ error: "roomId is required" });
    }

    if (!uid) {
      return res.status(400).json({ error: "streamUid is required" });
    }

    const peerId = getPeerForUser(roomId, req.user.id, receiverId);
    const video = await getStreamVideo(uid);

    const creator = getVideoCreator(video);
    if (creator && creator !== String(req.user.id)) {
      return res.status(403).json({ error: "This Stream video does not belong to you" });
    }

    const meta = getVideoMeta(video);
    const context = getVideoContext(video);

    if (context && context !== CHAT_VIDEO_CONTEXT) {
      return res.status(400).json({ error: "This Stream video is not a chat video" });
    }

    if (meta?.roomId && String(meta.roomId) !== roomId) {
      return res.status(403).json({ error: "This Stream video belongs to a different chat room" });
    }

    if (meta?.senderId && String(meta.senderId) !== String(req.user.id)) {
      return res.status(403).json({ error: "This Stream video belongs to a different sender" });
    }

    if (meta?.receiverId && String(meta.receiverId) !== peerId) {
      return res.status(403).json({ error: "This Stream video belongs to a different receiver" });
    }

    const signed = await createSignedPlaybackToken(uid);
    const playbackPayload = buildSignedChatPlaybackPayload({ uid, video, signed });

    return res.json({
      ...playbackPayload,
      roomId,
      senderId: String(req.user.id),
      receiverId: peerId,
      cloudflareStream: {
        uid,
        provider: "cloudflare_stream",
        purpose: CHAT_VIDEO_CONTEXT,
        context: CHAT_VIDEO_CONTEXT,
        status: video?.status || "processing",
        duration: Number(video?.duration || 0),
        requireSignedURLs: true,
      },
      video,
    });
  } catch (err) {
    console.error("❌ /chat-stream/complete error:", err);
    return res.status(err.status || 500).json({
      error: err?.message || "Failed to complete chat video upload",
    });
  }
});

/* ============================================================
   GET /api/chat-stream/:uid/playback
============================================================ */
router.get("/:uid/playback", authMiddleware, async (req, res) => {
  try {
    if (!(await enforceChatAllowed(req, res))) return;

    const uid = normalizeStreamUid(req.params.uid || "");
    if (!uid) {
      return res.status(400).json({ error: "stream uid required" });
    }

    const room = await ChatRoom.findOne({
      participants: String(req.user.id),
      "messages.streamUid": uid,
    });

    if (!room) {
      return res.status(404).json({ error: "Chat video not found" });
    }

    const message = (room.messages || []).find((msg) => {
      const directUid = normalizeStreamUid(
        msg?.streamUid || msg?.cloudflareStream?.uid || ""
      );
      return directUid === uid;
    });

    if (!message) {
      return res.status(404).json({ error: "Chat video message not found" });
    }

    const isSenderOrReceiver =
      String(message.from || "") === String(req.user.id) ||
      String(message.to || "") === String(req.user.id);

    if (!isSenderOrReceiver) {
      return res.status(403).json({ error: "Not allowed to play this chat video" });
    }

    const video = await getStreamVideo(uid);
    const signed = await createSignedPlaybackToken(uid);

    return res.json({
      ...buildSignedChatPlaybackPayload({ uid, video, signed }),
      roomId: room.roomId,
      messageId: String(message.id || ""),
      senderId: String(message.from || ""),
      receiverId: String(message.to || ""),
    });
  } catch (err) {
    console.error("❌ /chat-stream/:uid/playback error:", err);
    return res.status(err.status || 500).json({
      error: err?.message || "Failed to create chat video playback info",
    });
  }
});

module.exports = router;