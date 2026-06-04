/**
 * ============================================================
 * 📁 File: utils/r2Media.js
 * 🧩 Purpose: Safe Cloudflare R2 media helpers for RomBuzz.
 *
 * Handles:
 *   - uploading private media objects to R2
 *   - deleting temp multer files
 *   - generating short-lived signed GET URLs
 *   - building clean object keys by media category
 *
 * Storage folders:
 *   - avatars/
 *   - gallery-photos/
 *   - chat-images/
 *   - voice-intros/
 *   - chat-audio/
 *
 * Important:
 *   - R2 bucket stays private.
 *   - MongoDB should store object keys, not permanent public URLs.
 * ============================================================
 */

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { PutObjectCommand, GetObjectCommand, DeleteObjectCommand } = require("@aws-sdk/client-s3");
const { getSignedUrl } = require("@aws-sdk/s3-request-presigner");
const { r2Client, R2_BUCKET_NAME } = require("../config/r2");

const ALLOWED_FOLDERS = new Set([
  "avatars",
  "gallery-photos",
  "chat-images",
  "voice-intros",
  "chat-audio",
]);

const IMAGE_MIME_TYPES = new Set([
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/webp",
]);

const AUDIO_MIME_TYPES = new Set([
  "audio/m4a",
  "audio/mp4",
  "audio/mpeg",
  "audio/mp3",
  "audio/aac",
  "audio/wav",
  "audio/x-m4a",
]);

function safeUserId(value) {
  return String(value || "")
    .trim()
    .replace(/[^a-zA-Z0-9_-]/g, "");
}

function normalizeFolder(folder) {
  const clean = String(folder || "").trim();

  if (!ALLOWED_FOLDERS.has(clean)) {
    throw new Error(`Invalid R2 media folder: ${clean}`);
  }

  return clean;
}

function getExtensionFromFile(file = {}) {
  const original = String(file.originalname || "").trim();
  const ext = path.extname(original).toLowerCase();

  if (ext && ext.length <= 10) return ext;

  const mime = String(file.mimetype || "").toLowerCase();

  if (mime === "image/jpeg" || mime === "image/jpg") return ".jpg";
  if (mime === "image/png") return ".png";
  if (mime === "image/webp") return ".webp";
  if (mime === "audio/m4a" || mime === "audio/mp4" || mime === "audio/x-m4a") return ".m4a";
  if (mime === "audio/mpeg" || mime === "audio/mp3") return ".mp3";
  if (mime === "audio/aac") return ".aac";
  if (mime === "audio/wav") return ".wav";

  return "";
}

function validateMediaFile(file, options = {}) {
  if (!file) {
    throw new Error("No file uploaded");
  }

  const mime = String(file.mimetype || "").toLowerCase();
  const size = Number(file.size || 0);
  const kind = String(options.kind || "").toLowerCase();

  if (kind === "image") {
    if (!IMAGE_MIME_TYPES.has(mime)) {
      throw new Error("Only JPG, PNG, or WEBP images are allowed");
    }

    if (size > 8 * 1024 * 1024) {
      throw new Error("Image is too large. Maximum allowed size is 8MB.");
    }
  }

  if (kind === "avatar") {
    if (!IMAGE_MIME_TYPES.has(mime)) {
      throw new Error("Only JPG, PNG, or WEBP avatars are allowed");
    }

    if (size > 5 * 1024 * 1024) {
      throw new Error("Avatar is too large. Maximum allowed size is 5MB.");
    }
  }

  if (kind === "audio") {
    if (!AUDIO_MIME_TYPES.has(mime)) {
      throw new Error("Only M4A, AAC, MP3, or WAV audio is allowed");
    }

    if (size > 15 * 1024 * 1024) {
      throw new Error("Audio is too large. Maximum allowed size is 15MB.");
    }
  }

  return true;
}

function buildR2Key({ folder, userId, roomId = "", file }) {
  const safeFolder = normalizeFolder(folder);
  const owner = safeUserId(userId);
  const room = String(roomId || "")
    .trim()
    .replace(/[^a-zA-Z0-9_-]/g, "");

  if (!owner && !room) {
    throw new Error("Missing userId or roomId for R2 key");
  }

  const ext = getExtensionFromFile(file);
  const id = crypto.randomUUID();

  if (safeFolder === "chat-images" || safeFolder === "chat-audio") {
    if (!room) throw new Error("roomId required for chat media");
    return `${safeFolder}/${room}/${id}${ext}`;
  }

  return `${safeFolder}/${owner}/${id}${ext}`;
}

function cleanupTempFile(filePath) {
  if (!filePath) return;

  fs.unlink(filePath, () => {});
}

async function uploadFileToR2({ file, key, contentType }) {
  if (!file?.path) {
    throw new Error("Missing temp upload file");
  }

  const body = fs.createReadStream(file.path);

  await r2Client.send(
    new PutObjectCommand({
      Bucket: R2_BUCKET_NAME,
      Key: key,
      Body: body,
      ContentType: contentType || file.mimetype || "application/octet-stream",
      CacheControl: "private, max-age=3600",
    })
  );

  return {
    key,
    bucket: R2_BUCKET_NAME,
    contentType: contentType || file.mimetype || "application/octet-stream",
    size: Number(file.size || 0),
  };
}

async function getSignedMediaUrl(key, expiresInSeconds = 3600) {
  const cleanKey = String(key || "").trim();
  if (!cleanKey) return "";

  const expiresIn = Math.max(
    60,
    Math.min(Number(expiresInSeconds || 3600), 21600)
  );

  const command = new GetObjectCommand({
    Bucket: R2_BUCKET_NAME,
    Key: cleanKey,
  });

  return getSignedUrl(r2Client, command, { expiresIn });
}

async function deleteR2Object(key) {
  const cleanKey = String(key || "").trim();
  if (!cleanKey) return false;

  await r2Client.send(
    new DeleteObjectCommand({
      Bucket: R2_BUCKET_NAME,
      Key: cleanKey,
    })
  );

  return true;
}

function isR2Key(value = "") {
  const text = String(value || "").trim();

  return (
    text.startsWith("avatars/") ||
    text.startsWith("gallery-photos/") ||
    text.startsWith("chat-images/") ||
    text.startsWith("voice-intros/") ||
    text.startsWith("chat-audio/")
  );
}

module.exports = {
  buildR2Key,
  cleanupTempFile,
  deleteR2Object,
  getSignedMediaUrl,
  isR2Key,
  uploadFileToR2,
  validateMediaFile,
};