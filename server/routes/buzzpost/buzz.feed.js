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

    const myId = req.user.id;

    // 1️⃣ Get matches from Mongo
    const mongoMatches = await Match.find({
      users: myId,
      status: "matched",
    }).lean();

    const myMatches = mongoMatches
      .map((m) => m.users.find((u) => u !== myId))
      .filter(Boolean);

       // 2️⃣ Build visibility query – ONLY me + my matches
    const allowedAuthors = [myId, ...myMatches];

    const visibilityQuery = {
      userId: { $in: allowedAuthors },
      isActive: true,
      $or: [
        // ✅ My own posts (any privacy)
        { userId: myId },

        // ✅ Posts from my matches with normal privacy
        {
          userId: { $in: myMatches },
          privacy: { $in: ["matches", "public"] },
        },

        // ✅ Specific posts that have explicitly sharedWith me
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
    const ownersMap = new Map(owners.map((u) => [u.id, baseSanitizeUser(u)]));

    // 5️⃣ Build formatted feed items
    const formatted = posts.map((p) => ({
      ...p,
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
    }));

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
    const myId = req.user.id;

    // 1️⃣ Get matches from Mongo
    const mongoMatches = await Match.find({
      users: myId,
      status: "matched",
    }).lean();

    const myMatches = mongoMatches
      .map((m) => m.users.find((u) => u !== myId))
      .filter(Boolean);

    // 2️⃣ Find reels
    const reels = await PostModel.find({
      userId: { $in: myMatches },
      type: { $in: ["reel", "video"] },
      isActive: true,
    })
      .sort({ createdAt: -1 })
      .lean();

    if (!reels.length) return res.json({ posts: [] });

    // 3️⃣ Fetch owners
    const ownerIds = [...new Set(reels.map((p) => p.userId))];
    const owners = await User.find({ id: { $in: ownerIds } }).lean();
    const ownerMap = new Map(owners.map((u) => [u.id, baseSanitizeUser(u)]));

    // 4️⃣ Build response
    const posts = reels.map((p) => ({
      ...p,
      user:
        ownerMap.get(p.userId) || {
          id: p.userId,
          firstName: "",
          lastName: "",
          avatar: "",
        },
    }));

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
