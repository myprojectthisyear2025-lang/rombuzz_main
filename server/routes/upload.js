/**
 * ============================================================
 * 📁 File: routes/upload.js
 * ☁️ Purpose: Handles authenticated RomBuzz user media uploads.
 *
 * Storage plan:
 *   - avatars        → Cloudflare R2 private bucket
 *   - gallery photos → Cloudflare R2 private bucket
 *   - chat images    → Cloudflare R2 private bucket
 *   - comment photos → Cloudflare R2 private bucket
 *   - voice intros   → Cloudflare R2 private bucket
 *   - chat audio     → Cloudflare R2 private bucket
 *
 * Not handled here:
 *   - gifts catalog images → stay on Cloudinary for now
 *   - reels/videos         → keep current flow for now
 *
 * Notes:
 *   - R2 bucket stays private.
 *   - MongoDB stores R2 object keys for new R2 uploads.
 *   - API responses return short-lived signed URLs for immediate display.
 *   - Old Cloudinary URLs remain supported for legacy media.
 * ============================================================
 */

const express = require("express");
const router = express.Router();
const shortid = require("shortid");

const upload = require("../config/multer");
const authMiddleware = require("../routes/auth-middleware");
const {
  ensureFeatureAllowed,
  sendFeatureRestrictionError,
} = require("../utils/moderation");
const User = require("../models/User");

const {
  buildR2Key,
  cleanupTempFile,
  deleteR2Object,
  getSignedMediaUrl,
  isR2Key,
  uploadFileToR2,
  validateMediaFile,
} = require("../utils/r2Media");

async function enforcePostingAllowed(req, res) {
  try {
    await ensureFeatureAllowed(req.user.id, "posting");
    return true;
  } catch (err) {
    sendFeatureRestrictionError(res, err);
    return false;
  }
}

function normalizeText(value = "") {
  return String(value || "").trim();
}

function normalizeMediaPrivacy(value = "") {
  const text = normalizeText(value).toLowerCase();

  if (
    text === "private" ||
    text === "hidden" ||
    text === "specific"
  ) {
    return "private";
  }

  if (
    text === "matches" ||
    text === "matched" ||
    text === "matched-only" ||
    text === "matched_only" ||
    text === "match-only" ||
    text === "match_only"
  ) {
    return "matches";
  }

  return "public";
}

function stripScopeTags(caption = "") {
  return normalizeText(caption)
    .replace(/\bscope:(public|matches|matched|private)\b/gi, "")
    .replace(/\bprivacy:(public|matches|matched|private)\b/gi, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function stripKindTags(caption = "") {
  return normalizeText(caption)
    .replace(/\bkind:(photo|image|reel|video|audio|voice)\b/gi, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function ensureGalleryCaptionTags(caption = "", privacy = "public", type = "image") {
  const normalizedPrivacy = normalizeMediaPrivacy(privacy);
  const normalizedType = String(type || "").toLowerCase() === "video" ? "video" : "image";

  const kindTag = normalizedType === "video" ? "kind:reel" : "kind:photo";
  const scopeTag =
    normalizedPrivacy === "private"
      ? "scope:private"
      : normalizedPrivacy === "matches"
      ? "scope:matches"
      : "scope:public";

  const clean = stripKindTags(stripScopeTags(caption));
  return [clean, kindTag, scopeTag, "intent:letsbuzz"]
    .filter(Boolean)
    .join(" ")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function isVideoLike(file = {}, type = "") {
  const mime = normalizeText(file?.mimetype).toLowerCase();
  const requestedType = normalizeText(type).toLowerCase();
  const originalName = normalizeText(file?.originalname).toLowerCase();

  return (
    requestedType === "video" ||
    requestedType === "reel" ||
    mime.startsWith("video/") ||
    /\.(mp4|mov|m4v|webm|avi|wmv|flv|mkv)$/i.test(originalName)
  );
}

function isAudioLike(file = {}, type = "") {
  const mime = normalizeText(file?.mimetype).toLowerCase();
  const requestedType = normalizeText(type).toLowerCase();
  const originalName = normalizeText(file?.originalname).toLowerCase();

  return (
    requestedType === "audio" ||
    requestedType === "voice" ||
    requestedType === "voice-intro" ||
    requestedType === "chat-audio" ||
    mime.startsWith("audio/") ||
    /\.(m4a|mp3|aac|wav)$/i.test(originalName)
  );
}

function normalizeR2Purpose(value = "") {
  const purpose = normalizeText(value).toLowerCase();

  switch (purpose) {
    case "avatar":
    case "avatars":
      return {
        folder: "avatars",
        kind: "avatar",
        type: "image",
      };

      case "gallery":
    case "gallery-photo":
    case "gallery-photos":
    case "photo":
    case "image":
      return {
        folder: "gallery-photos",
        kind: "image",
        type: "image",
      };

    case "comment-photo":
    case "comment-photos":
    case "private-comment-photo":
    case "private-comment-photos":
      return {
        folder: "comment-photo",
        kind: "image",
        type: "image",
      };

    case "chat-image":
    case "chat-images":
      return {
        folder: "chat-images",
        kind: "image",
        type: "image",
      };

    case "voice-intro":
    case "voice-intros":
      return {
        folder: "voice-intros",
        kind: "audio",
        type: "audio",
      };

    case "chat-audio":
    case "voice-message":
    case "audio":
      return {
        folder: "chat-audio",
        kind: "audio",
        type: "audio",
      };

    default:
      return {
        folder: "gallery-photos",
        kind: "image",
        type: "image",
      };
  }
}

async function signIfR2Key(value, expiresInSeconds = 3600) {
  const raw = normalizeText(value);
  if (!raw) return "";
  if (!isR2Key(raw)) return raw;

  return getSignedMediaUrl(raw, expiresInSeconds);
}

async function signMediaItem(item = {}, expiresInSeconds = 3600) {
  const rawUrl = normalizeText(item?.url || item?.fileUrl || item?.mediaUrl || "");
  const rawKey = normalizeText(item?.r2Key || item?.key || "");

  const key = rawKey || (isR2Key(rawUrl) ? rawUrl : "");
  const signedUrl = key ? await getSignedMediaUrl(key, expiresInSeconds) : rawUrl;

  return {
    ...item,
    url: signedUrl,
    mediaUrl: signedUrl,
    fileUrl: signedUrl,
    r2Key: key || item?.r2Key || "",
  };
}

async function signUserForResponse(userDoc) {
  const raw = userDoc?.toObject ? userDoc.toObject() : { ...(userDoc || {}) };

  if (raw.avatar) {
    raw.avatar = await signIfR2Key(raw.avatar, 21600);
  }

  if (Array.isArray(raw.media)) {
    raw.media = await Promise.all(
      raw.media.map((item) => signMediaItem(item, 7200))
    );
  }

  return raw;
}

async function uploadIncomingFileToR2({
  req,
  folder,
  kind,
  roomId = "",
}) {
  if (!req.file) {
    throw new Error("No file uploaded");
  }

  validateMediaFile(req.file, { kind });

  const key = buildR2Key({
    folder,
    userId: req.user.id,
    roomId,
    file: req.file,
  });

  const uploaded = await uploadFileToR2({
    file: req.file,
    key,
    contentType: req.file.mimetype,
  });

  cleanupTempFile(req.file.path);

  const signedUrl = await getSignedMediaUrl(uploaded.key, 3600);

  return {
    ...uploaded,
    url: signedUrl,
    signedUrl,
  };
}

/* ============================================================
   🧩 1️⃣ AVATAR UPLOAD URL
   POST /api/upload-avatar-url
============================================================ */
router.post("/upload-avatar-url", authMiddleware, async (req, res) => {
  try {
    const { avatarUrl, avatarKey } = req.body || {};
    const incoming = normalizeText(avatarKey || avatarUrl);

    if (!incoming) {
      return res.status(400).json({ error: "avatarUrl or avatarKey required" });
    }

    const user = await User.findOne({ id: req.user.id });
    if (!user) return res.status(404).json({ error: "User not found" });

    user.avatar = incoming;
    user.media ||= [];

    user.media.unshift({
      id: shortid.generate(),
      url: incoming,
      r2Key: isR2Key(incoming) ? incoming : "",
      storage: isR2Key(incoming) ? "r2" : "external",
      type: "image",
      privacy: "public",
      createdAt: Date.now(),
    });

    await user.save();

    const signedAvatarUrl = await signIfR2Key(incoming, 21600);
    const safeUser = await signUserForResponse(user);

    res.json({
      url: signedAvatarUrl,
      key: isR2Key(incoming) ? incoming : "",
      user: safeUser,
    });
  } catch (err) {
    console.error("❌ /upload-avatar-url error:", err);
    res.status(500).json({ error: "Failed to set avatar" });
  }
});

/* ============================================================
   🧩 2️⃣ AVATAR UPLOAD
   POST /api/upload-avatar
============================================================ */
router.post(
  "/upload-avatar",
  authMiddleware,
  upload.single("avatar"),
  async (req, res) => {
    try {
      const uploaded = await uploadIncomingFileToR2({
        req,
        folder: "avatars",
        kind: "avatar",
      });

      const user = await User.findOne({ id: req.user.id });
      if (!user) return res.status(404).json({ error: "User not found" });

      user.avatar = uploaded.key;
      await user.save();

      const safeUser = await signUserForResponse(user);

      res.json({
        ok: true,
        url: uploaded.signedUrl,
        key: uploaded.key,
        storage: "r2",
        user: safeUser,
      });
    } catch (err) {
      if (req.file?.path) cleanupTempFile(req.file.path);
      console.error("❌ /upload-avatar error:", err);
      res.status(500).json({ error: err?.message || "Avatar upload failed" });
    }
  }
);

/* ============================================================
   🧩 3️⃣ AVATAR FACECROP COMPAT ROUTE
   POST /api/upload-avatar-facecrop
============================================================ */
router.post(
  "/upload-avatar-facecrop",
  authMiddleware,
  upload.single("avatar"),
  async (req, res) => {
    try {
      const uploaded = await uploadIncomingFileToR2({
        req,
        folder: "avatars",
        kind: "avatar",
      });

      const user = await User.findOneAndUpdate(
        { id: req.user.id },
        { $set: { avatar: uploaded.key, updatedAt: Date.now() } },
        { new: true }
      );

      if (!user) return res.status(404).json({ error: "User not found" });

      res.json({
        ok: true,
        url: uploaded.signedUrl,
        key: uploaded.key,
        storage: "r2",
      });
    } catch (err) {
      if (req.file?.path) cleanupTempFile(req.file.path);
      console.error("❌ /upload-avatar-facecrop error:", err);
      res.status(500).json({ error: err?.message || "Avatar upload failed" });
    }
  }
);

/* ============================================================
   🧩 4️⃣ GENERIC R2 FILE UPLOAD
   POST /api/upload-r2-file
============================================================ */
router.post(
  "/upload-r2-file",
  authMiddleware,
  upload.single("file"),
  async (req, res) => {
    try {
      const purpose = normalizeR2Purpose(
        req.body?.purpose || req.body?.folder || req.body?.type
      );

      if (isVideoLike(req.file, req.body?.type)) {
        if (req.file?.path) cleanupTempFile(req.file.path);
        return res.status(400).json({
          error:
            "Video/reel uploads are not handled by R2 photo-audio bucket yet.",
        });
      }

      const uploaded = await uploadIncomingFileToR2({
        req,
        folder: purpose.folder,
        kind: purpose.kind,
        roomId: req.body?.roomId || "",
      });

      res.json({
        ok: true,
        storage: "r2",
        bucket: uploaded.bucket,
        key: uploaded.key,
        r2Key: uploaded.key,
        url: uploaded.signedUrl,
        signedUrl: uploaded.signedUrl,
        type: purpose.type,
        contentType: uploaded.contentType,
        size: uploaded.size,
      });
    } catch (err) {
      if (req.file?.path) cleanupTempFile(req.file.path);
      console.error("❌ /upload-r2-file error:", err);
      res.status(500).json({ error: err?.message || "R2 upload failed" });
    }
  }
);

/* ============================================================
   🧩 5️⃣ GENERIC MEDIA UPLOAD FILE
   POST /api/upload-media-file
============================================================ */
router.post(
  "/upload-media-file",
  authMiddleware,
  upload.single("file"),
  async (req, res) => {
    try {
      if (!(await enforcePostingAllowed(req, res))) return;

      if (isVideoLike(req.file, req.body?.type)) {
        if (req.file?.path) cleanupTempFile(req.file.path);
        return res.status(400).json({
          error:
            "Reels/videos are not migrated to R2 photo-audio storage yet. Use the existing video flow for now.",
        });
      }

      const audio = isAudioLike(req.file, req.body?.type);
      const purpose = audio
        ? { folder: "voice-intros", kind: "audio", type: "audio" }
        : { folder: "gallery-photos", kind: "image", type: "image" };

      const uploaded = await uploadIncomingFileToR2({
        req,
        folder: purpose.folder,
        kind: purpose.kind,
      });

      const user = await User.findOne({ id: req.user.id });
      if (!user) return res.status(404).json({ error: "User not found" });

        const normalizedPrivacy = normalizeMediaPrivacy(req.body?.privacy);
      const normalizedType = purpose.type === "video" ? "video" : "image";

      const mediaItem = {
        id: shortid.generate(),
        url: uploaded.key,
        r2Key: uploaded.key,
        storage: "r2",
        type: normalizedType,
        caption: ensureGalleryCaptionTags(
          req.body?.caption,
          normalizedPrivacy,
          normalizedType
        ),
        privacy: normalizedPrivacy,
        createdAt: Date.now(),
      };

      user.media ||= [];
      user.media.unshift(mediaItem);
      await user.save();

      const signedItem = await signMediaItem(mediaItem, 7200);

      res.json({
        ok: true,
        storage: "r2",
        url: uploaded.signedUrl,
        key: uploaded.key,
        type: mediaItem.type,
        media: signedItem,
      });
    } catch (err) {
      if (req.file?.path) cleanupTempFile(req.file.path);
      console.error("❌ /upload-media-file error:", err);
      res.status(500).json({ error: err?.message || "Media upload failed" });
    }
  }
);

/* ============================================================
   🧩 6️⃣ FRONTEND MEDIA METADATA SAVE
   POST /api/upload-media
============================================================ */
router.post("/upload-media", authMiddleware, async (req, res) => {
  try {
    if (!(await enforcePostingAllowed(req, res))) return;

    const { fileUrl, fileKey, r2Key, type, caption, privacy } = req.body || {};
    const incomingKey = normalizeText(r2Key || fileKey);
    const incomingUrl = normalizeText(fileUrl);
    const storedValue = incomingKey || incomingUrl;

    if (!storedValue) {
      return res.status(400).json({ error: "fileUrl or fileKey is required" });
    }

     const user = await User.findOne({ id: req.user.id });
    if (!user) return res.status(404).json({ error: "User not found" });

    const isR2 = isR2Key(storedValue);
    const normalizedType = type === "video" || type === "reel" ? "video" : "image";
    const normalizedPrivacy = normalizeMediaPrivacy(privacy);

    const mediaItem = {
      id: shortid.generate(),
      url: storedValue,
      r2Key: isR2 ? storedValue : "",
      storage: isR2 ? "r2" : "external",
      type: normalizedType,
      caption: ensureGalleryCaptionTags(
        caption,
        normalizedPrivacy,
        normalizedType
      ),
      privacy: normalizedPrivacy,
      createdAt: Date.now(),
    };

    user.media ||= [];
    user.media.unshift(mediaItem);
    await user.save();

    const signedItem = await signMediaItem(mediaItem, 7200);
    const signedMedia = await Promise.all(
      user.media.map((item) => signMediaItem(item, 7200))
    );

    res.json({
      success: true,
      media: signedMedia,
      item: signedItem,
    });
  } catch (err) {
    console.error("❌ /upload-media error:", err);
    res.status(500).json({ error: "Upload failed" });
  }
});

/* ============================================================
   🧩 7️⃣ UPDATE MEDIA PRIVACY
   PATCH /api/media/:id/privacy
============================================================ */
router.patch("/media/:id/privacy", authMiddleware, async (req, res) => {
  try {
    const mediaId = String(req.params.id || "");
    const { privacy } = req.body || {};

    const user = await User.findOne({ id: req.user.id });
    if (!user) return res.status(404).json({ error: "User not found" });

    user.media ||= [];
    const idx = user.media.findIndex((m) => String(m.id) === mediaId);
    if (idx < 0) return res.status(404).json({ error: "Media not found" });

    const current = user.media[idx];
    const next =
      privacy !== undefined
        ? normalizeMediaPrivacy(privacy)
        : normalizeMediaPrivacy(current.privacy) === "private"
        ? "public"
        : "private";

    const normalizedType =
      String(current.type || "").toLowerCase() === "video" ? "video" : "image";

    user.media[idx] = {
      ...current,
      privacy: next,
      caption: ensureGalleryCaptionTags(
        current.caption,
        next,
        normalizedType
      ),
    };

    await user.save();

    const signedItem = await signMediaItem(user.media[idx], 7200);

    return res.json({
      success: true,
      media: signedItem,
      privacy: next,
    });
  } catch (err) {
    console.error("❌ PATCH /media/:id/privacy error:", err);
    res.status(500).json({ error: "Failed to update privacy" });
  }
});

/* ============================================================
   🧩 8️⃣ UPDATE MEDIA
   PATCH /api/media/:id
============================================================ */
router.patch("/media/:id", authMiddleware, async (req, res) => {
  try {
    const mediaId = String(req.params.id || "");
    const { caption, privacy } = req.body || {};

    const user = await User.findOne({ id: req.user.id });
    if (!user) return res.status(404).json({ error: "User not found" });

    user.media ||= [];
    const idx = user.media.findIndex((m) => String(m.id) === mediaId);
    if (idx < 0) return res.status(404).json({ error: "Media not found" });

    const current = user.media[idx];

    const normalizedType =
      String(current.type || "").toLowerCase() === "video" ? "video" : "image";
    const nextPrivacy =
      privacy !== undefined
        ? normalizeMediaPrivacy(privacy)
        : normalizeMediaPrivacy(current.privacy);
    const nextCaption =
      typeof caption === "string" ? caption : current.caption;

    const next = {
      ...current,
      privacy: nextPrivacy,
      caption: ensureGalleryCaptionTags(
        nextCaption,
        nextPrivacy,
        normalizedType
      ),
    };

    user.media[idx] = next;
    await user.save();

    const signedItem = await signMediaItem(next, 7200);

    return res.json({
      success: true,
      media: signedItem,
    });
  } catch (err) {
    console.error("❌ PATCH /media/:id error:", err);
    res.status(500).json({ error: "Failed to update media" });
  }
});

/* ============================================================
   🧩 9️⃣ DELETE MEDIA
   DELETE /api/media/:id
============================================================ */
router.delete("/media/:id", authMiddleware, async (req, res) => {
  try {
    const mediaId = String(req.params.id || "");

    const user = await User.findOne({ id: req.user.id });
    if (!user) return res.status(404).json({ error: "User not found" });

    user.media ||= [];
    const mediaItem = user.media.find((m) => String(m.id) === mediaId);

    if (!mediaItem) {
      return res.status(404).json({ error: "Media not found" });
    }

    const key =
      normalizeText(mediaItem?.r2Key) ||
      (isR2Key(mediaItem?.url) ? normalizeText(mediaItem?.url) : "");

    user.media = user.media.filter((m) => String(m.id) !== mediaId);
    await user.save();

    if (key) {
      try {
        await deleteR2Object(key);
      } catch (deleteErr) {
        console.error("⚠️ R2 delete failed:", deleteErr);
      }
    }

    return res.json({
      success: true,
      deletedFromR2: !!key,
    });
  } catch (err) {
    console.error("❌ DELETE /media/:id error:", err);
    res.status(500).json({ error: "Failed to delete media" });
  }
});

console.log("✅ Upload routes initialized (R2 photo/audio + Cloudinary gifts untouched)");
module.exports = router;