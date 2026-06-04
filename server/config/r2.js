/**
 * ============================================================
 * 📁 File: config/r2.js
 * ☁️ Purpose: Central Cloudflare R2 client for RomBuzz media.
 *
 * Used for:
 *   - avatars
 *   - gallery photos
 *   - chat images
 *   - voice intros
 *   - chat audio
 *
 * Not used for:
 *   - gifts catalog images
 *   - reels/videos
 *
 * Notes:
 *   - Bucket stays private.
 *   - Backend generates signed URLs when users are allowed to view media.
 *   - Never expose R2 secret keys to mobile/web frontend.
 * ============================================================
 */

require("dotenv").config();

const { S3Client } = require("@aws-sdk/client-s3");

const R2_BUCKET_NAME = String(process.env.R2_BUCKET_NAME || "").trim();
const R2_ACCESS_KEY_ID = String(process.env.R2_ACCESS_KEY_ID || "").trim();
const R2_SECRET_ACCESS_KEY = String(process.env.R2_SECRET_ACCESS_KEY || "").trim();
const R2_ENDPOINT = String(process.env.R2_ENDPOINT || "").trim();

function requireR2Env() {
  const missing = [];

  if (!R2_BUCKET_NAME) missing.push("R2_BUCKET_NAME");
  if (!R2_ACCESS_KEY_ID) missing.push("R2_ACCESS_KEY_ID");
  if (!R2_SECRET_ACCESS_KEY) missing.push("R2_SECRET_ACCESS_KEY");
  if (!R2_ENDPOINT) missing.push("R2_ENDPOINT");

  if (missing.length) {
    throw new Error(`Missing Cloudflare R2 env vars: ${missing.join(", ")}`);
  }
}

requireR2Env();

const r2Client = new S3Client({
  region: "auto",
  endpoint: R2_ENDPOINT,
  credentials: {
    accessKeyId: R2_ACCESS_KEY_ID,
    secretAccessKey: R2_SECRET_ACCESS_KEY,
  },
});

module.exports = {
  r2Client,
  R2_BUCKET_NAME,
  R2_ENDPOINT,
};