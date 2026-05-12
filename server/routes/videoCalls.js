/**
 * ============================================================
 * 📁 File: routes/videoCalls.js
 * 🎥 Purpose: RomBuzz 1-to-1 Agora video call backend routes.
 *
 * Mounted later as:
 *   app.use("/api/video-calls", require("./routes/videoCalls"));
 *
 * Endpoints after mounting:
 *   POST /api/video-calls/start
 *   GET  /api/video-calls/active
 *   GET  /api/video-calls/:callId
 *   POST /api/video-calls/:callId/token
 *   POST /api/video-calls/:callId/accept
 *   POST /api/video-calls/:callId/decline
 *   POST /api/video-calls/:callId/cancel
 *   POST /api/video-calls/:callId/end
 *
 * This file does NOT do video media.
 * Agora handles video/audio.
 * This file handles secure session state + socket events.
 * ============================================================
 */

const express = require("express");
const shortid = require("shortid");

const router = express.Router();

const authMiddleware = require("../routes/auth-middleware");
const User = require("../models/User");
const Match = require("../models/Match");
const ChatRoom = require("../models/ChatRoom");
const VideoCallSession = require("../models/VideoCallSession");

const { createRtcToken } = require("../services/agoraTokenService");
const { isBlocked } = require("../utils/helpers");

// Same socket style used by chatRooms.js
const { getIO } = require("../socket");
const { onlineUsers } = require("../models/state");

const CALL_RING_SECONDS = 45;
const CALL_ROOM_EXPIRES_MINUTES = 10;
const TOKEN_TTL_SECONDS = 60 * 60;

function makeRoomId(a, b) {
  return [String(a), String(b)].sort().join("_");
}

function cleanText(value) {
  return String(value || "").trim();
}

function cleanFirstName(value) {
  const text = cleanText(value);
  if (!text) return "";
  return text.split(/\s+/).find(Boolean) || "";
}

function cleanUserSnapshot(user) {
  if (!user) return null;

  return {
    id: cleanText(user.id || user._id),
    firstName: cleanFirstName(user.firstName),
    lastName: cleanText(user.lastName),
    avatar: cleanText(user.avatar || user.profilePic || user.photo),
  };
}

function safeCallId() {
  return `vc_${shortid.generate().replace(/[^a-zA-Z0-9_-]/g, "")}`;
}

function safeChannelName(callId) {
  const raw = String(callId || safeCallId()).replace(/[^a-zA-Z0-9_-]/g, "");
  return `rbz_${raw}`.slice(0, 64);
}

function callExpiresAt() {
  return new Date(Date.now() + CALL_ROOM_EXPIRES_MINUTES * 60 * 1000);
}

function ringExpiresAt() {
  return new Date(Date.now() + CALL_RING_SECONDS * 1000);
}

function isTerminalStatus(status) {
  return ["declined", "canceled", "ended", "missed", "failed"].includes(
    String(status || "")
  );
}

function publicCall(call) {
  if (!call) return null;

  return {
    id: call.id,
    provider: call.provider || "agora",
    callType: call.callType || "video",
    status: call.status,
    callerId: call.callerId,
    receiverId: call.receiverId,
    participants: call.participants || [],
    roomId: call.roomId,
    channelName: call.channelName,
    caller: call.caller || null,
    receiver: call.receiver || null,
    startedAt: call.startedAt,
    acceptedAt: call.acceptedAt,
    declinedAt: call.declinedAt,
    canceledAt: call.canceledAt,
    endedAt: call.endedAt,
    missedAt: call.missedAt,
    expiresAt: call.expiresAt,
    endedBy: call.endedBy || "",
    lastReason: call.lastReason || "",
    createdAt: call.createdAt,
    updatedAt: call.updatedAt,
  };
}

function ensureParticipant(call, userId) {
  const me = String(userId || "");
  const participants = (call?.participants || []).map((x) => String(x));

  if (!participants.includes(me)) {
    const err = new Error("forbidden");
    err.statusCode = 403;
    throw err;
  }
}

async function requireMatchedPair(userA, userB) {
  const a = String(userA || "");
  const b = String(userB || "");

  if (!a || !b || a === b) return false;

  return !!(await Match.exists({
    users: { $all: [a, b] },
  }));
}

async function markExpiredRingingCallsForUser(userId) {
  const now = new Date();

  const expiredCalls = await VideoCallSession.find({
    participants: String(userId),
    status: "ringing",
    expiresAt: { $lte: now },
  });

  if (!expiredCalls.length) return;

  for (const call of expiredCalls) {
    call.status = "missed";
    call.missedAt = now;
    call.endedAt = now;
    call.lastReason = "ring_timeout";
    await call.save();

    await createCallHistoryMessage(call, "missed");
    emitCallEvent(call, "video-call:missed");
  }
}
function emitToUser(userId, eventName, payload) {
  try {
    const io = getIO();
    const uid = String(userId || "");
    const sid = onlineUsers?.[uid];

    if (sid) io.to(sid).emit(eventName, payload);

    // Also emit to user room if connection registers rooms.
    io.to(uid).emit(eventName, payload);
  } catch (err) {
    console.error(`❌ emitToUser failed for ${eventName}:`, err);
  }
}

function emitCallEvent(call, eventName, extra = {}) {
  const payload = {
    call: publicCall(call),
    ...extra,
  };

  emitToUser(call.callerId, eventName, payload);
  emitToUser(call.receiverId, eventName, payload);
}

function createTokenForCall(call, userId) {
  ensureParticipant(call, userId);

  return createRtcToken({
    channelName: call.channelName,
    userId: String(userId),
    ttlSeconds: TOKEN_TTL_SECONDS,
  });
}

function getCallDurationSeconds(call) {
  const start = new Date(call?.acceptedAt || call?.startedAt || 0).getTime();
  const end = new Date(
    call?.endedAt ||
      call?.declinedAt ||
      call?.canceledAt ||
      call?.missedAt ||
      0
  ).getTime();

  if (!start || !end || end <= start) return 0;
  return Math.max(1, Math.floor((end - start) / 1000));
}

function getCallPreviewText(status, durationSeconds = 0) {
  const s = String(status || "").toLowerCase();

  if (s === "missed") return "Missed call";
  if (s === "declined") return "Declined call";
  if (s === "canceled") return "Canceled call";

  if (s === "ended") {
    if (!durationSeconds) return "Video call";
    const mins = Math.floor(durationSeconds / 60);
    const secs = durationSeconds % 60;
    if (mins <= 0) return `Video call • ${secs}s`;
    return `Video call • ${mins}m ${String(secs).padStart(2, "0")}s`;
  }

  return "Video call";
}

async function getOrCreateChatRoom(roomId, participants) {
  let room = await ChatRoom.findOne({ roomId });
  if (room) return room;

  room = await ChatRoom.create({
    roomId,
    participants: (participants || []).map((x) => String(x)),
    messages: [],
  });

  return room;
}

async function createCallHistoryMessage(call, forcedStatus = "") {
  if (!call?.roomId || !call?.callerId || !call?.receiverId) return null;

  const status = String(forcedStatus || call.status || "").trim().toLowerCase();
  if (!["ended", "missed", "declined", "canceled"].includes(status)) return null;

  const room = await getOrCreateChatRoom(call.roomId, [
    call.callerId,
    call.receiverId,
  ]);

  const existing = (room.messages || []).find(
    (m) =>
      String(m?.callId || "") === String(call.id) &&
      String(m?.callStatus || "").toLowerCase() === status
  );

  if (existing) {
    return existing.toObject ? existing.toObject() : existing;
  }

  const durationSeconds = status === "ended" ? getCallDurationSeconds(call) : 0;
  const eventTime =
    call.endedAt ||
    call.declinedAt ||
    call.canceledAt ||
    call.missedAt ||
    new Date();

  const msg = {
    id: `call_${shortid.generate()}`,
    from: String(call.callerId),
    to: String(call.receiverId),
    text: getCallPreviewText(status, durationSeconds),

    type: "call",
    url: null,
    mediaType: null,
    overlayText: "",

    action: null,
    callId: String(call.id),
    callType: String(call.callType || "video"),
    callStatus: status,
    callDurationSeconds: durationSeconds,
    callStartedAt: call.acceptedAt || call.startedAt || null,
    callEndedAt:
      call.endedAt || call.declinedAt || call.canceledAt || call.missedAt || null,
    callEndedBy: String(call.endedBy || ""),

    time: eventTime,
    createdAt: eventTime,

    edited: false,
    deleted: false,
    system: false,
    reactions: {},
    hiddenFor: [],

    ephemeral: {
      mode: "none",
      viewsLeft: 0,
    },

    gift: {
      locked: false,
      stickerId: "sticker_basic",
      amount: 0,
      priceBC: 0,
      currency: "BC",
      unlockedBy: [],
      unlockedAt: null,
      unlockTransactionId: "",
    },

    replyTo: null,
    pinned: false,
    pinnedAt: null,
    pinnedBy: null,
    actorId: null,
    actorName: null,
    pinnedTargetId: null,
  };

  room.messages.push(msg);
  room.updatedAt = new Date();
  await room.save();

  const saved = room.messages[room.messages.length - 1];
  const savedMsg = saved?.toObject ? saved.toObject() : saved;

  const io = getIO();

  // room listeners
  io.to(call.roomId).emit("chat:message", savedMsg);

  // both users directly
  emitToUser(call.callerId, "chat:message", savedMsg);
  emitToUser(call.receiverId, "chat:message", savedMsg);

  const previewPayload = {
    id: savedMsg.id,
    roomId: call.roomId,
    from: savedMsg.from,
    to: savedMsg.to,
    time: savedMsg.time,
    preview: savedMsg.text || "Video call",
    type: "call",
    callId: savedMsg.callId,
    callType: savedMsg.callType,
    callStatus: savedMsg.callStatus,
    callDurationSeconds: savedMsg.callDurationSeconds,
    callStartedAt: savedMsg.callStartedAt,
    callEndedAt: savedMsg.callEndedAt,
    callEndedBy: savedMsg.callEndedBy,
  };

  emitToUser(call.callerId, "direct:message", previewPayload);
  emitToUser(call.receiverId, "direct:message", previewPayload);

  return savedMsg;
}

// ============================================================
// POST /api/video-calls/start
// body: { peerId }
// ============================================================
router.post("/start", authMiddleware, async (req, res) => {
  try {
    const callerId = String(req.user.id);
    const peerId = String(req.body?.peerId || req.body?.to || "").trim();

    if (!peerId) {
      return res.status(400).json({ error: "peerId required" });
    }

    if (peerId === callerId) {
      return res.status(400).json({ error: "cannot_call_self" });
    }

    await markExpiredRingingCallsForUser(callerId);

    if (await isBlocked(callerId, peerId)) {
      return res.status(403).json({ error: "blocked" });
    }

    const matched = await requireMatchedPair(callerId, peerId);
    if (!matched) {
      return res.status(403).json({ error: "matched_users_only" });
    }

    const [caller, receiver] = await Promise.all([
      User.findOne({ id: callerId })
        .select("id firstName lastName avatar profilePic photo")
        .lean(),
      User.findOne({ id: peerId })
        .select("id firstName lastName avatar profilePic photo")
        .lean(),
    ]);

    if (!receiver) {
      return res.status(404).json({ error: "receiver_not_found" });
    }

    const existing = await VideoCallSession.findOne({
      participants: { $all: [callerId, peerId] },
      status: { $in: ["ringing", "accepted"] },
    }).sort({ createdAt: -1 });

    if (existing) {
      const token = createTokenForCall(existing, callerId);

      return res.status(409).json({
        error: "active_call_exists",
        call: publicCall(existing),
        token,
      });
    }

    const callId = safeCallId();
    const roomId = makeRoomId(callerId, peerId);

    const call = await VideoCallSession.create({
      id: callId,
      provider: "agora",
      callType: "video",
      status: "ringing",
      callerId,
      receiverId: peerId,
      participants: [callerId, peerId],
      roomId,
      channelName: safeChannelName(callId),
      caller: cleanUserSnapshot(caller),
      receiver: cleanUserSnapshot(receiver),
      startedAt: new Date(),
      expiresAt: ringExpiresAt(),
      lastReason: "started",
    });

    const callerToken = createTokenForCall(call, callerId);

    emitToUser(peerId, "video-call:incoming", {
      call: publicCall(call),
    });

    emitToUser(callerId, "video-call:ringing", {
      call: publicCall(call),
      token: callerToken,
    });

    return res.json({
      ok: true,
      call: publicCall(call),
      token: callerToken,
    });
  } catch (err) {
    console.error("❌ video call start error:", err);
    return res.status(err.statusCode || 500).json({
      error: err.message || "failed_to_start_call",
    });
  }
});

// ============================================================
// GET /api/video-calls/active
// Returns current user's latest active call, if any.
// ============================================================
router.get("/active", authMiddleware, async (req, res) => {
  try {
    const me = String(req.user.id);

    await markExpiredRingingCallsForUser(me);

    const call = await VideoCallSession.findOne({
      participants: me,
      status: { $in: ["ringing", "accepted"] },
    }).sort({ createdAt: -1 });

    if (!call) {
      return res.json({
        ok: true,
        call: null,
      });
    }

    return res.json({
      ok: true,
      call: publicCall(call),
    });
  } catch (err) {
    console.error("❌ active video call error:", err);
    return res.status(500).json({ error: "failed" });
  }
});

// ============================================================
// GET /api/video-calls/:callId
// ============================================================
router.get("/:callId", authMiddleware, async (req, res) => {
  try {
    const me = String(req.user.id);
    const callId = String(req.params.callId || "");

    const call = await VideoCallSession.findOne({ id: callId });
    if (!call) return res.status(404).json({ error: "call_not_found" });

    ensureParticipant(call, me);

    return res.json({
      ok: true,
      call: publicCall(call),
    });
  } catch (err) {
    console.error("❌ get video call error:", err);
    return res.status(err.statusCode || 500).json({
      error: err.message || "failed",
    });
  }
});

// ============================================================
// POST /api/video-calls/:callId/token
// Generates token for current participant.
// ============================================================
router.post("/:callId/token", authMiddleware, async (req, res) => {
  try {
    const me = String(req.user.id);
    const callId = String(req.params.callId || "");

    const call = await VideoCallSession.findOne({ id: callId });
    if (!call) return res.status(404).json({ error: "call_not_found" });

    ensureParticipant(call, me);

    if (isTerminalStatus(call.status)) {
      return res.status(409).json({
        error: "call_not_active",
        call: publicCall(call),
      });
    }

    const token = createTokenForCall(call, me);

    return res.json({
      ok: true,
      call: publicCall(call),
      token,
    });
  } catch (err) {
    console.error("❌ video call token error:", err);
    return res.status(err.statusCode || 500).json({
      error: err.message || "failed_to_create_token",
    });
  }
});

// ============================================================
// POST /api/video-calls/:callId/accept
// Receiver accepts incoming call.
// ============================================================
router.post("/:callId/accept", authMiddleware, async (req, res) => {
  try {
    const me = String(req.user.id);
    const callId = String(req.params.callId || "");

    const call = await VideoCallSession.findOne({ id: callId });
    if (!call) return res.status(404).json({ error: "call_not_found" });

    ensureParticipant(call, me);

    if (String(call.receiverId) !== me) {
      return res.status(403).json({ error: "only_receiver_can_accept" });
    }

    if (call.status !== "ringing") {
      return res.status(409).json({
        error: "call_not_ringing",
        call: publicCall(call),
      });
    }

        if (call.expiresAt && new Date(call.expiresAt).getTime() < Date.now()) {
      call.status = "missed";
      call.missedAt = new Date();
      call.endedAt = new Date();
      call.lastReason = "ring_timeout";
      await call.save();

      await createCallHistoryMessage(call, "missed");
      emitCallEvent(call, "video-call:missed");

      return res.status(410).json({
        error: "call_missed",
        call: publicCall(call),
      });
    }

    call.status = "accepted";
    call.acceptedAt = new Date();
    call.expiresAt = callExpiresAt();
    call.lastReason = "accepted";
    await call.save();

    const receiverToken = createTokenForCall(call, me);

    emitCallEvent(call, "video-call:accepted");

    return res.json({
      ok: true,
      call: publicCall(call),
      token: receiverToken,
    });
  } catch (err) {
    console.error("❌ video call accept error:", err);
    return res.status(err.statusCode || 500).json({
      error: err.message || "failed_to_accept_call",
    });
  }
});

// ============================================================
// POST /api/video-calls/:callId/decline
// Receiver declines incoming call.
// ============================================================
router.post("/:callId/decline", authMiddleware, async (req, res) => {
  try {
    const me = String(req.user.id);
    const callId = String(req.params.callId || "");

    const call = await VideoCallSession.findOne({ id: callId });
    if (!call) return res.status(404).json({ error: "call_not_found" });

    ensureParticipant(call, me);

    if (String(call.receiverId) !== me) {
      return res.status(403).json({ error: "only_receiver_can_decline" });
    }

    if (isTerminalStatus(call.status)) {
      return res.json({
        ok: true,
        call: publicCall(call),
      });
    }

     call.status = "declined";
    call.declinedAt = new Date();
    call.endedAt = new Date();
    call.endedBy = me;
    call.lastReason = "declined";
    await call.save();

    await createCallHistoryMessage(call, "declined");
    emitCallEvent(call, "video-call:declined");

    return res.json({
      ok: true,
      call: publicCall(call),
    });
  } catch (err) {
    console.error("❌ video call decline error:", err);
    return res.status(err.statusCode || 500).json({
      error: err.message || "failed_to_decline_call",
    });
  }
});

// ============================================================
// POST /api/video-calls/:callId/cancel
// Caller cancels before receiver accepts.
// ============================================================
router.post("/:callId/cancel", authMiddleware, async (req, res) => {
  try {
    const me = String(req.user.id);
    const callId = String(req.params.callId || "");

    const call = await VideoCallSession.findOne({ id: callId });
    if (!call) return res.status(404).json({ error: "call_not_found" });

    ensureParticipant(call, me);

    if (String(call.callerId) !== me) {
      return res.status(403).json({ error: "only_caller_can_cancel" });
    }

    if (isTerminalStatus(call.status)) {
      return res.json({
        ok: true,
        call: publicCall(call),
      });
    }

    call.status = "canceled";
    call.canceledAt = new Date();
    call.endedAt = new Date();
    call.endedBy = me;
    call.lastReason = "canceled";
    await call.save();

    await createCallHistoryMessage(call, "canceled");
    emitCallEvent(call, "video-call:canceled");

    return res.json({
      ok: true,
      call: publicCall(call),
    });
  } catch (err) {
    console.error("❌ video call cancel error:", err);
    return res.status(err.statusCode || 500).json({
      error: err.message || "failed_to_cancel_call",
    });
  }
});

// ============================================================
// POST /api/video-calls/:callId/end
// Either participant ends an accepted call.
// ============================================================
router.post("/:callId/end", authMiddleware, async (req, res) => {
  try {
    const me = String(req.user.id);
    const callId = String(req.params.callId || "");
    const reason = String(req.body?.reason || "ended").trim();

    const call = await VideoCallSession.findOne({ id: callId });
    if (!call) return res.status(404).json({ error: "call_not_found" });

    ensureParticipant(call, me);

    if (isTerminalStatus(call.status)) {
      return res.json({
        ok: true,
        call: publicCall(call),
      });
    }

      call.status = "ended";
    call.endedAt = new Date();
    call.endedBy = me;
    call.lastReason = reason || "ended";
    await call.save();

    await createCallHistoryMessage(call, "ended");
    emitCallEvent(call, "video-call:ended");

    return res.json({
      ok: true,
      call: publicCall(call),
    });
  } catch (err) {
    console.error("❌ video call end error:", err);
    return res.status(err.statusCode || 500).json({
      error: err.message || "failed_to_end_call",
    });
  }
});

module.exports = router;