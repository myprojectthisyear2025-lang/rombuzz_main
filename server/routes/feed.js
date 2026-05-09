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

// ============================================================
// ✅ Gallery caption tags parser (scope + kind)
// We store visibility inside caption like: "scope:public scope:matches scope:private"
// and type inside caption like: "kind:photo kind:reel"
// ============================================================
function parseCaptionTags(caption) {
  const text = String(caption || "").toLowerCase();

  const scope =
    text.includes("scope:public") ? "public" :
    text.includes("scope:matches") ? "matches" :
    text.includes("scope:private") ? "private" :
    null;

  const kind =
    text.includes("kind:reel") ? "reel" :
    text.includes("kind:photo") ? "photo" :
    null;

  return { scope, kind };
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
        user: baseSanitizeUser(owner),
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
          user: baseSanitizeUser(u),
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

        feed.push({
          id,
          userId: u.id,

          // match PostModel shape used by the app
          text: "",
          mediaUrl: m.url || m.secureUrl || m.mediaUrl || "",
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
          user: baseSanitizeUser(u),
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
        const caption = String(m.caption || "");

        // ❌ NEVER show private
        if (caption.includes("scope:private")) continue;

        // ✅ Only public OR matches
        if (
          caption.includes("scope:public") ||
          caption.includes("scope:matches")
        ) {
              const visibleComments = sanitizeMediaCommentsForViewer(
            m.comments,
            myId,
            u.id
          );

          feed.push({
            id: m.id,
            userId: u.id,
            mediaUrl: m.url,
            type: m.type === "video" ? "video" : "image",
            caption: m.caption,
            createdAt: m.createdAt || Date.now(),
            comments: visibleComments,
            commentsCount: visibleComments.length,
            user: baseSanitizeUser(u),
          });
        }
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
