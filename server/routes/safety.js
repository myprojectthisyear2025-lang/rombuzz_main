/**
 * ============================================================
 * 📁 File: routes/safety.js
 * 🛡️ Purpose: Handle user blocking, unblocking, reporting, and moderation.
 *
 * Endpoints:
 *   POST /api/block           → Block a user
 *   POST /api/unblock         → Unblock a user
 *   GET  /api/blocks          → List blocked users
 *   POST /api/report          → Report a user with reason
 *   GET  /api/reports         → View own (or all, if admin) reports
 *
 * Features:
 *   - Uses MongoDB collections instead of LowDB
 *   - Unified Relationship model for block/unblock
 *   - ReportModel for user reports with admin visibility
 *   - Sanitizes user data for safe frontend rendering
 *
 * Dependencies:
 *   - models/Relationship.js  → Stores block relations
 *   - models/ReportModel.js   → Stores user reports
 *   - models/User.js          → User data for decoration
 *   - authMiddleware.js       → JWT validation
 *   - utils/helpers.js        → baseSanitizeUser()
 *
 * Notes:
 *   - Used in Settings → Safety → Blocked Users & Report User
 *   - ADMIN_EMAIL environment variable grants moderation access
 * ============================================================
 */

const express = require("express");
const router = express.Router();
const shortid = require("shortid");
const authMiddleware = require("../routes/auth-middleware");
const { baseSanitizeUser, sendNotification } = require("../utils/helpers");

const Relationship = require("../models/Relationship");
const ReportModel = require("../models/ReportModel");
const User = require("../models/User");

const ADMIN_EMAIL = process.env.ADMIN_EMAIL || "";

/* ======================
   🚫 BLOCK / UNBLOCK
====================== */

// ✅ Block a user
router.post("/block", authMiddleware, async (req, res) => {
  try {
    const { targetId } = req.body || {};
    if (!targetId)
      return res.status(400).json({ error: "targetId required" });

    // Prevent duplicate block
    const exists = await Relationship.exists({
      from: req.user.id,
      to: targetId,
      type: "block",
    });

    if (!exists) {
      await Relationship.create({
        id: shortid.generate(),
        from: req.user.id,
        to: targetId,
        type: "block",
        createdAt: Date.now(),
      });
    }

    res.json({ success: true });
  } catch (err) {
    console.error("❌ POST /block error:", err);
    res.status(500).json({ error: "Failed to block user" });
  }
});

// ✅ Unblock a user
router.post("/unblock", authMiddleware, async (req, res) => {
  try {
    const { targetId } = req.body || {};
    if (!targetId)
      return res.status(400).json({ error: "targetId required" });

    const result = await Relationship.deleteOne({
      from: req.user.id,
      to: targetId,
      type: "block",
    });

    res.json({ success: true, changed: result.deletedCount > 0 });
  } catch (err) {
    console.error("❌ POST /unblock error:", err);
    res.status(500).json({ error: "Failed to unblock user" });
  }
});

// ✅ List all blocked users
router.get("/blocks", authMiddleware, async (req, res) => {
  try {
    const blocks = await Relationship.find({
      from: req.user.id,
      type: "block",
    }).lean();

    if (!blocks.length) return res.json({ blocks: [] });

    const blockedIds = blocks.map((b) => b.to);
    const users = await User.find({ id: { $in: blockedIds } }).lean();
    const userMap = new Map(users.map((u) => [u.id, baseSanitizeUser(u)]));

    const list = blocks.map((b) => ({
      ...b,
      user: userMap.get(b.to) || null,
    }));

    res.json({ blocks: list });
  } catch (err) {
    console.error("❌ GET /blocks error:", err);
    res.status(500).json({ error: "Failed to fetch blocked users" });
  }
});

/* ======================
   🚨 REPORTS
====================== */

const VALID_REPORT_TARGET_TYPES = new Set([
  "profile",
  "chat_conversation",
  "chat_message",
  "post",
  "reel",
  "comment",
  "reply",
  "microbuzz",
  "video_call",
  "gift",
  "buzzcoin",
  "unknown",
]);

function normalizeReportText(value, max = 800) {
  return String(value || "").trim().slice(0, max);
}

function normalizeReportTargetType(value) {
  const raw = String(value || "").trim().toLowerCase();

  if (!raw) return "profile";
  if (VALID_REPORT_TARGET_TYPES.has(raw)) return raw;

  // Small compatibility helpers for future frontend payloads
  if (raw === "message") return "chat_message";
  if (raw === "chat") return "chat_conversation";
  if (raw === "video") return "video_call";
  if (raw === "coin" || raw === "bc" || raw === "buzz_coin") return "buzzcoin";

  return "unknown";
}

function getReportPriority(reason = "", targetType = "profile") {
  const text = String(reason || "").toLowerCase();

  if (
    text.includes("underage") ||
    text.includes("minor") ||
    text.includes("child") ||
    text.includes("threat") ||
    text.includes("violence") ||
    text.includes("blackmail") ||
    text.includes("extortion") ||
    text.includes("stalking") ||
    text.includes("self harm") ||
    text.includes("suicide")
  ) {
    return "urgent";
  }

  if (
    targetType === "video_call" ||
    targetType === "microbuzz" ||
    targetType === "buzzcoin" ||
    targetType === "gift" ||
    text.includes("scam") ||
    text.includes("money") ||
    text.includes("nude") ||
    text.includes("sexual") ||
    text.includes("harassment")
  ) {
    return "high";
  }

  if (
    text.includes("spam") ||
    text.includes("fake") ||
    text.includes("impersonation")
  ) {
    return "normal";
  }

  return "normal";
}

// ✅ Create a user report
// Supports old frontend:
//   POST /api/report { targetId, reason }
//
// Supports new universal frontend:
//   POST /api/reports {
//     targetType,
//     targetId,
//     reportedUserId,
//     targetOwnerId,
//     reason,
//     details,
//     source,
//     evidenceSnapshot
//   }
router.post(["/report", "/reports"], authMiddleware, async (req, res) => {
  try {
    const body = req.body || {};

    const targetId = normalizeReportText(
      body.targetId ||
        body.reportedUserId ||
        body.userId ||
        body.messageId ||
        body.postId ||
        body.mediaId ||
        body.commentId ||
        body.callId ||
        body.transactionId,
      160
    );

    const reason = normalizeReportText(body.reason, 300);
    const details = normalizeReportText(body.details || body.note || body.description, 1200);
    const targetType = normalizeReportTargetType(body.targetType || body.type);

    const reportedUserId = normalizeReportText(
      body.reportedUserId || body.targetUserId || body.userId || body.targetOwnerId || targetId,
      160
    );

    const targetOwnerId = normalizeReportText(
      body.targetOwnerId || body.ownerId || body.authorId || reportedUserId,
      160
    );

    const source = normalizeReportText(body.source || body.screen || "", 120);

    const evidenceSnapshot =
      body.evidenceSnapshot && typeof body.evidenceSnapshot === "object"
        ? body.evidenceSnapshot
        : {};

    if (!targetId || !reason) {
      return res.status(400).json({
        error: "targetId & reason required",
        required: ["targetId", "reason"],
      });
    }

    if (String(targetId) === String(req.user.id) && targetType === "profile") {
      return res.status(400).json({
        error: "You cannot report your own profile",
      });
    }

    const priority = getReportPriority(reason, targetType);

    const report = await ReportModel.create({
      id: shortid.generate(),

      from: req.user.id,
      reporterId: req.user.id,

      targetId,
      reportedUserId,
      targetOwnerId,

      targetType,
      targetKind: normalizeReportText(body.targetKind || "", 80),
      source,

      reason,
      details,
      evidenceSnapshot,

      priority,
      status: "open",
      createdAt: Date.now(),
    });

    res.status(201).json({
      success: true,
      message: "Report submitted",
      report,
    });
  } catch (err) {
    console.error("❌ POST /report(s) error:", err);
    res.status(500).json({ error: "Failed to submit report" });
  }
});

// ✅ Get reports (own or all if admin)
router.get("/reports", authMiddleware, async (req, res) => {
  try {
    const currentUser = await User.findOne({ id: req.user.id }).lean();
    if (!currentUser)
      return res.status(404).json({ error: "User not found" });

    const isAdmin =
      ADMIN_EMAIL &&
      currentUser.email?.toLowerCase() === ADMIN_EMAIL.toLowerCase();

    const ownOnly = !isAdmin || !("all" in req.query);

    const query = ownOnly ? { from: req.user.id } : {};

    if (!ownOnly && req.query.status) {
      query.status = String(req.query.status);
    }

    if (!ownOnly && req.query.priority) {
      query.priority = String(req.query.priority);
    }

    if (!ownOnly && req.query.targetType) {
      query.targetType = String(req.query.targetType);
    }

    const reports = await ReportModel.find(query)
      .sort({ createdAt: -1 })
      .limit(300)
      .lean();

    // Fetch involved users for decoration
    const userIds = [
      ...new Set(
        reports
          .flatMap((r) => [
            r.from,
            r.reporterId,
            r.targetId,
            r.reportedUserId,
            r.targetOwnerId,
          ])
          .filter(Boolean)
          .map(String)
      ),
    ];

    const users = userIds.length
      ? await User.find({ id: { $in: userIds } }).lean()
      : [];

    const userMap = new Map(users.map((u) => [u.id, baseSanitizeUser(u)]));

    const decorated = reports.map((r) => ({
      ...r,
      fromUser: userMap.get(r.from) || null,
      reporterUser: userMap.get(r.reporterId || r.from) || null,
      targetUser:
        userMap.get(r.reportedUserId) ||
        userMap.get(r.targetOwnerId) ||
        userMap.get(r.targetId) ||
        null,
    }));

       res.json({
      reports: decorated,
      admin: isAdmin,
      count: decorated.length,
    });
  } catch (err) {
    console.error("❌ GET /reports error:", err);
    res.status(500).json({ error: "Failed to load reports" });
  }
});

async function requireReportAdmin(req, res) {
  const currentUser = await User.findOne({ id: req.user.id }).lean();

  if (!currentUser) {
    res.status(404).json({ error: "User not found" });
    return null;
  }

  const isAdmin =
    ADMIN_EMAIL &&
    String(currentUser.email || "").toLowerCase() ===
      String(ADMIN_EMAIL || "").toLowerCase();

  if (!isAdmin) {
    res.status(403).json({ error: "Admin access required" });
    return null;
  }

  return currentUser;
}

function normalizeModerationStatus(value) {
  const raw = String(value || "").trim().toLowerCase();

  if (
    raw === "open" ||
    raw === "reviewing" ||
    raw === "reviewed" ||
    raw === "dismissed" ||
    raw === "actioned" ||
    raw === "resolved"
  ) {
    return raw;
  }

  return "";
}

function normalizeAdminAction(value) {
  return String(value || "").trim().slice(0, 500);
}

function normalizeAdminNotes(value) {
  return String(value || "").trim().slice(0, 2000);
}

async function safeSendReportNotification(toId, payload = {}) {
  const targetUserId = String(toId || "").trim();
  if (!targetUserId) return null;

  try {
    return await sendNotification(targetUserId, {
      fromId: "system",
      type: "system",
      href: "/notifications",
      targetType: "moderation_report",
      routeContext: "report_moderation",
      ...payload,
    });
  } catch (err) {
    console.error("❌ Failed to send report moderation notification:", err);
    return null;
  }
}

function getReporterModerationMessage(status, actionTaken = "") {
  const cleanAction = String(actionTaken || "").trim();

  if (status === "dismissed") {
    return "We reviewed your report. We did not find enough evidence to take action.";
  }

  if (status === "actioned" || status === "resolved") {
    return cleanAction
      ? `We reviewed your report and took action: ${cleanAction}.`
      : "We reviewed your report and took action to help keep RomBuzz safe.";
  }

  if (status === "reviewed") {
    return "We reviewed your report. Thank you for helping keep RomBuzz safe.";
  }

  return "";
}

function getReportedUserActionMessage(action, suspensionDays = 7) {
  if (action === "warn") {
    return "Your RomBuzz account received a warning after a safety review.";
  }

  if (action === "suspend_account") {
    const days = Math.max(1, Math.min(365, Number(suspensionDays || 7)));
    return `Your RomBuzz account has been suspended for ${days} day${days === 1 ? "" : "s"} after a safety review.`;
  }

  if (action === "unsuspend_account") {
    return "Your RomBuzz account suspension has been lifted.";
  }

  if (action === "ban_account") {
    return "Your RomBuzz account has been banned after a safety review.";
  }

  if (action === "unban_account") {
    return "Your RomBuzz account ban has been lifted.";
  }

  if (action === "disable_chat") {
    return "Your chat access has been restricted after a safety review.";
  }

  if (action === "enable_chat") {
    return "Your chat access has been restored.";
  }

  if (action === "disable_video_call") {
    return "Your video call access has been restricted after a safety review.";
  }

  if (action === "enable_video_call") {
    return "Your video call access has been restored.";
  }

  if (action === "disable_gifts") {
    return "Your gifts and BuzzCoin access has been restricted after a safety review.";
  }

  if (action === "enable_gifts") {
    return "Your gifts and BuzzCoin access has been restored.";
  }

  if (action === "disable_discover") {
    return "Your Discover access has been restricted after a safety review.";
  }

  if (action === "enable_discover") {
    return "Your Discover access has been restored.";
  }

  if (action === "disable_posting") {
    return "Your posting access has been restricted after a safety review.";
  }

  if (action === "enable_posting") {
    return "Your posting access has been restored.";
  }

  if (action === "disable_microbuzz") {
    return "Your MicroBuzz access has been restricted after a safety review.";
  }

  if (action === "enable_microbuzz") {
    return "Your MicroBuzz access has been restored.";
  }

  return "A moderation action was applied to your RomBuzz account after a safety review.";
}

/**
 * PATCH /api/reports/:reportId/moderate
 * Admin-only moderation update.
 *
 * Body:
 * {
 *   status: "reviewing" | "dismissed" | "actioned" | "resolved" | "reviewed",
 *   adminNotes: "Admin note here",
 *   actionTaken: "Warned user / removed content / banned user"
 * }
 */
router.patch("/reports/:reportId/moderate", authMiddleware, async (req, res) => {
  try {
    const admin = await requireReportAdmin(req, res);
    if (!admin) return;

    const reportId = String(req.params.reportId || "").trim();
    if (!reportId) {
      return res.status(400).json({ error: "reportId required" });
    }

    const status = normalizeModerationStatus(req.body?.status);
    const adminNotes = normalizeAdminNotes(req.body?.adminNotes);
    const actionTaken = normalizeAdminAction(req.body?.actionTaken);

    if (!status && !adminNotes && !actionTaken) {
      return res.status(400).json({
        error: "At least one moderation field is required",
        allowed: ["status", "adminNotes", "actionTaken"],
      });
    }

    const updates = {
      updatedAt: Date.now(),
      reviewedBy: admin.id,
    };

    if (status) {
      updates.status = status;

      if (
        status === "reviewing" ||
        status === "reviewed" ||
        status === "dismissed" ||
        status === "actioned" ||
        status === "resolved"
      ) {
        updates.reviewedAt = new Date();
      }

      if (
        status === "dismissed" ||
        status === "actioned" ||
        status === "resolved"
      ) {
        updates.resolvedAt = new Date();
      }
    }

    if (adminNotes) {
      updates.adminNotes = adminNotes;
    }

    if (actionTaken) {
      updates.actionTaken = actionTaken;
    }

    const report = await ReportModel.findOneAndUpdate(
      { id: reportId },
      { $set: updates },
      { new: true }
    ).lean();

    if (!report) {
      return res.status(404).json({ error: "Report not found" });
    }

    const reporterMessage = getReporterModerationMessage(
      report.status,
      report.actionTaken
    );

    if (reporterMessage && report.reporterId) {
      await safeSendReportNotification(report.reporterId, {
        message: reporterMessage,
        targetId: report.id,
        entity: "report",
        entityId: report.id,
      });
    }

    return res.json({
      success: true,
      report,
    });
  } catch (err) {
    console.error("❌ PATCH /reports/:reportId/moderate error:", err);
    res.status(500).json({ error: "Failed to update report moderation" });
  }
});

function normalizeReportHistoryUserId(value) {
  return String(value || "").trim().slice(0, 160);
}

function buildEmptyReportCountMap(values = []) {
  return values.reduce((acc, key) => {
    acc[key] = 0;
    return acc;
  }, {});
}

function incrementCountMap(map, key) {
  const cleanKey = String(key || "unknown").trim() || "unknown";
  map[cleanKey] = Number(map[cleanKey] || 0) + 1;
}

/**
 * GET /api/reports/stats
 * Admin-only dashboard stats for moderation/reporting.
 */
router.get("/reports/stats", authMiddleware, async (req, res) => {
  try {
    const admin = await requireReportAdmin(req, res);
    if (!admin) return;

    const reports = await ReportModel.find({})
      .sort({ createdAt: -1 })
      .limit(2000)
      .lean();

    const byStatus = buildEmptyReportCountMap([
      "open",
      "reviewing",
      "reviewed",
      "dismissed",
      "actioned",
      "resolved",
    ]);

    const byPriority = buildEmptyReportCountMap([
      "low",
      "normal",
      "high",
      "urgent",
    ]);

    const byTargetType = buildEmptyReportCountMap([
      "profile",
      "chat_conversation",
      "chat_message",
      "post",
      "reel",
      "comment",
      "reply",
      "microbuzz",
      "video_call",
      "gift",
      "buzzcoin",
      "unknown",
    ]);

    const reportedUserCounts = {};
    const reporterCounts = {};

    for (const report of reports) {
      incrementCountMap(byStatus, report.status || "open");
      incrementCountMap(byPriority, report.priority || "normal");
      incrementCountMap(byTargetType, report.targetType || "unknown");

      const reportedUserId = String(
        report.reportedUserId || report.targetOwnerId || report.targetId || ""
      ).trim();

      const reporterId = String(report.reporterId || report.from || "").trim();

      if (reportedUserId) incrementCountMap(reportedUserCounts, reportedUserId);
      if (reporterId) incrementCountMap(reporterCounts, reporterId);
    }

    const repeatReportedUsers = Object.entries(reportedUserCounts)
      .map(([userId, count]) => ({ userId, count }))
      .filter((row) => row.count >= 2)
      .sort((a, b) => b.count - a.count)
      .slice(0, 20);

    const frequentReporters = Object.entries(reporterCounts)
      .map(([userId, count]) => ({ userId, count }))
      .filter((row) => row.count >= 2)
      .sort((a, b) => b.count - a.count)
      .slice(0, 20);

    const userIds = [
      ...new Set([
        ...repeatReportedUsers.map((row) => row.userId),
        ...frequentReporters.map((row) => row.userId),
      ]),
    ];

    const users = userIds.length
      ? await User.find({ id: { $in: userIds } }).lean()
      : [];

    const userMap = new Map(users.map((u) => [u.id, baseSanitizeUser(u)]));

    return res.json({
      admin: true,
      total: reports.length,
      open: Number(byStatus.open || 0),
      reviewing: Number(byStatus.reviewing || 0),
      urgent: Number(byPriority.urgent || 0),
      high: Number(byPriority.high || 0),
      actioned: Number(byStatus.actioned || 0),
      dismissed: Number(byStatus.dismissed || 0),
      resolved: Number(byStatus.resolved || 0),
      byStatus,
      byPriority,
      byTargetType,
      repeatReportedUsers: repeatReportedUsers.map((row) => ({
        ...row,
        user: userMap.get(row.userId) || null,
      })),
      frequentReporters: frequentReporters.map((row) => ({
        ...row,
        user: userMap.get(row.userId) || null,
      })),
      generatedAt: new Date().toISOString(),
    });
  } catch (err) {
    console.error("❌ GET /reports/stats error:", err);
    res.status(500).json({ error: "Failed to load report stats" });
  }
});

/**
 * GET /api/reports/user/:userId/history
 * Admin-only report history for one user.
 *
 * Shows:
 *   - reports submitted by user
 *   - reports received against user
 */
router.get("/reports/user/:userId/history", authMiddleware, async (req, res) => {
  try {
    const admin = await requireReportAdmin(req, res);
    if (!admin) return;

    const userId = normalizeReportHistoryUserId(req.params.userId);

    if (!userId) {
      return res.status(400).json({ error: "userId required" });
    }

    const [user, reportsSubmitted, reportsReceived] = await Promise.all([
      User.findOne({ id: userId }).lean(),
      ReportModel.find({
        $or: [{ from: userId }, { reporterId: userId }],
      })
        .sort({ createdAt: -1 })
        .limit(200)
        .lean(),
      ReportModel.find({
        $or: [
          { targetId: userId },
          { reportedUserId: userId },
          { targetOwnerId: userId },
        ],
      })
        .sort({ createdAt: -1 })
        .limit(200)
        .lean(),
    ]);

    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    const involvedUserIds = [
      ...new Set(
        [...reportsSubmitted, ...reportsReceived]
          .flatMap((r) => [
            r.from,
            r.reporterId,
            r.targetId,
            r.reportedUserId,
            r.targetOwnerId,
            r.reviewedBy,
          ])
          .filter(Boolean)
          .map(String)
      ),
    ];

    const involvedUsers = involvedUserIds.length
      ? await User.find({ id: { $in: involvedUserIds } }).lean()
      : [];

    const userMap = new Map(
      involvedUsers.map((u) => [u.id, baseSanitizeUser(u)])
    );

    function decorateReport(report) {
      return {
        ...report,
        fromUser: userMap.get(report.from) || null,
        reporterUser: userMap.get(report.reporterId || report.from) || null,
        targetUser:
          userMap.get(report.reportedUserId) ||
          userMap.get(report.targetOwnerId) ||
          userMap.get(report.targetId) ||
          null,
        reviewedByUser: userMap.get(report.reviewedBy) || null,
      };
    }

    return res.json({
      admin: true,
      user: baseSanitizeUser(user),
      moderation: user.moderation || null,
      summary: {
        submittedCount: reportsSubmitted.length,
        receivedCount: reportsReceived.length,
        openReceivedCount: reportsReceived.filter((r) => r.status === "open").length,
        urgentReceivedCount: reportsReceived.filter((r) => r.priority === "urgent").length,
        actionedReceivedCount: reportsReceived.filter((r) => r.status === "actioned").length,
        dismissedReceivedCount: reportsReceived.filter((r) => r.status === "dismissed").length,
      },
      reportsSubmitted: reportsSubmitted.map(decorateReport),
      reportsReceived: reportsReceived.map(decorateReport),
    });
  } catch (err) {
    console.error("❌ GET /reports/user/:userId/history error:", err);
    res.status(500).json({ error: "Failed to load user report history" });
  }
});

/**
 * GET /api/reports/:reportId
 * Admin-only single report detail.
 */
router.get("/reports/:reportId", authMiddleware, async (req, res) => {
  try {
    const admin = await requireReportAdmin(req, res);
    if (!admin) return;

    const reportId = String(req.params.reportId || "").trim();
    if (!reportId) {
      return res.status(400).json({ error: "reportId required" });
    }

    const report = await ReportModel.findOne({ id: reportId }).lean();

    if (!report) {
      return res.status(404).json({ error: "Report not found" });
    }

    const userIds = [
      report.from,
      report.reporterId,
      report.targetId,
      report.reportedUserId,
      report.targetOwnerId,
      report.reviewedBy,
    ]
      .filter(Boolean)
      .map(String);

    const users = userIds.length
      ? await User.find({ id: { $in: [...new Set(userIds)] } }).lean()
      : [];

    const userMap = new Map(users.map((u) => [u.id, baseSanitizeUser(u)]));

     return res.json({
      report: {
        ...report,
        fromUser: userMap.get(report.from) || null,
        reporterUser: userMap.get(report.reporterId || report.from) || null,
        targetUser:
          userMap.get(report.reportedUserId) ||
          userMap.get(report.targetOwnerId) ||
          userMap.get(report.targetId) ||
          null,
        reviewedByUser: userMap.get(report.reviewedBy) || null,
      },
    });
  } catch (err) {
    console.error("❌ GET /reports/:reportId error:", err);
    res.status(500).json({ error: "Failed to load report detail" });
  }
});

const VALID_USER_MODERATION_ACTIONS = new Set([
  "warn",
  "suspend_account",
  "unsuspend_account",
  "ban_account",
  "unban_account",
  "disable_chat",
  "enable_chat",
  "disable_video_call",
  "enable_video_call",
  "disable_gifts",
  "enable_gifts",
  "disable_discover",
  "enable_discover",
  "disable_posting",
  "enable_posting",
  "disable_microbuzz",
  "enable_microbuzz",
]);

function normalizeUserModerationAction(value) {
  const raw = String(value || "").trim().toLowerCase();
  return VALID_USER_MODERATION_ACTIONS.has(raw) ? raw : "";
}

function buildUserModerationUpdate(action, adminId, reason, suspensionDays = 7) {
  const now = new Date();
  const cleanReason = normalizeAdminNotes(reason || "");

  const $set = {
    "moderation.lastActionAt": now,
    "moderation.lastActionBy": adminId,
    "moderation.lastActionReason": cleanReason,
  };

  const $inc = {};

  if (action === "warn") {
    $set["moderation.status"] = "warned";
    $set["moderation.lastWarningAt"] = now;
    $inc["moderation.warningsCount"] = 1;
  }

  if (action === "suspend_account") {
    const days = Math.max(1, Math.min(365, Number(suspensionDays || 7)));
    const until = new Date(Date.now() + days * 24 * 60 * 60 * 1000);

    $set.visibility = "suspended";
    $set["moderation.status"] = "suspended";
    $set["moderation.suspendedAt"] = now;
    $set["moderation.suspendedUntil"] = until;
  }

  if (action === "unsuspend_account") {
    $set.visibility = "active";
    $set["moderation.status"] = "clear";
    $set["moderation.suspendedUntil"] = null;
  }

  if (action === "ban_account") {
    $set.visibility = "banned";
    $set["moderation.status"] = "banned";
    $set["moderation.bannedAt"] = now;
  }

  if (action === "unban_account") {
    $set.visibility = "active";
    $set["moderation.status"] = "clear";
    $set["moderation.bannedAt"] = null;
  }

  if (action === "disable_chat") {
    $set["moderation.restrictions.chat"] = true;
  }

  if (action === "enable_chat") {
    $set["moderation.restrictions.chat"] = false;
  }

  if (action === "disable_video_call") {
    $set["moderation.restrictions.videoCall"] = true;
  }

  if (action === "enable_video_call") {
    $set["moderation.restrictions.videoCall"] = false;
  }

  if (action === "disable_gifts") {
    $set["moderation.restrictions.gifts"] = true;
  }

  if (action === "enable_gifts") {
    $set["moderation.restrictions.gifts"] = false;
  }

  if (action === "disable_discover") {
    $set["moderation.restrictions.discover"] = true;
  }

  if (action === "enable_discover") {
    $set["moderation.restrictions.discover"] = false;
  }

  if (action === "disable_posting") {
    $set["moderation.restrictions.posting"] = true;
  }

  if (action === "enable_posting") {
    $set["moderation.restrictions.posting"] = false;
  }

  if (action === "disable_microbuzz") {
    $set["moderation.restrictions.microbuzz"] = true;
  }

  if (action === "enable_microbuzz") {
    $set["moderation.restrictions.microbuzz"] = false;
  }

  const update = { $set };
  if (Object.keys($inc).length) update.$inc = $inc;

  return update;
}

/**
 * PATCH /api/reports/:reportId/user-action
 * Admin-only action against the reported user.
 *
 * Body:
 * {
 *   action: "warn" | "suspend_account" | "ban_account" | "disable_chat" | etc,
 *   reason: "Why admin took this action",
 *   suspensionDays: 7,
 *   adminNotes: "Optional report note"
 * }
 */
router.patch("/reports/:reportId/user-action", authMiddleware, async (req, res) => {
  try {
    const admin = await requireReportAdmin(req, res);
    if (!admin) return;

    const reportId = String(req.params.reportId || "").trim();
    if (!reportId) {
      return res.status(400).json({ error: "reportId required" });
    }

    const action = normalizeUserModerationAction(req.body?.action);
    if (!action) {
      return res.status(400).json({
        error: "Valid moderation action required",
        allowed: Array.from(VALID_USER_MODERATION_ACTIONS),
      });
    }

    const report = await ReportModel.findOne({ id: reportId });
    if (!report) {
      return res.status(404).json({ error: "Report not found" });
    }

    const targetUserId = String(
      report.reportedUserId ||
        report.targetOwnerId ||
        report.targetId ||
        ""
    ).trim();

    if (!targetUserId) {
      return res.status(400).json({
        error: "Report does not contain a target user",
      });
    }

    if (String(targetUserId) === String(admin.id)) {
      return res.status(400).json({
        error: "Admin cannot moderate their own account from a report",
      });
    }

    const reason = normalizeAdminNotes(
      req.body?.reason || req.body?.adminNotes || report.reason || ""
    );

    const userUpdate = buildUserModerationUpdate(
      action,
      admin.id,
      reason,
      req.body?.suspensionDays
    );

    const updatedUser = await User.findOneAndUpdate(
      { id: targetUserId },
      userUpdate,
      { new: true }
    ).lean();

    if (!updatedUser) {
      return res.status(404).json({ error: "Reported user not found" });
    }

    const actionLabel = action.replace(/_/g, " ");

      const updatedReport = await ReportModel.findOneAndUpdate(
      { id: reportId },
      {
        $set: {
          status: "actioned",
          actionTaken: actionLabel,
          adminNotes: reason,
          reviewedBy: admin.id,
          reviewedAt: new Date(),
          resolvedAt: new Date(),
          updatedAt: Date.now(),
        },
      },
      { new: true }
    ).lean();

    const reportedUserMessage = getReportedUserActionMessage(
      action,
      req.body?.suspensionDays
    );

    await safeSendReportNotification(targetUserId, {
      message: reportedUserMessage,
      targetId: report.id,
      entity: "report",
      entityId: report.id,
    });

    const reporterId = String(report.reporterId || report.from || "").trim();

    if (reporterId && reporterId !== String(targetUserId)) {
      await safeSendReportNotification(reporterId, {
        message: "We reviewed your report and took action to help keep RomBuzz safe.",
        targetId: report.id,
        entity: "report",
        entityId: report.id,
      });
    }

    return res.json({
      success: true,
      action,
      report: updatedReport,
      user: baseSanitizeUser(updatedUser),
      moderation: updatedUser.moderation || null,
    });
  } catch (err) {
    console.error("❌ PATCH /reports/:reportId/user-action error:", err);
    res.status(500).json({ error: "Failed to apply user moderation action" });
  }
});

module.exports = router;