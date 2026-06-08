/**
 * ============================================================
 * 📁 File: routes/feed.js
 * 🧩 Purpose: Aggregates posts & reels from matched users.
 *
 * Endpoints:
 *   GET /api/feed                     → Show matched users’ posts and reels
 *
 * Features:
 *   - Collects both image and video posts
 *   - Includes only visibility: "matches" or "public"
 *   - Sorts feed by creation date (newest first)
 *   - Uses baseSanitizeUser() for safe user info
 *
 * Dependencies:
 *   - models/User.js        → Mongoose user schema
 *   - models/Match.js       → Match relationship collection
 *   - authMiddleware.js     → Validates JWT session
 *   - utils/helpers.js      → baseSanitizeUser()
 *
 * Notes:
 *   - Used by LetsBuzz.jsx and Discover.jsx
 * ============================================================
 */

const express = require("express");
const router = express.Router();
const authMiddleware = require("../routes/auth-middleware");
const User = require("../models/User");
const Match = require("../models/Match");
const PostModel = require("../models/PostModel");
const { baseSanitizeUser } = require("../utils/helpers");
const { getSignedMediaUrl, isR2Key } = require("../utils/r2Media");

function normalizeMediaString(value = "") {
  return String(value || "").trim();
}

async function signR2Value(value, expiresInSeconds = 3600) {
  const raw = normalizeMediaString(value);
  if (!raw) return "";
  if (!isR2Key(raw)) return raw;

  return getSignedMediaUrl(raw, expiresInSeconds);
}

async function signR2MediaItem(item = {}, expiresInSeconds = 3600) {
  if (!item) return item;

  if (typeof item === "string") {
    return signR2Value(item, expiresInSeconds);
  }

  const rawUrl = normalizeMediaString(
    item.url ||
      item.mediaUrl ||
      item.fileUrl ||
      item.secureUrl ||
      item.secure_url ||
      item.src ||
      item.imageUrl ||
      item.photoUrl ||
      item.videoUrl ||
      ""
  );

  const rawKey = normalizeMediaString(item.r2Key || item.key || "");
  const key = rawKey || (isR2Key(rawUrl) ? rawUrl : "");

  const signedUrl = key
    ? await getSignedMediaUrl(key, expiresInSeconds)
    : rawUrl;

  return {
    ...item,
    url: signedUrl,
    mediaUrl: signedUrl,
    fileUrl: signedUrl,
    secureUrl: signedUrl,
    secure_url: signedUrl,
    imageUrl: signedUrl,
    photoUrl: signedUrl,
    r2Key: key || item.r2Key || "",
  };
}

async function signFeedUser(user = {}) {
  const safe = baseSanitizeUser(user);
  const signedAvatar = await signR2Value(
    safe.avatar || safe.avatarUrl || safe.profilePic || safe.photo || "",
    21600
  );

  safe.avatar = signedAvatar;
  safe.avatarUrl = signedAvatar;

  if (Array.isArray(safe.media)) {
    safe.media = await Promise.all(
      safe.media.map((item) => signR2MediaItem(item, 7200))
    );
  }

  if (Array.isArray(safe.photos)) {
    safe.photos = await Promise.all(
      safe.photos.map((item) => signR2MediaItem(item, 7200))
    );
  }

  return safe;
}

// ============================================================
// ============================================================
// ✅ Gallery caption tags parser (scope + kind)
// We store visibility inside caption like: "scope:public scope:matches scope:private"
// and type inside caption like: "kind:photo kind:reel"
// ============================================================
function parseCaptionTags(caption) {
  const text = String(caption || "").toLowerCase();

  const scope =
    text.includes("scope:private") ? "private" :
    text.includes("scope:matches") ? "matches" :
    text.includes("scope:matched") ? "matches" :
    text.includes("scope:public") ? "public" :
    null;

  const kind =
    text.includes("kind:reel") ? "reel" :
    text.includes("kind:video") ? "reel" :
    text.includes("kind:photo") ? "photo" :
    null;

  return { scope, kind };
}

function normalizeLetsBuzzPrivacy(value = "") {
  const text = String(value || "").toLowerCase().trim();

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

  if (text === "public") return "public";

  return "";
}

function getLetsBuzzMediaUrlCandidate(media = {}) {
  return normalizeMediaString(
    media.url ||
      media.mediaUrl ||
      media.fileUrl ||
      media.secureUrl ||
      media.secure_url ||
      media.src ||
      media.imageUrl ||
      media.photoUrl ||
      media.videoUrl ||
      ""
  );
}

function getCloudflareStreamUid(media = {}) {
  return normalizeMediaString(
    media.streamUid ||
      media.uid ||
      media?.cloudflareStream?.uid ||
      ""
  );
}

function isCloudflareStreamProfileReel(media = {}) {
  const provider = String(media.provider || media.storage || "").toLowerCase();
  const purpose = String(
    media.purpose ||
      media.uploadPurpose ||
      media.context ||
      media?.cloudflareStream?.purpose ||
      media?.cloudflareStream?.context ||
      ""
  ).toLowerCase();

  return (
    (provider === "cloudflare_stream" || !!getCloudflareStreamUid(media)) &&
    (!purpose || purpose === "profile_reel")
  );
}

function inferLetsBuzzKind(media = {}) {
  const caption = String(media.caption || "").toLowerCase();
  const type = String(media.type || media.mediaType || "").toLowerCase();
  const url = getLetsBuzzMediaUrlCandidate(media).toLowerCase();

  if (
    isCloudflareStreamProfileReel(media) ||
    caption.includes("kind:reel") ||
    caption.includes("kind:video") ||
    type === "video" ||
    type === "reel" ||
    type.includes("video") ||
    type.includes("reel") ||
    /\.(mp4|mov|m4v|webm|avi|wmv|flv|mkv|mpg|mpeg|m3u8)(\?|#|$)/i.test(url)
  ) {
    return "reel";
  }

  if (
    type === "audio" ||
    type === "voice" ||
    type.includes("audio") ||
    type.includes("voice") ||
    /\.(m4a|mp3|aac|wav)(\?|#|$)/i.test(url)
  ) {
    return "audio";
  }

  return "photo";
}

function resolveLetsBuzzScope(media = {}) {
  const caption = String(media.caption || "").toLowerCase();
  const tags = parseCaptionTags(caption);
  const privacy = normalizeLetsBuzzPrivacy(
    media.privacy || media.visibility || media.scope
  );

  // Private must always win, no matter where it is stored.
  if (
    privacy === "private" ||
    tags.scope === "private" ||
    caption.includes("privacy:private")
  ) {
    return "private";
  }

  if (
    privacy === "matches" ||
    tags.scope === "matches" ||
    caption.includes("privacy:matches") ||
    caption.includes("privacy:matched")
  ) {
    return "matches";
  }

  if (
    privacy === "public" ||
    tags.scope === "public" ||
    caption.includes("privacy:public")
  ) {
    return "public";
  }

  // Old gallery media may not have caption tags.
  // Since Let’sBuzz is already matched-only, legacy non-private media can be treated as public.
  return "public";
}

function isLetsBuzzEligibleGalleryMedia(media = {}) {
  const rawUrl = getLetsBuzzMediaUrlCandidate(media);
  const streamUid = getCloudflareStreamUid(media);

  if (!rawUrl && !streamUid) return false;

  const scope = resolveLetsBuzzScope(media);
  if (scope === "private") return false;

  const kind = inferLetsBuzzKind(media);
  if (kind === "audio") return false;

  return scope === "public" || scope === "matches";
}

function isPrivateCommentVisibleToViewer(comment, viewerId, mediaOwnerId) {
  const ownerId = String(mediaOwnerId || "");
  const commentAuthorId = String(comment?.userId || "");
  const me = String(viewerId || "");

  if (!me) return false;

  const visibleTo = Array.isArray(comment?.visibleTo)
    ? comment.visibleTo.map(String)
    : [ownerId, commentAuthorId];

  return visibleTo.includes(me);
}

function ensurePrivateCommentVisibleTo(mediaOwnerId, commentAuthorId, existing = []) {
  const set = new Set(Array.isArray(existing) ? existing.map(String) : []);

  set.add(String(mediaOwnerId || ""));
  set.add(String(commentAuthorId || ""));

  return Array.from(set).filter(Boolean);
}

function sanitizeMediaCommentsForViewer(comments = [], viewerId, mediaOwnerId) {
  const list = Array.isArray(comments) ? comments : [];

  return list
    .filter((comment) =>
      isPrivateCommentVisibleToViewer(comment, viewerId, mediaOwnerId)
    )
    .map((comment) => ({
      ...comment,
      visibleTo: ensurePrivateCommentVisibleTo(
        mediaOwnerId,
        comment?.userId,
        comment?.visibleTo
      ),
    }));
}


/* ============================================================
   🏠 FEED ENDPOINT — show matched users’ posts & reels
============================================================ */
router.get("/", authMiddleware, async (req, res) => {

  try {
    const myId = req.user.id;

    // 🧩 Fetch all matches where I’m one of the users
    const matches = await Match.find({ users: myId }).lean();
    const myMatches = matches
      .map((m) => m.users.find((id) => id !== myId))
      .filter(Boolean);

     // 🧺 Unified feed container
    const feed = [];
    const seen = new Set();

    // 🔍 Fetch matched users and map them by id
    const matchedUsers = await User.find({ id: { $in: myMatches } }).lean();
    const userById = new Map(matchedUsers.map((u) => [u.id, u]));

    // 1️⃣ Mongo posts (PostModel) from matched users
    const mongoPosts = await PostModel.find({
      userId: { $in: myMatches },
      privacy: { $in: ["matches", "public"] },
      isActive: true,
    })
      .sort({ createdAt: -1 })
      .lean();

    for (const p of mongoPosts) {
      const owner = userById.get(p.userId);
      if (!owner) continue;

      const id = p.id || String(p._id);
      if (seen.has(id)) continue;
      seen.add(id);

          feed.push({
        ...p,
        id,
        mediaUrl: await signR2Value(p.mediaUrl, 7200),
        user: await signFeedUser(owner),
      });
    }

     // 2️⃣ Legacy embedded posts on User (u.posts) – keep for older content
    for (const u of matchedUsers) {
      if (!Array.isArray(u.posts)) continue;

      for (const p of u.posts) {
        if (!["matches", "public"].includes(p.visibility)) continue;

        const id = p.id || (p._id && String(p._id));
        if (id && seen.has(id)) continue;
        if (id) seen.add(id);

            feed.push({
          ...p,
          id,
          mediaUrl: await signR2Value(p.mediaUrl || p.url || "", 7200),
          user: await signFeedUser(u),
        });
      }
    }

    // 3️⃣ NEW: Gallery media (u.media) — include ONLY scope:public or scope:matches
    //      - kind:photo -> image post
    //      - kind:reel  -> video post
    for (const u of matchedUsers) {
      const list = Array.isArray(u.media) ? u.media : [];
      if (!list.length) continue;

      for (const m of list) {
        const { scope, kind } = parseCaptionTags(m.caption);
        if (!scope || scope === "private") continue; // ✅ only public/matches
        if (kind !== "photo" && kind !== "reel") continue;

        const id = String(m.id || m._id || "");
        if (!id) continue;
        if (seen.has(id)) continue;
        seen.add(id);

             const signedMedia = await signR2MediaItem(m, 7200);
        const signedMediaUrl =
          signedMedia.mediaUrl ||
          signedMedia.url ||
          signedMedia.secureUrl ||
          signedMedia.secure_url ||
          signedMedia.fileUrl ||
          signedMedia.imageUrl ||
          signedMedia.photoUrl ||
          "";

        feed.push({
          id,
          userId: u.id,

          // match PostModel shape used by the app
          text: "",
          mediaUrl: signedMediaUrl,
          url: signedMediaUrl,
          fileUrl: signedMediaUrl,
          secureUrl: signedMediaUrl,
          secure_url: signedMediaUrl,
          imageUrl: signedMediaUrl,
          photoUrl: signedMediaUrl,
          type: kind === "reel" ? "video" : "image",
          privacy: scope, // "public" or "matches"
          reactions: {},
          comments: [],

          // timeline
          createdAt: Number(m.createdAt || m.updatedAt || 0),

          // metadata (safe extra fields)
          fromGallery: true,
          mediaId: id,

          // user card
          user: await signFeedUser(u),
        });
      }
    }

    // 📅 Sort newest first
    feed.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));


    res.json({ posts: feed });

  } catch (err) {
    console.error("❌ Feed fetch failed:", err);
    res.status(500).json({ error: "failed to load feed" });
  }
});

/* ============================================================
   🔥 LETSBUZZ GALLERY FEED — matched users media
   Uses User.media[] with visibility rules
============================================================ */
router.get("/letsbuzz", authMiddleware, async (req, res) => {
  try {
    const myId = String(req.user.id);

    // 1️⃣ Fetch matches
    const matches = await Match.find({ users: myId }).lean();
    const matchedIds = matches
      .flatMap((m) => m.users)
      .filter((id) => String(id) !== myId);

    // 2️⃣ Fetch matched users
    const users = await User.find({ id: { $in: matchedIds } }).lean();

    const feed = [];

     for (const u of users) {
      if (!Array.isArray(u.media)) continue;

      for (const m of u.media) {
        if (!isLetsBuzzEligibleGalleryMedia(m)) continue;

        const visibleComments = sanitizeMediaCommentsForViewer(
          m.comments,
          myId,
          u.id
        );

          const signedMedia = await signR2MediaItem(m, 7200);
        const signedMediaUrl =
          signedMedia.mediaUrl ||
          signedMedia.url ||
          signedMedia.secureUrl ||
          signedMedia.secure_url ||
          signedMedia.fileUrl ||
          signedMedia.imageUrl ||
          signedMedia.photoUrl ||
          "";

        const streamUid = getCloudflareStreamUid(signedMedia || m);
        if (!signedMediaUrl && !streamUid) continue;

        const mediaId = String(m.id || m._id || streamUid || "");
        if (!mediaId) continue;

        const kind = inferLetsBuzzKind(signedMedia || m);
        const scope = resolveLetsBuzzScope(signedMedia || m);

        feed.push({
          id: mediaId,
          userId: u.id,
          mediaUrl: signedMediaUrl,
          url: signedMediaUrl,
          fileUrl: signedMediaUrl,
          secureUrl: signedMediaUrl,
          secure_url: signedMediaUrl,
          imageUrl: signedMediaUrl,
          photoUrl: signedMediaUrl,
          type: kind === "reel" ? "video" : "image",
          privacy: scope,
          caption: m.caption || "",
          createdAt: m.createdAt || Date.now(),
          comments: visibleComments,
          commentsCount: visibleComments.length,
          fromGallery: true,
          sourceType: "gallery",
          mediaId,
          r2Key: signedMedia.r2Key || "",

          // Cloudflare Stream profile_reel support.
          // LetsBuzz mobile resolves signed playback through /api/stream/:uid/playback.
          provider: signedMedia.provider || m.provider || "",
          storage: signedMedia.storage || m.storage || "",
          streamUid,
          playback: signedMedia.playback || m.playback || {},
          thumbnailUrl: signedMedia.thumbnailUrl || m.thumbnailUrl || "",
          cloudflareStream: signedMedia.cloudflareStream || m.cloudflareStream || null,
          status:
            signedMedia.status ||
            m.status ||
            signedMedia?.cloudflareStream?.status ||
            m?.cloudflareStream?.status ||
            "",
          duration: Number(
            signedMedia.duration ||
              m.duration ||
              signedMedia?.cloudflareStream?.duration ||
              m?.cloudflareStream?.duration ||
              0
          ),

          user: await signFeedUser(u),
        });
      }
    }

    // 3️⃣ Newest first
    feed.sort((a, b) => Number(b.createdAt) - Number(a.createdAt));

    res.json({ items: feed });
  } catch (err) {
    console.error("❌ LetsBuzz gallery feed failed:", err);
    res.status(500).json({ error: "failed_to_load_letsbuzz" });
  }
});


module.exports = router;
