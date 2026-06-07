/**
 * ============================================================
 * 📁 File: routes/streamUploads.js
 * 🎬 Purpose: Cloudflare Stream upload + playback routes for RomBuzz.
 *
 * Endpoints:
 *   POST /api/stream/direct-upload
 *     → Create a one-time Cloudflare Stream upload URL.
 *
 *   POST /api/stream/complete
 *     → Save uploaded Stream UID as a profile reel in User.media[].
 *
 *   GET /api/stream/:uid/status
 *     → Fetch current Cloudflare Stream processing status.
 *
 *   GET /api/stream/:uid/playback
 *     → Return playback info. Private/signed support is prepared.
 *
 * Notes:
 *   - Photos/audio stay on R2.
 *   - Videos/reels go to Cloudflare Stream.
 *   - Old Cloudinary videos remain supported by existing routes.
 * ============================================================
 */

const express = require("express");
const router = express.Router();
const shortid = require("shortid");

const authMiddleware = require("./auth-middleware");
const {
  ensureFeatureAllowed,
  sendFeatureRestrictionError,
} = require("../utils/moderation");

const User = require("../models/User");

const {
  CF_STREAM_MAX_REEL_SECONDS,
  buildPlaybackUrls,
  createDirectUpload,
  createSignedPlaybackToken,
  getStreamVideo,
  normalizePrivacy,
  normalizeStreamUid,
} = require("../services/cloudflareStreamService");

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

function ensureStreamCaptionTags(caption = "", privacy = "matches") {
  const normalizedPrivacy = normalizePrivacy(privacy);

  const scopeTag =
    normalizedPrivacy === "private"
      ? "scope:private"
      : normalizedPrivacy === "matches"
      ? "scope:matches"
      : "scope:public";

  const clean = stripKindTags(stripScopeTags(caption));

  return [clean, "kind:reel", scopeTag, "intent:letsbuzz"]
    .filter(Boolean)
    .join(" ")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function buildStreamMediaItem({
  uid,
  privacy,
  caption,
  video = {},
  requireSignedURLs = true,
}) {
  const streamUid = normalizeStreamUid(uid);
  const playback = buildPlaybackUrls(streamUid);

  return {
    id: shortid.generate(),

    // Backward-compatible fields existing gallery/reel UI already checks.
    url: "",
    mediaUrl: "",
    videoUrl: "",
    secureUrl: "",
    secure_url: "",

    // New Stream identity.
    provider: "cloudflare_stream",
    storage: "cloudflare_stream",
    streamUid,

    cloudflareStream: {
      uid: streamUid,
      provider: "cloudflare_stream",
      requireSignedURLs: !!requireSignedURLs,
      status: video?.status || "processing",
      duration: Number(video?.duration || 0) || 0,
      readyToStream: !!video?.readyToStream,
      readyToStreamAt: video?.readyToStreamAt || null,
    },

    playback: requireSignedURLs ? {} : playback,
    thumbnailUrl: requireSignedURLs ? "" : playback.thumbnailUrl,

    type: "video",
    mediaType: "reel",
    caption: ensureStreamCaptionTags(caption, privacy),
    privacy: normalizePrivacy(privacy),
    duration: Number(video?.duration || 0) || 0,
    status: video?.status || "processing",
    createdAt: Date.now(),
  };
}

/* ============================================================
   1️⃣ Create Stream direct upload URL
   POST /api/stream/direct-upload
============================================================ */
router.post("/direct-upload", authMiddleware, async (req, res) => {
  try {
    if (!(await enforcePostingAllowed(req, res))) return;

    const privacy = normalizePrivacy(req.body?.privacy || "matches");
    const name = normalizeText(req.body?.name || req.body?.filename || "");
    const context = normalizeText(req.body?.context || "profile_reel");

    const directUpload = await createDirectUpload({
      userId: req.user.id,
      privacy,
      name,
      context,
      requireSignedURLs: req.body?.requireSignedURLs,
      meta: {
        mediaType: "reel",
        maxSeconds: String(CF_STREAM_MAX_REEL_SECONDS),
      },
    });

    return res.json({
      ok: true,
      ...directUpload,
    });
  } catch (err) {
    console.error("❌ /stream/direct-upload error:", err);
    return res.status(err.status || 500).json({
      error: err?.message || "Failed to create Stream upload URL",
    });
  }
});

/* ============================================================
   2️⃣ Complete Stream upload and save profile reel metadata
   POST /api/stream/complete
============================================================ */
router.post("/complete", authMiddleware, async (req, res) => {
  try {
    if (!(await enforcePostingAllowed(req, res))) return;

    const uid = normalizeStreamUid(req.body?.uid || req.body?.streamUid || "");
    const privacy = normalizePrivacy(req.body?.privacy || "matches");
    const caption = normalizeText(req.body?.caption || "");

    if (!uid) {
      return res.status(400).json({ error: "streamUid is required" });
    }

    const user = await User.findOne({ id: req.user.id });
    if (!user) return res.status(404).json({ error: "User not found" });

    const video = await getStreamVideo(uid);

    const mediaItem = buildStreamMediaItem({
      uid,
      privacy,
      caption,
      video,
      requireSignedURLs: video?.requireSignedURLs !== false,
    });

    user.media ||= [];
    user.media.unshift(mediaItem);
    user.markModified("media");
    await user.save();

    return res.json({
      ok: true,
      provider: "cloudflare_stream",
      streamUid: uid,
      media: mediaItem,
      video,
    });
  } catch (err) {
    console.error("❌ /stream/complete error:", err);
    return res.status(err.status || 500).json({
      error: err?.message || "Failed to save Stream upload",
    });
  }
});

/* ============================================================
   3️⃣ Check Stream processing status
   GET /api/stream/:uid/status
============================================================ */
router.get("/:uid/status", authMiddleware, async (req, res) => {
  try {
    const uid = normalizeStreamUid(req.params.uid || "");
    if (!uid) return res.status(400).json({ error: "stream uid required" });

    const video = await getStreamVideo(uid);

    return res.json({
      ok: true,
      video,
    });
  } catch (err) {
    console.error("❌ /stream/:uid/status error:", err);
    return res.status(err.status || 500).json({
      error: err?.message || "Failed to fetch Stream status",
    });
  }
});

/* ============================================================
   4️⃣ Get playback info
   GET /api/stream/:uid/playback
============================================================ */
router.get("/:uid/playback", authMiddleware, async (req, res) => {
  try {
    const uid = normalizeStreamUid(req.params.uid || "");
    if (!uid) return res.status(400).json({ error: "stream uid required" });

    const video = await getStreamVideo(uid);

    if (video.requireSignedURLs) {
      const signed = await createSignedPlaybackToken(uid);

      return res.json({
        ok: true,
        provider: "cloudflare_stream",
        streamUid: uid,
        signed: true,
        status: video.status,
        duration: video.duration,
        token: signed.token,
        expiresInSeconds: signed.expiresInSeconds,
        playback: signed.playback,
      });
    }

    return res.json({
      ok: true,
      provider: "cloudflare_stream",
      streamUid: uid,
      signed: false,
      status: video.status,
      duration: video.duration,
      playback: buildPlaybackUrls(uid),
    });
  } catch (err) {
    console.error("❌ /stream/:uid/playback error:", err);
    return res.status(err.status || 500).json({
      error: err?.message || "Failed to create Stream playback info",
    });
  }
});

module.exports = router;