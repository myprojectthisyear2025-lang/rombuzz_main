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
const Match = require("../models/Match");

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

    // Purpose separation.
    // Do not reuse this route for chat videos.
    purpose: "profile_reel",
    uploadPurpose: "profile_reel",
    context: "profile_reel",

    cloudflareStream: {
      uid: streamUid,
      provider: "cloudflare_stream",
      purpose: "profile_reel",
      context: "profile_reel",
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

const PROFILE_REEL_CONTEXT = "profile_reel";

function normalizeStreamContext(value = "") {
  return normalizeText(value || PROFILE_REEL_CONTEXT).toLowerCase();
}

function assertProfileReelContext(value = "") {
  const context = normalizeStreamContext(value);

  if (context !== PROFILE_REEL_CONTEXT) {
    const err = new Error("This Stream route only supports profile_reel uploads");
    err.status = 400;
    throw err;
  }

  return PROFILE_REEL_CONTEXT;
}

function getCloudflareVideoMeta(video = {}) {
  return {
    ...(video?.raw?.meta && typeof video.raw.meta === "object" ? video.raw.meta : {}),
    ...(video?.meta && typeof video.meta === "object" ? video.meta : {}),
  };
}

function getCloudflareVideoCreator(video = {}) {
  const meta = getCloudflareVideoMeta(video);
  return normalizeText(
    meta.ownerId ||
      meta.creator ||
      video?.raw?.creator ||
      video?.creator ||
      ""
  );
}

function getCloudflareVideoContext(video = {}) {
  const meta = getCloudflareVideoMeta(video);
  return normalizeStreamContext(meta.context || video?.raw?.context || video?.context || "");
}

async function findProfileReelByStreamUid(uid) {
  const cleanUid = normalizeStreamUid(uid);
  if (!cleanUid) return null;

  const owner = await User.findOne({
    "media.streamUid": cleanUid,
  }).lean();

  if (!owner) return null;

  const media = (owner.media || []).find((item) => {
    const itemUid = normalizeStreamUid(
      item?.streamUid ||
        item?.uid ||
        item?.cloudflareStream?.uid ||
        ""
    );

    return itemUid === cleanUid;
  });

  if (!media) return null;

  return { owner, media };
}

async function canViewProfileReel({ viewerId, ownerId, media }) {
  const me = String(viewerId || "");
  const owner = String(ownerId || "");

  if (!me || !owner || !media) return false;
  if (me === owner) return true;

  const privacy = normalizePrivacy(
    media?.privacy ||
      media?.scope ||
      media?.visibility ||
      ""
  );

  const caption = normalizeText(media?.caption || "").toLowerCase();

  const isPrivate =
    privacy === "private" ||
    caption.includes("scope:private") ||
    caption.includes("privacy:private");

  if (isPrivate) return false;

  const isMatchedOnly =
    privacy === "matches" ||
    caption.includes("scope:matches") ||
    caption.includes("scope:matched") ||
    caption.includes("privacy:matches");

  if (!isMatchedOnly) return true;

  const match = await Match.findOne({
    status: "matched",
    users: { $all: [me, owner] },
  }).lean();

  return !!match;
}

async function getAllowedProfileReelOrThrow(uid, viewerId) {
  const found = await findProfileReelByStreamUid(uid);

  if (!found) {
    const err = new Error("Profile reel not found");
    err.status = 404;
    throw err;
  }

  const allowed = await canViewProfileReel({
    viewerId,
    ownerId: found.owner.id,
    media: found.media,
  });

  if (!allowed) {
    const err = new Error("Not allowed to view this profile reel");
    err.status = 403;
    throw err;
  }

  return found;
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
    const context = assertProfileReelContext(req.body?.context || "profile_reel");

    const directUpload = await createDirectUpload({
      userId: req.user.id,
      privacy,
      name,
      context,
      requireSignedURLs: req.body?.requireSignedURLs,
      meta: {
        purpose: PROFILE_REEL_CONTEXT,
        uploadPurpose: PROFILE_REEL_CONTEXT,
        mediaType: "reel",
        maxSeconds: String(CF_STREAM_MAX_REEL_SECONDS),
      },
    });

    return res.json({
      ok: true,
      context: PROFILE_REEL_CONTEXT,
      purpose: PROFILE_REEL_CONTEXT,
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
    const context = assertProfileReelContext(req.body?.context || "profile_reel");

    if (!uid) {
      return res.status(400).json({ error: "streamUid is required" });
    }

    const user = await User.findOne({ id: req.user.id });
    if (!user) return res.status(404).json({ error: "User not found" });

    const video = await getStreamVideo(uid);

    const creator = getCloudflareVideoCreator(video);
    if (creator && String(creator) !== String(req.user.id)) {
      return res.status(403).json({ error: "This Stream video does not belong to you" });
    }

    const videoContext = getCloudflareVideoContext(video);
    if (videoContext && videoContext !== PROFILE_REEL_CONTEXT) {
      return res.status(400).json({ error: "This Stream video is not a profile reel" });
    }

    const alreadySaved = (user.media || []).some((item) => {
      const itemUid = normalizeStreamUid(
        item?.streamUid ||
          item?.uid ||
          item?.cloudflareStream?.uid ||
          ""
      );

      return itemUid === uid;
    });

    if (alreadySaved) {
      return res.json({
        ok: true,
        provider: "cloudflare_stream",
        context,
        purpose: PROFILE_REEL_CONTEXT,
        streamUid: uid,
        alreadySaved: true,
        video,
      });
    }

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
      context,
      purpose: PROFILE_REEL_CONTEXT,
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

    await getAllowedProfileReelOrThrow(uid, req.user.id);

    const video = await getStreamVideo(uid);

    return res.json({
      ok: true,
      provider: "cloudflare_stream",
      context: PROFILE_REEL_CONTEXT,
      purpose: PROFILE_REEL_CONTEXT,
      streamUid: uid,
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

    const { media, owner } = await getAllowedProfileReelOrThrow(uid, req.user.id);

    const video = await getStreamVideo(uid);

    if (video.requireSignedURLs) {
      const signed = await createSignedPlaybackToken(uid);

      return res.json({
        ok: true,
        provider: "cloudflare_stream",
        context: PROFILE_REEL_CONTEXT,
        purpose: PROFILE_REEL_CONTEXT,
        streamUid: uid,
        ownerId: owner.id,
        mediaId: media.id || "",
        signed: true,
        status: video.status,
        duration: video.duration,
        token: signed.token,
        expiresInSeconds: signed.expiresInSeconds,
        thumbnailUrl: media.thumbnailUrl || video.thumbnailUrl || "",
        playback: signed.playback,
      });
    }

    return res.json({
      ok: true,
      provider: "cloudflare_stream",
      context: PROFILE_REEL_CONTEXT,
      purpose: PROFILE_REEL_CONTEXT,
      streamUid: uid,
      ownerId: owner.id,
      mediaId: media.id || "",
      signed: false,
      status: video.status,
      duration: video.duration,
      thumbnailUrl: media.thumbnailUrl || video.thumbnailUrl || "",
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