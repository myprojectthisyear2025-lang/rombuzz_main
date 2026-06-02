/**
 * ============================================================
 * 📁 File: routes/auth-middleware.js
 * 🧩 Purpose: Express middleware that authenticates requests via JWT
 *             and blocks banned / suspended / deactivated / pending-delete accounts.
 *
 * Behavior:
 *   - Reads Authorization header: "Bearer <token>"
 *   - Verifies JWT using process.env.JWT_SECRET
 *   - Looks up the user in MongoDB
 *   - Blocks protected route access if account is banned/suspended/deactivated/pending_delete
 *   - On success: attaches { id, email } to req.user and calls next()
 *
 * Dependencies:
 *   - jsonwebtoken
 *   - models/User.js
 *
 * Notes:
 *   - This is global account-level enforcement.
 *   - Feature-level restrictions like disabling chat/video/gifts will be enforced
 *     inside those specific route files next.
 * ============================================================
 */

const jwt = require("jsonwebtoken");
const User = require("../models/User");
const { isPendingDeleteUser } = require("../services/accountDeletionService");

function getAccountStatus(user = {}) {
  if (isPendingDeleteUser(user)) {
    return "pending_delete";
  }

  const visibility = String(user?.visibility || "").trim().toLowerCase();
  const moderationStatus = String(user?.moderation?.status || "")
    .trim()
    .toLowerCase();

  if (visibility === "banned" || moderationStatus === "banned") {
    return "banned";
  }

  if (visibility === "suspended" || moderationStatus === "suspended") {
    return "suspended";
  }

  if (visibility === "deactivated") {
    return "deactivated";
  }

  return "active";
}

function getSuspensionUntil(user = {}) {
  const raw = user?.moderation?.suspendedUntil;
  if (!raw) return null;

  const date = raw instanceof Date ? raw : new Date(raw);
  if (Number.isNaN(date.getTime())) return null;

  return date;
}

async function clearExpiredSuspension(user) {
  const until = getSuspensionUntil(user);
  if (!until) return false;

  if (until.getTime() > Date.now()) return false;

  await User.updateOne(
    { id: user.id },
    {
      $set: {
        visibility: "active",
        "moderation.status": "clear",
        "moderation.suspendedUntil": null,
        "moderation.lastActionAt": new Date(),
        "moderation.lastActionReason": "Automatic suspension expiry",
      },
    }
  );

  return true;
}

module.exports = async function authMiddleware(req, res, next) {
  const JWT_SECRET = process.env.JWT_SECRET || "rom_seed_dev_change_me";
  const authHeader = req.headers.authorization || "";
  const token = authHeader.replace(/^Bearer\s+/i, "");

  if (!token) {
    return res.status(401).json({ error: "No token provided" });
  }

  let decoded;

  try {
    decoded = jwt.verify(token, JWT_SECRET);
  } catch (err) {
    console.error("Auth middleware token error:", err.message);
    return res.status(401).json({ error: "Invalid or expired token" });
  }

  if (!decoded?.id) {
    return res.status(401).json({ error: "Invalid token structure" });
  }

  try {
    const user = await User.findOne({ id: decoded.id }).lean();

    if (!user) {
      return res.status(401).json({ error: "Account not found" });
    }

    const expiredSuspensionCleared = await clearExpiredSuspension(user);

    const accountStatus = expiredSuspensionCleared
      ? "active"
      : getAccountStatus(user);

    if (accountStatus === "banned") {
      return res.status(403).json({
        error: "ACCOUNT_BANNED",
        message: "This account has been banned from RomBuzz.",
      });
    }

      if (accountStatus === "deactivated") {
      return res.status(403).json({
        error: "ACCOUNT_DEACTIVATED",
        message: "This account is deactivated.",
      });
    }

    if (accountStatus === "pending_delete") {
      return res.status(403).json({
        error: "ACCOUNT_PENDING_DELETE",
        message:
          "This account has been deleted and is waiting for permanent cleanup.",
        reusableAfter: user?.deletion?.purgeAfter || null,
      });
    }

    if (accountStatus === "suspended") {
      const until = getSuspensionUntil(user);

      return res.status(403).json({
        error: "ACCOUNT SUSPENDED",
        message: until
          ? `This account is suspended until ${until.toISOString()}.`
          : "This account is suspended.",
        suspendedUntil: until ? until.toISOString() : null,
      });
    }

    req.user = {
      id: user.id,
      email: user.email || decoded.email || "",
    };

    return next();
  } catch (err) {
    console.error("Auth middleware account check error:", err);
    return res.status(500).json({ error: "Authentication check failed" });
  }
};