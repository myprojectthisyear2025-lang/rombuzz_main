/**
 * ============================================================
 * 📁 File: services/agoraTokenService.js
 * 🎥 Purpose: Generate secure Agora RTC tokens for RomBuzz 1-to-1 video calls.
 *
 * Used by:
 *   - routes/videoCalls.js
 *
 * Why this exists:
 *   - The mobile app can safely know AGORA_APP_ID.
 *   - The mobile app must NEVER know AGORA_APP_CERTIFICATE.
 *   - This backend-only service uses AGORA_APP_CERTIFICATE to generate
 *     temporary channel tokens for video calling.
 * ============================================================
 */

const { RtcTokenBuilder, RtcRole } = require("agora-token");

const DEFAULT_TOKEN_TTL_SECONDS = 60 * 60; // 1 hour

function requireAgoraEnv() {
  const appId = String(process.env.AGORA_APP_ID || "").trim();
  const appCertificate = String(process.env.AGORA_APP_CERTIFICATE || "").trim();

  if (!appId) {
    const err = new Error("AGORA_APP_ID is missing");
    err.statusCode = 500;
    throw err;
  }

  if (!appCertificate) {
    const err = new Error("AGORA_APP_CERTIFICATE is missing");
    err.statusCode = 500;
    throw err;
  }

  return {
    appId,
    appCertificate,
  };
}

function normalizeAgoraUid(value) {
  const raw = String(value || "").trim();

  // Agora supports string user accounts.
  // RomBuzz user ids are custom strings, so keep them as strings.
  if (!raw) {
    const err = new Error("Agora uid/account is required");
    err.statusCode = 400;
    throw err;
  }

  return raw;
}

function normalizeChannelName(value) {
  const channelName = String(value || "").trim();

  if (!channelName) {
    const err = new Error("Agora channelName is required");
    err.statusCode = 400;
    throw err;
  }

  // Safe compact channel names for mobile join.
  if (!/^[a-zA-Z0-9_-]{3,64}$/.test(channelName)) {
    const err = new Error("Invalid Agora channelName");
    err.statusCode = 400;
    throw err;
  }

  return channelName;
}

function getAgoraExpiry(ttlSeconds = DEFAULT_TOKEN_TTL_SECONDS) {
  const nowSeconds = Math.floor(Date.now() / 1000);
  const safeTtl = Math.max(
    60,
    Math.min(Number(ttlSeconds) || DEFAULT_TOKEN_TTL_SECONDS, 24 * 60 * 60)
  );

  return nowSeconds + safeTtl;
}

function createRtcToken({
  channelName,
  userId,
  role = RtcRole.PUBLISHER,
  ttlSeconds = DEFAULT_TOKEN_TTL_SECONDS,
}) {
  const { appId, appCertificate } = requireAgoraEnv();

  const safeChannelName = normalizeChannelName(channelName);
  const safeUserAccount = normalizeAgoraUid(userId);
  const privilegeExpireTime = getAgoraExpiry(ttlSeconds);

  const token = RtcTokenBuilder.buildTokenWithUserAccount(
    appId,
    appCertificate,
    safeChannelName,
    safeUserAccount,
    role,
    privilegeExpireTime
  );

  return {
    appId,
    token,
    channelName: safeChannelName,
    uid: safeUserAccount,
    expiresAt: new Date(privilegeExpireTime * 1000).toISOString(),
    expiresIn: privilegeExpireTime - Math.floor(Date.now() / 1000),
  };
}

module.exports = {
  DEFAULT_TOKEN_TTL_SECONDS,
  createRtcToken,
};