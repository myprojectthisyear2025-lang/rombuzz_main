/**
 * ============================================================
 * 📁 File: utils/moderation.js
 * 🛡️ Purpose: Reusable moderation enforcement helpers.
 *
 * Used by protected routes to block feature-specific access:
 *   - chat
 *   - videoCall
 *   - gifts
 *   - posting
 *   - microbuzz
 *   - discover
 *
 * Why this exists:
 *   - auth-middleware.js blocks banned/suspended/deactivated users globally.
 *   - this file blocks users from specific features without banning them.
 * ============================================================
 */

const User = require("../models/User");

const FEATURE_TO_RESTRICTION_KEY = {
  chat: "chat",
  videoCall: "videoCall",
  gifts: "gifts",
  posting: "posting",
  microbuzz: "microbuzz",
  discover: "discover",
};

function getRestrictionMessage(feature) {
  if (feature === "chat") {
    return "Chat access is currently restricted for this account.";
  }

  if (feature === "videoCall") {
    return "Video call access is currently restricted for this account.";
  }

  if (feature === "gifts") {
    return "Gift and BuzzCoin access is currently restricted for this account.";
  }

  if (feature === "posting") {
    return "Posting access is currently restricted for this account.";
  }

  if (feature === "microbuzz") {
    return "MicroBuzz access is currently restricted for this account.";
  }

  if (feature === "discover") {
    return "Discover access is currently restricted for this account.";
  }

  return "This feature is currently restricted for this account.";
}

function getRestrictionCode(feature) {
  if (feature === "chat") return "CHAT_RESTRICTED";
  if (feature === "videoCall") return "VIDEO_CALL_RESTRICTED";
  if (feature === "gifts") return "GIFTS_RESTRICTED";
  if (feature === "posting") return "POSTING_RESTRICTED";
  if (feature === "microbuzz") return "MICROBUZZ_RESTRICTED";
  if (feature === "discover") return "DISCOVER_RESTRICTED";

  return "FEATURE_RESTRICTED";
}

async function getUserModerationState(userId) {
  const id = String(userId || "").trim();

  if (!id) {
    return {
      ok: false,
      error: "USER_ID_REQUIRED",
      message: "User id is required.",
      user: null,
    };
  }

  const user = await User.findOne({ id }).lean();

  if (!user) {
    return {
      ok: false,
      error: "USER_NOT_FOUND",
      message: "User not found.",
      user: null,
    };
  }

  return {
    ok: true,
    user,
    moderation: user.moderation || {},
  };
}

async function isFeatureRestricted(userId, feature) {
  const key = FEATURE_TO_RESTRICTION_KEY[feature];

  if (!key) {
    return {
      restricted: false,
      error: "",
      message: "",
      user: null,
    };
  }

  const state = await getUserModerationState(userId);

  if (!state.ok) {
    return {
      restricted: true,
      error: state.error,
      message: state.message,
      user: null,
    };
  }

  const restricted = !!state?.moderation?.restrictions?.[key];

  return {
    restricted,
    error: restricted ? getRestrictionCode(feature) : "",
    message: restricted ? getRestrictionMessage(feature) : "",
    user: state.user,
  };
}

async function ensureFeatureAllowed(userId, feature) {
  const result = await isFeatureRestricted(userId, feature);

  if (result.restricted) {
    const err = new Error(result.message || "Feature restricted");
    err.code = result.error || "FEATURE_RESTRICTED";
    err.status = result.error === "USER_NOT_FOUND" ? 404 : 403;
    throw err;
  }

  return true;
}

function sendFeatureRestrictionError(res, err) {
  const status = Number(err?.status || 403);

  return res.status(status).json({
    error: err?.code || "FEATURE_RESTRICTED",
    message: err?.message || "This feature is currently restricted.",
  });
}

module.exports = {
  ensureFeatureAllowed,
  isFeatureRestricted,
  sendFeatureRestrictionError,
};