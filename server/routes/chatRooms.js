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
const ChatRoom = require("../models/ChatRoom");
const MediaGift = require("../models/MediaGift");

// ✅ Proper Socket.IO + state wiring
const { getIO } = require("../socket");
const { onlineUsers } = require("../models/state");


// =======================
// 🧩 Utilities
// =======================

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


// Ensure ChatRoom exists or create new
async function getRoomDoc(roomId) {
  let room = await ChatRoom.findOne({ roomId });
  if (!room) {
    const { a, b } = getPeersFromRoomId(roomId);
    room = await ChatRoom.create({
      roomId,
      participants: [a, b],
      messages: [],
    });
  }
  return room;
}

// ============================================================
// 💬 GET CHAT ROOM MESSAGES
// ============================================================
router.get("/chat/rooms/:roomId", authMiddleware, async (req, res) => {
  try {
    const { roomId } = req.params;
    const userId = req.user.id;

    const room = await getRoomDoc(roomId);
    if (!room) return res.status(404).json({ error: "Room not found" });

   // ✅ Return messages that are NOT hidden for me
// ✅ Ephemeral messages are NOT deleted on fetch.
// ✅ They are deleted ONLY after receiver views (via /viewed endpoint).
const visible = (room.messages || []).filter((m) => {
  if (m.hiddenFor?.includes(userId)) return false;
  return true;
});

res.json(visible);

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
    const { text } = req.body || {};
    if (!text) return res.status(400).json({ error: "text required" });

    const { a, b } = getPeersFromRoomId(roomId);
    if (![a, b].includes(req.user.id))
      return res.status(403).json({ error: "forbidden" });

    const fromId = req.user.id;
    const toId = fromId === a ? b : a;

// ✅ Detect ephemeral + gift lock from ::RBZ:: payload
let epMode = "none";
let viewsLeft = 0;

let giftLocked = false;
let giftStickerId = "sticker_basic";
let giftAmount = 0;

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
      giftAmount = Number(payload?.gift?.amount || 0);
    }
  } catch (e) {
    console.warn("RBZ payload parse failed:", e);
  }
}


const msg = {
  id: shortid.generate(),
  from: fromId,
  to: toId,
  text,
  type: text.startsWith("::RBZ::") ? "media" : "text",
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
  unlockedBy: [],
},
};

const room = await getRoomDoc(roomId);
room.messages.push(msg);
await room.save();

// ✅ Socket events (room + direct)
const io = getIO();

// 🔥 FIX: Emit chat:message (frontend listens for this)
io.to(roomId).emit("chat:message", msg);

// 🔥 Also send to peer's private room in case they are not in the chat room
const sid = onlineUsers?.[toId];
if (sid) {
  io.to(sid).emit("chat:message", msg);
}

// 🔥 Navbar/unread bubble handler
if (sid) {
  io.to(sid).emit("direct:message", {
    id: msg.id,
    roomId,
    from: fromId,
    to: toId,
    time: msg.time,
    preview: (msg.text || "").slice(0, 80),
    type: msg.type || "text",
  });
}


    res.json({ message: msg });
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

    const room = await getRoomDoc(roomId);
// 🚫 no reactions allowed on system bubbles
if (msg.system) {
  return res.status(400).json({ error: "cannot_react_to_system" });
}

    if (msg.from !== req.user.id) return res.status(403).json({ error: "not owner" });

    const oneHour = 60 * 60 * 1000;
    if (Date.now() - new Date(msg.time).getTime() > oneHour)
      return res.status(400).json({ error: "edit window expired" });

   msg.text = text;
msg.edited = true;
await room.save();

const io = getIO();
io.to(roomId).emit("message:edit", { msgId, text });
res.json({ ok: true });

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

    const room = await getRoomDoc(roomId);
    const msg = room.messages.find((m) => m.id === msgId);
    if (!msg) return res.status(404).json({ error: "not found" });

    if (scope === "me") {
      if (!msg.hiddenFor.includes(req.user.id)) msg.hiddenFor.push(req.user.id);
      await room.save();
      return res.json({ ok: true });
    }

    if (scope === "all") {
      if (msg.from !== req.user.id) return res.status(403).json({ error: "not owner" });
     msg.deleted = true;
msg.text = "This message was unsent";
await room.save();

const io = getIO();
io.to(roomId).emit("message:delete", { msgId });
return res.json({ ok: true });

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

    const room = await getRoomDoc(roomId);
    const msg = room.messages.find((m) => m.id === msgId);
    if (!msg) return res.status(404).json({ error: "not found" });

    msg.reactions = msg.reactions || {};
    if (msg.reactions.get(req.user.id) === emoji) {
      msg.reactions.delete(req.user.id);
    } else {
      msg.reactions.set(req.user.id, emoji);
    }

  await room.save();

const io = getIO();
io.to(roomId).emit("message:react", {
  msgId,
  userId: req.user.id,
  emoji: msg.reactions.get(req.user.id) || null,
});

res.json({ ok: true, reactions: Object.fromEntries(msg.reactions) });

  } catch (err) {
    console.error("❌ REACT message error:", err);
    res.status(500).json({ error: "Failed to react" });
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
// body: { stickerId?, amount? }
// ============================================================
router.post("/chat/rooms/:roomId/:msgId/unlock", authMiddleware, async (req, res) => {
  try {
    const { roomId, msgId } = req.params;
    const me = String(req.user.id);
    const { stickerId = "sticker_basic", amount = 0 } = req.body || {};

    const room = await getRoomDoc(roomId);
    const msg = (room.messages || []).find((m) => String(m.id) === String(msgId));
    if (!msg) return res.status(404).json({ error: "not_found" });

    // ✅ only receiver can unlock
    if (String(msg.to) !== me) return res.status(403).json({ error: "forbidden" });

    // already unlocked
    if (!msg?.gift?.locked) {
      return res.json({ ok: true, locked: false });
    }

    // record gift (reuse existing MediaGift model)
    await MediaGift.create({
      id: shortid.generate(),
      mediaId: String(msg.id),       // treat msgId as mediaId
      ownerId: String(msg.from),     // sender receives gift
      fromId: me,                    // receiver gifts to unlock
      stickerId: String(stickerId),
      amount: Number(amount) || 0,
      createdAt: Date.now(),
    });

    // unlock message for this receiver
    msg.gift.locked = false;
    msg.gift.unlockedBy ||= [];
    if (!msg.gift.unlockedBy.includes(me)) msg.gift.unlockedBy.push(me);

    await room.save();

    const io = getIO();
    io?.to(roomId).emit("chat:gift:unlocked", {
      roomId,
      msgId: String(msgId),
      unlockedBy: me,
    });

    return res.json({ ok: true, locked: false });
  } catch (err) {
    console.error("❌ unlock error:", err);
    return res.status(500).json({ error: "failed" });
  }
});

module.exports = router;

