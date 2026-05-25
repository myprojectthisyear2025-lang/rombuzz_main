/**
 * ============================================================
 * 📁 File: services/meetMiddleRateLimitService.js
 * 🛡️ Purpose: MongoDB-backed cooldown/rate-limit helpers for
 *             RomBuzz Meet in the Middle.
 *
 * Used by:
 *   - services/meetMiddleService.js
 *
 * Important:
 *   - MongoDB only.
 *   - No LowDB.
 *   - Prevents repeated meet request spam.
 *   - Protects both HTTP routes and socket events because this
 *     runs inside the central service layer.
 * ============================================================
 */

const MeetMiddleSession = require("../models/MeetMiddleSession");

const DEFAULT_REQUEST_COOLDOWN_SECONDS = 30;

const ACTIVE_REQUEST_STATUSES = [
  "requested",
  "accepted",
  "locating",
  "suggested",
  "place_pending",
  "place_rejected",
  "confirmed",
];

function getRequestCooldownMs() {
  const seconds = Number(
    process.env.MEET_MIDDLE_REQUEST_COOLDOWN_SECONDS ||
      DEFAULT_REQUEST_COOLDOWN_SECONDS
  );

  const safeSeconds = Number.isFinite(seconds) && seconds > 0
    ? seconds
    : DEFAULT_REQUEST_COOLDOWN_SECONDS;

  return safeSeconds * 1000;
}

async function enforceMeetMiddleRequestCooldown({ fromId, toId }) {
  const requesterId = String(fromId || "").trim();
  const peerId = String(toId || "").trim();

  if (!requesterId || !peerId) {
    const err = new Error("Both users are required for Meet request cooldown");
    err.code = "RATE_LIMIT_USERS_REQUIRED";
    err.statusCode = 400;
    throw err;
  }

  const cooldownMs = getRequestCooldownMs();
  const cutoff = new Date(Date.now() - cooldownMs);

  const recentSession = await MeetMiddleSession.findOne({
    requestedBy: requesterId,
    peerId,
    status: { $in: ACTIVE_REQUEST_STATUSES },
    lastActivityAt: { $gte: cutoff },
    expiresAt: { $gt: new Date() },
  })
    .sort({ lastActivityAt: -1 })
    .lean();

  if (!recentSession) {
    return {
      allowed: true,
      retryInMs: 0,
    };
  }

  const lastTime = new Date(recentSession.lastActivityAt).getTime();
  const retryInMs = Math.max(0, cooldownMs - (Date.now() - lastTime));

  const err = new Error("Please wait before sending another Meet in the Middle request");
  err.code = "MEET_REQUEST_COOLDOWN";
  err.statusCode = 429;
  err.retryInMs = retryInMs;
  err.sessionId = recentSession.sessionId;
  throw err;
}

module.exports = {
  ACTIVE_REQUEST_STATUSES,
  getRequestCooldownMs,
  enforceMeetMiddleRequestCooldown,
};