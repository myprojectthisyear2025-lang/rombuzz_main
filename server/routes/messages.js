/**
 * ============================================================
 * 📁 File: routes/messages.js
 * 💬 Purpose: Legacy/simple RomBuzz direct message route.
 *
 * Endpoint:
 *   POST /api/messages        → Send a direct message or media message
 *
 * Features:
 *   - Authenticated message sending
 *   - Checks chat permission and block status before sending
 *   - Saves messages to MongoDB Message model
 *   - Emits real-time socket events to sender and receiver
 *   - Sends chat push notifications when possible
 *   - Supports text and media URL messages
 *   - Signs private Cloudflare R2 media URLs before returning/emitting
 *
 * Dependencies:
 *   - models/Message.js
 *   - models/User.js
 *   - models/Match.js
 *   - auth-middleware.js
 *   - utils/helpers.js
 *   - utils/moderation.js
 *   - utils/r2Media.js
 *
 * Notes:
 *   - This is a legacy/simple message route.
 *   - Main chat room logic lives in routes/chatRooms.js.
 *   - Keep this route R2-safe in case older clients or fallback flows still use /api/messages.
 * ============================================================
 */

const express = require("express");
const router = express.Router();
const shortid = require("shortid");
const authMiddleware = require("../routes/auth-middleware");
const { isBlocked, sendChatMessagePush } = require("../utils/helpers");
const {
  ensureFeatureAllowed,
  sendFeatureRestrictionError,
} = require("../utils/moderation");
const Message = require("../models/Message");
const User = require("../models/User");
const Match = require("../models/Match");
const { getSignedMediaUrl, isR2Key } = require("../utils/r2Media");
const { io, onlineUsers } = global;

function normalizeMediaString(value = "") {
  return String(value || "").trim();
}

async function signR2Value(value, expiresInSeconds = 3600) {
  const raw = normalizeMediaString(value);
  if (!raw) return null;
  if (!isR2Key(raw)) return raw;

  return getSignedMediaUrl(raw, expiresInSeconds);
}

async function signMessageMedia(message = {}, expiresInSeconds = 3600) {
  const base =
    typeof message?.toObject === "function"
      ? message.toObject({ flattenMaps: true })
      : { ...(message || {}) };

  const rawUrl = normalizeMediaString(base.url || "");
  const key = isR2Key(rawUrl) ? rawUrl : "";

  if (!key) return base;

  return {
    ...base,
    url: await getSignedMediaUrl(key, expiresInSeconds),
    r2Key: key,
  };
}

async function findActiveMessageUser(userId) {
  const id = String(userId || "").trim();
  if (!id) return null;

  return User.findOne({
    id,
    visibility: { $ne: "pending_delete" },
    deleteStatus: { $ne: "pending_delete" },
  })
    .select("id firstName lastName settings pushTokens pushToken")
    .lean();
}

async function isMessageMatchActive(userA, userB) {
  const a = String(userA || "").trim();
  const b = String(userB || "").trim();

  if (!a || !b || a === b) return false;

  const match = await Match.exists({
    $or: [
      { users: { $all: [a, b] } },

      {
        status: "matched",
        user1: a,
        user2: b,
      },

      {
        status: "matched",
        user1: b,
        user2: a,
      },
    ],
  });

  return !!match;
}

router.post("/", authMiddleware, async (req, res) => {
  try {
    const { to, text, type, url, ephemeral } = req.body || {};
    const from = req.user.id;

    try {
      await ensureFeatureAllowed(from, "chat");
    } catch (err) {
      return sendFeatureRestrictionError(res, err);
    }

    if (!to) return res.status(400).json({ error: "recipient required" });
    if (!text && !url) {
      return res.status(400).json({ error: "either text or media url required" });
    }

    const toId = String(to || "").trim();
    const fromId = String(from || "").trim();

    if (await isBlocked(fromId, toId)) {
      return res.status(403).json({ error: "blocked" });
    }

    const [sender, recipient, matched] = await Promise.all([
      findActiveMessageUser(fromId),
      findActiveMessageUser(toId),
      isMessageMatchActive(fromId, toId),
    ]);

    if (!recipient) {
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

    const msgType = type || (url ? "photo" : "text");
    const createdAt = new Date();
    const msg = await Message.create({
      id: shortid.generate(),
      from: fromId,
      to: toId,
      text: text || "",
      type: msgType,
      url: url || null,
      ephemeral: ephemeral || "keep",
      createdAt,
    });

      const signedMsg = await signMessageMedia(msg, 3600);

    const livePayload = {
      id: signedMsg.id,
      roomId: [String(signedMsg.from), String(signedMsg.to)].sort().join("_"),
      from: signedMsg.from,
      to: signedMsg.to,
      time: new Date(signedMsg.createdAt).toISOString(),
      preview: (signedMsg.text || "").slice(0, 80),
      type: msgType,
    };

    const receiverSocket = onlineUsers?.[toId];
    if (receiverSocket) {
      io?.to(receiverSocket).emit("message", signedMsg);
      io?.to(toId).emit("direct:message", livePayload);
    }

      const senderSocket = onlineUsers?.[fromId];
    if (senderSocket) {
      io?.to(senderSocket).emit("message", signedMsg);
    }

    if (sender && recipient) {
      await sendChatMessagePush({
        message: signedMsg,
        sender,
        recipient,
      });
    }

    res.json({ message: signedMsg });
  } catch (err) {
    console.error("Message send error:", err);
    res.status(500).json({ error: "failed to send message" });
  }
});

router.get("/", authMiddleware, async (req, res) => {
  try {
    const { user1, user2 } = req.query;
    const self = req.user.id;

    try {
      await ensureFeatureAllowed(self, "chat");
    } catch (err) {
      return sendFeatureRestrictionError(res, err);
    }

    if (!user1 || !user2) {
      return res.status(400).json({ error: "user1 & user2 required" });
    }
    if (![user1, user2].includes(self)) {
      return res.status(403).json({ error: "forbidden" });
    }

    const peerId =
      String(user1) === String(self)
        ? String(user2)
        : String(user1);

    const [peer, matched, blocked] = await Promise.all([
      findActiveMessageUser(peerId),
      isMessageMatchActive(user1, user2),
      isBlocked(user1, user2),
    ]);

    if (!peer) {
      return res.status(404).json({
        error: "user_not_found",
        message: "This user is no longer available.",
      });
    }

    if (blocked) {
      return res.status(403).json({ error: "blocked" });
    }

    if (!matched) {
      return res.status(409).json({
        error: "not_matched",
        message: "This conversation is no longer available.",
      });
    }

    const convo = await Message.find({
      $or: [
        { from: user1, to: user2 },
        { from: user2, to: user1 },
      ],
    })
      .sort({ createdAt: 1 })
      .lean();

        const signedConvo = await Promise.all(
      convo.map((m) => signMessageMedia(m, 3600))
    );

    res.json({
      messages: signedConvo.map((m) => ({
        id: m.id,
        from: m.from,
        to: m.to,
        text: m.text || "",
        type: m.type || "text",
        url: m.url || null,
        r2Key: m.r2Key || "",
        ephemeral: m.ephemeral || "keep",

        // 📹 Call-history message metadata
        callId: m.callId || "",
        callType: m.callType || "",
        callStatus: m.callStatus || "",
        callDurationSeconds: Number(m.callDurationSeconds || 0),
        callStartedAt: m.callStartedAt || null,
        callEndedAt: m.callEndedAt || null,
        callEndedBy: m.callEndedBy || "",

        createdAt: m.createdAt,
      })),
    });
  } catch (err) {
    console.error("Fetch conversation error:", err);
    res.status(500).json({ error: "failed to load conversation" });
  }
});

router.post("/viewed", authMiddleware, async (req, res) => {
  try {
    const { messageId } = req.body || {};
    const me = String(req.user.id);

    if (!messageId) {
      return res.status(400).json({ error: "messageId required" });
    }

    const msg = await Message.findOne({ id: messageId });
    if (!msg) {
      return res.status(404).json({ error: "Message not found" });
    }

    // 🚫 Only the actual receiver can mark this message viewed.
    if (String(msg.to || "") !== me) {
      return res.status(403).json({ error: "forbidden" });
    }

    const peerId = String(msg.from || "");

    const [peer, matched, blocked] = await Promise.all([
      findActiveMessageUser(peerId),
      isMessageMatchActive(me, peerId),
      isBlocked(me, peerId),
    ]);

    if (!peer) {
      return res.status(404).json({
        error: "user_not_found",
        message: "This user is no longer available.",
      });
    }

    if (blocked) {
      return res.status(403).json({ error: "blocked" });
    }

    if (!matched) {
      return res.status(409).json({
        error: "not_matched",
        message: "This conversation is no longer available.",
      });
    }

    if (msg.ephemeral === "once") {
      await Message.deleteOne({ id: messageId });

      const socketTo = onlineUsers?.[msg.to];
      const socketFrom = onlineUsers?.[msg.from];

      if (socketTo) {
        io?.to(socketTo).emit("message:removed", { id: messageId });
      }

      if (socketFrom) {
        io?.to(socketFrom).emit("message:removed", { id: messageId });
      }
    }

    res.json({ success: true });
  } catch (err) {
    console.error("Auto-delete error:", err);
    res.status(500).json({ error: "server error" });
  }
});

module.exports = router;
