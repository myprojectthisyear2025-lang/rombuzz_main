/**
 * ============================================================
 * 📁 File: config/cloudflareStream.js
 * 🎬 Purpose: Central Cloudflare Stream config for RomBuzz videos/reels.
 *
 * Used for:
 *   - profile reels
 *   - LetsBuzz reels/videos
 *
 * Not used for:
 *   - photos
 *   - avatars
 *   - chat images
 *   - chat audio
 *   - voice intros
 *   - gift catalog images
 *
 * Notes:
 *   - Photos/audio stay on private Cloudflare R2.
 *   - Videos/reels use Cloudflare Stream direct creator uploads.
 *   - Never expose CF_STREAM_API_TOKEN to frontend/mobile.
 * ============================================================
 */

require("dotenv").config();

const CF_ACCOUNT_ID = String(process.env.CF_ACCOUNT_ID || "").trim();
const CF_STREAM_API_TOKEN = String(process.env.CF_STREAM_API_TOKEN || "").trim();

const CF_STREAM_API_BASE = "https://api.cloudflare.com/client/v4";
const CF_STREAM_MAX_REEL_SECONDS = 60;

function requireCloudflareStreamEnv() {
  const missing = [];

  if (!CF_ACCOUNT_ID) missing.push("CF_ACCOUNT_ID");
  if (!CF_STREAM_API_TOKEN) missing.push("CF_STREAM_API_TOKEN");

  if (missing.length) {
    throw new Error(
      `Missing Cloudflare Stream env vars: ${missing.join(", ")}`
    );
  }
}

function getCloudflareStreamApiUrl(path = "") {
  requireCloudflareStreamEnv();

  const cleanPath = String(path || "").replace(/^\/+/, "");
  return `${CF_STREAM_API_BASE}/accounts/${CF_ACCOUNT_ID}/stream/${cleanPath}`;
}

module.exports = {
  CF_ACCOUNT_ID,
  CF_STREAM_API_TOKEN,
  CF_STREAM_API_BASE,
  CF_STREAM_MAX_REEL_SECONDS,
  getCloudflareStreamApiUrl,
  requireCloudflareStreamEnv,
};