const express = require("express");
const router = express.Router();
const shortid = require("shortid");
const authMiddleware = require("../routes/auth-middleware");
const { isBlocked, sendChatMessagePush } = require("../utils/helpers");
const Message = require("../models/Message");
const User = require("../models/User");
const Match = require("../models/Match");
const { io, onlineUsers } = global;

router.post("/", authMiddleware, async (req, res) => {
  try {
    const { to, text, type, url, ephemeral } = req.body || {};
    const from = req.user.id;

    if (!to) return res.status(400).json({ error: "recipient required" });
    if (!text && !url) {
      return res.status(400).json({ error: "either text or media url required" });
    }

    if (await isBlocked(from, to)) {
      return res.status(403).json({ error: "blocked" });
    }

    const [sender, recipient] = await Promise.all([
      User.findOne({ id: from })
        .select("id firstName lastName settings pushTokens pushToken")
        .lean(),
      User.findOne({ id: to })
        .select("id firstName lastName settings pushTokens pushToken")
        .lean(),
    ]);

    if (!recipient) return res.status(404).json({ error: "recipient not found" });

    const msgType = type || (url ? "photo" : "text");
    const createdAt = new Date();
    const msg = await Message.create({
      id: shortid.generate(),
      from,
      to,
      text: text || "",
      type: msgType,
      url: url || null,
      ephemeral: ephemeral || "keep",
      createdAt,
    });

    const livePayload = {
      id: msg.id,
      roomId: [String(msg.from), String(msg.to)].sort().join("_"),
      from: msg.from,
      to: msg.to,
      time: new Date(msg.createdAt).toISOString(),
      preview: (msg.text || "").slice(0, 80),
      type: msgType,
    };

    const receiverSocket = onlineUsers?.[to];
    if (receiverSocket) {
      io?.to(receiverSocket).emit("message", msg);
      io?.to(String(to)).emit("direct:message", livePayload);
    }

    const senderSocket = onlineUsers?.[from];
    if (senderSocket) {
      io?.to(senderSocket).emit("message:delivered", {
        id: msg.id,
        to: msg.to,
        time: msg.createdAt,
      });
    }

    if (sender && recipient) {
      await sendChatMessagePush({
        message: msg.toObject ? msg.toObject() : msg,
        sender,
        recipient,
      });
    }

    res.json({ message: msg });
  } catch (err) {
    console.error("Message send error:", err);
    res.status(500).json({ error: "failed to send message" });
  }
});

router.get("/", authMiddleware, async (req, res) => {
  try {
    const { user1, user2 } = req.query;
    const self = req.user.id;

    if (!user1 || !user2) {
      return res.status(400).json({ error: "user1 & user2 required" });
    }
    if (![user1, user2].includes(self)) {
      return res.status(403).json({ error: "forbidden" });
    }
    if (await isBlocked(user1, user2)) {
      return res.status(403).json({ error: "blocked" });
    }

    const matched = await Match.exists({ users: { $all: [user1, user2] } });
    if (!matched) {
      return res.status(403).json({ error: "No match yet" });
    }

    const convo = await Message.find({
      $or: [
        { from: user1, to: user2 },
        { from: user2, to: user1 },
      ],
    })
      .sort({ createdAt: 1 })
      .lean();

     res.json({
      messages: convo.map((m) => ({
        id: m.id,
        from: m.from,
        to: m.to,
        text: m.text || "",
        type: m.type || "text",
        url: m.url || null,
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
    if (!messageId) {
      return res.status(400).json({ error: "messageId required" });
    }

    const msg = await Message.findOne({ id: messageId });
    if (!msg) {
      return res.status(404).json({ error: "Message not found" });
    }

    if (msg.ephemeral === "once") {
      await Message.deleteOne({ id: messageId });

      const socketTo = onlineUsers?.[msg.to];
      const socketFrom = onlineUsers?.[msg.from];
      if (socketTo) io?.to(socketTo).emit("message:removed", { id: messageId });
      if (socketFrom) io?.to(socketFrom).emit("message:removed", { id: messageId });
    }

    res.json({ success: true });
  } catch (err) {
    console.error("Auto-delete error:", err);
    res.status(500).json({ error: "server error" });
  }
});

module.exports = router;
