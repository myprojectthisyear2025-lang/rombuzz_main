/**
 * ============================================================
 * 📁 File: routes/chatRooms.js
 * 💬 Purpose: Manage realtime chat rooms, persisted messages,
 *             edits, deletions, reactions, and full conversation hide.
 *
 * Endpoints:
 *   GET    /api/chat/rooms/:roomId                → Get chat messages
 *   POST   /api/chat/rooms/:roomId                → Send message
 *   PATCH  /api/chat/rooms/:roomId/:msgId         → Edit message
 *   DELETE /api/chat/rooms/:roomId/:msgId         → Delete message
 *   POST   /api/chat/rooms/:roomId/:msgId/react   → React / unreact
 *   DELETE /api/chat/rooms/:roomId                → Hide all messages for me (merged)
 *
 * Dependencies:
 *   -  models/ChatRoom.js  → Mongoose schema for rooms/messages
 *   - auth-middleware.js  → Token validation
 *   - Socket.IO (io, onlineUsers)
 * ============================================================
 */


const express = require("express");
const router = express.Router();
const shortid = require("shortid");
const authMiddleware = require("../routes/auth-middleware");
const {
  ensureFeatureAllowed,
  sendFeatureRestrictionError,
} = require("../utils/moderation");
const ChatRoom = require("../models/ChatRoom");
const MediaGift = require("../models/MediaGift");
const User = require("../models/User");
const Match = require("../models/Match");
const Relationship = require("../models/Relationship");
const { debitBuzzCoins, creditBuzzCoins } = require("../services/buzzCoinService");
const { getSignedMediaUrl, isR2Key } = require("../utils/r2Media");
const {
  createSignedPlaybackToken,
  getStreamVideo,
  normalizeStreamUid,
} = require("../services/cloudflareStreamService");

// ✅ Proper Socket.IO + state wiring
const { getIO } = require("../socket");
const { onlineUsers } = require("../models/state");

// =======================
// 🧩 Utilities
// =======================

function normalizeMediaString(value = "") {
  return String(value || "").trim();
}

async function signR2Value(value, expiresInSeconds = 3600) {
  const raw = normalizeMediaString(value);
  if (!raw) return null;
  if (!isR2Key(raw)) return raw;

  return getSignedMediaUrl(raw, expiresInSeconds);
}

function decodeRbzPayload(text = "") {
  const raw = String(text || "");
  if (!raw.startsWith("::RBZ::")) return null;

  try {
    const payload = JSON.parse(raw.slice("::RBZ::".length));
    return payload && typeof payload === "object" ? payload : null;
  } catch {
    return null;
  }
}

function replaceRbzPayloadUrl(text = "", signedUrl = "") {
  const raw = String(text || "");
  const nextUrl = String(signedUrl || "").trim();

  if (!raw.startsWith("::RBZ::") || !nextUrl) return raw;

  try {
    const payload = JSON.parse(raw.slice("::RBZ::".length));
    if (!payload || typeof payload !== "object") return raw;

    payload.url = nextUrl;
    return `::RBZ::${JSON.stringify(payload)}`;
  } catch {
    return raw;
  }
}

function replaceRbzPayloadStreamPlayback(text = "", stream = {}) {
  const raw = String(text || "");
  if (!raw.startsWith("::RBZ::")) return raw;

  try {
    const payload = JSON.parse(raw.slice("::RBZ::".length));
    if (!payload || typeof payload !== "object") return raw;

    payload.provider = "cloudflare_stream";
    payload.storage = "cloudflare_stream";
    payload.purpose = "chat_video";
    payload.context = "chat_video";
    payload.streamUid = stream.streamUid || payload.streamUid || "";
    payload.uid = stream.streamUid || payload.uid || "";
    payload.url = stream.playback?.hls || payload.url || "";
    payload.previewUrl = stream.playback?.hls || payload.previewUrl || "";
    payload.playback = stream.playback || payload.playback || {};
    payload.thumbnailUrl = stream.thumbnailUrl || payload.thumbnailUrl || "";
    payload.status = stream.status || payload.status || "processing";
    payload.duration = Number(stream.duration || payload.duration || 0);
    payload.cloudflareStream = {
      ...(payload.cloudflareStream || {}),
      uid: stream.streamUid || payload.cloudflareStream?.uid || "",
      provider: "cloudflare_stream",
      purpose: "chat_video",
      context: "chat_video",
      status: stream.status || payload.cloudflareStream?.status || "processing",
      duration: Number(stream.duration || payload.cloudflareStream?.duration || 0),
      requireSignedURLs: true,
    };

    return `::RBZ::${JSON.stringify(payload)}`;
  } catch {
    return raw;
  }
}

function getChatStreamUid(base = {}, payload = {}) {
  return normalizeStreamUid(
    base?.streamUid ||
      base?.cloudflareStream?.uid ||
      payload?.streamUid ||
      payload?.uid ||
      payload?.cloudflareStream?.uid ||
      ""
  );
}

function isChatStreamVideo(base = {}, payload = {}) {
  const provider = String(
    base?.provider ||
      base?.storage ||
      payload?.provider ||
      payload?.storage ||
      ""
  ).toLowerCase();

  const purpose = String(
    base?.purpose ||
      base?.cloudflareStream?.purpose ||
      base?.cloudflareStream?.context ||
      payload?.purpose ||
      payload?.context ||
      payload?.cloudflareStream?.purpose ||
      payload?.cloudflareStream?.context ||
      ""
  ).toLowerCase();

  const mediaType = String(base?.mediaType || payload?.mediaType || "").toLowerCase();

  return (
    mediaType === "video" &&
    provider === "cloudflare_stream" &&
    purpose === "chat_video" &&
    !!getChatStreamUid(base, payload)
  );
}

async function signChatStreamVideoMessage(base = {}, payload = {}) {
  const streamUid = getChatStreamUid(base, payload);
  if (!streamUid) return base;

  try {
    const video = await getStreamVideo(streamUid);
    const signed = await createSignedPlaybackToken(streamUid);
    const playback = signed?.playback || {};

    const streamPayload = {
      streamUid,
      playback,
      thumbnailUrl: playback?.thumbnailUrl || video?.thumbnailUrl || "",
      status: video?.status || "processing",
      duration: Number(video?.duration || 0),
    };

    return {
      ...base,
      provider: "cloudflare_stream",
      storage: "cloudflare_stream",
      purpose: "chat_video",
      streamUid,
      url: playback?.hls || "",
      playback,
      thumbnailUrl: streamPayload.thumbnailUrl,
      status: streamPayload.status,
      duration: streamPayload.duration,
      cloudflareStream: {
        ...(base.cloudflareStream || {}),
        uid: streamUid,
        provider: "cloudflare_stream",
        purpose: "chat_video",
        context: "chat_video",
        status: streamPayload.status,
        duration: streamPayload.duration,
        requireSignedURLs: true,
      },
      text: replaceRbzPayloadStreamPlayback(base.text, streamPayload),
    };
  } catch (err) {
    console.warn("signChatStreamVideoMessage failed:", err?.message || err);
    return base;
  }
}

async function signChatMessageMedia(message = {}, expiresInSeconds = 3600) {
  const base =
    typeof message?.toObject === "function"
      ? message.toObject({ flattenMaps: true })
      : { ...(message || {}) };

  const payload = decodeRbzPayload(base.text);

  if (isChatStreamVideo(base, payload || {})) {
    return signChatStreamVideoMessage(base, payload || {});
  }

  const rawUrl = normalizeMediaString(base.url || "");
  const key = isR2Key(rawUrl) ? rawUrl : "";

  if (!key) return base;

  const signedUrl = await getSignedMediaUrl(key, expiresInSeconds);

  return {
    ...base,
    url: signedUrl,
    r2Key: key,
    text: replaceRbzPayloadUrl(base.text, signedUrl),
  };
}

async function signChatMessages(messages = [], expiresInSeconds = 3600) {
  return Promise.all(
    (messages || []).map((message) =>
      signChatMessageMedia(message, expiresInSeconds)
    )
  );
}

// Parse participants from roomId
// Supports both "a_b" and legacy "a__b" formats
function getPeersFromRoomId(roomId) {
  const raw = String(roomId || "");
  const parts = raw.split("_");

  // Normal case: "userA_userB"
  if (parts.length === 2) {
    const [a, b] = parts;
    return { a, b };
  }

  // Legacy case: "userA__userB" → ["userA", "", "userB"]
  if (parts.length === 3 && parts[1] === "") {
    return { a: parts[0], b: parts[2] };
  }

  // Fallback: use first two non-empty pieces
  const nonEmpty = parts.filter(Boolean);
  return {
    a: nonEmpty[0] || "",
    b: nonEmpty[1] || "",
  };
}

async function isChatBlocked(userA, userB) {
  const a = String(userA || "");
  const b = String(userB || "");

  if (!a || !b) return false;

  const block = await Relationship.findOne({
    type: "block",
    $or: [
      { from: a, to: b },
      { from: b, to: a },
    ],
  }).lean();

  return !!block;
}

function sanitizeReplyToSnapshot(input) {
  if (!input || typeof input !== "object") return null;

  const id = String(input.id || "");
  const from = String(input.from || "");
  if (!id || !from) return null;

  return {
    id,
    from,
    type: String(input.type || "text"),
    text: String(input.text || ""),
    url: input.url ? String(input.url) : null,
    mediaType:
      input.mediaType === "image" ||
      input.mediaType === "video" ||
      input.mediaType === "audio"
        ? input.mediaType
        : null,
    deleted: !!input.deleted,
  };
}

function cleanFirstName(value) {
  const text = String(value || "").trim();
  if (!text) return "";
  return text.split(/\s+/).find(Boolean) || "";
}

async function resolveActorFirstName(userId) {
  try {
    const user = await User.findOne({ id: userId }).select("firstName").lean();
    return cleanFirstName(user?.firstName) || "Someone";
  } catch (err) {
    console.error("resolveActorFirstName failed", err);
    return "Someone";
  }
}

function dedupeMessagesById(messages) {
  const latestById = new Map();

  for (const msg of messages || []) {
    latestById.set(String(msg?.id || ""), msg);
  }

  const seen = new Set();
  const deduped = [];

  for (let i = (messages || []).length - 1; i >= 0; i -= 1) {
    const msg = messages[i];
    const id = String(msg?.id || "");
    if (seen.has(id)) continue;
    seen.add(id);
    deduped.push(latestById.get(id));
  }

  return deduped.reverse();
}


async function getRoomDoc(roomId) {
  let room = await ChatRoom.findOne({ roomId });

  if (!room) {
    const { a, b } = getPeersFromRoomId(roomId);

    // ✅ init read state for both users
    const epoch = new Date(0);
    room = await ChatRoom.create({
      roomId,
      participants: [a, b],
      lastReadAtByUser: { [a]: epoch, [b]: epoch },
      chatPrefsByUser: {
        [a]: {
          pinned: false,
          muted: false,
          alertOnline: false,
          deletedForMe: false,
          forceUnread: false,
          updatedAt: new Date(),
        },
        [b]: {
          pinned: false,
          muted: false,
          alertOnline: false,
          deletedForMe: false,
          forceUnread: false,
          updatedAt: new Date(),
        },
      },
      messages: [],
    });

    return room;
  }

  // ✅ backfill read state for old rooms (no breaking changes)
  let changed = false;
  if (!room.lastReadAtByUser) {
    room.lastReadAtByUser = new Map();
    changed = true;
  }
  const epoch = new Date(0);
  for (const pid of room.participants || []) {
    if (!room.lastReadAtByUser.get(String(pid))) {
      room.lastReadAtByUser.set(String(pid), epoch);
      changed = true;
    }
  }

  // ✅ backfill chat list prefs for old rooms
  if (!room.chatPrefsByUser) {
    room.chatPrefsByUser = new Map();
    changed = true;
  }

  for (const pid of room.participants || []) {
    const key = String(pid);
    if (!room.chatPrefsByUser.get(key)) {
      room.chatPrefsByUser.set(key, {
        pinned: false,
        muted: false,
        alertOnline: false,
        deletedForMe: false,
        forceUnread: false,
        updatedAt: new Date(),
      });
      changed = true;
    }
  }

  if (changed) await room.save();

  return room;
}

function getMyRoomPrefs(room, userId) {
  const me = String(userId || "");
  const raw =
    (room.chatPrefsByUser?.get && room.chatPrefsByUser.get(me)) ||
    (room.chatPrefsByUser && room.chatPrefsByUser[me]) ||
    {};

  return {
    pinned: !!raw.pinned,
    muted: !!raw.muted,
    alertOnline: !!raw.alertOnline,
    deletedForMe: !!raw.deletedForMe,
    forceUnread: !!raw.forceUnread,
    updatedAt: raw.updatedAt || null,
  };
}

function setMyRoomPrefs(room, userId, patch = {}) {
  const me = String(userId || "");
  const current = getMyRoomPrefs(room, me);

  const next = {
    ...current,
    ...patch,
    updatedAt: new Date(),
  };

  if (!room.chatPrefsByUser) room.chatPrefsByUser = new Map();
  room.chatPrefsByUser.set(me, next);

  return next;
}

function normalizeGiftUnlockPrice(value) {
  const n = Math.floor(Number(value) || 0);

  // Gifted media must be paid media, but keep a sane app-side cap.
  // You can raise this later after wallet/payout rules are finalized.
  if (n <= 0) return 0;
  return Math.min(n, 10000);
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

async function enforceGiftsAllowed(req, res) {
  try {
    await ensureFeatureAllowed(req.user.id, "gifts");
    return true;
  } catch (err) {
    sendFeatureRestrictionError(res, err);
    return false;
  }
}


router.get("/chat/rooms/:roomId", authMiddleware, async (req, res) => {
  try {
    const { roomId } = req.params;
    const userId = req.user.id;

    if (!(await enforceChatAllowed(req, res))) return;

    const room = await getRoomDoc(roomId);
    if (!room) return res.status(404).json({ error: "Room not found" });

   // ✅ Return messages that are NOT hidden for me
// ✅ Ephemeral messages are NOT deleted on fetch.
// ✅ They are deleted ONLY after receiver views (via /viewed endpoint).
const visible = (room.messages || []).filter((m) => {
  if (m.hiddenFor?.includes(userId)) return false;
  return true;
});

const dedupedVisible = dedupeMessagesById(visible);
const signedVisible = await signChatMessages(dedupedVisible, 3600);

res.json(signedVisible);

  } catch (err) {
    console.error("❌ GET chat room error:", err);
    res.status(500).json({ error: "Failed to load messages" });
  }
});

// ============================================================
// 📤 SEND MESSAGE
// ============================================================
router.post("/chat/rooms/:roomId", authMiddleware, async (req, res) => {
  try {
    const { roomId } = req.params;
    const { text, replyTo } = req.body || {};
    if (!text) return res.status(400).json({ error: "text required" });

    if (!(await enforceChatAllowed(req, res))) return;

    const { a, b } = getPeersFromRoomId(roomId);
    if (![a, b].includes(req.user.id))
      return res.status(403).json({ error: "forbidden" });

      const fromId = req.user.id;
    const toId = fromId === a ? b : a;

    const blocked = await isChatBlocked(fromId, toId);
    if (blocked) {
      return res.status(403).json({
        error: "blocked",
        message: "Message failed. You cannot send messages to this user.",
      });
    }

// ✅ Detect ephemeral + gift lock from ::RBZ:: payload
let epMode = "none";
let viewsLeft = 0;

let giftLocked = false;
let giftStickerId = "sticker_basic";
let giftAmount = 0;
let giftPriceBC = 0;

// ✅ NEW: media fields (so realtime doesn’t render black/blank)
let mediaUrl = null;
let mediaType = null; // "image" | "video" | "audio"
let overlayText = "";
let muted = false;

// ✅ Chat video Stream fields. Old Cloudinary videos keep using url only.
let provider = "";
let storage = "";
let purpose = "";
let streamUid = "";
let thumbnailUrl = "";
let status = "";
let duration = 0;
let playback = {};
let cloudflareStream = {
  uid: "",
  provider: "",
  purpose: "",
  context: "",
  status: "",
  duration: 0,
  requireSignedURLs: true,
};

if (text.startsWith("::RBZ::")) {
  try {
    const payload = JSON.parse(text.slice("::RBZ::".length));

    const mode =
      payload?.ephemeral?.mode ||
      payload?.ephemeral ||
      (payload?.viewOnce ? "once" : null);

    if (mode === "once") {
      epMode = "once";
      viewsLeft = 1;
    } else if (mode === "twice") {
      epMode = "twice";
      viewsLeft = 2;
    }

     if (payload?.gift?.locked) {
      giftLocked = true;
      giftStickerId = String(payload?.gift?.stickerId || "sticker_basic");

      const rawPrice =
        payload?.gift?.priceBC ??
        payload?.gift?.amount ??
        payload?.priceBC ??
        0;

      giftPriceBC = normalizeGiftUnlockPrice(rawPrice);
      giftAmount = giftPriceBC;
    }

      // ✅ NEW: store media fields explicitly
    if (payload?.url) mediaUrl = String(payload.url);

    if (
      payload?.mediaType === "video" ||
      payload?.mediaType === "image" ||
      payload?.mediaType === "audio"
    ) {
      mediaType = payload.mediaType;
    } else if (payload?.type === "media" && payload?.url) {
      mediaType = "image";
    }

    provider = String(payload?.provider || "").trim();
    storage = String(payload?.storage || provider || "").trim();
    purpose = String(payload?.purpose || payload?.context || "").trim();

    streamUid = normalizeStreamUid(
      payload?.streamUid ||
        payload?.uid ||
        payload?.cloudflareStream?.uid ||
        ""
    );

    if (
      mediaType === "video" &&
      (provider === "cloudflare_stream" || storage === "cloudflare_stream") &&
      streamUid
    ) {
      provider = "cloudflare_stream";
      storage = "cloudflare_stream";
      purpose = "chat_video";
      mediaUrl = streamUid;
      thumbnailUrl = String(payload?.thumbnailUrl || "");
      status = String(payload?.status || payload?.cloudflareStream?.status || "processing");
      duration = Number(payload?.duration || payload?.cloudflareStream?.duration || 0);
      playback =
        payload?.playback && typeof payload.playback === "object"
          ? payload.playback
          : {};

      cloudflareStream = {
        uid: streamUid,
        provider: "cloudflare_stream",
        purpose: "chat_video",
        context: "chat_video",
        status,
        duration,
        requireSignedURLs: true,
      };
    }

    muted = !!payload?.muted;

    if (payload?.overlayText) overlayText = String(payload.overlayText || "");
  } catch (e) {
    console.warn("RBZ payload parse failed:", e);
  }
}

const isRBZ = text.startsWith("::RBZ::");
const safeReplyTo = sanitizeReplyToSnapshot(replyTo);

const msg = {
  id: shortid.generate(),
  from: fromId,
  to: toId,
  text,
  type: isRBZ ? "media" : "text",

  // ✅ NEW: keep media as real fields too
  url: isRBZ ? mediaUrl : null,
  mediaType: isRBZ ? mediaType : null,
  overlayText: isRBZ ? overlayText : "",
  muted: isRBZ ? muted : false,

  // ✅ Chat video Stream metadata. Old Cloudinary videos keep provider empty/cloudinary.
  provider: isRBZ ? provider : "",
  storage: isRBZ ? storage : "",
  purpose: isRBZ ? purpose : "",
  streamUid: isRBZ ? streamUid : "",
  thumbnailUrl: isRBZ ? thumbnailUrl : "",
  status: isRBZ ? status : "",
  duration: isRBZ ? duration : 0,
  playback: isRBZ ? playback : {},
  cloudflareStream: isRBZ ? cloudflareStream : {},

  time: new Date(),
  edited: false,
  deleted: false,
  reactions: {},
  hiddenFor: [],
  ephemeral: { mode: epMode, viewsLeft },
  gift: {
    locked: giftLocked,
    stickerId: giftStickerId,
    amount: giftAmount,
    priceBC: giftPriceBC,
    currency: "BC",
    unlockedBy: [],
    unlockedAt: null,
    unlockTransactionId: "",
  },
  replyTo: safeReplyTo,
};

const room = await getRoomDoc(roomId);
room.messages.push(msg);
await room.save();

const signedMsg = await signChatMessageMedia(msg, 3600);

// ✅ Socket events (room + direct)
const io = getIO();

// 🔥 FIX: Emit chat:message (frontend listens for this)
io.to(roomId).emit("chat:message", signedMsg);

// 🔥 Also send to peer's private room in case they are not in the chat room
const sid = onlineUsers?.[toId];
if (sid) {
  io.to(sid).emit("chat:message", signedMsg);
}

// ✅ NEW: emit unread summary update to receiver (server-accurate)
try {
  const summary = await computeUnreadSummaryForUser(String(toId));
  if (sid) io.to(sid).emit("chat:unread:update", summary);
  io.to(String(toId)).emit("chat:unread:update", summary);
} catch (e) {
  console.warn("unread summary emit failed:", e?.message || e);
}


// 🔥 Navbar/unread bubble handler
if (sid) {
  io.to(sid).emit("direct:message", {
    id: signedMsg.id,
    roomId,
    from: fromId,
    to: toId,
    time: signedMsg.time,
    preview: (signedMsg.text || "").slice(0, 80),
    type: signedMsg.type || "text",
  });
}


    res.json({ message: signedMsg });
  } catch (err) {
    console.error("❌ POST message error:", err);
    res.status(500).json({ error: "Failed to send message" });
  }
});

// ============================================================
// ✍️ EDIT MESSAGE
// ============================================================
router.patch("/chat/rooms/:roomId/:msgId", authMiddleware, async (req, res) => {
  try {
    const { roomId, msgId } = req.params;
    const { text } = req.body || {};
    if (!text) return res.status(400).json({ error: "text required" });

    if (!(await enforceChatAllowed(req, res))) return;

    const room = await getRoomDoc(roomId);
    const msg = (room.messages || []).find((m) => String(m.id) === String(msgId));
    if (!msg) return res.status(404).json({ error: "not_found" });

    if (msg.system) {
      return res.status(400).json({ error: "cannot_edit_system" });
    }

    if (String(msg.from) !== String(req.user.id)) {
      return res.status(403).json({ error: "not owner" });
    }

    const oneHour = 60 * 60 * 1000;
    if (Date.now() - new Date(msg.time).getTime() > oneHour) {
      return res.status(400).json({ error: "edit window expired" });
    }

    msg.text = text;
    msg.edited = true;
    await room.save();

    const updatedMessage = msg.toObject ? msg.toObject() : { ...msg };
    const io = getIO();
    const editPayload = {
      roomId,
      msgId: String(updatedMessage.id || msgId),
      id: String(updatedMessage.id || msgId),
      text: updatedMessage.text,
      edited: !!updatedMessage.edited,
      message: updatedMessage,
    };

    io.to(roomId).emit("message:edit", editPayload);
    io.to(roomId).emit("chat:edit", editPayload);

    const peerId = String(msg.to || "");
    const sid = onlineUsers?.[peerId];
    if (sid) {
      io.to(sid).emit("message:edit", editPayload);
      io.to(sid).emit("chat:edit", editPayload);
    }

    res.json({ ok: true, message: updatedMessage });

  } catch (err) {
    console.error("❌ PATCH edit message error:", err);
    res.status(500).json({ error: "Failed to edit message" });
  }
});

// ============================================================
// 🗑️ DELETE / HIDE MESSAGE
// ============================================================
router.delete("/chat/rooms/:roomId/:msgId", authMiddleware, async (req, res) => {
  try {
    const { roomId, msgId } = req.params;
    const { scope = "me" } = req.query;

    if (!(await enforceChatAllowed(req, res))) return;

    const room = await getRoomDoc(roomId);
    const msgIndex = room.messages.findIndex((m) => String(m.id) === String(msgId));
    if (msgIndex === -1) return res.status(404).json({ error: "not found" });

    const msg = room.messages[msgIndex];

    if (scope === "me") {
      if (!msg.hiddenFor.includes(req.user.id)) msg.hiddenFor.push(req.user.id);
      await room.save();
      return res.json({ ok: true });
    }

    if (scope === "all") {
      if (String(msg.from) !== String(req.user.id)) {
        return res.status(403).json({ error: "not owner" });
      }

      // ✅ permanently remove from backend storage
      room.messages.splice(msgIndex, 1);
      await room.save();

      const io = getIO();

      // ✅ notify anyone inside the room
      io.to(roomId).emit("message:delete", {
        id: String(msgId),
        msgId: String(msgId),
        roomId,
        scope: "all",
      });

      // ✅ also push directly to the peer socket in case room join is missing/stale
      const peerId = String(msg.to);
      const sid = onlineUsers?.[peerId];
      if (sid) {
        io.to(sid).emit("message:delete", {
          id: String(msgId),
          msgId: String(msgId),
          roomId,
          scope: "all",
        });
      }

      return res.json({ ok: true, removedId: String(msgId) });
    }

    res.status(400).json({ error: "invalid scope" });
  } catch (err) {
    console.error("❌ DELETE message error:", err);
    res.status(500).json({ error: "Failed to delete message" });
  }
});

// ============================================================
// 💣 DELETE ENTIRE CONVERSATION
// ============================================================
router.delete("/chat/rooms/:roomId", authMiddleware, async (req, res) => {
  try {
    const { roomId } = req.params;
    const { scope = "me" } = req.query;

    if (!(await enforceChatAllowed(req, res))) return;

    const room = await getRoomDoc(roomId);

    if (!room) return res.status(404).json({ error: "not found" });

    const myId = req.user.id;
    room.messages.forEach((m) => {
      if (!m.hiddenFor.includes(myId)) m.hiddenFor.push(myId);
    });

    await room.save();
    res.json({ ok: true, scope });
  } catch (err) {
    console.error("❌ DELETE conversation error:", err);
    res.status(500).json({ error: "Failed to delete conversation" });
  }
});

// ============================================================
// ❤️ REACTIONS
// ============================================================
router.post("/chat/rooms/:roomId/:msgId/react", authMiddleware, async (req, res) => {
  try {
    const { roomId, msgId } = req.params;
    const { emoji } = req.body || {};
    if (!emoji) return res.status(400).json({ error: "emoji required" });

    if (!(await enforceChatAllowed(req, res))) return;

    const room = await getRoomDoc(roomId);
    const msg = room.messages.find((m) => String(m.id) === String(msgId));
    if (!msg) return res.status(404).json({ error: "not found" });

    const reactorId = String(req.user.id);
    const messageOwnerId = String(msg.from || "");
    const messageReceiverId = String(msg.to || "");

    msg.reactions = msg.reactions || {};

    if (msg.reactions.get(reactorId) === emoji) {
      msg.reactions.delete(reactorId);
    } else {
      msg.reactions.set(reactorId, emoji);
    }

    await room.save();

    const reactions = Object.fromEntries(msg.reactions || new Map());

    const messagePayload =
      typeof msg.toObject === "function"
        ? msg.toObject({ flattenMaps: true })
        : { ...msg };

    messagePayload.reactions = reactions;

      const currentEmoji = reactions[reactorId] || null;

    const reactionPayload = {
      roomId,
      id: String(msgId),
      msgId: String(msgId),
      messageId: String(msgId),
      userId: reactorId,
      reactorId,
      emoji: currentEmoji,
      reactions,
      message: messagePayload,
    };

    const io = getIO();

    // ✅ Update anyone currently inside the room instantly.
    io.to(roomId).emit("message:react", reactionPayload);
    io.to(roomId).emit("chat:react", reactionPayload);

    // ✅ Also push directly to the other user's socket in case room join is stale.
    const reactionTargetId =
      reactorId === messageOwnerId ? messageReceiverId : messageOwnerId;

    const targetSid = onlineUsers?.[reactionTargetId];
    if (targetSid) {
      io.to(targetSid).emit("message:react", reactionPayload);
      io.to(targetSid).emit("chat:react", reactionPayload);

      // ✅ Chat-list notification only when a reaction is ADDED.
      // Removing a reaction should only update the bubble in the open thread.
      if (currentEmoji) {
        io.to(targetSid).emit("chat:reaction-preview", {
          id: `reaction-${roomId}-${msgId}-${reactorId}-${Date.now()}`,
          roomId,
          peerId: reactorId,
          from: reactorId,
          to: reactionTargetId,
          msgId: String(msgId),
          emoji: currentEmoji,
          type: "reaction",
          time: new Date().toISOString(),
          preview: `Reacted ${currentEmoji} to your message`,
        });
      }
    }

    res.json({
      ok: true,
      reactions,
      message: messagePayload,
    });
  } catch (err) {
    console.error("❌ REACT message error:", err);
    res.status(500).json({ error: "Failed to react" });
  }
});

// ============================================================
// 📌 PIN / UNPIN MESSAGE
// ============================================================
router.post("/chat/rooms/:roomId/:msgId/pin", authMiddleware, async (req, res) => {
  try {
    const { roomId, msgId } = req.params;
    const { pinned } = req.body || {};

    if (!(await enforceChatAllowed(req, res))) return;

    const room = await getRoomDoc(roomId);
    const msg = room.messages.find((m) => String(m.id) === String(msgId));
    if (!msg) return res.status(404).json({ error: "not_found" });
    if (msg.deleted) return res.status(400).json({ error: "cannot_pin_deleted" });

    const nextPinned = !!pinned;
    msg.pinned = nextPinned;
    msg.pinnedAt = nextPinned ? new Date() : null;
    msg.pinnedBy = nextPinned ? String(req.user.id) : null;

    const actorName = await resolveActorFirstName(req.user.id);

    const systemMessage = {
      id: shortid.generate(),
      from: "system",
      to: "system",
      text: "",
      type: "system_pin",
      action: nextPinned ? "pin" : "unpin",
      time: new Date(),
      createdAt: new Date(),
      edited: false,
      deleted: false,
      system: true,
      reactions: {},
      hiddenFor: [],
      actorId: String(req.user.id),
      actorName,
      pinnedTargetId: String(msg.id),
      ephemeral: { mode: "none", viewsLeft: 0 },
      gift: {
        locked: false,
        stickerId: "sticker_basic",
        amount: 0,
        unlockedBy: [],
      },
    };

    room.messages.push(systemMessage);

    await room.save();

    const updatedMessage = msg.toObject ? msg.toObject() : { ...msg };
    const io = getIO();
    const pinPayload = {
      roomId,
      msgId: String(updatedMessage.id || msgId),
      id: String(updatedMessage.id || msgId),
      pinned: !!updatedMessage.pinned,
      pinnedAt: updatedMessage.pinnedAt || null,
      pinnedBy: updatedMessage.pinnedBy || null,
      message: updatedMessage,
      systemMessage,
    };

    io.to(roomId).emit("message:pin", pinPayload);
    io.to(roomId).emit("chat:pin", pinPayload);

    const peerId =
      String(msg.from) === String(req.user.id) ? String(msg.to || "") : String(msg.from || "");
    const sid = onlineUsers?.[peerId];
    if (sid) {
      io.to(sid).emit("message:pin", pinPayload);
      io.to(sid).emit("chat:pin", pinPayload);
    }

    return res.json({ ok: true, message: updatedMessage, systemMessage });
  } catch (err) {
    console.error("❌ PIN message error:", err);
    return res.status(500).json({ error: "Failed to update pin" });
  }
});

// ============================================================
// 🧹 DEBUG — DELETE BROKEN CHAT ROOM (no auth)
// URL: /api/chat/debug/room/<roomId>
// ============================================================
router.delete("/debug/room/:roomId", async (req, res) => {
  try {
    const { roomId } = req.params;
    const result = await ChatRoom.deleteOne({ roomId });

    res.json({
      ok: true,
      roomId,
      deleted: result.deletedCount,
    });
  } catch (err) {
    console.error("❌ Debug delete error:", err);
    res.status(500).json({ error: err.message });
  }
});

// ============================================================
// 👁️ EPHEMERAL VIEW TRACK (ON OPEN)
// POST /api/chat/rooms/:roomId/:msgId/viewed
// - Only receiver can call
// - Decrements viewsLeft
// - When 0 => permanently remove message everywhere + socket notify
// ============================================================
router.post("/chat/rooms/:roomId/:msgId/viewed", authMiddleware, async (req, res) => {
  try {
    const { roomId, msgId } = req.params;
    const me = String(req.user.id);

    if (!(await enforceChatAllowed(req, res))) return;

    const room = await getRoomDoc(roomId);
    const idx = (room.messages || []).findIndex((m) => String(m.id) === String(msgId));
    if (idx === -1) return res.status(404).json({ error: "not_found" });

    const msg = room.messages[idx];

    // ✅ Only receiver can consume views
    if (String(msg.to) !== me) {
      return res.status(403).json({ error: "forbidden" });
    }

    const mode = msg?.ephemeral?.mode || "none";
    if (mode !== "once" && mode !== "twice") {
      return res.json({ ok: true, mode, viewsLeft: msg?.ephemeral?.viewsLeft || 0 });
    }

    const left = Number(msg?.ephemeral?.viewsLeft || 0);
    const nextLeft = Math.max(0, left - 1);

    msg.ephemeral.viewsLeft = nextLeft;
    await room.save();

    const io = getIO();
    io?.to(roomId).emit("chat:ephemeral:update", {
      roomId,
      msgId: String(msgId),
      viewsLeft: nextLeft,
    });
// ✅ when finished => permanently delete message from room + insert system bubble
let systemMessage = null;

if (nextLeft === 0) {
  // remove the ephemeral media message for BOTH sides
  room.messages.splice(idx, 1);

  // add a "removal notice" bubble (deletable via scope=me)
  const label = mode === "once" ? "View once" : "View twice";

  systemMessage = {
    id: shortid.generate(),
    from: "system",
    to: "system",
    text: `🔒 ${label} media was opened and removed`,
    type: "text",
    time: new Date(),
    edited: false,
    deleted: false,
    system: true,
    reactions: {},
    hiddenFor: [],
    ephemeral: { mode: "none", viewsLeft: 0 },
    gift: {
      locked: false,
      stickerId: "sticker_basic",
      amount: 0,
      unlockedBy: [],
    },
  };

  room.messages.push(systemMessage);
  await room.save();

  io?.to(roomId).emit("chat:ephemeral:expired", {
    roomId,
    msgId: String(msgId),
    systemMessage,
  });
}

return res.json({ ok: true, mode, viewsLeft: nextLeft, systemMessage });

  } catch (err) {
    console.error("❌ viewed error:", err);
    return res.status(500).json({ error: "failed" });
  }
});

// ============================================================
// 🎁 UNLOCK GIFT-LOCKED CHAT MEDIA
// POST /api/chat/rooms/:roomId/:msgId/unlock
// Server-authoritative:
// - frontend does NOT choose unlock price here
// - price comes from msg.gift.priceBC saved when sender created media
// - receiver pays once, then media stays unlocked forever
// ============================================================
router.post("/chat/rooms/:roomId/:msgId/unlock", authMiddleware, async (req, res) => {
  try {
    const { roomId, msgId } = req.params;
    const me = String(req.user.id);

    if (!(await enforceChatAllowed(req, res))) return;
    if (!(await enforceGiftsAllowed(req, res))) return;

    const room = await getRoomDoc(roomId);
    const participants = (room?.participants || []).map((x) => String(x));

    if (!participants.includes(me)) {
      return res.status(403).json({ error: "forbidden" });
    }

    const msg = (room.messages || []).find((m) => String(m.id) === String(msgId));
    if (!msg) return res.status(404).json({ error: "not_found" });

    // ✅ only receiver can unlock paid media
    if (String(msg.to) !== me) {
      return res.status(403).json({ error: "only_receiver_can_unlock" });
    }

    if (!msg?.gift?.locked) {
      return res.json({
        ok: true,
        locked: false,
        alreadyUnlocked: true,
        message: msg,
      });
    }

    msg.gift.unlockedBy ||= [];

    if (msg.gift.unlockedBy.map(String).includes(me)) {
      msg.gift.locked = false;
      await room.save();

      return res.json({
        ok: true,
        locked: false,
        alreadyUnlocked: true,
        message: msg,
      });
    }

    const priceBC = normalizeGiftUnlockPrice(
      msg?.gift?.priceBC ?? msg?.gift?.amount ?? 0
    );

    if (priceBC <= 0) {
      return res.status(400).json({
        error: "invalid_unlock_price",
        message: "This gifted media does not have a valid BuzzCoin unlock price.",
      });
    }

    const transactionId = `chat_media_unlock_${shortid.generate()}`;
    const ownerId = String(msg.from || "");

    const wallet = await debitBuzzCoins({
      userId: me,
      amountBC: priceBC,
      type: "gift_send",
      source: "chat_media_unlock",
      referenceId: transactionId,
      reason: "Unlocked gifted chat media",
      metadata: {
        roomId: String(roomId),
        msgId: String(msgId),
        mediaType: String(msg.mediaType || ""),
        senderId: ownerId,
        receiverId: me,
      },
    });

      await creditBuzzCoins({
      userId: ownerId,
      amountBC: priceBC,
      type: "gift_receive",
      source: "chat_media_unlock",
      referenceId: transactionId,
      reason: "Earned BuzzCoin from unlocked gifted chat media",
      walletBucket: "earned",
      metadata: {
        roomId: String(roomId),
        msgId: String(msgId),
        mediaType: String(msg.mediaType || ""),
        senderId: ownerId,
        buyerId: me,
      },
    });

    await MediaGift.create({
      id: shortid.generate(),
      mediaId: String(msg.id),
      ownerId,
      fromId: me,

      giftId: "chat_media_unlock",
      priceBC,
      placement: "chat",
      targetType: "chat_media",
      targetId: String(msg.id),
      transactionId,
      status: "completed",

      // ✅ Chat gifted-media history fields
      roomId: String(roomId),
      msgId: String(msgId),
      mediaType: String(msg.mediaType || ""),
      buyerId: me,
      sellerId: ownerId,

      stickerId: String(msg?.gift?.stickerId || "sticker_basic"),
      amount: priceBC,
      createdAt: Date.now(),
    });

    msg.gift.locked = false;
    msg.gift.amount = priceBC;
    msg.gift.priceBC = priceBC;
    msg.gift.currency = "BC";
    msg.gift.unlockedAt = new Date();
    msg.gift.unlockTransactionId = transactionId;

    if (!msg.gift.unlockedBy.map(String).includes(me)) {
      msg.gift.unlockedBy.push(me);
    }

     await room.save();

    const updatedMessage = msg.toObject ? msg.toObject() : { ...msg };
    const signedUpdatedMessage = await signChatMessageMedia(updatedMessage, 3600);

      const io = getIO();
    io?.to(roomId).emit("chat:gift:unlocked", {
      roomId,
      msgId: String(msgId),
      unlockedBy: me,
      ownerId,
      priceBC,
      transactionId,
      message: signedUpdatedMessage,
    });

    return res.json({
      ok: true,
      locked: false,
      ownerId,
      priceBC,
      transactionId,
      wallet,
      message: signedUpdatedMessage,
    });
  } catch (err) {
    console.error("❌ unlock error:", err);

    const status = err?.statusCode || 500;
    return res.status(status).json({
      error: err?.code || "failed",
      message: err?.message || "Failed to unlock gifted media.",
      balanceBC: err?.balanceBC,
      requiredBC: err?.requiredBC,
    });
  }
});

// ============================================================
// ✅ UNREAD HELPERS + ENDPOINTS (server-accurate, cross-device)
// ============================================================

function buildRoomId(userA, userB) {
  return [String(userA), String(userB)].sort().join("_");
}

function legacyRoomId(userA, userB) {
  return [String(userA), String(userB)].sort().join("__");
}

function countUnreadForRoom(room, me) {
  const myId = String(me);
  const prefs = getMyRoomPrefs(room, myId);

  const lastRead =
    (room.lastReadAtByUser?.get && room.lastReadAtByUser.get(myId)) ||
    (room.lastReadAtByUser && room.lastReadAtByUser[myId]) ||
    new Date(0);

  const msgs = room.messages || [];
  let n = 0;

  for (const m of msgs) {
    if (!m) continue;
    if (String(m.to) !== myId) continue;
    if (m.deleted) continue;
    if (m.hiddenFor?.includes?.(myId)) continue;

    const t = new Date(m.time || 0);
    if (t > new Date(lastRead || 0)) n++;
  }

  // ✅ Manual "Mark as unread" should show a badge even if there are no new messages.
  if (n === 0 && prefs.forceUnread) return 1;

  return n;
}

async function computeUnreadSummaryForUser(userId) {
  const me = String(userId);
  const rooms = await ChatRoom.find({ participants: me }).lean(false);

  const byPeer = {};
  let total = 0;

  for (const room of rooms) {
    const participants = room.participants || [];
    const peerId = String(participants.find((p) => String(p) !== me) || "");

    if (!peerId) continue;
    const c = countUnreadForRoom(room, me);
    if (c > 0) byPeer[peerId] = c;
    total += c;
  }

  return { total, byPeer };
}


// ============================================================
// GET /api/chat/unread-summary
// ============================================================
router.get("/chat/unread-summary", authMiddleware, async (req, res) => {
  try {
    const me = String(req.user.id);

    if (!(await enforceChatAllowed(req, res))) return;

    const summary = await computeUnreadSummaryForUser(me);
    return res.json(summary);
  } catch (err) {
    console.error("❌ unread-summary error:", err);
    return res.status(500).json({ error: "failed" });
  }
});


// ============================================================
// POST /api/chat/mark-read
// body: { peerId: "..." }
// ============================================================
router.post("/chat/mark-read", authMiddleware, async (req, res) => {
  try {
    const me = String(req.user.id);
    const { peerId } = req.body || {};
    if (!peerId) return res.status(400).json({ error: "peerId required" });

    if (!(await enforceChatAllowed(req, res))) return;

    const rid = buildRoomId(me, peerId);
    const ridLegacy = legacyRoomId(me, peerId);

    const room =
      (await ChatRoom.findOne({ roomId: rid })) ||
      (await ChatRoom.findOne({ roomId: ridLegacy }));

    if (!room) return res.status(404).json({ error: "Room not found" });

    if (!room.lastReadAtByUser) room.lastReadAtByUser = new Map();
    room.lastReadAtByUser.set(me, new Date());
    await room.save();

    const summary = await computeUnreadSummaryForUser(me);

    // ✅ optional realtime update back to this user (all devices)
    const io = getIO();
    const sid = onlineUsers?.[me];
    if (sid) io.to(sid).emit("chat:unread:update", summary);
    io.to(String(me)).emit("chat:unread:update", summary);

    return res.json({ ok: true, summary });
  } catch (err) {
    console.error("❌ mark-read error:", err);
    return res.status(500).json({ error: "failed" });
  }
});


// ============================================================
// POST /api/chat/mark-all-read
// Marks ALL conversations as read for authenticated user
// (used when tapping Chat tab -> clear total badge to 0)
// ============================================================
router.post("/chat/mark-all-read", authMiddleware, async (req, res) => {
  try {
    const me = String(req.user.id);
    const now = new Date();

    if (!(await enforceChatAllowed(req, res))) return;

    const rooms = await ChatRoom.find({ participants: me }).lean(false);

    for (const room of rooms) {
      if (!room.lastReadAtByUser) room.lastReadAtByUser = new Map();
      room.lastReadAtByUser.set(me, now);
      await room.save();
    }

    const summary = await computeUnreadSummaryForUser(me);

    // ✅ push updated summary to this user (all devices)
    const io = getIO();
    const sid = onlineUsers?.[me];
    if (sid) io.to(sid).emit("chat:unread:update", summary);
    io.to(String(me)).emit("chat:unread:update", summary);

     return res.json({ ok: true, summary });
  } catch (err) {
    console.error("❌ mark-all-read error:", err);
    return res.status(500).json({ error: "failed" });
  }
});


// ============================================================
// ✨ AI REPLY SUGGESTIONS (manual trigger only)
// POST /api/chat/rooms/:roomId/reply-suggestions
// body: { mode?: "natural"|"flirty"|"funny"|"safe", count?: number }
// ============================================================
router.post("/chat/rooms/:roomId/reply-suggestions", authMiddleware, async (req, res) => {
  try {
    const { roomId } = req.params;
    const me = String(req.user.id);
    const { mode = "natural", count = 4 } = req.body || {};

    if (!(await enforceChatAllowed(req, res))) return;

    const room = await getRoomDoc(roomId);
    const participants = (room?.participants || []).map((x) => String(x));

    if (!participants.includes(me)) {
      return res.status(403).json({ error: "forbidden" });
    }

    const visible = (room.messages || [])
      .map((m) => summarizeReplyIdeaMessage(m, me))
      .filter(Boolean)
      .slice(-20);

    // ...
  } catch (err) {
    console.error("❌ reply-suggestions error:", err);
    return res.status(500).json({ error: "failed" });
  }
});

// ============================================================
// ⚙️ CHAT LIST PREFERENCES
// PATCH /api/chat/rooms/:roomId/prefs
// body: {
//   pinned?: boolean,
//   muted?: boolean,
//   alertOnline?: boolean,
//   forceUnread?: boolean,
//   deletedForMe?: boolean
// }
// ============================================================
router.patch("/chat/rooms/:roomId/prefs", authMiddleware, async (req, res) => {
  try {
    const { roomId } = req.params;
    const me = String(req.user.id);

    if (!(await enforceChatAllowed(req, res))) return;

    const room = await getRoomDoc(roomId);

    const participants = (room.participants || []).map((x) => String(x));
    if (!participants.includes(me)) {
      return res.status(403).json({ error: "forbidden" });
    }

    const allowed = {};
    ["pinned", "muted", "alertOnline", "forceUnread", "deletedForMe"].forEach((key) => {
      if (typeof req.body?.[key] === "boolean") {
        allowed[key] = req.body[key];
      }
    });

    const prefs = setMyRoomPrefs(room, me, allowed);

    // ✅ If user marks read, forceUnread must go false.
    if (allowed.forceUnread === false) {
      if (!room.lastReadAtByUser) room.lastReadAtByUser = new Map();
      room.lastReadAtByUser.set(me, new Date());
    }

    // ✅ If user manually deletes/hides chat from chat list, hide existing messages for this user too.
    if (allowed.deletedForMe === true) {
      room.messages.forEach((m) => {
        if (!m.hiddenFor?.includes(me)) m.hiddenFor.push(me);
      });
    }

    await room.save();

    const summary = await computeUnreadSummaryForUser(me);

    const io = getIO();
    const sid = onlineUsers?.[me];
    if (sid) io.to(sid).emit("chat:unread:update", summary);
    io.to(String(me)).emit("chat:unread:update", summary);

    return res.json({ ok: true, prefs, summary });
  } catch (err) {
    console.error("❌ chat prefs error:", err);
    return res.status(500).json({ error: "failed" });
  }
});


// ============================================================
// 🚫 UNMATCH FROM CHAT LIST
// POST /api/chat/rooms/:roomId/unmatch
// Removes the match immediately and hides the chat for the current user.
// ============================================================
router.post("/chat/rooms/:roomId/unmatch", authMiddleware, async (req, res) => {
  try {
    const { roomId } = req.params;
    const me = String(req.user.id);

    if (!(await enforceChatAllowed(req, res))) return;

    const room = await getRoomDoc(roomId);

    const participants = (room.participants || []).map((x) => String(x));
    if (!participants.includes(me)) {
      return res.status(403).json({ error: "forbidden" });
    }

    const peerId = participants.find((x) => String(x) !== me);
    if (!peerId) return res.status(400).json({ error: "peer_not_found" });

    // ✅ Use match/unmatch logic: remove match relationship immediately.
    await Match.deleteMany({
      users: { $all: [me, peerId] },
    });

    // ✅ Hide conversation from current user.
    setMyRoomPrefs(room, me, {
      deletedForMe: true,
      pinned: false,
      muted: false,
      alertOnline: false,
      forceUnread: false,
    });

    room.messages.forEach((m) => {
      if (!m.hiddenFor?.includes(me)) m.hiddenFor.push(me);
    });

    await room.save();

    const summary = await computeUnreadSummaryForUser(me);

    const io = getIO();
    const mySid = onlineUsers?.[me];
    if (mySid) io.to(mySid).emit("chat:unread:update", summary);
    io.to(String(me)).emit("chat:unread:update", summary);

    const peerSid = onlineUsers?.[peerId];
    if (peerSid) {
      io.to(peerSid).emit("match:unmatched", { from: me, peerId: me, roomId });
    }

    return res.json({ ok: true, peerId, summary });
  } catch (err) {
    console.error("❌ chat unmatch error:", err);
    return res.status(500).json({ error: "failed" });
  }
});

module.exports = router;
