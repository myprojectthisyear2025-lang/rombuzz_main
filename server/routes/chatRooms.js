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
const { appendMessage, validKey, authorizeRoom, ensureRoom, markRoomsRead, findActiveChatUser, isChatMatchActive } = require("../services/chatPersistence");
const { buildChatMessage } = require("../services/chatMessageBuilder");
const { computeUnreadSummaryForUser } = require("../services/chatUnread");
const { unlockChatMedia } = require("../services/chatMediaUnlock");
const User = require("../models/User");
const Match = require("../models/Match");
const Relationship = require("../models/Relationship");

const {
  deleteStoredR2ObjectBestEffort,
  getStoredMediaR2Key,
} = require("../utils/r2Media");
const {
  deleteCloudflareStreamVideoBestEffort,
} = require("../services/cloudflareStreamService");

// ✅ Proper Socket.IO + state wiring
const { getIO } = require("../socket");
const { onlineUsers } = require("../models/state");

// =======================
// 🧩 Utilities
// =======================

const { signChatMessageMedia, signChatMessages, getChatMessageStoredMedia, isChatR2KeyStillReferenced, getChatMessageStreamUid, isChatStreamUidStillReferenced } = require("../services/chatMessageMedia");

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

async function enforceActiveRoomPeer(req, res, roomId) {
  try { return await authorizeRoom(roomId, String(req.user?.id || "")); }
  catch (err) {
    const status = { forbidden: 403, blocked: 403, not_matched: 409, user_not_found: 404 }[err.message];
    if (!status) throw err;
    res.status(status).json({ error: err.message, message: "This conversation is no longer available." });
    return null;
  }
}

// ✅ Existing-room actions must never create a brand-new empty room.
async function getExistingActiveRoom(req, res, roomId) {
  const activePeer = await enforceActiveRoomPeer(req, res, roomId);
  if (!activePeer) return null;

  const room = await ChatRoom.findOne({ roomId });

  if (!room) {
    res.status(404).json({ error: "Room not found" });
    return null;
  }

  return {
    room,
    peerId: activePeer.peerId,
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

const DEFAULT_CHAT_PAGE_SIZE = 40;
const MAX_CHAT_PAGE_SIZE = 80;

function wantsPaginatedChatResponse(query = {}) {
  return (
    query?.limit !== undefined ||
    query?.before !== undefined ||
    String(query?.paginated || "") === "1"
  );
}

function parseChatPageSize(value) {
  const parsed = Math.floor(Number(value) || DEFAULT_CHAT_PAGE_SIZE);
  return Math.max(10, Math.min(MAX_CHAT_PAGE_SIZE, parsed));
}

async function getPaginatedVisibleMessages(roomId, userId, options = {}) {
  const limit = parseChatPageSize(options?.limit);
  const before = String(options?.before || "").trim();
  const cursorRequested = !!before;
  const fetchCount = limit + 1;

  const [page] = await ChatRoom.aggregate([
    {
      $match: {
        roomId: String(roomId || ""),
      },
    },
    {
      $project: {
        _id: 0,
        messages: {
          $filter: {
            input: {
              $ifNull: ["$messages", []],
            },
            as: "message",
            cond: {
              $eq: [
                {
                  $indexOfArray: [
                    {
                      $ifNull: ["$$message.hiddenFor", []],
                    },
                    String(userId || ""),
                  ],
                },
                -1,
              ],
            },
          },
        },
      },
    },
    {
      $project: {
        messages: 1,
        messageCount: {
          $size: "$messages",
        },
        reverseCursorIndex: cursorRequested
          ? {
              $indexOfArray: [
                {
                  $reverseArray: {
                    $map: {
                      input: "$messages",
                      as: "message",
                      in: "$$message.id",
                    },
                  },
                },
                before,
              ],
            }
          : -1,
      },
    },
    {
      $project: {
        messages: 1,
        cursorFound: cursorRequested
          ? {
              $gte: ["$reverseCursorIndex", 0],
            }
          : true,
        eligibleCount: cursorRequested
          ? {
              $cond: [
                {
                  $gte: ["$reverseCursorIndex", 0],
                },
                {
                  $subtract: [
                    {
                      $subtract: ["$messageCount", 1],
                    },
                    "$reverseCursorIndex",
                  ],
                },
                0,
              ],
            }
          : "$messageCount",
      },
    },
    {
      $project: {
        messages: 1,
        cursorFound: 1,
        eligibleCount: 1,
        startIndex: {
          $max: [
            0,
            {
              $subtract: ["$eligibleCount", fetchCount],
            },
          ],
        },
        sliceCount: {
          $min: ["$eligibleCount", fetchCount],
        },
      },
    },
    {
      $project: {
        cursorFound: 1,
        eligibleCount: 1,
        startIndex: 1,
        messages: {
          $cond: [
            {
              $gt: ["$sliceCount", 0],
            },
            {
              $slice: ["$messages", "$startIndex", "$sliceCount"],
            },
            [],
          ],
        },
      },
    },
  ]);

  if (!page) return null;

  if (cursorRequested && !page.cursorFound) {
    return {
      messages: [],
      hasMore: false,
      nextCursor: null,
      cursorInvalid: true,
    };
  }

  const deduped = dedupeMessagesById(page.messages || []);
  const hasExtraFetchedMessage = deduped.length > limit;

  const messages = hasExtraFetchedMessage
    ? deduped.slice(-limit)
    : deduped;

  const hasMore =
    messages.length > 0 &&
    (hasExtraFetchedMessage || Number(page.startIndex || 0) > 0);

  return {
    messages,
    hasMore,
    nextCursor: hasMore
      ? String(messages[0]?.id || "") || null
      : null,
    cursorInvalid: false,
  };
}

async function getRoomDoc(roomId, actorId) {
  let room = await ChatRoom.findOne({ roomId });

  if (!room) {
    const { participants } = await authorizeRoom(roomId, String(actorId));
    await ensureRoom(roomId, participants);
    room = await ChatRoom.findOne({ roomId });
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

    const activePeer = await enforceActiveRoomPeer(req, res, roomId);
    if (!activePeer) return;

    // ✅ Paginated requests are used by the main mobile chat thread.
    // Existing requests without limit/before still receive the original
    // complete message array, preserving older clients and feature screens.
    if (wantsPaginatedChatResponse(req.query)) {
      let page = await getPaginatedVisibleMessages(roomId, userId, {
        limit: req.query?.limit,
        before: req.query?.before,
      });

      // Preserve the existing behavior for a brand-new conversation:
      // opening it creates an empty room instead of returning 404.
      if (!page) {
        const room = await getRoomDoc(roomId, userId);

        if (!room) {
          return res.status(404).json({
            error: "Room not found",
          });
        }

        page = {
          messages: [],
          hasMore: false,
          nextCursor: null,
          cursorInvalid: false,
        };
      }

      // Only media belonging to this page is signed.
      const signedPage = await signChatMessages(page.messages, 3600);

      return res.json({
        paginated: true,
        messages: signedPage,
        hasMore: !!page.hasMore,
        nextCursor: page.nextCursor || null,
        cursorInvalid: !!page.cursorInvalid,
      });
    }

    // ✅ Legacy full-history response remains unchanged.
    // Shared Media, Purchased Media, Pinned Messages and older clients
    // continue receiving the original array response.
    const room = await getRoomDoc(roomId, userId);

    if (!room) {
      return res.status(404).json({
        error: "Room not found",
      });
    }

    // ✅ Ephemeral messages are not deleted while fetching.
    // They are deleted only after the receiver views them.
    const visible = (room.messages || []).filter((message) => {
      if (message.hiddenFor?.includes(userId)) return false;
      return true;
    });

    const dedupedVisible = dedupeMessagesById(visible);
    const signedVisible = await signChatMessages(dedupedVisible, 3600);

    return res.json(signedVisible);
  } catch (err) {
    console.error("❌ GET chat room error:", err);

    return res.status(500).json({
      error: "Failed to load messages",
    });
  }
});

// ============================================================
// 📤 SEND MESSAGE
// ============================================================
router.post("/chat/rooms/:roomId", authMiddleware, async (req, res) => {
  try {
    const { roomId } = req.params;
    const { text, replyTo } = req.body || {};
    if (typeof text !== "string" || !text) return res.status(400).json({ error: "text required" });
    if (req.body?.id !== undefined && !validKey(req.body.id)) return res.status(400).json({ error: "invalid_message_id" });

    if (!(await enforceChatAllowed(req, res))) return;

    const activePeer = await enforceActiveRoomPeer(req, res, roomId);
    if (!activePeer) return;

    const fromId = String(req.user.id);
    const toId = String(activePeer.peerId);

    const blocked = await isChatBlocked(fromId, toId);
    if (blocked) {
      return res.status(403).json({
        error: "blocked",
        message: "Message failed. You cannot send messages to this user.",
      });
    }

// ✅ Detect ephemeral + gift lock from ::RBZ:: payload
const msg = buildChatMessage({ text, replyTo, fromId, toId, id: req.body?.id });

const saved = await appendMessage(roomId, [fromId, toId], msg);
const signedMsg = await signChatMessageMedia(saved.message, 3600);

// ✅ Socket events (room + direct)
const io = getIO();

// 🔥 FIX: Emit chat:message (frontend listens for this)
io.to(roomId).emit("chat:message", signedMsg);

// 🔥 Also send to peer's private room in case they are not in the chat room
const sid = onlineUsers?.[toId];
if (sid) {
  io.to(sid).emit("chat:message", signedMsg);
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

// ✅ The message is already validated, persisted, signed, and emitted.
// Return success immediately so Reel sharing does not wait for the
// receiver's full unread-summary database calculation.
res.json({ message: signedMsg });

// ✅ Keep unread badges server-accurate without blocking the sender.
computeUnreadSummaryForUser(String(toId))
  .then((summary) => {
    if (sid) {
      io.to(sid).emit("chat:unread:update", summary);
    }

    io.to(String(toId)).emit("chat:unread:update", summary);
  })
  .catch((e) => {
    console.warn(
      "unread summary emit failed:",
      e?.message || e
    );
  });

return;
  } catch (err) {
    console.error("❌ POST message error:", err);
    res.status(500).json({ error: "Failed to send message" });
  }
});

// ============================================================
// ✍️ EDIT MESSAGE
// ============================================================
router.patch("/chat/rooms/:roomId/:msgId", authMiddleware, async (req, res, next) => {
  // The named preference endpoint below must not be consumed as a message id.
  if (req.params.msgId === "prefs") return next("route");
  try {
    const { roomId, msgId } = req.params;
    const { text } = req.body || {};
    if (!text) return res.status(400).json({ error: "text required" });

    if (!(await enforceChatAllowed(req, res))) return;

    const activeRoom = await getExistingActiveRoom(req, res, roomId);
    if (!activeRoom) return;

    const room = activeRoom.room;
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

    const activeRoom = await getExistingActiveRoom(req, res, roomId);
    if (!activeRoom) return;

    const room = activeRoom.room;
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

      const storedMedia = getChatMessageStoredMedia(msg);
      const r2Key = getStoredMediaR2Key(storedMedia);
      const streamUid = getChatMessageStreamUid(msg);

      const r2StillReferenced = r2Key
        ? isChatR2KeyStillReferenced(room, r2Key, msgId)
        : false;

      const streamStillReferenced = streamUid
        ? isChatStreamUidStillReferenced(room, streamUid, msgId)
        : false;

      // ✅ permanently remove from MongoDB first
      room.messages.splice(msgIndex, 1);
      await room.save();

      // ✅ best-effort Cloudflare R2 cleanup only for unsend/delete-for-all
      // Do NOT delete for scope=me because the other user may still need the file.
      const storageDelete = r2Key && !r2StillReferenced
        ? await deleteStoredR2ObjectBestEffort(storedMedia, `chat:${roomId}:${msgId}`)
        : {
            deleted: false,
            provider: r2Key ? "r2" : "",
            key: r2Key || "",
            reason: r2StillReferenced ? "still_referenced" : "no_r2_key",
          };

      // ✅ best-effort Cloudflare Stream cleanup for chat videos.
      // Old Cloudinary videos are skipped safely.
      const streamDelete = streamUid && !streamStillReferenced
        ? await deleteCloudflareStreamVideoBestEffort(streamUid, `chat:${roomId}:${msgId}`)
        : {
            deleted: false,
            provider: streamUid ? "cloudflare_stream" : "",
            streamUid: streamUid || "",
            reason: streamStillReferenced ? "still_referenced" : "no_stream_uid",
          };

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

       return res.json({
        ok: true,
        removedId: String(msgId),
        storageDelete,
        streamDelete,
      });
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

    const activeRoom = await getExistingActiveRoom(req, res, roomId);
    if (!activeRoom) return;

    const room = activeRoom.room;

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

    const activeRoom = await getExistingActiveRoom(req, res, roomId);
    if (!activeRoom) return;

    const room = activeRoom.room;
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

    const activeRoom = await getExistingActiveRoom(req, res, roomId);
    if (!activeRoom) return;

    const room = activeRoom.room;
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

    const activeRoom = await getExistingActiveRoom(req, res, roomId);
    if (!activeRoom) return;

    const room = activeRoom.room;
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

    if (!(await enforceActiveRoomPeer(req, res, roomId))) return;

    const result = await unlockChatMedia({ roomId, msgId, buyerId: me });
    const signedUpdatedMessage = await signChatMessageMedia(result.message, 3600);

    // Payment has committed. Replaying this idempotent event on a retry also
    // repairs clients that missed the first response/event after commit.
    if (result.transactionId) {
      getIO()?.to(roomId).emit("chat:gift:unlocked", {
        roomId,
        msgId: String(msgId),
        unlockedBy: me,
        ownerId: result.ownerId,
        priceBC: result.priceBC,
        transactionId: result.transactionId,
        message: signedUpdatedMessage,
      });
    }
    return res.json({ ...result, message: signedUpdatedMessage });
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

    const cleanPeerId = String(peerId || "").trim();

    const [peer, matched] = await Promise.all([
      findActiveChatUser(cleanPeerId),
      isChatMatchActive(me, cleanPeerId),
    ]);

    if (!peer) {
      return res.status(404).json({
        error: "user_not_found",
        message: "This user is no longer available.",
      });
    }

    if (!matched) {
      return res.status(409).json({
        error: "not_matched",
        message: "This conversation is no longer available.",
      });
    }

    const rid = buildRoomId(me, cleanPeerId);
    const ridLegacy = legacyRoomId(me, cleanPeerId);

    const room =
      (await ChatRoom.findOne({ roomId: rid })) ||
      (await ChatRoom.findOne({ roomId: ridLegacy }));

    if (!room) return res.status(404).json({ error: "Room not found" });

    await markRoomsRead(me, room.roomId);

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

    if (!(await enforceChatAllowed(req, res))) return;

    await markRoomsRead(me);

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

    const activeRoom = await getExistingActiveRoom(req, res, roomId);
    if (!activeRoom) return;

    const room = activeRoom.room;
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

    const activeRoom = await getExistingActiveRoom(req, res, roomId);
    if (!activeRoom) return;

    const room = activeRoom.room;

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

    const activeRoom = await getExistingActiveRoom(req, res, roomId);
    if (!activeRoom) return;

    const room = activeRoom.room;

    const participants = (room.participants || []).map((x) => String(x));
    if (!participants.includes(me)) {
      return res.status(403).json({ error: "forbidden" });
    }

    const peerId = participants.find((x) => String(x) !== me);
    if (!peerId) return res.status(400).json({ error: "peer_not_found" });

    // ✅ Remove both current and legacy match document shapes.
    await Match.deleteMany({
      $or: [
        { users: { $all: [me, peerId] } },
        { user1: me, user2: peerId },
        { user1: peerId, user2: me },
      ],
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
