const express = require("express");
const router = express.Router();
const shortid = require("shortid");

const Notification = require("../models/Notification");
const Block = require("../models/Block");
const authMiddleware = require("./auth-middleware");
const { sendNotification } = require("../utils/helpers");

router.get("/", authMiddleware, async (req, res) => {
  try {
    const userId = req.user.id;

    const notifs = await Notification.find({ toId: userId })
      .sort({ createdAt: -1 })
      .lean();

    const enrich = (n) => {
      if (n.href?.startsWith("/")) return n;
      const out = { ...n };

      switch (n.type) {
        case "wingman":
          out.href = "/discover";
          break;
        case "match":
        case "buzz":
          out.href = `/viewprofile/${n.fromId}`;
          break;
        case "like":
        case "gift": {
          const postId = n.postId || n.entityId;
          if (postId) out.href = `/letsbuzz?post=${postId}`;
          else if (n.fromId) out.href = `/viewprofile/${n.fromId}`;
          break;
        }
        case "comment":
        case "new_post":
        case "share": {
          const postId = n.postId || n.entityId;
          if (postId) out.href = `/letsbuzz?post=${postId}`;
          else if (n.fromId) out.href = `/viewprofile/${n.fromId}`;
          break;
        }
        case "reaction":
          if (n.fromId) out.href = `/viewprofile/${n.fromId}`;
          break;
        default:
          out.href = "/notifications";
      }

      return out;
    };

    res.json(notifs.map(enrich));
  } catch (err) {
    console.error("GET /notifications error:", err);
    res.status(500).json({ error: "Failed to fetch notifications" });
  }
});

router.patch("/:id/read", authMiddleware, async (req, res) => {
  try {
    const userId = req.user.id;

    const notif = await Notification.findOne({
      id: req.params.id,
      toId: userId,
    });

    if (!notif) return res.status(404).json({ error: "Notification not found" });

    notif.read = true;
    await notif.save();

    res.json({ success: true, id: notif.id });
  } catch (err) {
    console.error("PATCH /notifications/:id/read error:", err);
    res.status(500).json({ error: "Failed to mark read" });
  }
});

router.patch("/:id/unread", authMiddleware, async (req, res) => {
  try {
    const notif = await Notification.findOne({
      id: req.params.id,
      toId: req.user.id,
    });

    if (!notif) return res.status(404).json({ error: "Notification not found" });

    notif.read = false;
    await notif.save();

    res.json({ success: true, id: notif.id });
  } catch (err) {
    console.error("PATCH /notifications/:id/unread error:", err);
    res.status(500).json({ error: "Failed to mark unread" });
  }
});

router.delete("/:id", authMiddleware, async (req, res) => {
  try {
    await Notification.deleteOne({
      id: req.params.id,
      toId: req.user.id,
    });

    res.json({ success: true });
  } catch (err) {
    console.error("DELETE /notifications/:id error:", err);
    res.status(500).json({ error: "Failed to delete notification" });
  }
});

router.post("/block/:userId", authMiddleware, async (req, res) => {
  try {
    const blocker = req.user.id;
    const blocked = req.params.userId;

    const exists = await Block.findOne({ blocker, blocked }).lean();
    if (!exists) {
      await Block.create({
        id: shortid.generate(),
        blocker,
        blocked,
        createdAt: Date.now(),
      });
    }

    res.json({ success: true });
  } catch (err) {
    console.error("POST /notifications/block/:userId error:", err);
    res.status(500).json({ error: "Failed to block user" });
  }
});

router.post("/wingman", authMiddleware, async (req, res) => {
  try {
    const { message } = req.body || {};
    const toId = req.user.id;

    const notif = await sendNotification(toId, {
      fromId: "system",
      type: "wingman",
      message: message || "Your AI Wingman has something for you.",
      href: "/letsbuzz",
    });

    if (!notif) {
      return res.status(500).json({ error: "Failed to send wingman message" });
    }

    res.json({
      success: true,
      message: "Wingman notification sent",
      notif,
    });
  } catch (err) {
    console.error("POST /notifications/wingman error:", err);
    res.status(500).json({ error: "Failed to send wingman message" });
  }
});

module.exports = router;
