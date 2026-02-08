/**
 * ============================================================
 * 📁 File: routes/notifications.js
 * 💬 Purpose: Handle all user notifications (MongoDB version)
 *
 * Endpoints:
 *   GET    /api/notifications              → Fetch all notifications
 *   PATCH  /api/notifications/:id/read     → Mark as read
 *   DELETE /api/notifications/:id          → Delete notification
 *   POST   /api/notifications/wingman      → Create AI Wingman message
 *   POST   /api/notifications/block/:userId→ Block user's notifications
 *
 * Notes:
 *   - 100% MongoDB (no LowDB).
 *   - Uses Block model for blocking user notifications.
 *   - Retains backward-compatible href building and socket notifications.
 * ============================================================
 */

const express = require("express");
const router = express.Router();
const shortid = require("shortid");

const Notification = require("../models/Notification");
const Block = require("../models/Block");
const authMiddleware = require("./auth-middleware");

// Socket.IO globals
const { io, onlineUsers } = global;

// ============================================================
// ✅ GET all notifications for current user
// ============================================================
router.get("/", authMiddleware, async (req, res) => {
  try {
    const userId = req.user.id;

    const notifs = await Notification.find({ toId: userId })
      .sort({ createdAt: -1 })
      .lean();

    // enrich with dynamic href
    const enrich = (n) => {
      if (n.href?.startsWith("/")) return n;
      const out = { ...n };

      switch (n.type) {
        case "wingman":
          out.href = "/discover";
          break;

         case "match":
        case "buzz": {
          // ✅ Profile-based notifications
          out.href = `/viewprofile/${n.fromId}`;
          break;
        }

        case "like": {
          // ✅ TEMP: Treat "like" as "gift" until we rename on creator routes
          const postId = n.postId || n.entityId;
          if (postId) out.href = `/letsbuzz?post=${postId}`;
          else if (n.fromId) out.href = `/viewprofile/${n.fromId}`;
          break;
        }

        case "comment":
        case "new_post":
        case "share": {
          // ✅ Post-based notifications → open LetsBuzz and focus that post
          const postId = n.postId || n.entityId;
          if (postId) out.href = `/letsbuzz?post=${postId}`;
          else if (n.fromId) out.href = `/viewprofile/${n.fromId}`;
          break;
        }

        case "reaction": {
          // ⏸️ Leave reaction routing for later (as you asked)
          // Keep current behavior if you want: fallback to profile
          if (n.fromId) out.href = `/viewprofile/${n.fromId}`;
          break;
        }


        default:
          out.href = "/notifications";
      }

      return out;
    };

    res.json(notifs.map(enrich));
  } catch (err) {
    console.error("❌ GET /notifications error:", err);
    res.status(500).json({ error: "Failed to fetch notifications" });
  }
});

// ============================================================
// ✅ PATCH → mark as read
// ============================================================
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
    console.error("❌ PATCH /notifications/:id/read error:", err);
    res.status(500).json({ error: "Failed to mark read" });
  }
});

// ============================================================
// ✅ DELETE → remove a notification
// ============================================================
router.delete("/:id", authMiddleware, async (req, res) => {
  try {
    await Notification.deleteOne({
      id: req.params.id,
      toId: req.user.id,
    });

    res.json({ success: true });
  } catch (err) {
    console.error("❌ DELETE /notifications/:id error:", err);
    res.status(500).json({ error: "Failed to delete notification" });
  }
});

// ============================================================
// ✅ POST → block a user's notifications (MongoDB)
// ============================================================
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
    console.error("❌ POST /notifications/block/:userId error:", err);
    res.status(500).json({ error: "Failed to block user" });
  }
});

// ============================================================
// ✅ POST → AI Wingman notification (Mongo + Sockets)
// ============================================================
router.post("/wingman", authMiddleware, async (req, res) => {
  try {
    const { message } = req.body;
    const toId = req.user.id;

    const notif = await Notification.create({
      id: shortid.generate(),
      toId,
      fromId: "system",
      type: "wingman",
      message: message || "Your AI Wingman has something for you 💡",
      href: "/letsbuzz",
      createdAt: Date.now(),
      read: false,
    });

    if (io && onlineUsers?.[toId]) {
      io.to(onlineUsers[toId]).emit("notification", notif);
    }

    res.json({
      success: true,
      message: "Wingman notification sent",
      notif,
    });
  } catch (err) {
    console.error("❌ POST /notifications/wingman error:", err);
    res.status(500).json({ error: "Failed to send wingman message" });
  }
});

module.exports = router;
