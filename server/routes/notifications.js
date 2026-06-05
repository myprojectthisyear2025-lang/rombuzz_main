/**
 * ============================================================
 * 📁 File: routes/notifications.js
 * 🔔 Purpose: Manage RomBuzz in-app notifications.
 *
 * Endpoints:
 *   GET    /api/notifications              → Fetch user notifications
 *   PATCH  /api/notifications/:id/read     → Mark one notification as read
 *   PATCH  /api/notifications/:id/unread   → Mark one notification as unread
 *   DELETE /api/notifications/:id          → Delete one notification
 *   POST   /api/notifications/test         → Create/send test notification
 *
 * Features:
 *   - Returns notifications for the authenticated user
 *   - Enriches notification routing fields for posts, comments, gifts, shares, and reports
 *   - Adds sender info/avatar when available
 *   - Signs private Cloudflare R2 avatars before sending them to the app
 *   - Supports notification filtering on the mobile side
 *
 * Dependencies:
 *   - models/Notification.js
 *   - models/User.js
 *   - auth-middleware.js
 *   - utils/helpers.js
 *   - utils/r2Media.js
 *
 * Notes:
 *   - Mounted under /api/notifications in index.js
 *   - Used by the mobile Notifications tab and real-time notification flow
 * ============================================================
 */


const express = require("express");
const router = express.Router();
const shortid = require("shortid");

const Notification = require("../models/Notification");
const Block = require("../models/Block");
const User = require("../models/User");
const authMiddleware = require("./auth-middleware");
const { sendNotification } = require("../utils/helpers");
const { getSignedMediaUrl, isR2Key } = require("../utils/r2Media");

function normalizeMediaString(value = "") {
  return String(value || "").trim();
}

async function signR2Value(value, expiresInSeconds = 3600) {
  const raw = normalizeMediaString(value);
  if (!raw) return "";
  if (!isR2Key(raw)) return raw;

  return getSignedMediaUrl(raw, expiresInSeconds);
}

function getAdminBroadcastEmails() {
  return String(
    process.env.ADMIN_NOTIFICATION_EMAILS ||
      process.env.ADMIN_EMAILS ||
      process.env.ADMIN_EMAIL ||
      ""
  )
    .split(",")
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean);
}

async function canSendAdminBroadcast(req) {
  if (!req?.user?.id) return false;

  if (
    req.user.role === "admin" ||
    req.user.isAdmin === true ||
    req.user.admin === true
  ) {
    return true;
  }

  const adminEmails = getAdminBroadcastEmails();
  if (!adminEmails.length) return false;

  const currentUser = await User.findOne({ id: req.user.id })
    .select("id email role isAdmin admin")
    .lean();

  if (!currentUser) return false;

  if (
    currentUser.role === "admin" ||
    currentUser.isAdmin === true ||
    currentUser.admin === true
  ) {
    return true;
  }

  const email = String(currentUser.email || "").trim().toLowerCase();
  return !!email && adminEmails.includes(email);
}

async function enrichNotificationActor(notification = {}) {
  const out = { ...notification };
  const fromId = String(out.fromId || "").trim();

  if (!fromId || fromId === "system") {
    return out;
  }

  try {
    const actor = await User.findOne({ id: fromId })
      .select("id firstName lastName avatar")
      .lean();

    if (!actor) return out;

    const signedAvatar = await signR2Value(actor.avatar, 21600);

    out.fromUser = {
      id: actor.id,
      firstName: actor.firstName || "",
      lastName: actor.lastName || "",
      avatar: signedAvatar || "",
    };

    out.fromName = [actor.firstName, actor.lastName].filter(Boolean).join(" ").trim();
    out.fromAvatar = signedAvatar || "";
  } catch (err) {
    console.error("⚠️ notification actor enrichment failed:", err?.message || err);
  }

  return out;
}

router.get("/", authMiddleware, async (req, res) => {
  try {
    const userId = req.user.id;

    const notifs = await Notification.find({ toId: userId })
      .sort({ createdAt: -1 })
      .lean();

      const enrich = (n) => {
      const out = { ...n };

      const legacyPostId = String(n.postId || n.entityId || "").trim();
      const legacyOwnerId = String(n.postOwnerId || "").trim();

      // Backfill exact routing fields for older notifications.
      // New notifications should already have these from the comment/gift routes.
      if (!out.targetId && legacyPostId) {
        out.targetId = legacyPostId;
      }

      if (!out.targetOwnerId && legacyOwnerId) {
        out.targetOwnerId = legacyOwnerId;
      }

      if (!out.targetType) {
        if (n.entity === "gallery_media" || n.entity === "media") {
          out.targetType = "gallery_media";
        } else if (legacyPostId) {
          out.targetType = "buzz_post";
        }
      }

      // Keep existing valid hrefs, but still return the enriched routing fields above.
      if (out.href?.startsWith("/")) return out;

           switch (n.type) {
        case "wingman":
          out.href = "/discover";
          break;

        case "rombuzz":
          out.href = "/notifications";
          break;

        case "match":
        case "buzz":
          out.href = `/viewprofile/${n.fromId}`;
          break;

        case "like":
        case "gift": {
          const postId = out.targetId || legacyPostId;

          if (postId) {
            out.href = `/letsbuzz?post=${postId}`;
          } else if (n.fromId) {
            out.href = `/viewprofile/${n.fromId}`;
          }

          break;
        }

        case "comment":
        case "new_post":
        case "share": {
          const postId = out.targetId || legacyPostId;

          if (postId) {
            out.href = `/letsbuzz?post=${postId}`;
          } else if (n.fromId) {
            out.href = `/viewprofile/${n.fromId}`;
          }

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

       const enriched = await Promise.all(
      notifs.map((item) => enrichNotificationActor(enrich(item)))
    );

     res.json({ notifications: enriched });
  } catch (err) {
    console.error("❌ GET /notifications error:", err);
    res.status(500).json({ error: "Failed to fetch notifications" });
  }
});

router.post("/admin/broadcast", authMiddleware, async (req, res) => {
  try {
    const allowed = await canSendAdminBroadcast(req);
    if (!allowed) {
      return res.status(403).json({ error: "Admin access required" });
    }

    const message = String(req.body?.message || "").trim();
    const href = String(req.body?.href || "/notifications").trim() || "/notifications";

    if (!message) {
      return res.status(400).json({ error: "Message is required" });
    }

    if (message.length > 500) {
      return res.status(400).json({ error: "Message must be 500 characters or less" });
    }

    const users = await User.find({ id: { $exists: true, $ne: "" } })
      .select("id")
      .lean();

    const userIds = [
      ...new Set(
        users
          .map((user) => String(user.id || "").trim())
          .filter(Boolean)
      ),
    ];

    let sent = 0;
    let failed = 0;
    const chunkSize = 50;

    for (let i = 0; i < userIds.length; i += chunkSize) {
      const chunk = userIds.slice(i, i + chunkSize);

      const results = await Promise.allSettled(
        chunk.map((toId) =>
          sendNotification(toId, {
            fromId: "system",
            type: "rombuzz",
            message,
            href,
            entity: "rombuzz_admin",
            entityId: "broadcast",
            routeContext: "admin_broadcast",
          })
        )
      );

      for (const result of results) {
        if (result.status === "fulfilled" && result.value) {
          sent += 1;
        } else {
          failed += 1;
        }
      }
    }

    res.json({
      success: true,
      message: "RomBuzz broadcast notification sent",
      totalUsers: userIds.length,
      sent,
      failed,
    });
  } catch (err) {
    console.error("POST /notifications/admin/broadcast error:", err);
    res.status(500).json({ error: "Failed to send RomBuzz broadcast" });
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
