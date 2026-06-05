/**
 * ============================================================
 * 📁 File: routes/buzzpost/buzz.feed.js
 * 💬 Purpose: Fetch and manage the LetsBuzz feed — including
 *             main feed, reels feed, and view counter updates.
 *
 * Description:
 *   - Retrieves posts visible to the current user based on privacy
 *     (public, matches, specific).
 *   - Supports filtering by type (text, image, video).
 *   - Supports search and sorting (newest / popular).
 *   - Handles view counter updates (e.g., for Reels autoplay).
 *
 * Endpoints:
 *   GET  /api/buzz/feed               → Main feed
 *   GET  /api/buzz/reels              → Only video/reel posts
 *   POST /api/buzz/posts/:postId/view → Increment post view count
 *
 * Dependencies:
 *   - auth-middleware.js
 *   - models/PostModel.js
 *   - models/User.js
 *   - models/Match.js (Mongo)
 *   - utils/helpers.js → baseSanitizeUser()
 * ============================================================
 */

const express = require("express");
const router = express.Router();
const authMiddleware = require("../auth-middleware");

const PostModel = require("../../models/PostModel");
const User = require("../../models/User");
const Match = require("../../models/Match");
const { baseSanitizeUser } = require("../../utils/helpers");
const { getSignedMediaUrl, isR2Key } = require("../../utils/r2Media");

function normalizeMediaString(value = "") {
  return String(value || "").trim();
}

async function signR2Value(value, expiresInSeconds = 3600) {
  const raw = normalizeMediaString(value);
  if (!raw) return "";
  if (!isR2Key(raw)) return raw;

  return getSignedMediaUrl(raw, expiresInSeconds);
}

async function signFeedUser(user = {}) {
  const safe = baseSanitizeUser(user || {});
  safe.avatar = await signR2Value(safe.avatar, 21600);
  return safe;
}

async function signPostForFeed(post = {}, expiresInSeconds = 7200) {
  const raw = { ...(post || {}) };

  return {
    ...raw,
    mediaUrl: await signR2Value(raw.mediaUrl, expiresInSeconds),
    r2Key: isR2Key(raw.mediaUrl) ? raw.mediaUrl : raw.r2Key || "",
  };
}

// =======================================================
// ✅ GET: Main feed (MongoDB)
// =======================================================
router.get("/buzz/feed", authMiddleware, async (req, res) => {
  try {
    const {
      type,
      search,
      sort = "newest",
      limit = 50,
      offset = 0,
    } = req.query;

    // ✅ Resolve viewer id safely (prevents "no matches => no feed")
    let myId = String(req.user?.id || req.user?.userId || "");
    if (!myId && req.user?._id) {
      const meDoc = await User.findById(req.user._id).lean();
      myId = String(meDoc?.id || "");
    }
    if (!myId) return res.status(401).json({ error: "Unauthorized" });

    // 1️⃣ Get matches from Mongo
    const mongoMatches = await Match.find({
      users: myId,
      status: "matched",
    }).lean();

    const myMatches = mongoMatches
      .map((m) => (m.users || []).find((u) => String(u) !== String(myId)))
      .filter(Boolean)
      .map((u) => String(u));

    // ✅ Allowed authors: me + my matches (so you can see your own posts too)
    const allowedAuthors = [myId, ...myMatches];

    // 2️⃣ Build visibility query – me always included + matches obey privacy rules
    const visibilityQuery = {
      userId: { $in: allowedAuthors },
      isActive: true,
      $or: [
        // ✅ My own posts are always visible to me
        { userId: myId },

        // ✅ Match posts visible if privacy is matches/public (unknown values allowed by default schema)
        {
          userId: { $in: myMatches },
          privacy: { $in: ["matches", "public"] },
        },

        // ✅ Specific posts shared with me
        {
          privacy: "specific",
          sharedWith: myId,
        },
      ],
    };

    // Optional type filter (photo / reel / video, etc.)
    if (type && type !== "all") visibilityQuery.type = type;

    // Optional text/tag search – still respects allowedAuthors above
    if (search) {
      const regex = new RegExp(search, "i");
      visibilityQuery.$or.push({ text: regex });
      visibilityQuery.$or.push({ tags: regex });
    }


    // 3️⃣ Fetch posts
    const posts = await PostModel.find(visibilityQuery)
      .sort(
        sort === "popular"
          ? { viewCount: -1, createdAt: -1 }
          : { createdAt: -1 }
      )
      .skip(parseInt(offset))
      .limit(parseInt(limit))
      .lean();

    if (!posts.length) {
      return res.json({ posts: [], total: 0, hasMore: false });
    }

     // 4️⃣ Fetch owners
    const userIds = [...new Set(posts.map((p) => p.userId))];
    const owners = await User.find({ id: { $in: userIds } }).lean();
    const ownersMap = new Map(
      await Promise.all(
        owners.map(async (u) => [u.id, await signFeedUser(u)])
      )
    );

    // 5️⃣ Build formatted feed items
    const formatted = await Promise.all(
      posts.map(async (p) => {
        const signedPost = await signPostForFeed(p, 7200);

        return {
          ...signedPost,
          user:
            ownersMap.get(p.userId) || {
              id: p.userId,
              firstName: "",
              lastName: "",
              avatar: "",
            },
          reactionCount: Object.keys(p.reactions || {}).length,
          commentCount: (p.comments || []).length,
          shareCount: (p.shares || []).length,
          hasBookmarked: (p.bookmarks || []).includes(myId),
          myReaction: p.reactions?.[myId] || null,
        };
      })
    );

    // 6️⃣ Pagination: count total
    const total = await PostModel.countDocuments(visibilityQuery);

    res.json({
      posts: formatted,
      total,
      hasMore: parseInt(offset) + parseInt(limit) < total,
    });
  } catch (err) {
    console.error("❌ Mongo GET /buzz/feed error:", err);
    res.status(500).json({ error: "Failed to load feed" });
  }
});

// =======================================================
// ✅ GET: Reels Feed (MongoDB)
// =======================================================
router.get("/buzz/reels", authMiddleware, async (req, res) => {
  try {
    // ✅ Resolve viewer id the same safe way as /buzz/feed
    let myId = String(req.user?.id || req.user?.userId || "");
    if (!myId && req.user?._id) {
      const meDoc = await User.findById(req.user._id).lean();
      myId = String(meDoc?.id || "");
    }
    if (!myId) return res.status(401).json({ error: "Unauthorized" });

    // 1️⃣ Get matches from Mongo
    const mongoMatches = await Match.find({
      users: myId,
      status: "matched",
    }).lean();

    const myMatches = mongoMatches
      .map((m) => (m.users || []).find((u) => String(u) !== String(myId)))
      .filter(Boolean)
      .map((u) => String(u));

    if (!myMatches.length) return res.json({ posts: [] });

    // 2️⃣ Fetch candidate posts first (do NOT over-filter in Mongo)
    // Only require: matched author + active + media exists
    const candidates = await PostModel.find({
      userId: { $in: myMatches },
      isActive: true,
      mediaUrl: { $exists: true, $ne: "" },
    })
      .sort({ createdAt: -1 })
      .lean();

    if (!candidates.length) return res.json({ posts: [] });

    // 3️⃣ Filter in JS (safer than brittle Mongo regex/type checks)
    const reels = candidates.filter((p) => {
      const type = String(p?.type || "").toLowerCase();
      const privacy = String(p?.privacy || "").toLowerCase();
      const hasMedia = !!String(p?.mediaUrl || "").trim();

      // ✅ Show anything except private
      const isVisible = !privacy || privacy !== "private";

      // ✅ Treat reel/video/reels as reels
      // ✅ Also allow story if it has media, since some uploaders save reels that way
      const isReelType =
        type === "reel" ||
        type === "reels" ||
        type === "video" ||
        (type === "story" && hasMedia);

      return hasMedia && isVisible && isReelType;
    });

    if (!reels.length) return res.json({ posts: [] });

      // 4️⃣ Fetch owners
    const ownerIds = [...new Set(reels.map((p) => String(p.userId || "")))];
    const owners = await User.find({ id: { $in: ownerIds } }).lean();
    const ownerMap = new Map(
      await Promise.all(
        owners.map(async (u) => [String(u.id), await signFeedUser(u)])
      )
    );

    // 5️⃣ Build response
    const posts = await Promise.all(
      reels.map(async (p) => {
        const uid = String(p.userId || "");
        const safeUser = ownerMap.get(uid) || {};
        const signedPost = await signPostForFeed(p, 7200);

            return {
          id: String(p.id || p._id || ""),
          userId: uid,
          mediaUrl: signedPost.mediaUrl || "",
          r2Key: signedPost.r2Key || "",
          type: p.type || "video",
          privacy: p.privacy || "",
          text: p.text || "",
          createdAt: p.createdAt,
          updatedAt: p.updatedAt,
          isActive: p.isActive !== false,
          viewCount: p.viewCount || 0,
          likesCount: p.likesCount || 0,
          commentsCount: p.commentsCount || 0,
          giftCount: p.giftCount || 0,
          isLiked: false,
          user: {
            id: uid,
            firstName: safeUser.firstName || "",
            lastName: safeUser.lastName || "",
            username: safeUser.username || "",
            avatar: safeUser.avatar || "",
          },
        };
      })
    );

    res.json({ posts });
  } catch (err) {
    console.error("❌ Mongo GET /buzz/reels error:", err);
    res.status(500).json({ error: "Failed to fetch reels" });
  }
});

// =======================================================
// ✅ POST: Increment view counter (Reels autoplay)
// =======================================================
router.post("/buzz/posts/:postId/view", authMiddleware, async (req, res) => {
  try {
    const { postId } = req.params;

    const post = await PostModel.findOne({ id: postId });
    if (!post) return res.status(404).json({ error: "Post not found" });

    post.viewCount = (post.viewCount || 0) + 1;
    post.updatedAt = Date.now();
    await post.save();

    res.json({ ok: true, viewCount: post.viewCount });
  } catch (err) {
    console.error("❌ Mongo POST /buzz/posts/:postId/view error:", err);
    res.status(500).json({ error: "Failed to record view" });
  }
});

module.exports = router;
