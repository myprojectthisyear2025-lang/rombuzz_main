/**
 * ============================================================
 * 📁 File: routes/adminAnnouncements.js
 * 📣 Purpose: Admin-only RomBuzz announcement broadcasts.
 *
 * Mounted at:
 *   /api/admin/announcements
 *
 * Endpoints:
 *   POST /broadcast
 *
 * Behavior:
 *   - Admin writes one announcement
 *   - Backend creates one "rombuzz" notification for every user
 *   - Mobile shows those under the RomBuzz notification filter
 * ============================================================
 */

const express = require("express");
const router = express.Router();

const authMiddleware = require("./auth-middleware");
const User = require("../models/User");
const { sendNotification } = require("../utils/helpers");

function getAdminEmails() {
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

async function requireAnnouncementAdmin(req, res) {
  const currentUser = await User.findOne({ id: req.user.id })
    .select("id email role isAdmin admin")
    .lean();

  if (!currentUser) {
    res.status(404).json({ error: "User not found" });
    return null;
  }

  if (
    currentUser.role === "admin" ||
    currentUser.isAdmin === true ||
    currentUser.admin === true
  ) {
    return currentUser;
  }

  const adminEmails = getAdminEmails();
  const email = String(currentUser.email || "").trim().toLowerCase();

  const isAdminByEmail = !!email && adminEmails.includes(email);

  if (!isAdminByEmail) {
    res.status(403).json({ error: "Admin access required" });
    return null;
  }

  return currentUser;
}

function normalizeAnnouncementMessage(value) {
  return String(value || "").trim().slice(0, 500);
}

function normalizeAnnouncementHref(value) {
  const raw = String(value || "/notifications").trim();

  if (!raw) return "/notifications";
  if (!raw.startsWith("/")) return "/notifications";

  return raw.slice(0, 220);
}

router.post("/broadcast", authMiddleware, async (req, res) => {
  try {
    const admin = await requireAnnouncementAdmin(req, res);
    if (!admin) return;

    const message = normalizeAnnouncementMessage(req.body?.message);
    const href = normalizeAnnouncementHref(req.body?.href);

    if (!message) {
      return res.status(400).json({ error: "Message is required" });
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
            targetType: "rombuzz_announcement",
            targetId: "broadcast",
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
      message: "RomBuzz announcement sent",
      totalUsers: userIds.length,
      sent,
      failed,
    });
  } catch (err) {
    console.error("POST /admin/announcements/broadcast error:", err);
    res.status(500).json({ error: "Failed to send RomBuzz announcement" });
  }
});

module.exports = router;